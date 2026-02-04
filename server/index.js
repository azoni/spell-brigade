import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import admin from 'firebase-admin';

// ===========================================
// CONFIG
// ===========================================
const PORT = process.env.PORT || 3001;
const TICK_RATE = 20; // Reduced from 30 for performance
const TICK_INTERVAL = 1000 / TICK_RATE;
const MAX_ENEMIES = 100; // Hard cap on total enemies

// ===========================================
// FIREBASE SETUP
// ===========================================
let db = null;
const FIREBASE_ENABLED = !!process.env.FIREBASE_SERVICE_ACCOUNT;

if (FIREBASE_ENABLED) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('🔥 Firebase connected');
  } catch (err) {
    console.error('Firebase init error:', err.message);
  }
} else {
  console.log('⚠️  No Firebase configured - progress will not persist');
}

// ===========================================
// WORLD & ZONES - Polygon-based World Map
// ===========================================
const WORLD = {
  width: 6000,
  height: 5000,
};

// Helper: Check if point is inside polygon
function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Zones with polygon boundaries
const ZONES = {
  sanctuary: {
    id: 'sanctuary',
    name: 'Sanctuary',
    description: 'Safe starting area. Heal and prepare here.',
    color: '#22c55e',
    isSafe: true,
    enemyLevel: 0,
    enemyTypes: [],
    recommendedLevel: 0,
    // Center point and radius for backward compatibility
    x: 3000,
    y: 2500,
    radius: 250,
    polygon: [
      { x: 2800, y: 2300 },
      { x: 3200, y: 2300 },
      { x: 3400, y: 2500 },
      { x: 3200, y: 2700 },
      { x: 2800, y: 2700 },
      { x: 2600, y: 2500 },
    ],
  },
  meadow: {
    id: 'meadow',
    name: 'Peaceful Meadow',
    description: 'Easy enemies. Good for beginners.',
    color: '#84cc16',
    enemyLevel: 1,
    enemyTypes: ['slime', 'bat'],
    xpMultiplier: 1.0,
    recommendedLevel: 1,
    polygon: [
      { x: 2200, y: 1800 },
      { x: 3800, y: 1800 },
      { x: 4200, y: 2200 },
      { x: 4000, y: 3000 },
      { x: 3500, y: 3200 },
      { x: 2500, y: 3200 },
      { x: 2000, y: 3000 },
      { x: 1800, y: 2200 },
    ],
    excludeZones: ['sanctuary'],
  },
  forest: {
    id: 'forest',
    name: 'Dark Forest',
    description: 'Moderate challenge. Spiders and skeletons lurk.',
    color: '#166534',
    enemyLevel: 2,
    enemyTypes: ['skeleton', 'spider', 'ghost', 'necromancer'],
    xpMultiplier: 1.5,
    recommendedLevel: 5,
    polygon: [
      { x: 500, y: 1000 },
      { x: 2000, y: 800 },
      { x: 2200, y: 1800 },
      { x: 1800, y: 2200 },
      { x: 1500, y: 3000 },
      { x: 800, y: 3200 },
      { x: 300, y: 2500 },
      { x: 200, y: 1500 },
    ],
  },
  volcanic: {
    id: 'volcanic',
    name: 'Volcanic Wastes',
    description: 'Fire elementals and golems. High risk, high reward.',
    color: '#dc2626',
    enemyLevel: 3,
    enemyTypes: ['golem', 'fireElemental', 'necromancer'],
    xpMultiplier: 2.0,
    recommendedLevel: 10,
    polygon: [
      { x: 4000, y: 800 },
      { x: 5500, y: 1000 },
      { x: 5800, y: 2000 },
      { x: 5500, y: 3000 },
      { x: 4500, y: 3200 },
      { x: 4000, y: 3000 },
      { x: 4200, y: 2200 },
      { x: 3800, y: 1800 },
    ],
  },
  frozen: {
    id: 'frozen',
    name: 'Frozen Expanse',
    description: 'Ice elementals slow you down. Stay alert.',
    color: '#0ea5e9',
    enemyLevel: 4,
    enemyTypes: ['iceElemental', 'ghost', 'skeleton'],
    xpMultiplier: 2.5,
    recommendedLevel: 15,
    polygon: [
      { x: 1000, y: 3500 },
      { x: 2500, y: 3200 },
      { x: 3500, y: 3200 },
      { x: 4000, y: 3500 },
      { x: 3800, y: 4500 },
      { x: 3000, y: 4800 },
      { x: 2000, y: 4800 },
      { x: 1200, y: 4500 },
    ],
  },
  abyss: {
    id: 'abyss',
    name: 'The Abyss',
    description: 'Only the strongest survive. Bosses spawn here.',
    color: '#581c87',
    enemyLevel: 5,
    enemyTypes: ['golem', 'necromancer', 'fireElemental', 'iceElemental'],
    xpMultiplier: 3.0,
    recommendedLevel: 20,
    bossChance: 0.02,
    polygon: [
      { x: 200, y: 200 },
      { x: 1200, y: 100 },
      { x: 600, y: 1000 },
      { x: 200, y: 1500 },
      { x: 100, y: 800 },
    ],
  },
  crystal_caves: {
    id: 'crystal_caves',
    name: 'Crystal Caves',
    description: 'Glittering crystals and dangerous golems.',
    color: '#ec4899',
    enemyLevel: 3,
    enemyTypes: ['golem', 'ghost', 'spider'],
    xpMultiplier: 1.8,
    recommendedLevel: 8,
    polygon: [
      { x: 4500, y: 3500 },
      { x: 5500, y: 3200 },
      { x: 5800, y: 4000 },
      { x: 5500, y: 4800 },
      { x: 4800, y: 4500 },
      { x: 4300, y: 4000 },
    ],
  },
};

// Portal definitions
const PORTALS = {
  sanctuary_to_meadow: {
    id: 'sanctuary_to_meadow',
    name: 'Meadow Path',
    from: { x: 3000, y: 2350 },
    to: { x: 3000, y: 1900 },  // Further into meadow
    fromZone: 'sanctuary',
    toZone: 'meadow',
    color: '#84cc16',
    requiredLevel: 0,
  },
  meadow_to_forest: {
    id: 'meadow_to_forest',
    name: 'Forest Gateway',
    from: { x: 1900, y: 2000 },
    to: { x: 1400, y: 1800 },  // Deeper into forest
    fromZone: 'meadow',
    toZone: 'forest',
    color: '#166534',
    requiredLevel: 3,
  },
  meadow_to_volcanic: {
    id: 'meadow_to_volcanic',
    name: 'Flame Portal',
    from: { x: 4100, y: 2000 },
    to: { x: 4600, y: 1800 },  // Into volcanic region
    fromZone: 'meadow',
    toZone: 'volcanic',
    color: '#dc2626',
    requiredLevel: 8,
  },
  meadow_to_frozen: {
    id: 'meadow_to_frozen',
    name: 'Frozen Gate',
    from: { x: 3000, y: 3100 },
    to: { x: 3000, y: 3700 },  // Deep into frozen
    fromZone: 'meadow',
    toZone: 'frozen',
    color: '#0ea5e9',
    requiredLevel: 12,
  },
  forest_to_abyss: {
    id: 'forest_to_abyss',
    name: 'Void Rift',
    from: { x: 600, y: 1200 },
    to: { x: 300, y: 600 },  // Into the abyss
    fromZone: 'forest',
    toZone: 'abyss',
    color: '#581c87',
    requiredLevel: 18,
  },
  volcanic_to_crystal: {
    id: 'volcanic_to_crystal',
    name: 'Crystal Passage',
    from: { x: 5000, y: 3100 },
    to: { x: 5200, y: 3700 },  // Into crystal caves
    fromZone: 'volcanic',
    toZone: 'crystal_caves',
    color: '#ec4899',
    requiredLevel: 6,
  },
};

// Buildings/Structures
const BUILDINGS = {
  wizard_tower: {
    id: 'wizard_tower',
    name: "Archmage's Tower",
    x: 3000, y: 2500,
    width: 80, height: 120,
    zone: 'sanctuary',
    color: '#ffd93d',
    interactable: true,
    services: ['respawn', 'heal'],
  },
  forest_ruins: {
    id: 'forest_ruins',
    name: 'Ancient Ruins',
    x: 1200, y: 2000,
    width: 150, height: 100,
    zone: 'forest',
    color: '#78716c',
    interactable: true,
  },
  volcano_fortress: {
    id: 'volcano_fortress',
    name: 'Obsidian Fortress',
    x: 5200, y: 2000,
    width: 180, height: 140,
    zone: 'volcanic',
    color: '#7f1d1d',
    interactable: true,
  },
  ice_citadel: {
    id: 'ice_citadel',
    name: 'Ice Citadel',
    x: 2500, y: 4200,
    width: 160, height: 130,
    zone: 'frozen',
    color: '#0284c7',
    interactable: true,
  },
  void_shrine: {
    id: 'void_shrine',
    name: 'Void Shrine',
    x: 400, y: 600,
    width: 100, height: 100,
    zone: 'abyss',
    color: '#581c87',
    interactable: true,
  },
  crystal_sanctum: {
    id: 'crystal_sanctum',
    name: 'Crystal Sanctum',
    x: 5200, y: 4000,
    width: 120, height: 110,
    zone: 'crystal_caves',
    color: '#ec4899',
    interactable: true,
  },
};

// ===========================================
// SKINS SYSTEM
// ===========================================
const SKINS = {
  // Pyromancer skins
  pyromancer_default: { id: 'pyromancer_default', class: 'pyromancer', name: 'Apprentice', color: '#ff6b35', requiredXp: 0 },
  pyromancer_ember: { id: 'pyromancer_ember', class: 'pyromancer', name: 'Ember Mage', color: '#f97316', requiredXp: 500 },
  pyromancer_inferno: { id: 'pyromancer_inferno', class: 'pyromancer', name: 'Inferno Master', color: '#dc2626', requiredXp: 2000 },
  pyromancer_phoenix: { id: 'pyromancer_phoenix', class: 'pyromancer', name: 'Phoenix Lord', color: '#fbbf24', requiredXp: 5000, special: true },
  pyromancer_shadow: { id: 'pyromancer_shadow', class: 'pyromancer', name: 'Shadow Flame', color: '#7c3aed', requiredXp: 10000, special: true },
  
  // Cryomancer skins
  cryomancer_default: { id: 'cryomancer_default', class: 'cryomancer', name: 'Apprentice', color: '#4ecdc4', requiredXp: 0 },
  cryomancer_frost: { id: 'cryomancer_frost', class: 'cryomancer', name: 'Frost Weaver', color: '#06b6d4', requiredXp: 500 },
  cryomancer_glacier: { id: 'cryomancer_glacier', class: 'cryomancer', name: 'Glacier Knight', color: '#0284c7', requiredXp: 2000 },
  cryomancer_blizzard: { id: 'cryomancer_blizzard', class: 'cryomancer', name: 'Blizzard King', color: '#e0f2fe', requiredXp: 5000, special: true },
  cryomancer_void: { id: 'cryomancer_void', class: 'cryomancer', name: 'Void Ice', color: '#1e1b4b', requiredXp: 10000, special: true },
  
  // Arcanist skins
  arcanist_default: { id: 'arcanist_default', class: 'arcanist', name: 'Apprentice', color: '#9b5de5', requiredXp: 0 },
  arcanist_mystic: { id: 'arcanist_mystic', class: 'arcanist', name: 'Mystic Sage', color: '#a855f7', requiredXp: 500 },
  arcanist_archmage: { id: 'arcanist_archmage', class: 'arcanist', name: 'Archmage', color: '#7c3aed', requiredXp: 2000 },
  arcanist_celestial: { id: 'arcanist_celestial', class: 'arcanist', name: 'Celestial', color: '#fcd34d', requiredXp: 5000, special: true },
  arcanist_cosmic: { id: 'arcanist_cosmic', class: 'arcanist', name: 'Cosmic Entity', color: '#1e1b4b', requiredXp: 10000, special: true },
  
  // Voidlord skins (Admin)
  voidlord_default: { id: 'voidlord_default', class: 'voidlord', name: 'Void Lord', color: '#1a0a2e', requiredXp: 0 },
  voidlord_ascended: { id: 'voidlord_ascended', class: 'voidlord', name: 'Ascended', color: '#ff00ff', requiredXp: 0 },
};

// XP thresholds for titles/ranks
const RANKS = [
  { xp: 0, title: 'Novice', icon: '🌱' },
  { xp: 100, title: 'Apprentice', icon: '📖' },
  { xp: 500, title: 'Adept', icon: '⭐' },
  { xp: 1500, title: 'Expert', icon: '🌟' },
  { xp: 3000, title: 'Master', icon: '💫' },
  { xp: 6000, title: 'Grandmaster', icon: '👑' },
  { xp: 10000, title: 'Legend', icon: '🏆' },
  { xp: 20000, title: 'Mythic', icon: '🔮' },
];

// ===========================================
// CLASSES
// ===========================================
const CLASSES = {
  pyromancer: {
    id: 'pyromancer',
    name: 'Pyromancer',
    color: '#ff6b35',
    baseHealth: 80,
    baseSpeed: 160,
    spells: ['fireball', 'flamewave'],
    description: 'Master of fire magic. High damage, lower health.',
    dashAbility: {
      id: 'fireDash',
      name: 'Fire Dash',
      cooldown: 4000,
      distance: 200,
      damage: 15,
      trailDuration: 1000,
    },
    ultimateAbility: {
      id: 'meteor',
      name: 'Meteor Strike',
      cooldown: 20000,
      damage: 100,
      radius: 150,
      delay: 1000, // Warning before impact
    },
  },
  cryomancer: {
    id: 'cryomancer',
    name: 'Cryomancer',
    color: '#4ecdc4',
    baseHealth: 90,
    baseSpeed: 150,
    spells: ['frostbolt', 'blizzard'],
    description: 'Ice wizard. Balanced stats with slowing effects.',
    dashAbility: {
      id: 'frostStep',
      name: 'Frost Step',
      cooldown: 5000,
      distance: 180,
      freezeDuration: 2000,
      freezeRadius: 60,
    },
    ultimateAbility: {
      id: 'iceNova',
      name: 'Ice Nova',
      cooldown: 25000,
      damage: 50,
      radius: 200,
      freezeDuration: 3000,
    },
  },
  arcanist: {
    id: 'arcanist',
    name: 'Arcanist',
    color: '#9b5de5',
    baseHealth: 100,
    baseSpeed: 140,
    spells: ['arcaneBlast', 'magicMissile'],
    description: 'Pure arcane power. Tanky with AOE damage.',
    dashAbility: {
      id: 'blink',
      name: 'Blink',
      cooldown: 6000,
      distance: 250,
      invulnerable: true, // Brief invulnerability
    },
    ultimateAbility: {
      id: 'arcaneBarrage',
      name: 'Arcane Barrage',
      cooldown: 18000,
      missiles: 12,
      damagePerMissile: 20,
      duration: 2000,
    },
  },
  
  // === ADMIN CLASS - Secret ===
  voidlord: {
    id: 'voidlord',
    name: 'Void Lord',
    color: '#1a0a2e',
    secondaryColor: '#ff00ff',
    baseHealth: 200,
    baseSpeed: 200,
    spells: ['voidBolt', 'annihilate'],
    description: 'Master of the void. Unmatched power.',
    isAdmin: true,
    canPvP: true, // Can damage other players
    dashAbility: {
      id: 'voidShift',
      name: 'Void Shift',
      cooldown: 2000,
      distance: 350,
      invulnerable: true,
      damageOnArrival: 40,
      damageRadius: 80,
    },
    ultimateAbility: {
      id: 'voidRift',
      name: 'Void Rift',
      cooldown: 10000,
      damage: 200,
      radius: 300,
      pullForce: 150, // Pulls enemies toward center
      duration: 3000,
    },
  },
};

// ===========================================
// SPELLS
// ===========================================
const SPELLS = {
  fireball: {
    id: 'fireball',
    name: 'Fireball',
    damage: 28,
    cooldown: 900,
    range: 320,
    speed: 450,
    radius: 12,
    color: '#ff6b35',
    trailColor: '#ffaa00',
  },
  flamewave: {
    id: 'flamewave',
    name: 'Flame Wave',
    damage: 18,
    cooldown: 1500,
    range: 200,
    speed: 0, // AOE
    radius: 120,
    color: '#ff4500',
    isAoe: true,
  },
  frostbolt: {
    id: 'frostbolt',
    name: 'Frost Bolt',
    damage: 18,
    cooldown: 500,
    range: 280,
    speed: 550,
    radius: 8,
    color: '#4ecdc4',
    trailColor: '#a0e9e4',
    slowEffect: 0.5, // 50% slow
    slowDuration: 1500,
  },
  blizzard: {
    id: 'blizzard',
    name: 'Blizzard',
    damage: 12,
    cooldown: 2500,
    range: 250,
    speed: 0,
    radius: 150,
    color: '#87ceeb',
    isAoe: true,
    slowEffect: 0.3,
    slowDuration: 2000,
  },
  arcaneBlast: {
    id: 'arcaneBlast',
    name: 'Arcane Blast',
    damage: 45,
    cooldown: 2000,
    range: 180,
    speed: 0,
    radius: 100,
    color: '#9b5de5',
    isAoe: true,
  },
  magicMissile: {
    id: 'magicMissile',
    name: 'Magic Missile',
    damage: 15,
    cooldown: 400,
    range: 350,
    speed: 600,
    radius: 6,
    color: '#e056fd',
    trailColor: '#d63384',
    homing: true,
  },
  
  // === VOIDLORD SPELLS ===
  voidBolt: {
    id: 'voidBolt',
    name: 'Void Bolt',
    damage: 60,
    cooldown: 300,
    range: 500,
    speed: 800,
    radius: 15,
    color: '#1a0a2e',
    trailColor: '#ff00ff',
    piercing: true, // Goes through enemies
    canHitPlayers: true, // PvP enabled
  },
  annihilate: {
    id: 'annihilate',
    name: 'Annihilate',
    damage: 100,
    cooldown: 1500,
    range: 400,
    speed: 0, // AOE
    radius: 200,
    color: '#ff00ff',
    isAoe: true,
    canHitPlayers: true,
  },
};

// ===========================================
// ENEMIES
// ===========================================
const ENEMY_TYPES = {
  slime: {
    id: 'slime',
    name: 'Slime',
    health: 35,
    damage: 8,
    speed: 45,
    radius: 14,
    xp: 10,
    color: '#4ade80',
    behavior: 'chase',
  },
  bat: {
    id: 'bat',
    name: 'Bat',
    health: 20,
    damage: 12,
    speed: 90,
    radius: 10,
    xp: 12,
    color: '#a855f7',
    behavior: 'chase',
  },
  skeleton: {
    id: 'skeleton',
    name: 'Skeleton',
    health: 50,
    damage: 15,
    speed: 55,
    radius: 16,
    xp: 18,
    color: '#e5e5e5',
    behavior: 'chase',
  },
  ghost: {
    id: 'ghost',
    name: 'Ghost',
    health: 40,
    damage: 20,
    speed: 70,
    radius: 14,
    xp: 25,
    color: '#94a3b8',
    behavior: 'phase', // Can move through other enemies
  },
  golem: {
    id: 'golem',
    name: 'Golem',
    health: 120,
    damage: 25,
    speed: 30,
    radius: 24,
    xp: 50,
    color: '#78716c',
    behavior: 'chase',
  },
  spider: {
    id: 'spider',
    name: 'Spider',
    health: 15,
    damage: 6,
    speed: 110,
    radius: 8,
    xp: 8,
    color: '#1f2937',
    behavior: 'swarm', // Spawns in groups
  },
  bomber: {
    id: 'bomber',
    name: 'Bomber',
    health: 25,
    damage: 10,
    speed: 65,
    radius: 12,
    xp: 20,
    color: '#f97316',
    behavior: 'explode', // Explodes on death
    explosionRadius: 80,
    explosionDamage: 30,
  },
  necromancer: {
    id: 'necromancer',
    name: 'Necromancer',
    health: 60,
    damage: 8,
    speed: 35,
    radius: 16,
    xp: 40,
    color: '#7c3aed',
    behavior: 'summon', // Summons minions
    summonCooldown: 5000,
    summonType: 'skeleton',
  },
  elemental: {
    id: 'elemental',
    name: 'Fire Elemental',
    health: 70,
    damage: 18,
    speed: 50,
    radius: 18,
    xp: 35,
    color: '#dc2626',
    behavior: 'chase',
    resistant: ['fireball', 'flamewave'], // Takes half damage
  },
  iceElemental: {
    id: 'iceElemental',
    name: 'Ice Elemental',
    health: 70,
    damage: 18,
    speed: 50,
    radius: 18,
    xp: 35,
    color: '#0ea5e9',
    behavior: 'chase',
    resistant: ['frostbolt', 'blizzard'],
  },
  mimic: {
    id: 'mimic',
    name: 'Mimic',
    health: 45,
    damage: 25,
    speed: 100,
    radius: 10,
    xp: 30,
    color: '#3b82f6', // Same as XP orb!
    behavior: 'ambush', // Disguised as XP orb
  },
  boss_slime: {
    id: 'boss_slime',
    name: 'King Slime',
    health: 500,
    damage: 20,
    speed: 35,
    radius: 40,
    xp: 200,
    color: '#22c55e',
    behavior: 'boss',
    isBoss: true,
  },
  // ZONE BOSSES - Unique per zone with custom attacks
  boss_meadow: {
    id: 'boss_meadow',
    name: 'Blossom Behemoth',
    health: 400,
    damage: 15,
    speed: 40,
    radius: 35,
    xp: 150,
    color: '#84cc16',
    behavior: 'boss_meadow',
    isBoss: true,
    zone: 'meadow',
    attackCooldown: 3000,
    attackType: 'spore_burst', // Spawns homing spores
  },
  boss_forest: {
    id: 'boss_forest',
    name: 'Ancient Treant',
    health: 800,
    damage: 25,
    speed: 25,
    radius: 45,
    xp: 300,
    color: '#166534',
    behavior: 'boss_forest',
    isBoss: true,
    zone: 'forest',
    attackCooldown: 4000,
    attackType: 'root_trap', // Creates damaging root zones
  },
  boss_volcanic: {
    id: 'boss_volcanic',
    name: 'Magma Titan',
    health: 1200,
    damage: 35,
    speed: 30,
    radius: 50,
    xp: 500,
    color: '#dc2626',
    behavior: 'boss_volcanic',
    isBoss: true,
    zone: 'volcanic',
    attackCooldown: 5000,
    attackType: 'meteor_rain', // Calls down meteors around it
  },
  boss_frozen: {
    id: 'boss_frozen',
    name: 'Frost Wyrm',
    health: 1500,
    damage: 40,
    speed: 45,
    radius: 48,
    xp: 700,
    color: '#0ea5e9',
    behavior: 'boss_frozen',
    isBoss: true,
    zone: 'frozen',
    attackCooldown: 4000,
    attackType: 'ice_breath', // Cone attack that freezes
  },
  boss_abyss: {
    id: 'boss_abyss',
    name: 'Void Overlord',
    health: 2500,
    damage: 50,
    speed: 35,
    radius: 55,
    xp: 1500,
    color: '#581c87',
    behavior: 'boss_abyss',
    isBoss: true,
    zone: 'abyss',
    attackCooldown: 3500,
    attackType: 'void_pulse', // AOE that pulls players in then explodes
  },
  boss_crystal: {
    id: 'boss_crystal',
    name: 'Crystal Golem',
    health: 600,
    damage: 20,
    speed: 30,
    radius: 40,
    xp: 250,
    color: '#ec4899',
    behavior: 'boss_crystal',
    isBoss: true,
    zone: 'crystal_caves',
    attackCooldown: 3500,
    attackType: 'crystal_barrage', // Shoots crystal shards
  },
};

// ===========================================
// DATABASE (Firebase Firestore)
// ===========================================
let playersDb = {}; // In-memory cache

// Save player to Firebase
async function savePlayerToDb(player) {
  const data = {
    id: player.id,
    name: player.name,
    class: player.class,
    level: player.level,
    xp: player.xp,
    totalXp: player.totalXp || 0,
    kills: player.kills || 0,
    deaths: player.deaths || 0,
    playTime: player.playTime || 0,
    selectedSkin: player.selectedSkin || `${player.class}_default`,
    unlockedSkins: player.unlockedSkins || [`${player.class}_default`],
    highestZone: player.highestZone || 'meadow',
    achievements: player.achievements || [],
    createdAt: player.createdAt || new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
  
  // Always update cache
  playersDb[player.id] = data;
  
  // Save to Firebase if enabled
  if (db) {
    try {
      await db.collection('spellBrigade').doc(player.id).set(data, { merge: true });
    } catch (err) {
      console.error('Firebase save error:', err.message);
    }
  }
}

// Load player from Firebase
async function loadPlayerFromDb(id) {
  // Check cache first
  if (playersDb[id]) return playersDb[id];
  
  // Try Firebase
  if (db) {
    try {
      const doc = await db.collection('spellBrigade').doc(id).get();
      if (doc.exists) {
        playersDb[id] = doc.data();
        return playersDb[id];
      }
    } catch (err) {
      console.error('Firebase load error:', err.message);
    }
  }
  return null;
}

// Sync wrapper for compatibility (used in hot paths)
function loadPlayerFromDbSync(id) {
  return playersDb[id] || null;
}

function loadPlayerByName(name) {
  return Object.values(playersDb).find(p => p.name?.toLowerCase() === name.toLowerCase()) || null;
}

function getPlayerCharacters(name) {
  return Object.values(playersDb).filter(p => p.name?.toLowerCase().startsWith(name.toLowerCase().split('#')[0]));
}

// Get unlocked skins for a player based on total XP
function getUnlockedSkins(playerClass, totalXp) {
  return Object.values(SKINS)
    .filter(s => s.class === playerClass && s.requiredXp <= totalXp)
    .map(s => s.id);
}

// Get player rank based on total XP
function getPlayerRank(totalXp) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (totalXp >= r.xp) rank = r;
  }
  return rank;
}

// Get zone at position
function getZoneAtPosition(x, y) {
  // Check zones in priority order (smaller/special zones first)
  const priorityOrder = ['sanctuary', 'abyss', 'crystal_caves', 'forest', 'volcanic', 'frozen', 'meadow'];
  
  for (const zoneId of priorityOrder) {
    const zone = ZONES[zoneId];
    if (zone.polygon && pointInPolygon(x, y, zone.polygon)) {
      // Check if we should exclude this zone (e.g., sanctuary is inside meadow)
      if (zone.excludeZones) {
        let inExcluded = false;
        for (const excludeId of zone.excludeZones) {
          const excludeZone = ZONES[excludeId];
          if (excludeZone.polygon && pointInPolygon(x, y, excludeZone.polygon)) {
            inExcluded = true;
            break;
          }
        }
        if (inExcluded) continue;
      }
      return zone;
    }
  }
  
  // Default to meadow for areas outside all defined zones
  return ZONES.meadow;
}

// Get random point inside a zone polygon
function getRandomPointInZone(zoneId) {
  const zone = ZONES[zoneId];
  if (!zone || !zone.polygon) return { x: 3000, y: 2500 };
  
  // Get bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of zone.polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  
  // Try to find a point inside polygon
  for (let i = 0; i < 50; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    if (pointInPolygon(x, y, zone.polygon)) {
      return { x, y };
    }
  }
  
  // Fallback to polygon center
  const centerX = zone.polygon.reduce((sum, p) => sum + p.x, 0) / zone.polygon.length;
  const centerY = zone.polygon.reduce((sum, p) => sum + p.y, 0) / zone.polygon.length;
  return { x: centerX, y: centerY };
}

// ===========================================
// GAME STATE
// ===========================================
const gameState = {
  players: new Map(),
  enemies: new Map(),
  projectiles: new Map(),
  xpOrbs: new Map(),       // XP pickups
  damageNumbers: [],       // Floating damage text
  particles: [],           // Visual effects
  chatMessages: [],        // Chat history (last 50 messages)
  zoneBosses: new Map(),   // Zone boss tracking (zoneId -> enemyId)
  bossRespawnTimers: new Map(), // Zone -> respawn timestamp
  lastTick: Date.now(),
  tickCount: 0,
};

// Zone boss types (which boss for each zone)
const ZONE_BOSS_TYPES = {
  meadow: 'boss_meadow',
  forest: 'boss_forest',
  volcanic: 'boss_volcanic',
  frozen: 'boss_frozen',
  abyss: 'boss_abyss',
  crystal_caves: 'boss_crystal',
};

const BOSS_RESPAWN_TIME = 30 * 1000; // 30 seconds

// ===========================================
// XP ORB CONFIG
// ===========================================
const XP_ORB = {
  pickupRadius: 50,
  magnetRadius: 150,
  magnetSpeed: 300,
  lifetime: 30000, // 30 seconds
};

// ===========================================
// EXPRESS + SOCKET.IO
// ===========================================
const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// Health check / stats endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    players: gameState.players.size,
    enemies: gameState.enemies.size,
    projectiles: gameState.projectiles.size,
    xpOrbs: gameState.xpOrbs.size,
    particles: gameState.particles.length,
    damageNumbers: gameState.damageNumbers.length,
    tickRate: TICK_RATE,
    maxEnemies: MAX_ENEMIES,
    uptime: process.uptime(),
  });
});

app.get('/leaderboard', (req, res) => {
  const leaders = Object.values(playersDb)
    .sort((a, b) => b.level - a.level || b.totalXp - a.totalXp)
    .slice(0, 10)
    .map(p => ({
      name: p.name,
      level: p.level,
      class: p.class,
      kills: p.kills || 0,
    }));
  res.json(leaders);
});

// ===========================================
// HELPER FUNCTIONS
// ===========================================
function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function normalize(vec) {
  const len = Math.sqrt(vec.x ** 2 + vec.y ** 2);
  if (len === 0) return { x: 0, y: 0 };
  return { x: vec.x / len, y: vec.y / len };
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function xpForLevel(level) {
  return Math.floor(100 * Math.pow(1.15, level - 1));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function pointToLineDistance(point, lineStart, lineEnd) {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;
  
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  
  if (lenSq !== 0) param = dot / lenSq;
  
  let xx, yy;
  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }
  
  return Math.sqrt((point.x - xx) ** 2 + (point.y - yy) ** 2);
}

// ===========================================
// XP ORBS
// ===========================================
function spawnXpOrb(x, y, amount) {
  // Limit XP orbs to prevent lag
  if (gameState.xpOrbs.size > 200) {
    return; // Skip spawning more
  }
  const id = uuidv4();
  // Scatter slightly from death position
  const scatter = 20;
  gameState.xpOrbs.set(id, {
    id,
    x: x + (Math.random() - 0.5) * scatter,
    y: y + (Math.random() - 0.5) * scatter,
    amount,
    createdAt: Date.now(),
    targetPlayerId: null,
  });
}

// ===========================================
// DAMAGE NUMBERS
// ===========================================
function spawnDamageNumber(x, y, amount, isCrit = false) {
  // Limit damage numbers to prevent lag
  if (gameState.damageNumbers.length > 50) {
    gameState.damageNumbers.shift(); // Remove oldest
  }
  gameState.damageNumbers.push({
    id: uuidv4(),
    x: x + (Math.random() - 0.5) * 20,
    y,
    amount: Math.round(amount),
    isCrit,
    createdAt: Date.now(),
    lifetime: 800, // Reduced from 1000
  });
}

// ===========================================
// PARTICLES
// ===========================================
function spawnParticles(x, y, color, count = 5) {
  // Limit total particles to prevent lag
  if (gameState.particles.length > 150) {
    gameState.particles.splice(0, count); // Remove oldest
  }
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 50 + Math.random() * 100;
    gameState.particles.push({
      id: uuidv4(),
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      radius: 3 + Math.random() * 3,
      createdAt: Date.now(),
      lifetime: 500 + Math.random() * 300,
    });
  }
}

// ===========================================
// ENEMY SPAWNING (Zone-based)
// ===========================================
function getSpawnPosition(forZone = null) {
  if (forZone && ZONES[forZone]) {
    const zone = ZONES[forZone];
    if (zone.polygon) {
      // Spawn within the polygon zone
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

function spawnEnemyInZone(zoneId) {
  const zone = ZONES[zoneId];
  if (!zone || zone.isSafe || zone.enemyTypes.length === 0) return;
  
  const pos = getSpawnPosition(zoneId);
  const enemyType = zone.enemyTypes[Math.floor(Math.random() * zone.enemyTypes.length)];
  
  spawnEnemy(enemyType, pos, zone.enemyLevel, zone.xpMultiplier);
}

function spawnEnemy(forceType = null, position = null, levelBoost = 0, xpMultiplier = 1) {
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
  
  // Boss spawn in abyss
  if (zone?.bossChance && Math.random() < zone.bossChance && playerCount >= 2) {
    type = 'boss_dragon';
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
  
  return id; // Return enemy ID for tracking
}

// Spawn a zone boss
function spawnZoneBoss(zoneId) {
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
  
  // Use polygon-based spawn position
  const pos = getRandomPointInZone(zoneId);
  if (!pos) return null;
  
  // Spawn the boss
  const bossId = spawnEnemy(bossType, pos, 0, 1);
  if (bossId) {
    gameState.zoneBosses.set(zoneId, bossId);
    console.log(`👑 Zone boss spawned: ${template.name} in ${zone.name}`);
  }
  
  return bossId;
}

// Handle boss death - set respawn timer and drop spell upgrades
function onBossDeath(enemy, killer) {
  const zoneId = enemy.zone;
  if (zoneId && ZONE_BOSS_TYPES[zoneId]) {
    gameState.zoneBosses.delete(zoneId);
    gameState.bossRespawnTimers.set(zoneId, Date.now() + BOSS_RESPAWN_TIME);
    console.log(`💀 Zone boss defeated: ${enemy.name} in ${zoneId} - respawns in 30 seconds`);
    
    // Track boss kills for quest progress
    if (killer) {
      if (!killer.bossKills) killer.bossKills = {};
      killer.bossKills[zoneId] = true;
      
      // Check if all 5 zone bosses defeated (Quest: Conquer the Realm)
      const QUEST_BOSSES = ['meadow', 'forest', 'volcanic', 'frozen', 'abyss'];
      const defeatedCount = QUEST_BOSSES.filter(z => killer.bossKills[z]).length;
      
      if (defeatedCount === QUEST_BOSSES.length && !killer.questComplete) {
        killer.questComplete = true;
        killer.questReward = 'realm_conqueror';
        
        // Grant quest reward: massive XP bonus + special title
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
        
        // Announce to all players
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
      
      // Grant bonus XP from boss
      if (dropResult.xp) {
        killer.xp += dropResult.xp;
        killer.totalXp += dropResult.xp;
        console.log(`💰 ${killer.name} received ${dropResult.xp} bonus XP from boss`);
      }
      
      // Send drops to the killer and add to their collection
      if (drops.length > 0) {
        const socket = io.sockets.sockets.get(killer.socketId);
        
        // Add upgrades to player's collection (avoid duplicates)
        for (const drop of drops) {
          if (drop.replacesSlot) {
            // Alternate spell - track separately
            if (!killer.alternateSpells) killer.alternateSpells = {};
            killer.alternateSpells[drop.id] = drop;
          } else {
            // Spell upgrade - add to list if not already owned
            if (!killer.spellUpgrades) killer.spellUpgrades = [];
            if (!killer.spellUpgrades.includes(drop.id)) {
              killer.spellUpgrades.push(drop.id);
            }
          }
        }
        
        // Save to database
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
    
    // Announce to all players with position for death animation
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

// Calculate boss drops based on boss type and player class
function calculateBossDrops(bossType, playerClass) {
  // Drop tables (can be moved to config module later)
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
    // Fallback for boss_ prefixed types
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
  
  // Spell upgrade definitions
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
    // Only drop items for the player's class
    if (drop.class !== playerClass) continue;
    
    // Check drop chance
    if (Math.random() < drop.chance) {
      const upgrade = SPELL_UPGRADES[drop.item];
      if (upgrade) {
        result.items.push(upgrade);
      }
    }
  }
  
  return result;
}

// Initialize zone bosses on startup
function initZoneBosses() {
  for (const zoneId of Object.keys(ZONE_BOSS_TYPES)) {
    spawnZoneBoss(zoneId);
  }
}

// ===========================================
// PROJECTILE CREATION
// ===========================================
function createProjectile(player, spell, targetX, targetY, targetPlayerId = null) {
  // Limit projectiles to prevent lag
  if (gameState.projectiles.size > 300) {
    return null;
  }
  
  const id = uuidv4();
  const dir = normalize({ x: targetX - player.x, y: targetY - player.y });
  const upgrades = player.spellUpgrades || [];
  
  // Calculate modified stats based on upgrades
  let speed = spell.speed;
  let isHoming = spell.homing || false;
  
  // Blazing Speed: 50% faster fireballs
  if (spell.id === 'fireball' && upgrades.includes('blazing_speed')) {
    speed *= 1.5;
  }
  
  // Void Touched: Arcane missiles home in on enemies
  if (spell.id === 'arcane_missile' && upgrades.includes('void_touched')) {
    isHoming = true;
  }
  
  // Check if this player can hit other players (PvP)
  // Only allow PvP damage if class canPvP AND player has pvpEnabled
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
    damage: spell.damage,
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
    targetPlayerId: targetPlayerId, // Track if targeting a specific player
    createdAt: Date.now(),
    canHitPlayers: canPvP || (spell.canHitPlayers && player.pvpEnabled === true) || false,
    piercing: spell.piercing || false,
  };
  
  // For homing missiles, track the target
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

// ===========================================
// GAME TICK
// ===========================================
function gameTick() {
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
    if (player.input) {
      if (player.input.up) dy -= 1;
      if (player.input.down) dy += 1;
      if (player.input.left) dx -= 1;
      if (player.input.right) dx += 1;
    }

    const isMoving = dx !== 0 || dy !== 0;
    player.state = isMoving ? 'walk' : 'idle';

    if (isMoving) {
      const move = normalize({ x: dx, y: dy });
      const classData = CLASSES[player.class];
      const speed = classData?.baseSpeed || 150;
      
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
    }

    // Automatic portal entry
    if (!player.portalCooldown || now > player.portalCooldown) {
      for (const [portalId, portal] of Object.entries(PORTALS)) {
        const distToPortal = distance(player, portal.from);
        if (distToPortal < 80) {  // Larger detection radius for easier entry
          // Check level requirement
          if (player.level >= portal.requiredLevel) {
            // Teleport!
            const oldX = player.x;
            const oldY = player.y;
            player.x = portal.to.x;
            player.y = portal.to.y;
            player.portalCooldown = now + 1000; // 1 second cooldown
            
            // Notify client
            const socket = io.sockets.sockets.get(player.socketId);
            if (socket) {
              socket.emit('portalUsed', {
                portalId,
                fromX: oldX,
                fromY: oldY,
                toX: portal.to.x,
                toY: portal.to.y,
                toZone: portal.toZone,
                color: portal.color,
              });
            }
            
            io.emit('sound', { type: 'portalEnter', x: oldX, y: oldY });
            io.emit('sound', { type: 'portalExit', x: portal.to.x, y: portal.to.y });
            break;
          }
        }
      }
    }

    // Animation frame
    player.animTime = (player.animTime || 0) + dt;
    if (player.animTime > 0.15) {
      player.animTime = 0;
      player.animFrame = ((player.animFrame || 0) + 1) % 4;
    }

    // Auto-cast spells (unless autoAttack is disabled)
    if (player.autoAttack !== false) {
      const classData = CLASSES[player.class];
      if (classData) {
        for (const spellId of classData.spells) {
          const spell = SPELLS[spellId];
          if (!spell) continue;

          const lastCast = player.lastCast?.[spellId] || 0;
          if (now - lastCast >= spell.cooldown) {
            // Find target
            let target = null;
            let targetDist = spell.range;
            let targetIsPlayer = false;

            // Search enemies first
            for (const enemy of gameState.enemies.values()) {
              if (enemy.health <= 0) continue;
              const dist = distance(player, enemy);
              if (dist < targetDist) {
                targetDist = dist;
                target = enemy;
                targetIsPlayer = false;
              }
            }

            // Voidlord can also target other players (only if PvP is enabled)
            if (classData.canPvP && player.pvpEnabled === true) {
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
              createProjectile(player, spell, target.x, target.y, targetIsPlayer ? target.id : null);
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

    // Health regen in sanctuary (safe zone)
    const playerZone = getZoneAtPosition(player.x, player.y);
    const inSanctuary = playerZone?.id === 'sanctuary';
    
    if (inSanctuary && player.health < player.maxHealth) {
      player.health = Math.min(player.health + 10 * dt, player.maxHealth);
      player.isHealing = true;
    } else {
      player.isHealing = false;
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
    
    // Find nearest player IN THE SAME ZONE (anti-cheese)
    let nearestPlayer = null;
    let nearestDist = Infinity;

    for (const player of alivePlayers) {
      // Get player's zone
      const playerZone = getZoneAtPosition(player.x, player.y);
      
      // Only aggro if player is in the same zone as enemy
      if (enemyZone && playerZone && playerZone.id !== enemyZone.id) {
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
            if (distance(enemy, player) < 400) {
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
            const dist = 100 + Math.random() * 100;
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
              radius: 50,
              color: '#166534',
              fromEnemy: true,
              isHazard: true,
              lifetime: 3000,
              createdAt: now,
              pulseRate: 500,
            });
            io.emit('explosion', { x: rx, y: ry, radius: 50, color: '#166534' });
          }
          io.emit('sound', { type: 'bossAttack', x: enemy.x, y: enemy.y });
        }
        
        else if (attackType === 'meteor_rain') {
          // Magma Titan: Call down meteors
          for (let i = 0; i < 5; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 50 + Math.random() * 200;
            const mx = enemy.x + Math.cos(angle) * dist;
            const my = enemy.y + Math.sin(angle) * dist;
            
            io.emit('meteorWarning', { x: mx, y: my, radius: 60, delay: 1500 });
            
            setTimeout(() => {
              // Deal damage in area
              for (const player of gameState.players.values()) {
                if (player.health <= 0) continue;
                if (distance({ x: mx, y: my }, player) < 60) {
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
              io.emit('explosion', { x: mx, y: my, radius: 60, color: '#f97316' });
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
          const coneRange = 250;
          const baseAngle = Math.atan2(dir.y, dir.x);
          
          for (const player of alivePlayers) {
            const toPlayer = { x: player.x - enemy.x, y: player.y - enemy.y };
            const playerDist = Math.sqrt(toPlayer.x * toPlayer.x + toPlayer.y * toPlayer.y);
            
            if (playerDist < coneRange) {
              const playerAngle = Math.atan2(toPlayer.y, toPlayer.x);
              let angleDiff = Math.abs(playerAngle - baseAngle);
              if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
              
              if (angleDiff < coneAngle / 2) {
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
          const pullRadius = 300;
          const explodeRadius = 150;
          
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
      
      // Keep in zone (all enemies, not just bosses)
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
      
      // Prevent enemies from entering sanctuary during wander
      if (ZONES.sanctuary?.polygon && pointInPolygon(enemy.x, enemy.y, ZONES.sanctuary.polygon)) {
        // Push back out of sanctuary
        const sanctuaryCenter = { x: 3000, y: 2500 };
        const pushDir = normalize({ x: enemy.x - sanctuaryCenter.x, y: enemy.y - sanctuaryCenter.y });
        enemy.x += pushDir.x * 50;
        enemy.y += pushDir.y * 50;
        enemy.wanderAngle = Math.atan2(pushDir.y, pushDir.x); // Face away from sanctuary
      }
    }
    
    if (nearestPlayer && nearestDist <= 400) {
      // Check if we would enter sanctuary - don't chase into safe zone
      const sanctuaryPoly = ZONES.sanctuary?.polygon;
      const playerInSanctuary = sanctuaryPoly && pointInPolygon(nearestPlayer.x, nearestPlayer.y, sanctuaryPoly);
      
      if (!playerInSanctuary) {
        const dir = normalize({ 
          x: nearestPlayer.x - enemy.x, 
          y: nearestPlayer.y - enemy.y 
        });
        
        // Calculate new position
        let newX = enemy.x + dir.x * currentSpeed * dt;
        let newY = enemy.y + dir.y * currentSpeed * dt;
        
        // ALL enemies must stay in their zone (polygon check)
        if (enemyZone?.polygon) {
          if (!pointInPolygon(newX, newY, enemyZone.polygon)) {
            // Stay at current position if would leave zone
            newX = enemy.x;
            newY = enemy.y;
          }
        }
        
        // Also prevent entering sanctuary
        if (sanctuaryPoly && pointInPolygon(newX, newY, sanctuaryPoly)) {
          newX = enemy.x;
          newY = enemy.y;
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
      const attackTargetZone = getZoneAtPosition(nearestPlayer.x, nearestPlayer.y);
      const targetInSanctuary = attackTargetZone?.id === 'sanctuary';
      const canAttack = !targetInSanctuary && (!enemyZone || !attackTargetZone || attackTargetZone.id === enemyZone.id);
      
      const collisionDist = enemy.radius + 16; // player radius
      if (canAttack && nearestDist < collisionDist && now - enemy.lastAttack > 500) {
        // Check if player is invulnerable
        if (!nearestPlayer.invulnerableUntil || nearestPlayer.invulnerableUntil < now) {
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
      
      for (const enemy of gameState.enemies.values()) {
        if (enemy.health <= 0) continue;
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
    for (const enemy of gameState.enemies.values()) {
      if (enemy.health <= 0) continue;
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
    const targetForZone = Math.max(5, playerCount * 10);
    
    if (enemiesInZone < targetForZone) {
      const spawnChance = 0.2 + (playerCount * 0.1);
      if (Math.random() < spawnChance) {
        spawnEnemyInZone(zoneId);
      }
    }
  }
  
  // Also maintain some enemies in zones without players (for exploration)
  const zoneOrder = ['meadow', 'forest', 'volcanic', 'frozen', 'abyss'];
  for (const zoneId of zoneOrder) {
    if (playersPerZone[zoneId]) continue; // Already handled
    
    const enemiesInZone = [...gameState.enemies.values()].filter(e => e.health > 0 && e.zone === zoneId).length;
    if (enemiesInZone < 3 && Math.random() < 0.02) {
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
          nearestPlayer.maxHealth += 10;
          nearestPlayer.health = Math.min(nearestPlayer.health + 30, nearestPlayer.maxHealth);
          
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

  // --- BROADCAST STATE (Per-player with view distance filtering) ---
  const VIEW_DISTANCE = 1200;
  
  for (const player of gameState.players.values()) {
    const socket = io.sockets.sockets.get(player.socketId);
    if (!socket) continue;
    
    const px = player.x;
    const py = player.y;
    
    // Filter entities by distance
    const nearbyEnemies = [...gameState.enemies.values()]
      .filter(e => e.health > 0 && (e.revealed !== false) && 
        Math.abs(e.x - px) < VIEW_DISTANCE && Math.abs(e.y - py) < VIEW_DISTANCE)
      .map(e => ({
        id: e.id,
        type: e.behavior === 'ambush' && !e.revealed ? 'xpOrb' : e.type,
        name: e.name,
        x: Math.round(e.x),
        y: Math.round(e.y),
        health: Math.round(e.health),
        maxHealth: e.maxHealth,
        facing: e.facing || 'down',
        animFrame: e.animFrame || 0,
        isSlowed: e.slowedUntil > now,
        isFrozen: e.frozenUntil > now,
        isBoss: e.isBoss || false,
        behavior: e.behavior,
      }));
    
    const nearbyProjectiles = [...gameState.projectiles.values()]
      .filter(p => Math.abs(p.x - px) < VIEW_DISTANCE && Math.abs(p.y - py) < VIEW_DISTANCE)
      .map(p => ({
        id: p.id, x: Math.round(p.x), y: Math.round(p.y),
        radius: p.radius, color: p.color, trailColor: p.trailColor,
        spellId: p.spellId, ownerClass: p.ownerClass, level: p.ownerLevel || 1,
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
    if (classData) {
      for (const spellId of classData.spells) {
        const spell = SPELLS[spellId];
        if (spell) {
          const lastCast = player.lastCast?.[spellId] || 0;
          cooldowns[spellId] = { remaining: Math.max(0, spell.cooldown - (now - lastCast)), total: spell.cooldown };
        }
      }
      if (classData.dashAbility) {
        cooldowns.dash = { remaining: Math.max(0, classData.dashAbility.cooldown - (now - (player.lastDash || 0))), total: classData.dashAbility.cooldown };
      }
      if (classData.ultimateAbility) {
        cooldowns.ultimate = { remaining: Math.max(0, classData.ultimateAbility.cooldown - (now - (player.lastUltimate || 0))), total: classData.ultimateAbility.cooldown };
      }
    }
    
    socket.emit('gameState', {
      tick: gameState.tickCount,
      timestamp: now,
      players: [...gameState.players.values()].map(p => ({
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
        bossKills: p.bossKills || {},
      })),
      enemies: nearbyEnemies,
      projectiles: nearbyProjectiles,
      xpOrbs: nearbyOrbs,
      particles: nearbyParticles,
      damageNumbers: nearbyDmgNums,
    });
  }
}

function checkEnemyDeath(enemy, killerId) {
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

// Start game loop
setInterval(gameTick, TICK_INTERVAL);

// Initialize zone bosses
initZoneBosses();
console.log('👑 Zone bosses initialized');

// ===========================================
// SOCKET.IO EVENTS
// ===========================================
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Send available classes
  socket.emit('classes', CLASSES);

  socket.on('join', async ({ playerId, playerName, playerClass, selectedSkin, adminKey }) => {
    // Prevent double-join from same socket
    for (const p of gameState.players.values()) {
      if (p.socketId === socket.id) {
        socket.emit('error', { message: 'Already in game' });
        return;
      }
    }
    
    // Validate class - voidlord requires admin key
    let validatedClass = playerClass;
    if (playerClass === 'voidlord') {
      const correctKey = process.env.ADMIN_KEY || 'azoni-voidlord-2026';
      if (adminKey !== correctKey) {
        validatedClass = 'pyromancer'; // Default if wrong key
        console.log(`⚠️ Invalid admin key attempt from ${playerName}`);
      } else {
        console.log(`👑 Admin ${playerName} authenticated as Void Lord`);
      }
    }
    const classData = CLASSES[validatedClass] || CLASSES.pyromancer;
    
    // Load or create player
    let saved = playerId ? await loadPlayerFromDb(playerId) : null;
    if (!saved && playerName) {
      saved = loadPlayerByName(playerName);
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
      x: 3000, // Sanctuary center
      y: 2500,
      health: classData.baseHealth + healthBonus,
      maxHealth: classData.baseHealth + healthBonus,
      baseSpeed: classData.baseSpeed + speedBonus,
      damageMultiplier,
      input: { up: false, down: false, left: false, right: false },
      lastCast: {},
      castCount: {}, // Track cast count for "every Nth" effects
      state: 'idle',
      facing: 'down',
      animFrame: 0,
      animTime: 0,
      createdAt: saved?.createdAt || new Date().toISOString(),
    };

    gameState.players.set(id, player);

    // Get rank
    const rank = RANKS.reduce((best, r) => totalXp >= r.xp ? r : best, RANKS[0]);

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
      },
      world: WORLD,
      zones: ZONES,
      skins: SKINS,
      ranks: RANKS,
      classes: CLASSES,
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
        const classData = CLASSES[player.class];
        if (!classData?.dashAbility) break;
        
        const dash = classData.dashAbility;
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
        if (dash.id === 'fireDash' && dash.damage) {
          // Fire trail damage
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
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
            if (distance(enemy, player) < dash.freezeRadius) {
              enemy.frozenUntil = now + dash.freezeDuration;
            }
          }
          spawnParticles(player.x, player.y, '#4ecdc4', 10);
        } else if (dash.id === 'blink' && dash.invulnerable) {
          player.invulnerableUntil = now + 300; // Brief invulnerability
          spawnParticles(startX, startY, '#9b5de5', 8);
          spawnParticles(player.x, player.y, '#9b5de5', 8);
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
        const classData = CLASSES[player.class];
        if (!classData?.ultimateAbility) break;
        
        const ult = classData.ultimateAbility;
        const lastUlt = player.lastUltimate || 0;
        const now = Date.now();
        
        if (now - lastUlt < ult.cooldown) {
          socket.emit('abilityCooldown', { ability: 'ultimate', remaining: ult.cooldown - (now - lastUlt) });
          break;
        }
        
        player.lastUltimate = now;
        
        // Class-specific ultimates
        if (ult.id === 'meteor') {
          // Meteor strike with delay
          const meteorX = tx ?? player.x;
          const meteorY = ty ?? player.y;
          io.emit('meteorWarning', { x: meteorX, y: meteorY, radius: ult.radius, delay: ult.delay });
          
          setTimeout(() => {
            for (const enemy of gameState.enemies.values()) {
              if (enemy.health <= 0) continue;
              if (distance(enemy, { x: meteorX, y: meteorY }) < ult.radius) {
                enemy.health -= ult.damage;
                spawnDamageNumber(enemy.x, enemy.y - 20, ult.damage);
                checkEnemyDeath(enemy, player.id);
              }
            }
            io.emit('explosion', { x: meteorX, y: meteorY, radius: ult.radius, color: '#ff6b35' });
            spawnParticles(meteorX, meteorY, '#ff6b35', 20);
            io.emit('sound', { type: 'meteor', x: meteorX, y: meteorY });
          }, ult.delay);
          
        } else if (ult.id === 'iceNova') {
          // Ice nova - freeze and damage all nearby
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
            if (distance(enemy, player) < ult.radius) {
              enemy.health -= ult.damage;
              enemy.frozenUntil = now + ult.freezeDuration;
              spawnDamageNumber(enemy.x, enemy.y - 20, ult.damage);
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
            
            // Find random enemy in range
            const enemies = [...gameState.enemies.values()].filter(e => e.health > 0 && distance(e, player) < 400);
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
          const damagePerTick = ult.damage / maxTicks;
          
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
        socket.emit('respawned', { health: player.health });
        break;
      }
    }
  });

  // Portal interaction
  socket.on('usePortal', ({ portalId }) => {
    const portal = PORTALS[portalId];
    if (!portal) return;
    
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id && player.health > 0) {
        // Check if player is near portal entrance
        const distToPortal = distance(player, portal.from);
        if (distToPortal > 60) {
          socket.emit('portalError', { message: 'Too far from portal' });
          break;
        }
        
        // Check level requirement
        if (player.level < portal.requiredLevel) {
          socket.emit('portalError', { message: `Requires level ${portal.requiredLevel}` });
          break;
        }
        
        // Teleport player
        const oldX = player.x;
        const oldY = player.y;
        player.x = portal.to.x;
        player.y = portal.to.y;
        
        // Notify client of teleport
        socket.emit('portalUsed', {
          portalId,
          fromX: oldX,
          fromY: oldY,
          toX: portal.to.x,
          toY: portal.to.y,
          toZone: portal.toZone,
          color: portal.color,
        });
        
        // Sound effect for nearby players
        io.emit('sound', { type: 'portalEnter', x: oldX, y: oldY });
        io.emit('sound', { type: 'portalExit', x: portal.to.x, y: portal.to.y });
        
        console.log(`🌀 ${player.name} used portal ${portalId} to ${portal.toZone}`);
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
  socket.on('buyUpgrade', ({ type }) => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id) {
        const costs = {
          health: 500,
          damage: 750,
          speed: 600,
          cooldown: 1000,
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
        player.upgrades = player.upgrades || { health: 0, damage: 0, speed: 0, cooldown: 0 };
        
        // Apply upgrade
        if (type === 'health') {
          player.upgrades.health += 1;
          player.maxHealth += 20;
          player.health = Math.min(player.health + 20, player.maxHealth);
        } else if (type === 'damage') {
          player.upgrades.damage += 1;
          player.damageMultiplier = (player.damageMultiplier || 1) * 1.05;
        } else if (type === 'speed') {
          player.upgrades.speed += 1;
          player.speedMultiplier = (player.speedMultiplier || 1) * 1.05;
        } else if (type === 'cooldown') {
          player.upgrades.cooldown += 1;
          player.cooldownMultiplier = (player.cooldownMultiplier || 1) * 0.95;
        }
        
        socket.emit('upgradePurchased', { 
          type, 
          totalXp: player.totalXp,
          upgrades: player.upgrades,
        });
        
        console.log(`💰 ${player.name} bought ${type} upgrade (cost: ${cost} XP)`);
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

  // Recall to Sanctuary (B key) - 5 second cooldown
  socket.on('recall', () => {
    for (const player of gameState.players.values()) {
      if (player.socketId === socket.id && player.health > 0) {
        const now = Date.now();
        const RECALL_COOLDOWN = 5000; // 5 seconds
        
        // Check cooldown
        if (player.lastRecall && now - player.lastRecall < RECALL_COOLDOWN) {
          const remaining = Math.ceil((RECALL_COOLDOWN - (now - player.lastRecall)) / 1000);
          socket.emit('recallCooldown', { remaining });
          break;
        }
        
        // Store starting position for effect
        const fromX = player.x;
        const fromY = player.y;
        
        // Set cooldown
        player.lastRecall = now;
        
        // Teleport to sanctuary center
        player.x = 3000;
        player.y = 2500;
        
        // Notify client with both positions
        socket.emit('recalled', { 
          fromX, fromY, 
          toX: 3000, toY: 2500,
          cooldown: RECALL_COOLDOWN,
        });
        
        // Visual effect at departure location for other players
        io.emit('recallEffect', { x: fromX, y: fromY, playerId: player.id });
        io.emit('sound', { type: 'portalEnter', x: player.x, y: player.y });
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
        // Only voidlord can toggle PvP
        if (player.class === 'voidlord') {
          player.pvpEnabled = player.pvpEnabled === true ? false : true;
          socket.emit('pvpToggled', { enabled: player.pvpEnabled === true });
          console.log(`👹 ${player.name} PvP: ${player.pvpEnabled ? 'ON' : 'OFF'}`);
        }
        break;
      }
    }
  });

  // Get player data (for character select)
  socket.on('getPlayerData', async ({ playerId, playerName }) => {
    let saved = playerId ? await loadPlayerFromDb(playerId) : null;
    if (!saved && playerName) {
      saved = loadPlayerByName(playerName);
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

// ===========================================
// START SERVER
// ===========================================
httpServer.listen(PORT, () => {
  console.log(`\n🧙 Spell Brigade Server`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Tick Rate: ${TICK_RATE} Hz`);
  console.log(`   World: ${WORLD.width}x${WORLD.height}`);
  console.log(`   Classes: ${Object.keys(CLASSES).join(', ')}`);
  console.log(`\n   Ready for wizards! ✨\n`);
});

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(`\n${signal} received. Saving all players...`);
  
  // Save all connected players
  const savePromises = [];
  for (const player of gameState.players.values()) {
    savePromises.push(savePlayerToDb(player));
  }
  
  try {
    await Promise.all(savePromises);
    console.log(`Saved ${savePromises.length} players. Shutting down.`);
  } catch (err) {
    console.error('Error saving players:', err);
  }
  
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));