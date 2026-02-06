import { NPCS } from './config/index.js';

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

export default gameState;
