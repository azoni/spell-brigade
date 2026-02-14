import { v4 as uuidv4 } from 'uuid';
import gameState from '../state.js';
import {
  WORLD, ZONES, SANCTUARY_CENTER, SANCTUARY_RADIUS, SANCTUARY_BUFFER, PORTALS, BUILDINGS, SECRETS,
  getZoneAtPosition, getRandomPointInZone, isTooCloseToSanctuary, pointInPolygon
} from '../config/world.js';
import { ENEMY_TYPES, ZONE_BOSS_TYPES } from '../config/enemies.js';
import { CLASSES } from '../config/classes.js';
import { SPELLS } from '../config/spells.js';
import { MAX_ENEMIES, TICK_RATE, VIEW_DISTANCE, XP_ORB } from '../config/constants.js';
import { COLLECT_QUESTS } from '../config/npcs.js';
import { respawnCollectible } from '../state.js';
import { getDungeonRoom, getDungeonBounds, getRoomEnemies, getRoomCenterY } from '../dungeon-generator.js';
import {
  distance, normalize, clamp, xpForLevel, lerp,
  spawnXpOrb, spawnDamageNumber, spawnParticles, getPlayerBySocket
} from './helpers.js';
import {
  spawnEnemyInZone, spawnZoneBoss, spawnEnemy, spawnDungeonEnemies,
  spawnDragonBoss, spawnCustomBoss, onBossDeath, createProjectile,
  BOSS_RESPAWN_TIME
} from './enemies.js';
import { savePlayerToDb, getUnlockedSkins } from '../db/index.js';

const TICK_INTERVAL = 1000 / TICK_RATE;

// Check if a dungeon enemy and player are in the same dungeon instance
function isSameDungeon(enemy, player) {
  if (!enemy.isDungeon) return true;
  return (enemy.dungeonId || 'default') === (player.customDungeonId || 'default');
}

// io reference - set via init()
let io = null;

export function initTickSystem(ioRef) {
  io = ioRef;
}

export function gameTick() {
  const now = Date.now();
  const dt = Math.min((now - gameState.lastTick) / 1000, 0.1); // Cap delta time
  gameState.lastTick = now;
  gameState.tickCount++;

  const alivePlayers = [...gameState.players.values()].filter(p => p.health > 0);

  // --- UPDATE PLAYERS ---
  for (const player of gameState.players.values()) {
    if (player.health <= 0) continue;

    // Track play time
    player.playTime = (player.playTime || 0) + dt;

    // Movement
    let dx = 0, dy = 0;
    let isKeyboardMoving = false;
    
    // Keyboard input takes priority
    if (player.input) {
      if (player.input.up) dy -= 1;
      if (player.input.down) dy += 1;
      if (player.input.left) dx -= 1;
      if (player.input.right) dx += 1;
      isKeyboardMoving = dx !== 0 || dy !== 0;
    }
    
    // Click to move (if no keyboard input)
    if (!isKeyboardMoving && player.clickTarget) {
      const distToTarget = Math.sqrt(
        Math.pow(player.clickTarget.x - player.x, 2) + 
        Math.pow(player.clickTarget.y - player.y, 2)
      );
      
      if (distToTarget > 10) {
        // Move towards target
        dx = player.clickTarget.x - player.x;
        dy = player.clickTarget.y - player.y;
      } else {
        // Reached target, clear it
        player.clickTarget = null;
      }
    }

    const isMoving = dx !== 0 || dy !== 0;
    player.state = isMoving ? 'walk' : 'idle';

    if (isMoving) {
      const move = normalize({ x: dx, y: dy });
      // Use player's stored baseSpeed (includes level bonus) and apply speedMultiplier from upgrades
      const baseSpeed = player.baseSpeed || CLASSES[player.class]?.baseSpeed || 150;
      let speedMult = player.speedMultiplier || 1;
      // Temporary speed boost (e.g. Protein Shake)
      if (player.speedBoostUntil && player.speedBoostUntil > Date.now()) {
        speedMult *= (player.speedBoostMultiplier || 1);
      }
      // Fountain speed boost (2x for 10s after leaving fountain)
      if (player.fountainSpeedBoostUntil && player.fountainSpeedBoostUntil > Date.now() && !player.inFountain) {
        speedMult *= 2.0;
      }
      const SPEED_CAP = 350; // Max effective speed
      const speed = Math.min(baseSpeed * speedMult, player.isAdmin ? 999 : SPEED_CAP);
      
      player.x += move.x * speed * dt;
      player.y += move.y * speed * dt;
      
      // Update facing direction
      if (Math.abs(dx) > Math.abs(dy)) {
        player.facing = dx > 0 ? 'right' : 'left';
      } else {
        player.facing = dy > 0 ? 'down' : 'up';
      }

      player.x = clamp(player.x, 20, WORLD.width - 20);
      player.y = clamp(player.y, 20, WORLD.height - 20);
      
      // Dungeon-specific bounds - room-based layout
      // Dungeon is 1800 wide x 6000 tall (expanded)
      if (player.inDungeon) {
        const y = player.y;
        const cfg = player.customDungeonConfig;
        
        if (cfg) {
          // CUSTOM DUNGEON - use config-driven bounds
          const bounds = getDungeonBounds(cfg, y);
          player.x = clamp(player.x, bounds.minX, bounds.maxX);
          player.y = clamp(player.y, 50, cfg.layout.totalHeight - 100);
          
          // Track room from config
          player.dungeonRoom = getDungeonRoom(cfg, y);
        } else {
          // DEFAULT DUNGEON - hardcoded layout
          let minX = 50, maxX = 1750;
          if (y < 500) {
            minX = 400; maxX = 1400;
          } else if (y < 700 || (y >= 1500 && y < 1700) || (y >= 2500 && y < 2700) || 
                     (y >= 3500 && y < 3700) || (y >= 4500 && y < 4700)) {
            minX = 550; maxX = 1250;
          } else if (y >= 5000) {
            minX = 50; maxX = 1750;
          } else {
            minX = 200; maxX = 1600;
          }
          
          player.x = clamp(player.x, minX, maxX);
          player.y = clamp(player.y, 50, 5900);
          
          if (y < 500) player.dungeonRoom = 0;
          else if (y < 1500) player.dungeonRoom = 1;
          else if (y < 2500) player.dungeonRoom = 2;
          else if (y < 3500) player.dungeonRoom = 3;
          else if (y < 4500) player.dungeonRoom = 4;
          else if (y < 5000) player.dungeonRoom = 5;
          else player.dungeonRoom = 6;
        }
      }
    }
    
    // Dungeon wave spawning based on depth
    if (player.inDungeon) {
      const currentRoom = player.dungeonRoom || 0;
      const lastRoom = player.dungeonRoomCleared || -1;
      const cfg = player.customDungeonConfig;
      
      if (cfg) {
        // ===== CUSTOM DUNGEON SPAWNING =====
        // Boss room (roomIndex === -1)
        if (currentRoom === -1 && !player.dragonSpawned) {
          player.dragonSpawned = true; // reuse flag for "boss spawned"
          spawnCustomBoss(cfg, player);
          io.emit('chat', { type: 'system', text: `⚔️ ${player.name} has reached the final chamber! ${cfg.boss.name.toUpperCase()} AWAKENS!` });
          io.emit('dragonAwakens', { x: cfg.layout.bossCenter.x, y: cfg.layout.bossCenter.y });
        }
        
        // Room enemies (positive roomIndex)
        if (currentRoom > lastRoom && currentRoom > 0) {
          player.dungeonRoomCleared = currentRoom;
          const enemies = getRoomEnemies(cfg, currentRoom);
          const centerY = getRoomCenterY(cfg, currentRoom);
          const depthMultiplier = cfg.difficultyMultiplier * (1 + currentRoom * 0.2);
          
          for (const type of enemies) {
            const template = ENEMY_TYPES[type];
            if (!template) continue;
            const spawnX = 400 + Math.random() * 1000;
            const spawnY = centerY + (Math.random() - 0.5) * 400;
            const enemy = {
              id: uuidv4(), type, name: template.name,
              health: Math.round(template.health * depthMultiplier),
              maxHealth: Math.round(template.health * depthMultiplier),
              baseSpeed: template.speed, damage: Math.round(template.damage * depthMultiplier),
              radius: template.radius, xp: Math.round(template.xp * depthMultiplier),
              color: template.color, behavior: template.behavior,
              x: spawnX, y: spawnY, spawnX, spawnY,
              zone: 'dungeon', targetId: null, slowedUntil: 0, lastAttack: 0,
              createdAt: Date.now(), inDungeon: true, isDungeon: true,
              dungeonId: cfg.id,
              isMiniBoss: template.isMiniBoss || false,
              chargeSpeed: template.chargeSpeed, chargeDistance: template.chargeDistance,
              attackCooldown: template.attackCooldown, summonCount: template.summonCount,
            };
            gameState.enemies.set(enemy.id, enemy);
          }
          console.log(`🏰 Custom room ${currentRoom} spawned for ${player.name}`);
        }
      } else {
        // ===== DEFAULT DRAGON'S GAUNTLET SPAWNING =====
      // Spawn dragon when entering dragon lair (room 6)
      if (currentRoom === 6 && !player.dragonSpawned) {
        player.dragonSpawned = true;
        spawnDragonBoss();
        
        // Announce dragon encounter
        io.emit('chat', {
          type: 'system',
          text: `🐉 ${player.name} has entered the Dragon's Lair! THE INFERNAL DRAGON AWAKENS!`,
        });
        
        // Screen shake for nearby dungeon players
        io.emit('dragonAwakens', { x: 900, y: 5500 });
      }
      
      // Spawn enemies when entering a new room (not entrance or dragon lair)
      if (currentRoom > lastRoom && currentRoom > 0 && currentRoom < 6) {
        player.dungeonRoomCleared = currentRoom;
        
        // Room-specific enemy spawning - includes mini-bosses in rooms 2 and 4
        const roomEnemies = {
          1: ['dungeon_skeleton', 'dungeon_skeleton', 'dungeon_skeleton', 'dungeon_wraith', 'dungeon_skeleton'],
          2: ['dungeon_wraith', 'dungeon_wraith', 'dungeon_skeleton', 'dungeon_skeleton', 'dungeon_minotaur'], // Mini-boss: Minotaur
          3: ['dungeon_golem', 'dungeon_golem', 'dungeon_wraith', 'dungeon_wraith', 'dungeon_golem'],
          4: ['dungeon_demon', 'dungeon_demon', 'dungeon_golem', 'dungeon_golem', 'dungeon_lich'], // Mini-boss: Lich
          5: ['dungeon_demon', 'dungeon_demon', 'dungeon_demon', 'dungeon_golem', 'dungeon_golem', 'dungeon_wraith'],
        };
        
        const enemies = roomEnemies[currentRoom] || ['dungeon_skeleton'];
        const roomY = {
          1: 1100, // Skeleton room center
          2: 2100, // Wraith room center - has Minotaur
          3: 3100, // Golem room center
          4: 4100, // Demon room center - has Lich
          5: 4800, // Shadow hall
        };
        
        const depthMultiplier = 1 + currentRoom * 0.25;
        
        for (let i = 0; i < enemies.length; i++) {
          const type = enemies[i];
          const template = ENEMY_TYPES[type];
          if (!template) continue;
          
          const spawnX = 400 + Math.random() * 1000; // Wider spawn area for expanded dungeon
          const spawnY = roomY[currentRoom] + (Math.random() - 0.5) * 400; // Larger vertical spread
          
          const enemy = {
            id: uuidv4(),
            type: type,
            name: template.name,
            health: Math.round(template.health * depthMultiplier),
            maxHealth: Math.round(template.health * depthMultiplier),
            baseSpeed: template.speed,
            damage: Math.round(template.damage * depthMultiplier),
            radius: template.radius,
            xp: Math.round(template.xp * depthMultiplier),
            color: template.color,
            behavior: template.behavior,
            x: spawnX,
            y: spawnY,
            spawnX: spawnX,
            spawnY: spawnY,
            zone: 'dungeon',
            targetId: null,
            slowedUntil: 0,
            lastAttack: 0,
            createdAt: Date.now(),
            inDungeon: true,
            isDungeon: true,
            dungeonId: 'default',
            isMiniBoss: template.isMiniBoss || false,
            chargeSpeed: template.chargeSpeed,
            chargeDistance: template.chargeDistance,
            attackCooldown: template.attackCooldown,
            summonCount: template.summonCount,
          };
          gameState.enemies.set(enemy.id, enemy);
        }
        
        console.log(`🏰 Room ${currentRoom} enemies spawned for ${player.name}`);
      }
      } // end default dungeon
    }

    // Animation frame
    player.animTime = (player.animTime || 0) + dt;
    if (player.animTime > 0.15) {
      player.animTime = 0;
      player.animFrame = ((player.animFrame || 0) + 1) % 4;
    }

    // Auto-cast spells (unless autoAttack is disabled)
    if (player.autoAttack !== false) {
      // Custom wizards have spells on player object directly, otherwise use CLASSES lookup
      const classData = CLASSES[player.class];
      const playerSpells = player.spells || (classData ? classData.spells : []);
      const playerInDungeon = player.inDungeon || false;
      
      if (playerSpells && playerSpells.length > 0) {
        for (const spellId of playerSpells) {
          const spell = SPELLS[spellId];
          if (!spell) continue;

          const lastCast = player.lastCast?.[spellId] || 0;
          const effectiveCooldown = spell.cooldown * (player.cooldownMultiplier || 1) * (player.attackSpeedMultiplier || 1);
          if (now - lastCast >= effectiveCooldown) {
            // Find target
            let target = null;
            let targetDist = spell.range;
            let targetIsPlayer = false;

            // Search enemies first (only in same realm - dungeon or world)
            for (const enemy of gameState.enemies.values()) {
              if (enemy.health <= 0) continue;
              // DUNGEON ISOLATION: Only target enemies in same realm
              if (playerInDungeon !== (enemy.isDungeon || false)) continue;
              // DUNGEON ID ISOLATION: Only target enemies in same dungeon instance
              if (playerInDungeon && (enemy.isDungeon || false)) {
                if ((enemy.dungeonId || 'default') !== (player.customDungeonId || 'default')) continue;
              }
              
              const dist = distance(player, enemy);
              if (dist < targetDist) {
                targetDist = dist;
                target = enemy;
                targetIsPlayer = false;
              }
            }

            // Voidlord can also target other players (only if PvP is enabled)
            if (classData?.canPvP && player.pvpEnabled === true) {
              for (const otherPlayer of gameState.players.values()) {
                if (otherPlayer.id === player.id || otherPlayer.health <= 0) continue;
                const dist = distance(player, otherPlayer);
                if (dist < targetDist) {
                  targetDist = dist;
                  target = otherPlayer;
                  targetIsPlayer = true;
                }
              }
            }

            if (target) {
              const projId = createProjectile(player, spell, target.x, target.y, targetIsPlayer ? target.id : null);
              // Auto-attack penalty: 50% damage
              if (projId) {
                const proj = gameState.projectiles.get(projId);
                if (proj) proj.damage = Math.floor(proj.damage * 0.5);
              }
              player.lastCast = player.lastCast || {};
              player.lastCast[spellId] = now;
              player.state = 'attack';
              
              // Sound event
              io.emit('sound', { type: 'spell', spellId, x: player.x, y: player.y });
            }
          }
        }
      }
    }

    // Health regen in sanctuary (safe zone) + healing fountain bonus
    const playerZone = getZoneAtPosition(player.x, player.y);
    const inSanctuary = playerZone?.id === 'sanctuary';
    
    if (inSanctuary) {
      // Check if player is in healing fountain (center of sanctuary)
      const fountain = BUILDINGS.healing_fountain;
      const distToFountain = distance(player, { x: fountain.x, y: fountain.y });
      const inFountain = distToFountain < fountain.healingRadius;
      
      // Heal if below max HP — scales with player level
      if (player.health < player.maxHealth) {
        const levelHealBonus = Math.floor((player.level || 1) * 1.5);
        const healAmount = inFountain ? (fountain.healRate + 20 + levelHealBonus * 2) : (20 + levelHealBonus);
        player.health = Math.min(player.health + healAmount * dt, player.maxHealth);
        player.isHealing = true;
      } else {
        player.isHealing = false;
      }
      
      // Track fountain state for speed boost on exit (works even at full HP)
      const wasInFountain = player.inFountain;
      player.inFountain = inFountain;
      
      // Player just left fountain proximity → grant 2x speed boost for 10s
      if (wasInFountain && !inFountain) {
        player.fountainSpeedBoostUntil = now + 10000;
      }
    } else {
      player.isHealing = false;
      // Check if player was in fountain and just left sanctuary entirely
      if (player.inFountain) {
        player.fountainSpeedBoostUntil = now + 10000;
      }
      player.inFountain = false;
    }

    // --- SECRET/EASTER EGG PROXIMITY CHECK ---
    if (!player.secretCooldowns) player.secretCooldowns = {};
    if (!player.discoveredSecrets) player.discoveredSecrets = {};
    if (!player.discoveredRunes) player.discoveredRunes = [];

    for (const [secretId, secret] of Object.entries(SECRETS)) {
      const dist = distance(player, { x: secret.x, y: secret.y });
      if (dist > secret.radius) continue;
      
      // Check cooldown
      const lastUse = player.secretCooldowns[secretId] || 0;
      const cd = secret.cooldown || 0;
      if (cd > 0 && now - lastUse < cd) continue;
      
      // One-time secrets (chests)
      if (secret.type === 'chest' && player.discoveredSecrets[secretId]) continue;
      
      // Activate!
      player.secretCooldowns[secretId] = now;
      
      if (secret.type === 'shrine') {
        if (secret.buff === 'speed') {
          player.speedBoostUntil = now + secret.buffDuration;
          player.speedBoostMultiplier = secret.buffAmount;
        } else if (secret.buff === 'damage') {
          player.damageBoostUntil = now + secret.buffDuration;
          player.savedDamageMultiplier = player.damageMultiplier || 1;
          player.damageMultiplier = (player.damageMultiplier || 1) * secret.buffAmount;
          setTimeout(() => {
            if (Date.now() >= (player.damageBoostUntil || 0)) {
              player.damageMultiplier = player.savedDamageMultiplier || 1;
            }
          }, secret.buffDuration);
        } else if (secret.buff === 'regen') {
          player.regenUntil = now + secret.buffDuration;
          player.regenAmount = secret.buffAmount;
        } else if (secret.buff === 'giant') {
          player.speedBoostUntil = now + secret.buffDuration;
          player.speedBoostMultiplier = 1.2;
          player.damageBoostUntil = now + secret.buffDuration;
          player.savedDamageMultiplier = player.damageMultiplier || 1;
          player.damageMultiplier = (player.damageMultiplier || 1) * secret.buffAmount;
          player.giantUntil = now + secret.buffDuration;
          const bonusHP = Math.floor(player.maxHealth * 0.5);
          player.maxHealth += bonusHP;
          player.health += bonusHP;
          setTimeout(() => {
            player.maxHealth -= bonusHP;
            player.health = Math.min(player.health, player.maxHealth);
            if (Date.now() >= (player.damageBoostUntil || 0)) {
              player.damageMultiplier = player.savedDamageMultiplier || 1;
            }
            player.giantUntil = 0;
          }, secret.buffDuration);
        }
        io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: secret.message, emoji: secret.emoji, type: 'shrine' });
        spawnParticles(secret.x, secret.y, '#ffd700', 20);
      }
      
      else if (secret.type === 'chest') {
        player.discoveredSecrets[secretId] = true;
        player.xp += secret.xpReward;
        player.totalXp += secret.xpReward;
        io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: secret.message, emoji: secret.emoji, type: 'chest', xp: secret.xpReward });
        spawnParticles(secret.x, secret.y, '#ffd700', 25);
        savePlayerToDb(player);
      }
      
      else if (secret.type === 'rune') {
        if (!player.discoveredRunes.includes(secretId)) {
          player.discoveredRunes.push(secretId);
          const runeCount = player.discoveredRunes.length;
          io.to(player.socketId).emit('secretDiscovered', { 
            id: secretId, message: secret.message, emoji: secret.emoji, type: 'rune',
            runesFound: runeCount, runesTotal: 3,
          });
          spawnParticles(secret.x, secret.y, '#a855f7', 20);
          // All 3 runes: permanent +10% damage, +25 HP
          if (runeCount >= 3) {
            player.maxHealth += 25;
            player.health += 25;
            player.damageMultiplier = (player.damageMultiplier || 1) * 1.1;
            io.to(player.socketId).emit('secretDiscovered', { 
              id: 'rune_complete', message: '🌟 ANCIENT POWER AWAKENED! Permanent +10% damage, +25 HP!', 
              emoji: '🌟', type: 'runeComplete',
            });
            savePlayerToDb(player);
          }
        }
      }
      
      else if (secret.type === 'fishing') {
        // Random reward: XP, temp buff, or funny message
        const roll = Math.random();
        if (roll < 0.3) {
          const xp = Math.floor(50 + Math.random() * 200);
          player.xp += xp;
          player.totalXp += xp;
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: `🎣 You caught a magical fish! +${xp} XP`, emoji: '🐟', type: 'fishing' });
        } else if (roll < 0.5) {
          player.speedBoostUntil = now + 15000;
          player.speedBoostMultiplier = 1.3;
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: '🎣 You caught a Swift Trout! +30% speed for 15s', emoji: '🐠', type: 'fishing' });
        } else if (roll < 0.7) {
          const heal = Math.floor(player.maxHealth * 0.5);
          player.health = Math.min(player.health + heal, player.maxHealth);
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: '🎣 You caught a Healing Bass! Restored 50% HP', emoji: '💚', type: 'fishing' });
        } else {
          const msgs = [
            '🎣 You caught an old boot. Classic.',
            '🎣 A tiny fish stares at you judgmentally, then swims away.',
            '🎣 You pulled up a soggy spell scroll... it crumbles to dust.',
            '🎣 Something HUGE tugged the line... then let go. Next time.',
          ];
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: msgs[Math.floor(Math.random() * msgs.length)], emoji: '🎣', type: 'fishing' });
        }
        spawnParticles(secret.x, secret.y, '#0ea5e9', 8);
      }
      
      else if (secret.type === 'campfire') {
        // Full heal + damage buff + regen
        player.health = player.maxHealth;
        // 15% damage boost for 45s
        player.damageBoostUntil = now + 45000;
        player.savedDamageMultiplier = player.damageMultiplier || 1;
        player.damageMultiplier = (player.damageMultiplier || 1) * 1.15;
        setTimeout(() => {
          if (Date.now() >= (player.damageBoostUntil || 0)) {
            player.damageMultiplier = player.savedDamageMultiplier || 1;
          }
        }, 45000);
        // Brief regen
        player.regenUntil = now + 15000;
        player.regenAmount = 5;
        io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: '🔥 The warmth restores you fully! +15% damage for 45s', emoji: secret.emoji, type: 'campfire' });
        spawnParticles(secret.x, secret.y, '#f97316', 15);
      }
      
      else if (secret.type === 'wishing_well') {
        // Costs XP, gives random powerful buff
        const cost = secret.xpCost || 50;
        if (player.xp < cost) {
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: `⛲ The well requires ${cost} XP as an offering...`, emoji: '⛲', type: 'wishing_well_fail' });
          player.secretCooldowns[secretId] = 0; // Reset cooldown on fail
          continue;
        }
        player.xp -= cost;
        const roll = Math.random();
        if (roll < 0.2) {
          // Lucky — huge XP back
          const xpReturn = cost * 5;
          player.xp += xpReturn;
          player.totalXp += xpReturn;
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: `⛲ The well overflows! +${xpReturn} XP!`, emoji: '✨', type: 'wishing_well' });
        } else if (roll < 0.4) {
          // Speed boost
          player.speedBoostUntil = now + 30000;
          player.speedBoostMultiplier = 1.6;
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: '⛲ The winds answer your wish! +60% speed for 30s', emoji: '💨', type: 'wishing_well' });
        } else if (roll < 0.6) {
          // Shield
          player.shieldAmount = Math.floor(player.maxHealth * 0.5);
          player.shieldUntil = now + 45000;
          player.shieldColor = '#ffd700';
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: '⛲ A golden barrier protects you! 50% HP shield for 45s', emoji: '🛡️', type: 'wishing_well' });
        } else if (roll < 0.8) {
          // Damage boost
          player.damageBoostUntil = now + 30000;
          player.savedDamageMultiplier = player.damageMultiplier || 1;
          player.damageMultiplier = (player.damageMultiplier || 1) * 1.75;
          setTimeout(() => {
            if (Date.now() >= (player.damageBoostUntil || 0)) {
              player.damageMultiplier = player.savedDamageMultiplier || 1;
            }
          }, 30000);
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: '⛲ Power surges through you! +75% damage for 30s', emoji: '⚔️', type: 'wishing_well' });
        } else {
          // Nothing... but funny message
          const msgs = [
            '⛲ The well gurgles... then goes silent. Your XP vanishes.',
            '⛲ A small frog hops out. It ribbits. That\'s it.',
            '⛲ The coin bounces off the bottom. The well seems amused.',
          ];
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: msgs[Math.floor(Math.random() * msgs.length)], emoji: '🐸', type: 'wishing_well' });
        }
        spawnParticles(secret.x, secret.y, '#ffd700', 15);
        io.to(player.socketId).emit('screenShake', { intensity: 3, duration: 300 });
      }
      
      else if (secret.type === 'mushroom_circle') {
        // Teleport to a random zone's center-ish area
        const teleportZones = ['meadow', 'forest', 'volcanic', 'crystal_caves', 'frozen'];
        const currentZone = player.zone || 'meadow';
        const otherZones = teleportZones.filter(z => z !== currentZone);
        const targetZone = otherZones[Math.floor(Math.random() * otherZones.length)];
        const targetPos = getRandomPointInZone(targetZone);
        player.x = targetPos.x;
        player.y = targetPos.y;
        spawnParticles(secret.x, secret.y, '#a855f7', 20);
        spawnParticles(targetPos.x, targetPos.y, '#a855f7', 20);
        io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: `🍄 The fairy ring whisks you away to the ${targetZone.replace('_', ' ')}!`, emoji: '🍄', type: 'mushroom_circle' });
        io.to(player.socketId).emit('teleported', { x: targetPos.x, y: targetPos.y });
      }
      
      else if (secret.type === 'gravestone') {
        const msgs = secret.messages || ['"Rest in peace."'];
        const msg = msgs[Math.floor(Math.random() * msgs.length)];
        // 15% chance for bonus XP from graves
        if (Math.random() < 0.15) {
          const xp = Math.floor(100 + Math.random() * 300);
          player.xp += xp;
          player.totalXp += xp;
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: `${msg}\n🪙 A coin falls from the stone! +${xp} XP`, emoji: secret.emoji, type: 'gravestone' });
        } else {
          io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: msg, emoji: secret.emoji, type: 'gravestone' });
        }
        spawnParticles(secret.x, secret.y, '#94a3b8', 5);
      }
      
      else if (secret.type === 'aurora') {
        // Small XP tick while standing near the aurora
        const xp = secret.xpPerTick || 15;
        player.xp += xp;
        player.totalXp += xp;
        io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: `🌌 The aurora fills you with wonder... +${xp} XP`, emoji: '🌌', type: 'aurora' });
        spawnParticles(secret.x, secret.y, '#22d3ee', 3);
      }
      
      else if (secret.type === 'dance_floor') {
        // Cosmetic: broadcast dance emote to all players, small speed boost
        player.speedBoostUntil = now + 8000;
        player.speedBoostMultiplier = 1.2;
        io.emit('playerDance', { playerId: player.id, x: player.x, y: player.y, name: player.name });
        io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: '💃 You bust a move! +20% speed for 8s', emoji: '🕺', type: 'dance_floor' });
        spawnParticles(player.x, player.y, '#f472b6', 10);
        spawnParticles(player.x, player.y, '#fbbf24', 10);
      }
      
      else if (secret.type === 'obelisk') {
        const msgs = secret.messages || ['💡 "Knowledge awaits."'];
        const msg = msgs[Math.floor(Math.random() * msgs.length)];
        io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: msg, emoji: secret.emoji, type: 'obelisk' });
        spawnParticles(secret.x, secret.y, '#e0e7ff', 8);
      }
      
      else if (secret.type === 'hot_spring') {
        // Heal 60% HP + cleanse slow/freeze + brief regen
        const healAmount = Math.floor(player.maxHealth * (secret.healPercent || 0.6));
        player.health = Math.min(player.health + healAmount, player.maxHealth);
        player.slowedUntil = 0;
        player.frozenUntil = 0;
        player.regenUntil = now + (secret.buffDuration || 20000);
        player.regenAmount = 6;
        spawnDamageNumber(player.x, player.y - 20, healAmount, false, '#4ade80');
        io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: '♨️ The hot spring soothes your wounds and cleanses debuffs!', emoji: '♨️', type: 'hot_spring' });
        spawnParticles(secret.x, secret.y, '#f97316', 10);
        spawnParticles(secret.x, secret.y, '#fef3c7', 8);
      }
      
      else if (secret.type === 'echo_cave') {
        // Next ability does 2x damage
        player.echoCaveBuff = true;
        player.echoCaveExpires = now + 60000; // expires after 60s if not used
        io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: '🔊 The crystals amplify your power! Next ability deals 2x damage!', emoji: '🔊', type: 'echo_cave' });
        spawnParticles(secret.x, secret.y, '#a78bfa', 15);
        io.to(player.socketId).emit('screenShake', { intensity: 5, duration: 400 });
      }
      
      else if (secret.type === 'shadow_mirror') {
        // Spawn a friendly shadow clone that mimics player attacks
        const cloneId = `shadow_clone_${player.id}`;
        // Remove old clone if exists
        if (gameState.enemies.has(cloneId)) {
          gameState.enemies.delete(cloneId);
        }
        const clone = {
          id: cloneId, type: 'summon', name: `${player.name}'s Shadow`,
          health: Math.floor(player.maxHealth * 0.6), maxHealth: Math.floor(player.maxHealth * 0.6),
          baseSpeed: 140, damage: Math.floor((player.damageMultiplier || 1) * 20),
          radius: 14, xp: 0, color: '#1a1a2e', behavior: 'chase',
          x: player.x + 30, y: player.y + 30, zone: player.zone || 'abyss',
          isSummon: true, ownerId: player.id, summonExpires: now + 30000,
          slowedUntil: 0, frozenUntil: 0, aggroRange: 350,
          lastAttack: 0, animFrame: 0, animTime: 0,
          isDungeon: player.inDungeon || false,
          dungeonId: player.customDungeonId || 'default',
        };
        gameState.enemies.set(cloneId, clone);
        setTimeout(() => {
          const c = gameState.enemies.get(cloneId);
          if (c && c.isSummon) {
            spawnParticles(c.x, c.y, '#1a1a2e', 8);
            gameState.enemies.delete(cloneId);
          }
        }, 30000);
        io.to(player.socketId).emit('secretDiscovered', { id: secretId, message: '🪞 Your shadow steps free! It fights alongside you for 30s!', emoji: '🪞', type: 'shadow_mirror' });
        spawnParticles(secret.x, secret.y, '#1a1a2e', 20);
        spawnParticles(player.x + 30, player.y + 30, '#7c3aed', 12);
      }
    }
    
    // Regen buff tick
    if (player.regenUntil && now < player.regenUntil && player.health < player.maxHealth) {
      player.health = Math.min(player.health + (player.regenAmount || 5) * dt, player.maxHealth);
    }
  }

  // --- UPDATE ENEMIES ---
  for (const enemy of gameState.enemies.values()) {
    if (enemy.health <= 0) continue;

    // Check if frozen (can't move)
    const isFrozen = enemy.frozenUntil > now;
    if (isFrozen) {
      enemy.animTime = (enemy.animTime || 0) + dt;
      if (enemy.animTime > 0.3) {
        enemy.animTime = 0;
        enemy.animFrame = ((enemy.animFrame || 0) + 1) % 4;
      }
      continue; // Skip movement when frozen
    }

    // Check if slowed
    const isSlowed = enemy.slowedUntil > now;
    const currentSpeed = isSlowed ? enemy.baseSpeed * 0.5 : enemy.baseSpeed;

    // Burn DOT (Pyromancer passive)
    if (enemy.burnUntil && now < enemy.burnUntil) {
      if (!enemy.lastBurnTick || now - enemy.lastBurnTick > 500) {
        enemy.lastBurnTick = now;
        const burnDmg = enemy.burnDamage || 5;
        enemy.health -= burnDmg;
        spawnDamageNumber(enemy.x, enemy.y - 15, burnDmg, false, '#ff6600');
        spawnParticles(enemy.x, enemy.y, '#ff4400', 2);
        if (enemy.health <= 0 && enemy.burnOwnerId) {
          checkEnemyDeath(enemy, enemy.burnOwnerId);
        }
      }
    }

    // Get enemy's zone
    const enemyZone = enemy.zone ? ZONES[enemy.zone] : null;
    const enemyInDungeon = enemy.isDungeon || false;
    
    // Find nearest player IN THE SAME ZONE AND REALM (dungeon isolation)
    let nearestPlayer = null;
    let nearestDist = Infinity;

    // Summon minions chase enemies, not players
    if (enemy.isSummon) {
      // Check if expired
      if (now > (enemy.summonExpires || 0)) {
        spawnParticles(enemy.x, enemy.y, enemy.color, 5);
        gameState.enemies.delete(enemy.id);
        continue;
      }
      // Find nearest non-summon enemy to attack
      let nearestTarget = null;
      let ntDist = Infinity;
      for (const other of gameState.enemies.values()) {
        if (other.id === enemy.id || other.isSummon || other.health <= 0) continue;
        const d = distance(enemy, other);
        if (d < ntDist && d < 400) { ntDist = d; nearestTarget = other; }
      }
      if (nearestTarget) {
        const dir = normalize({ x: nearestTarget.x - enemy.x, y: nearestTarget.y - enemy.y });
        const spd = enemy.baseSpeed || 120;
        enemy.x += dir.x * spd * dt;
        enemy.y += dir.y * spd * dt;
        // Attack on contact
        if (ntDist < enemy.radius + nearestTarget.radius && now - enemy.lastAttack > 600) {
          enemy.lastAttack = now;
          nearestTarget.health -= enemy.damage;
          spawnDamageNumber(nearestTarget.x, nearestTarget.y - 10, enemy.damage);
          spawnParticles(nearestTarget.x, nearestTarget.y, enemy.color, 3);
          // Check kill and credit owner
          if (nearestTarget.health <= 0) {
            checkEnemyDeath(nearestTarget, enemy.ownerId);
          }
        }
      }
      continue; // Skip normal enemy AI for summons
    }

    for (const player of alivePlayers) {
      // DUNGEON ISOLATION: Only target players in same realm
      const playerInDungeon = player.inDungeon || false;
      if (enemyInDungeon !== playerInDungeon) {
        continue; // Skip - different realm (dungeon vs world)
      }
      
      // DUNGEON ID ISOLATION: Only target players in the SAME dungeon instance
      if (enemyInDungeon && playerInDungeon) {
        if ((enemy.dungeonId || 'default') !== (player.customDungeonId || 'default')) {
          continue; // Skip - different dungeon instance
        }
      }
      
      // Get player's zone
      const playerZone = getZoneAtPosition(player.x, player.y);
      
      // Only aggro if player is in the same zone as enemy (for world enemies)
      if (!enemyInDungeon && enemyZone && playerZone && playerZone.id !== enemyZone.id) {
        continue; // Skip - player not in our zone
      }
      
      const dist = distance(enemy, player);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPlayer = player;
      }
    }

    // Mimic behavior - reveal when player is close
    if (enemy.behavior === 'ambush' && !enemy.revealed) {
      if (nearestDist < 80) {
        enemy.revealed = true;
        io.emit('sound', { type: 'mimicReveal', x: enemy.x, y: enemy.y });
      } else {
        continue; // Stay hidden
      }
    }
    
    // ========== MINI-BOSS BEHAVIORS ==========
    // Minotaur charge attack
    if (enemy.behavior === 'charge' && nearestPlayer && enemy.isMiniBoss) {
      const template = ENEMY_TYPES[enemy.type];
      const chargeCooldown = template?.attackCooldown || 3000;
      
      if (!enemy.isCharging && now - (enemy.lastAbility || 0) > chargeCooldown && nearestDist < 400) {
        // Start charging at player
        enemy.isCharging = true;
        enemy.chargeTarget = { x: nearestPlayer.x, y: nearestPlayer.y };
        enemy.chargeStart = now;
        enemy.lastAbility = now;
        
        io.emit('minotaurCharge', { 
          id: enemy.id, 
          x: enemy.x, 
          y: enemy.y, 
          targetX: nearestPlayer.x, 
          targetY: nearestPlayer.y 
        });
        io.emit('sound', { type: 'charge', x: enemy.x, y: enemy.y });
      }
      
      if (enemy.isCharging) {
        const chargeSpeed = template?.chargeSpeed || 300;
        const dir = normalize({ 
          x: enemy.chargeTarget.x - enemy.x, 
          y: enemy.chargeTarget.y - enemy.y 
        });
        
        enemy.x += dir.x * chargeSpeed * dt;
        enemy.y += dir.y * chargeSpeed * dt;
        
        // Damage players hit during charge
        for (const player of gameState.players.values()) {
          if (player.health <= 0 || player.invincible) continue;
          if (!isSameDungeon(enemy, player)) continue;
          if (distance(enemy, player) < enemy.radius + 20) {
            let chargeDmg = template?.damage || 60;
            if (player.shieldAmount > 0 && player.shieldUntil > Date.now()) {
              const absorbed = Math.min(chargeDmg, player.shieldAmount);
              player.shieldAmount -= absorbed;
              chargeDmg -= absorbed;
            }
            if (chargeDmg > 0) {
              player.health -= chargeDmg;
              spawnDamageNumber(player.x, player.y - 20, chargeDmg);
              io.to(player.socketId).emit('damaged', { amount: chargeDmg });
            }
            
            // Knockback
            const knockDir = normalize({ x: player.x - enemy.x, y: player.y - enemy.y });
            player.x += knockDir.x * 80;
            player.y += knockDir.y * 80;
            
            if (player.health <= 0) {
              player.deaths = (player.deaths || 0) + 1;
              io.to(player.socketId).emit('died', { killedBy: enemy.name });
            }
          }
        }
        
        // End charge after distance or time
        const chargeDistTraveled = distance({ x: enemy.x, y: enemy.y }, enemy.chargeTarget);
        if (chargeDistTraveled < 30 || now - enemy.chargeStart > 2000) {
          enemy.isCharging = false;
          io.emit('minotaurChargeEnd', { id: enemy.id, x: enemy.x, y: enemy.y });
        }
        
        continue; // Skip normal movement during charge
      }
    }
    
    // Lich summoning and magic attacks
    if (enemy.behavior === 'caster' && nearestPlayer && enemy.isMiniBoss) {
      const template = ENEMY_TYPES[enemy.type];
      const castCooldown = template?.attackCooldown || 2000;
      
      if (now - (enemy.lastAbility || 0) > castCooldown && nearestDist < 350) {
        enemy.lastAbility = now;
        enemy.attackPattern = ((enemy.attackPattern || 0) + 1) % 3;
        
        if (enemy.attackPattern === 0) {
          // Soul bolt - aimed projectile
          const dir = normalize({ x: nearestPlayer.x - enemy.x, y: nearestPlayer.y - enemy.y });
          const proj = {
            id: uuidv4(),
            x: enemy.x,
            y: enemy.y,
            vx: dir.x * 250,
            vy: dir.y * 250,
            damage: 35,
            radius: 12,
            color: '#6366f1',
            trailColor: '#a5b4fc',
            maxRange: 400,
            traveled: 0,
            fromEnemy: true,
            inDungeon: true,
            dungeonId: enemy.dungeonId || 'default',
            createdAt: now,
          };
          gameState.projectiles.set(proj.id, proj);
          io.emit('sound', { type: 'spell', x: enemy.x, y: enemy.y });
        } else if (enemy.attackPattern === 1) {
          // Summon skeletons
          const summonCount = template?.summonCount || 2;
          for (let i = 0; i < summonCount; i++) {
            const summonX = enemy.x + (Math.random() - 0.5) * 100;
            const summonY = enemy.y + (Math.random() - 0.5) * 100;
            const skelTemplate = ENEMY_TYPES.dungeon_skeleton;
            if (skelTemplate) {
              const minion = {
                id: uuidv4(),
                type: 'dungeon_skeleton',
                name: 'Risen Dead',
                health: skelTemplate.health * 0.5,
                maxHealth: skelTemplate.health * 0.5,
                baseSpeed: skelTemplate.speed,
                damage: skelTemplate.damage * 0.7,
                radius: skelTemplate.radius,
                xp: 15,
                color: '#4c1d95',
                behavior: 'chase',
                x: summonX,
                y: summonY,
                zone: 'dungeon',
                isDungeon: true,
                dungeonId: enemy.dungeonId || 'default',
                slowedUntil: 0,
                frozenUntil: 0,
              };
              gameState.enemies.set(minion.id, minion);
            }
          }
          io.emit('lichSummon', { x: enemy.x, y: enemy.y });
          spawnParticles(enemy.x, enemy.y, '#6366f1', 15);
        } else {
          // Death wave - AOE damage
          io.emit('lichDeathWave', { x: enemy.x, y: enemy.y, radius: 150 });
          for (const player of gameState.players.values()) {
            if (player.health <= 0 || player.invincible) continue;
            if (!isSameDungeon(enemy, player)) continue;
            if (distance(enemy, player) < 150) {
              let waveDmg = 30;
              if (player.shieldAmount > 0 && player.shieldUntil > Date.now()) {
                const absorbed = Math.min(waveDmg, player.shieldAmount);
                player.shieldAmount -= absorbed;
                waveDmg -= absorbed;
              }
              if (waveDmg > 0) {
                player.health -= waveDmg;
                spawnDamageNumber(player.x, player.y - 20, waveDmg);
                io.to(player.socketId).emit('damaged', { amount: waveDmg });
              }
              if (player.health <= 0) {
                player.deaths = (player.deaths || 0) + 1;
                io.to(player.socketId).emit('died', { killedBy: enemy.name });
              }
            }
          }
        }
      }
    }

    // Necromancer summoning
    if (enemy.behavior === 'summon' && nearestPlayer) {
      const template = ENEMY_TYPES[enemy.type];
      if (template && now - enemy.lastAbility > template.summonCooldown) {
        // Summon a minion
        spawnEnemy(template.summonType, { x: enemy.x + 30, y: enemy.y + 30 });
        enemy.lastAbility = now;
        io.emit('sound', { type: 'summon', x: enemy.x, y: enemy.y });
        spawnParticles(enemy.x, enemy.y, '#7c3aed', 8);
      }
    }

    // ========== ZONE BOSS ATTACKS ==========
    if (enemy.isBoss && !enemy.isDungeon && nearestPlayer) {
      // Don't attack players in sanctuary
      const targetZone = getZoneAtPosition(nearestPlayer.x, nearestPlayer.y);
      if (targetZone?.id === 'sanctuary') {
        continue;
      }
      
      const template = ENEMY_TYPES[enemy.type];
      if (!template) continue;
      
      // Phase tracking: Phase 2 at 60% HP, Phase 3 at 30% HP
      const hpPct = enemy.health / enemy.maxHealth;
      const oldPhase = enemy.phase || 1;
      if (hpPct <= 0.30) enemy.phase = 3;
      else if (hpPct <= 0.60) enemy.phase = 2;
      else enemy.phase = 1;
      
      // Phase transition announcement
      if (enemy.phase > oldPhase) {
        io.emit('bossPhase', { bossName: enemy.name, phase: enemy.phase, x: enemy.x, y: enemy.y, color: enemy.color });
        // Brief invulnerability on phase change
        enemy.phaseShieldUntil = now + 1500;
        spawnParticles(enemy.x, enemy.y, enemy.color, 25);
      }
      
      // Phase shield — immune during phase transition (skip attack only)
      if (enemy.phaseShieldUntil && now < enemy.phaseShieldUntil) {
        // Don't attack during phase transition, but don't skip other processing
      } else {
      
      // Speed boost in later phases
      const phaseSpeedMult = 1 + (enemy.phase - 1) * 0.15;
      
      // Attack cooldown gets faster in later phases
      const baseCooldown = template.attackCooldown || 3000;
      const attackCooldown = Math.max(1200, baseCooldown - (enemy.phase - 1) * 400);
      
      if (now - (enemy.lastAbility || 0) < attackCooldown) continue;
      enemy.lastAbility = now;
      
      // Cycle attacks, unlock more in later phases
      const availableAttacks = template.attacks || ['spore_burst'];
      const maxAttackIdx = Math.min(availableAttacks.length, enemy.phase + 1);
      enemy.attackIdx = ((enemy.attackIdx || 0) + 1) % maxAttackIdx;
      const attackName = availableAttacks[enemy.attackIdx];
      
      const bossPhase = enemy.phase;
      const phaseDmgMult = 1 + (bossPhase - 1) * 0.25; // 25% more damage per phase
      
      // Helper: damage a player with death check
      const hurtPlayer = (player, dmg, killedBy) => {
        if (player.invincible) return;
        let actualDmg = dmg;
        // Shield absorption
        if (player.shieldAmount > 0 && player.shieldUntil > now) {
          const absorbed = Math.min(actualDmg, player.shieldAmount);
          player.shieldAmount -= absorbed;
          actualDmg -= absorbed;
          if (absorbed > 0) spawnDamageNumber(player.x, player.y - 30, absorbed, false, player.shieldColor || '#00bfff');
        }
        if (actualDmg <= 0) return;
        player.health -= actualDmg;
        io.to(player.socketId).emit('damaged', { amount: actualDmg, fromX: enemy.x, fromY: enemy.y });
        spawnDamageNumber(player.x, player.y - 20, actualDmg);
        if (player.health <= 0) {
          player.health = 0;
          player.deaths = (player.deaths || 0) + 1;
          io.to(player.socketId).emit('died', { killedBy, level: player.level, xp: player.xp });
          savePlayerToDb(player);
        }
      };
      
      // ─── BLOSSOM BEHEMOTH ───
      if (attackName === 'spore_burst') {
        // Shoot homing spores at all nearby players
        const sporeCount = bossPhase >= 2 ? 3 : 1; // More spores in P2+
        for (const player of alivePlayers) {
          const playerZone = getZoneAtPosition(player.x, player.y);
          if (playerZone?.id === 'sanctuary') continue;
          if (distance(enemy, player) < 600) {
            for (let s = 0; s < sporeCount; s++) {
              const id = 'spore_' + Math.random().toString(36).substr(2, 9);
              gameState.projectiles.set(id, {
                id, x: enemy.x + (s - 1) * 30, y: enemy.y,
                targetId: player.id, speed: 100 + bossPhase * 20,
                damage: Math.floor(15 * phaseDmgMult), radius: 10,
                color: '#84cc16', fromEnemy: true, lifetime: 4000, createdAt: now,
              });
            }
          }
        }
        spawnParticles(enemy.x, enemy.y, '#84cc16', 12);
      }
      
      else if (attackName === 'vine_sweep') {
        // Radial sweep — damage all players within range
        const sweepRadius = 250 + bossPhase * 30;
        const sweepDmg = Math.floor(22 * phaseDmgMult);
        io.emit('bossAttackEffect', { type: 'ring', x: enemy.x, y: enemy.y, radius: sweepRadius, color: '#65a30d', duration: 600 });
        for (const player of alivePlayers) {
          if (distance(enemy, player) < sweepRadius) {
            hurtPlayer(player, sweepDmg, 'Blossom Behemoth');
          }
        }
      }
      
      else if (attackName === 'pollen_cloud') {
        // P2+ only: place lingering damage zones
        const cloudCount = 2 + bossPhase;
        for (let i = 0; i < cloudCount; i++) {
          const angle = (Math.PI * 2 / cloudCount) * i + Math.random() * 0.3;
          const dist = 150 + Math.random() * 200;
          const cx = enemy.x + Math.cos(angle) * dist;
          const cy = enemy.y + Math.sin(angle) * dist;
          const id = 'pollen_' + Math.random().toString(36).substr(2, 9);
          gameState.projectiles.set(id, {
            id, x: cx, y: cy, speed: 0,
            damage: Math.floor(8 * phaseDmgMult), radius: 80,
            color: '#a3e635', fromEnemy: true, isHazard: true,
            lifetime: 4000, createdAt: now, pulseRate: 600,
          });
          io.emit('explosion', { x: cx, y: cy, radius: 80, color: '#a3e63566' });
        }
      }
      
      // ─── ANCIENT TREANT ───
      else if (attackName === 'root_trap') {
        // Create root zones under player positions
        const trapCount = 2 + bossPhase;
        for (const player of alivePlayers) {
          if (distance(enemy, player) > 700) continue;
          // Place trap at player's CURRENT position (dodge if you move)
          io.emit('meteorWarning', { x: player.x, y: player.y, radius: 100, delay: 1000, color: '#166534' });
          const px = player.x, py = player.y;
          setTimeout(() => {
            const id = 'root_' + Math.random().toString(36).substr(2, 9);
            gameState.projectiles.set(id, {
              id, x: px, y: py, speed: 0,
              damage: Math.floor(25 * phaseDmgMult), radius: 100,
              color: '#166534', fromEnemy: true, isHazard: true,
              lifetime: 2500, createdAt: Date.now(), pulseRate: 500,
            });
            io.emit('explosion', { x: px, y: py, radius: 100, color: '#166534' });
          }, 1000);
        }
      }
      
      else if (attackName === 'branch_slam') {
        // Directional slam — line of damage toward nearest player
        const dir = normalize({ x: nearestPlayer.x - enemy.x, y: nearestPlayer.y - enemy.y });
        const slamLength = 350;
        const slamWidth = 60;
        const dmg = Math.floor(35 * phaseDmgMult);
        io.emit('bossAttackEffect', { type: 'line', x: enemy.x, y: enemy.y, dx: dir.x, dy: dir.y, length: slamLength, width: slamWidth, color: '#166534', duration: 500 });
        for (const player of alivePlayers) {
          // Check if player is in the line
          const toPlayer = { x: player.x - enemy.x, y: player.y - enemy.y };
          const dot = toPlayer.x * dir.x + toPlayer.y * dir.y;
          if (dot > 0 && dot < slamLength) {
            const cross = Math.abs(toPlayer.x * dir.y - toPlayer.y * dir.x);
            if (cross < slamWidth) {
              hurtPlayer(player, dmg, 'Ancient Treant');
            }
          }
        }
      }
      
      else if (attackName === 'summon_saplings') {
        // P3: summon treant saplings
        const count = 2 + bossPhase;
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 150 + Math.random() * 200;
          const minion = {
            id: uuidv4(), type: 'treant', name: 'Treant Sapling',
            health: 60, maxHealth: 60, baseSpeed: 50, damage: 12,
            radius: 16, xp: 15, color: '#166534', behavior: 'chase',
            x: enemy.x + Math.cos(angle) * dist,
            y: enemy.y + Math.sin(angle) * dist,
            zone: enemy.zone, slowedUntil: 0, frozenUntil: 0,
            aggroRange: 400, lastAttack: 0, animFrame: 0, animTime: 0,
          };
          gameState.enemies.set(minion.id, minion);
        }
        spawnParticles(enemy.x, enemy.y, '#166534', 15);
      }
      
      // ─── MAGMA TITAN ───
      else if (attackName === 'meteor_rain') {
        // Rain meteors around the arena
        const meteorCount = 3 + bossPhase * 2;
        for (let i = 0; i < meteorCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 100 + Math.random() * 350;
          const mx = enemy.x + Math.cos(angle) * dist;
          const my = enemy.y + Math.sin(angle) * dist;
          const delay = 800 + Math.random() * 700;
          io.emit('meteorWarning', { x: mx, y: my, radius: 100, delay });
          setTimeout(() => {
            const dmg = Math.floor(35 * phaseDmgMult);
            for (const player of gameState.players.values()) {
              if (player.health <= 0 || player.invincible) continue;
              if (distance({ x: mx, y: my }, player) < 100) {
                hurtPlayer(player, dmg, 'Magma Titan');
              }
            }
            io.emit('explosion', { x: mx, y: my, radius: 100, color: '#f97316' });
          }, delay);
        }
      }
      
      else if (attackName === 'lava_slam') {
        // Close-range ground slam with shockwave
        const slamRadius = 200 + bossPhase * 25;
        const slamDmg = Math.floor(45 * phaseDmgMult);
        io.emit('bossAttackEffect', { type: 'ring', x: enemy.x, y: enemy.y, radius: slamRadius, color: '#dc2626', duration: 800 });
        // Delayed damage (visual tell before it hits)
        setTimeout(() => {
          for (const player of gameState.players.values()) {
            if (player.health <= 0 || player.invincible) continue;
            if (distance(enemy, player) < slamRadius) {
              hurtPlayer(player, slamDmg, 'Magma Titan');
              // Knockback
              const pushDir = normalize({ x: player.x - enemy.x, y: player.y - enemy.y });
              player.x += pushDir.x * 100;
              player.y += pushDir.y * 100;
            }
          }
        }, 500);
      }
      
      else if (attackName === 'eruption') {
        // P3: Lava pools that persist
        const poolCount = 4 + bossPhase;
        for (let i = 0; i < poolCount; i++) {
          const angle = (Math.PI * 2 / poolCount) * i;
          const dist = 200 + Math.random() * 150;
          const lx = enemy.x + Math.cos(angle) * dist;
          const ly = enemy.y + Math.sin(angle) * dist;
          const id = 'lava_' + Math.random().toString(36).substr(2, 9);
          gameState.projectiles.set(id, {
            id, x: lx, y: ly, speed: 0,
            damage: Math.floor(12 * phaseDmgMult), radius: 70,
            color: '#f97316', fromEnemy: true, isHazard: true,
            lifetime: 6000, createdAt: now, pulseRate: 400,
          });
          io.emit('explosion', { x: lx, y: ly, radius: 70, color: '#f9731666' });
        }
      }
      
      // ─── FROST WYRM ───
      else if (attackName === 'ice_breath') {
        // Cone breath toward nearest player
        const dir = normalize({ x: nearestPlayer.x - enemy.x, y: nearestPlayer.y - enemy.y });
        const coneAngle = Math.PI / 3;
        const coneRange = 400 + bossPhase * 50;
        const baseAngle = Math.atan2(dir.y, dir.x);
        const breathDmg = Math.floor(30 * phaseDmgMult);
        
        io.emit('dragonBreath', { x: enemy.x, y: enemy.y, angle: baseAngle, range: coneRange, color: '#0ea5e9' });
        
        setTimeout(() => {
          for (const player of gameState.players.values()) {
            if (player.health <= 0 || player.invincible) continue;
            const toPlayer = { x: player.x - enemy.x, y: player.y - enemy.y };
            const playerDist = Math.sqrt(toPlayer.x ** 2 + toPlayer.y ** 2);
            if (playerDist < coneRange) {
              const playerAngle = Math.atan2(toPlayer.y, toPlayer.x);
              let angleDiff = Math.abs(playerAngle - baseAngle);
              if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
              if (angleDiff < coneAngle / 2) {
                hurtPlayer(player, breathDmg, 'Frost Wyrm');
                player.frozenUntil = now + 1500 + bossPhase * 300;
              }
            }
          }
        }, 400);
      }
      
      else if (attackName === 'blizzard_ring') {
        // Expanding ring of frost — dodge by standing close or far
        const innerRadius = 100;
        const outerRadius = 350 + bossPhase * 40;
        const ringDmg = Math.floor(25 * phaseDmgMult);
        io.emit('bossAttackEffect', { type: 'ring_expand', x: enemy.x, y: enemy.y, innerRadius, outerRadius, color: '#0ea5e9', duration: 1200 });
        setTimeout(() => {
          for (const player of gameState.players.values()) {
            if (player.health <= 0 || player.invincible) continue;
            const d = distance(enemy, player);
            // Safe inside inner radius, safe outside outer radius
            if (d > innerRadius + 30 && d < outerRadius) {
              hurtPlayer(player, ringDmg, 'Frost Wyrm');
              player.frozenUntil = Date.now() + 1200;
            }
          }
        }, 800);
      }
      
      else if (attackName === 'glacial_charge') {
        // P2+: charges toward player at high speed, leaving ice trail
        const dir = normalize({ x: nearestPlayer.x - enemy.x, y: nearestPlayer.y - enemy.y });
        const chargeSpeed = 400;
        const chargeDistance = 500;
        const chargeDmg = Math.floor(40 * phaseDmgMult);
        const startX = enemy.x, startY = enemy.y;
        const endX = startX + dir.x * chargeDistance;
        const endY = startY + dir.y * chargeDistance;
        
        // Warning line
        io.emit('bossAttackEffect', { type: 'line', x: startX, y: startY, dx: dir.x, dy: dir.y, length: chargeDistance, width: 50, color: '#0ea5e988', duration: 600 });
        
        setTimeout(() => {
          // Snap boss position
          enemy.x = endX;
          enemy.y = endY;
          // Damage anything in the path
          for (const player of gameState.players.values()) {
            if (player.health <= 0 || player.invincible) continue;
            const toPlayer = { x: player.x - startX, y: player.y - startY };
            const dot = toPlayer.x * dir.x + toPlayer.y * dir.y;
            if (dot > -30 && dot < chargeDistance + 30) {
              const cross = Math.abs(toPlayer.x * dir.y - toPlayer.y * dir.x);
              if (cross < 60) {
                hurtPlayer(player, chargeDmg, 'Frost Wyrm');
                player.frozenUntil = Date.now() + 2000;
              }
            }
          }
          // Ice trail hazards
          for (let t = 0; t < chargeDistance; t += 80) {
            const id = 'ice_' + Math.random().toString(36).substr(2, 9);
            gameState.projectiles.set(id, {
              id, x: startX + dir.x * t, y: startY + dir.y * t, speed: 0,
              damage: 8, radius: 40, color: '#0ea5e9', fromEnemy: true,
              isHazard: true, lifetime: 3000, createdAt: Date.now(), pulseRate: 500,
            });
          }
          spawnParticles(endX, endY, '#0ea5e9', 20);
        }, 600);
      }
      
      // ─── VOID OVERLORD ───
      else if (attackName === 'void_pulse') {
        // Pull players in, then explode
        const pullRadius = 500;
        const explodeRadius = 250 + bossPhase * 30;
        const explodeDmg = Math.floor(50 * phaseDmgMult);
        
        io.emit('meteorWarning', { x: enemy.x, y: enemy.y, radius: explodeRadius, delay: 2000 });
        
        const pullInterval = setInterval(() => {
          for (const player of gameState.players.values()) {
            if (player.health <= 0) continue;
            const dist = distance(enemy, player);
            if (dist < pullRadius && dist > 30) {
              const pullDir = normalize({ x: enemy.x - player.x, y: enemy.y - player.y });
              player.x += pullDir.x * 3;
              player.y += pullDir.y * 3;
            }
          }
        }, 50);
        
        setTimeout(() => {
          clearInterval(pullInterval);
          for (const player of gameState.players.values()) {
            if (player.health <= 0 || player.invincible) continue;
            if (distance(enemy, player) < explodeRadius) {
              hurtPlayer(player, explodeDmg, 'Void Overlord');
            }
          }
          io.emit('explosion', { x: enemy.x, y: enemy.y, radius: explodeRadius, color: '#7c3aed' });
        }, 2000);
        spawnParticles(enemy.x, enemy.y, '#7c3aed', 15);
      }
      
      else if (attackName === 'shadow_orbs') {
        // Fire slow homing void orbs in multiple directions
        const orbCount = 4 + bossPhase * 2;
        for (let i = 0; i < orbCount; i++) {
          const angle = (Math.PI * 2 / orbCount) * i;
          const id = 'vorb_' + Math.random().toString(36).substr(2, 9);
          gameState.projectiles.set(id, {
            id, x: enemy.x, y: enemy.y,
            vx: Math.cos(angle) * 80, vy: Math.sin(angle) * 80,
            damage: Math.floor(20 * phaseDmgMult), radius: 15,
            color: '#7c3aed', trailColor: '#581c87',
            fromEnemy: true, canHitPlayers: true,
            maxRange: 500, traveled: 0, createdAt: now,
            lifetime: 5000,
          });
        }
        spawnParticles(enemy.x, enemy.y, '#581c87', 10);
      }
      
      else if (attackName === 'dimension_rip') {
        // P2+: create dangerous void zones that damage over time
        const ripCount = 3 + bossPhase;
        for (let i = 0; i < ripCount; i++) {
          // Target player positions
          const target = alivePlayers[i % alivePlayers.length] || nearestPlayer;
          const rx = target.x + (Math.random() - 0.5) * 100;
          const ry = target.y + (Math.random() - 0.5) * 100;
          io.emit('meteorWarning', { x: rx, y: ry, radius: 90, delay: 1200, color: '#7c3aed' });
          setTimeout(() => {
            const id = 'void_' + Math.random().toString(36).substr(2, 9);
            gameState.projectiles.set(id, {
              id, x: rx, y: ry, speed: 0,
              damage: Math.floor(15 * phaseDmgMult), radius: 90,
              color: '#7c3aed', fromEnemy: true, isHazard: true,
              lifetime: 5000, createdAt: Date.now(), pulseRate: 400,
            });
            io.emit('explosion', { x: rx, y: ry, radius: 90, color: '#7c3aed88' });
          }, 1200);
        }
      }
      
      else if (attackName === 'summon_shades') {
        // P3: Summon shadow wraith minions
        const count = 2 + bossPhase;
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = 150 + Math.random() * 150;
          const minion = {
            id: uuidv4(), type: 'shadow_wraith', name: 'Void Shade',
            health: 100, maxHealth: 100, baseSpeed: 70, damage: 20,
            radius: 14, xp: 25, color: '#581c87', behavior: 'chase',
            x: enemy.x + Math.cos(angle) * dist,
            y: enemy.y + Math.sin(angle) * dist,
            zone: enemy.zone, slowedUntil: 0, frozenUntil: 0,
            aggroRange: 500, lastAttack: 0, animFrame: 0, animTime: 0,
          };
          gameState.enemies.set(minion.id, minion);
        }
        spawnParticles(enemy.x, enemy.y, '#581c87', 20);
        io.emit('sound', { type: 'summon', x: enemy.x, y: enemy.y });
      }
      
      // ─── CRYSTAL GOLEM ───
      else if (attackName === 'crystal_barrage') {
        // Fire crystal shards in a spread pattern
        const shardCount = 5 + bossPhase * 2;
        const dir = normalize({ x: nearestPlayer.x - enemy.x, y: nearestPlayer.y - enemy.y });
        const baseAngle = Math.atan2(dir.y, dir.x);
        const spread = Math.PI / 4; // 45 degree spread
        
        for (let i = 0; i < shardCount; i++) {
          const angle = baseAngle - spread / 2 + (spread / (shardCount - 1)) * i;
          const id = 'shard_' + Math.random().toString(36).substr(2, 9);
          gameState.projectiles.set(id, {
            id, x: enemy.x, y: enemy.y,
            vx: Math.cos(angle) * 250, vy: Math.sin(angle) * 250,
            damage: Math.floor(18 * phaseDmgMult), radius: 10,
            color: '#ec4899', trailColor: '#f0abfc',
            fromEnemy: true, canHitPlayers: true,
            maxRange: 450, traveled: 0, createdAt: now,
          });
        }
        spawnParticles(enemy.x, enemy.y, '#ec4899', 10);
      }
      
      else if (attackName === 'prism_beam') {
        // P2+: rotating beam that sweeps the arena
        const beamLength = 400;
        const beamDmg = Math.floor(30 * phaseDmgMult);
        const startAngle = Math.atan2(nearestPlayer.y - enemy.y, nearestPlayer.x - enemy.x);
        const sweepDir = Math.random() > 0.5 ? 1 : -1;
        const steps = 8;
        const stepDelay = 150;
        
        for (let step = 0; step < steps; step++) {
          const angle = startAngle + sweepDir * (step / steps) * (Math.PI / 2);
          setTimeout(() => {
            const dir = { x: Math.cos(angle), y: Math.sin(angle) };
            io.emit('bossAttackEffect', { type: 'line', x: enemy.x, y: enemy.y, dx: dir.x, dy: dir.y, length: beamLength, width: 40, color: '#ec4899', duration: stepDelay });
            for (const player of gameState.players.values()) {
              if (player.health <= 0 || player.invincible) continue;
              const toPlayer = { x: player.x - enemy.x, y: player.y - enemy.y };
              const dot = toPlayer.x * dir.x + toPlayer.y * dir.y;
              if (dot > 0 && dot < beamLength) {
                const cross = Math.abs(toPlayer.x * dir.y - toPlayer.y * dir.x);
                if (cross < 40) {
                  hurtPlayer(player, beamDmg, 'Crystal Golem');
                }
              }
            }
          }, step * stepDelay);
        }
      }
      
      else if (attackName === 'shatter_stomp') {
        // Ground stomp that creates crystal spikes radiating outward
        const spikeCount = 6 + bossPhase * 2;
        const stompDmg = Math.floor(35 * phaseDmgMult);
        
        // Close range stomp first
        io.emit('bossAttackEffect', { type: 'ring', x: enemy.x, y: enemy.y, radius: 150, color: '#ec4899', duration: 400 });
        for (const player of alivePlayers) {
          if (distance(enemy, player) < 150) {
            hurtPlayer(player, stompDmg, 'Crystal Golem');
          }
        }
        
        // Then radiating crystal spike lines
        for (let i = 0; i < spikeCount; i++) {
          const angle = (Math.PI * 2 / spikeCount) * i;
          for (let d = 100; d < 350; d += 80) {
            const delay = (d - 100) * 3;
            setTimeout(() => {
              const sx = enemy.x + Math.cos(angle) * d;
              const sy = enemy.y + Math.sin(angle) * d;
              const id = 'spike_' + Math.random().toString(36).substr(2, 9);
              gameState.projectiles.set(id, {
                id, x: sx, y: sy, speed: 0,
                damage: Math.floor(15 * phaseDmgMult), radius: 35,
                color: '#ec4899', fromEnemy: true, isHazard: true,
                lifetime: 1500, createdAt: Date.now(), pulseRate: 300,
              });
              io.emit('explosion', { x: sx, y: sy, radius: 35, color: '#ec489966' });
            }, delay);
          }
        }
      }
      
      io.emit('sound', { type: 'bossAttack', x: enemy.x, y: enemy.y });
      } // end phase shield else
    }

    // ========== DRAGON BOSS ATTACKS ==========
    if ((enemy.type === 'boss_dragon' || enemy.isCustomBoss) && nearestPlayer) {
      const distToPlayer = distance(enemy, nearestPlayer);
      const attackRange = enemy.attackRange || 1200;
      const attackCooldown = 1500 - (enemy.phase || 1) * 200; // Faster in higher phases
      
      // Dragon has long attack range - attacks even from far away
      if (distToPlayer < attackRange && now - (enemy.lastAbility || 0) > attackCooldown) {
        enemy.lastAbility = now;
        
        // Cycle through attacks
        enemy.attackPattern = ((enemy.attackPattern || 0) + 1) % 5;
        const attack = enemy.attackPattern;
        
        // Phase 2 at 50% health, Phase 3 at 25%
        if (enemy.health < enemy.maxHealth * 0.25) {
          enemy.phase = 3;
        } else if (enemy.health < enemy.maxHealth * 0.5) {
          enemy.phase = 2;
        }
        
        if (attack === 0) {
          // FLAME BREATH - Cone of fire toward player (longer range)
          const dir = normalize({ x: nearestPlayer.x - enemy.x, y: nearestPlayer.y - enemy.y });
          const coneAngle = Math.PI / 3; // 60 degree cone
          const coneRange = 500; // Increased from 300
          const baseAngle = Math.atan2(dir.y, dir.x);
          
          // Warning
          io.emit('dragonBreath', { 
            x: enemy.x, y: enemy.y, 
            angle: baseAngle, 
            range: coneRange,
            color: '#f97316',
          });
          
          // Damage after short delay
          setTimeout(() => {
            for (const player of gameState.players.values()) {
              if (player.health <= 0 || !player.inDungeon) continue;
              if (!isSameDungeon(enemy, player)) continue;
              const toPlayer = { x: player.x - enemy.x, y: player.y - enemy.y };
              const playerDist = Math.sqrt(toPlayer.x * toPlayer.x + toPlayer.y * toPlayer.y);
              
              if (playerDist < coneRange) {
                const playerAngle = Math.atan2(toPlayer.y, toPlayer.x);
                let angleDiff = Math.abs(playerAngle - baseAngle);
                if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
                
                if (angleDiff < coneAngle / 2) {
                  if (player.invincible) continue; // Admin invincibility
                  let breathDmg = 50 + (enemy.phase - 1) * 15;
                  if (player.shieldAmount > 0 && player.shieldUntil > Date.now()) {
                    const absorbed = Math.min(breathDmg, player.shieldAmount);
                    player.shieldAmount -= absorbed;
                    breathDmg -= absorbed;
                  }
                  if (breathDmg <= 0) continue;
                  player.health -= breathDmg;
                  io.to(player.socketId).emit('damaged', { amount: breathDmg, fromX: enemy.x, fromY: enemy.y });
                  spawnDamageNumber(player.x, player.y - 20, breathDmg);
                  if (player.health <= 0) {
                    player.health = 0;
                    player.deaths = (player.deaths || 0) + 1;
                    io.to(player.socketId).emit('died', { killedBy: 'Infernal Dragon', deathMessage: 'Consumed by dragon fire!' });
                  }
                }
              }
            }
          }, 500);
          
        } else if (attack === 1) {
          // WING GUST - Pushes players back (larger radius)
          io.emit('dragonWingGust', { x: enemy.x, y: enemy.y, radius: 400 });
          
          for (const player of gameState.players.values()) {
            if (player.health <= 0 || !player.inDungeon) continue;
            if (!isSameDungeon(enemy, player)) continue;
            const dist = distance(enemy, player);
            if (dist < 400) {
              const pushDir = normalize({ x: player.x - enemy.x, y: player.y - enemy.y });
              player.x += pushDir.x * 150;
              player.y = Math.max(100, Math.min(4800, player.y + pushDir.y * 150));
              player.x = clamp(player.x, 150, 1050);
            }
          }
          
        } else if (attack === 2) {
          // TAIL SWIPE - Close range damage (larger area)
          io.emit('dragonTailSwipe', { x: enemy.x, y: enemy.y, radius: 250 });
          
          for (const player of gameState.players.values()) {
            if (player.health <= 0 || !player.inDungeon) continue;
            if (!isSameDungeon(enemy, player)) continue;
            if (player.invincible) continue; // Admin invincibility
            if (distance(enemy, player) < 250) {
              let tailDmg = 40 + (enemy.phase - 1) * 10;
              if (player.shieldAmount > 0 && player.shieldUntil > Date.now()) {
                const absorbed = Math.min(tailDmg, player.shieldAmount);
                player.shieldAmount -= absorbed;
                tailDmg -= absorbed;
              }
              if (tailDmg <= 0) continue;
              player.health -= tailDmg;
              io.to(player.socketId).emit('damaged', { amount: tailDmg, fromX: enemy.x, fromY: enemy.y });
              spawnDamageNumber(player.x, player.y - 20, tailDmg);
              if (player.health <= 0) {
                player.health = 0;
                player.deaths = (player.deaths || 0) + 1;
                io.to(player.socketId).emit('died', { killedBy: 'Infernal Dragon', deathMessage: 'Crushed by the dragon\'s tail!' });
              }
            }
          }
          
        } else if (attack === 3 && enemy.phase >= 2) {
          // SUMMON MINIONS (Phase 2+)
          for (let i = 0; i < 2 + enemy.phase; i++) {
            const minionX = enemy.x + (Math.random() - 0.5) * 200;
            const minionY = enemy.y - 100 - Math.random() * 100;
            
            const minion = {
              id: uuidv4(),
              type: 'dungeon_skeleton',
              name: 'Dragon Spawn',
              health: 100,
              maxHealth: 100,
              baseSpeed: 80,
              damage: 25,
              radius: 14,
              xp: 30,
              color: '#7f1d1d',
              behavior: 'chase',
              x: minionX,
              y: minionY,
              zone: 'dungeon',
              isDungeon: true,
              dungeonId: enemy.dungeonId || 'default',
              facing: 'up',
              animFrame: 0,
              slowedUntil: 0,
              frozenUntil: 0,
            };
            gameState.enemies.set(minion.id, minion);
          }
          io.emit('sound', { type: 'summon', x: enemy.x, y: enemy.y });
          spawnParticles(enemy.x, enemy.y, '#7f1d1d', 20);
          
        } else if (attack === 4 && enemy.phase >= 3) {
          // RAGE MODE (Phase 3) - Fire everywhere
          io.emit('dragonRage', { x: enemy.x, y: enemy.y });
          
          // Multiple fire projectiles in all directions
          for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            const proj = {
              id: uuidv4(),
              ownerId: enemy.id,
              ownerClass: 'dragon',
              spellId: 'dragon_fire',
              x: enemy.x,
              y: enemy.y,
              vx: Math.cos(angle) * 200,
              vy: Math.sin(angle) * 200,
              damage: 30,
              radius: 15,
              color: '#f97316',
              trailColor: '#fbbf24',
              maxRange: 400,
              traveled: 0,
              createdAt: now,
              canHitPlayers: true,
              isDragonFire: true,
              dungeonId: enemy.dungeonId || 'default',
            };
            gameState.projectiles.set(proj.id, proj);
          }
        }
        
        io.emit('sound', { type: 'bossAttack', x: enemy.x, y: enemy.y });
      }
    }
    // ========== END BOSS ATTACKS ==========

    // Calculate chase range - extended when already aggro'd
    const baseAggro = enemy.aggroRange || 400;
    const chaseRange = enemy._chasing ? baseAggro * 2 : baseAggro;

    // Wander if no player nearby (keeps enemies moving within zone)
    if (!nearestPlayer || nearestDist > chaseRange) {
      enemy._chasing = false; // Lost target, reset aggro
      // Random wander
      if (!enemy.wanderAngle || Math.random() < 0.02) {
        enemy.wanderAngle = Math.random() * Math.PI * 2;
      }
      const wanderSpeed = currentSpeed * 0.3;
      let newX = enemy.x + Math.cos(enemy.wanderAngle) * wanderSpeed * dt;
      let newY = enemy.y + Math.sin(enemy.wanderAngle) * wanderSpeed * dt;
      
      // Dungeon enemies use different bounds
      if (enemyInDungeon) {
        // Dungeon bounds: x: 0-1800, y: 0-6500
        if (newX < 50 || newX > 1750 || newY < 50 || newY > 6450) {
          enemy.wanderAngle = enemy.wanderAngle + Math.PI + (Math.random() - 0.5);
          newX = enemy.x;
          newY = enemy.y;
        }
        enemy.x = Math.max(50, Math.min(1750, newX));
        enemy.y = Math.max(50, Math.min(6450, newY));
      } else {
        // Keep in zone (world enemies only)
        if (enemyZone?.polygon) {
          if (!pointInPolygon(newX, newY, enemyZone.polygon)) {
            // Turn around instead of leaving zone
            enemy.wanderAngle = enemy.wanderAngle + Math.PI + (Math.random() - 0.5);
            newX = enemy.x;
            newY = enemy.y;
          }
        }
        
        // Keep in bounds
        enemy.x = clamp(newX, 50, WORLD.width - 50);
        enemy.y = clamp(newY, 50, WORLD.height - 50);
        
        // Prevent enemies from getting too close to sanctuary (including buffer)
        if (isTooCloseToSanctuary(enemy.x, enemy.y)) {
          // Push back away from sanctuary
          const pushDir = normalize({ x: enemy.x - SANCTUARY_CENTER.x, y: enemy.y - SANCTUARY_CENTER.y });
          enemy.x = SANCTUARY_CENTER.x + pushDir.x * (SANCTUARY_RADIUS + SANCTUARY_BUFFER + 20);
          enemy.y = SANCTUARY_CENTER.y + pushDir.y * (SANCTUARY_RADIUS + SANCTUARY_BUFFER + 20);
          enemy.wanderAngle = Math.atan2(pushDir.y, pushDir.x); // Face away from sanctuary
        }
      }
    }
    
    if (nearestPlayer && nearestDist <= chaseRange) {
      enemy._chasing = true; // Track aggro state for extended chase
      // Enemies WILL chase players into sanctuary - no safe sniping
      const dir = normalize({ 
        x: nearestPlayer.x - enemy.x, 
        y: nearestPlayer.y - enemy.y 
      });
      
      // Calculate new position
      let newX = enemy.x + dir.x * currentSpeed * dt;
      let newY = enemy.y + dir.y * currentSpeed * dt;
      
      // Dungeon enemies use different bounds (not world zone polygons)
      if (enemyInDungeon) {
        // Dungeon bounds: x: 0-1800, y: 0-6500 (dragon lair area)
        newX = Math.max(50, Math.min(1750, newX));
        newY = Math.max(50, Math.min(6450, newY));
      } else {
        // World enemies can leave their zone polygon when chasing a player
        // but not go out of world bounds
        newX = clamp(newX, 50, WORLD.width - 50);
        newY = clamp(newY, 50, WORLD.height - 50);
      }
      
      enemy.x = newX;
      enemy.y = newY;
      
      // Update facing
      if (Math.abs(dir.x) > Math.abs(dir.y)) {
        enemy.facing = dir.x > 0 ? 'right' : 'left';
      } else {
        enemy.facing = dir.y > 0 ? 'down' : 'up';
      }

      // Attack player on collision
      // Dungeon enemies skip world zone checks - they use dungeonId isolation instead
      const canAttack = enemyInDungeon
        ? true  // Dungeon enemies can always attack (targeting already filtered by dungeonId)
        : true; // World enemies can attack anywhere they can reach (including sanctuary if aggro'd)
      
      const collisionDist = enemy.radius + 16; // player radius
      if (canAttack && nearestDist < collisionDist && now - enemy.lastAttack > 500) {
        // Check if player is invulnerable or invincible
        if ((!nearestPlayer.invulnerableUntil || nearestPlayer.invulnerableUntil < now) && !nearestPlayer.invincible) {
          let dmg = enemy.damage;
          // Shield absorption
          if (nearestPlayer.shieldAmount > 0 && nearestPlayer.shieldUntil > now) {
            const absorbed = Math.min(dmg, nearestPlayer.shieldAmount);
            nearestPlayer.shieldAmount -= absorbed;
            dmg -= absorbed;
            spawnDamageNumber(nearestPlayer.x, nearestPlayer.y - 30, absorbed, false, nearestPlayer.shieldColor || '#00bfff');
            if (dmg <= 0) { enemy.lastAttack = now; continue; }
          }
          nearestPlayer.health -= dmg;
          enemy.lastAttack = now;
          
          // Notify player of damage for screen shake
          io.to(nearestPlayer.socketId).emit('damaged', {
            amount: dmg,
            fromX: enemy.x,
            fromY: enemy.y,
          });
          io.emit('sound', { type: 'playerHit', x: nearestPlayer.x, y: nearestPlayer.y });

          // Swordsman Riposte passive - 20% chance to counter
          if (nearestPlayer.class === 'swordsman' && nearestPlayer.health > 0 && Math.random() < 0.2) {
            const riposteDmg = Math.floor((enemy.damage || 20) * 0.5 * (nearestPlayer.damageMultiplier || 1));
            for (const nearbyEnemy of gameState.enemies.values()) {
              if (nearbyEnemy.health <= 0 || nearbyEnemy.isSummon) continue;
              if (distance(nearbyEnemy, nearestPlayer) < 80) {
                nearbyEnemy.health -= riposteDmg;
                spawnDamageNumber(nearbyEnemy.x, nearbyEnemy.y - 10, riposteDmg, false, '#c0c0c0');
                checkEnemyDeath(nearbyEnemy, nearestPlayer.id);
              }
            }
            spawnParticles(nearestPlayer.x, nearestPlayer.y, '#c0c0c0', 6);
            io.to(nearestPlayer.socketId).emit('passiveProc', { type: 'riposte', message: 'Riposte!' });
          }

          if (nearestPlayer.health <= 0) {
            nearestPlayer.health = 0;
            nearestPlayer.deaths = (nearestPlayer.deaths || 0) + 1;
            io.to(nearestPlayer.socketId).emit('died', {
              killedBy: enemy.type,
              level: nearestPlayer.level,
              xp: nearestPlayer.xp,
            });
            // Save progress on death
            savePlayerToDb(nearestPlayer);
          }
        }
      }
    }

    // Animation
    enemy.animTime = (enemy.animTime || 0) + dt;
    if (enemy.animTime > 0.2) {
      enemy.animTime = 0;
      enemy.animFrame = ((enemy.animFrame || 0) + 1) % 4;
    }
  }

  // --- UPDATE PROJECTILES ---
  for (const proj of gameState.projectiles.values()) {
    // Instant AOE
    if (proj.isAoe) {
      // AOE visual effect
      spawnParticles(proj.x, proj.y, proj.color, 12);
      
      // Use projectile's dungeon state for isolation
      const projInDungeon = proj.inDungeon || false;
      
      for (const enemy of gameState.enemies.values()) {
        if (enemy.health <= 0) continue;
        // DUNGEON ISOLATION: Only hit enemies in same realm
        if (projInDungeon !== (enemy.isDungeon || false)) continue;
        // Don't hit own summons
        if (enemy.isSummon && enemy.ownerId === proj.ownerId) continue;
        
        if (distance(proj, enemy) < proj.radius + enemy.radius) {
          // Boss phase shield - immune during transition
          if (enemy.phaseShieldUntil && now < enemy.phaseShieldUntil) {
            spawnDamageNumber(enemy.x, enemy.y - 20, 0, false, '#888');
            if (!proj.piercing) { gameState.projectiles.delete(proj.id); }
            continue;
          }
          enemy.health -= proj.damage;
          
          // Spawn damage number
          spawnDamageNumber(enemy.x, enemy.y - 20, proj.damage);
          
          if (proj.slowEffect && proj.slowDuration) {
            enemy.slowedUntil = Math.max(enemy.slowedUntil, now + proj.slowDuration);
          }

          checkEnemyDeath(enemy, proj.ownerId);
        }
      }
      
      // PvP damage for admin spells
      if (proj.canHitPlayers) {
        for (const target of gameState.players.values()) {
          if (target.id === proj.ownerId) continue; // Don't hit self
          if (target.health <= 0) continue;
          if (proj.dungeonId && (target.customDungeonId || 'default') !== proj.dungeonId) continue;
          if (distance(proj, target) < proj.radius + 20) {
            target.health -= proj.damage;
            spawnDamageNumber(target.x, target.y - 20, proj.damage, true);
            
            // Notify target
            const targetSocket = [...io.sockets.sockets.values()].find(s => s.id === target.socketId);
            if (targetSocket) {
              targetSocket.emit('damaged', { amount: proj.damage, by: 'Void Lord' });
            }
            
            // Check death
            if (target.health <= 0) {
              target.deaths = (target.deaths || 0) + 1;
              targetSocket?.emit('died', { killedBy: 'Void Lord', level: target.level });
            }
          }
        }
      }
      
      gameState.projectiles.delete(proj.id);
      continue;
    }

    // Homing behavior
    if (proj.homing) {
      let target = null;
      
      // Check if targeting a player
      if (proj.targetPlayerId) {
        target = gameState.players.get(proj.targetPlayerId);
      } else if (proj.targetId) {
        target = gameState.enemies.get(proj.targetId);
      }
      
      if (target && target.health > 0) {
        const dir = normalize({ x: target.x - proj.x, y: target.y - proj.y });
        const speed = Math.sqrt(proj.vx ** 2 + proj.vy ** 2);
        proj.vx = lerp(proj.vx, dir.x * speed, 0.1);
        proj.vy = lerp(proj.vy, dir.y * speed, 0.1);
      }
    }

    // Move projectile
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
    proj.traveled += Math.sqrt((proj.vx * dt) ** 2 + (proj.vy * dt) ** 2);

    // Check collision with enemies
    let hit = false;
    const projInDungeon = proj.inDungeon || false;
    
    // Enemy-fired projectiles (e.g. Lich soul bolt) hit players, not enemies
    if (proj.fromEnemy) {
      for (const target of gameState.players.values()) {
        if (target.health <= 0 || target.invincible) continue;
        if ((target.inDungeon || false) !== projInDungeon) continue;
        if (proj.dungeonId && (target.customDungeonId || 'default') !== proj.dungeonId) continue;
        if ((!target.invulnerableUntil || target.invulnerableUntil < now)) {
          if (distance(proj, target) < proj.radius + 16) {
            target.health -= proj.damage;
            spawnDamageNumber(target.x, target.y - 20, proj.damage);
            io.to(target.socketId).emit('damaged', { amount: proj.damage, fromX: proj.x, fromY: proj.y });
            if (target.health <= 0) {
              target.health = 0;
              target.deaths = (target.deaths || 0) + 1;
              io.to(target.socketId).emit('died', { killedBy: 'Dark Magic' });
              savePlayerToDb(target);
            }
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        gameState.projectiles.delete(proj.id);
        continue;
      }
    }
    
    for (const enemy of gameState.enemies.values()) {
      if (enemy.health <= 0) continue;
      // DUNGEON ISOLATION: Only hit enemies in same realm
      if (projInDungeon !== (enemy.isDungeon || false)) continue;
      // Don't hit own summons
      if (enemy.isSummon && enemy.ownerId === proj.ownerId) continue;
      
      if (distance(proj, enemy) < proj.radius + enemy.radius) {
        // Boss phase shield - immune during transition
        if (enemy.phaseShieldUntil && now < enemy.phaseShieldUntil) {
          spawnDamageNumber(enemy.x, enemy.y - 20, 0, false, '#888');
          if (!proj.piercing) { gameState.projectiles.delete(proj.id); }
          continue;
        }
        const owner = gameState.players.get(proj.ownerId);
        const upgrades = owner?.spellUpgrades || [];
        let damage = proj.damage;
        
        // === SPELL UPGRADE EFFECTS ===
        
        // Mana Surge: Every 5th arcane missile deals 3x damage
        if (proj.spellId === 'arcane_missile' && upgrades.includes('mana_surge')) {
          if (!owner.castCount) owner.castCount = {};
          owner.castCount.arcane_missile = (owner.castCount.arcane_missile || 0) + 1;
          if (owner.castCount.arcane_missile % 5 === 0) {
            damage *= 3;
            io.emit('empoweredHit', { x: enemy.x, y: enemy.y, type: 'mana_surge' });
          }
        }
        
        // Permafrost: 20% chance to freeze on frostbolt hit
        if (proj.spellId === 'frostbolt' && upgrades.includes('permafrost')) {
          if (Math.random() < 0.2) {
            enemy.frozenUntil = now + 1500;
            io.emit('freeze', { x: enemy.x, y: enemy.y, duration: 1500 });
          }
        }
        
        // Inferno Core: Fireballs explode on impact
        if (proj.spellId === 'fireball' && upgrades.includes('inferno_core')) {
          const explosionRadius = 60;
          const explosionDamage = Math.floor(damage * 0.5);
          
          // Damage nearby enemies
          for (const nearby of gameState.enemies.values()) {
            if (nearby.id === enemy.id || nearby.health <= 0) continue;
            if (distance(enemy, nearby) < explosionRadius) {
              nearby.health -= explosionDamage;
              spawnDamageNumber(nearby.x, nearby.y - 20, explosionDamage);
              checkEnemyDeath(nearby, proj.ownerId);
            }
          }
          io.emit('explosion', { x: enemy.x, y: enemy.y, radius: explosionRadius, color: '#f97316' });
        }
        
        // Glacial Shards: Frostbolts split into 3 on impact
        if (proj.spellId === 'frostbolt' && upgrades.includes('glacial_shards') && !proj.isShard) {
          const shardCount = 3;
          const spreadAngle = Math.PI / 4;
          const baseAngle = Math.atan2(proj.vy, proj.vx);
          
          for (let i = 0; i < shardCount; i++) {
            const angle = baseAngle + (i - 1) * (spreadAngle / 2);
            const shardId = uuidv4();
            gameState.projectiles.set(shardId, {
              id: shardId,
              ownerId: proj.ownerId,
              ownerClass: proj.ownerClass,
              spellId: 'frostbolt_shard',
              isShard: true,
              x: enemy.x,
              y: enemy.y,
              vx: Math.cos(angle) * 400,
              vy: Math.sin(angle) * 400,
              radius: 6,
              damage: Math.floor(damage * 0.4),
              maxRange: 200,
              traveled: 0,
              color: '#67e8f9',
            });
          }
        }
        
        // Apply damage
        enemy.health -= damage;
        
        // Spawn damage number
        spawnDamageNumber(enemy.x, enemy.y - 20, damage);
        
        // Hit particles
        spawnParticles(enemy.x, enemy.y, proj.color, 4);
        
        if (proj.slowEffect && proj.slowDuration) {
          enemy.slowedUntil = Math.max(enemy.slowedUntil, now + proj.slowDuration);
        }

        // === CLASS PASSIVE EFFECTS ===
        if (owner) {
          const ownerClass = owner.class || '';
          // Pyromancer: Ignite - 20% chance to apply burn DOT
          if (ownerClass === 'pyromancer' && Math.random() < 0.2) {
            enemy.burnUntil = now + 3000;
            enemy.burnDamage = Math.floor(damage * 0.15);
            enemy.burnOwnerId = owner.id;
          }
          // Voidlord: Void Leech - heal 8% of damage dealt
          if (ownerClass === 'voidlord') {
            const heal = Math.floor(damage * 0.08);
            owner.health = Math.min(owner.health + heal, owner.maxHealth);
          }
          // Shadow Archer: Precision - 15% crit for 2x damage
          if (ownerClass === 'shadowarcher' && Math.random() < 0.15) {
            const critBonus = damage; // extra 1x
            enemy.health -= critBonus;
            spawnDamageNumber(enemy.x, enemy.y - 35, critBonus, true, '#ffd700');
            io.emit('sound', { type: 'crit', x: enemy.x, y: enemy.y });
          }
          // Arcanist: Arcane Echo - every 4th hit releases echo
          if (ownerClass === 'arcanist') {
            owner.arcaneHitCount = (owner.arcaneHitCount || 0) + 1;
            if (owner.arcaneHitCount % 4 === 0) {
              const echoDmg = Math.floor(damage * 0.5);
              for (const nearby of gameState.enemies.values()) {
                if (nearby.id === enemy.id || nearby.health <= 0) continue;
                if (distance(nearby, enemy) < 100) {
                  nearby.health -= echoDmg;
                  spawnDamageNumber(nearby.x, nearby.y - 10, echoDmg, false, '#a78bfa');
                  spawnParticles(nearby.x, nearby.y, '#a78bfa', 3);
                }
              }
              io.emit('explosion', { x: enemy.x, y: enemy.y, radius: 100, color: '#a78bfa' });
            }
          }
        }

        checkEnemyDeath(enemy, proj.ownerId);
        
        // Blazing Speed: Pierce through one enemy
        if (proj.spellId === 'fireball' && upgrades.includes('blazing_speed') && !proj.hasPierced) {
          proj.hasPierced = true;
          continue; // Don't mark as hit, continue flying
        }
        
        hit = true;
        break;
      }
    }
    
    // PvP damage for admin projectiles (if piercing, check all players)
    if (proj.canHitPlayers && !hit) {
      for (const target of gameState.players.values()) {
        if (target.id === proj.ownerId) continue;
        if (target.health <= 0) continue;
        if (proj.dungeonId && (target.customDungeonId || 'default') !== proj.dungeonId) continue;
        if (distance(proj, target) < proj.radius + 20) {
          target.health -= proj.damage;
          spawnDamageNumber(target.x, target.y - 20, proj.damage, true);
          spawnParticles(target.x, target.y, proj.color, 6);
          
          const targetSocket = [...io.sockets.sockets.values()].find(s => s.id === target.socketId);
          if (targetSocket) {
            targetSocket.emit('damaged', { amount: proj.damage, by: 'Void Lord' });
          }
          
          if (target.health <= 0) {
            target.deaths = (target.deaths || 0) + 1;
            targetSocket?.emit('died', { killedBy: 'Void Lord', level: target.level });
          }
          
          if (!proj.piercing) {
            hit = true;
            break;
          }
        }
      }
    }

    if (hit || proj.traveled >= proj.maxRange) {
      gameState.projectiles.delete(proj.id);
    }
  }

  // --- SPAWN ENEMIES ---
  // Spawn enemies in zones where players are located
  const playersPerZone = {};
  for (const player of alivePlayers) {
    const zone = getZoneAtPosition(player.x, player.y);
    if (zone && !zone.isSafe) {
      playersPerZone[zone.id] = (playersPerZone[zone.id] || 0) + 1;
    }
  }
  
  // Target enemies per zone based on players in that zone
  for (const [zoneId, playerCount] of Object.entries(playersPerZone)) {
    const zone = ZONES[zoneId];
    if (!zone || zone.isSafe) continue;
    
    const enemiesInZone = [...gameState.enemies.values()].filter(e => e.health > 0 && e.zone === zoneId).length;
    const targetForZone = Math.max(200, playerCount * 140);
    
    if (enemiesInZone < targetForZone) {
      // Spawn multiple enemies per tick when underpopulated
      const deficit = targetForZone - enemiesInZone;
      const spawnsThisTick = Math.min(8, Math.ceil(deficit / 3));
      for (let s = 0; s < spawnsThisTick; s++) {
        if (Math.random() < 0.75) {
          spawnEnemyInZone(zoneId);
        }
      }
    }
  }
  
  // Also maintain some enemies in zones without players (for exploration)
  const zoneOrder = ['meadow', 'forest', 'volcanic', 'frozen', 'abyss', 'crystal_caves'];
  for (const zoneId of zoneOrder) {
    if (playersPerZone[zoneId]) continue; // Already handled
    
    const enemiesInZone = [...gameState.enemies.values()].filter(e => e.health > 0 && e.zone === zoneId).length;
    if (enemiesInZone < 120 && Math.random() < 0.25) {
      spawnEnemyInZone(zoneId);
    }
  }

  // --- CHECK ZONE BOSS RESPAWNS ---
  for (const zoneId of Object.keys(ZONE_BOSS_TYPES)) {
    // Try to spawn boss (function handles cooldown check)
    spawnZoneBoss(zoneId);
  }

  // --- UPDATE XP ORBS ---
  for (const orb of gameState.xpOrbs.values()) {
    // Remove old orbs
    if (now - orb.createdAt > XP_ORB.lifetime) {
      gameState.xpOrbs.delete(orb.id);
      continue;
    }

    // Find nearest alive player for magnet effect
    let nearestPlayer = null;
    let nearestDist = XP_ORB.magnetRadius;

    for (const player of alivePlayers) {
      const dist = distance(orb, player);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPlayer = player;
      }
    }

    // Move towards player if in magnet range
    if (nearestPlayer) {
      const dir = normalize({ x: nearestPlayer.x - orb.x, y: nearestPlayer.y - orb.y });
      const speed = XP_ORB.magnetSpeed * (1 - nearestDist / XP_ORB.magnetRadius);
      orb.x += dir.x * speed * dt;
      orb.y += dir.y * speed * dt;

      // Pickup
      if (nearestDist < XP_ORB.pickupRadius) {
        nearestPlayer.xp += orb.amount;
        nearestPlayer.totalXp = (nearestPlayer.totalXp || 0) + orb.amount;
        
        // Sound for pickup
        io.to(nearestPlayer.socketId).emit('sound', { type: 'xpPickup' });
        
        // Level up check
        while (nearestPlayer.xp >= xpForLevel(nearestPlayer.level)) {
          nearestPlayer.xp -= xpForLevel(nearestPlayer.level);
          nearestPlayer.level++;
          nearestPlayer.maxHealth += 18;
          nearestPlayer.health = Math.min(nearestPlayer.health + 50, nearestPlayer.maxHealth);
          nearestPlayer.baseSpeed += 3;
          nearestPlayer.damageMultiplier = (nearestPlayer.damageMultiplier || 1) * 1.04; // ~4% more damage per level
          
          io.to(nearestPlayer.socketId).emit('levelUp', {
            level: nearestPlayer.level,
            maxHealth: nearestPlayer.maxHealth,
          });
          io.to(nearestPlayer.socketId).emit('sound', { type: 'levelUp' });
          
          // Save progress on level up
          savePlayerToDb(nearestPlayer);
        }

        gameState.xpOrbs.delete(orb.id);
      }
    }
  }

  // --- UPDATE PARTICLES ---

  // --- COLLECTIBLE PICKUP ---
  if (gameState.collectibles.size > 0) {
    for (const [cId, collectible] of gameState.collectibles) {
      for (const player of gameState.players.values()) {
        if (player.health <= 0) continue;
        const dx = player.x - collectible.x;
        const dy = player.y - collectible.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < (collectible.pickupRadius || 40)) {
          // Check if player has an active collect quest for this item
          const quest = player.activeQuests?.find(q => q.type === 'collect' && q.target === collectible.item && q.progress < q.required);
          if (quest) {
            quest.progress += 1;
            gameState.collectibles.delete(cId);
            
            const playerSocket = io.sockets.sockets.get(player.socketId);
            if (playerSocket) {
              playerSocket.emit('collectiblePickup', {
                item: collectible.item,
                emoji: collectible.emoji,
                color: collectible.color,
                x: collectible.x,
                y: collectible.y,
              });
              playerSocket.emit('questProgressUpdate', {
                questId: quest.id,
                progress: quest.progress,
                required: quest.required,
                name: quest.name,
                complete: quest.progress >= quest.required,
              });
            }
            
            // Respawn after 60 seconds
            const questDef = COLLECT_QUESTS.find(q => q.item === collectible.item);
            if (questDef) {
              setTimeout(() => {
                respawnCollectible(collectible.zone, collectible.item, questDef);
              }, 60000);
            }
            break;
          }
        }
      }
    }
  }

  // --- UPDATE PARTICLES ---
  gameState.particles = gameState.particles.filter(p => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.95;
    p.vy *= 0.95;
    return now - p.createdAt < p.lifetime;
  });

  // --- UPDATE DAMAGE NUMBERS ---
  gameState.damageNumbers = gameState.damageNumbers.filter(d => {
    return now - d.createdAt < d.lifetime;
  });

  // --- CLEANUP DEAD ENEMIES (safety net) ---
  for (const [id, enemy] of gameState.enemies) {
    if (enemy.health <= 0) {
      gameState.enemies.delete(id);
    }
  }

  // --- CLEANUP OLD PROJECTILES (safety net) ---
  for (const [id, proj] of gameState.projectiles) {
    if (now - proj.createdAt > 10000) { // 10 second max lifetime
      gameState.projectiles.delete(id);
    }
  }

  // --- UPDATE NPCs ---
  for (const [id, npc] of gameState.npcs) {
    // Roaming NPCs (like knight)
    if (!npc.stationary && npc.roamRadius) {
      const timeSinceWander = now - (npc.lastWander || 0);
      
      // Change direction occasionally
      if (timeSinceWander > 2000 + Math.random() * 3000) {
        npc.wanderAngle = Math.random() * Math.PI * 2;
        npc.lastWander = now;
      }
      
      // Move
      const speed = npc.roamSpeed || 30;
      let newX = npc.currentX + Math.cos(npc.wanderAngle) * speed * dt;
      let newY = npc.currentY + Math.sin(npc.wanderAngle) * speed * dt;
      
      // Stay within roam radius of home position
      const distFromHome = Math.sqrt(
        Math.pow(newX - npc.x, 2) + Math.pow(newY - npc.y, 2)
      );
      
      if (distFromHome > npc.roamRadius) {
        // Turn back toward home
        npc.wanderAngle = Math.atan2(npc.y - npc.currentY, npc.x - npc.currentX);
        newX = npc.currentX;
        newY = npc.currentY;
      }
      
      npc.currentX = newX;
      npc.currentY = newY;
      
      // Update facing
      const vx = Math.cos(npc.wanderAngle);
      const vy = Math.sin(npc.wanderAngle);
      if (Math.abs(vx) > Math.abs(vy)) {
        npc.facing = vx > 0 ? 'right' : 'left';
      } else {
        npc.facing = vy > 0 ? 'down' : 'up';
      }
    }
    
    // Shapeshifter form changes
    if (npc.type === 'shapeshifter' && npc.forms) {
      const timeSinceChange = now - (npc.lastFormChange || 0);
      if (timeSinceChange > (npc.formChangeInterval || 900000)) { // 15 min default
        npc.currentFormIndex = (npc.currentFormIndex + 1) % npc.forms.length;
        const newForm = npc.forms[npc.currentFormIndex];
        npc.name = newForm.name;
        npc.color = newForm.color;
        npc.emoji = newForm.emoji;
        npc.lastFormChange = now;
        console.log(`🦋 Shapeshifter changed form to: ${newForm.name}`);
      }
    }
  }

  // --- BROADCAST STATE (Per-player with view distance filtering) ---
  const VIEW_DISTANCE = 1200;
  
  for (const player of gameState.players.values()) {
    const socket = io.sockets.sockets.get(player.socketId);
    if (!socket) continue;
    
    const px = player.x;
    const py = player.y;
    const playerInDungeon = player.inDungeon || false;
    
    // Filter entities by distance and dungeon context
    const nearbyEnemies = [...gameState.enemies.values()]
      .filter(e => {
        if (e.health <= 0) return false;
        if (e.revealed === false) return false;
        if (Math.abs(e.x - px) >= VIEW_DISTANCE || Math.abs(e.y - py) >= VIEW_DISTANCE) return false;
        // Dungeon enemies only visible to dungeon players
        if (e.isDungeon && !playerInDungeon) return false;
        // Regular enemies not visible to dungeon players
        if (!e.isDungeon && playerInDungeon) return false;
        // Within dungeons, only show enemies from the same dungeon instance
        if (e.isDungeon && playerInDungeon) {
          if ((e.dungeonId || 'default') !== (player.customDungeonId || 'default')) return false;
        }
        return true;
      })
      .map(e => {
        // Minimal data for regular enemies, extra for bosses
        const base = {
          id: e.id,
          type: e.behavior === 'ambush' && !e.revealed ? 'xpOrb' : e.type,
          x: Math.round(e.x),
          y: Math.round(e.y),
          health: Math.round(e.health),
          maxHealth: e.maxHealth,
        };
        if (e.isBoss || e.isMiniBoss || e.isCustomBoss) {
          base.name = e.name;
          base.isBoss = true;
          if (e.isMiniBoss) base.isMiniBoss = true;
          if (e.isCustomBoss) base.isCustomBoss = true;
          base.radius = e.radius || 14;
          base.phase = e.phase;
          base.color = e.color;
        }
        if (e.isCharging) base.isCharging = true;
        if (e.slowedUntil > now) base.isSlowed = true;
        if (e.frozenUntil > now) base.isFrozen = true;
        if (e.isSummon) { base.isSummon = true; base.color = e.color; base.radius = e.radius || 12; }
        if (e.isGolden) { base.isGolden = true; base.color = '#ffd700'; base.name = e.name; base.radius = e.radius; }
        return base;
      });
    
    const nearbyProjectiles = [...gameState.projectiles.values()]
      .filter(p => Math.abs(p.x - px) < VIEW_DISTANCE && Math.abs(p.y - py) < VIEW_DISTANCE)
      .map(p => ({
        id: p.id, x: Math.round(p.x), y: Math.round(p.y),
        radius: p.radius, color: p.color,
        spellId: p.spellId, ownerClass: p.ownerClass,
        projectileShape: p.projectileShape || undefined,
      }));
    
    const nearbyOrbs = [...gameState.xpOrbs.values()]
      .filter(o => Math.abs(o.x - px) < VIEW_DISTANCE && Math.abs(o.y - py) < VIEW_DISTANCE)
      .map(o => ({ id: o.id, x: Math.round(o.x), y: Math.round(o.y), amount: o.amount }));
    
    // Only send collectibles for items the player has active quests for
    const playerQuestItems = new Set((player.activeQuests || []).filter(q => q.type === 'collect' && q.progress < q.required).map(q => q.target));
    const nearbyCollectibles = playerQuestItems.size > 0 ? [...gameState.collectibles.values()]
      .filter(c => playerQuestItems.has(c.item) && Math.abs(c.x - px) < VIEW_DISTANCE && Math.abs(c.y - py) < VIEW_DISTANCE)
      .map(c => ({ id: c.id, x: Math.round(c.x), y: Math.round(c.y), color: c.color, emoji: c.emoji })) : [];
    
    const nearbyParticles = gameState.particles
      .filter(p => Math.abs(p.x - px) < VIEW_DISTANCE && Math.abs(p.y - py) < VIEW_DISTANCE)
      .slice(0, 80)
      .map(p => ({
        x: Math.round(p.x), y: Math.round(p.y), color: p.color,
        radius: p.radius, alpha: 1 - (now - p.createdAt) / p.lifetime,
      }));
    
    const nearbyDmgNums = gameState.damageNumbers
      .filter(d => Math.abs(d.x - px) < VIEW_DISTANCE && Math.abs(d.y - py) < VIEW_DISTANCE)
      .slice(0, 25)
      .map(d => ({
        x: d.x, y: d.y - ((now - d.createdAt) / d.lifetime) * 30,
        amount: d.amount, isCrit: d.isCrit, alpha: 1 - (now - d.createdAt) / d.lifetime,
      }));
    
    // Cooldowns for this player
    const classData = CLASSES[player.class];
    const cooldowns = {};
    
    // Use player.spells for custom wizards, otherwise CLASSES lookup
    const playerSpells = player.spells || (classData ? classData.spells : []);
    if (playerSpells) {
      for (const spellId of playerSpells) {
        const spell = SPELLS[spellId];
        if (spell) {
          const lastCast = player.lastCast?.[spellId] || 0;
          cooldowns[spellId] = { remaining: Math.max(0, spell.cooldown - (now - lastCast)), total: spell.cooldown };
        }
      }
    }
    
    // Dash cooldown - check player first, then CLASSES
    const dashAbility = player.dashAbility || classData?.dashAbility;
    if (dashAbility) {
      cooldowns.dash = { remaining: Math.max(0, dashAbility.cooldown - (now - (player.lastDash || 0))), total: dashAbility.cooldown };
    }
    
    // Ultimate cooldown - check player first, then CLASSES
    const ultAbility = player.ultimateAbility || classData?.ultimateAbility;
    if (ultAbility) {
      cooldowns.ultimate = { remaining: Math.max(0, ultAbility.cooldown - (now - (player.lastUltimate || 0))), total: ultAbility.cooldown };
    }
    
    // Get nearby NPCs
    // Only send NPCs every 60 ticks (~3s) since they barely move
    const sendNpcs = (gameState.tickCount % 60 === 0) || !player._npcsSent;
    let nearbyNpcs = [];
    if (sendNpcs) {
      player._npcsSent = true;
      nearbyNpcs = [...gameState.npcs.values()]
        .filter(npc => Math.abs(npc.currentX - px) < VIEW_DISTANCE && Math.abs(npc.currentY - py) < VIEW_DISTANCE)
        .map(npc => ({
          id: npc.id, name: npc.name, type: npc.type,
          x: Math.round(npc.currentX), y: Math.round(npc.currentY),
          color: npc.color, emoji: npc.emoji, interactRange: npc.interactRange,
        }));
    }

    // Self: full data
    const selfData = {
      id: player.id, name: player.name, class: player.class,
      x: Math.round(player.x), y: Math.round(player.y),
      health: Math.round(player.health), maxHealth: player.maxHealth,
      level: player.level, xp: player.xp, totalXp: player.totalXp || 0, xpToLevel: xpForLevel(player.level),
      kills: player.kills || 0, deaths: player.deaths || 0,
      state: player.state || 'idle', facing: player.facing || 'down', animFrame: player.animFrame || 0,
      selectedSkin: player.selectedSkin || `${player.class}_default`,
      cooldowns,
      isHealing: player.isHealing || false,
      inFountain: player.inFountain || false,
      fountainBoostRemaining: (player.fountainSpeedBoostUntil && player.fountainSpeedBoostUntil > now && !player.inFountain)
        ? Math.ceil((player.fountainSpeedBoostUntil - now) / 1000) : 0,
      bossKills: player.bossKills || {},
      upgrades: player.upgrades || {},
      damageMultiplier: player.damageMultiplier || 1,
      speedMultiplier: player.speedMultiplier || 1,
      cooldownMultiplier: player.cooldownMultiplier || 1,
      attackSpeedMultiplier: player.attackSpeedMultiplier || 1,
      baseSpeed: player.baseSpeed || 150,
      isAdmin: player.isAdmin || false,
    };
    if (player.emote) { selfData.emote = player.emote; selfData.emoteStart = player.emoteStart; }
    // Visual properties for ALL classes
    selfData.isCustomWizard = player.isCustomWizard || false;
    selfData.customColor = player.color || player.secondaryColor;
    selfData.customSecondaryColor = player.secondaryColor;
    selfData.customClassName = player.className;
    selfData.customIconStyle = player.iconStyle || 'star';
    selfData.customBodyStyle = player.bodyStyle || 'wizard';
    selfData.customProjectileShape = player.projectileShape || 'orb';
    selfData.customHeadgear = player.headgear || 'pointyHat';
    // Active buffs
    if (player.activeBuffs && player.activeBuffs.length > 0) {
      selfData.activeBuffs = player.activeBuffs.filter(b => b.expiresAt > now).map(b => ({ type: b.type, color: b.color, expiresAt: b.expiresAt }));
    }
    // Shield/Transform/Giant visual states
    if (player.shieldAmount > 0 && player.shieldUntil > now) {
      selfData.shieldActive = true;
      selfData.shieldColor = player.shieldColor || '#00bfff';
      selfData.shieldAmount = Math.round(player.shieldAmount);
    }
    if (player.transformUntil > now) {
      selfData.transformActive = true;
      selfData.transformColor = player.transformColor;
    }
    if (player.giantUntil > now) {
      selfData.giantActive = true;
    }

    // Others: minimal visual data
    const otherPlayers = [...gameState.players.values()]
      .filter(p => {
        if (p.id === player.id) return false;
        const pInDungeon = p.inDungeon || false;
        if (pInDungeon !== playerInDungeon) return false;
        if (playerInDungeon && pInDungeon && (p.customDungeonId || 'default') !== (player.customDungeonId || 'default')) return false;
        return Math.abs(p.x - px) < VIEW_DISTANCE && Math.abs(p.y - py) < VIEW_DISTANCE;
      })
      .map(p => {
        const o = {
          id: p.id, name: p.name, class: p.class,
          x: Math.round(p.x), y: Math.round(p.y),
          health: Math.round(p.health), maxHealth: p.maxHealth,
          level: p.level,
          state: p.state || 'idle', facing: p.facing || 'down', animFrame: p.animFrame || 0,
          selectedSkin: p.selectedSkin || `${p.class}_default`,
        };
        if (p.emote) { o.emote = p.emote; o.emoteStart = p.emoteStart; }
        if (p.isHealing) o.isHealing = true;
        // Visual properties for ALL classes
        o.isCustomWizard = p.isCustomWizard || false;
        o.customColor = p.color || p.secondaryColor;
        o.customSecondaryColor = p.secondaryColor;
        o.customBodyStyle = p.bodyStyle || 'wizard';
        o.customProjectileShape = p.projectileShape || 'orb';
        o.customHeadgear = p.headgear || 'pointyHat';
        if (p.activeBuffs && p.activeBuffs.length > 0) {
          o.activeBuffs = p.activeBuffs.filter(b => b.expiresAt > now).map(b => ({ type: b.type, color: b.color }));
        }
        if (p.shieldAmount > 0 && p.shieldUntil > now) { o.shieldActive = true; o.shieldColor = p.shieldColor || '#00bfff'; }
        if (p.transformUntil > now) { o.transformActive = true; o.transformColor = p.transformColor; }
        if (p.giantUntil > now) { o.giantActive = true; }
        return o;
      });

    const payload = {
      tick: gameState.tickCount,
      self: selfData,
      players: otherPlayers,
      enemies: nearbyEnemies,
      projectiles: nearbyProjectiles,
      xpOrbs: nearbyOrbs,
      collectibles: nearbyCollectibles,
      particles: nearbyParticles,
      damageNumbers: nearbyDmgNums,
    };
    if (nearbyNpcs.length > 0) payload.npcs = nearbyNpcs;
    socket.emit('gameState', payload);
  }
}

export function checkEnemyDeath(enemy, killerId) {
  if (enemy.health <= 0) {
    const killer = gameState.players.get(killerId);
    const template = ENEMY_TYPES[enemy.type];
    
    // Bomber explosion
    if (enemy.behavior === 'explode' && template) {
      const explosionRadius = template.explosionRadius || 80;
      const explosionDamage = template.explosionDamage || 30;
      
      // Damage nearby players
      for (const player of gameState.players.values()) {
        if (player.health <= 0) continue;
        if (player.invincible) continue; // Admin invincibility
        const dist = distance(enemy, player);
        if (dist < explosionRadius) {
          const dmgMultiplier = 1 - (dist / explosionRadius);
          let dmg = Math.floor(explosionDamage * dmgMultiplier);
          if (player.shieldAmount > 0 && player.shieldUntil > Date.now()) {
            const absorbed = Math.min(dmg, player.shieldAmount);
            player.shieldAmount -= absorbed;
            dmg -= absorbed;
          }
          if (dmg <= 0) continue;
          player.health -= dmg;
          io.to(player.socketId).emit('damaged', { amount: dmg, fromX: enemy.x, fromY: enemy.y });
          
          if (player.health <= 0) {
            player.health = 0;
            player.deaths = (player.deaths || 0) + 1;
            io.to(player.socketId).emit('died', { killedBy: enemy.type, level: player.level, xp: player.xp });
            savePlayerToDb(player);
          }
        }
      }
      
      // Explosion effect
      io.emit('explosion', { x: enemy.x, y: enemy.y, radius: explosionRadius, color: '#f97316' });
      spawnParticles(enemy.x, enemy.y, '#f97316', 15);
    }
    
    // Spawn XP orbs
    const orbCount = Math.ceil(enemy.xp / 10);
    const xpPerOrb = Math.ceil(enemy.xp / orbCount);
    for (let i = 0; i < orbCount; i++) {
      spawnXpOrb(enemy.x, enemy.y, xpPerOrb);
    }
    
    // Track kill
    if (killer && killer.health > 0) {
      killer.kills = (killer.kills || 0) + 1;
      
      // Update kill quest progress
      if (killer.activeQuests && killer.activeQuests.length > 0) {
        for (const quest of killer.activeQuests) {
          if (quest.type === 'kill' && quest.target === enemy.type && quest.progress < quest.required) {
            quest.progress += 1;
            const killerSocket = io.sockets.sockets.get(killer.socketId);
            if (killerSocket) {
              killerSocket.emit('questProgressUpdate', { 
                questId: quest.id, 
                progress: quest.progress, 
                required: quest.required,
                name: quest.name,
                complete: quest.progress >= quest.required,
              });
            }
          }
        }
      }
    }
    
    // Death particles
    spawnParticles(enemy.x, enemy.y, template?.color || '#ff0000', enemy.isBoss ? 20 : 8);
    
    // Sound event
    io.emit('sound', { type: 'enemyDeath', x: enemy.x, y: enemy.y, isBoss: enemy.isBoss });
    
    // Zone boss death - set respawn timer and drop loot
    if (enemy.isBoss && enemy.zone) {
      onBossDeath(enemy, killer);
    }
    
    // === ON-KILL CLASS PASSIVES ===
    if (killer && killer.health > 0) {
      const killerClass = killer.class || '';
      
      // Cryomancer: Shatter - killing frozen enemies causes ice explosion
      if (killerClass === 'cryomancer' && enemy.frozenUntil > Date.now()) {
        const shatterRadius = 100;
        const shatterDmg = 25;
        for (const nearby of gameState.enemies.values()) {
          if (nearby.id === enemy.id || nearby.health <= 0) continue;
          if (distance(nearby, enemy) < shatterRadius) {
            nearby.health -= shatterDmg;
            nearby.slowedUntil = Math.max(nearby.slowedUntil || 0, Date.now() + 2000);
            spawnDamageNumber(nearby.x, nearby.y - 10, shatterDmg, false, '#4ecdc4');
            checkEnemyDeath(nearby, killer.id);
          }
        }
        io.emit('iceNova', { x: enemy.x, y: enemy.y, radius: shatterRadius });
        spawnParticles(enemy.x, enemy.y, '#4ecdc4', 12);
      }
      
      // Brute: Bloodlust - each kill stacks damage + speed buff
      if (killerClass === 'brute') {
        if (!killer.bloodlustStacks) killer.bloodlustStacks = 0;
        if (!killer.bloodlustBaseMultiplier) killer.bloodlustBaseMultiplier = killer.damageMultiplier || 1;
        killer.bloodlustStacks = Math.min(5, killer.bloodlustStacks + 1);
        const dmgBoost = 1 + killer.bloodlustStacks * 0.05;
        killer.damageMultiplier = killer.bloodlustBaseMultiplier * dmgBoost;
        killer.speedBoostUntil = Date.now() + 10000;
        killer.speedBoostMultiplier = 1 + killer.bloodlustStacks * 0.03;
        // Decay stacks after 10s without a kill
        clearTimeout(killer.bloodlustTimeout);
        killer.bloodlustTimeout = setTimeout(() => {
          killer.bloodlustStacks = 0;
          killer.damageMultiplier = killer.bloodlustBaseMultiplier || 1;
        }, 10000);
        io.to(killer.socketId).emit('passiveProc', { 
          type: 'bloodlust', stacks: killer.bloodlustStacks, 
          message: `Bloodlust x${killer.bloodlustStacks}!` 
        });
      }
      
      // Swordsman: Riposte counter is handled on-hit (in contact damage section)
    }
    
    gameState.enemies.delete(enemy.id);
  }
}
