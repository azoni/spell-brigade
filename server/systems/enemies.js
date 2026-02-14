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

// Pre-populate the world with enemies so zones aren't empty on start
export function populateWorld() {
  const zoneCounts = {
    meadow: 1120,
    forest: 960,
    volcanic: 800,
    frozen: 800,
    abyss: 720,
    crystal_caves: 800,
  };
  let total = 0;
  for (const [zoneId, count] of Object.entries(zoneCounts)) {
    for (let i = 0; i < count; i++) {
      spawnEnemyInZone(zoneId);
      total++;
    }
  }
  console.log(`🐛 World populated with ${total} enemies across ${Object.keys(zoneCounts).length} zones`);
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
  // HP scales harder than damage so enemies are spongy but not one-shotting
  // HP:  meadow(1): 1.45x, forest(2): 2.1x, volcanic(3): 3.05x, frozen(4): 4.42x, abyss(5): 6.41x
  // Dmg: meadow(1): 1.35x, forest(2): 1.82x, volcanic(3): 2.46x, frozen(4): 3.32x, abyss(5): 4.48x
  const hpScale = Math.pow(1.45, levelBoost);
  const dmgScale = Math.pow(1.35, levelBoost);
  const xpMult = xpMultiplier || 1;
  
  // === GOLDEN ENEMY VARIANT ===
  // 4% chance for non-boss enemies to spawn as golden elite variants
  // Golden enemies: 2.5x HP, 1.3x damage, 3x XP, golden glow, slightly larger
  const isGolden = !template.isBoss && Math.random() < 0.04;
  const goldenMult = isGolden ? { hp: 2.5, dmg: 1.3, xp: 3, radius: 1.25, speed: 0.85 } : { hp: 1, dmg: 1, xp: 1, radius: 1, speed: 1 };

  const enemy = {
    id,
    type,
    name: isGolden ? `Golden ${template.name}` : template.name,
    x: pos.x,
    y: pos.y,
    health: Math.floor(template.health * hpScale * goldenMult.hp),
    maxHealth: Math.floor(template.health * hpScale * goldenMult.hp),
    damage: Math.floor(template.damage * dmgScale * goldenMult.dmg),
    speed: Math.floor(template.speed * (1 + levelBoost * 0.08) * goldenMult.speed),
    baseSpeed: Math.floor(template.speed * (1 + levelBoost * 0.08) * goldenMult.speed),
    radius: Math.floor(template.radius * goldenMult.radius),
    xp: Math.floor(template.xp * xpMult * goldenMult.xp),
    color: isGolden ? '#ffd700' : template.color,
    originalColor: template.color,
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
    isGolden: isGolden,
    zone: zone?.id,
    aggroRange: 400 + (levelBoost * 50), // Higher zones = more aggressive chase range
  };
  
  gameState.enemies.set(id, enemy);
  
  // Announce boss spawn
  if (template.isBoss) {
    io.emit('bossSpawn', { type, name: template.name, zone: zone?.id });
  }
  
  // Announce golden enemy to nearby players
  if (isGolden) {
    for (const player of gameState.players.values()) {
      if (player.health <= 0) continue;
      const d = Math.sqrt((player.x - pos.x) ** 2 + (player.y - pos.y) ** 2);
      if (d < 1200) {
        io.to(player.socketId).emit('goldenSpawn', { 
          enemyId: id, name: enemy.name, x: pos.x, y: pos.y, zone: zone?.id,
        });
      }
    }
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
      
      // Send quest progress update to killer
      const killerSocket = io.sockets.sockets.get(killer.socketId);
      if (killerSocket) {
        killerSocket.emit('questProgress', {
          bossKills: { ...killer.bossKills },
          zone: zoneId,
        });
        
        // Zone quest bonus XP reward
        const zoneQuestXp = { meadow: 500, forest: 1000, volcanic: 2000, frozen: 3000, crystal_caves: 2500, abyss: 4000 };
        const bonusXp = zoneQuestXp[zoneId] || 0;
        if (bonusXp > 0) {
          killer.xp += bonusXp;
          killer.totalXp += bonusXp;
          killerSocket.emit('zoneQuestReward', { zone: zoneId, xp: bonusXp, bossName: enemy.name });
        }
      }
      
      const QUEST_BOSSES = ['meadow', 'forest', 'volcanic', 'frozen', 'crystal_caves', 'abyss'];
      const defeatedCount = QUEST_BOSSES.filter(z => killer.bossKills[z]).length;
      
      if (defeatedCount === QUEST_BOSSES.length && !killer.questComplete) {
        killer.questComplete = true;
        killer.questReward = 'realm_conqueror';
        
        // Big quest reward: XP + permanent stat bonuses
        const rewardXp = 10000;
        killer.xp += rewardXp;
        killer.totalXp += rewardXp;
        killer.maxHealth += 50;  // Permanent +50 HP
        killer.health = killer.maxHealth; // Full heal
        killer.damageMultiplier = (killer.damageMultiplier || 1) * 1.15; // Permanent +15% damage
        
        const socket = io.sockets.sockets.get(killer.socketId);
        if (socket) {
          socket.emit('questComplete', {
            quest: 'conquer_realm',
            title: 'Champion of the Realm',
            reward: 'realm_conqueror',
            xp: rewardXp,
            bonuses: ['+50 Max HP', '+15% Damage', 'Full Heal'],
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
  // Tier 1 (Meadow/Crystal) → Uncommon drops, 20% chance
  // Tier 2 (Forest) → Rare drops, 15% chance
  // Tier 3 (Volcanic) → Rare/Epic drops, 12% chance
  // Tier 4 (Frozen) → Epic drops, 10% chance
  // Tier 5 (Abyss) → Epic/Legendary drops, 8% chance
  
  const BOSS_DROP_TABLES = {
    boss_meadow: {
      guaranteedXp: 600,
      drops: [
        { item: 'blazing_speed', chance: 0.20, class: 'pyromancer' },
        { item: 'permafrost', chance: 0.20, class: 'cryomancer' },
        { item: 'mana_surge', chance: 0.20, class: 'arcanist' },
        { item: 'void_siphon', chance: 0.20, class: 'voidlord' },
        { item: 'barbed_arrows', chance: 0.20, class: 'shadowarcher' },
        { item: 'iron_fists', chance: 0.20, class: 'brute' },
        { item: 'keen_edge', chance: 0.20, class: 'swordsman' },
      ],
    },
    boss_crystal: {
      guaranteedXp: 800,
      drops: [
        { item: 'blazing_speed', chance: 0.18, class: 'pyromancer' },
        { item: 'permafrost', chance: 0.18, class: 'cryomancer' },
        { item: 'mana_surge', chance: 0.18, class: 'arcanist' },
        { item: 'void_siphon', chance: 0.18, class: 'voidlord' },
        { item: 'barbed_arrows', chance: 0.18, class: 'shadowarcher' },
        { item: 'iron_fists', chance: 0.18, class: 'brute' },
        { item: 'keen_edge', chance: 0.18, class: 'swordsman' },
      ],
    },
    boss_forest: {
      guaranteedXp: 1000,
      drops: [
        { item: 'inferno_core', chance: 0.15, class: 'pyromancer' },
        { item: 'glacial_shards', chance: 0.15, class: 'cryomancer' },
        { item: 'void_touched', chance: 0.15, class: 'arcanist' },
        { item: 'entropy_bolt', chance: 0.15, class: 'voidlord' },
        { item: 'shadow_quiver', chance: 0.15, class: 'shadowarcher' },
        { item: 'protein_overflow', chance: 0.15, class: 'brute' },
        { item: 'vorpal_blade', chance: 0.15, class: 'swordsman' },
      ],
    },
    boss_volcanic: {
      guaranteedXp: 1500,
      drops: [
        { item: 'phoenix_flame', chance: 0.12, class: 'pyromancer' },
        { item: 'absolute_zero', chance: 0.12, class: 'cryomancer' },
        { item: 'reality_tear', chance: 0.12, class: 'arcanist' },
        { item: 'void_eruption', chance: 0.12, class: 'voidlord' },
        { item: 'phantom_arrow', chance: 0.12, class: 'shadowarcher' },
        { item: 'seismic_slam', chance: 0.12, class: 'brute' },
        { item: 'dancing_blades', chance: 0.12, class: 'swordsman' },
      ],
    },
    boss_frozen: {
      guaranteedXp: 2000,
      drops: [
        { item: 'dragons_breath', chance: 0.10, class: 'pyromancer' },
        { item: 'ice_lance_drop', chance: 0.10, class: 'cryomancer' },
        { item: 'arcane_orb', chance: 0.10, class: 'arcanist' },
        { item: 'soul_harvest', chance: 0.10, class: 'voidlord' },
        { item: 'death_mark', chance: 0.10, class: 'shadowarcher' },
        { item: 'unstoppable_force', chance: 0.10, class: 'brute' },
        { item: 'blade_fury', chance: 0.10, class: 'swordsman' },
      ],
    },
    boss_abyss: {
      guaranteedXp: 3000,
      drops: [
        { item: 'living_bomb', chance: 0.08, class: 'pyromancer' },
        { item: 'frost_armor', chance: 0.08, class: 'cryomancer' },
        { item: 'time_rift', chance: 0.08, class: 'arcanist' },
        { item: 'oblivion', chance: 0.08, class: 'voidlord' },
        { item: 'eclipse_arrow', chance: 0.08, class: 'shadowarcher' },
        { item: 'titan_grip', chance: 0.08, class: 'brute' },
        { item: 'soul_cleaver', chance: 0.08, class: 'swordsman' },
      ],
    },
  };
  
  const SPELL_UPGRADES = {
    // === PYROMANCER ===
    blazing_speed: { id: 'blazing_speed', name: 'Blazing Speed', description: 'Fireballs travel 50% faster and pierce one enemy', rarity: 'uncommon', spell: 'fireball' },
    inferno_core: { id: 'inferno_core', name: 'Inferno Core', description: 'Fireballs explode on impact dealing area damage', rarity: 'rare', spell: 'fireball' },
    phoenix_flame: { id: 'phoenix_flame', name: 'Phoenix Flame', description: 'Meteors leave burning ground that damages over time', rarity: 'epic', spell: 'meteor' },
    dragons_breath: { id: 'dragons_breath', name: "Dragon's Breath", description: 'Breathe a continuous stream of fire (alternate spell)', rarity: 'epic', replacesSlot: 'primary' },
    living_bomb: { id: 'living_bomb', name: 'Living Bomb', description: 'Mark an enemy to explode after 3 seconds', rarity: 'legendary', replacesSlot: 'secondary' },
    // === CRYOMANCER ===
    permafrost: { id: 'permafrost', name: 'Permafrost', description: 'Frostbolts have 20% chance to freeze enemies solid', rarity: 'uncommon', spell: 'frostbolt' },
    glacial_shards: { id: 'glacial_shards', name: 'Glacial Shards', description: 'Frostbolts split into 3 smaller shards on impact', rarity: 'rare', spell: 'frostbolt' },
    absolute_zero: { id: 'absolute_zero', name: 'Absolute Zero', description: 'Blizzard freezes 2x longer and shatters frozen enemies', rarity: 'epic', spell: 'blizzard' },
    ice_lance_drop: { id: 'ice_lance_drop', name: 'Ice Lance', description: 'Pierce all enemies with massive ice shard, bonus vs frozen', rarity: 'epic', replacesSlot: 'primary' },
    frost_armor: { id: 'frost_armor', name: 'Frost Armor', description: 'Ice shield reduces damage taken by 25% for 8 seconds', rarity: 'legendary', replacesSlot: 'secondary' },
    // === ARCANIST ===
    mana_surge: { id: 'mana_surge', name: 'Mana Surge', description: 'Every 5th Magic Missile deals triple damage', rarity: 'uncommon', spell: 'magicMissile' },
    void_touched: { id: 'void_touched', name: 'Void Touched', description: 'Magic Missiles gain stronger homing and +20% damage', rarity: 'rare', spell: 'magicMissile' },
    reality_tear: { id: 'reality_tear', name: 'Reality Tear', description: 'Arcane Blasts pull enemies inward before detonating', rarity: 'epic', spell: 'arcaneBlast' },
    arcane_orb: { id: 'arcane_orb', name: 'Arcane Orb', description: 'Slow-moving orb that deals massive damage and pierces all', rarity: 'epic', replacesSlot: 'primary' },
    time_rift: { id: 'time_rift', name: 'Time Rift', description: 'Slow time in an area — enemies move at 30% speed for 5s', rarity: 'legendary', replacesSlot: 'secondary' },
    // === VOID LORD ===
    void_siphon: { id: 'void_siphon', name: 'Void Siphon', description: 'Void Bolts heal you for 10% of damage dealt', rarity: 'uncommon', spell: 'voidBolt' },
    entropy_bolt: { id: 'entropy_bolt', name: 'Entropy Bolt', description: 'Void Bolts leave a lingering damage field on impact', rarity: 'rare', spell: 'voidBolt' },
    void_eruption: { id: 'void_eruption', name: 'Void Eruption', description: 'Annihilate pulls enemies to center before detonating', rarity: 'epic', spell: 'annihilate' },
    soul_harvest: { id: 'soul_harvest', name: 'Soul Harvest', description: 'Each kill grants a stacking damage buff (+5%, max 50%)', rarity: 'epic', replacesSlot: 'primary' },
    oblivion: { id: 'oblivion', name: 'Oblivion', description: 'Banish all enemies in range to the void for 3s, dealing massive damage on return', rarity: 'legendary', replacesSlot: 'secondary' },
    // === SHADOW ARCHER ===
    barbed_arrows: { id: 'barbed_arrows', name: 'Barbed Arrows', description: 'Shadow Arrows inflict bleed dealing 30% bonus damage over 3s', rarity: 'uncommon', spell: 'shadowArrow' },
    shadow_quiver: { id: 'shadow_quiver', name: 'Shadow Quiver', description: 'Shadow Arrows fire 2 at once in a tight spread', rarity: 'rare', spell: 'shadowArrow' },
    phantom_arrow: { id: 'phantom_arrow', name: 'Phantom Arrow', description: 'Piercing Volley fires ghost arrows that bounce between enemies', rarity: 'epic', spell: 'piercingVolley' },
    death_mark: { id: 'death_mark', name: 'Death Mark', description: 'Mark a target — all attacks deal 2x damage to marked enemy for 5s', rarity: 'epic', replacesSlot: 'primary' },
    eclipse_arrow: { id: 'eclipse_arrow', name: 'Eclipse Arrow', description: 'Fire an arrow that creates a black hole on impact, pulling and damaging', rarity: 'legendary', replacesSlot: 'secondary' },
    // === THE BRUTE ===
    iron_fists: { id: 'iron_fists', name: 'Iron Fists', description: 'Dumbbells deal 25% more damage and stun briefly', rarity: 'uncommon', spell: 'dumbbellThrow' },
    protein_overflow: { id: 'protein_overflow', name: 'Protein Overflow', description: 'Ground Pound radius +40% and leaves a tremor zone', rarity: 'rare', spell: 'groundPound' },
    seismic_slam: { id: 'seismic_slam', name: 'Seismic Slam', description: 'Ground Pound sends shockwaves outward in 4 directions', rarity: 'epic', spell: 'groundPound' },
    unstoppable_force: { id: 'unstoppable_force', name: 'Unstoppable Force', description: 'Shoulder Charge deals 3x damage and is 50% longer', rarity: 'epic', replacesSlot: 'primary' },
    titan_grip: { id: 'titan_grip', name: 'Titan Grip', description: 'GAINS MODE lasts 50% longer and grants temporary invulnerability', rarity: 'legendary', replacesSlot: 'secondary' },
    // === SWORDSMAN ===
    keen_edge: { id: 'keen_edge', name: 'Keen Edge', description: 'Dagger Throws have 15% chance to critically strike for 2x damage', rarity: 'uncommon', spell: 'daggerThrow' },
    vorpal_blade: { id: 'vorpal_blade', name: 'Vorpal Blade', description: 'Axe Hurl bounces between up to 3 enemies', rarity: 'rare', spell: 'axeHurl' },
    dancing_blades: { id: 'dancing_blades', name: 'Dancing Blades', description: 'Blade Rush leaves spinning blades that damage for 3 seconds', rarity: 'epic', spell: 'bladeRush' },
    blade_fury: { id: 'blade_fury', name: 'Blade Fury', description: 'Throw 5 daggers in a fan pattern that each pierce enemies', rarity: 'epic', replacesSlot: 'primary' },
    soul_cleaver: { id: 'soul_cleaver', name: 'Soul Cleaver', description: 'Whirlwind Slash heals 5% of total damage dealt', rarity: 'legendary', replacesSlot: 'secondary' },
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
    projectileShape: player.projectileShape || null,
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
