import { NPCS, COLLECT_QUESTS, ZONES } from './config/index.js';

// ===========================================
// GAME STATE (Singleton)
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
  collectibles: new Map(),   // Zone collectible items (id -> { x, y, zone, item, color, emoji })
  lastTick: Date.now(),
  tickCount: 0,
};

// Initialize NPCs
export function initNpcs() {
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

// Spawn collectible items in zones for collection quests
let collectibleIdCounter = 0;
export function spawnCollectibles() {
  // Clear old collectibles
  gameState.collectibles.clear();
  
  for (const quest of COLLECT_QUESTS) {
    const zone = ZONES[quest.zone];
    if (!zone || !zone.polygon) continue;
    
    // Spawn more items than required so they're findable
    const spawnCount = quest.required + Math.ceil(quest.required * 0.5);
    
    for (let i = 0; i < spawnCount; i++) {
      // Random point inside zone polygon (simple bounding box + rejection)
      let x, y;
      const poly = zone.polygon;
      const minX = Math.min(...poly.map(p => p.x));
      const maxX = Math.max(...poly.map(p => p.x));
      const minY = Math.min(...poly.map(p => p.y));
      const maxY = Math.max(...poly.map(p => p.y));
      
      let attempts = 0;
      do {
        x = minX + Math.random() * (maxX - minX);
        y = minY + Math.random() * (maxY - minY);
        attempts++;
      } while (!pointInPolygon(x, y, poly) && attempts < 50);
      
      if (attempts >= 50) continue;
      
      const id = `collectible_${collectibleIdCounter++}`;
      gameState.collectibles.set(id, {
        id, x, y,
        zone: quest.zone,
        item: quest.item,
        color: quest.itemColor || '#ffd93d',
        emoji: quest.itemEmoji || '✨',
        questId: quest.id,
        pickupRadius: 40,
      });
    }
  }
  console.log(`🌿 Spawned ${gameState.collectibles.size} collectibles across zones`);
}

// Respawn a single collectible in its zone
export function respawnCollectible(zone, item, quest) {
  const zoneData = ZONES[zone];
  if (!zoneData || !zoneData.polygon) return;
  
  const poly = zoneData.polygon;
  const minX = Math.min(...poly.map(p => p.x));
  const maxX = Math.max(...poly.map(p => p.x));
  const minY = Math.min(...poly.map(p => p.y));
  const maxY = Math.max(...poly.map(p => p.y));
  
  let x, y, attempts = 0;
  do {
    x = minX + Math.random() * (maxX - minX);
    y = minY + Math.random() * (maxY - minY);
    attempts++;
  } while (!pointInPolygon(x, y, poly) && attempts < 50);
  
  if (attempts >= 50) return;
  
  const id = `collectible_${collectibleIdCounter++}`;
  gameState.collectibles.set(id, {
    id, x, y, zone, item,
    color: quest.itemColor || '#ffd93d',
    emoji: quest.itemEmoji || '✨',
    questId: quest.id,
    pickupRadius: 40,
  });
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

export default gameState;
