import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  usersDb, sessionsDb,
  saveUserToDb, loadUserFromDb, findUserByUsername,
  loadPlayerFromDb, playersDb, db
} from '../db/index.js';

// Generate session token
function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Register all auth routes on the express app
export function registerAuthRoutes(app) {
  // Signup endpoint
  app.post('/auth/signup', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
    }
    
    const existing = await findUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Username already taken' });
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    
    const userId = 'user_' + crypto.randomBytes(8).toString('hex');
    const user = {
      id: userId,
      username: username,
      usernameLower: username.toLowerCase(),
      passwordHash: passwordHash,
      createdAt: new Date().toISOString(),
      characters: [],
      settings: {
        soundEnabled: true,
        musicEnabled: true,
        selectedTitle: null,
      },
      titles: ['Novice'],
      quests: {
        allBosses: { active: true, progress: {}, completed: false },
        dragonSlayer: { active: false, completed: false },
      },
    };
    
    await saveUserToDb(user);
    
    const sessionToken = generateSessionToken();
    sessionsDb[sessionToken] = { userId: user.id, createdAt: Date.now() };
    
    console.log(`📝 New user registered: ${username}`);
    
    res.json({
      success: true,
      sessionToken,
      user: {
        id: user.id,
        username: user.username,
        characters: user.characters,
        settings: user.settings,
        titles: user.titles,
        quests: user.quests,
      },
    });
  });

  // Login endpoint
  app.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = await findUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    const sessionToken = generateSessionToken();
    sessionsDb[sessionToken] = { userId: user.id, createdAt: Date.now() };
    
    const characters = [];
    for (const charId of user.characters || []) {
      const char = await loadPlayerFromDb(charId);
      if (char) characters.push(char);
    }
    
    console.log(`🔑 User logged in: ${username}`);
    
    res.json({
      success: true,
      sessionToken,
      user: {
        id: user.id,
        username: user.username,
        characters: characters,
        settings: user.settings,
        titles: user.titles,
        quests: user.quests,
      },
    });
  });

  // Guest play endpoint
  app.post('/auth/guest', (req, res) => {
    const guestId = 'guest_' + crypto.randomBytes(8).toString('hex');
    const sessionToken = generateSessionToken();
    
    sessionsDb[sessionToken] = { 
      guestId: guestId, 
      isGuest: true, 
      createdAt: Date.now() 
    };
    
    console.log(`👤 Guest session created: ${guestId}`);
    
    res.json({
      success: true,
      sessionToken,
      isGuest: true,
      guestId: guestId,
    });
  });

  // Validate session endpoint
  app.post('/auth/validate', async (req, res) => {
    const { sessionToken } = req.body;
    
    if (!sessionToken || !sessionsDb[sessionToken]) {
      return res.status(401).json({ valid: false });
    }
    
    const session = sessionsDb[sessionToken];
    
    if (session.isGuest) {
      return res.json({ valid: true, isGuest: true, guestId: session.guestId });
    }
    
    const user = await loadUserFromDb(session.userId);
    if (!user) {
      delete sessionsDb[sessionToken];
      return res.status(401).json({ valid: false });
    }
    
    const characters = [];
    for (const charId of user.characters || []) {
      const char = await loadPlayerFromDb(charId);
      if (char) characters.push(char);
    }
    
    res.json({
      valid: true,
      user: {
        id: user.id,
        username: user.username,
        characters: characters,
        settings: user.settings,
        titles: user.titles,
        quests: user.quests,
      },
    });
  });

  // Update user settings
  app.post('/auth/settings', async (req, res) => {
    const { sessionToken, settings } = req.body;
    
    if (!sessionToken || !sessionsDb[sessionToken]) {
      return res.status(401).json({ error: 'Invalid session' });
    }
    
    const session = sessionsDb[sessionToken];
    if (session.isGuest) {
      return res.status(400).json({ error: 'Guests cannot save settings' });
    }
    
    const user = await loadUserFromDb(session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    user.settings = { ...user.settings, ...settings };
    await saveUserToDb(user);
    
    res.json({ success: true, settings: user.settings });
  });

  // Update user quests
  app.post('/auth/quests', async (req, res) => {
    const { sessionToken, quests } = req.body;
    
    if (!sessionToken || !sessionsDb[sessionToken]) {
      return res.status(401).json({ error: 'Invalid session' });
    }
    
    const session = sessionsDb[sessionToken];
    if (session.isGuest) {
      return res.json({ success: true });
    }
    
    const user = await loadUserFromDb(session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    user.quests = { ...user.quests, ...quests };
    await saveUserToDb(user);
    
    res.json({ success: true, quests: user.quests });
  });

  // Link character to user account
  app.post('/auth/link-character', async (req, res) => {
    const { sessionToken, characterId } = req.body;
    
    if (!sessionToken || !sessionsDb[sessionToken]) {
      return res.status(401).json({ error: 'Invalid session' });
    }
    
    const session = sessionsDb[sessionToken];
    if (session.isGuest) {
      return res.status(400).json({ error: 'Guests cannot link characters' });
    }
    
    const user = await loadUserFromDb(session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    if (!user.characters.includes(characterId)) {
      user.characters.push(characterId);
      await saveUserToDb(user);
    }
    
    res.json({ success: true, characters: user.characters });
  });

  // Delete character from account
  app.post('/auth/delete-character', async (req, res) => {
    const { sessionToken, characterId } = req.body;
    
    if (!sessionToken || !sessionsDb[sessionToken]) {
      return res.status(401).json({ error: 'Invalid session' });
    }
    
    const session = sessionsDb[sessionToken];
    if (session.isGuest) {
      return res.status(400).json({ error: 'Guests cannot delete characters' });
    }
    
    const user = await loadUserFromDb(session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    user.characters = (user.characters || []).filter(id => id !== characterId);
    await saveUserToDb(user);
    
    delete playersDb[characterId];
    
    if (db) {
      try {
        await db.collection('spellBrigade').doc(characterId).delete();
      } catch (err) {
        console.error('Firebase delete error:', err.message);
      }
    }
    
    const characters = [];
    for (const charId of user.characters || []) {
      const char = await loadPlayerFromDb(charId);
      if (char) characters.push(char);
    }
    
    console.log(`🗑️ User ${user.username} deleted character ${characterId}`);
    res.json({ success: true, characters });
  });

  // Logout endpoint
  app.post('/auth/logout', (req, res) => {
    const { sessionToken } = req.body;
    if (sessionToken && sessionsDb[sessionToken]) {
      delete sessionsDb[sessionToken];
    }
    res.json({ success: true });
  });
}
