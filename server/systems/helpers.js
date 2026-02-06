import { v4 as uuidv4 } from 'uuid';
import gameState from '../state.js';

// ===========================================
// MATH / UTILITY HELPERS
// ===========================================
export function distance(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function normalize(vec) {
  const len = Math.sqrt(vec.x ** 2 + vec.y ** 2);
  if (len === 0) return { x: 0, y: 0 };
  return { x: vec.x / len, y: vec.y / len };
}

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

export function xpForLevel(level) {
  return Math.floor(100 * Math.pow(1.15, level - 1));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function pointToLineDistance(point, lineStart, lineEnd) {
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
// PLAYER LOOKUP HELPERS
// ===========================================
export function getPlayerBySocket(socketId) {
  for (const p of gameState.players.values()) {
    if (p.socketId === socketId) return p;
  }
  return null;
}

// io is passed in since it's not available at module load time
export function isAdminSocket(io, socketId) {
  // Check gameState players first
  const p = getPlayerBySocket(socketId);
  if (p?.isAdmin) return true;
  // Check socket-level admin flag (set before join)
  const sock = io.sockets.sockets.get(socketId);
  return sock?.isAdmin === true;
}

// ===========================================
// XP ORBS
// ===========================================
export function spawnXpOrb(x, y, amount) {
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
export function spawnDamageNumber(x, y, amount, isCrit = false) {
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
export function spawnParticles(x, y, color, count = 5) {
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
