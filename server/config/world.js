// ===========================================
// WORLD & ZONES - Polygon-based World Map
// ===========================================

export const WORLD = {
  width: 7000,
  height: 6000,
};

// Helper: Check if point is inside polygon
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

export const SANCTUARY_CENTER = { x: 3500, y: 3000 };
export const SANCTUARY_RADIUS = 600;
export const SANCTUARY_BUFFER = 200;

export const ZONES = {
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
      { x: 1800, y: 0 },
      { x: 1800, y: 6500 },
      { x: 0, y: 6500 },
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



// Portal definitions - All portals in sanctuary hub, teleport to zone centers
export const PORTALS = {
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
export const BUILDINGS = {
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


// Helper: Check if position is too close to sanctuary
export function isTooCloseToSanctuary(x, y) {
  const dx = x - SANCTUARY_CENTER.x;
  const dy = y - SANCTUARY_CENTER.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < (SANCTUARY_RADIUS + SANCTUARY_BUFFER);
}

// Get zone at position
export function getZoneAtPosition(x, y) {
  const priorityOrder = ['sanctuary', 'abyss', 'crystal_caves', 'forest', 'volcanic', 'frozen', 'meadow'];
  
  for (const zoneId of priorityOrder) {
    const zone = ZONES[zoneId];
    if (zone.polygon && pointInPolygon(x, y, zone.polygon)) {
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
  
  return ZONES.meadow;
}

// Get random point inside a zone polygon
export function getRandomPointInZone(zoneId) {
  const zone = ZONES[zoneId];
  if (!zone || !zone.polygon) return { x: 3500, y: 3000 };
  
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of zone.polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  
  for (let i = 0; i < 100; i++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    if (pointInPolygon(x, y, zone.polygon)) {
      if (zoneId !== 'sanctuary' && isTooCloseToSanctuary(x, y)) {
        continue;
      }
      return { x, y };
    }
  }
  
  const centerX = zone.polygon.reduce((sum, p) => sum + p.x, 0) / zone.polygon.length;
  const centerY = zone.polygon.reduce((sum, p) => sum + p.y, 0) / zone.polygon.length;
  return { x: centerX, y: centerY };
}
