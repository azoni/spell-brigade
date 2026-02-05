import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import admin from 'firebase-admin';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { generateDungeon, generateDungeonLLM, getDungeonRoom, getDungeonBounds, getRoomEnemies, getRoomCenterY, sanitizeDungeonForClient } from './dungeon-generator.js';
import { generateWizard } from './wizard-generator.js';
import { isLLMEnabled } from './openrouter.js';

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
  width: 7000,
  height: 6000,
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

// Zones with polygon boundaries - Updated for larger world (7000x6000)
const SANCTUARY_CENTER = { x: 3500, y: 3000 };
const SANCTUARY_RADIUS = 600;
const SANCTUARY_BUFFER = 200; // Enemies won't get closer than this to sanctuary

const ZONES = {
  sanctuary: {
    id: 'sanctuary',
    name: 'Sanctuary',
    description: 'Safe starting area with portal hub and healing fountain.',
    color: '#22c55e',
    isSafe: true,
    enemyLevel: 0,
    enemyTypes: [],
    recommendedLevel: 0,
    x: SANCTUARY_CENTER.x,
    y: SANCTUARY_CENTER.y,
    radius: SANCTUARY_RADIUS,
    polygon: [
      { x: 3500, y: 2325 },
      { x: 4025, y: 2663 },
      { x: 4025, y: 3338 },
      { x: 3500, y: 3675 },
      { x: 2975, y: 3338 },
      { x: 2975, y: 2663 },
    ],
  },
  dungeon: {
    id: 'dungeon',
    name: "Dragon's Gauntlet",
    description: 'A treacherous dungeon. Only the strongest survive.',
    color: '#991b1b',
    isSafe: false,
    enemyLevel: 30,
    enemyTypes: ['dungeon_skeleton', 'dungeon_wraith', 'dungeon_golem', 'dungeon_demon'],
    xpMultiplier: 5.0,
    recommendedLevel: 30,
    isDungeon: true,
    polygon: [
      { x: 0, y: 0 },
      { x: 800, y: 0 },
      { x: 800, y: 3200 },
      { x: 0, y: 3200 },
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
      { x: 2500, y: 2000 }, { x: 4500, y: 2000 }, { x: 5000, y: 2500 },
      { x: 5000, y: 3500 }, { x: 4500, y: 4000 }, { x: 2500, y: 4000 },
      { x: 2000, y: 3500 }, { x: 2000, y: 2500 },
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
      { x: 300, y: 300 }, { x: 2200, y: 300 }, { x: 2500, y: 2000 },
      { x: 2000, y: 2500 }, { x: 1500, y: 2800 }, { x: 600, y: 2500 },
      { x: 200, y: 1800 }, { x: 200, y: 800 },
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
      { x: 4800, y: 300 }, { x: 6700, y: 300 }, { x: 6800, y: 1800 },
      { x: 6500, y: 2500 }, { x: 5500, y: 2800 }, { x: 5000, y: 2500 },
      { x: 4500, y: 2000 }, { x: 4500, y: 800 },
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
      { x: 1800, y: 4000 }, { x: 5200, y: 4000 }, { x: 5500, y: 4500 },
      { x: 5200, y: 5700 }, { x: 1800, y: 5700 }, { x: 1500, y: 4500 },
    ],
  },
  abyss: {
    id: 'abyss',
    name: 'The Abyss',
    description: 'Only the strongest survive. Extreme danger.',
    color: '#7c3aed',
    enemyLevel: 5,
    enemyTypes: ['golem', 'necromancer', 'fireElemental', 'iceElemental'],
    xpMultiplier: 3.0,
    recommendedLevel: 20,
    bossChance: 0.02,
    polygon: [
      { x: 100, y: 100 }, { x: 1000, y: 100 }, { x: 1200, y: 300 },
      { x: 800, y: 1200 }, { x: 200, y: 1500 }, { x: 100, y: 800 },
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
      { x: 6000, y: 3000 }, { x: 6800, y: 2800 }, { x: 6900, y: 3500 },
      { x: 6800, y: 4500 }, { x: 6200, y: 5000 }, { x: 5800, y: 4200 },
      { x: 5800, y: 3400 },
    ],
  },
};

// Helper: Check if position is too close to sanctuary (for enemy spawning/movement)
function isTooCloseToSanctuary(x, y) {
  const dx = x - SANCTUARY_CENTER.x;
  const dy = y - SANCTUARY_CENTER.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < (SANCTUARY_RADIUS + SANCTUARY_BUFFER);
}

// Portal definitions - All portals in sanctuary hub, teleport to zone centers
const PORTALS = {
  portal_meadow: {
    id: 'portal_meadow',
    name: 'Meadow Portal',
    icon: '🌸',
    from: { x: 3500, y: 2425 },  // North position in sanctuary
    to: { x: 3500, y: 2100 },    // Just outside sanctuary in meadow
    fromZone: 'sanctuary',
    toZone: 'meadow',
    color: '#84cc16',
    requiredLevel: 0,
    description: 'Peaceful fields for beginners',
  },
  portal_forest: {
    id: 'portal_forest',
    name: 'Forest Portal',
    icon: '🌲',
    from: { x: 3050, y: 2750 },  // Northwest position
    to: { x: 1400, y: 1400 },    // Center of forest
    fromZone: 'sanctuary',
    toZone: 'forest',
    color: '#166534',
    requiredLevel: 5,
    description: 'Dark woods with lurking dangers',
  },
  portal_volcanic: {
    id: 'portal_volcanic',
    name: 'Volcanic Portal',
    icon: '🔥',
    from: { x: 3950, y: 2750 },  // Northeast position
    to: { x: 5800, y: 1400 },    // Center of volcanic
    fromZone: 'sanctuary',
    toZone: 'volcanic',
    color: '#dc2626',
    requiredLevel: 10,
    description: 'Scorching lands of fire',
  },
  portal_frozen: {
    id: 'portal_frozen',
    name: 'Frozen Portal',
    icon: '❄️',
    from: { x: 3500, y: 3575 },  // South position
    to: { x: 3500, y: 4800 },    // Center of frozen
    fromZone: 'sanctuary',
    toZone: 'frozen',
    color: '#0ea5e9',
    requiredLevel: 15,
    description: 'Icy wastes of the south',
  },
  portal_crystal: {
    id: 'portal_crystal',
    name: 'Crystal Portal',
    icon: '💎',
    from: { x: 3950, y: 3250 },  // Southeast position
    to: { x: 6300, y: 3800 },    // Center of crystal caves
    fromZone: 'sanctuary',
    toZone: 'crystal_caves',
    color: '#ec4899',
    requiredLevel: 8,
    description: 'Glittering underground caves',
  },
  portal_abyss: {
    id: 'portal_abyss',
    name: 'Abyss Portal',
    icon: '🌀',
    from: { x: 3050, y: 3250 },  // Southwest position
    to: { x: 500, y: 700 },      // Center of abyss
    fromZone: 'sanctuary',
    toZone: 'abyss',
    color: '#7c3aed',
    requiredLevel: 20,
    description: 'The darkest depths - extreme danger',
  },
};

// Buildings/Structures
const BUILDINGS = {
  wizard_tower: {
    id: 'wizard_tower',
    name: "Archmage's Tower",
    x: 3500, y: 2800,
    width: 60, height: 100,
    zone: 'sanctuary',
    color: '#ffd93d',
    interactable: true,
    services: ['respawn', 'heal'],
    upgradeType: null, // Hint only - no upgrades
  },
  forest_ruins: {
    id: 'forest_ruins',
    name: 'Ancient Ruins',
    x: 1200, y: 1600,
    width: 150, height: 100,
    zone: 'forest',
    color: '#78716c',
    interactable: true,
    upgradeType: 'health',
  },
  volcano_fortress: {
    id: 'volcano_fortress',
    name: 'Obsidian Fortress',
    x: 5900, y: 1600,
    width: 180, height: 140,
    zone: 'volcanic',
    color: '#7f1d1d',
    interactable: true,
    upgradeType: 'damage',
  },
  ice_citadel: {
    id: 'ice_citadel',
    name: 'Ice Citadel',
    x: 3500, y: 5000,
    width: 160, height: 130,
    zone: 'frozen',
    color: '#0284c7',
    interactable: true,
    upgradeType: 'cooldown',
  },
  void_shrine: {
    id: 'void_shrine',
    name: 'Void Shrine',
    x: 500, y: 500,
    width: 100, height: 100,
    zone: 'abyss',
    color: '#7c3aed',
    interactable: true,
    upgradeType: 'speed',
  },
  crystal_sanctum: {
    id: 'crystal_sanctum',
    name: 'Crystal Sanctum',
    x: 6400, y: 4000,
    width: 120, height: 110,
    zone: 'crystal_caves',
    color: '#ec4899',
    interactable: true,
    upgradeType: 'attackSpeed',
  },
  // Healing Fountain in sanctuary center
  healing_fountain: {
    id: 'healing_fountain',
    name: 'Healing Fountain',
    x: 3500, y: 3000,
    width: 100, height: 100,
    zone: 'sanctuary',
    color: '#22c55e',
    interactable: false,
    isDecoration: true,
    healingRadius: 100,
    healRate: 15, // HP per second when standing in fountain
  },
};

// ===========================================
// NPCs
// ===========================================
const NPCS = {
  ethereal_guide: {
    id: 'ethereal_guide',
    name: 'Ethereal Guide',
    type: 'guide',
    x: 3350, y: 2600,
    radius: 20,
    zone: 'sanctuary',
    color: '#67e8f9',
    interactRange: 80,
    stationary: true,
    greetings: [
      "Welcome, traveler. The realm awaits your courage.",
      "Ah, another brave soul. May the arcane guide your path.",
      "Greetings, wizard. The sanctuary protects all who seek refuge.",
      "The world beyond grows dark. Prepare yourself well.",
      "I have watched countless heroes pass through. Will you be different?",
      "The healing fountain at the center restores your strength. Use it wisely.",
      "The portal hub will take you to any zone. But beware - some require great power.",
    ],
  },
  quest_master: {
    id: 'quest_master',
    name: 'Quest Master Seraphina',
    type: 'quest_master',
    x: 3200, y: 2900,
    radius: 18,
    zone: 'sanctuary',
    color: '#ffd93d',
    interactRange: 80,
    stationary: true,
    dialogues: {
      initial: [
        "Greetings, young wizard. I am Seraphina, keeper of quests.",
        "The realm is threatened by powerful bosses in each zone.",
        "Only by defeating them all can peace be restored.",
      ],
      questOffer: [
        "I have a task for you, if you're brave enough.",
        "Six mighty bosses terrorize the lands: the Blossom Behemoth in the Meadow,",
        "the Ancient Treant in the Forest, the Magma Titan in the Volcanic Wastes,",
        "the Frost Wyrm in the Frozen Expanse, the Crystal Golem in the Crystal Caves,",
        "and the Void Overlord in the Abyss.",
        "Defeat them all, and you shall be known as Champion of the Realm!",
      ],
      questActive: "Your quest continues. Check your quest log to see your progress.",
      questComplete: "Incredible! You have defeated all the bosses! You are truly a Champion!",
      prompt: "Will you accept this quest?",
    },
    quest: {
      id: 'allBosses',
      name: 'Champion of the Realm',
      description: 'Defeat all 6 zone bosses to prove your worth.',
      reward: { xp: 5000, title: 'Champion' },
    },
  },
  knight_commander: {
    id: 'knight_commander',
    name: 'Knight Commander Aldric',
    type: 'knight',
    x: 3750, y: 3200,
    radius: 18,
    zone: 'sanctuary',
    color: '#a8a29e',
    interactRange: 80,
    stationary: true, // Stands guard near southeast
    dialogues: {
      initial: [
        "Halt, wizard. I am Knight Commander Aldric.",
        "I guard the passage to the Dragon's Gauntlet - a dungeon of unspeakable danger.",
        "Many have entered. Few have returned.",
      ],
      warning: [
        "You seek to challenge the Infernal Dragon?",
        "I would advise reaching at least level 30 before attempting such folly.",
        "The creatures within grow stronger the deeper you venture.",
        "At the end awaits the dragon itself... a beast of nightmares.",
      ],
      prompt: "Do you wish to enter the Dragon's Gauntlet?",
      tooWeak: "You are not ready. Return when you have grown stronger. (Recommended: Level 30)",
      enter: "Very well. May your flames burn bright, wizard. Step through when ready.",
    },
  },
  shapeshifter: {
    id: 'shapeshifter',
    name: 'Mirage the Shapeshifter',
    type: 'shapeshifter',
    x: 3150, y: 3100,
    radius: 20,
    zone: 'sanctuary',
    color: '#ec4899',
    interactRange: 80,
    stationary: true,
    forms: [
      { name: 'Mirage the Shapeshifter', emoji: '🦋', color: '#ec4899', desc: 'A butterfly of prismatic light' },
      { name: 'Umbra the Shadow', emoji: '👻', color: '#6b7280', desc: 'A wisp of living darkness' },
      { name: 'Prism the Elemental', emoji: '💎', color: '#06b6d4', desc: 'A crystalline being of pure energy' },
      { name: 'Phoenix Ember', emoji: '🔥', color: '#f97316', desc: 'A bird made of eternal flame' },
      { name: 'Whisper the Fae', emoji: '✨', color: '#a855f7', desc: 'A mischievous fairy creature' },
      { name: 'Tempest the Storm', emoji: '⚡', color: '#fbbf24', desc: 'Lightning given physical form' },
      { name: 'Frost Bloom', emoji: '❄️', color: '#67e8f9', desc: 'An ice flower that never melts' },
      { name: 'The Wandering Eye', emoji: '👁️', color: '#ef4444', desc: 'A floating orb of arcane sight' },
    ],
    currentFormIndex: 0,
    lastFormChange: 0,
    formChangeInterval: 15 * 60 * 1000, // 15 minutes
    greetings: [
      "Ah, you see me as I am now... but in a moment, I could be anything.",
      "Identity is fluid, young one. Would you like to change your appearance?",
      "I have walked this world in a thousand forms. Perhaps you seek a new look?",
      "The mirror shows what we choose to be. Let me help you reshape yourself.",
    ],
    skinPrompt: "Would you like to change your appearance?",
  },
  dungeon_architect: {
    id: 'dungeon_architect',
    name: 'Arcanus the Dreamweaver',
    type: 'dungeon_architect',
    x: 3800, y: 2900,
    radius: 20,
    zone: 'sanctuary',
    color: '#8b5cf6',
    interactRange: 80,
    stationary: true,
    emoji: '🏗️',
    greetings: [
      "Ah, a visitor! I am Arcanus, weaver of pocket dimensions.",
      "I can shape the fabric of reality into any dungeon you can imagine.",
      "Describe your nightmare, and I shall build it for you to conquer.",
      "Want to test your skills? I have dungeons crafted by other wizards too.",
    ],
  },
};

// NPC State tracking
const npcStates = new Map();

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
  
  // Voidlord skins (unlocked after dragon kill)
  voidlord_default: { id: 'voidlord_default', class: 'voidlord', name: 'Void Lord', color: '#1a0a2e', requiredXp: 0 },
  voidlord_ascended: { id: 'voidlord_ascended', class: 'voidlord', name: 'Ascended', color: '#ff00ff', requiredXp: 5000 },
  
  // Shadow Archer skins (Admin)
  shadowarcher_default: { id: 'shadowarcher_default', class: 'shadowarcher', name: 'Shadow Archer', color: '#334155', requiredXp: 0 },
  shadowarcher_crimson: { id: 'shadowarcher_crimson', class: 'shadowarcher', name: 'Crimson Hunter', color: '#991b1b', requiredXp: 0 },
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
  
  // === UNLOCKABLE CLASS - After Dragon Kill ===
  voidlord: {
    id: 'voidlord',
    name: 'Void Lord',
    color: '#1a0a2e',
    secondaryColor: '#ff00ff',
    baseHealth: 95,
    baseSpeed: 155,
    spells: ['voidBolt', 'annihilate'],
    description: 'Master of the void. Unlocked by slaying the Dragon.',
    hidden: true, // Hidden until dragon is killed
    requiresDragonKill: true,
    dashAbility: {
      id: 'voidShift',
      name: 'Void Shift',
      cooldown: 5000,
      distance: 200,
      invulnerable: true,
      damageOnArrival: 25,
      damageRadius: 60,
    },
    ultimateAbility: {
      id: 'voidRift',
      name: 'Void Rift',
      cooldown: 22000,
      damage: 80,
      radius: 200,
      pullForce: 100,
      duration: 2500,
    },
  },
  
  // === ADMIN CLASS - Shadow Archer ===
  shadowarcher: {
    id: 'shadowarcher',
    name: 'Shadow Archer',
    color: '#334155',
    secondaryColor: '#dc2626',
    baseHealth: 200,
    baseSpeed: 280,
    spells: ['shadowArrow', 'piercingVolley'],
    description: 'Elite shadow hunter. Admin exclusive.',
    isAdmin: true,
    hidden: true,
    canPvP: true,
    icon: '🏹',
    dashAbility: {
      id: 'shadowStep',
      name: 'Shadow Step',
      cooldown: 2000,
      distance: 350,
      invulnerable: true,
      damageOnArrival: 40,
      damageRadius: 80,
    },
    ultimateAbility: {
      id: 'arrowStorm',
      name: 'Arrow Storm',
      cooldown: 10000,
      damage: 150,
      radius: 350,
      duration: 2000,
      waves: 5,
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
    damage: 30,
    cooldown: 700,
    range: 350,
    speed: 500,
    radius: 12,
    color: '#1a0a2e',
    trailColor: '#ff00ff',
    piercing: true,
    isVoidBolt: true,
  },
  annihilate: {
    id: 'annihilate',
    name: 'Annihilate',
    damage: 45,
    cooldown: 2500,
    range: 300,
    speed: 0, // AOE
    radius: 120,
    color: '#ff00ff',
    isAoe: true,
  },
  
  // === SHADOW ARCHER SPELLS ===
  shadowArrow: {
    id: 'shadowArrow',
    name: 'Shadow Arrow',
    damage: 55,
    cooldown: 350,
    range: 550,
    speed: 900,
    radius: 8,
    color: '#0f172a',
    trailColor: '#dc2626',
    piercing: true,
    canHitPlayers: true,
    isArrow: true,
  },
  piercingVolley: {
    id: 'piercingVolley',
    name: 'Piercing Volley',
    damage: 80,
    cooldown: 1500,
    range: 450,
    speed: 0,
    radius: 180,
    color: '#dc2626',
    isAoe: true,
    canHitPlayers: true,
  },
  
  // === PYROMANCER CLASS ABILITIES ===
  flameShield: {
    id: 'flameShield',
    name: 'Flame Shield',
    damage: 15,
    cooldown: 12000,
    range: 0,
    speed: 0,
    radius: 80,
    color: '#ff6b35',
    isAoe: true,
    duration: 5000,
    class: 'pyromancer',
    levelRequired: 10,
    hotkey: 1,
    description: 'Surround yourself with flames, damaging nearby enemies',
  },
  meteorStrike: {
    id: 'meteorStrike',
    name: 'Meteor Strike',
    damage: 80,
    cooldown: 18000,
    range: 350,
    speed: 0,
    radius: 100,
    color: '#ff4500',
    isAoe: true,
    delay: 1500,
    class: 'pyromancer',
    levelRequired: 20,
    hotkey: 2,
    description: 'Call down a devastating meteor from the sky',
  },
  inferno: {
    id: 'inferno',
    name: 'Inferno',
    damage: 150,
    cooldown: 45000,
    range: 0,
    speed: 0,
    radius: 250,
    color: '#ff0000',
    isAoe: true,
    class: 'pyromancer',
    levelRequired: 30,
    hotkey: 3,
    description: 'Unleash a massive explosion of fire around you',
  },

  // === CRYOMANCER CLASS ABILITIES ===
  frostNova: {
    id: 'frostNova',
    name: 'Frost Nova',
    damage: 25,
    cooldown: 10000,
    range: 0,
    speed: 0,
    radius: 120,
    color: '#00ffff',
    isAoe: true,
    freezeDuration: 3000,
    class: 'cryomancer',
    levelRequired: 10,
    hotkey: 1,
    description: 'Freeze all nearby enemies in place',
  },
  iceLance: {
    id: 'iceLance',
    name: 'Ice Lance',
    damage: 60,
    cooldown: 15000,
    range: 500,
    speed: 700,
    radius: 10,
    color: '#00ccff',
    trailColor: '#87ceeb',
    piercing: true,
    slowEffect: 0.8,
    slowDuration: 4000,
    class: 'cryomancer',
    levelRequired: 20,
    hotkey: 2,
    description: 'Pierce through enemies with a massive ice shard',
  },
  glacialStorm: {
    id: 'glacialStorm',
    name: 'Glacial Storm',
    damage: 40,
    cooldown: 40000,
    range: 300,
    speed: 0,
    radius: 200,
    color: '#b3e5fc',
    isAoe: true,
    duration: 6000,
    freezeDuration: 2000,
    class: 'cryomancer',
    levelRequired: 30,
    hotkey: 3,
    description: 'Summon a devastating blizzard that freezes all enemies',
  },

  // === ARCANIST CLASS ABILITIES ===
  blink: {
    id: 'blink',
    name: 'Blink',
    damage: 0,
    cooldown: 8000,
    range: 200,
    speed: 0,
    radius: 0,
    color: '#9b5de5',
    isTeleport: true,
    class: 'arcanist',
    levelRequired: 10,
    hotkey: 1,
    description: 'Instantly teleport a short distance',
  },
  arcaneBarrage: {
    id: 'arcaneBarrage',
    name: 'Arcane Barrage',
    damage: 30,
    cooldown: 14000,
    range: 400,
    speed: 500,
    radius: 8,
    color: '#e056fd',
    trailColor: '#9b5de5',
    homing: true,
    projectileCount: 5,
    class: 'arcanist',
    levelRequired: 20,
    hotkey: 2,
    description: 'Launch multiple homing arcane missiles',
  },
  timeWarp: {
    id: 'timeWarp',
    name: 'Time Warp',
    damage: 0,
    cooldown: 60000,
    range: 0,
    speed: 0,
    radius: 0,
    color: '#d4af37',
    duration: 8000,
    speedBoost: 1.5,
    cooldownReduction: 0.5,
    class: 'arcanist',
    levelRequired: 30,
    hotkey: 3,
    description: 'Warp time - gain massive speed and cooldown reduction',
  },

  // === STORMCALLER CLASS ABILITIES ===
  staticField: {
    id: 'staticField',
    name: 'Static Field',
    damage: 20,
    cooldown: 9000,
    range: 0,
    speed: 0,
    radius: 100,
    color: '#ffff00',
    isAoe: true,
    stunDuration: 1000,
    class: 'stormcaller',
    levelRequired: 10,
    hotkey: 1,
    description: 'Shock nearby enemies with electricity',
  },
  ballLightning: {
    id: 'ballLightning',
    name: 'Ball Lightning',
    damage: 100,
    cooldown: 16000,
    range: 500,
    speed: 150,
    radius: 30,
    color: '#ffd700',
    trailColor: '#ffff00',
    piercing: true,
    chainLightning: true,
    class: 'stormcaller',
    levelRequired: 20,
    hotkey: 2,
    description: 'Send a slow but devastating ball of lightning',
  },
  thunderGod: {
    id: 'thunderGod',
    name: 'Thunder God',
    damage: 200,
    cooldown: 50000,
    range: 0,
    speed: 0,
    radius: 350,
    color: '#ffffff',
    isAoe: true,
    chainCount: 8,
    class: 'stormcaller',
    levelRequired: 30,
    hotkey: 3,
    description: 'Call upon the fury of storms to devastate all enemies',
  },

  // === VOIDLORD CLASS ABILITIES ===
  voidRiftAbility: {
    id: 'voidRiftAbility',
    name: 'Void Rift',
    damage: 30,
    cooldown: 10000,
    range: 250,
    speed: 0,
    radius: 100,
    color: '#8b00ff',
    isAoe: true,
    duration: 3000,
    class: 'voidlord',
    levelRequired: 10,
    hotkey: 1,
    description: 'Tear open a rift to the void that damages enemies',
  },
  soulDrain: {
    id: 'soulDrain',
    name: 'Soul Drain',
    damage: 40,
    cooldown: 14000,
    range: 350,
    speed: 400,
    radius: 12,
    color: '#ff00ff',
    trailColor: '#8b008b',
    homing: true,
    lifesteal: 0.3,
    class: 'voidlord',
    levelRequired: 20,
    hotkey: 2,
    description: 'Launch a soul-seeking projectile that heals you',
  },
  apocalypse: {
    id: 'apocalypse',
    name: 'Apocalypse',
    damage: 120,
    cooldown: 45000,
    range: 0,
    speed: 0,
    radius: 250,
    color: '#1a0a2e',
    isAoe: true,
    class: 'voidlord',
    levelRequired: 30,
    hotkey: 3,
    description: 'Unleash the void to annihilate everything nearby',
  },
  
  // === SHADOW ARCHER CLASS ABILITIES ===
  huntersMark: {
    id: 'huntersMark',
    name: "Hunter's Mark",
    damage: 30,
    cooldown: 6000,
    range: 500,
    speed: 1200,
    radius: 8,
    color: '#dc2626',
    trailColor: '#991b1b',
    isArrow: true,
    piercing: true,
    canHitPlayers: true,
    class: 'shadowarcher',
    levelRequired: 10,
    hotkey: 1,
    description: 'Mark a target - next attacks deal bonus damage',
  },
  multishot: {
    id: 'multishot',
    name: 'Multishot',
    damage: 40,
    cooldown: 10000,
    range: 0,
    speed: 0,
    radius: 250,
    color: '#dc2626',
    isAoe: true,
    canHitPlayers: true,
    class: 'shadowarcher',
    levelRequired: 20,
    hotkey: 2,
    description: 'Fire arrows in all directions',
  },
  deathArrow: {
    id: 'deathArrow',
    name: 'Death Arrow',
    damage: 300,
    cooldown: 30000,
    range: 700,
    speed: 1500,
    radius: 12,
    color: '#000',
    trailColor: '#dc2626',
    isArrow: true,
    piercing: true,
    canHitPlayers: true,
    class: 'shadowarcher',
    levelRequired: 30,
    hotkey: 3,
    description: 'A devastating arrow that obliterates its target',
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
  // DUNGEON ENEMIES - Dragon's Gauntlet
  dungeon_skeleton: {
    id: 'dungeon_skeleton',
    name: 'Cursed Knight',
    health: 200,
    damage: 35,
    speed: 60,
    radius: 18,
    xp: 80,
    color: '#44403c',
    behavior: 'chase',
    isDungeon: true,
  },
  dungeon_wraith: {
    id: 'dungeon_wraith',
    name: 'Soul Wraith',
    health: 150,
    damage: 45,
    speed: 85,
    radius: 16,
    xp: 100,
    color: '#3730a3',
    behavior: 'phase',
    isDungeon: true,
  },
  dungeon_golem: {
    id: 'dungeon_golem',
    name: 'Obsidian Guardian',
    health: 400,
    damage: 50,
    speed: 35,
    radius: 28,
    xp: 150,
    color: '#1c1917',
    behavior: 'chase',
    isDungeon: true,
  },
  dungeon_demon: {
    id: 'dungeon_demon',
    name: 'Infernal Demon',
    health: 300,
    damage: 60,
    speed: 70,
    radius: 22,
    xp: 200,
    color: '#7f1d1d',
    behavior: 'chase',
    isDungeon: true,
    attackCooldown: 3000,
    attackType: 'demon_fire', // Shoots fireballs
  },
  
  // DUNGEON MINI-BOSSES
  dungeon_minotaur: {
    id: 'dungeon_minotaur',
    name: 'Ironhide Minotaur',
    health: 5000,
    damage: 90,
    speed: 80,
    radius: 40,
    xp: 1200,
    color: '#78350f',
    behavior: 'charge',
    isMiniBoss: true,
    isDungeon: true,
    zone: 'dungeon',
    attackCooldown: 2500,
    chargeSpeed: 350,
    chargeDistance: 500,
  },
  dungeon_lich: {
    id: 'dungeon_lich',
    name: 'Lich King',
    health: 4000,
    damage: 70,
    speed: 55,
    radius: 32,
    xp: 1000,
    color: '#1e1b4b',
    behavior: 'caster',
    isMiniBoss: true,
    isDungeon: true,
    zone: 'dungeon',
    attackCooldown: 1800,
    summonCount: 4,
  },
  
  // DRAGON BOSS - Final boss of dungeon (2.5x bigger)
  boss_dragon: {
    id: 'boss_dragon',
    name: 'Infernal Dragon',
    health: 40000,
    damage: 150,
    speed: 55,
    radius: 80,
    xp: 15000,
    color: '#b91c1c',
    behavior: 'boss_dragon',
    isBoss: true,
    isDungeon: true,
    zone: 'dungeon',
    attackCooldown: 1500,
    attackRange: 700,
    attacks: ['flame_breath', 'wing_gust', 'tail_swipe', 'summon_minions', 'meteor_rain', 'rage_mode'],
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
    bossKills: player.bossKills || {},
    questComplete: player.questComplete || false,
    spellUpgrades: player.spellUpgrades || [],
    upgrades: player.upgrades || { health: 0, damage: 0, speed: 0, cooldown: 0, attackSpeed: 0 },
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

// Get random point inside a zone polygon (avoids sanctuary buffer)
function getRandomPointInZone(zoneId) {
  const zone = ZONES[zoneId];
  if (!zone || !zone.polygon) return { x: 3500, y: 3000 };
  
  // Get bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of zone.polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  
  // Try to find a point inside polygon that's not too close to sanctuary
  for (let i = 0; i < 100; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    if (pointInPolygon(x, y, zone.polygon)) {
      // Skip if too close to sanctuary (except for sanctuary itself)
      if (zoneId !== 'sanctuary' && isTooCloseToSanctuary(x, y)) {
        continue;
      }
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
  npcs: new Map(),         // NPCs (id -> npc state)
  dungeonInstances: new Map(), // Player dungeon instances
  customDungeons: new Map(), // Custom AI-generated dungeons (id -> config)
  customWizards: new Map(),  // Custom AI-generated wizard classes (classId -> { classDef, spellDefs })
  lastTick: Date.now(),
  tickCount: 0,
};

// Initialize NPCs
function initNpcs() {
  for (const [id, npc] of Object.entries(NPCS)) {
    const npcState = {
      ...npc,
      currentX: npc.x,
      currentY: npc.y,
      facing: 'down',
      wanderAngle: Math.random() * Math.PI * 2,
      lastWander: Date.now(),
    };
    
    // Initialize shapeshifter with first form
    if (npc.type === 'shapeshifter' && npc.forms && npc.forms.length > 0) {
      npcState.currentFormIndex = 0;
      npcState.emoji = npc.forms[0].emoji;
      npcState.lastFormChange = Date.now();
    }
    
    gameState.npcs.set(id, npcState);
  }
  console.log(`✨ Initialized ${gameState.npcs.size} NPCs`);
}

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
  // Increase timeouts for better tab inactivity handling
  pingTimeout: 1800000,   // 30 minutes
  pingInterval: 60000,    // 1 minute
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
// AUTHENTICATION SYSTEM
// ===========================================

// Users database (separate from player characters)
const usersDb = {};
const sessionsDb = {};

// Generate session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Save user to Firebase
async function saveUserToDb(user) {
  if (db) {
    try {
      await db.collection('spellBrigadeUsers').doc(user.id).set(user, { merge: true });
    } catch (err) {
      console.error('Firebase user save error:', err.message);
    }
  }
  usersDb[user.id] = user;
}

// Load user from Firebase
async function loadUserFromDb(id) {
  if (usersDb[id]) return usersDb[id];
  if (db) {
    try {
      const doc = await db.collection('spellBrigadeUsers').doc(id).get();
      if (doc.exists) {
        usersDb[id] = doc.data();
        return usersDb[id];
      }
    } catch (err) {
      console.error('Firebase user load error:', err.message);
    }
  }
  return null;
}

// Find user by username
async function findUserByUsername(username) {
  const lowerUsername = username.toLowerCase();
  // Check cache first
  const cached = Object.values(usersDb).find(u => u.username?.toLowerCase() === lowerUsername);
  if (cached) return cached;
  
  // Check Firebase
  if (db) {
    try {
      const snapshot = await db.collection('spellBrigadeUsers')
        .where('usernameLower', '==', lowerUsername)
        .limit(1)
        .get();
      if (!snapshot.empty) {
        const user = snapshot.docs[0].data();
        usersDb[user.id] = user;
        return user;
      }
    } catch (err) {
      console.error('Firebase user search error:', err.message);
    }
  }
  return null;
}

// Signup endpoint
app.post('/auth/signup', async (req, res) => {
  const { username, password } = req.body;
  
  // Validate input
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ error: 'Username must be 3-20 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
  }
  
  // Check if username already exists
  const existing = await findUserByUsername(username);
  if (existing) {
    return res.status(400).json({ error: 'Username already taken' });
  }
  
  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);
  
  // Create user
  const userId = 'user_' + crypto.randomBytes(8).toString('hex');
  const user = {
    id: userId,
    username: username,
    usernameLower: username.toLowerCase(),
    passwordHash: passwordHash,
    createdAt: new Date().toISOString(),
    characters: [], // Array of character IDs
    settings: {
      soundEnabled: true,
      musicEnabled: true,
      selectedTitle: null,
    },
    titles: ['Novice'], // Unlocked titles
    quests: {
      allBosses: { active: true, progress: {}, completed: false },
      dragonSlayer: { active: false, completed: false },
    },
  };
  
  await saveUserToDb(user);
  
  // Generate session
  const sessionToken = generateSessionToken();
  sessionsDb[sessionToken] = { userId: user.id, createdAt: Date.now() };
  
  console.log(`📝 New user registered: ${username}`);
  
  res.json({
    success: true,
    sessionToken,
    user: {
      id: user.id,
      username: user.username,
      characters: user.characters,
      settings: user.settings,
      titles: user.titles,
      quests: user.quests,
    },
  });
});

// Login endpoint
app.post('/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  const user = await findUserByUsername(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  
  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  
  // Generate session
  const sessionToken = generateSessionToken();
  sessionsDb[sessionToken] = { userId: user.id, createdAt: Date.now() };
  
  // Load user's characters
  const characters = [];
  for (const charId of user.characters || []) {
    const char = await loadPlayerFromDb(charId);
    if (char) characters.push(char);
  }
  
  console.log(`🔑 User logged in: ${username}`);
  
  res.json({
    success: true,
    sessionToken,
    user: {
      id: user.id,
      username: user.username,
      characters: characters,
      settings: user.settings,
      titles: user.titles,
      quests: user.quests,
    },
  });
});

// Guest play endpoint
app.post('/auth/guest', (req, res) => {
  const guestId = 'guest_' + crypto.randomBytes(8).toString('hex');
  const sessionToken = generateSessionToken();
  
  sessionsDb[sessionToken] = { 
    guestId: guestId, 
    isGuest: true, 
    createdAt: Date.now() 
  };
  
  console.log(`👤 Guest session created: ${guestId}`);
  
  res.json({
    success: true,
    sessionToken,
    isGuest: true,
    guestId: guestId,
  });
});

// Validate session endpoint
app.post('/auth/validate', async (req, res) => {
  const { sessionToken } = req.body;
  
  if (!sessionToken || !sessionsDb[sessionToken]) {
    return res.status(401).json({ valid: false });
  }
  
  const session = sessionsDb[sessionToken];
  
  if (session.isGuest) {
    return res.json({ valid: true, isGuest: true, guestId: session.guestId });
  }
  
  const user = await loadUserFromDb(session.userId);
  if (!user) {
    delete sessionsDb[sessionToken];
    return res.status(401).json({ valid: false });
  }
  
  // Load characters
  const characters = [];
  for (const charId of user.characters || []) {
    const char = await loadPlayerFromDb(charId);
    if (char) characters.push(char);
  }
  
  res.json({
    valid: true,
    user: {
      id: user.id,
      username: user.username,
      characters: characters,
      settings: user.settings,
      titles: user.titles,
      quests: user.quests,
    },
  });
});

// Update user settings
app.post('/auth/settings', async (req, res) => {
  const { sessionToken, settings } = req.body;
  
  if (!sessionToken || !sessionsDb[sessionToken]) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const session = sessionsDb[sessionToken];
  if (session.isGuest) {
    return res.status(400).json({ error: 'Guests cannot save settings' });
  }
  
  const user = await loadUserFromDb(session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  
  user.settings = { ...user.settings, ...settings };
  await saveUserToDb(user);
  
  res.json({ success: true, settings: user.settings });
});

// Update user quests
app.post('/auth/quests', async (req, res) => {
  const { sessionToken, quests } = req.body;
  
  if (!sessionToken || !sessionsDb[sessionToken]) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const session = sessionsDb[sessionToken];
  if (session.isGuest) {
    return res.json({ success: true }); // Silently accept for guests
  }
  
  const user = await loadUserFromDb(session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  
  user.quests = { ...user.quests, ...quests };
  await saveUserToDb(user);
  
  res.json({ success: true, quests: user.quests });
});

// Link character to user account
app.post('/auth/link-character', async (req, res) => {
  const { sessionToken, characterId } = req.body;
  
  if (!sessionToken || !sessionsDb[sessionToken]) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const session = sessionsDb[sessionToken];
  if (session.isGuest) {
    return res.status(400).json({ error: 'Guests cannot link characters' });
  }
  
  const user = await loadUserFromDb(session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  
  if (!user.characters.includes(characterId)) {
    user.characters.push(characterId);
    await saveUserToDb(user);
  }
  
  res.json({ success: true, characters: user.characters });
});

// Delete character from account
app.post('/auth/delete-character', async (req, res) => {
  const { sessionToken, characterId } = req.body;
  
  if (!sessionToken || !sessionsDb[sessionToken]) {
    return res.status(401).json({ error: 'Invalid session' });
  }
  
  const session = sessionsDb[sessionToken];
  if (session.isGuest) {
    return res.status(400).json({ error: 'Guests cannot delete characters' });
  }
  
  const user = await loadUserFromDb(session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  
  // Remove from user's character list
  user.characters = (user.characters || []).filter(id => id !== characterId);
  await saveUserToDb(user);
  
  // Remove from player DB cache
  delete playersDb[characterId];
  
  // Remove from Firebase if enabled
  if (db) {
    try {
      await db.collection('spellBrigade').doc(characterId).delete();
    } catch (err) {
      console.error('Firebase delete error:', err.message);
    }
  }
  
  // Load remaining characters for response
  const characters = [];
  for (const charId of user.characters || []) {
    const char = await loadPlayerFromDb(charId);
    if (char) characters.push(char);
  }
  
  console.log(`🗑️ User ${user.username} deleted character ${characterId}`);
  res.json({ success: true, characters });
});

// Logout endpoint
app.post('/auth/logout', (req, res) => {
  const { sessionToken } = req.body;
  if (sessionToken && sessionsDb[sessionToken]) {
    delete sessionsDb[sessionToken];
  }
  res.json({ success: true });
});

// ===========================================
// HELPER FUNCTIONS
// ===========================================
function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// Helper: Find player by socket ID
function getPlayerBySocket(socketId) {
  for (const p of gameState.players.values()) {
    if (p.socketId === socketId) return p;
  }
  return null;
}

// Helper: Check if socket belongs to admin
function isAdminSocket(socketId) {
  const p = getPlayerBySocket(socketId);
  return p?.isAdmin === true;
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
  
  // Sanctuary center for distance check
  const sanctuaryCenter = { x: 3500, y: 3000 };
  const minDistanceFromSanctuary = 500; // Bosses must be at least 500 units from sanctuary
  
  // Try to find a valid spawn position (max 10 attempts)
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
  
  // Spawn the boss
  const bossId = spawnEnemy(bossType, pos, 0, 1);
  if (bossId) {
    gameState.zoneBosses.set(zoneId, bossId);
    console.log(`Zone boss spawned: ${template.name} in ${zone.name}`);
  }
  
  return bossId;
}

// Handle boss death - set respawn timer and drop spell upgrades
function onBossDeath(enemy, killer) {
  const zoneId = enemy.zone;
  
  // Dragon boss killed - spawn victory portal
  if (enemy.type === 'boss_dragon') {
    console.log('🐉 DRAGON DEFEATED! Spawning victory portal...');
    
    // Emit dragon defeated event with victory portal
    io.emit('dragonDefeated', { 
      x: enemy.x, 
      y: enemy.y,
      killerName: killer?.name || 'Unknown Hero',
    });
    
    // Set dungeon victory portal state - spawn higher up and to the side for visibility
    gameState.dungeonVictoryPortal = {
      x: enemy.x,
      y: enemy.y - 350, // Much higher to avoid skill bar blocking
      active: true,
      createdAt: Date.now(),
    };
    
    // Announce to all
    io.emit('chat', {
      type: 'system',
      text: `🐉🏆 THE INFERNAL DRAGON HAS BEEN SLAIN BY ${(killer?.name || 'A BRAVE HERO').toUpperCase()}! 🏆🐉`,
    });
    
    // Grant huge rewards
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
    
    return; // Skip normal boss respawn logic for dragon
  }
  
  // Custom dungeon boss killed - spawn victory portal
  if (enemy.isCustomBoss && enemy.customDungeonId) {
    const cfgId = enemy.customDungeonId;
    const cfg = gameState.customDungeons.get(cfgId);
    console.log(`⚔️ Custom boss "${enemy.name}" defeated!`);
    
    // Victory portal
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
    
    return; // Skip normal boss respawn logic
  }
  
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
// DUNGEON SPAWNING
// ===========================================
// Dungeon enemies spawn when player enters, based on their depth
// Enemies get stronger the deeper into the dungeon

function spawnDungeonEnemies(player) {
  // Spawn enemies in front of player based on progress
  const dungeonEnemies = ['dungeon_skeleton', 'dungeon_wraith', 'dungeon_golem', 'dungeon_demon'];
  const baseY = player.y + 200;
  
  // Spawn a wave of enemies
  const numEnemies = Math.min(6, 2 + Math.floor(player.y / 1000)); // More enemies deeper in
  const depthMultiplier = 1 + (player.y / 6000) * 2.5; // Up to 3.5x at end
  
  for (let i = 0; i < numEnemies; i++) {
    const type = dungeonEnemies[Math.floor(Math.random() * dungeonEnemies.length)];
    const template = ENEMY_TYPES[type];
    if (!template) continue;
    
    const x = 900 + (i - numEnemies/2) * 150 + Math.random() * 100; // Wider spread for larger dungeon
    const y = baseY + Math.random() * 150;
    
    // Don't spawn past dragon lair (y > 5000)
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
      facing: 'up',
      animFrame: 0,
      slowedUntil: 0,
      frozenUntil: 0,
    };
    
    gameState.enemies.set(enemy.id, enemy);
  }
}

function spawnDragonBoss() {
  const template = ENEMY_TYPES.boss_dragon;
  if (!template) return;
  
  // Check if dragon already exists
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
    x: 900, // Center of wider dungeon
    y: 5500, // Dragon lair center (expanded dungeon)
    zone: 'dungeon',
    facing: 'up',
    animFrame: 0,
    slowedUntil: 0,
    frozenUntil: 0,
    lastAbility: 0,
    phase: 1, // Dragon has multiple phases
    attackPattern: 0,
    attackRange: template.attackRange || 600, // Long attack range
  };
  
  gameState.enemies.set(dragon.id, dragon);
  console.log('🐉 Dragon boss spawned!');
}

// Spawn a custom dungeon boss based on config
function spawnCustomBoss(config, player) {
  const b = config.boss;
  const center = config.layout.bossCenter;
  
  // Check if a custom boss already exists for this dungeon
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
    behavior: 'boss_dragon', // Reuse dragon AI - it's the most complex
    isBoss: true,
    isCustomBoss: true,
    isDungeon: true,
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
    targetPlayerId: targetPlayerId, // Track if targeting a specific player
    createdAt: Date.now(),
    canHitPlayers: canPvP || (spell.canHitPlayers && player.pvpEnabled === true) || false,
    piercing: spell.piercing || false,
    inDungeon: player.inDungeon || false, // Track dungeon state for isolation
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
      const speedMult = player.speedMultiplier || 1;
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
      const classData = CLASSES[player.class];
      const playerInDungeon = player.inDungeon || false;
      
      if (classData) {
        for (const spellId of classData.spells) {
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

    // Health regen in sanctuary (safe zone) + healing fountain bonus
    const playerZone = getZoneAtPosition(player.x, player.y);
    const inSanctuary = playerZone?.id === 'sanctuary';
    
    if (inSanctuary && player.health < player.maxHealth) {
      // Check if player is in healing fountain (center of sanctuary)
      const fountain = BUILDINGS.healing_fountain;
      const distToFountain = distance(player, { x: fountain.x, y: fountain.y });
      const inFountain = distToFountain < fountain.healingRadius;
      
      // Base heal: 20 HP/s, Fountain: 35 HP/s (fountain.healRate + base)
      const healAmount = inFountain ? (fountain.healRate + 20) : 20;
      player.health = Math.min(player.health + healAmount * dt, player.maxHealth);
      player.isHealing = true;
      player.inFountain = inFountain;
    } else {
      player.isHealing = false;
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
                if (player.invincible) continue; // Admin invincibility
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
    if (enemy.type === 'boss_dragon' && nearestPlayer) {
      const distToPlayer = distance(enemy, nearestPlayer);
      const attackRange = enemy.attackRange || 600;
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
      
      // Prevent enemies from getting too close to sanctuary (including buffer)
      if (isTooCloseToSanctuary(enemy.x, enemy.y)) {
        // Push back away from sanctuary
        const pushDir = normalize({ x: enemy.x - SANCTUARY_CENTER.x, y: enemy.y - SANCTUARY_CENTER.y });
        enemy.x = SANCTUARY_CENTER.x + pushDir.x * (SANCTUARY_RADIUS + SANCTUARY_BUFFER + 20);
        enemy.y = SANCTUARY_CENTER.y + pushDir.y * (SANCTUARY_RADIUS + SANCTUARY_BUFFER + 20);
        enemy.wanderAngle = Math.atan2(pushDir.y, pushDir.x); // Face away from sanctuary
      }
    }
    
    if (nearestPlayer && nearestDist <= 400) {
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
        
        // ALL enemies must stay in their zone (polygon check)
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

// Start game loop
setInterval(gameTick, TICK_INTERVAL);

// Initialize zone bosses
initZoneBosses();
console.log('👑 Zone bosses initialized');

// Initialize NPCs
initNpcs();
console.log('🧙 NPCs initialized');

// ===========================================
// SOCKET.IO EVENTS
// ===========================================
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  // Send available classes
  socket.emit('classes', CLASSES);

  socket.on('join', async ({ playerId, playerName, playerClass, selectedSkin, adminKey, sessionToken }) => {
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
      // Shadow Archer requires admin (new character only)
      if (playerClass === 'shadowarcher') {
        if (!isAdmin) {
          validatedClass = 'pyromancer';
          console.log(`${playerName} tried to pick Shadow Archer without admin`);
        } else {
          console.log(`Admin ${playerName} playing as Shadow Archer`);
        }
      }
      
      // Voidlord requires dragon kill (new character only)
      if (playerClass === 'voidlord') {
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
          console.log(`${playerName} tried to pick Void Lord without dragon kill`);
        }
      }
    }
    const classData = CLASSES[validatedClass] || CLASSES.pyromancer;

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
      x: 3000, // Sanctuary center
      y: 2500,
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
    
    // Store guestId on player for ownership tracking
    if (sessionToken && sessionsDb[sessionToken]?.isGuest) {
      player.guestId = sessionsDb[sessionToken].guestId;
    }

    gameState.players.set(id, player);
    
    // Save to DB immediately so character persists even before disconnect
    savePlayerToDb(player);

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
        speedMultiplier: player.speedMultiplier || 1,
        cooldownMultiplier: player.cooldownMultiplier || 1,
        attackSpeedMultiplier: player.attackSpeedMultiplier || 1,
        upgrades: player.upgrades || { health: 0, damage: 0, speed: 0, cooldown: 0, attackSpeed: 0 },
        isAdmin: player.isAdmin || false,
        bossKills: player.bossKills,
        questComplete: player.questComplete,
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
        const ultPlayerInDungeon = player.inDungeon || false;
        
        // Class-specific ultimates
        if (ult.id === 'meteor') {
          // Meteor strike with delay
          const meteorX = tx ?? player.x;
          const meteorY = ty ?? player.y;
          io.emit('meteorWarning', { x: meteorX, y: meteorY, radius: ult.radius, delay: ult.delay });
          
          setTimeout(() => {
            for (const enemy of gameState.enemies.values()) {
              if (enemy.health <= 0) continue;
              // DUNGEON ISOLATION
              if (ultPlayerInDungeon !== (enemy.isDungeon || false)) continue;
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
            // DUNGEON ISOLATION
            if (ultPlayerInDungeon !== (enemy.isDungeon || false)) continue;
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
            
            const dmgPerWave = ult.damage / ult.waves;
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
      const abilityId = abilityMap[player.class]?.[abilitySlot];
      
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
              enemy.health -= spell.damage;
              spawnDamageNumber(enemy.x, enemy.y - 10, spell.damage);
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
          for (const enemy of gameState.enemies.values()) {
            if (enemy.health <= 0) continue;
            // DUNGEON ISOLATION
            if (abilityPlayerInDungeon !== (enemy.isDungeon || false)) continue;
            if (distance(enemy, { x: meteorX, y: meteorY }) < spell.radius) {
              enemy.health -= spell.damage;
              spawnDamageNumber(enemy.x, enemy.y - 20, spell.damage);
              checkEnemyDeath(enemy, player.id);
            }
          }
          io.emit('explosion', { x: meteorX, y: meteorY, radius: spell.radius, color: '#ff4500' });
          spawnParticles(meteorX, meteorY, '#ff4500', 25);
        }, spell.delay);
        
      } else if (abilityId === 'inferno') {
        // Inferno - massive AOE around self
        for (const enemy of gameState.enemies.values()) {
          if (enemy.health <= 0) continue;
          // DUNGEON ISOLATION
          if (abilityPlayerInDungeon !== (enemy.isDungeon || false)) continue;
          if (distance(enemy, player) < spell.radius) {
            enemy.health -= spell.damage;
            spawnDamageNumber(enemy.x, enemy.y - 20, spell.damage);
            checkEnemyDeath(enemy, player.id);
          }
        }
        io.emit('inferno', { x: player.x, y: player.y, radius: spell.radius });
        spawnParticles(player.x, player.y, '#ff0000', 40);
        socket.emit('abilityActivated', { slot: abilitySlot, cooldown: spell.cooldown });
        
      } else if (abilityId === 'frostNova') {
        // Frost Nova - freeze nearby enemies
        for (const enemy of gameState.enemies.values()) {
          if (enemy.health <= 0) continue;
          // DUNGEON ISOLATION
          if (abilityPlayerInDungeon !== (enemy.isDungeon || false)) continue;
          if (distance(enemy, player) < spell.radius) {
            enemy.health -= spell.damage;
            enemy.frozenUntil = now + spell.freezeDuration;
            spawnDamageNumber(enemy.x, enemy.y - 20, spell.damage);
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
        player.x = player.preDungeonX || 3000;
        player.y = player.preDungeonY || 2500;
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
  // AI WIZARD CREATOR (Admin only)
  // ===========================================
  socket.on('generateWizard', async ({ prompt }) => {
    if (!isAdminSocket(socket.id)) {
      socket.emit('wizardGenerateError', { message: 'AI wizard creation is admin-only during testing.' });
      return;
    }
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      socket.emit('wizardGenerateError', { message: 'Please describe your wizard idea (at least 3 characters).' });
      return;
    }

    const player = getPlayerBySocket(socket.id);
    if (!player) return;

    try {
      socket.emit('wizardGenerateStatus', { message: '🧙 AI is crafting your wizard...' });
      const result = await generateWizard(prompt.trim());

      if (result.error) {
        socket.emit('wizardGenerateError', { message: result.error });
        return;
      }

      // Store the custom wizard class + spells
      gameState.customWizards.set(result.classId, {
        classDef: result.classDef,
        spellDefs: result.spellDefs,
        createdBy: player.name,
        createdAt: Date.now(),
      });

      // Cap stored wizards to 20
      if (gameState.customWizards.size > 20) {
        const oldest = [...gameState.customWizards.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
        if (oldest) gameState.customWizards.delete(oldest[0]);
      }

      console.log(`🧙 Custom wizard created: "${result.classDef.name}" by ${player.name}`);

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
  socket.on('selectCustomWizard', ({ classId }) => {
    if (!isAdminSocket(socket.id)) return;
    
    const player = getPlayerBySocket(socket.id);
    if (!player) return;

    const wizard = gameState.customWizards.get(classId);
    if (!wizard) {
      socket.emit('wizardGenerateError', { message: 'Custom wizard not found.' });
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
