import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

// Config
import { PORT, TICK_RATE, MAX_ENEMIES } from './config/constants.js';
import { WORLD } from './config/world.js';
import { CLASSES } from './config/classes.js';

// State
import gameState, { initNpcs } from './state.js';

// Database
import { playersDb, savePlayerToDb } from './db/index.js';

// Auth routes
import { registerAuthRoutes } from './auth/index.js';

// Systems
import { initEnemySystem, initZoneBosses } from './systems/enemies.js';
import { initTickSystem, gameTick } from './systems/tick.js';

// Socket events
import { registerSocketEvents } from './events/index.js';

// ===========================================
// EXPRESS + SOCKET.IO
// ===========================================
const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 1800000,   // 30 minutes
  pingInterval: 60000,    // 1 minute
});

// ===========================================
// HTTP ENDPOINTS
// ===========================================
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

// Register auth routes
registerAuthRoutes(app);

// ===========================================
// INITIALIZE SYSTEMS
// ===========================================
initEnemySystem(io);
initTickSystem(io);

// Start game loop
const TICK_INTERVAL = 1000 / TICK_RATE;
setInterval(gameTick, TICK_INTERVAL);

// Initialize zone bosses
initZoneBosses();
console.log('👑 Zone bosses initialized');

// Initialize NPCs
initNpcs();
console.log('🧙 NPCs initialized');

// Register socket events
registerSocketEvents(io);

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