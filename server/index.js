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
const TICK_RATE = 30;
const TICK_INTERVAL = 1000 / TICK_RATE;

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
// WORLD & ZONES
// ===========================================
const WORLD = {
  width: 5000,
  height: 5000,
};

// Zones - each has different difficulty and enemy types
const ZONES = {
  sanctuary: {
    id: 'sanctuary',
    name: 'Sanctuary',
    description: 'Safe starting area. Heal and prepare here.',
    x: 2500,
    y: 2500,
    radius: 300,
    color: '#22c55e',
    isSafe: true,
    enemyLevel: 0,
    enemyTypes: [],
  },
  meadow: {
    id: 'meadow',
    name: 'Peaceful Meadow',
    description: 'Easy enemies. Good for beginners.',
    x: 2500,
    y: 2500,
    innerRadius: 300,
    outerRadius: 900,
    color: '#84cc16',
    enemyLevel: 1,
    enemyTypes: ['slime', 'bat'],
    xpMultiplier: 1.0,
    recommendedLevel: 1,
  },
  forest: {
    id: 'forest',
    name: 'Dark Forest',
    description: 'Moderate challenge. Spiders and skeletons lurk.',
    x: 2500,
    y: 2500,
    innerRadius: 900,
    outerRadius: 1600,
    color: '#166534',
    enemyLevel: 2,
    enemyTypes: ['skeleton', 'spider', 'ghost', 'necromancer'],
    xpMultiplier: 1.5,
    recommendedLevel: 5,
  },
  volcanic: {
    id: 'volcanic',
    name: 'Volcanic Wastes',
    description: 'Fire elementals and golems. High risk, high reward.',
    x: 2500,
    y: 2500,
    innerRadius: 1600,
    outerRadius: 2100,
    color: '#dc2626',
    enemyLevel: 3,
    enemyTypes: ['golem', 'fireElemental', 'necromancer'],
    xpMultiplier: 2.0,
    recommendedLevel: 10,
  },
  frozen: {
    id: 'frozen',
    name: 'Frozen Expanse',
    description: 'Ice elementals slow you down. Stay alert.',
    x: 2500,
    y: 2500,
    innerRadius: 2100,
    outerRadius: 2600,
    color: '#0ea5e9',
    enemyLevel: 4,
    enemyTypes: ['iceElemental', 'ghost', 'skeleton'],
    xpMultiplier: 2.5,
    recommendedLevel: 15,
  },
  abyss: {
    id: 'abyss',
    name: 'The Abyss',
    description: 'Only the strongest survive. Bosses spawn here.',
    x: 2500,
    y: 2500,
    innerRadius: 2600,
    outerRadius: 3500,
    color: '#581c87',
    enemyLevel: 5,
    enemyTypes: ['golem', 'necromancer', 'fireElemental', 'iceElemental'],
    xpMultiplier: 3.0,
    recommendedLevel: 20,
    bossChance: 0.02,
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
  const distFromCenter = Math.sqrt((x - 2500) ** 2 + (y - 2500) ** 2);
  
  // Check sanctuary first
  if (distFromCenter <= ZONES.sanctuary.radius) {
    return ZONES.sanctuary;
  }
  
  // Check other zones by distance
  const zoneOrder = ['meadow', 'forest', 'volcanic', 'frozen', 'abyss'];
  for (const zoneId of zoneOrder) {
    const zone = ZONES[zoneId];
    if (zone.innerRadius !== undefined && distFromCenter > zone.innerRadius && distFromCenter <= zone.outerRadius) {
      return zone;
    }
  }
  
  return ZONES.abyss;
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
};

const BOSS_RESPAWN_TIME = 5 * 60 * 1000; // 5 minutes

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
  gameState.damageNumbers.push({
    id: uuidv4(),
    x: x + (Math.random() - 0.5) * 20,
    y,
    amount: Math.round(amount),
    isCrit,
    createdAt: Date.now(),
    lifetime: 1000,
  });
}

// ===========================================
// PARTICLES
// ===========================================
function spawnParticles(x, y, color, count = 5) {
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
    if (zone.innerRadius !== undefined) {
      // Spawn within the zone ring
      const angle = Math.random() * Math.PI * 2;
      const dist = zone.innerRadius + Math.random() * (zone.outerRadius - zone.innerRadius);
      return {
        x: zone.x + Math.cos(angle) * dist,
        y: zone.y + Math.sin(angle) * dist,
        zone: forZone,
      };
    }
  }
  
  // Default: spawn at world edges
  const edge = Math.floor(Math.random() * 4);
  let x, y;
  
  switch (edge) {
    case 0: x = Math.random() * WORLD.width; y = -30; break;
    case 1: x = WORLD.width + 30; y = Math.random() * WORLD.height; break;
    case 2: x = Math.random() * WORLD.width; y = WORLD.height + 30; break;
    case 3: x = -30; y = Math.random() * WORLD.height; break;
  }
  
  return { x, y, zone: getZoneAtPosition(x, y)?.id };
}

function spawnEnemyInZone(zoneId) {
  const zone = ZONES[zoneId];
  if (!zone || zone.isSafe || zone.enemyTypes.length === 0) return;
  
  const pos = getSpawnPosition(zoneId);
  const enemyType = zone.enemyTypes[Math.floor(Math.random() * zone.enemyTypes.length)];
  
  spawnEnemy(enemyType, pos, zone.enemyLevel, zone.xpMultiplier);
}

function spawnEnemy(forceType = null, position = null, levelBoost = 0, xpMultiplier = 1) {
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
  
  const angle = Math.random() * Math.PI * 2;
  const dist = zone.innerRadius + (zone.outerRadius - zone.innerRadius) * 0.5;
  const pos = {
    x: zone.x + Math.cos(angle) * dist,
    y: zone.y + Math.sin(angle) * dist,
  };
  
  // Spawn the boss
  const bossId = spawnEnemy(bossType, pos, 0, 1);
  if (bossId) {
    gameState.zoneBosses.set(zoneId, bossId);
    console.log(`👑 Zone boss spawned: ${template.name} in ${zone.name}`);
  }
  
  return bossId;
}

// Handle boss death - set respawn timer
function onBossDeath(enemy) {
  const zoneId = enemy.zone;
  if (zoneId && ZONE_BOSS_TYPES[zoneId]) {
    gameState.zoneBosses.delete(zoneId);
    gameState.bossRespawnTimers.set(zoneId, Date.now() + BOSS_RESPAWN_TIME);
    console.log(`💀 Zone boss defeated: ${enemy.name} in ${zoneId} - respawns in 5 minutes`);
    
    // Announce to all players
    io.emit('bossDefeated', { 
      name: enemy.name, 
      zone: zoneId,
      respawnIn: BOSS_RESPAWN_TIME 
    });
  }
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
function createProjectile(player, spell, targetX, targetY) {
  const id = uuidv4();
  const dir = normalize({ x: targetX - player.x, y: targetY - player.y });
  
  const proj = {
    id,
    ownerId: player.id,
    ownerClass: player.class,
    ownerLevel: player.level || 1,
    spellId: spell.id,
    x: player.x,
    y: player.y,
    vx: dir.x * spell.speed,
    vy: dir.y * spell.speed,
    damage: spell.damage,
    radius: spell.radius,
    color: spell.color,
    trailColor: spell.trailColor || spell.color,
    maxRange: spell.range,
    traveled: 0,
    isAoe: spell.isAoe || spell.speed === 0,
    homing: spell.homing || false,
    slowEffect: spell.slowEffect,
    slowDuration: spell.slowDuration,
    targetId: null,
    createdAt: Date.now(),
  };
  
  // For homing missiles, track the target
  if (spell.homing) {
    let nearestEnemy = null;
    let nearestDist = spell.range;
    for (const enemy of gameState.enemies.values()) {
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

    // Animation frame
    player.animTime = (player.animTime || 0) + dt;
    if (player.animTime > 0.15) {
      player.animTime = 0;
      player.animFrame = ((player.animFrame || 0) + 1) % 4;
    }

    // Auto-cast spells
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

          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
            const dist = distance(player, enemy);
            if (dist < targetDist) {
              targetDist = dist;
              target = enemy;
            }
          }

          if (target) {
            createProjectile(player, spell, target.x, target.y);
            player.lastCast = player.lastCast || {};
            player.lastCast[spellId] = now;
            player.state = 'attack';
            
            // Sound event
            io.emit('sound', { type: 'spell', spellId, x: player.x, y: player.y });
          }
        }
      }
    }

    // Health regen in safe zone
    const distToSafe = distance(player, ZONES.sanctuary);
    if (distToSafe < ZONES.sanctuary.radius) {
      player.health = Math.min(player.health + 5 * dt, player.maxHealth);
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

    // Find nearest player
    let nearestPlayer = null;
    let nearestDist = Infinity;

    for (const player of alivePlayers) {
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
    if (enemy.isBoss && nearestPlayer) {
      const template = ENEMY_TYPES[enemy.type];
      const attackCooldown = template?.attackCooldown || 3000;
      
      if (now - (enemy.lastAbility || 0) > attackCooldown) {
        enemy.lastAbility = now;
        
        const attackType = template?.attackType;
        
        if (attackType === 'spore_burst') {
          // Blossom Behemoth: Shoot homing spores at nearby players
          for (const player of alivePlayers) {
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

    if (nearestPlayer) {
      // Don't enter safe zone
      const distToSafe = distance(enemy, ZONES.sanctuary);
      if (distToSafe > ZONES.sanctuary.radius + 50) {
        const dir = normalize({ 
          x: nearestPlayer.x - enemy.x, 
          y: nearestPlayer.y - enemy.y 
        });
        
        // Calculate new position
        let newX = enemy.x + dir.x * currentSpeed * dt;
        let newY = enemy.y + dir.y * currentSpeed * dt;
        
        // Zone bosses must stay in their zone
        if (enemy.isBoss && enemy.zone && ZONES[enemy.zone]) {
          const zone = ZONES[enemy.zone];
          const distFromCenter = Math.sqrt((newX - zone.x) ** 2 + (newY - zone.y) ** 2);
          
          // Check if new position would be outside zone
          if (zone.innerRadius !== undefined) {
            if (distFromCenter < zone.innerRadius || distFromCenter > zone.outerRadius) {
              // Don't move outside zone - maybe move along the boundary instead
              const currentDist = Math.sqrt((enemy.x - zone.x) ** 2 + (enemy.y - zone.y) ** 2);
              const targetDist = Math.max(zone.innerRadius + 20, Math.min(zone.outerRadius - 20, currentDist));
              const angleToCenter = Math.atan2(enemy.y - zone.y, enemy.x - zone.x);
              newX = zone.x + Math.cos(angleToCenter) * targetDist;
              newY = zone.y + Math.sin(angleToCenter) * targetDist;
            }
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

      // Attack player on collision
      const collisionDist = enemy.radius + 16; // player radius
      if (nearestDist < collisionDist && now - enemy.lastAttack > 500) {
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
      gameState.projectiles.delete(proj.id);
      continue;
    }

    // Homing behavior
    if (proj.homing && proj.targetId) {
      const target = gameState.enemies.get(proj.targetId);
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
        enemy.health -= proj.damage;
        
        // Spawn damage number
        spawnDamageNumber(enemy.x, enemy.y - 20, proj.damage);
        
        // Hit particles
        spawnParticles(enemy.x, enemy.y, proj.color, 4);
        
        if (proj.slowEffect && proj.slowDuration) {
          enemy.slowedUntil = Math.max(enemy.slowedUntil, now + proj.slowDuration);
        }

        checkEnemyDeath(enemy, proj.ownerId);
        hit = true;
        break;
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

  // --- BROADCAST STATE ---
  const stateSnapshot = {
    tick: gameState.tickCount,
    timestamp: now,
    players: [...gameState.players.values()].map(p => {
      // Calculate cooldowns
      const classData = CLASSES[p.class];
      const cooldowns = {};
      if (classData) {
        for (const spellId of classData.spells) {
          const spell = SPELLS[spellId];
          if (spell) {
            const lastCast = p.lastCast?.[spellId] || 0;
            const remaining = Math.max(0, spell.cooldown - (now - lastCast));
            cooldowns[spellId] = {
              remaining,
              total: spell.cooldown,
              ready: remaining === 0,
            };
          }
        }
        
        // Add dash cooldown
        if (classData.dashAbility) {
          const lastDash = p.lastDash || 0;
          const dashRemaining = Math.max(0, classData.dashAbility.cooldown - (now - lastDash));
          cooldowns.dash = {
            remaining: dashRemaining,
            total: classData.dashAbility.cooldown,
            ready: dashRemaining === 0,
            name: classData.dashAbility.name,
          };
        }
        
        // Add ultimate cooldown
        if (classData.ultimateAbility) {
          const lastUlt = p.lastUltimate || 0;
          const ultRemaining = Math.max(0, classData.ultimateAbility.cooldown - (now - lastUlt));
          cooldowns.ultimate = {
            remaining: ultRemaining,
            total: classData.ultimateAbility.cooldown,
            ready: ultRemaining === 0,
            name: classData.ultimateAbility.name,
          };
        }
      }

      return {
        id: p.id,
        name: p.name,
        class: p.class,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        health: Math.round(p.health),
        maxHealth: p.maxHealth,
        level: p.level,
        xp: p.xp,
        totalXp: p.totalXp || 0,
        xpToLevel: xpForLevel(p.level),
        kills: p.kills || 0,
        deaths: p.deaths || 0,
        state: p.state || 'idle',
        facing: p.facing || 'down',
        animFrame: p.animFrame || 0,
        selectedSkin: p.selectedSkin || `${p.class}_default`,
        cooldowns,
      };
    }),
    enemies: [...gameState.enemies.values()]
      .filter(e => e.health > 0 && (e.revealed !== false)) // Hide unrevealed mimics
      .map(e => ({
        id: e.id,
        type: e.behavior === 'ambush' && !e.revealed ? 'xpOrb' : e.type, // Disguise mimics
        name: e.name,
        x: Math.round(e.x * 10) / 10,
        y: Math.round(e.y * 10) / 10,
        health: Math.round(e.health),
        maxHealth: e.maxHealth,
        facing: e.facing || 'down',
        animFrame: e.animFrame || 0,
        isSlowed: e.slowedUntil > now,
        isFrozen: e.frozenUntil > now,
        isBoss: e.isBoss || false,
        behavior: e.behavior,
      })),
    projectiles: [...gameState.projectiles.values()].map(p => ({
      id: p.id,
      x: Math.round(p.x * 10) / 10,
      y: Math.round(p.y * 10) / 10,
      radius: p.radius,
      color: p.color,
      trailColor: p.trailColor,
      spellId: p.spellId,
      ownerClass: p.ownerClass,
      level: p.ownerLevel || 1,
    })),
    xpOrbs: [...gameState.xpOrbs.values()].map(o => ({
      id: o.id,
      x: Math.round(o.x * 10) / 10,
      y: Math.round(o.y * 10) / 10,
      amount: o.amount,
    })),
    particles: gameState.particles.map(p => ({
      x: Math.round(p.x),
      y: Math.round(p.y),
      color: p.color,
      radius: p.radius,
      alpha: 1 - (now - p.createdAt) / p.lifetime,
    })),
    damageNumbers: gameState.damageNumbers.map(d => ({
      x: d.x,
      y: d.y - ((now - d.createdAt) / d.lifetime) * 30, // Float upward
      amount: d.amount,
      isCrit: d.isCrit,
      alpha: 1 - (now - d.createdAt) / d.lifetime,
    })),
    world: WORLD,
    zones: ZONES,
    safeZone: { x: ZONES.sanctuary.x, y: ZONES.sanctuary.y, radius: ZONES.sanctuary.radius },
  };

  io.emit('gameState', stateSnapshot);
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
    
    // Zone boss death - set respawn timer
    if (enemy.isBoss && enemy.zone) {
      onBossDeath(enemy);
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

  socket.on('join', async ({ playerId, playerName, playerClass, selectedSkin }) => {
    // Prevent double-join from same socket
    for (const p of gameState.players.values()) {
      if (p.socketId === socket.id) {
        socket.emit('error', { message: 'Already in game' });
        return;
      }
    }
    
    // Validate class
    const classData = CLASSES[playerClass] || CLASSES.pyromancer;
    
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
      x: ZONES.sanctuary.x,
      y: ZONES.sanctuary.y,
      health: classData.baseHealth + healthBonus,
      maxHealth: classData.baseHealth + healthBonus,
      baseSpeed: classData.baseSpeed + speedBonus,
      damageMultiplier,
      input: { up: false, down: false, left: false, right: false },
      lastCast: {},
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
        player.x = ZONES.sanctuary.x + (Math.random() - 0.5) * 100;
        player.y = ZONES.sanctuary.y + (Math.random() - 0.5) * 100;
        player.state = 'idle';
        socket.emit('respawned', { health: player.health });
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