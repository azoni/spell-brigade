# Spell Brigade 🧙

A multiplayer wizard survival game with class-based combat, progression systems, and zone-based difficulty.

## Features
- **3 Wizard Classes**: Pyromancer (fire), Cryomancer (ice), Arcanist (arcane)
- **Special Abilities**: Class-specific dash and ultimate abilities
- **6 Zones**: Sanctuary → Meadow → Forest → Volcanic → Frozen → Abyss
- **Progression**: XP, levels, ranks, and unlockable skins
- **Multiplayer**: Real-time Socket.IO gameplay

## Server Setup

### 1. Install Dependencies
```bash
cd server
npm install
```

### 2. Configure Firebase (Required for Persistence)

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project → Project Settings → Service Accounts
3. Click "Generate new private key" → Download JSON
4. Set the JSON as an environment variable:

**For local development:**
```bash
export FIREBASE_SERVICE_ACCOUNT='{"type":"service_account","project_id":"your-project",...}'
```

**For Railway:**
1. Go to your Railway project → Variables
2. Add `FIREBASE_SERVICE_ACCOUNT` with the full JSON contents (the entire JSON, not a file path)

### 3. Run Server
```bash
npm start
```

Server runs on `PORT` environment variable or `3001` by default.

## Firestore Data Structure

```
spellBrigade/{playerId}
├── id: string
├── name: string
├── class: "pyromancer" | "cryomancer" | "arcanist"
├── level: number
├── xp: number
├── totalXp: number
├── kills: number
├── deaths: number
├── selectedSkin: string
├── unlockedSkins: string[]
├── highestZone: string
├── lastSeen: timestamp
└── createdAt: timestamp
```

## React Integration

Connect your React app to the deployed server:

```javascript
import { io } from 'socket.io-client';

const GAME_SERVER = 'https://your-server.railway.app';
const socket = io(GAME_SERVER);

// Join game
socket.emit('join', {
  playerId: localStorage.getItem('spellBrigadeId'),
  playerName: 'WizardName',
  playerClass: 'pyromancer',
  selectedSkin: 'pyromancer_default'
});

// Listen for events
socket.on('joined', (data) => { /* player data, world info */ });
socket.on('state', (state) => { /* game state updates 30fps */ });
socket.on('levelUp', (data) => { /* level, maxHealth */ });
socket.on('died', (data) => { /* killedBy, level, xp */ });
```

## Security

- All game logic runs server-side (authoritative server)
- Progress saved only via Firebase Admin SDK (server-side)
- Clients cannot directly modify Firestore
- Player IDs are server-generated UUIDs

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3001) |
| `FIREBASE_SERVICE_ACCOUNT` | Yes* | Firebase service account JSON |

*Without Firebase, the game still runs but progress isn't persisted between server restarts.

## Deployment (Railway)

1. Connect your GitHub repo to Railway
2. Set `FIREBASE_SERVICE_ACCOUNT` environment variable
3. Deploy!

Railway auto-detects the Node.js app and runs `npm start`.
