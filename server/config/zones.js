// ===========================================
// ZONE CONFIGURATION - Polygon-based World Map
// ===========================================

const WORLD_WIDTH = 6000;
const WORLD_HEIGHT = 5000;

// Zone definitions with polygon boundaries
const ZONES = {
  sanctuary: {
    id: 'sanctuary',
    name: 'Sanctuary',
    color: '#22c55e',
    recommendedLevel: 0,
    description: 'A safe haven where wizards begin their journey',
    // Polygon points defining zone boundary
    polygon: [
      { x: 2800, y: 2300 },
      { x: 3200, y: 2300 },
      { x: 3400, y: 2500 },
      { x: 3200, y: 2700 },
      { x: 2800, y: 2700 },
      { x: 2600, y: 2500 },
    ],
    spawnWeight: 0,
    ambientColor: 'rgba(34, 197, 94, 0.1)',
    music: 'sanctuary',
  },
  
  meadow: {
    id: 'meadow',
    name: 'Peaceful Meadow',
    color: '#84cc16',
    recommendedLevel: 1,
    description: 'Rolling hills with gentle creatures',
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
    spawnWeight: 1,
    ambientColor: 'rgba(132, 204, 22, 0.08)',
    music: 'meadow',
  },
  
  forest: {
    id: 'forest',
    name: 'Dark Forest',
    color: '#166534',
    recommendedLevel: 5,
    description: 'Ancient trees hide dangerous creatures',
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
    spawnWeight: 1.5,
    ambientColor: 'rgba(22, 101, 52, 0.15)',
    music: 'forest',
    hasBoss: true,
    bossType: 'ancient_treant',
  },
  
  volcanic: {
    id: 'volcanic',
    name: 'Volcanic Wastes',
    color: '#dc2626',
    recommendedLevel: 10,
    description: 'Molten rivers flow through scorched earth',
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
    spawnWeight: 2,
    ambientColor: 'rgba(220, 38, 38, 0.12)',
    music: 'volcanic',
    hasBoss: true,
    bossType: 'magma_titan',
  },
  
  frozen: {
    id: 'frozen',
    name: 'Frozen Expanse',
    color: '#0ea5e9',
    recommendedLevel: 15,
    description: 'Eternal winter grips this desolate land',
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
    spawnWeight: 2.5,
    ambientColor: 'rgba(14, 165, 233, 0.12)',
    music: 'frozen',
    hasBoss: true,
    bossType: 'frost_wyrm',
  },
  
  abyss: {
    id: 'abyss',
    name: 'The Abyss',
    color: '#581c87',
    recommendedLevel: 20,
    description: 'Darkness incarnate lurks in the void',
    polygon: [
      { x: 200, y: 200 },
      { x: 1000, y: 100 },
      { x: 500, y: 1000 },
      { x: 200, y: 1500 },
      { x: 100, y: 800 },
    ],
    spawnWeight: 3,
    ambientColor: 'rgba(88, 28, 135, 0.2)',
    music: 'abyss',
    hasBoss: true,
    bossType: 'void_overlord',
  },
  
  crystal_caves: {
    id: 'crystal_caves',
    name: 'Crystal Caves',
    color: '#ec4899',
    recommendedLevel: 8,
    description: 'Glittering crystals illuminate underground passages',
    polygon: [
      { x: 4500, y: 3500 },
      { x: 5500, y: 3200 },
      { x: 5800, y: 4000 },
      { x: 5500, y: 4800 },
      { x: 4800, y: 4500 },
      { x: 4300, y: 4000 },
    ],
    spawnWeight: 1.8,
    ambientColor: 'rgba(236, 72, 153, 0.1)',
    music: 'crystal',
    hasBoss: true,
    bossType: 'crystal_golem',
  },
};

// Portal definitions
const PORTALS = {
  meadow_to_forest: {
    id: 'meadow_to_forest',
    name: 'Forest Gateway',
    from: { x: 1900, y: 2000 },
    to: { x: 1700, y: 2000 },
    fromZone: 'meadow',
    toZone: 'forest',
    color: '#166534',
    icon: '🌲',
    requiredLevel: 3,
  },
  meadow_to_volcanic: {
    id: 'meadow_to_volcanic',
    name: 'Flame Portal',
    from: { x: 4100, y: 2000 },
    to: { x: 4300, y: 2000 },
    fromZone: 'meadow',
    toZone: 'volcanic',
    color: '#dc2626',
    icon: '🔥',
    requiredLevel: 8,
  },
  sanctuary_to_meadow: {
    id: 'sanctuary_to_meadow',
    name: 'Meadow Path',
    from: { x: 3000, y: 2350 },
    to: { x: 3000, y: 2100 },
    fromZone: 'sanctuary',
    toZone: 'meadow',
    color: '#84cc16',
    icon: '🌸',
    requiredLevel: 0,
  },
  forest_to_abyss: {
    id: 'forest_to_abyss',
    name: 'Void Rift',
    from: { x: 600, y: 1200 },
    to: { x: 400, y: 800 },
    fromZone: 'forest',
    toZone: 'abyss',
    color: '#581c87',
    icon: '🌀',
    requiredLevel: 18,
  },
  meadow_to_frozen: {
    id: 'meadow_to_frozen',
    name: 'Frozen Gate',
    from: { x: 3000, y: 3100 },
    to: { x: 3000, y: 3400 },
    fromZone: 'meadow',
    toZone: 'frozen',
    color: '#0ea5e9',
    icon: '❄️',
    requiredLevel: 12,
  },
  volcanic_to_crystal: {
    id: 'volcanic_to_crystal',
    name: 'Crystal Passage',
    from: { x: 5000, y: 3100 },
    to: { x: 5000, y: 3400 },
    fromZone: 'volcanic',
    toZone: 'crystal_caves',
    color: '#ec4899',
    icon: '💎',
    requiredLevel: 6,
  },
};

// Building/Structure definitions
const BUILDINGS = {
  wizard_tower: {
    id: 'wizard_tower',
    name: "Archmage's Tower",
    x: 3000,
    y: 2500,
    zone: 'sanctuary',
    width: 80,
    height: 120,
    type: 'tower',
    color: '#ffd93d',
    interactable: true,
    description: 'The ancient tower where wizards train',
    services: ['respawn', 'heal'],
  },
  forest_ruins: {
    id: 'forest_ruins',
    name: 'Ancient Ruins',
    x: 1200,
    y: 2000,
    zone: 'forest',
    width: 150,
    height: 100,
    type: 'ruins',
    color: '#166534',
    interactable: true,
    hasDungeon: true,
    dungeonBoss: 'ancient_treant',
    description: 'Crumbling ruins hiding dark secrets',
  },
  volcano_fortress: {
    id: 'volcano_fortress',
    name: 'Obsidian Fortress',
    x: 5200,
    y: 2000,
    zone: 'volcanic',
    width: 180,
    height: 140,
    type: 'fortress',
    color: '#7f1d1d',
    interactable: true,
    hasDungeon: true,
    dungeonBoss: 'magma_titan',
    description: 'A fortress forged in molten rock',
  },
  ice_citadel: {
    id: 'ice_citadel',
    name: 'Ice Citadel',
    x: 2500,
    y: 4200,
    zone: 'frozen',
    width: 160,
    height: 130,
    type: 'citadel',
    color: '#0284c7',
    interactable: true,
    hasDungeon: true,
    dungeonBoss: 'frost_wyrm',
    description: 'A palace carved from eternal ice',
  },
  void_shrine: {
    id: 'void_shrine',
    name: 'Void Shrine',
    x: 400,
    y: 600,
    zone: 'abyss',
    width: 100,
    height: 100,
    type: 'shrine',
    color: '#581c87',
    interactable: true,
    hasDungeon: true,
    dungeonBoss: 'void_overlord',
    description: 'A shrine to the darkness itself',
  },
  crystal_sanctum: {
    id: 'crystal_sanctum',
    name: 'Crystal Sanctum',
    x: 5200,
    y: 4000,
    zone: 'crystal_caves',
    width: 120,
    height: 110,
    type: 'sanctum',
    color: '#ec4899',
    interactable: true,
    hasDungeon: true,
    dungeonBoss: 'crystal_golem',
    description: 'A sanctuary of pure crystalline energy',
  },
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

// Get zone at position
function getZoneAtPosition(x, y) {
  // Check specific zones first (smaller/special areas)
  const priorityOrder = ['sanctuary', 'abyss', 'crystal_caves', 'forest', 'volcanic', 'frozen', 'meadow'];
  
  for (const zoneId of priorityOrder) {
    const zone = ZONES[zoneId];
    if (zone.polygon && pointInPolygon(x, y, zone.polygon)) {
      // Check exclude zones
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
  
  // Default to meadow if outside all zones
  return ZONES.meadow;
}

// Get random spawn point in zone
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
  
  // Fallback to center
  const centerX = zone.polygon.reduce((sum, p) => sum + p.x, 0) / zone.polygon.length;
  const centerY = zone.polygon.reduce((sum, p) => sum + p.y, 0) / zone.polygon.length;
  return { x: centerX, y: centerY };
}

module.exports = {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  ZONES,
  PORTALS,
  BUILDINGS,
  pointInPolygon,
  getZoneAtPosition,
  getRandomPointInZone,
};
