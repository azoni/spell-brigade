import React, { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

// ===========================================
// CONFIG - Update this to your server URL
// ===========================================
const SERVER_URL = process.env.REACT_APP_GAME_SERVER || 'http://localhost:3001';

// ===========================================
// STYLES
// ===========================================
const styles = {
  container: {
    position: 'relative',
    width: '100%',
    height: '100vh',
    background: '#0f0f1a',
    overflow: 'hidden',
    fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
  },
  canvas: {
    display: 'block',
    width: '100%',
    height: '100%',
  },
  screen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(15, 15, 26, 0.95)',
    zIndex: 100,
    transition: 'opacity 0.3s',
  },
  hidden: {
    opacity: 0,
    pointerEvents: 'none',
  },
  title: {
    fontSize: '3.5rem',
    marginBottom: '0.5rem',
    textShadow: '0 0 20px rgba(255, 217, 61, 0.5)',
    color: '#fff',
  },
  subtitle: {
    color: '#888',
    marginBottom: '2rem',
    fontSize: '1.1rem',
  },
  charCreation: {
    background: 'rgba(20, 20, 35, 0.98)',
    padding: '2rem',
    borderRadius: '16px',
    maxWidth: '600px',
    width: '90%',
  },
  charTitle: {
    textAlign: 'center',
    marginBottom: '1.5rem',
    color: '#ffd93d',
    fontSize: '1.5rem',
  },
  nameInput: {
    width: '100%',
    padding: '14px 20px',
    fontSize: '1.2rem',
    borderRadius: '8px',
    border: '2px solid #333',
    background: '#1a1a2e',
    color: '#fff',
    textAlign: 'center',
    marginBottom: '1.5rem',
    outline: 'none',
  },
  classSelect: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  classCard: (selected, color) => ({
    background: '#1a1a2e',
    border: `3px solid ${selected ? color : '#333'}`,
    borderRadius: '12px',
    padding: '1rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'center',
    boxShadow: selected ? `0 0 20px ${color}` : 'none',
  }),
  classIcon: (color) => ({
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    margin: '0 auto 0.5rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.8rem',
    background: `${color}40`,
  }),
  playBtn: {
    width: '100%',
    padding: '16px',
    fontSize: '1.3rem',
    fontWeight: 'bold',
    border: 'none',
    borderRadius: '10px',
    background: 'linear-gradient(135deg, #6c5ce7, #a855f7)',
    color: '#fff',
    cursor: 'pointer',
  },
  hud: {
    position: 'absolute',
    top: '20px',
    left: '20px',
    zIndex: 50,
  },
  hudPanel: {
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(10px)',
    padding: '15px 20px',
    borderRadius: '12px',
    minWidth: '160px',
    color: '#fff',
  },
  minimap: {
    position: 'absolute',
    bottom: '20px',
    right: '20px',
    width: '150px',
    height: '150px',
    background: 'rgba(0, 0, 0, 0.7)',
    borderRadius: '10px',
    border: '2px solid #333',
    zIndex: 50,
  },
  levelUp: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'rgba(0, 0, 0, 0.9)',
    padding: '30px 50px',
    borderRadius: '16px',
    border: '3px solid #ffd93d',
    textAlign: 'center',
    zIndex: 60,
    color: '#fff',
  },
  connectionStatus: (connected) => ({
    position: 'absolute',
    top: '20px',
    right: '20px',
    padding: '8px 16px',
    borderRadius: '20px',
    fontSize: '0.85rem',
    fontWeight: 'bold',
    zIndex: 50,
    background: connected ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
    color: connected ? '#22c55e' : '#ef4444',
  }),
};

const COLORS = {
  grass1: '#2d5a27',
  grass2: '#234d1f',
  safeZone: 'rgba(100, 200, 100, 0.15)',
  safeZoneBorder: 'rgba(100, 200, 100, 0.5)',
  enemy: {
    slime: '#4ade80',
    bat: '#a855f7',
    skeleton: '#e5e5e5',
    ghost: '#94a3b8',
    golem: '#78716c',
  },
  classes: {
    pyromancer: '#ff6b35',
    cryomancer: '#4ecdc4',
    arcanist: '#9b5ce7',
  },
};

const CLASS_ICONS = {
  pyromancer: '🔥',
  cryomancer: '❄️',
  arcanist: '💜',
};

// ===========================================
// MAIN COMPONENT
// ===========================================
export default function SpellBrigade() {
  const canvasRef = useRef(null);
  const minimapRef = useRef(null);
  const socketRef = useRef(null);
  const gameStateRef = useRef({ players: [], enemies: [], projectiles: [], xpOrbs: [], particles: [], damageNumbers: [], world: { width: 3000, height: 3000 }, safeZone: { x: 1500, y: 1500, radius: 200 } });
  const playerIdRef = useRef(null);
  const playerDataRef = useRef(null);
  const inputRef = useRef({ up: false, down: false, left: false, right: false });
  const cameraRef = useRef({ x: 0, y: 0 });
  const screenShakeRef = useRef({ x: 0, y: 0, intensity: 0 });

  const [connected, setConnected] = useState(false);
  const [screen, setScreen] = useState('title'); // 'title', 'game', 'dead'
  const [playerName, setPlayerName] = useState('');
  const [selectedClass, setSelectedClass] = useState('pyromancer');
  const [classes, setClasses] = useState({});
  const [playerInfo, setPlayerInfo] = useState(null);
  const [levelUp, setLevelUp] = useState(null);
  const [deathInfo, setDeathInfo] = useState(null);

  // ===========================================
  // SOCKET CONNECTION
  // ===========================================
  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      console.log('Connected to server');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from server');
    });

    socket.on('classes', (data) => {
      setClasses(data);
    });

    socket.on('joined', (data) => {
      playerIdRef.current = data.playerId;
      playerDataRef.current = data.player;
      localStorage.setItem('spellBrigadePlayerId', data.playerId);
      setPlayerInfo(data.player);
      setScreen('game');
      setClasses(data.classes || {});
    });

    socket.on('gameState', (state) => {
      gameStateRef.current = state;
      const me = state.players.find(p => p.id === playerIdRef.current);
      if (me) {
        playerDataRef.current = { ...playerDataRef.current, ...me };
        setPlayerInfo(prev => ({ ...prev, ...me }));
      }
    });

    socket.on('levelUp', (data) => {
      setLevelUp(data.level);
      setTimeout(() => setLevelUp(null), 2000);
    });

    socket.on('died', (data) => {
      setDeathInfo(data);
      setScreen('dead');
    });

    socket.on('damaged', (data) => {
      screenShakeRef.current.intensity = Math.min(15, data.amount / 2);
    });

    socket.on('respawned', () => {
      setScreen('game');
    });

    // Default classes
    setTimeout(() => {
      if (Object.keys(classes).length === 0) {
        setClasses({
          pyromancer: { id: 'pyromancer', name: 'Pyromancer', color: '#ff6b35', description: 'Master of fire magic' },
          cryomancer: { id: 'cryomancer', name: 'Cryomancer', color: '#4ecdc4', description: 'Ice wizard with slows' },
          arcanist: { id: 'arcanist', name: 'Arcanist', color: '#9b5ce7', description: 'Arcane power & AOE' },
        });
      }
    }, 500);

    return () => socket.disconnect();
  }, []);

  // ===========================================
  // INPUT HANDLING
  // ===========================================
  useEffect(() => {
    const keyMap = {
      'KeyW': 'up', 'ArrowUp': 'up',
      'KeyS': 'down', 'ArrowDown': 'down',
      'KeyA': 'left', 'ArrowLeft': 'left',
      'KeyD': 'right', 'ArrowRight': 'right',
    };

    const handleKeyDown = (e) => {
      const dir = keyMap[e.code];
      if (dir && !inputRef.current[dir]) {
        inputRef.current[dir] = true;
        socketRef.current?.emit('input', inputRef.current);
      }
    };

    const handleKeyUp = (e) => {
      const dir = keyMap[e.code];
      if (dir && inputRef.current[dir]) {
        inputRef.current[dir] = false;
        socketRef.current?.emit('input', inputRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // ===========================================
  // CANVAS RESIZE
  // ===========================================
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
      if (minimapRef.current) {
        minimapRef.current.width = 150;
        minimapRef.current.height = 150;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ===========================================
  // RENDERING
  // ===========================================
  useEffect(() => {
    const canvas = canvasRef.current;
    const minimap = minimapRef.current;
    if (!canvas || !minimap) return;

    const ctx = canvas.getContext('2d');
    const mmCtx = minimap.getContext('2d');
    let animId;

    const lerp = (a, b, t) => a + (b - a) * t;

    const render = () => {
      const { width, height } = canvas;
      const state = gameStateRef.current;
      const { world, safeZone } = state;
      const playerId = playerIdRef.current;

      // Camera
      const me = state.players.find(p => p.id === playerId);
      if (me) {
        const targetX = me.x - width / 2;
        const targetY = me.y - height / 2;
        cameraRef.current.x = lerp(cameraRef.current.x, targetX, 0.1);
        cameraRef.current.y = lerp(cameraRef.current.y, targetY, 0.1);
        cameraRef.current.x = Math.max(0, Math.min(world.width - width, cameraRef.current.x));
        cameraRef.current.y = Math.max(0, Math.min(world.height - height, cameraRef.current.y));
      }
      
      // Screen shake
      const shake = screenShakeRef.current;
      if (shake.intensity > 0) {
        shake.x = (Math.random() - 0.5) * shake.intensity * 2;
        shake.y = (Math.random() - 0.5) * shake.intensity * 2;
        shake.intensity *= 0.9;
        if (shake.intensity < 0.5) shake.intensity = 0;
      } else {
        shake.x = 0;
        shake.y = 0;
      }
      
      const cam = {
        x: cameraRef.current.x + shake.x,
        y: cameraRef.current.y + shake.y,
      };

      // Clear
      ctx.fillStyle = '#0f0f1a';
      ctx.fillRect(0, 0, width, height);

      // Grass tiles
      const tileSize = 64;
      const startX = Math.floor(cam.x / tileSize) * tileSize;
      const startY = Math.floor(cam.y / tileSize) * tileSize;
      for (let x = startX; x < cam.x + width + tileSize; x += tileSize) {
        for (let y = startY; y < cam.y + height + tileSize; y += tileSize) {
          const sx = x - cam.x;
          const sy = y - cam.y;
          ctx.fillStyle = ((x / tileSize) + (y / tileSize)) % 2 === 0 ? COLORS.grass1 : COLORS.grass2;
          ctx.fillRect(sx, sy, tileSize, tileSize);
        }
      }

      // Safe zone
      if (safeZone) {
        const szX = safeZone.x - cam.x;
        const szY = safeZone.y - cam.y;
        ctx.beginPath();
        ctx.arc(szX, szY, safeZone.radius, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.safeZone;
        ctx.fill();
        ctx.strokeStyle = COLORS.safeZoneBorder;
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 10]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // World border
      ctx.strokeStyle = '#ff000066';
      ctx.lineWidth = 4;
      ctx.strokeRect(-cam.x, -cam.y, world.width, world.height);

      // Enemies
      for (const enemy of state.enemies) {
        const sx = enemy.x - cam.x;
        const sy = enemy.y - cam.y;
        if (sx < -50 || sx > width + 50 || sy < -50 || sy > height + 50) continue;

        const bounce = Math.sin(enemy.animFrame * Math.PI / 2) * 2;
        const color = COLORS.enemy[enemy.type] || '#ff0000';

        // Shadow
        ctx.beginPath();
        ctx.ellipse(sx, sy + 8, 12, 6, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();

        // Body
        ctx.beginPath();
        ctx.arc(sx, sy - bounce, 14, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Health bar
        if (enemy.health < enemy.maxHealth) {
          ctx.fillStyle = '#300';
          ctx.fillRect(sx - 14, sy - 28, 28, 4);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(sx - 14, sy - 28, 28 * (enemy.health / enemy.maxHealth), 4);
        }

        // Slow indicator
        if (enemy.isSlowed) {
          ctx.beginPath();
          ctx.arc(sx, sy - bounce, 18, 0, Math.PI * 2);
          ctx.strokeStyle = '#4ecdc4';
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Projectiles
      for (const proj of state.projectiles) {
        const px = proj.x - cam.x;
        const py = proj.y - cam.y;
        if (px < -50 || px > width + 50 || py < -50 || py > height + 50) continue;

        // Glow
        ctx.beginPath();
        ctx.arc(px, py, proj.radius + 8, 0, Math.PI * 2);
        const grad = ctx.createRadialGradient(px, py, 0, px, py, proj.radius + 8);
        grad.addColorStop(0, proj.color + '80');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(px, py, proj.radius, 0, Math.PI * 2);
        ctx.fillStyle = proj.color;
        ctx.fill();
      }

      // Players
      for (const player of state.players) {
        const px = player.x - cam.x;
        const py = player.y - cam.y;
        if (px < -50 || px > width + 50 || py < -50 || py > height + 50) continue;

        const isMe = player.id === playerId;
        const classColor = COLORS.classes[player.class] || '#ffd93d';
        const bob = player.state === 'walk' ? Math.sin(player.animFrame * Math.PI) * 2 : 0;

        // Shadow
        ctx.beginPath();
        ctx.ellipse(px, py + 14, 14, 7, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();

        // Robe
        ctx.beginPath();
        ctx.moveTo(px - 12, py + 12);
        ctx.lineTo(px - 8, py - 6 - bob);
        ctx.lineTo(px + 8, py - 6 - bob);
        ctx.lineTo(px + 12, py + 12);
        ctx.closePath();
        ctx.fillStyle = classColor;
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Head
        ctx.beginPath();
        ctx.arc(px, py - 12 - bob, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#ffeaa7';
        ctx.fill();
        ctx.stroke();

        // Hat
        ctx.beginPath();
        ctx.moveTo(px, py - 38 - bob);
        ctx.lineTo(px - 14, py - 16 - bob);
        ctx.lineTo(px + 14, py - 16 - bob);
        ctx.closePath();
        ctx.fillStyle = classColor;
        ctx.fill();
        ctx.stroke();

        // Name
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(player.name, px, py + 28);
        ctx.fillStyle = '#ffd93d';
        ctx.font = '10px sans-serif';
        ctx.fillText(`Lv.${player.level}`, px, py + 40);

        // Health bar
        if (!isMe || player.health < player.maxHealth) {
          ctx.fillStyle = '#300';
          ctx.fillRect(px - 18, py - 46 - bob, 36, 5);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(px - 18, py - 46 - bob, 36 * (player.health / player.maxHealth), 5);
        }

        // Highlight
        if (isMe) {
          ctx.beginPath();
          ctx.arc(px, py, 24, 0, Math.PI * 2);
          ctx.strokeStyle = classColor + '60';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      // XP Orbs
      if (state.xpOrbs) {
        for (const orb of state.xpOrbs) {
          const ox = orb.x - cam.x;
          const oy = orb.y - cam.y;
          if (ox < -20 || ox > width + 20 || oy < -20 || oy > height + 20) continue;
          
          const pulse = Math.sin(Date.now() / 150 + orb.x) * 0.3 + 0.7;
          const radius = 6 + pulse * 2;
          
          ctx.beginPath();
          ctx.arc(ox, oy, radius + 4, 0, Math.PI * 2);
          const glowGrad = ctx.createRadialGradient(ox, oy, 0, ox, oy, radius + 4);
          glowGrad.addColorStop(0, `rgba(59, 130, 246, ${0.6 * pulse})`);
          glowGrad.addColorStop(1, 'transparent');
          ctx.fillStyle = glowGrad;
          ctx.fill();
          
          ctx.beginPath();
          ctx.arc(ox, oy, radius, 0, Math.PI * 2);
          ctx.fillStyle = '#3b82f6';
          ctx.fill();
        }
      }

      // Particles
      if (state.particles) {
        for (const particle of state.particles) {
          const ppx = particle.x - cam.x;
          const ppy = particle.y - cam.y;
          if (ppx < -20 || ppx > width + 20 || ppy < -20 || ppy > height + 20) continue;
          
          ctx.beginPath();
          ctx.arc(ppx, ppy, particle.radius * particle.alpha, 0, Math.PI * 2);
          ctx.fillStyle = particle.color + Math.floor(particle.alpha * 255).toString(16).padStart(2, '0');
          ctx.fill();
        }
      }

      // Damage Numbers
      if (state.damageNumbers) {
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        for (const dmg of state.damageNumbers) {
          const dx = dmg.x - cam.x;
          const dy = dmg.y - cam.y;
          if (dx < -50 || dx > width + 50 || dy < -50 || dy > height + 50) continue;
          
          ctx.fillStyle = `rgba(0, 0, 0, ${dmg.alpha * 0.5})`;
          ctx.fillText(dmg.amount, dx + 1, dy + 1);
          ctx.fillStyle = dmg.isCrit ? `rgba(255, 215, 0, ${dmg.alpha})` : `rgba(255, 255, 255, ${dmg.alpha})`;
          ctx.fillText(dmg.amount, dx, dy);
        }
      }

      // Minimap
      const mmW = minimap.width;
      const mmH = minimap.height;
      const scale = mmW / world.width;

      mmCtx.fillStyle = '#1a1a2e';
      mmCtx.fillRect(0, 0, mmW, mmH);

      if (safeZone) {
        mmCtx.beginPath();
        mmCtx.arc(safeZone.x * scale, safeZone.y * scale, safeZone.radius * scale, 0, Math.PI * 2);
        mmCtx.fillStyle = 'rgba(100, 200, 100, 0.3)';
        mmCtx.fill();
      }

      mmCtx.fillStyle = '#ef4444';
      for (const enemy of state.enemies) {
        mmCtx.beginPath();
        mmCtx.arc(enemy.x * scale, enemy.y * scale, 2, 0, Math.PI * 2);
        mmCtx.fill();
      }

      for (const player of state.players) {
        mmCtx.fillStyle = player.id === playerId ? '#ffd93d' : '#3b82f6';
        mmCtx.beginPath();
        mmCtx.arc(player.x * scale, player.y * scale, player.id === playerId ? 4 : 3, 0, Math.PI * 2);
        mmCtx.fill();
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, []);

  // ===========================================
  // HANDLERS
  // ===========================================
  const handleJoin = () => {
    const name = playerName.trim() || `Wizard${Math.floor(Math.random() * 9000) + 1000}`;
    const savedId = localStorage.getItem('spellBrigadePlayerId');
    socketRef.current?.emit('join', {
      playerId: savedId,
      playerName: name,
      playerClass: selectedClass,
    });
  };

  const handleRespawn = () => {
    socketRef.current?.emit('respawn');
  };

  // ===========================================
  // RENDER
  // ===========================================
  return (
    <div style={styles.container}>
      <canvas ref={canvasRef} style={styles.canvas} />

      {/* Title Screen */}
      <div style={{ ...styles.screen, ...(screen !== 'title' ? styles.hidden : {}) }}>
        <h1 style={styles.title}>✨ Spell Brigade ✨</h1>
        <p style={styles.subtitle}>A persistent multiplayer survivors game</p>

        <div style={styles.charCreation}>
          <h2 style={styles.charTitle}>Create Your Wizard</h2>

          <input
            type="text"
            placeholder="Enter your wizard name..."
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={16}
            style={styles.nameInput}
          />

          <div style={styles.classSelect}>
            {Object.entries(classes).map(([id, data]) => (
              <div
                key={id}
                style={styles.classCard(selectedClass === id, data.color)}
                onClick={() => setSelectedClass(id)}
              >
                <div style={styles.classIcon(data.color)}>{CLASS_ICONS[id] || '✨'}</div>
                <h3 style={{ color: data.color, margin: '0 0 4px' }}>{data.name}</h3>
                <p style={{ fontSize: '0.75rem', color: '#888', margin: 0 }}>{data.description}</p>
              </div>
            ))}
          </div>

          <button style={styles.playBtn} onClick={handleJoin}>
            Enter the Arena
          </button>
        </div>

        <p style={{ marginTop: '1.5rem', color: '#666', fontSize: '0.9rem' }}>
          WASD or Arrow Keys to move • Spells auto-cast
        </p>
      </div>

      {/* Death Screen */}
      <div style={{ ...styles.screen, ...(screen !== 'dead' ? styles.hidden : {}) }}>
        <h2 style={{ color: '#ef4444', fontSize: '3rem', marginBottom: '1rem' }}>💀 You Died!</h2>
        <p style={{ color: '#888', marginBottom: '2rem' }}>
          Killed by: {deathInfo?.killedBy || 'Unknown'} • Level {deathInfo?.level || 1}
        </p>
        <button
          style={{ ...styles.playBtn, width: 'auto', padding: '14px 40px' }}
          onClick={handleRespawn}
        >
          Respawn
        </button>
      </div>

      {/* HUD */}
      {screen === 'game' && playerInfo && (
        <div style={styles.hud}>
          <div style={styles.hudPanel}>
            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '4px' }}>
              {playerInfo.name}
            </div>
            <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: '8px' }}>
              {classes[playerInfo.class]?.name || playerInfo.class} • Level {playerInfo.level}
            </div>

            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '3px' }}>
                <span>HP</span>
                <span>{Math.floor(playerInfo.health)}/{playerInfo.maxHealth}</span>
              </div>
              <div style={{ height: '10px', background: '#1a1a2e', borderRadius: '5px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${(playerInfo.health / playerInfo.maxHealth) * 100}%`,
                  background: 'linear-gradient(90deg, #ef4444, #dc2626)',
                  transition: 'width 0.2s',
                }} />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '3px' }}>
                <span>XP</span>
                <span>{playerInfo.xp}/{playerInfo.xpToLevel || 100}</span>
              </div>
              <div style={{ height: '8px', background: '#1a1a2e', borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${(playerInfo.xp / (playerInfo.xpToLevel || 100)) * 100}%`,
                  background: 'linear-gradient(90deg, #3b82f6, #2563eb)',
                }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '15px', fontSize: '0.8rem', color: '#888', marginTop: '10px' }}>
              <span>⚔️ {playerInfo.kills || 0}</span>
              <span>💀 {playerInfo.deaths || 0}</span>
            </div>
          </div>
        </div>
      )}

      {/* Minimap */}
      <canvas ref={minimapRef} style={{ ...styles.minimap, display: screen === 'game' ? 'block' : 'none' }} />

      {/* Level Up */}
      {levelUp && (
        <div style={styles.levelUp}>
          <h2 style={{ color: '#ffd93d', fontSize: '2rem', marginBottom: '0.5rem' }}>⬆️ Level Up!</h2>
          <p>Level {levelUp}</p>
        </div>
      )}

      {/* Connection Status */}
      <div style={styles.connectionStatus(connected)}>
        {connected ? 'Connected' : 'Disconnected - Reconnecting...'}
      </div>

      {/* Controls hint */}
      {screen === 'game' && (
        <div style={{
          position: 'absolute',
          bottom: '20px',
          left: '20px',
          background: 'rgba(0,0,0,0.5)',
          padding: '10px 15px',
          borderRadius: '8px',
          fontSize: '0.8rem',
          color: '#666',
          zIndex: 50,
        }}>
          WASD / Arrows to move • Spells auto-cast
        </div>
      )}
    </div>
  );
}
