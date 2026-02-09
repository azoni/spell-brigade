// ===========================================
// GLOBAL CONSTANTS
// ===========================================
export const PORT = process.env.PORT || 3001;
export const TICK_RATE = 20;
export const TICK_INTERVAL = 1000 / TICK_RATE;
export const MAX_ENEMIES = 16000;
export const VIEW_DISTANCE = 1200;

export const XP_ORB = {
  pickupRadius: 50,
  magnetRadius: 150,
  magnetSpeed: 300,
  lifetime: 30000,
};

export const BOSS_RESPAWN_TIME = 30 * 1000;
