import { v4 as uuidv4 } from 'uuid';
import gameState from '../state.js';
import { ZONES, getRandomPointInZone, getZoneAtPosition } from '../config/world.js';
import { ENEMY_TYPES, ZONE_BOSS_TYPES } from '../config/enemies.js';
import { CLASSES } from '../config/classes.js';
import { MAX_ENEMIES } from '../config/constants.js';
import { distance, normalize, spawnXpOrb } from './helpers.js';
import { savePlayerToDb } from '../db/index.js';

const BOSS_RESPAWN_TIME = 30 * 1000; // 30 seconds

// io reference - set via init()
let io = null;

export function initEnemySystem(ioRef) {
  io = ioRef;
}

// ===========================================
// ENEMY SPAWNING (Zone-based)
// ===========================================
export function getSpawnPosition(forZone = null) {
  if (forZone && ZONES[forZone]) {
    const zone = ZONES[forZone];
    if (zone.polygon) {
      const point = getRandomPointInZone(forZone);
      return {
        x: point.x,
        y: point.y,
        zone: forZone,
      };
    }
  }
  
  // Default: spawn in random non-safe zone
  const spawnableZones = Object.keys(ZONES).filter(z => !ZONES[z].isSafe && ZONES[z].polygon);
  if (spawnableZones.length > 0) {
    const randomZone = spawnableZones[Math.floor(Math.random() * spawnableZones.length)];
    const point = getRandomPointInZone(randomZone);
    return { x: point.x, y: point.y, zone: randomZone };
  }
  
  // Fallback to meadow
  const point = getRandomPointInZone('meadow');
  return { x: point.x, y: point.y, zone: 'meadow' };
}

export function spawnEnemyInZone(zoneId) {
  const zone = ZONES[zoneId];
  if (!zone || zone.isSafe || zone.enemyTypes.length === 0) return;
  
  const pos = getSpawnPosition(zoneId);
  const enemyType = zone.enemyTypes[Math.floor(Math.random() * zone.enemyTypes.length)];
  
  spawnEnemy(enemyType, pos, zone.enemyLevel, zone.xpMultiplier);
}

export function spawnEnemy(forceType = null, position = null, levelBoost = 0, xpMultiplier = 1) {
  // Hard cap on total enemies
  if (gameState.enemies.size >= MAX_ENEMIES) {
    return null;
  }
  
  const id = uuidv4();
  const pos = position || getSpawnPosition();
  
  // Determine zone for this position
  const zone = pos.zone ? ZONES[pos.zone] : getZoneAtPosition(pos.x, pos.y);
  
  // Weight enemy types by difficulty - adjusts based on zone
  const playerCount = [...gameState.players.values()].filter(p => p.health > 0).length;
  
  let type = forceType;
  if (!type) {
    // Use zone enemy types if available
    if (zone && zone.enemyTypes && zone.enemyTypes.length > 0) {
      type = zone.enemyTypes[Math.floor(Math.random() * zone.enemyTypes.length)];
    } else {
      // Fallback weights
      const weights = {
        slime: 35,
        bat: 25,
        spider: 20,
        skeleton: 12,
        ghost: 8,
      };
      const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
      let random = Math.random() * totalWeight;
      for (const [enemyType, weight] of Object.entries(weights)) {
        random -= weight;
        if (random <= 0) {
          type = enemyType;
          break;
        }
      }
    }
  }
  
  // Boss spawn chance - use zone-specific boss type (NOT dungeon dragon!)
  if (zone?.bossChance && Math.random() < zone.bossChance && playerCount >= 2) {
    const zoneBossType = ZONE_BOSS_TYPES[zone.id];
    if (zoneBossType) {
      const existingBossId = gameState.zoneBosses.get(zone.id);
      if (!existingBossId || !gameState.enemies.has(existingBossId)) {
        type = zoneBossType;
      }
    }
  }
  
  const template = ENEMY_TYPES[type];
  if (!template) return;
  
  // Scale enemy stats by zone level
  const scaleFactor = 1 + (levelBoost * 0.2);
  const xpMult = xpMultiplier || 1;
  
  const enemy = {
    id,
    type,
    name: template.name,
    x: pos.x,
    y: pos.y,
    health: Math.floor(template.health * scaleFactor),
    maxHealth: Math.floor(template.health * scaleFactor),
    damage: Math.floor(template.damage * scaleFactor),
    speed: template.speed,
    baseSpeed: template.speed,
    radius: template.radius,
    xp: Math.floor(template.xp * xpMult),
    color: template.color,
    behavior: template.behavior || 'chase',
    slowedUntil: 0,
    frozenUntil: 0,
    targetId: null,
    lastAttack: 0,
    lastAbility: 0,
    animFrame: 0,
    animTime: 0,
    revealed: template.behavior !== 'ambush',
    resistant: template.resistant || [],
    isBoss: template.isBoss || false,
    zone: zone?.id,
  };
  
  gameState.enemies.set(id, enemy);
  
  // Announce boss spawn
  if (template.isBoss) {
    io.emit('bossSpawn', { type, name: template.name, zone: zone?.id });
  }
  
  return id;
}

// ===========================================
// ZONE BOSS MANAGEMENT
// ===========================================
export function spawnZoneBoss(zoneId) {
  const bossType = ZONE_BOSS_TYPES[zoneId];
  if (!bossType) return null;
  
  const template = ENEMY_TYPES[bossType];
  if (!template) return null;
  
  // Check if boss already exists in this zone
  if (gameState.zoneBosses.has(zoneId)) {
    const existingBossId = gameState.zoneBosses.get(zoneId);
    if (gameState.enemies.has(existingBossId)) {
      return existingBossId; // Boss still alive
    }
  }
  
  // Check respawn timer
  if (gameState.bossRespawnTimers.has(zoneId)) {
    if (Date.now() < gameState.bossRespawnTimers.get(zoneId)) {
      return null; // Still on respawn timer
    }
    gameState.bossRespawnTimers.delete(zoneId);
  }
  
  // Get spawn position in the zone
  const zone = ZONES[zoneId];
  if (!zone || zone.isSafe) return null;
  
  const sanctuaryCenter = { x: 10500, y: 9000 };
  const minDistanceFromSanctuary = 1500;
  
  let pos = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidatePos = getRandomPointInZone(zoneId);
    if (!candidatePos) continue;
    
    const distToSanctuary = Math.sqrt(
      Math.pow(candidatePos.x - sanctuaryCenter.x, 2) + 
      Math.pow(candidatePos.y - sanctuaryCenter.y, 2)
    );
    
    if (distToSanctuary >= minDistanceFromSanctuary) {
      pos = candidatePos;
      break;
    }
  }
  
  if (!pos) return null;
  
  const bossId = spawnEnemy(bossType, pos, 0, 1);
  if (bossId) {
    gameState.zoneBosses.set(zoneId, bossId);
    console.log(`Zone boss spawned: ${template.name} in ${zone.name}`);
  }
  
  return bossId;
}

export function initZoneBosses() {
  for (const zoneId of Object.keys(ZONE_BOSS_TYPES)) {
    spawnZoneBoss(zoneId);
  }
}

// ===========================================
// BOSS DEATH HANDLING
// ===========================================
export function onBossDeath(enemy, killer) {
  const zoneId = enemy.zone;
  
  // Dragon boss killed - spawn victory portal
  if (enemy.type === 'boss_dragon') {
    console.log('🐉 DRAGON DEFEATED! Spawning victory portal...');
    
    io.emit('dragonDefeated', { 
      x: enemy.x, 
      y: enemy.y,
      killerName: killer?.name || 'Unknown Hero',
    });
    
    gameState.dungeonVictoryPortal = {
      x: enemy.x,
      y: enemy.y - 350,
      active: true,
      createdAt: Date.now(),
    };
    
    io.emit('chat', {
      type: 'system',
      text: `🐉🏆 THE INFERNAL DRAGON HAS BEEN SLAIN BY ${(killer?.name || 'A BRAVE HERO').toUpperCase()}! 🏆🐉`,
    });
    
    if (killer) {
      const dragonRewardXp = 20000;
      killer.xp += dragonRewardXp;
      killer.totalXp += dragonRewardXp;
      killer.bossKills = killer.bossKills || {};
      killer.bossKills.dragon = true;
      
      const socket = io.sockets.sockets.get(killer.socketId);
      if (socket) {
        socket.emit('dragonSlayerReward', {
          xp: dragonRewardXp,
          title: 'Dragonslayer',
          voidlordUnlocked: true,
        });
      }
      
      savePlayerToDb(killer);
    }
    
    return;
  }
  
  // Custom dungeon boss killed
  if (enemy.isCustomBoss && enemy.customDungeonId) {
    const cfgId = enemy.customDungeonId;
    const cfg = gameState.customDungeons.get(cfgId);
    console.log(`⚔️ Custom boss "${enemy.name}" defeated!`);
    
    io.emit('dragonDefeated', { x: enemy.x, y: enemy.y, killerName: killer?.name || 'Unknown Hero' });
    gameState.dungeonVictoryPortal = { x: enemy.x, y: enemy.y - 350, active: true, createdAt: Date.now() };
    
    io.emit('chat', { type: 'system', text: `🏆 ${enemy.name.toUpperCase()} HAS BEEN SLAIN BY ${(killer?.name || 'A BRAVE HERO').toUpperCase()}! 🏆` });
    
    if (cfg) cfg.clears = (cfg.clears || 0) + 1;
    
    if (killer) {
      const rewardXp = enemy.killReward || 20000;
      killer.xp += rewardXp;
      killer.totalXp += rewardXp;
      
      const socket = io.sockets.sockets.get(killer.socketId);
      if (socket) {
        socket.emit('dragonSlayerReward', { xp: rewardXp, title: `Slayer of ${enemy.name}` });
      }
      savePlayerToDb(killer);
    }
    
    return;
  }
  
  if (zoneId && ZONE_BOSS_TYPES[zoneId]) {
    gameState.zoneBosses.delete(zoneId);
    gameState.bossRespawnTimers.set(zoneId, Date.now() + BOSS_RESPAWN_TIME);
    console.log(`💀 Zone boss defeated: ${enemy.name} in ${zoneId} - respawns in 30 seconds`);
    
    // Track boss kills for quest progress
    if (killer) {
      if (!killer.bossKills) killer.bossKills = {};
      killer.bossKills[zoneId] = true;
      
      const QUEST_BOSSES = ['meadow', 'forest', 'volcanic', 'frozen', 'abyss'];
      const defeatedCount = QUEST_BOSSES.filter(z => killer.bossKills[z]).length;
      
      if (defeatedCount === QUEST_BOSSES.length && !killer.questComplete) {
        killer.questComplete = true;
        killer.questReward = 'realm_conqueror';
        
        const rewardXp = 5000;
        killer.xp += rewardXp;
        killer.totalXp += rewardXp;
        
        const socket = io.sockets.sockets.get(killer.socketId);
        if (socket) {
          socket.emit('questComplete', {
            quest: 'conquer_realm',
            title: 'Realm Conqueror',
            reward: 'realm_conqueror',
            xp: rewardXp,
          });
        }
        
        io.emit('chat', {
          type: 'system',
          text: `🏆 ${killer.name} has CONQUERED THE REALM! All zone bosses defeated!`,
        });
        
        console.log(`🏆 ${killer.name} completed "Conquer the Realm" quest!`);
        savePlayerToDb(killer);
      }
    }
    
    // Calculate drops for the killer
    let drops = [];
    if (killer) {
      const dropResult = calculateBossDrops(enemy.type, killer.class);
      drops = dropResult.items || [];
      
      if (dropResult.xp) {
        killer.xp += dropResult.xp;
        killer.totalXp += dropResult.xp;
        console.log(`💰 ${killer.name} received ${dropResult.xp} bonus XP from boss`);
      }
      
      if (drops.length > 0) {
        const socket = io.sockets.sockets.get(killer.socketId);
        
        for (const drop of drops) {
          if (drop.replacesSlot) {
            if (!killer.alternateSpells) killer.alternateSpells = {};
            killer.alternateSpells[drop.id] = drop;
          } else {
            if (!killer.spellUpgrades) killer.spellUpgrades = [];
            if (!killer.spellUpgrades.includes(drop.id)) {
              killer.spellUpgrades.push(drop.id);
            }
          }
        }
        
        savePlayerToDb(killer);
        
        if (socket) {
          socket.emit('spellDrops', {
            bossName: enemy.name,
            items: drops.map(item => ({
              id: item.id,
              name: item.name,
              description: item.description,
              rarity: item.rarity,
              spell: item.spell || item.replacesSlot,
              isAlternate: !!item.replacesSlot,
            }))
          });
          console.log(`✨ ${killer.name} received ${drops.length} spell upgrade(s)!`);
        }
      }
    }
    
    io.emit('bossDefeated', { 
      name: enemy.name, 
      zone: zoneId,
      x: enemy.x,
      y: enemy.y,
      bossType: enemy.type,
      respawnIn: BOSS_RESPAWN_TIME,
      killerName: killer?.name || 'Unknown',
      dropsCount: drops.length,
    });
  }
}

// ===========================================
// BOSS DROP TABLES
// ===========================================
function calculateBossDrops(bossType, playerClass) {
  const BOSS_DROP_TABLES = {
    blossom_behemoth: {
      guaranteedXp: 400,
      drops: [
        { item: 'blazing_speed', chance: 0.2, class: 'pyromancer' },
        { item: 'permafrost', chance: 0.2, class: 'cryomancer' },
        { item: 'mana_surge', chance: 0.2, class: 'arcanist' },
      ],
    },
    ancient_treant: {
      guaranteedXp: 600,
      drops: [
        { item: 'inferno_core', chance: 0.15, class: 'pyromancer' },
        { item: 'glacial_shards', chance: 0.15, class: 'cryomancer' },
        { item: 'void_touched', chance: 0.15, class: 'arcanist' },
      ],
    },
    magma_titan: {
      guaranteedXp: 1000,
      drops: [
        { item: 'phoenix_flame', chance: 0.1, class: 'pyromancer' },
        { item: 'absolute_zero', chance: 0.08, class: 'cryomancer' },
        { item: 'reality_tear', chance: 0.08, class: 'arcanist' },
      ],
    },
    frost_wyrm: {
      guaranteedXp: 1200,
      drops: [
        { item: 'dragons_breath', chance: 0.08, class: 'pyromancer' },
        { item: 'ice_lance', chance: 0.1, class: 'cryomancer' },
        { item: 'blink', chance: 0.1, class: 'arcanist' },
      ],
    },
    void_overlord: {
      guaranteedXp: 2000,
      drops: [
        { item: 'living_bomb', chance: 0.1, class: 'pyromancer' },
        { item: 'frost_armor', chance: 0.1, class: 'cryomancer' },
        { item: 'arcane_orb', chance: 0.1, class: 'arcanist' },
      ],
    },
    crystal_golem: {
      guaranteedXp: 500,
      drops: [
        { item: 'blazing_speed', chance: 0.15, class: 'pyromancer' },
        { item: 'permafrost', chance: 0.15, class: 'cryomancer' },
        { item: 'mana_surge', chance: 0.15, class: 'arcanist' },
      ],
    },
    boss_meadow: {
      guaranteedXp: 400,
      drops: [
        { item: 'blazing_speed', chance: 0.2, class: 'pyromancer' },
        { item: 'permafrost', chance: 0.2, class: 'cryomancer' },
        { item: 'mana_surge', chance: 0.2, class: 'arcanist' },
      ],
    },
    boss_forest: {
      guaranteedXp: 600,
      drops: [
        { item: 'inferno_core', chance: 0.15, class: 'pyromancer' },
        { item: 'glacial_shards', chance: 0.15, class: 'cryomancer' },
        { item: 'void_touched', chance: 0.15, class: 'arcanist' },
      ],
    },
    boss_volcanic: {
      guaranteedXp: 1000,
      drops: [
        { item: 'phoenix_flame', chance: 0.1, class: 'pyromancer' },
        { item: 'absolute_zero', chance: 0.08, class: 'cryomancer' },
        { item: 'reality_tear', chance: 0.08, class: 'arcanist' },
      ],
    },
    boss_frozen: {
      guaranteedXp: 1200,
      drops: [
        { item: 'dragons_breath', chance: 0.08, class: 'pyromancer' },
        { item: 'ice_lance', chance: 0.1, class: 'cryomancer' },
        { item: 'blink', chance: 0.1, class: 'arcanist' },
      ],
    },
    boss_abyss: {
      guaranteedXp: 2000,
      drops: [
        { item: 'living_bomb', chance: 0.1, class: 'pyromancer' },
        { item: 'frost_armor', chance: 0.1, class: 'cryomancer' },
        { item: 'arcane_orb', chance: 0.1, class: 'arcanist' },
      ],
    },
    boss_crystal: {
      guaranteedXp: 500,
      drops: [
        { item: 'blazing_speed', chance: 0.15, class: 'pyromancer' },
        { item: 'permafrost', chance: 0.15, class: 'cryomancer' },
        { item: 'mana_surge', chance: 0.15, class: 'arcanist' },
      ],
    },
  };
  
  const SPELL_UPGRADES = {
    // Pyromancer
    blazing_speed: { id: 'blazing_speed', name: 'Blazing Speed', description: 'Fireballs travel 50% faster and pierce one enemy', rarity: 'uncommon', spell: 'fireball' },
    inferno_core: { id: 'inferno_core', name: 'Inferno Core', description: 'Fireballs explode on impact dealing area damage', rarity: 'rare', spell: 'fireball' },
    phoenix_flame: { id: 'phoenix_flame', name: 'Phoenix Flame', description: 'Meteors leave burning ground that damages over time', rarity: 'epic', spell: 'meteor' },
    dragons_breath: { id: 'dragons_breath', name: "Dragon's Breath", description: 'Breathe a continuous stream of fire (alternate spell)', rarity: 'epic', replacesSlot: 'primary' },
    living_bomb: { id: 'living_bomb', name: 'Living Bomb', description: 'Mark an enemy to explode after 3 seconds', rarity: 'rare', replacesSlot: 'secondary' },
    // Cryomancer
    permafrost: { id: 'permafrost', name: 'Permafrost', description: 'Frostbolts have 20% chance to freeze enemies solid', rarity: 'uncommon', spell: 'frostbolt' },
    glacial_shards: { id: 'glacial_shards', name: 'Glacial Shards', description: 'Frostbolts split into 3 smaller shards on impact', rarity: 'rare', spell: 'frostbolt' },
    absolute_zero: { id: 'absolute_zero', name: 'Absolute Zero', description: 'Ice Nova freezes 2x longer and shatters frozen enemies', rarity: 'legendary', spell: 'ice_nova' },
    ice_lance: { id: 'ice_lance', name: 'Ice Lance', description: 'Pierce all enemies, bonus damage to frozen targets', rarity: 'epic', replacesSlot: 'primary' },
    frost_armor: { id: 'frost_armor', name: 'Frost Armor', description: 'Ice shield reduces damage and freezes attackers', rarity: 'rare', replacesSlot: 'secondary' },
    // Arcanist
    mana_surge: { id: 'mana_surge', name: 'Mana Surge', description: 'Every 5th Arcane Missile deals triple damage', rarity: 'uncommon', spell: 'arcane_missile' },
    void_touched: { id: 'void_touched', name: 'Void Touched', description: 'Arcane Missiles home in on enemies', rarity: 'rare', spell: 'arcane_missile' },
    reality_tear: { id: 'reality_tear', name: 'Reality Tear', description: 'Arcane Storm creates a black hole vortex', rarity: 'legendary', spell: 'arcane_storm' },
    arcane_orb: { id: 'arcane_orb', name: 'Arcane Orb', description: 'Slow-moving orb that deals massive damage', rarity: 'epic', replacesSlot: 'primary' },
    blink: { id: 'blink', name: 'Blink', description: 'Teleport short distance leaving damaging afterimages', rarity: 'rare', replacesSlot: 'secondary' },
  };
  
  const dropTable = BOSS_DROP_TABLES[bossType];
  if (!dropTable) return { xp: 100, items: [] };
  
  const result = {
    xp: dropTable.guaranteedXp,
    items: [],
  };
  
  for (const drop of dropTable.drops) {
    if (drop.class !== playerClass) continue;
    if (Math.random() < drop.chance) {
      const upgrade = SPELL_UPGRADES[drop.item];
      if (upgrade) {
        result.items.push(upgrade);
      }
    }
  }
  
  return result;
}

// ===========================================
// DUNGEON SPAWNING
// ===========================================
export function spawnDungeonEnemies(player) {
  const dungeonEnemies = ['dungeon_skeleton', 'dungeon_wraith', 'dungeon_golem', 'dungeon_demon'];
  const baseY = player.y + 200;
  
  const numEnemies = Math.min(6, 2 + Math.floor(player.y / 1000));
  const depthMultiplier = 1 + (player.y / 6000) * 2.5;
  
  for (let i = 0; i < numEnemies; i++) {
    const type = dungeonEnemies[Math.floor(Math.random() * dungeonEnemies.length)];
    const template = ENEMY_TYPES[type];
    if (!template) continue;
    
    const x = 900 + (i - numEnemies/2) * 150 + Math.random() * 100;
    const y = baseY + Math.random() * 150;
    
    if (y > 5000) continue;
    
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
      x,
      y,
      zone: 'dungeon',
      isDungeon: true,
      dungeonId: player.customDungeonId || 'default',
      facing: 'up',
      animFrame: 0,
      slowedUntil: 0,
      frozenUntil: 0,
    };
    
    gameState.enemies.set(enemy.id, enemy);
  }
}

export function spawnDragonBoss() {
  const template = ENEMY_TYPES.boss_dragon;
  if (!template) return;
  
  for (const enemy of gameState.enemies.values()) {
    if (enemy.type === 'boss_dragon') return;
  }
  
  const dragon = {
    id: uuidv4(),
    type: 'boss_dragon',
    name: template.name,
    health: template.health,
    maxHealth: template.health,
    baseSpeed: template.speed,
    damage: template.damage,
    radius: template.radius,
    xp: template.xp,
    color: template.color,
    behavior: 'boss_dragon',
    isBoss: true,
    isDungeon: true,
    dungeonId: 'default',
    x: 900,
    y: 5500,
    zone: 'dungeon',
    facing: 'up',
    animFrame: 0,
    slowedUntil: 0,
    frozenUntil: 0,
    lastAbility: 0,
    phase: 1,
    attackPattern: 0,
    attackRange: template.attackRange || 600,
  };
  
  gameState.enemies.set(dragon.id, dragon);
  console.log('🐉 Dragon boss spawned!');
}

export function spawnCustomBoss(config, player) {
  const b = config.boss;
  const center = config.layout.bossCenter;
  
  for (const enemy of gameState.enemies.values()) {
    if (enemy.isCustomBoss && enemy.customDungeonId === config.id) return;
  }
  
  const boss = {
    id: uuidv4(),
    type: 'custom_boss',
    name: b.name,
    health: b.health,
    maxHealth: b.health,
    baseSpeed: b.speed,
    damage: b.damage,
    radius: b.radius,
    xp: b.xp || 15000,
    color: b.color,
    behavior: 'boss_dragon',
    isBoss: true,
    isCustomBoss: true,
    isDungeon: true,
    dungeonId: config.id,
    customDungeonId: config.id,
    x: center.x,
    y: center.y,
    zone: 'dungeon',
    facing: 'up',
    animFrame: 0,
    slowedUntil: 0,
    frozenUntil: 0,
    lastAbility: 0,
    phase: 1,
    attackPattern: 0,
    attackRange: b.attackRange || 600,
    attackCooldown: b.attackCooldown || 1600,
    killReward: b.killReward || 20000,
  };
  
  gameState.enemies.set(boss.id, boss);
  console.log(`⚔️ Custom boss "${b.name}" spawned!`);
}

// ===========================================
// PROJECTILE CREATION
// ===========================================
export function createProjectile(player, spell, targetX, targetY, targetPlayerId = null) {
  if (gameState.projectiles.size > 300) {
    return null;
  }
  
  const id = uuidv4();
  const dir = normalize({ x: targetX - player.x, y: targetY - player.y });
  const upgrades = player.spellUpgrades || [];
  
  let speed = spell.speed;
  let isHoming = spell.homing || false;
  
  if (spell.id === 'fireball' && upgrades.includes('blazing_speed')) {
    speed *= 1.5;
  }
  
  if (spell.id === 'arcane_missile' && upgrades.includes('void_touched')) {
    isHoming = true;
  }
  
  const classData = CLASSES[player.class];
  const canPvP = (classData?.canPvP && player.pvpEnabled === true) || false;
  
  const proj = {
    id,
    ownerId: player.id,
    ownerClass: player.class,
    ownerLevel: player.level || 1,
    spellId: spell.id,
    x: player.x,
    y: player.y,
    vx: dir.x * speed,
    vy: dir.y * speed,
    damage: Math.floor(spell.damage * (player.damageMultiplier || 1)),
    radius: spell.radius,
    color: spell.color,
    trailColor: spell.trailColor || spell.color,
    maxRange: spell.range,
    traveled: 0,
    isAoe: spell.isAoe || spell.speed === 0,
    homing: isHoming,
    slowEffect: spell.slowEffect,
    slowDuration: spell.slowDuration,
    targetId: null,
    targetPlayerId: targetPlayerId,
    createdAt: Date.now(),
    canHitPlayers: canPvP || (spell.canHitPlayers && player.pvpEnabled === true) || false,
    piercing: spell.piercing || false,
    inDungeon: player.inDungeon || false,
  };
  
  if (proj.homing) {
    let nearestEnemy = null;
    let nearestDist = spell.range;
    for (const enemy of gameState.enemies.values()) {
      if (enemy.health <= 0) continue;
      const dist = distance(player, enemy);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEnemy = enemy;
      }
    }
    if (nearestEnemy) {
      proj.targetId = nearestEnemy.id;
    }
  }
  
  gameState.projectiles.set(id, proj);
  return id;
}

export { BOSS_RESPAWN_TIME };
