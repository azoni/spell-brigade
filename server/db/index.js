import admin from 'firebase-admin';
import { SKINS, RANKS } from '../config/index.js';

// ===========================================
// FIREBASE SETUP
// ===========================================
let db = null;
export const FIREBASE_ENABLED = !!process.env.FIREBASE_SERVICE_ACCOUNT;

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

export { db };

// ===========================================
// PLAYER DATABASE
// ===========================================
export let playersDb = {};

export async function savePlayerToDb(player) {
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
  
  // Save custom wizard data so it survives server restarts
  if (player.isCustomWizard && player.customClassId) {
    data.isCustomWizard = true;
    data.customClassId = player.customClassId;
    data.customWizardData = player.customWizardData || null;
  }
  
  playersDb[player.id] = data;
  
  if (db) {
    try {
      await db.collection('spellBrigade').doc(player.id).set(data, { merge: true });
    } catch (err) {
      console.error('Firebase save error:', err.message);
    }
  }
}

export async function loadPlayerFromDb(id) {
  if (playersDb[id]) return playersDb[id];
  
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

export function loadPlayerFromDbSync(id) {
  return playersDb[id] || null;
}

export function loadPlayerByName(name) {
  return Object.values(playersDb).find(p => p.name?.toLowerCase() === name.toLowerCase()) || null;
}

export function getPlayerCharacters(name) {
  return Object.values(playersDb).filter(p => p.name?.toLowerCase().startsWith(name.toLowerCase().split('#')[0]));
}

// ===========================================
// USER DATABASE
// ===========================================
export const usersDb = {};
export const sessionsDb = {};

export async function saveUserToDb(user) {
  if (db) {
    try {
      await db.collection('spellBrigadeUsers').doc(user.id).set(user, { merge: true });
    } catch (err) {
      console.error('Firebase user save error:', err.message);
    }
  }
  usersDb[user.id] = user;
}

export async function loadUserFromDb(id) {
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

export async function findUserByUsername(username) {
  const lowerUsername = username.toLowerCase();
  const cached = Object.values(usersDb).find(u => u.username?.toLowerCase() === lowerUsername);
  if (cached) return cached;
  
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

// ===========================================
// UTILITY FUNCTIONS
// ===========================================
export function getUnlockedSkins(playerClass, totalXp) {
  return Object.values(SKINS)
    .filter(s => s.class === playerClass && s.requiredXp <= totalXp)
    .map(s => s.id);
}

export function getPlayerRank(totalXp) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (totalXp >= r.xp) rank = r;
  }
  return rank;
}
