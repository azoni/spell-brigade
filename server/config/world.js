// ===========================================
// WORLD & ZONES - Polygon-based World Map
// ===========================================

export const WORLD = {
  width: 21000,
  height: 18000,
};

export function pointInPolygon(x, y, polygon) {
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

export const SANCTUARY_CENTER = { x: 10500, y: 9000 };
export const SANCTUARY_RADIUS = 1500;
export const SANCTUARY_BUFFER = 100; // Enemies can chase right up to sanctuary edge

export const ZONES = {
  sanctuary: {
    id: 'sanctuary', name: 'Sanctuary',
    description: 'Safe starting area with portal hub and healing fountain.',
    color: '#22c55e', isSafe: true, enemyLevel: 0, enemyTypes: [], recommendedLevel: 0,
    x: SANCTUARY_CENTER.x, y: SANCTUARY_CENTER.y, radius: SANCTUARY_RADIUS,
    polygon: [
      { x: 10500, y: 7200 }, { x: 11900, y: 8100 }, { x: 11900, y: 9900 },
      { x: 10500, y: 10800 }, { x: 9100, y: 9900 }, { x: 9100, y: 8100 },
    ],
  },
  dungeon: {
    id: 'dungeon', name: "Dragon's Gauntlet",
    description: 'A treacherous dungeon. Only the strongest survive.',
    color: '#991b1b', isSafe: false, enemyLevel: 30,
    enemyTypes: ['dungeon_skeleton', 'dungeon_wraith', 'dungeon_golem', 'dungeon_demon'],
    xpMultiplier: 5.0, recommendedLevel: 30, isDungeon: true,
    polygon: [{ x: 0, y: 0 }, { x: 1800, y: 0 }, { x: 1800, y: 6500 }, { x: 0, y: 6500 }],
  },
  meadow: {
    id: 'meadow', name: 'Peaceful Meadow',
    description: 'Easy enemies. Good for beginners.',
    color: '#84cc16', enemyLevel: 1, enemyTypes: ['slime', 'bat', 'bee', 'flower_sprite', 'mushroom', 'meadow_beetle', 'caterpillar', 'spider', 'giant_toad', 'meadow_golem', 'scarecrow', 'giant_hornet', 'bramble_beast'],
    xpMultiplier: 1.0, recommendedLevel: 1,
    polygon: [
      { x: 7500, y: 5500 }, { x: 13500, y: 5500 }, { x: 15000, y: 7000 },
      { x: 15000, y: 11000 }, { x: 13500, y: 12500 }, { x: 7500, y: 12500 },
      { x: 6000, y: 11000 }, { x: 6000, y: 7000 },
    ],
    excludeZones: ['sanctuary'],
  },
  forest: {
    id: 'forest', name: 'Dark Forest',
    description: 'Moderate challenge. Spiders and skeletons lurk.',
    color: '#166534', enemyLevel: 2,
    enemyTypes: ['skeleton', 'spider', 'ghost', 'necromancer', 'wolf', 'treant', 'forest_wisp', 'giant_spider', 'forest_troll', 'bear', 'dire_wolf', 'ancient_ent', 'swamp_horror', 'moss_golem', 'shadow_panther'],
    xpMultiplier: 1.5, recommendedLevel: 5,
    polygon: [
      { x: 500, y: 500 }, { x: 7000, y: 500 }, { x: 7500, y: 5500 },
      { x: 6000, y: 7000 }, { x: 4500, y: 8500 }, { x: 1800, y: 7500 },
      { x: 500, y: 5500 }, { x: 500, y: 2500 },
    ],
  },
  volcanic: {
    id: 'volcanic', name: 'Volcanic Wastes',
    description: 'Fire elementals and golems. High risk, high reward.',
    color: '#dc2626', enemyLevel: 3,
    enemyTypes: ['golem', 'elemental', 'necromancer', 'fire_imp', 'magma_crawler', 'ash_wraith', 'lava_serpent', 'fire_spider', 'magma_giant', 'hell_hound', 'flame_wyrm', 'obsidian_sentinel', 'pyroclast'],
    xpMultiplier: 2.0, recommendedLevel: 10,
    polygon: [
      { x: 14000, y: 500 }, { x: 20500, y: 500 }, { x: 20500, y: 5500 },
      { x: 20000, y: 7500 }, { x: 17000, y: 8500 }, { x: 15000, y: 7000 },
      { x: 13500, y: 5500 }, { x: 13500, y: 2000 },
    ],
  },
  frozen: {
    id: 'frozen', name: 'Frozen Expanse',
    description: 'Ice elementals slow you down. Stay alert.',
    color: '#0ea5e9', enemyLevel: 4,
    enemyTypes: ['iceElemental', 'ghost', 'skeleton', 'frost_wolf', 'yeti', 'ice_sprite', 'ice_spider', 'polar_bear', 'mammoth', 'frost_wraith', 'ice_golem', 'glacier_elemental', 'blizzard_phantom'],
    xpMultiplier: 2.5, recommendedLevel: 15,
    polygon: [
      { x: 5500, y: 12500 }, { x: 15500, y: 12500 }, { x: 16500, y: 14000 },
      { x: 15500, y: 17500 }, { x: 5500, y: 17500 }, { x: 4500, y: 14000 },
    ],
  },
  abyss: {
    id: 'abyss', name: 'The Abyss',
    description: 'Only the strongest survive. Extreme danger.',
    color: '#7c3aed', enemyLevel: 5,
    enemyTypes: ['golem', 'necromancer', 'shadow_wraith', 'void_crawler', 'dark_knight', 'demon', 'abyssal_spider', 'shadow_titan', 'mind_flayer', 'abyssal_worm', 'eldritch_horror', 'doom_stalker'],
    xpMultiplier: 3.0, recommendedLevel: 20, bossChance: 0.02,
    polygon: [
      { x: 200, y: 200 }, { x: 3500, y: 200 }, { x: 4000, y: 1500 },
      { x: 3000, y: 4500 }, { x: 1000, y: 5000 }, { x: 200, y: 3500 },
    ],
  },
  crystal_caves: {
    id: 'crystal_caves', name: 'Crystal Caves',
    description: 'Glittering crystals and dangerous golems.',
    color: '#ec4899', enemyLevel: 3,
    enemyTypes: ['golem', 'ghost', 'spider', 'crystal_bat', 'gem_beetle', 'prism_wisp', 'crystal_golem', 'crystal_drake', 'geode_golem', 'shard_swarm', 'prismatic_hydra', 'crystal_sentinel'],
    xpMultiplier: 1.8, recommendedLevel: 8,
    polygon: [
      { x: 18000, y: 8000 }, { x: 20500, y: 7500 }, { x: 20800, y: 9500 },
      { x: 20500, y: 14000 }, { x: 18500, y: 15500 }, { x: 17000, y: 13000 },
      { x: 17500, y: 10000 },
    ],
  },
};

// Two-way portals
export const PORTALS = {
  portal_meadow: {
    id: 'portal_meadow', name: 'Meadow Portal', icon: '🌸',
    from: { x: 10500, y: 7500 }, to: { x: 10500, y: 6000 },
    returnFrom: { x: 10500, y: 6000 }, returnTo: { x: 10500, y: 7700 },
    fromZone: 'sanctuary', toZone: 'meadow', color: '#84cc16', requiredLevel: 0,
  },
  portal_forest: {
    id: 'portal_forest', name: 'Forest Portal', icon: '🌲',
    from: { x: 9300, y: 8400 }, to: { x: 4000, y: 4000 },
    returnFrom: { x: 4000, y: 4000 }, returnTo: { x: 9500, y: 8500 },
    fromZone: 'sanctuary', toZone: 'forest', color: '#166534', requiredLevel: 5,
  },
  portal_volcanic: {
    id: 'portal_volcanic', name: 'Volcanic Portal', icon: '🔥',
    from: { x: 11700, y: 8400 }, to: { x: 17000, y: 4000 },
    returnFrom: { x: 17000, y: 4000 }, returnTo: { x: 11500, y: 8500 },
    fromZone: 'sanctuary', toZone: 'volcanic', color: '#dc2626', requiredLevel: 10,
  },
  portal_frozen: {
    id: 'portal_frozen', name: 'Frozen Portal', icon: '❄️',
    from: { x: 10500, y: 10500 }, to: { x: 10500, y: 15000 },
    returnFrom: { x: 10500, y: 15000 }, returnTo: { x: 10500, y: 10300 },
    fromZone: 'sanctuary', toZone: 'frozen', color: '#0ea5e9', requiredLevel: 15,
  },
  portal_crystal: {
    id: 'portal_crystal', name: 'Crystal Portal', icon: '💎',
    from: { x: 11700, y: 9600 }, to: { x: 19000, y: 11500 },
    returnFrom: { x: 19000, y: 11500 }, returnTo: { x: 11500, y: 9500 },
    fromZone: 'sanctuary', toZone: 'crystal_caves', color: '#ec4899', requiredLevel: 8,
  },
  portal_abyss: {
    id: 'portal_abyss', name: 'Abyss Portal', icon: '🌀',
    from: { x: 9300, y: 9600 }, to: { x: 1800, y: 2500 },
    returnFrom: { x: 1800, y: 2500 }, returnTo: { x: 9500, y: 9500 },
    fromZone: 'sanctuary', toZone: 'abyss', color: '#7c3aed', requiredLevel: 20,
  },
};

export const BUILDINGS = {
  wizard_tower: {
    id: 'wizard_tower', name: "Archmage's Tower",
    x: 9500, y: 9200, width: 140, height: 200,
    zone: 'sanctuary', color: '#ffd93d', interactable: true,
    services: ['respawn', 'heal'], upgradeType: null,
  },
  forest_ruins: {
    id: 'forest_ruins', name: 'Ancient Ruins',
    x: 3500, y: 4500, width: 240, height: 180,
    zone: 'forest', color: '#78716c', interactable: true, upgradeType: 'health',
  },
  volcano_fortress: {
    id: 'volcano_fortress', name: 'Obsidian Fortress',
    x: 17500, y: 4500, width: 300, height: 240,
    zone: 'volcanic', color: '#7f1d1d', interactable: true, upgradeType: 'damage',
  },
  ice_citadel: {
    id: 'ice_citadel', name: 'Ice Citadel',
    x: 10500, y: 15500, width: 280, height: 220,
    zone: 'frozen', color: '#0284c7', interactable: true, upgradeType: 'cooldown',
  },
  void_shrine: {
    id: 'void_shrine', name: 'Void Shrine',
    x: 1800, y: 2000, width: 200, height: 170,
    zone: 'abyss', color: '#7c3aed', interactable: true, upgradeType: 'speed',
  },
  crystal_sanctum: {
    id: 'crystal_sanctum', name: 'Crystal Sanctum',
    x: 19200, y: 12000, width: 220, height: 190,
    zone: 'crystal_caves', color: '#ec4899', interactable: true, upgradeType: 'attackSpeed',
  },
  healing_fountain: {
    id: 'healing_fountain', name: 'Healing Fountain',
    x: 10500, y: 9000, width: 120, height: 120,
    zone: 'sanctuary', color: '#22c55e', interactable: false,
    isDecoration: true, healingRadius: 250, healRate: 15,
  },
};

export function isTooCloseToSanctuary(x, y) {
  const dx = x - SANCTUARY_CENTER.x;
  const dy = y - SANCTUARY_CENTER.y;
  return Math.sqrt(dx * dx + dy * dy) < (SANCTUARY_RADIUS + SANCTUARY_BUFFER);
}

// ===========================================
// EASTER EGGS & SECRETS
// ===========================================
export const SECRETS = {
  // Hidden shrines - temporary buffs when discovered
  shrine_speed: {
    id: 'shrine_speed', name: 'Windrunner Shrine',
    x: 2200, y: 6200, radius: 60, zone: 'forest',
    type: 'shrine', buff: 'speed', buffAmount: 1.5, buffDuration: 30000,
    message: '💨 The winds favor you! +50% speed for 30s',
    emoji: '🌀', cooldown: 120000, // 2 min cooldown per player
  },
  shrine_damage: {
    id: 'shrine_damage', name: 'Berserker Altar',
    x: 16500, y: 3000, radius: 60, zone: 'volcanic',
    type: 'shrine', buff: 'damage', buffAmount: 1.6, buffDuration: 25000,
    message: '🔥 Blood rage surges through you! +60% damage for 25s',
    emoji: '⚔️', cooldown: 120000,
  },
  shrine_regen: {
    id: 'shrine_regen', name: 'Life Spring',
    x: 12000, y: 15000, radius: 60, zone: 'frozen',
    type: 'shrine', buff: 'regen', buffAmount: 8, buffDuration: 40000,
    message: '💚 Warm energy heals your wounds! Regen for 40s',
    emoji: '🌿', cooldown: 120000,
  },
  shrine_giant: {
    id: 'shrine_giant', name: 'Titan Stone',
    x: 2000, y: 1200, radius: 60, zone: 'abyss',
    type: 'shrine', buff: 'giant', buffAmount: 1.5, buffDuration: 20000,
    message: '🗿 You grow to massive size! +50% HP and damage for 20s',
    emoji: '🗿', cooldown: 180000,
  },
  // Hidden treasure chests - one-time XP rewards
  chest_forest: {
    id: 'chest_forest', name: 'Moss-Covered Chest',
    x: 1200, y: 5800, radius: 50, zone: 'forest',
    type: 'chest', xpReward: 500,
    message: '📦 You found a hidden treasure! +500 XP',
    emoji: '📦',
  },
  chest_volcanic: {
    id: 'chest_volcanic', name: 'Charred Strongbox',
    x: 19500, y: 2000, radius: 50, zone: 'volcanic',
    type: 'chest', xpReward: 1000,
    message: '📦 Ancient treasures inside! +1000 XP',
    emoji: '🔶',
  },
  chest_crystal: {
    id: 'chest_crystal', name: 'Crystal Geode',
    x: 20000, y: 10500, radius: 50, zone: 'crystal_caves',
    type: 'chest', xpReward: 800,
    message: '💎 The geode cracks open! +800 XP',
    emoji: '💎',
  },
  chest_abyss: {
    id: 'chest_abyss', name: 'Void Cache',
    x: 2800, y: 800, radius: 50, zone: 'abyss',
    type: 'chest', xpReward: 2000,
    message: '🌀 Dark power surges into you! +2000 XP',
    emoji: '🌀',
  },
  // Mysterious ancient runes - visit all 3 for a permanent bonus
  rune_alpha: {
    id: 'rune_alpha', name: 'Rune of Power',
    x: 4500, y: 3500, radius: 50, zone: 'forest',
    type: 'rune', runeSet: 'ancient', runeIndex: 0,
    message: '✨ Rune of Power activated! (1/3 Ancient Runes)',
    emoji: '🔮',
  },
  rune_beta: {
    id: 'rune_beta', name: 'Rune of Wisdom',
    x: 18000, y: 5000, radius: 50, zone: 'volcanic',
    type: 'rune', runeSet: 'ancient', runeIndex: 1,
    message: '✨ Rune of Wisdom activated! (2/3 Ancient Runes)',
    emoji: '🔮',
  },
  rune_gamma: {
    id: 'rune_gamma', name: 'Rune of Eternity',
    x: 8000, y: 16000, radius: 50, zone: 'frozen',
    type: 'rune', runeSet: 'ancient', runeIndex: 2,
    message: '✨ Rune of Eternity activated! (3/3 Ancient Runes)',
    emoji: '🔮',
  },
  // Fun secrets
  fishing_spot: {
    id: 'fishing_spot', name: 'Peaceful Pond',
    x: 11500, y: 7200, radius: 80, zone: 'meadow',
    type: 'fishing',
    message: '🎣 You cast a line... something bites!',
    emoji: '🎣', cooldown: 30000,
  },
  fishing_frozen: {
    id: 'fishing_frozen', name: 'Ice Hole',
    x: 10000, y: 14500, radius: 70, zone: 'frozen',
    type: 'fishing',
    message: '🎣 You fish through the ice...',
    emoji: '🐟', cooldown: 25000,
  },
  campfire_stories: {
    id: 'campfire_stories', name: 'Wanderer\'s Campfire',
    x: 6500, y: 4500, radius: 60, zone: 'forest',
    type: 'campfire',
    message: '🔥 The warmth restores you fully!',
    emoji: '🏕️', cooldown: 60000,
  },
  campfire_volcanic: {
    id: 'campfire_volcanic', name: 'Ember Pit',
    x: 17500, y: 4200, radius: 60, zone: 'volcanic',
    type: 'campfire',
    message: '🔥 The volcanic warmth empowers you!',
    emoji: '🔥', cooldown: 60000,
  },
  sanctuary_campfire: {
    id: 'sanctuary_campfire', name: 'Sanctuary Hearth',
    x: 10200, y: 3800, radius: 80, zone: 'sanctuary',
    type: 'campfire',
    message: '🔥 The hearth warms your spirit! Full heal + damage boost',
    emoji: '🔥', cooldown: 60000,
  },
  
  // === WISHING WELLS - throw in XP for a random buff ===
  wishing_well_meadow: {
    id: 'wishing_well_meadow', name: 'Wishing Well',
    x: 9200, y: 8200, radius: 50, zone: 'meadow',
    type: 'wishing_well', xpCost: 50,
    message: '🪙 The well shimmers...',
    emoji: '⛲', cooldown: 45000,
  },
  wishing_well_crystal: {
    id: 'wishing_well_crystal', name: 'Crystal Fountain',
    x: 19000, y: 9000, radius: 50, zone: 'crystal_caves',
    type: 'wishing_well', xpCost: 200,
    message: '💎 The crystal waters swirl...',
    emoji: '💎', cooldown: 45000,
  },
  
  // === MUSHROOM CIRCLES - teleport to a random zone ===
  mushroom_circle: {
    id: 'mushroom_circle', name: 'Fairy Ring',
    x: 3500, y: 7000, radius: 40, zone: 'forest',
    type: 'mushroom_circle',
    message: '🍄 The fairy ring glows... you feel yourself shifting!',
    emoji: '🍄', cooldown: 60000,
  },
  
  // === GRAVESTONES - lore messages with rare XP rewards ===
  grave_meadow: {
    id: 'grave_meadow', name: 'Weathered Gravestone',
    x: 8800, y: 6800, radius: 40, zone: 'meadow',
    type: 'gravestone',
    messages: [
      '"Here lies Bob the Brave. He cast fireball indoors."',
      '"R.I.P. Sir Leeroy. He charged in alone. We warned him."',
      '"In memory of the First Wizard. She accidentally invented slimes."',
      '"Do not read this gravestone. Too late."',
    ],
    emoji: '🪦', cooldown: 90000,
  },
  grave_abyss: {
    id: 'grave_abyss', name: 'Abyssal Tombstone',
    x: 1500, y: 2200, radius: 40, zone: 'abyss',
    type: 'gravestone',
    messages: [
      '"The Void stares back. It blinked first."',
      '"Here sleeps the Architect. The dungeons were his final masterpiece."',
      '"All paths lead here. Some lead back."',
      '"The last boss was once a player. Don\'t think about it."',
    ],
    emoji: '💀', cooldown: 90000,
  },
  
  // === AURORA VIEWING SPOT - passive XP gain while standing still ===
  aurora_spot: {
    id: 'aurora_spot', name: 'Northern Lights',
    x: 7000, y: 17000, radius: 80, zone: 'frozen',
    type: 'aurora',
    message: '🌌 The aurora fills you with wonder... +XP while you watch!',
    emoji: '🌌', cooldown: 5000, // short cooldown — gives small XP ticks
    xpPerTick: 15,
  },
  
  // === DANCE FLOOR - in sanctuary, cosmetic fun ===
  dance_floor: {
    id: 'dance_floor', name: 'The Groove Zone',
    x: 10500, y: 10200, radius: 50, zone: 'sanctuary',
    type: 'dance_floor',
    message: '💃 You feel the rhythm! Dance mode activated!',
    emoji: '🕺', cooldown: 10000,
  },
  
  // === MYSTERIOUS OBELISK - gives random class insight/tip ===
  obelisk: {
    id: 'obelisk', name: 'Ancient Obelisk',
    x: 15000, y: 8000, radius: 50, zone: 'crystal_caves',
    type: 'obelisk',
    messages: [
      '💡 "The Cryomancer\'s frost step can freeze an entire pack. Time it wisely."',
      '💡 "Bosses enter new phases at 60% and 30% HP. Watch for the shield!"',
      '💡 "Hidden shrines grant powerful buffs. Explore every corner."',
      '💡 "The Void Lord heals from all damage dealt. Aggression is survival."',
      '💡 "Golden enemies drop 3x XP. The golden glow is unmistakable."',
      '💡 "Three ancient runes are scattered across the realm. Find all three..."',
      '💡 "The fishing pond hides more than fish. Patience is rewarded."',
      '💡 "Custom wizards with buff abilities can support entire teams."',
    ],
    emoji: '🗿', cooldown: 30000,
  },
  
  // === HOT SPRING - slow heal + cleanse debuffs ===
  hot_spring: {
    id: 'hot_spring', name: 'Volcanic Hot Spring',
    x: 18500, y: 5500, radius: 70, zone: 'volcanic',
    type: 'hot_spring',
    message: '♨️ The hot spring soothes your wounds!',
    emoji: '♨️', cooldown: 45000,
    healPercent: 0.6, buffDuration: 20000,
  },
  
  // === ECHO CAVE - doubles next ability damage ===
  echo_cave: {
    id: 'echo_cave', name: 'Echo Cave',
    x: 21000, y: 11000, radius: 45, zone: 'crystal_caves',
    type: 'echo_cave',
    message: '🔊 Your magic echoes through the crystals! Next ability deals 2x damage!',
    emoji: '🔊', cooldown: 120000,
  },
  
  // === SHADOW MIRROR - spawns a friendly shadow clone ===
  shadow_mirror: {
    id: 'shadow_mirror', name: 'Shadow Mirror',
    x: 3000, y: 3000, radius: 45, zone: 'abyss',
    type: 'shadow_mirror',
    message: '🪞 Your reflection steps out of the mirror!',
    emoji: '🪞', cooldown: 180000,
  },
};

export function getZoneAtPosition(x, y) {
  const priorityOrder = ['sanctuary', 'abyss', 'crystal_caves', 'forest', 'volcanic', 'frozen', 'meadow'];
  for (const zoneId of priorityOrder) {
    const zone = ZONES[zoneId];
    if (zone.polygon && pointInPolygon(x, y, zone.polygon)) {
      if (zone.excludeZones) {
        let inExcluded = false;
        for (const excludeId of zone.excludeZones) {
          const ez = ZONES[excludeId];
          if (ez.polygon && pointInPolygon(x, y, ez.polygon)) { inExcluded = true; break; }
        }
        if (inExcluded) continue;
      }
      return zone;
    }
  }
  return ZONES.meadow;
}

export function getRandomPointInZone(zoneId) {
  const zone = ZONES[zoneId];
  if (!zone || !zone.polygon) return { x: 10500, y: 9000 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of zone.polygon) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  // Enemies spawn far from sanctuary so players can't snipe from safety
  const SPAWN_SANCTUARY_BUFFER = 800;
  for (let i = 0; i < 100; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    if (pointInPolygon(x, y, zone.polygon)) {
      if (zoneId !== 'sanctuary') {
        const dx = x - SANCTUARY_CENTER.x;
        const dy = y - SANCTUARY_CENTER.y;
        if (Math.sqrt(dx * dx + dy * dy) < (SANCTUARY_RADIUS + SPAWN_SANCTUARY_BUFFER)) continue;
      }
      return { x, y };
    }
  }
  // Fallback: zone centroid (always deep in zone)
  const cx = zone.polygon.reduce((s, p) => s + p.x, 0) / zone.polygon.length;
  const cy = zone.polygon.reduce((s, p) => s + p.y, 0) / zone.polygon.length;
  return { x: cx, y: cy };
}
