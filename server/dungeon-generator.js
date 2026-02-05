import { v4 as uuidv4 } from 'uuid';
import { llmGenerate, isLLMEnabled } from './openrouter.js';

// ===========================================
// DUNGEON GENERATOR - Procedural + LLM hybrid
// ===========================================

const DUNGEON_LLM_PROMPT = `You are a dungeon designer for a 2D multiplayer wizard game called Spell Brigade.
Given a user's dungeon idea, generate a creative dungeon configuration as JSON.

Available room visual themes: "infernal", "haunted", "bones", "rocky", "stone", "dragon", "corridor"
Available enemy types: "dungeon_skeleton", "dungeon_wraith", "dungeon_golem", "dungeon_demon"
Available mini-bosses: "dungeon_minotaur", "dungeon_lich"
Difficulty levels: "easy" (3 rooms), "normal" (4 rooms), "hard" (5 rooms), "nightmare" (6 rooms)

Respond with ONLY this JSON structure:
{
  "name": "Creative dungeon name (max 40 chars)",
  "description": "Atmospheric 1-sentence description",
  "theme": "fire|ice|undead|shadow|nature|chaos",
  "difficulty": "easy|normal|hard|nightmare",
  "rooms": [
    {
      "name": "Creative room name",
      "theme": "one of the visual themes above",
      "enemies": ["enemy_type_ids"],
      "hasMiniBoss": false
    }
  ],
  "boss": {
    "name": "Creative boss name",
    "title": "Epic boss title",
    "color": "#hex color matching theme"
  }
}

Rules:
- Room count MUST match difficulty (easy=3, normal=4, hard=5, nightmare=6)
- Each room should have 3-5 enemies from the available pool
- At most 2 rooms can have mini-bosses (set hasMiniBoss: true and include a mini-boss in enemies)
- Be creative with names but keep them fantasy-appropriate
- Boss color should match the dungeon theme
- If the user's prompt is vague, infer a cool theme`;


const THEMES = {
  fire: {
    keywords: ['fire', 'flame', 'lava', 'magma', 'inferno', 'burn', 'volcanic', 'molten', 'ember', 'blaze', 'hell'],
    roomThemes: ['infernal', 'dragon', 'infernal', 'rocky', 'dragon', 'infernal'],
    bossColor: '#dc2626', accent: '#f97316',
    bossNames: ['Inferno Lord', 'Magma Titan', 'Flame Emperor', 'Ember Drake', 'Cinder Wyrm'],
    bossTitles: ['Lord of Flames', 'The Molten Terror', 'Bringer of Ash', 'The Burning One'],
    roomNames: ['Scorching Antechamber', 'Lava Flow Chamber', 'Ember Halls', 'Magma Core', 'Infernal Pit', 'Flame Sanctum'],
  },
  ice: {
    keywords: ['ice', 'frost', 'frozen', 'cold', 'snow', 'blizzard', 'glacier', 'winter', 'crystal', 'tundra'],
    roomThemes: ['stone', 'haunted', 'stone', 'haunted', 'stone', 'haunted'],
    bossColor: '#0ea5e9', accent: '#67e8f9',
    bossNames: ['Frost King', 'Glacial Titan', 'Blizzard Wyrm', 'Ice Sovereign', 'The Frozen One'],
    bossTitles: ['Ruler of the Frost', 'The Eternal Winter', 'Bringer of Ice', 'The Cold Death'],
    roomNames: ['Frozen Vestibule', 'Crystal Cavern', 'Blizzard Corridor', 'Ice Throne Room', 'Glacial Abyss', 'Permafrost Chamber'],
  },
  undead: {
    keywords: ['undead', 'skeleton', 'zombie', 'necro', 'death', 'bone', 'grave', 'crypt', 'lich', 'tomb', 'corpse'],
    roomThemes: ['bones', 'haunted', 'bones', 'haunted', 'bones', 'haunted'],
    bossColor: '#65a30d', accent: '#a3e635',
    bossNames: ['Lich Overlord', 'Death Knight', 'Bone Colossus', 'The Necroseer', 'Tomb Emperor'],
    bossTitles: ['Master of the Dead', 'The Undying', 'Bringer of Ruin', 'Lord of Bones'],
    roomNames: ['Burial Vestibule', 'Crypt of Whispers', 'Bone Gauntlet', 'Hall of the Damned', 'Necrotic Sanctum', 'Tomb of Echoes'],
  },
  shadow: {
    keywords: ['shadow', 'dark', 'void', 'night', 'black', 'abyss', 'nightmare', 'phantom', 'shade', 'gloom'],
    roomThemes: ['haunted', 'haunted', 'bones', 'haunted', 'haunted', 'bones'],
    bossColor: '#7c3aed', accent: '#a78bfa',
    bossNames: ['Shadow Sovereign', 'Void Incarnate', 'Nightmare King', 'Abyss Walker', 'Phantom Lord'],
    bossTitles: ['Lord of Shadows', 'The Void Made Flesh', 'Bringer of Nightmares', 'The Unseen'],
    roomNames: ['Darkened Entry', 'Shadow Labyrinth', 'Void Chamber', 'Nightmare Corridor', 'Abyss Gate', 'Phantom Sanctum'],
  },
  nature: {
    keywords: ['nature', 'forest', 'vine', 'tree', 'plant', 'poison', 'swamp', 'jungle', 'moss', 'fungus', 'spore'],
    roomThemes: ['rocky', 'stone', 'rocky', 'bones', 'rocky', 'stone'],
    bossColor: '#16a34a', accent: '#4ade80',
    bossNames: ['Ancient Treant', 'Fungal Overlord', 'Vine Titan', 'Swamp Horror', 'The Overgrowth'],
    bossTitles: ['Guardian of the Wilds', 'The Living Forest', 'Root of All Evil', "Nature's Wrath"],
    roomNames: ['Overgrown Entrance', 'Tangled Thicket', 'Spore Chamber', 'Vine Maze', 'Fungal Depths', 'Root Sanctum'],
  },
  chaos: {
    keywords: ['chaos', 'random', 'insane', 'warp', 'unstable', 'rift', 'twisted', 'mad', 'crazy', 'wild'],
    roomThemes: ['infernal', 'haunted', 'bones', 'rocky', 'infernal', 'haunted'],
    bossColor: '#e11d48', accent: '#fb7185',
    bossNames: ['Chaos Incarnate', 'The Mad One', 'Rift Behemoth', 'Entropy Sovereign', 'Warp Fiend'],
    bossTitles: ['Bringer of Chaos', 'The Unraveler', 'Lord of Entropy', 'The Twisted'],
    roomNames: ['Warped Entrance', 'Shifting Halls', 'Chaos Nexus', 'Rift Chamber', 'Unstable Core', 'Madness Sanctum'],
  },
};

const DIFFICULTIES = {
  easy:      { label: 'Easy',      rooms: 3, hpMul: 0.6, dmgMul: 0.6, bossHp: 15000, bossDmg: 80,  bossSpd: 42, miniBosses: 0, xpMul: 0.8 },
  normal:    { label: 'Normal',    rooms: 4, hpMul: 1.0, dmgMul: 1.0, bossHp: 25000, bossDmg: 120, bossSpd: 50, miniBosses: 1, xpMul: 1.0 },
  hard:      { label: 'Hard',      rooms: 5, hpMul: 1.5, dmgMul: 1.5, bossHp: 40000, bossDmg: 160, bossSpd: 55, miniBosses: 2, xpMul: 1.5 },
  nightmare: { label: 'Nightmare', rooms: 6, hpMul: 2.5, dmgMul: 2.0, bossHp: 60000, bossDmg: 200, bossSpd: 62, miniBosses: 2, xpMul: 2.5 },
};

const ENEMY_POOL = ['dungeon_skeleton', 'dungeon_wraith', 'dungeon_golem', 'dungeon_demon'];
const MINI_BOSSES = ['dungeon_minotaur', 'dungeon_lich'];
const DUNGEON_WIDTH = 1800;
const createCooldowns = new Map();
const CREATE_COOLDOWN_MS = 30000;

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function detectTheme(prompt) {
  const lower = prompt.toLowerCase();
  let best = null, bestScore = 0;
  for (const [name, cfg] of Object.entries(THEMES)) {
    const score = cfg.keywords.filter(k => lower.includes(k)).length;
    if (score > bestScore) { bestScore = score; best = name; }
  }
  return best || 'shadow';
}

function detectDifficulty(prompt) {
  const lower = prompt.toLowerCase();
  if (/nightmare|impossible|insane|extreme|brutal/i.test(lower)) return 'nightmare';
  if (/hard|difficult|tough|challenging|intense/i.test(lower)) return 'hard';
  if (/easy|simple|beginner|starter|gentle/i.test(lower)) return 'easy';
  return 'normal';
}

function generateName(prompt, theme) {
  const patterns = [/called?\s+["']?([^"',.!?]{3,35})["']?/i, /named?\s+["']?([^"',.!?]{3,35})["']?/i, /dungeon\s+of\s+([^,.!?]{3,30})/i];
  for (const pat of patterns) {
    const m = prompt.match(pat);
    if (m) return m[1].trim().slice(0, 40);
  }
  const adj = pick(['Ancient', 'Forsaken', 'Cursed', 'Forgotten', 'Dreadful', 'Eternal', 'Burning', 'Frozen', 'Twisted', 'Shattered']);
  const noun = pick(['Depths', 'Catacombs', 'Labyrinth', 'Crypt', 'Citadel', 'Dungeon', 'Tomb', 'Sanctum', 'Spire']);
  return `The ${adj} ${noun}`;
}

// ==================== PUBLIC API ====================

export function generateDungeon(prompt, creatorName, playerId) {
  const lastCreate = createCooldowns.get(playerId) || 0;
  const now = Date.now();
  if (now - lastCreate < CREATE_COOLDOWN_MS) {
    const waitSec = Math.ceil((CREATE_COOLDOWN_MS - (now - lastCreate)) / 1000);
    throw new Error(`Please wait ${waitSec}s before creating another dungeon.`);
  }
  createCooldowns.set(playerId, now);

  const theme = detectTheme(prompt);
  const difficulty = detectDifficulty(prompt);
  const diffCfg = DIFFICULTIES[difficulty];
  const themeCfg = THEMES[theme];
  const name = generateName(prompt, theme);

  // Generate rooms
  const rooms = [];
  let miniBossesPlaced = 0;
  for (let i = 0; i < diffCfg.rooms; i++) {
    const enemies = [];
    const isMiniBossRoom = miniBossesPlaced < diffCfg.miniBosses &&
      i >= Math.floor(diffCfg.rooms / 3) && i <= diffCfg.rooms - 2;
    if (isMiniBossRoom) { enemies.push(pick(MINI_BOSSES)); miniBossesPlaced++; }
    const count = 3 + Math.floor(Math.random() * 3);
    while (enemies.length < count) enemies.push(pick(ENEMY_POOL));
    rooms.push({
      name: themeCfg.roomNames[i % themeCfg.roomNames.length],
      theme: themeCfg.roomThemes[i % themeCfg.roomThemes.length],
      enemies,
    });
  }

  const boss = {
    name: pick(themeCfg.bossNames),
    title: pick(themeCfg.bossTitles),
    health: diffCfg.bossHp, damage: diffCfg.bossDmg, speed: diffCfg.bossSpd,
    radius: 100 + Math.floor(Math.random() * 30),
    color: themeCfg.bossColor,
    attackCooldown: 1800 - (difficulty === 'nightmare' ? 400 : difficulty === 'hard' ? 200 : 0),
    attackRange: 600 + Math.floor(Math.random() * 150),
    xp: Math.round(15000 * diffCfg.xpMul),
    killReward: Math.round(20000 * diffCfg.xpMul),
  };

  const layout = computeLayout(rooms, boss);

  return {
    id: uuidv4(), name,
    description: prompt.slice(0, 150),
    creator: creatorName, createdAt: Date.now(),
    plays: 0, clears: 0,
    theme, difficulty,
    difficultyMultiplier: diffCfg.hpMul,
    rooms, boss, layout,
  };
}

function computeLayout(rooms, boss) {
  const allRooms = [];
  let y = 0;
  const w = DUNGEON_WIDTH;

  allRooms.push({ name: 'Entrance', theme: 'stone', isEntrance: true, yStart: 0, yEnd: 500, minX: 400, maxX: w - 400 });
  y = 500;

  for (let i = 0; i < rooms.length; i++) {
    allRooms.push({ name: 'Corridor', theme: 'corridor', yStart: y, yEnd: y + 200, minX: 550, maxX: w - 550 });
    y += 200;
    allRooms.push({ ...rooms[i], roomIndex: i + 1, yStart: y, yEnd: y + 800, minX: 200, maxX: w - 200 });
    y += 800;
  }

  allRooms.push({ name: 'Corridor', theme: 'corridor', yStart: y, yEnd: y + 200, minX: 550, maxX: w - 550 });
  y += 200;

  const bossRoomStart = y;
  allRooms.push({ name: `${boss.name}'s Lair`, theme: 'dragon', isBossRoom: true, yStart: y, yEnd: y + 1000, minX: 50, maxX: w - 50 });
  y += 1000;

  return { allRooms, totalHeight: y, width: w, bossCenter: { x: w / 2, y: bossRoomStart + 500 }, bossRoomStart, exitPortalPos: { x: w / 2, y: 200 } };
}

export function getDungeonBounds(config, y) {
  for (const room of config.layout.allRooms) {
    if (y >= room.yStart && y < room.yEnd) return { minX: room.minX, maxX: room.maxX };
  }
  return { minX: 50, maxX: config.layout.width - 50 };
}

export function getDungeonRoom(config, y) {
  for (const room of config.layout.allRooms) {
    if (room.roomIndex && y >= room.yStart && y < room.yEnd) return room.roomIndex;
  }
  const bossRoom = config.layout.allRooms.find(r => r.isBossRoom);
  if (bossRoom && y >= bossRoom.yStart) return -1; // boss room
  return 0;
}

export function getRoomEnemies(config, roomIndex) {
  if (roomIndex < 1 || roomIndex > config.rooms.length) return [];
  return config.rooms[roomIndex - 1].enemies || [];
}

export function getRoomCenterY(config, roomIndex) {
  const room = config.layout.allRooms.find(r => r.roomIndex === roomIndex);
  return room ? (room.yStart + room.yEnd) / 2 : 1000;
}

export function sanitizeDungeonForClient(config) {
  return {
    id: config.id, name: config.name, description: config.description,
    creator: config.creator, difficulty: config.difficulty, theme: config.theme,
    plays: config.plays, clears: config.clears || 0, createdAt: config.createdAt,
    boss: { name: config.boss.name, title: config.boss.title, color: config.boss.color, health: config.boss.health },
    roomCount: config.rooms.length, layout: config.layout,
  };
}

// ===========================================
// LLM-POWERED DUNGEON GENERATION
// ===========================================

const VALID_THEMES_SET = new Set(['fire', 'ice', 'undead', 'shadow', 'nature', 'chaos']);
const VALID_DIFFICULTIES_SET = new Set(['easy', 'normal', 'hard', 'nightmare']);
const VALID_ENEMIES_SET = new Set(['dungeon_skeleton', 'dungeon_wraith', 'dungeon_golem', 'dungeon_demon', 'dungeon_minotaur', 'dungeon_lich']);
const VALID_ROOM_THEMES_SET = new Set(['infernal', 'haunted', 'bones', 'rocky', 'stone', 'dragon', 'corridor']);

function clampDungeonLLMOutput(llmData) {
  // Validate and clamp LLM output to safe values
  const theme = VALID_THEMES_SET.has(llmData.theme) ? llmData.theme : 'shadow';
  const difficulty = VALID_DIFFICULTIES_SET.has(llmData.difficulty) ? llmData.difficulty : 'normal';
  const diffCfg = DIFFICULTIES[difficulty];
  const themeCfg = THEMES[theme];

  const name = (typeof llmData.name === 'string' ? llmData.name : 'The Unknown Depths').slice(0, 40);
  const description = (typeof llmData.description === 'string' ? llmData.description : '').slice(0, 150);

  // Clamp rooms to match difficulty
  const targetRoomCount = diffCfg.rooms;
  let rooms = Array.isArray(llmData.rooms) ? llmData.rooms : [];
  
  // Pad or trim to correct count
  while (rooms.length < targetRoomCount) {
    rooms.push({ name: themeCfg.roomNames[rooms.length % themeCfg.roomNames.length], theme: 'stone', enemies: ['dungeon_skeleton', 'dungeon_wraith', 'dungeon_golem'] });
  }
  rooms = rooms.slice(0, targetRoomCount);

  // Validate each room
  let miniBossCount = 0;
  rooms = rooms.map((r, i) => {
    const roomTheme = VALID_ROOM_THEMES_SET.has(r.theme) ? r.theme : themeCfg.roomThemes[i % themeCfg.roomThemes.length];
    let enemies = Array.isArray(r.enemies) ? r.enemies.filter(e => VALID_ENEMIES_SET.has(e)) : [];
    if (enemies.length < 3) {
      while (enemies.length < 3) enemies.push(pick(ENEMY_POOL));
    }
    if (enemies.length > 6) enemies = enemies.slice(0, 6);
    
    // Handle mini-boss
    if (r.hasMiniBoss && miniBossCount < 2) {
      if (!enemies.some(e => e.startsWith('dungeon_mino') || e.startsWith('dungeon_lich'))) {
        enemies[0] = pick(MINI_BOSSES);
      }
      miniBossCount++;
    }

    return {
      name: (typeof r.name === 'string' ? r.name : themeCfg.roomNames[i % themeCfg.roomNames.length]).slice(0, 40),
      theme: roomTheme,
      enemies,
    };
  });

  // Validate boss
  const bossData = llmData.boss || {};
  const bossColor = /^#[0-9a-fA-F]{6}$/.test(bossData.color) ? bossData.color : themeCfg.bossColor;
  const boss = {
    name: (typeof bossData.name === 'string' ? bossData.name : pick(themeCfg.bossNames)).slice(0, 40),
    title: (typeof bossData.title === 'string' ? bossData.title : pick(themeCfg.bossTitles)).slice(0, 40),
    health: diffCfg.bossHp,
    damage: diffCfg.bossDmg,
    speed: diffCfg.bossSpd,
    radius: 100 + Math.floor(Math.random() * 30),
    color: bossColor,
    attackCooldown: 1800 - (difficulty === 'nightmare' ? 400 : difficulty === 'hard' ? 200 : 0),
    attackRange: 600 + Math.floor(Math.random() * 150),
    xp: Math.round(15000 * diffCfg.xpMul),
    killReward: Math.round(20000 * diffCfg.xpMul),
  };

  return { name, description, theme, difficulty, rooms, boss, difficultyMultiplier: diffCfg.hpMul };
}

/**
 * Generate a dungeon using LLM. Falls back to procedural on failure.
 * Returns the full dungeon config ready for use.
 */
export async function generateDungeonLLM(prompt, creatorName, playerId) {
  const lastCreate = createCooldowns.get(playerId) || 0;
  const now = Date.now();
  if (now - lastCreate < CREATE_COOLDOWN_MS) {
    const waitSec = Math.ceil((CREATE_COOLDOWN_MS - (now - lastCreate)) / 1000);
    throw new Error(`Please wait ${waitSec}s before creating another dungeon.`);
  }
  createCooldowns.set(playerId, now);

  let dungeonData = null;

  if (isLLMEnabled()) {
    console.log(`🤖 Generating dungeon via LLM for: "${prompt}"`);
    dungeonData = await llmGenerate(DUNGEON_LLM_PROMPT, prompt, 800);
  }

  if (dungeonData) {
    // LLM succeeded - clamp & build
    const clamped = clampDungeonLLMOutput(dungeonData);
    const layout = computeLayout(clamped.rooms, clamped.boss);

    return {
      id: uuidv4(), name: clamped.name,
      description: clamped.description || prompt.slice(0, 150),
      creator: creatorName, createdAt: Date.now(),
      plays: 0, clears: 0,
      theme: clamped.theme, difficulty: clamped.difficulty,
      difficultyMultiplier: clamped.difficultyMultiplier,
      rooms: clamped.rooms, boss: clamped.boss, layout,
      aiGenerated: true,
    };
  } else {
    // Fallback to procedural
    console.log(`⚙️ LLM unavailable, using procedural generation for: "${prompt}"`);
    // Reset cooldown since we set it above, and generateDungeon checks it too
    createCooldowns.delete(playerId);
    return generateDungeon(prompt, creatorName, playerId);
  }
}
