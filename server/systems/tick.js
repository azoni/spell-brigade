import { v4 as uuidv4 } from 'uuid';
import gameState from '../state.js';
import {
  WORLD, ZONES, SANCTUARY_CENTER, SANCTUARY_RADIUS, SANCTUARY_BUFFER, PORTALS, BUILDINGS,
  getZoneAtPosition, isTooCloseToSanctuary, pointInPolygon
} from '../config/world.js';
import { ENEMY_TYPES, ZONE_BOSS_TYPES } from '../config/enemies.js';
import { CLASSES } from '../config/classes.js';
import { SPELLS } from '../config/spells.js';
import { MAX_ENEMIES, TICK_RATE, VIEW_DISTANCE, XP_ORB } from '../config/constants.js';
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
      
      // Heal if below max HP
      if (player.health < player.maxHealth) {
        const healAmount = inFountain ? (fountain.healRate + 20) : 20;
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

    // Get enemy's zone
    const enemyZone = enemy.zone ? ZONES[enemy.zone] : null;
    const enemyInDungeon = enemy.isDungeon || false;
    
    // Find nearest player IN THE SAME ZONE AND REALM (dungeon isolation)
    let nearestPlayer = null;
    let nearestDist = Infinity;

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
            player.health -= template?.damage || 60;
            spawnDamageNumber(player.x, player.y - 20, template?.damage || 60);
            io.to(player.socketId).emit('damaged', { amount: template?.damage || 60 });
            
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
              player.health -= 30;
              spawnDamageNumber(player.x, player.y - 20, 30);
              io.to(player.socketId).emit('damaged', { amount: 30 });
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
    // Only attack players in same zone (nearestPlayer is already filtered)
    if (enemy.isBoss && nearestPlayer) {
      // Additional check: don't attack players in sanctuary
      const targetZone = getZoneAtPosition(nearestPlayer.x, nearestPlayer.y);
      if (targetZone?.id === 'sanctuary') {
        continue; // Skip boss attacks if target is in sanctuary
      }
      
      const template = ENEMY_TYPES[enemy.type];
      const attackCooldown = template?.attackCooldown || 3000;
      
      if (now - (enemy.lastAbility || 0) > attackCooldown) {
        enemy.lastAbility = now;
        
        const attackType = template?.attackType;
        
        if (attackType === 'spore_burst') {
          // Blossom Behemoth: Shoot homing spores at nearby players
          for (const player of alivePlayers) {
            const playerZone = getZoneAtPosition(player.x, player.y);
            if (playerZone?.id === 'sanctuary') continue; // Skip players in sanctuary
            if (distance(enemy, player) < 800) {
              // Create homing spore projectile
              const id = 'spore_' + Math.random().toString(36).substr(2, 9);
              gameState.projectiles.set(id, {
                id,
                x: enemy.x,
                y: enemy.y,
                targetId: player.id,
                speed: 120,
                damage: 15,
                radius: 10,
                color: '#84cc16',
                fromEnemy: true,
                lifetime: 5000,
                createdAt: now,
              });
            }
          }
          io.emit('sound', { type: 'bossAttack', x: enemy.x, y: enemy.y });
          spawnParticles(enemy.x, enemy.y, '#84cc16', 12);
        }
        
        else if (attackType === 'root_trap') {
          // Ancient Treant: Create damaging root zones
          for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i + Math.random() * 0.5;
            const dist = 200 + Math.random() * 250;
            const rx = enemy.x + Math.cos(angle) * dist;
            const ry = enemy.y + Math.sin(angle) * dist;
            
            // Root trap as a "hazard projectile"
            const id = 'root_' + Math.random().toString(36).substr(2, 9);
            gameState.projectiles.set(id, {
              id,
              x: rx,
              y: ry,
              speed: 0,
              damage: 20,
              radius: 120,
              color: '#166534',
              fromEnemy: true,
              isHazard: true,
              lifetime: 3000,
              createdAt: now,
              pulseRate: 500,
            });
            io.emit('explosion', { x: rx, y: ry, radius: 120, color: '#166534' });
          }
          io.emit('sound', { type: 'bossAttack', x: enemy.x, y: enemy.y });
        }
        
        else if (attackType === 'meteor_rain') {
          // Magma Titan: Call down meteors
          for (let i = 0; i < 5; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 100 + Math.random() * 400;
            const mx = enemy.x + Math.cos(angle) * dist;
            const my = enemy.y + Math.sin(angle) * dist;
            
            io.emit('meteorWarning', { x: mx, y: my, radius: 140, delay: 1500 });
            
            setTimeout(() => {
              // Deal damage in area
              for (const player of gameState.players.values()) {
                if (player.health <= 0) continue;
                if (player.invincible) continue; // Admin invincibility
                if (distance({ x: mx, y: my }, player) < 140) {
                  player.health -= 40;
                  io.to(player.socketId).emit('damaged', { amount: 40, fromX: mx, fromY: my });
                  if (player.health <= 0) {
                    player.health = 0;
                    player.deaths = (player.deaths || 0) + 1;
                    io.to(player.socketId).emit('died', { killedBy: 'Meteor', level: player.level, xp: player.xp });
                    savePlayerToDb(player);
                  }
                }
              }
              io.emit('explosion', { x: mx, y: my, radius: 140, color: '#f97316' });
            }, 1500);
          }
          io.emit('sound', { type: 'bossAttack', x: enemy.x, y: enemy.y });
        }
        
        else if (attackType === 'ice_breath') {
          // Frost Wyrm: Cone attack that freezes and damages
          const dir = nearestPlayer ? normalize({ 
            x: nearestPlayer.x - enemy.x, 
            y: nearestPlayer.y - enemy.y 
          }) : { x: 1, y: 0 };
          
          const coneAngle = Math.PI / 3; // 60 degree cone
          const coneRange = 500;
          const baseAngle = Math.atan2(dir.y, dir.x);
          
          for (const player of alivePlayers) {
            const toPlayer = { x: player.x - enemy.x, y: player.y - enemy.y };
            const playerDist = Math.sqrt(toPlayer.x * toPlayer.x + toPlayer.y * toPlayer.y);
            
            if (playerDist < coneRange) {
              const playerAngle = Math.atan2(toPlayer.y, toPlayer.x);
              let angleDiff = Math.abs(playerAngle - baseAngle);
              if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
              
              if (angleDiff < coneAngle / 2) {
                if (player.invincible) continue; // Admin invincibility
                player.health -= 35;
                player.frozenUntil = now + 2000;
                io.to(player.socketId).emit('damaged', { amount: 35, fromX: enemy.x, fromY: enemy.y });
                if (player.health <= 0) {
                  player.health = 0;
                  player.deaths = (player.deaths || 0) + 1;
                  io.to(player.socketId).emit('died', { killedBy: 'Frost Wyrm', level: player.level, xp: player.xp });
                  savePlayerToDb(player);
                }
              }
            }
          }
          io.emit('iceNova', { x: enemy.x, y: enemy.y, radius: coneRange });
          io.emit('sound', { type: 'bossAttack', x: enemy.x, y: enemy.y });
        }
        
        else if (attackType === 'void_pulse') {
          // Void Overlord: Pull players in, then explode
          const pullRadius = 600;
          const explodeRadius = 350;
          
          // Warning
          io.emit('meteorWarning', { x: enemy.x, y: enemy.y, radius: explodeRadius, delay: 2000 });
          
          // Pull effect
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
          
          // Explode after delay
          setTimeout(() => {
            clearInterval(pullInterval);
            for (const player of gameState.players.values()) {
              if (player.health <= 0) continue;
              if (player.invincible) continue; // Admin invincibility
              if (distance(enemy, player) < explodeRadius) {
                player.health -= 60;
                io.to(player.socketId).emit('damaged', { amount: 60, fromX: enemy.x, fromY: enemy.y });
                if (player.health <= 0) {
                  player.health = 0;
                  player.deaths = (player.deaths || 0) + 1;
                  io.to(player.socketId).emit('died', { killedBy: 'Void Overlord', level: player.level, xp: player.xp });
                  savePlayerToDb(player);
                }
              }
            }
            io.emit('explosion', { x: enemy.x, y: enemy.y, radius: explodeRadius, color: '#7c3aed' });
          }, 2000);
          
          io.emit('sound', { type: 'bossAttack', x: enemy.x, y: enemy.y });
          spawnParticles(enemy.x, enemy.y, '#7c3aed', 15);
        }
      }
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
                  player.health -= 50 + (enemy.phase - 1) * 15;
                  io.to(player.socketId).emit('damaged', { amount: 50, fromX: enemy.x, fromY: enemy.y });
                  spawnDamageNumber(player.x, player.y - 20, 50);
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
              player.health -= 40 + (enemy.phase - 1) * 10;
              io.to(player.socketId).emit('damaged', { amount: 40, fromX: enemy.x, fromY: enemy.y });
              spawnDamageNumber(player.x, player.y - 20, 40);
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

    // Wander if no player nearby (keeps enemies moving within zone)
    if (!nearestPlayer || nearestDist > 400) {
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
    
    if (nearestPlayer && nearestDist <= (enemy.aggroRange || 400)) {
      // Check if we would enter sanctuary buffer - don't chase into safe zone
      const playerTooClose = isTooCloseToSanctuary(nearestPlayer.x, nearestPlayer.y);
      
      if (!playerTooClose) {
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
          // ALL world enemies must stay in their zone (polygon check)
          if (enemyZone?.polygon) {
            if (!pointInPolygon(newX, newY, enemyZone.polygon)) {
              // Stay at current position if would leave zone
              newX = enemy.x;
              newY = enemy.y;
            }
          }
          
          // Also prevent entering sanctuary buffer
          if (isTooCloseToSanctuary(newX, newY)) {
            newX = enemy.x;
            newY = enemy.y;
          }
        }
        
        enemy.x = newX;
        enemy.y = newY;
        
        // Update facing
        if (Math.abs(dir.x) > Math.abs(dir.y)) {
          enemy.facing = dir.x > 0 ? 'right' : 'left';
        } else {
          enemy.facing = dir.y > 0 ? 'down' : 'up';
        }
      }

      // Attack player on collision (only if in same zone and not in sanctuary)
      // Dungeon enemies skip world zone checks - they use dungeonId isolation instead
      const attackTargetZone = enemyInDungeon ? null : getZoneAtPosition(nearestPlayer.x, nearestPlayer.y);
      const targetInSanctuary = attackTargetZone?.id === 'sanctuary';
      const canAttack = enemyInDungeon
        ? true  // Dungeon enemies can always attack (targeting already filtered by dungeonId)
        : (!targetInSanctuary && (!enemyZone || !attackTargetZone || attackTargetZone.id === enemyZone.id));
      
      const collisionDist = enemy.radius + 16; // player radius
      if (canAttack && nearestDist < collisionDist && now - enemy.lastAttack > 500) {
        // Check if player is invulnerable or invincible
        if ((!nearestPlayer.invulnerableUntil || nearestPlayer.invulnerableUntil < now) && !nearestPlayer.invincible) {
          nearestPlayer.health -= enemy.damage;
          enemy.lastAttack = now;
          
          // Notify player of damage for screen shake
          io.to(nearestPlayer.socketId).emit('damaged', {
            amount: enemy.damage,
            fromX: enemy.x,
            fromY: enemy.y,
          });
          io.emit('sound', { type: 'playerHit', x: nearestPlayer.x, y: nearestPlayer.y });

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
        
        if (distance(proj, enemy) < proj.radius + enemy.radius) {
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
      
      if (distance(proj, enemy) < proj.radius + enemy.radius) {
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
          nearestPlayer.maxHealth += 12;
          nearestPlayer.health = Math.min(nearestPlayer.health + 40, nearestPlayer.maxHealth);
          nearestPlayer.baseSpeed += 2; // Speed scales with level
          nearestPlayer.damageMultiplier = (nearestPlayer.damageMultiplier || 1) * 1.03; // 3% more damage per level
          
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
      .map(e => ({
        id: e.id,
        type: e.behavior === 'ambush' && !e.revealed ? 'xpOrb' : e.type,
        name: e.name,
        x: Math.round(e.x),
        y: Math.round(e.y),
        health: Math.round(e.health),
        maxHealth: e.maxHealth,
        radius: e.radius || 14,
        facing: e.facing || 'down',
        animFrame: e.animFrame || 0,
        isSlowed: e.slowedUntil > now,
        isFrozen: e.frozenUntil > now,
        isBoss: e.isBoss || false,
        isMiniBoss: e.isMiniBoss || false,
        isCustomBoss: e.isCustomBoss || false,
        behavior: e.behavior,
        isCharging: e.isCharging || false,
        color: e.color || undefined,
        phase: e.phase || undefined,
      }));
    
    const nearbyProjectiles = [...gameState.projectiles.values()]
      .filter(p => Math.abs(p.x - px) < VIEW_DISTANCE && Math.abs(p.y - py) < VIEW_DISTANCE)
      .map(p => ({
        id: p.id, x: Math.round(p.x), y: Math.round(p.y),
        radius: p.radius, color: p.color, trailColor: p.trailColor,
        spellId: p.spellId, ownerClass: p.ownerClass, level: p.ownerLevel || 1,
        projectileShape: p.projectileShape || null,
        vx: p.vx ? Math.round(p.vx) : undefined,
        vy: p.vy ? Math.round(p.vy) : undefined,
      }));
    
    const nearbyOrbs = [...gameState.xpOrbs.values()]
      .filter(o => Math.abs(o.x - px) < VIEW_DISTANCE && Math.abs(o.y - py) < VIEW_DISTANCE)
      .map(o => ({ id: o.id, x: Math.round(o.x), y: Math.round(o.y), amount: o.amount }));
    
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
    const nearbyNpcs = [...gameState.npcs.values()]
      .filter(npc => Math.abs(npc.currentX - px) < VIEW_DISTANCE && Math.abs(npc.currentY - py) < VIEW_DISTANCE)
      .map(npc => ({
        id: npc.id,
        name: npc.name,
        type: npc.type,
        x: Math.round(npc.currentX),
        y: Math.round(npc.currentY),
        color: npc.color,
        emoji: npc.emoji,
        facing: npc.facing || 'down',
        interactRange: npc.interactRange,
        stationary: npc.stationary,
      }));
    
    socket.emit('gameState', {
      tick: gameState.tickCount,
      timestamp: now,
      players: [...gameState.players.values()]
        .filter(p => {
          // Only show players in same realm (dungeon vs world)
          const pInDungeon = p.inDungeon || false;
          if (pInDungeon !== playerInDungeon) return false;
          // Within dungeons, only show players in the same dungeon instance
          if (playerInDungeon && pInDungeon) {
            if ((p.customDungeonId || 'default') !== (player.customDungeonId || 'default')) return false;
          }
          return true;
        })
        .map(p => ({
        id: p.id, name: p.name, class: p.class,
        x: Math.round(p.x), y: Math.round(p.y),
        health: Math.round(p.health), maxHealth: p.maxHealth,
        level: p.level, xp: p.xp, totalXp: p.totalXp || 0, xpToLevel: xpForLevel(p.level),
        kills: p.kills || 0, deaths: p.deaths || 0,
        state: p.state || 'idle', facing: p.facing || 'down', animFrame: p.animFrame || 0,
        selectedSkin: p.selectedSkin || `${p.class}_default`,
        cooldowns: p.id === player.id ? cooldowns : {},
        emote: p.emote || null, emoteStart: p.emoteStart || null,
        isHealing: p.isHealing || false,
        inFountain: p.inFountain || false,
        fountainBoostRemaining: (p.id === player.id && p.fountainSpeedBoostUntil && p.fountainSpeedBoostUntil > now && !p.inFountain) 
          ? Math.ceil((p.fountainSpeedBoostUntil - now) / 1000) : 0,
        bossKills: p.bossKills || {},
        upgrades: p.upgrades || { health: 0, damage: 0, speed: 0, cooldown: 0, attackSpeed: 0 },
        inDungeon: p.inDungeon || false,
        damageMultiplier: p.damageMultiplier || 1,
        speedMultiplier: p.speedMultiplier || 1,
        cooldownMultiplier: p.cooldownMultiplier || 1,
        attackSpeedMultiplier: p.attackSpeedMultiplier || 1,
        isAdmin: p.isAdmin || false,
        isCustomWizard: p.isCustomWizard || false,
        customColor: p.isCustomWizard ? p.color : undefined,
        customSecondaryColor: p.isCustomWizard ? p.secondaryColor : undefined,
        customClassName: p.isCustomWizard ? p.className : undefined,
        customIconStyle: p.isCustomWizard ? (p.iconStyle || 'star') : undefined,
        customBodyStyle: p.isCustomWizard ? (p.bodyStyle || 'wizard') : undefined,
        customProjectileShape: p.isCustomWizard ? (p.projectileShape || 'orb') : undefined,
        customHeadgear: p.isCustomWizard ? (p.headgear || 'pointyHat') : undefined,
      })),
      enemies: nearbyEnemies,
      projectiles: nearbyProjectiles,
      xpOrbs: nearbyOrbs,
      particles: nearbyParticles,
      damageNumbers: nearbyDmgNums,
      npcs: nearbyNpcs,
    });
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
          const dmg = Math.floor(explosionDamage * dmgMultiplier);
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
    }
    
    // Death particles
    spawnParticles(enemy.x, enemy.y, template?.color || '#ff0000', enemy.isBoss ? 20 : 8);
    
    // Sound event
    io.emit('sound', { type: 'enemyDeath', x: enemy.x, y: enemy.y, isBoss: enemy.isBoss });
    
    // Zone boss death - set respawn timer and drop loot
    if (enemy.isBoss && enemy.zone) {
      onBossDeath(enemy, killer);
    }
    
    gameState.enemies.delete(enemy.id);
  }
}
