import { v4 as uuidv4 } from 'uuid';
import gameState from '../state.js';
import { WORLD, ZONES, PORTALS, getRandomPointInZone } from '../config/world.js';
import { CLASSES } from '../config/classes.js';
import { SPELLS } from '../config/spells.js';
import { SKINS, RANKS } from '../config/skins.js';
import {
  distance, normalize, clamp, xpForLevel, pointToLineDistance,
  getPlayerBySocket, isAdminSocket,
  spawnXpOrb, spawnDamageNumber, spawnParticles
} from '../systems/helpers.js';
import { checkEnemyDeath } from '../systems/tick.js';
import { createProjectile, spawnDungeonEnemies, spawnDragonBoss, spawnCustomBoss } from '../systems/enemies.js';
import { savePlayerToDb, loadPlayerFromDb, sessionsDb, loadUserFromDb, getUnlockedSkins, getPlayerRank } from '../db/index.js';
import { generateDungeon, generateDungeonLLM, sanitizeDungeonForClient } from '../dungeon-generator.js';
import { generateWizard } from '../wizard-generator.js';

export function registerSocketEvents(io) {
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Send available classes
  socket.emit('classes', CLASSES);

  // Pre-join admin authentication (so wizard creator works from title screen)
  socket.on('authenticateAdmin', async ({ sessionToken }) => {
    console.log(`🔑 authenticateAdmin attempt from ${socket.id}, token: ${sessionToken ? 'present' : 'missing'}`);
    if (!sessionToken || !sessionsDb[sessionToken]) {
      console.log(`🔑 authenticateAdmin failed: ${!sessionToken ? 'no token' : 'token not in sessionsDb'}`);
      socket.emit('adminAuthenticated', { success: false });
      return;
    }
    const session = sessionsDb[sessionToken];
    if (session.isGuest || !session.userId) {
      console.log(`🔑 authenticateAdmin failed: ${session.isGuest ? 'guest session' : 'no userId'}`);
      socket.emit('adminAuthenticated', { success: false });
      return;
    }
    const user = await loadUserFromDb(session.userId);
    if (user?.username?.toLowerCase() === 'azoni') {
      socket.isAdmin = true;
      socket.adminSessionToken = sessionToken; // Store for later verification
      socket.emit('adminAuthenticated', { success: true });
      console.log(`🔑 Socket ${socket.id} pre-authenticated as admin (${user.username})`);
    } else {
      console.log(`🔑 authenticateAdmin failed: user is ${user?.username || 'unknown'}, not azoni`);
      socket.emit('adminAuthenticated', { success: false });
    }
  });

  socket.on('join', async ({ playerId, playerName, playerClass, selectedSkin, adminKey, sessionToken, isCustomWizard }) => {
    // Prevent double-join from same socket
    for (const p of gameState.players.values()) {
      if (p.socketId === socket.id) {
        socket.emit('error', { message: 'Already in game' });
        return;
      }
    }
    
    // Check if azoni account via session token (server-side verification only)
    let isAzoniAccount = false;
    if (sessionToken && sessionsDb[sessionToken]) {
      const session = sessionsDb[sessionToken];
      if (!session.isGuest && session.userId) {
        const user = await loadUserFromDb(session.userId);
        if (user?.username?.toLowerCase() === 'azoni') {
          isAzoniAccount = true;
        }
      }
    }
    
    // Validate class selection
    let validatedClass = playerClass;
    let isAdmin = isAzoniAccount;
    
    // Load or create player - ONLY by unique ID, never by name
    let saved = playerId ? await loadPlayerFromDb(playerId) : null;
    
    // OWNERSHIP CHECK: If loading existing character, verify it belongs to this user
    if (saved && playerId) {
      let ownsCharacter = false;
      if (sessionToken && sessionsDb[sessionToken]) {
        const sess = sessionsDb[sessionToken];
        if (!sess.isGuest && sess.userId) {
          const usr = await loadUserFromDb(sess.userId);
          if (usr?.characters?.includes(playerId)) {
            ownsCharacter = true;
          }
        } else if (sess.isGuest && sess.guestId) {
          // Guest can only load their own guest character
          ownsCharacter = (saved.guestId === sess.guestId);
        }
      }
      if (!ownsCharacter) {
        console.log(`⛔ Ownership check failed: ${playerName} tried to load character ${playerId}`);
        saved = null; // Force new character creation
      }
    }
    
    // For EXISTING characters, always use saved class (skip validation)
    // Class validation only applies to NEW character creation
    if (saved) {
      validatedClass = saved.class;
    } else {
      // Brute requires admin (new character only)
      if (playerClass === 'brute') {
        if (!isAdmin) {
          validatedClass = 'pyromancer';
          console.log(`${playerName} tried to pick Brute without admin`);
        } else {
          console.log(`Admin ${playerName} playing as The Brute`);
        }
      }
      
      // Shadow Archer & Voidlord require dragon kill (new character only)
      if (playerClass === 'shadowarcher' || playerClass === 'voidlord') {
        let hasDragonKill = false;
        // Check user's other characters for dragon kill
        if (sessionToken && sessionsDb[sessionToken]) {
          const sess = sessionsDb[sessionToken];
          if (!sess.isGuest && sess.userId) {
            const usr = await loadUserFromDb(sess.userId);
            if (usr?.characters) {
              for (const cid of usr.characters) {
                const c = await loadPlayerFromDb(cid);
                if (c?.bossKills?.dragon) { hasDragonKill = true; break; }
              }
            }
          }
        }
        if (!hasDragonKill && !isAdmin) {
          validatedClass = 'pyromancer';
          console.log(`${playerName} tried to pick ${playerClass} without dragon kill`);
        }
      }
    }
    
    // Handle custom wizard classes
    let classData;
    let customWizardData = null;
    
    if (isCustomWizard && playerClass && gameState.customWizards.has(playerClass)) {
      // Custom wizard - load from stored wizards (active session)
      customWizardData = gameState.customWizards.get(playerClass);
      classData = customWizardData.classDef;
      validatedClass = playerClass; // Use the custom classId
      console.log(`🧙 Custom wizard join: ${playerName} as ${classData.name} (classId: ${playerClass})`);
      
      // Register custom spells globally so combat works
      for (const [spellId, spellDef] of Object.entries(customWizardData.spellDefs)) {
        SPELLS[spellId] = spellDef;
      }
    } else if (saved && saved.isCustomWizard && saved.customWizardData) {
      // Custom wizard - restore from saved DB data (after server restart)
      customWizardData = saved.customWizardData;
      classData = customWizardData.classDef;
      validatedClass = saved.class;
      console.log(`🧙 Restored custom wizard from DB: ${classData.name} (classId: ${validatedClass})`);
      
      // Re-register in gameState so future lookups work
      if (!gameState.customWizards.has(validatedClass)) {
        gameState.customWizards.set(validatedClass, customWizardData);
      }
      
      // Register custom spells globally so combat works
      for (const [spellId, spellDef] of Object.entries(customWizardData.spellDefs)) {
        SPELLS[spellId] = spellDef;
      }
    } else {
      // Standard class
      classData = CLASSES[validatedClass] || CLASSES.pyromancer;
    }

    const id = saved?.id || uuidv4();
    const totalXp = saved?.totalXp || 0;
    const level = saved?.level || 1;
    
    // Calculate stats based on level
    const healthBonus = (level - 1) * 12;
    const speedBonus = (level - 1) * 2;
    const damageMultiplier = 1 + (level - 1) * 0.05;
    
    // Get unlocked skins
    const unlockedSkins = Object.values(SKINS)
      .filter(s => s.class === classData.id && s.requiredXp <= totalXp)
      .map(s => s.id);
    
    // Validate selected skin
    const skin = selectedSkin && unlockedSkins.includes(selectedSkin) 
      ? selectedSkin 
      : (saved?.selectedSkin || `${classData.id}_default`);
    
    const player = {
      id,
      socketId: socket.id,
      name: saved?.name || playerName || `Wizard${Math.floor(Math.random() * 9000) + 1000}`,
      class: saved?.class || classData.id,
      level,
      xp: saved?.xp || 0,
      totalXp,
      kills: saved?.kills || 0,
      deaths: saved?.deaths || 0,
      playTime: saved?.playTime || 0,
      selectedSkin: skin,
      unlockedSkins,
      spellUpgrades: saved?.spellUpgrades || [], // Track acquired spell upgrades
      alternateSpells: saved?.alternateSpells || {}, // { slot: spellId }
      bossKills: saved?.bossKills || {}, // Track defeated zone bosses
      questComplete: saved?.questComplete || false,
      upgrades: saved?.upgrades || { health: 0, damage: 0, speed: 0, cooldown: 0, attackSpeed: 0 },
      x: 10500, // Sanctuary center
      y: 9000,
      health: classData.baseHealth + healthBonus + (saved?.upgrades?.health || 0) * 5,
      maxHealth: classData.baseHealth + healthBonus + (saved?.upgrades?.health || 0) * 5,
      baseSpeed: classData.baseSpeed + speedBonus,
      damageMultiplier: damageMultiplier * Math.pow(1.01, saved?.upgrades?.damage || 0),
      speedMultiplier: Math.pow(1.01, saved?.upgrades?.speed || 0),
      cooldownMultiplier: Math.pow(0.99, saved?.upgrades?.cooldown || 0),
      attackSpeedMultiplier: Math.pow(0.98, saved?.upgrades?.attackSpeed || 0), // 2% faster auto-attack per level
      input: { up: false, down: false, left: false, right: false },
      lastCast: {},
      castCount: {}, // Track cast count for "every Nth" effects
      state: 'idle',
      facing: 'down',
      animFrame: 0,
      animTime: 0,
      createdAt: saved?.createdAt || new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      isAdmin: isAdmin,
    };
    
    // Apply custom wizard properties if joining as custom wizard
    if (customWizardData) {
      player.isCustomWizard = true;
      player.customClassId = validatedClass;
      player.customWizardData = customWizardData; // Persist for DB save
      player.className = classData.name;
      player.color = classData.color;
      player.secondaryColor = classData.secondaryColor || classData.color;
      player.iconStyle = classData.iconStyle || 'star';
      player.spells = classData.spells;
      player.dashAbility = classData.dashAbility;
      player.ultimateAbility = classData.ultimateAbility;
      console.log(`🧙 Applied custom wizard properties: ${classData.name}, spells: ${player.spells?.join(', ')}`);
    }
    
    // Store guestId on player for ownership tracking
    if (sessionToken && sessionsDb[sessionToken]?.isGuest) {
      player.guestId = sessionsDb[sessionToken].guestId;
    }

    gameState.players.set(id, player);
    
    // Save to DB immediately so character persists even before disconnect
    savePlayerToDb(player);

    // Get rank
    const rank = RANKS.reduce((best, r) => totalXp >= r.xp ? r : best, RANKS[0]);

    // Build enhanced class data with spell details for spellbook
    const classAbilityMap = {
      pyromancer: { 1: 'flameShield', 2: 'meteorStrike', 3: 'inferno' },
      cryomancer: { 1: 'frostNova', 2: 'iceLance', 3: 'glacialStorm' },
      arcanist: { 1: 'blink', 2: 'arcaneBarrage', 3: 'timeWarp' },
      voidlord: { 1: 'voidRiftAbility', 2: 'soulDrain', 3: 'apocalypse' },
      shadowarcher: { 1: 'huntersMark', 2: 'multishot', 3: 'deathArrow' },
      brute: { 1: 'proteinShake', 2: 'barbellSpin', 3: 'ultimateFlex' },
    };
    
    const enhancedClasses = {};
    for (const [cid, cdata] of Object.entries(CLASSES)) {
      const spellIds = cdata.spells || [];
      const primarySpell = SPELLS[spellIds[0]];
      const secondarySpell = SPELLS[spellIds[1]];
      const abilityIds = classAbilityMap[cid] || {};
      const abilities = [1, 2, 3].map(slot => {
        const sid = abilityIds[slot];
        return sid ? SPELLS[sid] : null;
      }).filter(Boolean);
      
      enhancedClasses[cid] = {
        ...cdata,
        // Primary spell info
        spellName: primarySpell?.name || 'Primary Attack',
        spellDescription: primarySpell?.description || 'Automatically attacks nearby enemies.',
        spellDamage: primarySpell?.damage,
        spellCooldown: primarySpell?.cooldown,
        spellRange: primarySpell?.range,
        // Secondary spell info  
        secondaryName: secondarySpell?.name,
        secondaryDescription: secondarySpell?.description,
        secondaryDamage: secondarySpell?.damage,
        secondaryCooldown: secondarySpell?.cooldown,
        secondaryRange: secondarySpell?.range,
        // Class abilities (unlockable)
        classAbilities: abilities,
        // Dash & Ultimate display names for HUD
        dash: cdata.dashAbility?.name || 'Dash',
        dashCooldown: cdata.dashAbility?.cooldown || 3000,
        ultimate: cdata.ultimateAbility?.name || 'Ultimate',
        ultimateCooldown: cdata.ultimateAbility?.cooldown || 30000,
      };
    }
    
    // For custom wizards, add their spell info to enhanced classes
    if (customWizardData) {
      const cwSpells = classData.spells || [];
      const s1 = SPELLS[cwSpells[0]];
      const s2 = SPELLS[cwSpells[1]];
      const abilitySlots = classData.abilities || {};
      const cwAbilities = [1, 2, 3].map(slot => {
        const aid = abilitySlots[slot];
        return aid ? SPELLS[aid] : null;
      }).filter(Boolean);
      
      enhancedClasses[validatedClass] = {
        ...classData,
        spellName: s1?.name || 'Primary Attack',
        spellDescription: s1?.description || 'Custom primary attack.',
        spellDamage: s1?.damage,
        spellCooldown: s1?.cooldown,
        spellRange: s1?.range,
        secondaryName: s2?.name,
        secondaryDescription: s2?.description,
        secondaryDamage: s2?.damage,
        secondaryCooldown: s2?.cooldown,
        secondaryRange: s2?.range,
        classAbilities: cwAbilities,
        // Dash & Ultimate display names for HUD
        dash: classData.dashAbility?.name || 'Dash',
        dashCooldown: classData.dashAbility?.cooldown || 3000,
        ultimate: classData.ultimateAbility?.name || 'Ultimate',
        ultimateCooldown: classData.ultimateAbility?.cooldown || 30000,
      };
    }

    socket.emit('joined', {
      playerId: id,
      player: {
        id: player.id,
        name: player.name,
        class: player.class,
        level: player.level,
        xp: player.xp,
        totalXp: player.totalXp,
        xpToLevel: xpForLevel(player.level),
        health: player.health,
        maxHealth: player.maxHealth,
        kills: player.kills,
        deaths: player.deaths,
        selectedSkin: player.selectedSkin,
        unlockedSkins: player.unlockedSkins,
        rank,
        damageMultiplier: player.damageMultiplier,
        speedMultiplier: player.speedMultiplier || 1,
        cooldownMultiplier: player.cooldownMultiplier || 1,
        attackSpeedMultiplier: player.attackSpeedMultiplier || 1,
        upgrades: player.upgrades || { health: 0, damage: 0, speed: 0, cooldown: 0, attackSpeed: 0 },
        isAdmin: player.isAdmin || false,
        bossKills: player.bossKills,
        questComplete: player.questComplete,
        isCustomWizard: player.isCustomWizard || false,
        customColor: player.isCustomWizard ? player.color : undefined,
        customSecondaryColor: player.isCustomWizard ? (player.secondaryColor || player.color) : undefined,
        customClassName: player.isCustomWizard ? player.className : undefined,
        customIconStyle: player.isCustomWizard ? (player.iconStyle || 'star') : undefined,
      },
      world: WORLD,
      zones: ZONES,
      skins: SKINS,
      ranks: RANKS,
      classes: enhancedClasses,
      spells: SPELLS,
    });

    console.log(`🧙 Player joined: ${player.name} (${player.class}) - Level ${player.level} - Skin: ${skin}`);
    
    // Broadcast join message to all players
    const joinMsg = {
      id: uuidv4(),
      type: 'system',
      text: `${player.name} has joined the game`,
      timestamp: Date.now(),
    };
    gameState.chatMessages.push(joinMsg);
    if (gameState.chatMessages.length > 50) gameState.chatMessages.shift();
    io.emit('chatMessage', joinMsg);
    
    // Send chat history to new player
    socket.emit('chatHistory', gameState.chatMessages);
  });

  socket.on('input', (input) => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        player.input = {
          up: !!input.up,
          down: !!input.down,
          left: !!input.left,
          right: !!input.right,
        };
        // Clear click target when using WASD
        if (input.up || input.down || input.left || input.right) {
          player.clickTarget = null;
        }
        break;
      }
    }
  });
  
  // Click to move
  socket.on('clickMove', ({ targetX, targetY }) => {
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return;
    
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id && player.health > 0) {
        player.clickTarget = { x: targetX, y: targetY };
        break;
      }
    }
  });

  // Chat message
  socket.on('chat', (text) => {
    // Find player
    let player = null;
    for (const p of gameState.players.values()) {
      if (p.socketId === socket.id) {
        player = p;
        break;
      }
    }
    if (!player) return;
    
    // Sanitize and limit message
    const sanitized = String(text).slice(0, 200).trim();
    if (!sanitized) return;
    
    const msg = {
      id: uuidv4(),
      type: 'player',
      playerId: player.id,
      playerName: player.name,
      playerClass: player.class,
      text: sanitized,
      timestamp: Date.now(),
    };
    
    gameState.chatMessages.push(msg);
    if (gameState.chatMessages.length > 50) gameState.chatMessages.shift();
    
    io.emit('chatMessage', msg);
  });

  // Dash ability (spacebar)
  socket.on('dash', ({ targetX, targetY }) => {
    // Validate coordinates
    const tx = Number.isFinite(targetX) ? targetX : null;
    const ty = Number.isFinite(targetY) ? targetY : null;
    
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id && player.health > 0) {
        // Custom wizards have dashAbility on player object, otherwise use CLASSES lookup
        const classData = CLASSES[player.class];
        const dash = player.dashAbility || classData?.dashAbility;
        if (!dash) break;
        
        const lastDash = player.lastDash || 0;
        const now = Date.now();
        
        if (now - lastDash < dash.cooldown) {
          socket.emit('abilityCooldown', { ability: 'dash', remaining: dash.cooldown - (now - lastDash) });
          break;
        }
        
        // Calculate dash direction
        let dir;
        if (tx !== null && ty !== null) {
          dir = normalize({ x: tx - player.x, y: ty - player.y });
        } else {
          // Use current facing direction
          const facingVec = {
            up: { x: 0, y: -1 },
            down: { x: 0, y: 1 },
            left: { x: -1, y: 0 },
            right: { x: 1, y: 0 },
          };
          dir = facingVec[player.facing] || { x: 0, y: -1 };
        }
        
        const startX = player.x;
        const startY = player.y;
        
        // Move player
        player.x += dir.x * dash.distance;
        player.y += dir.y * dash.distance;
        player.x = clamp(player.x, 20, WORLD.width - 20);
        player.y = clamp(player.y, 20, WORLD.height - 20);
        player.lastDash = now;
        
        // Class-specific effects
        const playerInDungeon = player.inDungeon || false;
        
        if (dash.id === 'fireDash' && dash.damage) {
          // Fire trail damage
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
            // DUNGEON ISOLATION
            if (playerInDungeon !== (enemy.isDungeon || false)) continue;
            // Check if enemy is near the dash line
            const distToLine = pointToLineDistance(enemy, { x: startX, y: startY }, { x: player.x, y: player.y });
            if (distToLine < 40) {
              enemy.health -= dash.damage;
              spawnDamageNumber(enemy.x, enemy.y - 20, dash.damage);
              checkEnemyDeath(enemy, player.id);
            }
          }
          io.emit('dashTrail', { startX, startY, endX: player.x, endY: player.y, color: '#ff6b35' });
        } else if (dash.id === 'frostStep' && dash.freezeRadius) {
          // Freeze enemies at destination
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
            // DUNGEON ISOLATION
            if (playerInDungeon !== (enemy.isDungeon || false)) continue;
            if (distance(enemy, player) < dash.freezeRadius) {
              enemy.frozenUntil = now + dash.freezeDuration;
            }
          }
          spawnParticles(player.x, player.y, '#4ecdc4', 10);
        } else if (dash.id === 'blink' && dash.invulnerable) {
          player.invulnerableUntil = now + 300; // Brief invulnerability
          spawnParticles(startX, startY, '#9b5de5', 8);
          spawnParticles(player.x, player.y, '#9b5de5', 8);
        } else if ((dash.id === 'voidShift' || dash.id === 'shadowStep') && dash.damageOnArrival) {
          // Damage on arrival + invulnerability
          if (dash.invulnerable) player.invulnerableUntil = now + 300;
          const dashColor = dash.id === 'shadowStep' ? '#dc2626' : '#ff00ff';
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
            if (playerInDungeon !== (enemy.isDungeon || false)) continue;
            if (distance(enemy, player) < dash.damageRadius) {
              enemy.health -= dash.damageOnArrival;
              spawnDamageNumber(enemy.x, enemy.y - 20, dash.damageOnArrival);
              checkEnemyDeath(enemy, player.id);
            }
          }
          spawnParticles(startX, startY, dashColor, 10);
          spawnParticles(player.x, player.y, dashColor, 10);
          io.emit('explosion', { x: player.x, y: player.y, radius: dash.damageRadius, color: dashColor });
        } else if (dash.id && dash.id.startsWith('custom_')) {
          // Generic custom wizard dash - trail damage + arrival particles
          const cwDashColor = player.color || '#a78bfa';
          if (dash.damage) {
            for (const enemy of gameState.enemies.values()) {
              if (enemy.health <= 0) continue;
              if (playerInDungeon !== (enemy.isDungeon || false)) continue;
              const distToLine = pointToLineDistance(enemy, { x: startX, y: startY }, { x: player.x, y: player.y });
              if (distToLine < 40) {
                enemy.health -= dash.damage;
                spawnDamageNumber(enemy.x, enemy.y - 20, dash.damage);
                checkEnemyDeath(enemy, player.id);
              }
            }
          }
          io.emit('dashTrail', { startX, startY, endX: player.x, endY: player.y, color: cwDashColor });
          spawnParticles(startX, startY, cwDashColor, 8);
          spawnParticles(player.x, player.y, cwDashColor, 10);
        }
        
        io.emit('sound', { type: 'dash', x: player.x, y: player.y, classId: player.class });
        socket.emit('dashUsed', { cooldown: dash.cooldown });
        break;
      }
    }
  });

  // Ultimate ability (Q key)
  socket.on('ultimate', ({ targetX, targetY }) => {
    // Validate coordinates
    const tx = Number.isFinite(targetX) ? targetX : null;
    const ty = Number.isFinite(targetY) ? targetY : null;
    
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id && player.health > 0) {
        // Custom wizards have ultimateAbility on player object, otherwise use CLASSES lookup
        const classData = CLASSES[player.class];
        const ult = player.ultimateAbility || classData?.ultimateAbility;
        if (!ult) break;
        
        const lastUlt = player.lastUltimate || 0;
        const now = Date.now();
        
        if (now - lastUlt < ult.cooldown) {
          socket.emit('abilityCooldown', { ability: 'ultimate', remaining: ult.cooldown - (now - lastUlt) });
          break;
        }
        
        player.lastUltimate = now;
        const ultPlayerInDungeon = player.inDungeon || false;
        
        // Class-specific ultimates
        if (ult.id === 'meteor') {
          // Meteor strike with delay
          const meteorX = tx ?? player.x;
          const meteorY = ty ?? player.y;
          io.emit('meteorWarning', { x: meteorX, y: meteorY, radius: ult.radius, delay: ult.delay });
          
          setTimeout(() => {
            const ultDmg = Math.floor(ult.damage * (player.damageMultiplier || 1));
            for (const enemy of gameState.enemies.values()) {
              if (enemy.health <= 0) continue;
              // DUNGEON ISOLATION
              if (ultPlayerInDungeon !== (enemy.isDungeon || false)) continue;
              if (distance(enemy, { x: meteorX, y: meteorY }) < ult.radius) {
                enemy.health -= ultDmg;
                spawnDamageNumber(enemy.x, enemy.y - 20, ultDmg);
                checkEnemyDeath(enemy, player.id);
              }
            }
            io.emit('explosion', { x: meteorX, y: meteorY, radius: ult.radius, color: '#ff6b35' });
            spawnParticles(meteorX, meteorY, '#ff6b35', 20);
            io.emit('sound', { type: 'meteor', x: meteorX, y: meteorY });
          }, ult.delay);
          
        } else if (ult.id === 'iceNova') {
          // Ice nova - freeze and damage all nearby
          const iceDmg = Math.floor(ult.damage * (player.damageMultiplier || 1));
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
            // DUNGEON ISOLATION
            if (ultPlayerInDungeon !== (enemy.isDungeon || false)) continue;
            if (distance(enemy, player) < ult.radius) {
              enemy.health -= iceDmg;
              enemy.frozenUntil = now + ult.freezeDuration;
              spawnDamageNumber(enemy.x, enemy.y - 20, iceDmg);
              checkEnemyDeath(enemy, player.id);
            }
          }
          io.emit('iceNova', { x: player.x, y: player.y, radius: ult.radius });
          spawnParticles(player.x, player.y, '#4ecdc4', 25);
          io.emit('sound', { type: 'iceNova', x: player.x, y: player.y });
          
        } else if (ult.id === 'arcaneBarrage') {
          // Rapid fire missiles
          let missilesFired = 0;
          const fireInterval = setInterval(() => {
            if (missilesFired >= ult.missiles || player.health <= 0) {
              clearInterval(fireInterval);
              return;
            }
            
            // Find random enemy in range (DUNGEON ISOLATION)
            const enemies = [...gameState.enemies.values()].filter(e => 
              e.health > 0 && 
              distance(e, player) < 400 &&
              ultPlayerInDungeon === (e.isDungeon || false)
            );
            if (enemies.length > 0) {
              const target = enemies[Math.floor(Math.random() * enemies.length)];
              createProjectile(player, {
                ...SPELLS.magicMissile,
                damage: ult.damagePerMissile,
                homing: true,
              }, target.x, target.y);
            }
            missilesFired++;
          }, ult.duration / ult.missiles);
          
          io.emit('sound', { type: 'arcaneBarrage', x: player.x, y: player.y });
        
        } else if (ult.id === 'voidRift') {
          // Voidlord ultimate - Create a void rift that pulls and damages all enemies and players
          const riftX = tx ?? player.x;
          const riftY = ty ?? player.y;
          
          // Emit the rift effect
          io.emit('voidRift', { 
            x: riftX, 
            y: riftY, 
            radius: ult.radius, 
            duration: ult.duration,
            playerId: player.id,
          });
          
          // Apply damage and pull over the duration
          let ticks = 0;
          const maxTicks = Math.floor(ult.duration / 100);
          const damagePerTick = (ult.damage * (player.damageMultiplier || 1)) / maxTicks;
          
          const riftInterval = setInterval(() => {
            if (ticks >= maxTicks) {
              clearInterval(riftInterval);
              // Final explosion
              io.emit('explosion', { x: riftX, y: riftY, radius: ult.radius * 0.5, color: '#ff00ff' });
              return;
            }
            
            // Damage and pull enemies
            for (const enemy of gameState.enemies.values()) {
              if (enemy.health <= 0) continue;
              const dist = distance(enemy, { x: riftX, y: riftY });
              if (dist < ult.radius) {
                // Pull toward center
                const pullStrength = (1 - dist / ult.radius) * ult.pullForce * 0.1;
                const dx = riftX - enemy.x;
                const dy = riftY - enemy.y;
                const mag = Math.sqrt(dx * dx + dy * dy) || 1;
                enemy.x += (dx / mag) * pullStrength;
                enemy.y += (dy / mag) * pullStrength;
                
                // Damage
                if (ticks % 3 === 0) { // Every 300ms
                  enemy.health -= damagePerTick * 3;
                  spawnDamageNumber(enemy.x, enemy.y - 20, Math.round(damagePerTick * 3));
                  checkEnemyDeath(enemy, player.id);
                }
              }
            }
            
            // Damage other players (PvP) - only if pvpEnabled
            if (player.pvpEnabled === true) {
              for (const otherPlayer of gameState.players.values()) {
                if (otherPlayer.id === player.id || otherPlayer.health <= 0) continue;
                const dist = distance(otherPlayer, { x: riftX, y: riftY });
                if (dist < ult.radius) {
                  // Pull toward center
                  const pullStrength = (1 - dist / ult.radius) * ult.pullForce * 0.05;
                  const dx = riftX - otherPlayer.x;
                  const dy = riftY - otherPlayer.y;
                  const mag = Math.sqrt(dx * dx + dy * dy) || 1;
                  otherPlayer.x += (dx / mag) * pullStrength;
                  otherPlayer.y += (dy / mag) * pullStrength;
                  
                  // Damage (less frequent)
                  if (ticks % 5 === 0) {
                    otherPlayer.health -= damagePerTick * 2;
                    spawnDamageNumber(otherPlayer.x, otherPlayer.y - 20, Math.round(damagePerTick * 2));
                    
                    const otherSocket = io.sockets.sockets.get(otherPlayer.socketId);
                    if (otherSocket) {
                      otherSocket.emit('damaged', { amount: damagePerTick * 2 });
                    }
                    
                    if (otherPlayer.health <= 0) {
                      otherPlayer.deaths = (otherPlayer.deaths || 0) + 1;
                      if (otherSocket) {
                        otherSocket.emit('died', { killedBy: 'Void Lord', deathMessage: 'Consumed by the void!' });
                      }
                    }
                  }
                }
              }
            }
            
            ticks++;
          }, 100);
          
          io.emit('sound', { type: 'voidRift', x: riftX, y: riftY });
        } else if (ult.id === 'arrowStorm') {
          // Arrow Storm - waves of arrows raining down in a large area
          const stormX = tx ?? player.x;
          const stormY = ty ?? player.y;
          
          io.emit('arrowStorm', { 
            x: stormX, y: stormY, 
            radius: ult.radius, 
            duration: ult.duration,
            playerId: player.id,
          });
          
          let wave = 0;
          const waveInterval = setInterval(() => {
            if (wave >= ult.waves) {
              clearInterval(waveInterval);
              io.emit('explosion', { x: stormX, y: stormY, radius: ult.radius * 0.3, color: '#dc2626' });
              return;
            }
            
            const dmgPerWave = Math.floor((ult.damage / ult.waves) * (player.damageMultiplier || 1));
            for (const enemy of gameState.enemies.values()) {
              if (enemy.health <= 0) continue;
              if (ultPlayerInDungeon !== (enemy.isDungeon || false)) continue;
              if (distance(enemy, { x: stormX, y: stormY }) < ult.radius) {
                enemy.health -= dmgPerWave;
                spawnDamageNumber(enemy.x, enemy.y - 20, Math.round(dmgPerWave));
                checkEnemyDeath(enemy, player.id);
              }
            }
            
            // PvP damage
            if (player.pvpEnabled === true) {
              for (const otherPlayer of gameState.players.values()) {
                if (otherPlayer.id === player.id || otherPlayer.health <= 0) continue;
                if (distance(otherPlayer, { x: stormX, y: stormY }) < ult.radius) {
                  const pvpDmg = dmgPerWave * 0.6;
                  otherPlayer.health -= pvpDmg;
                  spawnDamageNumber(otherPlayer.x, otherPlayer.y - 20, Math.round(pvpDmg));
                  const otherSocket = io.sockets.sockets.get(otherPlayer.socketId);
                  if (otherSocket) otherSocket.emit('damaged', { amount: pvpDmg });
                  if (otherPlayer.health <= 0) {
                    otherPlayer.deaths = (otherPlayer.deaths || 0) + 1;
                    if (otherSocket) otherSocket.emit('died', { killedBy: 'Shadow Archer', deathMessage: 'Pierced by the storm!' });
                  }
                }
              }
            }
            
            wave++;
          }, ult.duration / ult.waves);
          
          io.emit('sound', { type: 'arrowStorm', x: stormX, y: stormY });
        } else {
          // Custom wizard ultimate - unique AOE burst with the wizard's own color/style
          const explosionX = tx ?? player.x;
          const explosionY = ty ?? player.y;
          const ultColor = player.color || player.secondaryColor || '#a78bfa';
          const ultName = ult.name || 'Custom Ultimate';
          
          // Show unique warning circle (NOT meteor)
          io.emit('customUltWarning', { 
            x: explosionX, y: explosionY, 
            radius: ult.radius, 
            delay: ult.delay || 1000,
            color: ultColor,
            name: ultName,
            playerId: player.id,
          });
          
          setTimeout(() => {
            for (const enemy of gameState.enemies.values()) {
              if (enemy.health <= 0) continue;
              if (ultPlayerInDungeon !== (enemy.isDungeon || false)) continue;
              if (distance(enemy, { x: explosionX, y: explosionY }) < ult.radius) {
                const dmg = Math.floor(ult.damage * (player.damageMultiplier || 1));
                enemy.health -= dmg;
                spawnDamageNumber(enemy.x, enemy.y - 20, dmg);
                checkEnemyDeath(enemy, player.id);
              }
            }
            io.emit('customUltExplosion', { 
              x: explosionX, y: explosionY, 
              radius: ult.radius, 
              color: ultColor,
              name: ultName,
            });
            spawnParticles(explosionX, explosionY, ultColor, 25);
            io.emit('sound', { type: 'customUlt', x: explosionX, y: explosionY });
          }, ult.delay || 1000);
        }
        
        socket.emit('ultimateUsed', { cooldown: ult.cooldown });
        break;
      }
    }
  });

  socket.on('respawn', () => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        const classData = CLASSES[player.class];
        player.health = player.maxHealth;
        // Spawn in center of sanctuary
        const sanctuaryCenter = getRandomPointInZone('sanctuary');
        player.x = sanctuaryCenter.x;
        player.y = sanctuaryCenter.y;
        player.state = 'idle';
        
        // Clear dungeon state on respawn
        if (player.inDungeon) {
          player.inDungeon = false;
          player.dungeonProgress = 0;
          player.dungeonRoom = 0;
          player.dungeonRoomCleared = -1;
          player.dragonSpawned = false;
          socket.emit('exitedDungeon', { x: player.x, y: player.y });
        }
        
        socket.emit('respawned', { health: player.health });
        break;
      }
    }
  });

  // Portal interaction (supports both sanctuary->zone and zone->sanctuary return portals)
  socket.on('usePortal', ({ portalId }) => {
    const isReturn = portalId.endsWith('_return');
    const baseId = isReturn ? portalId.replace('_return', '') : portalId;
    const portal = PORTALS[baseId];
    if (!portal) return;
    
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id && player.health > 0) {
        if (isReturn) {
          // Return portal: check if near returnFrom, teleport to returnTo
          if (!portal.returnFrom || !portal.returnTo) {
            socket.emit('portalError', { message: 'No return portal here' });
            break;
          }
          const distToReturn = distance(player, portal.returnFrom);
          if (distToReturn > 80) {
            socket.emit('portalError', { message: 'Too far from portal' });
            break;
          }
          const oldX = player.x;
          const oldY = player.y;
          player.x = portal.returnTo.x;
          player.y = portal.returnTo.y;
          socket.emit('portalUsed', {
            portalId,
            fromX: oldX, fromY: oldY,
            toX: portal.returnTo.x, toY: portal.returnTo.y,
            toZone: 'sanctuary',
            color: portal.color,
          });
          io.emit('sound', { type: 'portalEnter', x: oldX, y: oldY });
          io.emit('sound', { type: 'portalExit', x: portal.returnTo.x, y: portal.returnTo.y });
          console.log(`🌀 ${player.name} returned to sanctuary via ${baseId}`);
        } else {
          // Normal sanctuary->zone portal
          const distToPortal = distance(player, portal.from);
          if (distToPortal > 80) {
            socket.emit('portalError', { message: 'Too far from portal' });
            break;
          }
          if (player.level < portal.requiredLevel) {
            socket.emit('portalError', { message: `Requires level ${portal.requiredLevel}` });
            break;
          }
          const oldX = player.x;
          const oldY = player.y;
          player.x = portal.to.x;
          player.y = portal.to.y;
          socket.emit('portalUsed', {
            portalId,
            fromX: oldX, fromY: oldY,
            toX: portal.to.x, toY: portal.to.y,
            toZone: portal.toZone,
            color: portal.color,
          });
          io.emit('sound', { type: 'portalEnter', x: oldX, y: oldY });
          io.emit('sound', { type: 'portalExit', x: portal.to.x, y: portal.to.y });
          console.log(`🌀 ${player.name} used portal ${portalId} to ${portal.toZone}`);
        }
        break;
      }
    }
  });

  // Change skin
  socket.on('changeSkin', ({ skinId }) => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        const skin = SKINS[skinId];
        if (skin && skin.class === player.class && skin.requiredXp <= player.totalXp) {
          player.selectedSkin = skinId;
          socket.emit('skinChanged', { skinId, skin });
        } else {
          socket.emit('skinError', { message: 'Skin not unlocked or invalid' });
        }
        break;
      }
    }
  });

  // Buy upgrade from shop
  socket.on('buyUpgrade', ({ type, buildingId }) => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        // Building-to-upgrade mapping
        const buildingUpgradeMap = {
          forest_ruins: 'health',
          volcano_fortress: 'damage',
          ice_citadel: 'cooldown',
          void_shrine: 'speed',
          crystal_sanctum: 'attackSpeed',
        };
        
        // Verify the upgrade type matches the building
        if (buildingId && buildingUpgradeMap[buildingId] && buildingUpgradeMap[buildingId] !== type) {
          socket.emit('shopError', { message: 'This building does not offer that upgrade' });
          return;
        }
        
        // Boss-kill gating: must defeat zone boss to use building
        const buildingBossZone = {
          forest_ruins: 'forest',
          volcano_fortress: 'volcanic',
          ice_citadel: 'frozen',
          void_shrine: 'abyss',
          crystal_sanctum: 'crystal_caves',
        };
        if (buildingId && buildingBossZone[buildingId]) {
          const bossKills = player.bossKills || {};
          if (!bossKills[buildingBossZone[buildingId]]) {
            socket.emit('shopError', { message: 'You must defeat the zone boss first!' });
            return;
          }
        }
        
        const costs = {
          health: 500,
          damage: 750,
          speed: 600,
          cooldown: 1000,
          attackSpeed: 800,
        };
        
        const cost = costs[type];
        if (!cost) {
          socket.emit('shopError', { message: 'Invalid upgrade type' });
          return;
        }
        
        if (player.totalXp < cost) {
          socket.emit('shopError', { message: 'Not enough XP' });
          return;
        }
        
        // Deduct XP
        player.totalXp -= cost;
        
        // Initialize upgrades if not exist
        player.upgrades = player.upgrades || { health: 0, damage: 0, speed: 0, cooldown: 0, attackSpeed: 0 };
        
        // Apply upgrade
        if (type === 'health') {
          player.upgrades.health += 1;
          player.maxHealth += 5;
          player.health = Math.min(player.health + 5, player.maxHealth);
        } else if (type === 'damage') {
          player.upgrades.damage += 1;
          player.damageMultiplier = (player.damageMultiplier || 1) * 1.01;
        } else if (type === 'speed') {
          player.upgrades.speed += 1;
          player.speedMultiplier = (player.speedMultiplier || 1) * 1.01;
        } else if (type === 'cooldown') {
          player.upgrades.cooldown += 1;
          player.cooldownMultiplier = (player.cooldownMultiplier || 1) * 0.99;
        } else if (type === 'attackSpeed') {
          player.upgrades.attackSpeed += 1;
          player.attackSpeedMultiplier = (player.attackSpeedMultiplier || 1) * 0.98;
        }
        
        socket.emit('upgradePurchased', { 
          type, 
          totalXp: player.totalXp,
          upgrades: player.upgrades,
          damageMultiplier: player.damageMultiplier || 1,
          speedMultiplier: player.speedMultiplier || 1,
          cooldownMultiplier: player.cooldownMultiplier || 1,
          attackSpeedMultiplier: player.attackSpeedMultiplier || 1,
          maxHealth: player.maxHealth,
          health: player.health,
        });
        
        console.log(`💰 ${player.name} bought ${type} upgrade (cost: ${cost} XP)`);
        savePlayerToDb(player);
        break;
      }
    }
  });

  // Emote
  socket.on('emote', ({ type }) => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        player.emote = type;
        player.emoteStart = Date.now();
        io.emit('playerEmote', { playerId: player.id, type, x: player.x, y: player.y });
        
        // Clear emote after duration
        setTimeout(() => {
          if (player.emote === type) {
            player.emote = null;
            player.emoteStart = null;
          }
        }, 3000);
        break;
      }
    }
  });

  // Toggle auto-attack
  socket.on('toggleAutoAttack', () => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        player.autoAttack = player.autoAttack === false ? true : false;
        socket.emit('autoAttackToggled', { enabled: player.autoAttack !== false });
        break;
      }
    }
  });

  // Toggle PvP (Voidlord only)
  socket.on('togglePvP', () => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        // PvP classes can toggle PvP
        if (player.class === 'voidlord' || player.class === 'shadowarcher') {
          player.pvpEnabled = player.pvpEnabled === true ? false : true;
          socket.emit('pvpToggled', { enabled: player.pvpEnabled === true });
          console.log(`👹 ${player.name} PvP: ${player.pvpEnabled ? 'ON' : 'OFF'}`);
        }
        break;
      }
    }
  });
  
  // Toggle Invincibility (Admin Voidlord only)
  socket.on('toggleInvincible', () => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        // Only admin can toggle invincibility
        if (player.isAdmin) {
          player.invincible = !player.invincible;
          socket.emit('invincibleToggled', { enabled: player.invincible });
          console.log(`✨ ${player.name} Invincibility: ${player.invincible ? 'ON' : 'OFF'}`);
        }
        break;
      }
    }
  });

  // Class Ability (hotkey 1, 2, 3)
  socket.on('classAbility', ({ abilitySlot, targetX, targetY }) => {
    const tx = Number.isFinite(targetX) ? targetX : null;
    const ty = Number.isFinite(targetY) ? targetY : null;
    const now = Date.now();
    
    for (const player of gameState.players.values()) {
      if (player.socketId !== socket.id || player.health <= 0) continue;
      
      // Find the ability for this slot and class
      const abilityMap = {
        pyromancer: { 1: 'flameShield', 2: 'meteorStrike', 3: 'inferno' },
        cryomancer: { 1: 'frostNova', 2: 'iceLance', 3: 'glacialStorm' },
        arcanist: { 1: 'blink', 2: 'arcaneBarrage', 3: 'timeWarp' },
        stormcaller: { 1: 'staticField', 2: 'ballLightning', 3: 'thunderGod' },
        voidlord: { 1: 'voidRiftAbility', 2: 'soulDrain', 3: 'apocalypse' },
        shadowarcher: { 1: 'huntersMark', 2: 'multishot', 3: 'deathArrow' },
      };
      
      const levelReqs = { 1: 10, 2: 20, 3: 30 };
      
      // Check custom wizard abilities first
      let abilityId;
      if (player.isCustomWizard && player.customClassId) {
        const customWiz = gameState.customWizards.get(player.customClassId);
        if (customWiz?.classDef?.abilities) {
          abilityId = customWiz.classDef.abilities[abilitySlot];
        }
      }
      if (!abilityId) {
        abilityId = abilityMap[player.class]?.[abilitySlot];
      }
      
      if (!abilityId) {
        socket.emit('abilityError', { message: 'Invalid ability slot' });
        break;
      }
      
      const spell = SPELLS[abilityId];
      if (!spell) break;
      
      // Check level requirement
      if (player.level < levelReqs[abilitySlot]) {
        socket.emit('abilityError', { message: `Requires level ${levelReqs[abilitySlot]}` });
        break;
      }
      
      // Check cooldown
      const lastUse = player[`lastAbility${abilitySlot}`] || 0;
      if (now - lastUse < spell.cooldown) {
        socket.emit('abilityCooldown', { 
          slot: abilitySlot, 
          remaining: spell.cooldown - (now - lastUse) 
        });
        break;
      }
      
      player[`lastAbility${abilitySlot}`] = now;
      
      // Execute ability based on type
      const abilityPlayerInDungeon = player.inDungeon || false;
      
      if (abilityId === 'flameShield') {
        // Flame Shield - damage aura around self
        player.flameShieldUntil = now + spell.duration;
        io.emit('flameShieldStart', { playerId: player.id, x: player.x, y: player.y, duration: spell.duration });
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
        // Pulse damage every 500ms
        const pulseInterval = setInterval(() => {
          if (Date.now() > player.flameShieldUntil || player.health <= 0) {
            clearInterval(pulseInterval);
            return;
          }
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
            // DUNGEON ISOLATION
            if (abilityPlayerInDungeon !== (enemy.isDungeon || false)) continue;
            if (distance(enemy, player) < spell.radius) {
              const sDmg = Math.floor(spell.damage * (player.damageMultiplier || 1));
              enemy.health -= sDmg;
              spawnDamageNumber(enemy.x, enemy.y - 10, sDmg);
              checkEnemyDeath(enemy, player.id);
            }
          }
        }, 500);
        
      } else if (abilityId === 'meteorStrike') {
        // Meteor Strike - delayed AOE at target
        const meteorX = tx ?? player.x;
        const meteorY = ty ?? player.y;
        io.emit('meteorWarning', { x: meteorX, y: meteorY, radius: spell.radius, delay: spell.delay, color: '#ff4500' });
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
        setTimeout(() => {
          const msDmg = Math.floor(spell.damage * (player.damageMultiplier || 1));
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
            // DUNGEON ISOLATION
            if (abilityPlayerInDungeon !== (enemy.isDungeon || false)) continue;
            if (distance(enemy, { x: meteorX, y: meteorY }) < spell.radius) {
              enemy.health -= msDmg;
              spawnDamageNumber(enemy.x, enemy.y - 20, msDmg);
              checkEnemyDeath(enemy, player.id);
            }
          }
          io.emit('explosion', { x: meteorX, y: meteorY, radius: spell.radius, color: '#ff4500' });
          spawnParticles(meteorX, meteorY, '#ff4500', 25);
        }, spell.delay);
        
      } else if (abilityId === 'inferno') {
        // Inferno - massive AOE around self
        const infernoDmg = Math.floor(spell.damage * (player.damageMultiplier || 1));
        for (const enemy of gameState.enemies.values()) {
          if (enemy.health <= 0) continue;
          // DUNGEON ISOLATION
          if (abilityPlayerInDungeon !== (enemy.isDungeon || false)) continue;
          if (distance(enemy, player) < spell.radius) {
            enemy.health -= infernoDmg;
            spawnDamageNumber(enemy.x, enemy.y - 20, infernoDmg);
            checkEnemyDeath(enemy, player.id);
          }
        }
        io.emit('inferno', { x: player.x, y: player.y, radius: spell.radius });
        spawnParticles(player.x, player.y, '#ff0000', 40);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
      } else if (abilityId === 'frostNova') {
        // Frost Nova - freeze nearby enemies
        const frostDmg = Math.floor(spell.damage * (player.damageMultiplier || 1));
        for (const enemy of gameState.enemies.values()) {
          if (enemy.health <= 0) continue;
          // DUNGEON ISOLATION
          if (abilityPlayerInDungeon !== (enemy.isDungeon || false)) continue;
          if (distance(enemy, player) < spell.radius) {
            enemy.health -= frostDmg;
            enemy.frozenUntil = now + spell.freezeDuration;
            spawnDamageNumber(enemy.x, enemy.y - 20, frostDmg);
            checkEnemyDeath(enemy, player.id);
          }
        }
        io.emit('frostNova', { x: player.x, y: player.y, radius: spell.radius });
        spawnParticles(player.x, player.y, '#00ffff', 25);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
      } else if (abilityId === 'iceLance') {
        // Ice Lance - piercing projectile
        const dx = (tx ?? player.x + 100) - player.x;
        const dy = (ty ?? player.y) - player.y;
        const dir = normalize({ x: dx, y: dy });
        
        const proj = {
          id: uuidv4(),
          x: player.x,
          y: player.y,
          vx: dir.x * spell.speed,
          vy: dir.y * spell.speed,
          radius: spell.radius,
          damage: spell.damage,
          color: spell.color,
          trailColor: spell.trailColor,
          ownerId: player.id,
          ownerClass: player.class,
          spellId: abilityId,
          piercing: spell.piercing,
          hitEnemies: new Set(),
          slowEffect: spell.slowEffect,
          slowDuration: spell.slowDuration,
          range: spell.range,
          distanceTraveled: 0,
        };
        gameState.projectiles.set(proj.id, proj);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
      } else if (abilityId === 'glacialStorm') {
        // Glacial Storm - large persistent blizzard
        const stormX = tx ?? player.x;
        const stormY = ty ?? player.y;
        io.emit('glacialStorm', { x: stormX, y: stormY, radius: spell.radius, duration: spell.duration });
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
        const stormEnd = now + spell.duration;
        const stormInterval = setInterval(() => {
          if (Date.now() > stormEnd) {
            clearInterval(stormInterval);
            return;
          }
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
            // DUNGEON ISOLATION
            if (abilityPlayerInDungeon !== (enemy.isDungeon || false)) continue;
            if (distance(enemy, { x: stormX, y: stormY }) < spell.radius) {
              enemy.health -= spell.damage / 6; // Tick damage
              enemy.frozenUntil = Math.max(enemy.frozenUntil || 0, Date.now() + spell.freezeDuration);
              checkEnemyDeath(enemy, player.id);
            }
          }
        }, 1000);
        
      } else if (abilityId === 'blink') {
        // Blink - teleport
        const blinkDist = Math.min(spell.range, distance(player, { x: tx ?? player.x, y: ty ?? player.y }));
        const dir = normalize({ x: (tx ?? player.x + 100) - player.x, y: (ty ?? player.y) - player.y });
        const newX = clamp(player.x + dir.x * blinkDist, 50, WORLD.width - 50);
        const newY = clamp(player.y + dir.y * blinkDist, 50, WORLD.height - 50);
        
        io.emit('blink', { playerId: player.id, fromX: player.x, fromY: player.y, toX: newX, toY: newY });
        player.x = newX;
        player.y = newY;
        spawnParticles(newX, newY, '#9b5de5', 15);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
      } else if (abilityId === 'arcaneBarrage') {
        // Arcane Barrage - multiple homing missiles
        for (let i = 0; i < spell.projectileCount; i++) {
          setTimeout(() => {
            if (player.health <= 0) return;
            const spreadAngle = (i - 2) * 0.2;
            const dx = (tx ?? player.x + 100) - player.x;
            const dy = (ty ?? player.y) - player.y;
            const baseAngle = Math.atan2(dy, dx) + spreadAngle;
            
            const proj = {
              id: uuidv4(),
              x: player.x,
              y: player.y,
              vx: Math.cos(baseAngle) * spell.speed,
              vy: Math.sin(baseAngle) * spell.speed,
              radius: spell.radius,
              damage: spell.damage,
              color: spell.color,
              trailColor: spell.trailColor,
              ownerId: player.id,
              ownerClass: player.class,
              spellId: abilityId,
              homing: spell.homing,
              range: spell.range,
              distanceTraveled: 0,
            };
            gameState.projectiles.set(proj.id, proj);
          }, i * 100);
        }
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
      } else if (abilityId === 'timeWarp') {
        // Time Warp - speed and cooldown buff
        player.timeWarpUntil = now + spell.duration;
        player.speedMultiplier = spell.speedBoost;
        player.cooldownMultiplier = spell.cooldownReduction;
        io.emit('timeWarp', { playerId: player.id, duration: spell.duration });
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
        setTimeout(() => {
          player.speedMultiplier = 1;
          player.cooldownMultiplier = 1;
        }, spell.duration);
        
      } else if (abilityId === 'staticField') {
        // Static Field - AOE stun
        for (const enemy of gameState.enemies.values()) {
          if (enemy.health <= 0) continue;
          // DUNGEON ISOLATION
          if (abilityPlayerInDungeon !== (enemy.isDungeon || false)) continue;
          if (distance(enemy, player) < spell.radius) {
            enemy.health -= spell.damage;
            enemy.frozenUntil = now + spell.stunDuration;
            spawnDamageNumber(enemy.x, enemy.y - 20, spell.damage);
            checkEnemyDeath(enemy, player.id);
          }
        }
        io.emit('staticField', { x: player.x, y: player.y, radius: spell.radius });
        spawnParticles(player.x, player.y, '#ffff00', 20);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
      } else if (abilityId === 'ballLightning') {
        // Ball Lightning - slow powerful projectile
        const dx = (tx ?? player.x + 100) - player.x;
        const dy = (ty ?? player.y) - player.y;
        const dir = normalize({ x: dx, y: dy });
        
        const proj = {
          id: uuidv4(),
          x: player.x,
          y: player.y,
          vx: dir.x * spell.speed,
          vy: dir.y * spell.speed,
          radius: spell.radius,
          damage: spell.damage,
          color: spell.color,
          trailColor: spell.trailColor,
          ownerId: player.id,
          ownerClass: player.class,
          spellId: abilityId,
          piercing: spell.piercing,
          hitEnemies: new Set(),
          chainLightning: spell.chainLightning,
          range: spell.range,
          distanceTraveled: 0,
        };
        gameState.projectiles.set(proj.id, proj);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
      } else if (abilityId === 'thunderGod') {
        // Thunder God - massive chain lightning
        let hitCount = 0;
        const hitEnemies = new Set();
        let lastX = player.x, lastY = player.y;
        
        const chainNext = () => {
          if (hitCount >= spell.chainCount) return;
          
          let nearestEnemy = null;
          let nearestDist = 300;
          
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0 || hitEnemies.has(enemy.id)) continue;
            // DUNGEON ISOLATION
            if (abilityPlayerInDungeon !== (enemy.isDungeon || false)) continue;
            const dist = distance(enemy, { x: lastX, y: lastY });
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestEnemy = enemy;
            }
          }
          
          if (nearestEnemy) {
            hitEnemies.add(nearestEnemy.id);
            nearestEnemy.health -= spell.damage;
            io.emit('lightningBolt', { fromX: lastX, fromY: lastY, toX: nearestEnemy.x, toY: nearestEnemy.y });
            spawnDamageNumber(nearestEnemy.x, nearestEnemy.y - 20, spell.damage);
            checkEnemyDeath(nearestEnemy, player.id);
            lastX = nearestEnemy.x;
            lastY = nearestEnemy.y;
            hitCount++;
            setTimeout(chainNext, 100);
          }
        };
        
        io.emit('thunderGod', { x: player.x, y: player.y, radius: spell.radius });
        spawnParticles(player.x, player.y, '#ffffff', 50);
        chainNext();
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
      } else if (abilityId === 'voidRiftAbility') {
        // Void Rift - persistent damage zone
        const riftX = tx ?? player.x;
        const riftY = ty ?? player.y;
        io.emit('voidRift', { x: riftX, y: riftY, radius: spell.radius, duration: spell.duration });
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
        const riftEnd = now + spell.duration;
        const riftInterval = setInterval(() => {
          if (Date.now() > riftEnd) {
            clearInterval(riftInterval);
            return;
          }
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
            if (distance(enemy, { x: riftX, y: riftY }) < spell.radius) {
              enemy.health -= spell.damage / 4; // Tick damage
              spawnDamageNumber(enemy.x, enemy.y - 10, Math.floor(spell.damage / 4));
              checkEnemyDeath(enemy, player.id);
            }
          }
        }, 500);
        
      } else if (abilityId === 'soulDrain') {
        // Soul Drain - homing projectile with lifesteal
        const dx = (tx ?? player.x + 100) - player.x;
        const dy = (ty ?? player.y) - player.y;
        const dir = normalize({ x: dx, y: dy });
        
        const proj = {
          id: uuidv4(),
          x: player.x,
          y: player.y,
          vx: dir.x * spell.speed,
          vy: dir.y * spell.speed,
          radius: spell.radius,
          damage: spell.damage,
          color: spell.color,
          trailColor: spell.trailColor,
          ownerId: player.id,
          ownerClass: player.class,
          spellId: abilityId,
          homing: spell.homing,
          lifesteal: spell.lifesteal,
          range: spell.range,
          distanceTraveled: 0,
        };
        gameState.projectiles.set(proj.id, proj);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
      } else if (abilityId === 'apocalypse') {
        // Apocalypse - massive void explosion
        for (const enemy of gameState.enemies.values()) {
          if (enemy.health <= 0) continue;
          if (distance(enemy, player) < spell.radius) {
            enemy.health -= spell.damage;
            spawnDamageNumber(enemy.x, enemy.y - 20, spell.damage);
            checkEnemyDeath(enemy, player.id);
          }
        }
        io.emit('apocalypse', { x: player.x, y: player.y, radius: spell.radius });
        spawnParticles(player.x, player.y, '#8b00ff', 60);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
      } else if (abilityId === 'huntersMark') {
        // Hunter's Mark - fast piercing arrow
        const facing = player.facing || 'right';
        const dirs = { up: {x:0,y:-1}, down: {x:0,y:1}, left: {x:-1,y:0}, right: {x:1,y:0} };
        const dir = dirs[facing] || dirs.right;
        gameState.projectiles.set(uuidv4(), {
          x: player.x, y: player.y,
          vx: dir.x * spell.speed, vy: dir.y * spell.speed,
          damage: spell.damage * (player.damageMultiplier || 1),
          radius: spell.radius,
          ownerId: player.id,
          spellId: 'huntersMark',
          ownerClass: player.class,
          color: spell.color,
          trailColor: spell.trailColor,
          lifetime: spell.range / spell.speed * 1000,
          createdAt: Date.now(),
          piercing: true,
          canHitPlayers: true,
          isArrow: true,
        });
        spawnParticles(player.x, player.y, '#dc2626', 6);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
      } else if (abilityId === 'multishot') {
        // Multishot - arrows in all directions
        const numArrows = 12;
        for (let i = 0; i < numArrows; i++) {
          const angle = (i / numArrows) * Math.PI * 2;
          const speed = 600;
          gameState.projectiles.set(uuidv4(), {
            x: player.x, y: player.y,
            vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            damage: spell.damage * (player.damageMultiplier || 1),
            radius: 6,
            ownerId: player.id,
            spellId: 'multishot',
            ownerClass: player.class,
            color: '#dc2626',
            trailColor: '#991b1b',
            lifetime: 800,
            createdAt: Date.now(),
            piercing: true,
            canHitPlayers: true,
            isArrow: true,
          });
        }
        io.emit('multishot', { x: player.x, y: player.y });
        spawnParticles(player.x, player.y, '#dc2626', 30);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
      } else if (abilityId === 'deathArrow') {
        // Death Arrow - devastating single shot
        const facing = player.facing || 'right';
        const dirs = { up: {x:0,y:-1}, down: {x:0,y:1}, left: {x:-1,y:0}, right: {x:1,y:0} };
        const dir = dirs[facing] || dirs.right;
        gameState.projectiles.set(uuidv4(), {
          x: player.x, y: player.y,
          vx: dir.x * spell.speed, vy: dir.y * spell.speed,
          damage: spell.damage * (player.damageMultiplier || 1),
          radius: spell.radius,
          ownerId: player.id,
          spellId: 'deathArrow',
          ownerClass: player.class,
          color: spell.color,
          trailColor: spell.trailColor,
          lifetime: spell.range / spell.speed * 1000,
          createdAt: Date.now(),
          piercing: true,
          canHitPlayers: true,
          isArrow: true,
        });
        spawnParticles(player.x, player.y, '#000', 10);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
      } else if (spell.type === 'classAbility') {
        // Generic custom wizard ability - AOE damage burst
        const abilityDmg = spell.damage * (player.damageMultiplier || 1);
        const abilityRadius = spell.radius || 150;
        
        // Deal damage to nearby enemies
        for (const enemy of gameState.enemies.values()) {
          if (enemy.health <= 0) continue;
          if (abilityPlayerInDungeon !== (enemy.isDungeon || false)) continue;
          if (distance(enemy, player) < abilityRadius) {
            enemy.health -= abilityDmg;
            if (enemy.health <= 0) {
              checkEnemyDeath(enemy, player.id);
            }
          }
        }
        
        // Broadcast visual effect to all players
        io.emit('customAbilityEffect', {
          playerId: player.id,
          x: player.x,
          y: player.y,
          radius: abilityRadius,
          color: spell.color || player.color || '#a78bfa',
          name: spell.name,
          duration: spell.duration || 3000,
        });
        
        spawnParticles(player.x, player.y, spell.color || '#a78bfa', 15);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
      }
      
      break;
    }
  });

  // NPC Interaction
  socket.on('interactNpc', ({ npcId }) => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        const npc = gameState.npcs.get(npcId);
        if (!npc) {
          socket.emit('npcError', { message: 'NPC not found' });
          return;
        }
        
        // Check distance
        const dist = Math.sqrt(
          Math.pow(player.x - npc.currentX, 2) + 
          Math.pow(player.y - npc.currentY, 2)
        );
        
        if (dist > npc.interactRange + 20) {
          socket.emit('npcError', { message: 'Too far away' });
          return;
        }
        
        // Handle different NPC types
        if (npc.type === 'guide') {
          // Ethereal Guide - random greeting
          const greeting = npc.greetings[Math.floor(Math.random() * npc.greetings.length)];
          socket.emit('npcDialogue', {
            npcId: npc.id,
            npcName: npc.name,
            npcType: npc.type,
            dialogue: [greeting],
            hasChoice: false,
          });
        } else if (npc.type === 'knight') {
          // Knight Commander - dungeon entrance
          socket.emit('npcDialogue', {
            npcId: npc.id,
            npcName: npc.name,
            npcType: npc.type,
            dialogue: npc.dialogues.initial,
            followUp: npc.dialogues.warning,
            prompt: npc.dialogues.prompt,
            hasChoice: true,
            playerLevel: player.level,
            recommendedLevel: 30,
          });
        } else if (npc.type === 'quest_master') {
          // Quest Master Seraphina - quest giver
          const bossKills = player.bossKills || {};
          const defeatedCount = Object.keys(bossKills).length;
          
          if (defeatedCount >= 6) {
            // Quest complete
            socket.emit('npcDialogue', {
              npcId: npc.id,
              npcName: npc.name,
              npcType: npc.type,
              dialogue: [npc.dialogues.questComplete],
              hasChoice: false,
            });
          } else if (player.questActive) {
            // Quest already active
            socket.emit('npcDialogue', {
              npcId: npc.id,
              npcName: npc.name,
              npcType: npc.type,
              dialogue: [npc.dialogues.questActive],
              followUp: [`Progress: ${defeatedCount}/6 bosses defeated`],
              hasChoice: false,
            });
          } else {
            // Offer quest
            socket.emit('npcDialogue', {
              npcId: npc.id,
              npcName: npc.name,
              npcType: npc.type,
              dialogue: npc.dialogues.initial,
              followUp: npc.dialogues.questOffer,
              prompt: npc.dialogues.prompt,
              hasChoice: true,
            });
          }
        } else if (npc.type === 'shapeshifter') {
          // Shapeshifter - skin changer
          const greeting = npc.greetings[Math.floor(Math.random() * npc.greetings.length)];
          const currentForm = npc.forms[npc.currentFormIndex || 0];
          socket.emit('npcDialogue', {
            npcId: npc.id,
            npcName: npc.name,
            npcType: npc.type,
            dialogue: [greeting],
            prompt: npc.skinPrompt,
            hasChoice: true,
            emoji: currentForm?.emoji || '🦋',
            openSkinSelect: true, // Special flag to open skin selector
          });
        } else if (npc.type === 'dungeon_architect') {
          // Dungeon Architect - open dungeon workshop
          const greeting = npc.greetings[Math.floor(Math.random() * npc.greetings.length)];
          socket.emit('npcDialogue', {
            npcId: npc.id,
            npcName: npc.name,
            npcType: npc.type,
            dialogue: [greeting],
            prompt: 'What would you like to do?',
            hasChoice: true,
            openDungeonBrowser: true,
          });
        }
        break;
      }
    }
  });

  // Enter Dungeon
  socket.on('enterDungeon', () => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        const knight = gameState.npcs.get('knight_commander');
        if (!knight) return;
        
        // Check distance from knight
        const dist = Math.sqrt(
          Math.pow(player.x - knight.currentX, 2) + 
          Math.pow(player.y - knight.currentY, 2)
        );
        
        if (dist > knight.interactRange + 50) {
          socket.emit('npcError', { message: 'Return to Knight Commander Aldric to enter' });
          return;
        }
        
        // Level check (warning only, still allow entry)
        if (player.level < 30) {
          socket.emit('dungeonWarning', { 
            message: "The Knight warned you... but you enter anyway.",
            recommendedLevel: 30,
            playerLevel: player.level,
          });
        }
        
        // Store pre-dungeon position
        player.preDungeonX = player.x;
        player.preDungeonY = player.y;
        
        // Transport to dungeon - starts in entrance chamber
        player.x = 900;  // Center of wider entrance chamber
        player.y = 350;  // Near entrance
        player.inDungeon = true;
        player.dungeonProgress = 0;
        player.dungeonWaveSpawned = 0;
        player.dungeonRoom = 0; // Track which room they're in
        player.dungeonRoomCleared = -1; // Reset room progress
        player.dragonSpawned = false; // Dragon spawns when player reaches lair
        
        // Spawn initial wave of enemies (NOT dragon - it spawns when reaching lair)
        spawnDungeonEnemies(player);
        
        socket.emit('enteredDungeon', {
          x: player.x,
          y: player.y,
          zone: 'dungeon',
        });
        
        console.log(`⚔️ ${player.name} entered the Dragon's Gauntlet!`);
        
        // Broadcast to others
        io.emit('chat', {
          type: 'system',
          text: `⚔️ ${player.name} has entered the Dragon's Gauntlet!`,
        });
        break;
      }
    }
  });

  // Exit Dungeon (return to previous position or sanctuary)
  socket.on('exitDungeon', () => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id && player.inDungeon) {
        // Return to where they were before entering, or sanctuary if not stored
        player.x = player.preDungeonX || 10500;
        player.y = player.preDungeonY || 9000;
        player.inDungeon = false;
        player.dungeonProgress = 0;
        player.dungeonRoom = 0;
        player.customDungeonId = null; // Clear custom dungeon
        player.customDungeonConfig = null;
        
        socket.emit('exitedDungeon', {
          x: player.x,
          y: player.y,
        });
        break;
      }
    }
  });

  // ===========================================
  // CUSTOM DUNGEON EVENTS
  // ===========================================

  // Create a custom dungeon via prompt (admin = LLM, others = procedural)
  socket.on('createCustomDungeon', async ({ prompt }) => {
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      socket.emit('customDungeonError', { message: 'Please describe your dungeon idea (at least 3 characters).' });
      return;
    }

    const player = getPlayerBySocket(socket.id);
    if (!player) return;
    
    // Admin-only for now (LLM gated)
    if (!player.isAdmin) {
      // Non-admin: use procedural
      try {
        const config = generateDungeon(prompt.trim(), player.name, player.id);
        gameState.customDungeons.set(config.id, config);
        if (gameState.customDungeons.size > 50) {
          const oldest = [...gameState.customDungeons.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
          if (oldest) gameState.customDungeons.delete(oldest[0]);
        }
        socket.emit('customDungeonCreated', { dungeon: sanitizeDungeonForClient(config) });
        io.emit('chat', { type: 'system', text: `🏗️ ${player.name} created a new dungeon: "${config.name}" [${config.difficulty}]` });
      } catch (err) {
        socket.emit('customDungeonError', { message: err.message || 'Failed to generate dungeon.' });
      }
      return;
    }

    // Admin: use LLM-powered generation
    try {
      socket.emit('customDungeonStatus', { message: '🤖 AI is designing your dungeon...' });
      const config = await generateDungeonLLM(prompt.trim(), player.name, player.id);
      
      gameState.customDungeons.set(config.id, config);
      if (gameState.customDungeons.size > 50) {
        const oldest = [...gameState.customDungeons.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
        if (oldest) gameState.customDungeons.delete(oldest[0]);
      }

      socket.emit('customDungeonCreated', { dungeon: sanitizeDungeonForClient(config) });
      
      const aiTag = config.aiGenerated ? ' 🤖' : '';
      io.emit('chat', { type: 'system', text: `🏗️ ${player.name} created a new dungeon: "${config.name}" [${config.difficulty}]${aiTag}` });
      console.log(`🏗️ Custom dungeon created: "${config.name}" by ${player.name} (AI: ${!!config.aiGenerated})`);
    } catch (err) {
      socket.emit('customDungeonError', { message: err.message || 'Failed to generate dungeon.' });
    }
  });

  // ===========================================
  // AI WIZARD CREATOR - Custom class generation for all players
  // ===========================================
  // Rate limit tracking for wizard generation
  const wizardRateLimits = {};
  
  socket.on('generateWizard', async ({ prompt, sessionToken }) => {
    // Check admin status (for "Play as" feature later)
    let isAdmin = isAdminSocket(io, socket.id);
    if (!isAdmin && sessionToken && sessionsDb[sessionToken]) {
      const session = sessionsDb[sessionToken];
      if (!session.isGuest && session.userId) {
        const user = await loadUserFromDb(session.userId);
        if (user?.username?.toLowerCase() === 'azoni') {
          isAdmin = true;
          socket.isAdmin = true;
        }
      }
    }
    
    // Rate limit: non-admin users get 5 generations per 10 minutes
    if (!isAdmin) {
      const now = Date.now();
      const key = sessionToken || socket.id;
      if (!wizardRateLimits[key]) wizardRateLimits[key] = [];
      // Clean old entries
      wizardRateLimits[key] = wizardRateLimits[key].filter(t => now - t < 600000);
      if (wizardRateLimits[key].length >= 8) {
        socket.emit('wizardGenerateError', { message: 'Rate limit reached. Please wait a few minutes before generating again.' });
        return;
      }
      wizardRateLimits[key].push(now);
    }
    
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      socket.emit('wizardGenerateError', { message: 'Please describe your wizard idea (at least 3 characters).' });
      return;
    }

    // Player may not exist yet if generating from title screen
    const player = getPlayerBySocket(socket.id);
    const creatorName = player?.name || 'Admin';

    try {
      socket.emit('wizardGenerateStatus', { message: '🧙 Crafting your wizard class with AI...' });
      const result = await generateWizard(prompt.trim());

      if (result.error) {
        socket.emit('wizardGenerateError', { message: result.error });
        return;
      }

      // Store the custom wizard class + spells
      gameState.customWizards.set(result.classId, {
        classDef: result.classDef,
        spellDefs: result.spellDefs,
        createdBy: creatorName,
        createdAt: Date.now(),
      });
      console.log(`🧙 Custom wizard stored: classId=${result.classId}, total stored: ${gameState.customWizards.size}`);

      // Cap stored wizards to 50
      if (gameState.customWizards.size > 50) {
        const oldest = [...gameState.customWizards.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
        if (oldest) gameState.customWizards.delete(oldest[0]);
      }

      console.log(`🧙 Custom wizard created: "${result.classDef.name}" by ${creatorName}`);

      // Send back the generated wizard info to the client
      socket.emit('wizardGenerated', {
        classId: result.classId,
        classDef: result.classDef,
        spellDefs: result.spellDefs,
      });
    } catch (err) {
      console.error('Wizard generation error:', err);
      socket.emit('wizardGenerateError', { message: 'Failed to generate wizard. Please try again.' });
    }
  });

  // Select a custom AI wizard class for current character
  socket.on('selectCustomWizard', async ({ classId, sessionToken }) => {
    console.log(`🧙 selectCustomWizard received: classId=${classId}, socketId=${socket.id}`);
    const player = getPlayerBySocket(socket.id);
    if (!player) {
      console.log('🧙 selectCustomWizard failed: player not found');
      return;
    }

    const wizard = gameState.customWizards.get(classId);
    if (!wizard) {
      console.log(`🧙 selectCustomWizard failed: wizard not found. Available: ${[...gameState.customWizards.keys()].join(', ')}`);
      socket.emit('wizardGenerateError', { message: 'Custom wizard not found. It may have expired.' });
      return;
    }

    // Apply the custom class to the player
    const cls = wizard.classDef;
    player.class = classId;
    player.className = cls.name;
    player.color = cls.color;
    player.secondaryColor = cls.secondaryColor || cls.color;
    player.maxHealth = cls.baseHealth;
    player.health = cls.baseHealth;
    player.baseSpeed = cls.baseSpeed;
    player.spells = cls.spells;
    player.dashAbility = cls.dashAbility;
    player.ultimateAbility = cls.ultimateAbility;
    player.isCustomWizard = true;
    player.customClassId = classId;

    // Register the custom spells in the global SPELLS lookup so combat works
    for (const [spellId, spellDef] of Object.entries(wizard.spellDefs)) {
      SPELLS[spellId] = spellDef;
    }

    console.log(`🧙 ${player.name} switched to custom wizard: ${cls.name}`);
    socket.emit('wizardApplied', { classId, className: cls.name });
    
    io.emit('chat', {
      type: 'system',
      text: `🧙 ${player.name} transformed into a ${cls.name}!`,
    });
  });

  // List available custom dungeons
  socket.on('listCustomDungeons', () => {
    const dungeons = [...gameState.customDungeons.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map(sanitizeDungeonForClient);
    socket.emit('customDungeonList', { dungeons });
  });

  // Enter a custom dungeon
  socket.on('enterCustomDungeon', ({ dungeonId }) => {
    const config = gameState.customDungeons.get(dungeonId);
    if (!config) {
      socket.emit('customDungeonError', { message: 'Dungeon not found.' });
      return;
    }

    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        // Store pre-dungeon position
        player.preDungeonX = player.x;
        player.preDungeonY = player.y;

        // Transport to custom dungeon entrance
        const layout = config.layout;
        player.x = layout.width / 2;
        player.y = 350;
        player.inDungeon = true;
        player.dungeonProgress = 0;
        player.dungeonWaveSpawned = 0;
        player.dungeonRoom = 0;
        player.dungeonRoomCleared = -1;
        player.dragonSpawned = false;
        player.customDungeonId = config.id;
        player.customDungeonConfig = config;

        // Increment play count
        config.plays++;

        socket.emit('enteredDungeon', {
          x: player.x,
          y: player.y,
          zone: 'dungeon',
          customDungeon: sanitizeDungeonForClient(config),
        });

        io.emit('chat', {
          type: 'system',
          text: `⚔️ ${player.name} entered "${config.name}" (${config.difficulty})!`,
        });

        console.log(`⚔️ ${player.name} entered custom dungeon: "${config.name}"`);
        break;
      }
    }
  });

  // Get player data (for character select)
  socket.on('getPlayerData', async ({ playerId, playerName, sessionToken }) => {
    let saved = playerId ? await loadPlayerFromDb(playerId) : null;
    
    // OWNERSHIP CHECK: Only return character data if caller owns it
    if (saved && playerId) {
      let ownsCharacter = false;
      if (sessionToken && sessionsDb[sessionToken]) {
        const sess = sessionsDb[sessionToken];
        if (!sess.isGuest && sess.userId) {
          const usr = await loadUserFromDb(sess.userId);
          if (usr?.characters?.includes(playerId)) {
            ownsCharacter = true;
          }
        } else if (sess.isGuest && sess.guestId) {
          ownsCharacter = (saved.guestId === sess.guestId);
        }
      }
      if (!ownsCharacter) {
        console.log(`⛔ getPlayerData ownership check failed for ${playerId}`);
        saved = null;
      }
    }
    
    if (saved) {
      const totalXp = saved.totalXp || 0;
      const rank = RANKS.reduce((best, r) => totalXp >= r.xp ? r : best, RANKS[0]);
      
      // Get unlocked skins for this class
      const unlockedSkins = Object.values(SKINS)
        .filter(s => s.class === saved.class && s.requiredXp <= totalXp)
        .map(s => s.id);
      
      socket.emit('playerData', {
        player: {
          ...saved,
          rank,
          unlockedSkins,
        },
        skins: Object.values(SKINS).filter(s => s.class === saved.class),
      });
    } else {
      socket.emit('playerData', { player: null });
    }
  });
  
  // Heartbeat handler - keeps connection alive and updates lastActivity
  socket.on('heartbeat', () => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        player.lastActivity = Date.now();
        break;
      }
    }
  });

  // Handle explicit leave (player clicked "Return to Menu")
  socket.on('leave', () => {
    let found = false;
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        console.log(`🚪 Player leaving: ${player.name}`);
        
        // Exit dungeon if in one
        if (player.inDungeon) {
          player.inDungeon = false;
          player.dungeonProgress = 0;
          player.dungeonRoom = 0;
          player.customDungeonId = null;
          player.customDungeonConfig = null;
          player.x = player.preDungeonX || 10500;
          player.y = player.preDungeonY || 9000;
        }
        
        // Save and remove
        savePlayerToDb(player);
        gameState.players.delete(player.id);
        found = true;
        
        // Broadcast leave
        const leaveMsg = {
          id: uuidv4(),
          type: 'system',
          text: `${player.name} has left the game`,
          timestamp: Date.now(),
        };
        gameState.chatMessages.push(leaveMsg);
        if (gameState.chatMessages.length > 50) gameState.chatMessages.shift();
        io.emit('chatMessage', leaveMsg);
        
        break;
      }
    }
    // Always confirm leave so client can safely re-join
    socket.emit('left', { success: true, wasInGame: found });
  });

  socket.on('disconnect', () => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        // Broadcast leave message
        const leaveMsg = {
          id: uuidv4(),
          type: 'system',
          text: `${player.name} has left the game`,
          timestamp: Date.now(),
        };
        gameState.chatMessages.push(leaveMsg);
        if (gameState.chatMessages.length > 50) gameState.chatMessages.shift();
        io.emit('chatMessage', leaveMsg);
        
        savePlayerToDb(player); // Fire and forget - async save to Firebase
        gameState.players.delete(player.id);
        console.log(`👋 Player disconnected: ${player.name} (saved)`);
        break;
      }
    }
  });
});
}
