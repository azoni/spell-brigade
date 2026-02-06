// ===========================================
// CLASSES
// ===========================================

export const CLASSES = {
  pyromancer: {
    id: 'pyromancer',
    name: 'Pyromancer',
    color: '#ff6b35',
    baseHealth: 80,
    baseSpeed: 160,
    spells: ['fireball', 'flamewave'],
    description: 'Master of fire magic. High damage, lower health.',
    dashAbility: {
      id: 'fireDash',
      name: 'Fire Dash',
      cooldown: 4000,
      distance: 200,
      damage: 15,
      trailDuration: 1000,
    },
    ultimateAbility: {
      id: 'meteor',
      name: 'Meteor Strike',
      cooldown: 20000,
      damage: 100,
      radius: 150,
      delay: 1000, // Warning before impact
    },
  },
  cryomancer: {
    id: 'cryomancer',
    name: 'Cryomancer',
    color: '#4ecdc4',
    baseHealth: 90,
    baseSpeed: 150,
    spells: ['frostbolt', 'blizzard'],
    description: 'Ice wizard. Balanced stats with slowing effects.',
    dashAbility: {
      id: 'frostStep',
      name: 'Frost Step',
      cooldown: 5000,
      distance: 180,
      freezeDuration: 2000,
      freezeRadius: 60,
    },
    ultimateAbility: {
      id: 'iceNova',
      name: 'Ice Nova',
      cooldown: 25000,
      damage: 50,
      radius: 200,
      freezeDuration: 3000,
    },
  },
  arcanist: {
    id: 'arcanist',
    name: 'Arcanist',
    color: '#9b5de5',
    baseHealth: 100,
    baseSpeed: 140,
    spells: ['arcaneBlast', 'magicMissile'],
    description: 'Pure arcane power. Tanky with AOE damage.',
    dashAbility: {
      id: 'blink',
      name: 'Blink',
      cooldown: 6000,
      distance: 250,
      invulnerable: true, // Brief invulnerability
    },
    ultimateAbility: {
      id: 'arcaneBarrage',
      name: 'Arcane Barrage',
      cooldown: 18000,
      missiles: 12,
      damagePerMissile: 20,
      duration: 2000,
    },
  },
  
  // === UNLOCKABLE CLASS - After Dragon Kill ===
  voidlord: {
    id: 'voidlord',
    name: 'Void Lord',
    color: '#1a0a2e',
    secondaryColor: '#ff00ff',
    baseHealth: 95,
    baseSpeed: 155,
    spells: ['voidBolt', 'annihilate'],
    description: 'Master of the void. Unlocked by slaying the Dragon.',
    hidden: true, // Hidden until dragon is killed
    requiresDragonKill: true,
    dashAbility: {
      id: 'voidShift',
      name: 'Void Shift',
      cooldown: 5000,
      distance: 200,
      invulnerable: true,
      damageOnArrival: 25,
      damageRadius: 60,
    },
    ultimateAbility: {
      id: 'voidRift',
      name: 'Void Rift',
      cooldown: 22000,
      damage: 80,
      radius: 200,
      pullForce: 100,
      duration: 2500,
    },
  },
  
  // === ADMIN CLASS - Shadow Archer ===
  shadowarcher: {
    id: 'shadowarcher',
    name: 'Shadow Archer',
    color: '#334155',
    secondaryColor: '#dc2626',
    baseHealth: 200,
    baseSpeed: 280,
    spells: ['shadowArrow', 'piercingVolley'],
    description: 'Elite shadow hunter. Admin exclusive.',
    isAdmin: true,
    hidden: true,
    canPvP: true,
    icon: '🏹',
    dashAbility: {
      id: 'shadowStep',
      name: 'Shadow Step',
      cooldown: 2000,
      distance: 350,
      invulnerable: true,
      damageOnArrival: 40,
      damageRadius: 80,
    },
    ultimateAbility: {
      id: 'arrowStorm',
      name: 'Arrow Storm',
      cooldown: 10000,
      damage: 150,
      radius: 350,
      duration: 2000,
      waves: 5,
    },
  },
};

