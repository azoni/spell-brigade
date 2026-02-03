// ===========================================
// SPELL SYSTEM - Upgrades, Effects, Boss Drops
// ===========================================

// Base spell definitions by class
const BASE_SPELLS = {
  pyromancer: {
    primary: {
      id: 'fireball',
      name: 'Fireball',
      description: 'Hurls a ball of fire at enemies',
      baseDamage: 25,
      cooldown: 800,
      speed: 8,
      range: 400,
      color: '#f97316',
      type: 'projectile',
    },
    secondary: {
      id: 'flame_wave',
      name: 'Flame Wave',
      description: 'Releases a wave of fire in front of you',
      baseDamage: 15,
      cooldown: 2000,
      range: 200,
      angle: Math.PI / 3,
      color: '#dc2626',
      type: 'wave',
    },
    ultimate: {
      id: 'meteor',
      name: 'Meteor Strike',
      description: 'Calls down a devastating meteor',
      baseDamage: 100,
      cooldown: 15000,
      radius: 150,
      color: '#f97316',
      type: 'aoe',
    },
  },
  cryomancer: {
    primary: {
      id: 'frostbolt',
      name: 'Frostbolt',
      description: 'Launches a shard of ice',
      baseDamage: 20,
      cooldown: 700,
      speed: 10,
      range: 450,
      slowAmount: 0.3,
      slowDuration: 1500,
      color: '#22d3ee',
      type: 'projectile',
    },
    secondary: {
      id: 'blizzard',
      name: 'Blizzard',
      description: 'Creates a localized blizzard',
      baseDamage: 8,
      cooldown: 3000,
      radius: 120,
      duration: 3000,
      color: '#0ea5e9',
      type: 'zone',
    },
    ultimate: {
      id: 'ice_nova',
      name: 'Ice Nova',
      description: 'Explodes outward with freezing energy',
      baseDamage: 60,
      cooldown: 12000,
      radius: 200,
      freezeDuration: 2000,
      color: '#67e8f9',
      type: 'nova',
    },
  },
  arcanist: {
    primary: {
      id: 'arcane_missile',
      name: 'Arcane Missile',
      description: 'Fires a bolt of pure arcane energy',
      baseDamage: 22,
      cooldown: 600,
      speed: 12,
      range: 500,
      color: '#a855f7',
      type: 'projectile',
    },
    secondary: {
      id: 'arcane_burst',
      name: 'Arcane Burst',
      description: 'Releases burst of arcane energy',
      baseDamage: 30,
      cooldown: 2500,
      radius: 100,
      color: '#7c3aed',
      type: 'burst',
    },
    ultimate: {
      id: 'arcane_storm',
      name: 'Arcane Storm',
      description: 'Conjures a storm of arcane bolts',
      baseDamage: 40,
      cooldown: 14000,
      duration: 4000,
      boltsPerSecond: 3,
      color: '#c084fc',
      type: 'storm',
    },
  },
};

// Spell upgrades that can drop from bosses
const SPELL_UPGRADES = {
  // Pyromancer upgrades
  inferno_core: {
    id: 'inferno_core',
    name: 'Inferno Core',
    description: 'Fireballs explode on impact, dealing area damage',
    class: 'pyromancer',
    spell: 'fireball',
    rarity: 'rare',
    dropRate: 0.15,
    effect: {
      type: 'explosion',
      radius: 60,
      damageMultiplier: 0.5,
    },
    visualEffect: 'explosion_trail',
  },
  blazing_speed: {
    id: 'blazing_speed',
    name: 'Blazing Speed',
    description: 'Fireballs travel 50% faster and pierce one enemy',
    class: 'pyromancer',
    spell: 'fireball',
    rarity: 'uncommon',
    dropRate: 0.2,
    effect: {
      type: 'pierce',
      count: 1,
      speedBonus: 0.5,
    },
    visualEffect: 'flame_trail',
  },
  phoenix_flame: {
    id: 'phoenix_flame',
    name: 'Phoenix Flame',
    description: 'Meteors leave burning ground that damages over time',
    class: 'pyromancer',
    spell: 'meteor',
    rarity: 'epic',
    dropRate: 0.08,
    effect: {
      type: 'dot_zone',
      duration: 5000,
      tickDamage: 10,
      tickRate: 500,
    },
    visualEffect: 'burning_ground',
  },
  
  // Cryomancer upgrades
  permafrost: {
    id: 'permafrost',
    name: 'Permafrost',
    description: 'Enemies hit by Frostbolt have a 20% chance to freeze solid',
    class: 'cryomancer',
    spell: 'frostbolt',
    rarity: 'rare',
    dropRate: 0.15,
    effect: {
      type: 'freeze_chance',
      chance: 0.2,
      duration: 1500,
    },
    visualEffect: 'ice_encasement',
  },
  glacial_shards: {
    id: 'glacial_shards',
    name: 'Glacial Shards',
    description: 'Frostbolts split into 3 smaller shards on impact',
    class: 'cryomancer',
    spell: 'frostbolt',
    rarity: 'epic',
    dropRate: 0.1,
    effect: {
      type: 'split',
      count: 3,
      damageMultiplier: 0.4,
      spreadAngle: Math.PI / 4,
    },
    visualEffect: 'crystal_split',
  },
  absolute_zero: {
    id: 'absolute_zero',
    name: 'Absolute Zero',
    description: 'Ice Nova freezes enemies for twice as long and shatters frozen enemies',
    class: 'cryomancer',
    spell: 'ice_nova',
    rarity: 'legendary',
    dropRate: 0.05,
    effect: {
      type: 'enhanced_freeze',
      durationMultiplier: 2,
      shatterDamage: 50,
    },
    visualEffect: 'shatter_effect',
  },
  
  // Arcanist upgrades
  mana_surge: {
    id: 'mana_surge',
    name: 'Mana Surge',
    description: 'Every 5th Arcane Missile deals triple damage',
    class: 'arcanist',
    spell: 'arcane_missile',
    rarity: 'uncommon',
    dropRate: 0.2,
    effect: {
      type: 'empowered_nth',
      n: 5,
      damageMultiplier: 3,
    },
    visualEffect: 'charged_missile',
  },
  void_touched: {
    id: 'void_touched',
    name: 'Void Touched',
    description: 'Arcane Missiles home in on enemies and ignore obstacles',
    class: 'arcanist',
    spell: 'arcane_missile',
    rarity: 'rare',
    dropRate: 0.12,
    effect: {
      type: 'homing',
      turnRate: 0.1,
      phaseThrough: true,
    },
    visualEffect: 'void_trail',
  },
  reality_tear: {
    id: 'reality_tear',
    name: 'Reality Tear',
    description: 'Arcane Storm creates a black hole that pulls enemies inward',
    class: 'arcanist',
    spell: 'arcane_storm',
    rarity: 'legendary',
    dropRate: 0.05,
    effect: {
      type: 'vortex',
      pullStrength: 50,
      radius: 200,
    },
    visualEffect: 'black_hole',
  },
};

// New alternate spells unlocked from bosses
const ALTERNATE_SPELLS = {
  // Pyromancer alternates
  dragons_breath: {
    id: 'dragons_breath',
    name: "Dragon's Breath",
    description: 'Breathe a continuous stream of fire',
    class: 'pyromancer',
    replacesSlot: 'primary',
    rarity: 'epic',
    dropRate: 0.08,
    stats: {
      damagePerTick: 8,
      tickRate: 100,
      range: 250,
      coneAngle: Math.PI / 6,
      manaCost: 2,
    },
    visualEffect: 'flame_breath',
  },
  living_bomb: {
    id: 'living_bomb',
    name: 'Living Bomb',
    description: 'Mark an enemy to explode after 3 seconds, damaging nearby foes',
    class: 'pyromancer',
    replacesSlot: 'secondary',
    rarity: 'rare',
    dropRate: 0.12,
    stats: {
      markDuration: 3000,
      explosionDamage: 80,
      explosionRadius: 120,
      cooldown: 5000,
    },
    visualEffect: 'bomb_mark',
  },
  
  // Cryomancer alternates
  ice_lance: {
    id: 'ice_lance',
    name: 'Ice Lance',
    description: 'Pierce through all enemies in a line, dealing bonus damage to frozen targets',
    class: 'cryomancer',
    replacesSlot: 'primary',
    rarity: 'epic',
    dropRate: 0.08,
    stats: {
      baseDamage: 30,
      frozenBonusDamage: 50,
      pierceAll: true,
      cooldown: 1200,
      range: 600,
    },
    visualEffect: 'ice_pierce',
  },
  frost_armor: {
    id: 'frost_armor',
    name: 'Frost Armor',
    description: 'Encase yourself in ice, reducing damage and freezing attackers',
    class: 'cryomancer',
    replacesSlot: 'secondary',
    rarity: 'rare',
    dropRate: 0.12,
    stats: {
      duration: 4000,
      damageReduction: 0.5,
      reflectFreezeDuration: 1000,
      cooldown: 10000,
    },
    visualEffect: 'ice_shield',
  },
  
  // Arcanist alternates
  arcane_orb: {
    id: 'arcane_orb',
    name: 'Arcane Orb',
    description: 'Launch a slow-moving orb that deals massive damage',
    class: 'arcanist',
    replacesSlot: 'primary',
    rarity: 'epic',
    dropRate: 0.08,
    stats: {
      baseDamage: 60,
      speed: 3,
      radius: 40,
      cooldown: 1500,
      growthRate: 0.5, // Grows larger over distance
    },
    visualEffect: 'growing_orb',
  },
  blink: {
    id: 'blink',
    name: 'Blink',
    description: 'Instantly teleport a short distance, leaving arcane afterimages',
    class: 'arcanist',
    replacesSlot: 'secondary',
    rarity: 'rare',
    dropRate: 0.12,
    stats: {
      maxDistance: 200,
      cooldown: 3000,
      afterimages: 3,
      afterimageDamage: 15,
    },
    visualEffect: 'blink_trail',
  },
};

// Boss drop tables
const BOSS_DROP_TABLES = {
  ancient_treant: {
    guaranteedXp: 500,
    drops: [
      { item: 'permafrost', chance: 0.15 },
      { item: 'blazing_speed', chance: 0.15 },
      { item: 'mana_surge', chance: 0.15 },
      { item: 'frost_armor', chance: 0.08 },
    ],
  },
  magma_titan: {
    guaranteedXp: 750,
    drops: [
      { item: 'inferno_core', chance: 0.15 },
      { item: 'phoenix_flame', chance: 0.08 },
      { item: 'dragons_breath', chance: 0.06 },
      { item: 'living_bomb', chance: 0.1 },
    ],
  },
  frost_wyrm: {
    guaranteedXp: 1000,
    drops: [
      { item: 'permafrost', chance: 0.12 },
      { item: 'glacial_shards', chance: 0.1 },
      { item: 'absolute_zero', chance: 0.05 },
      { item: 'ice_lance', chance: 0.06 },
    ],
  },
  void_overlord: {
    guaranteedXp: 1500,
    drops: [
      { item: 'void_touched', chance: 0.12 },
      { item: 'reality_tear', chance: 0.05 },
      { item: 'blink', chance: 0.08 },
      { item: 'arcane_orb', chance: 0.06 },
    ],
  },
  crystal_golem: {
    guaranteedXp: 600,
    drops: [
      { item: 'glacial_shards', chance: 0.12 },
      { item: 'mana_surge', chance: 0.15 },
      { item: 'blazing_speed', chance: 0.12 },
    ],
  },
  blossom_behemoth: {
    guaranteedXp: 400,
    drops: [
      { item: 'blazing_speed', chance: 0.2 },
      { item: 'mana_surge', chance: 0.2 },
      { item: 'permafrost', chance: 0.15 },
    ],
  },
};

// Calculate boss drops for a player
function calculateBossDrops(bossType, playerClass) {
  const dropTable = BOSS_DROP_TABLES[bossType];
  if (!dropTable) return { xp: 100, items: [] };
  
  const drops = {
    xp: dropTable.guaranteedXp,
    items: [],
  };
  
  for (const drop of dropTable.drops) {
    if (Math.random() < drop.chance) {
      // Check if this upgrade is for the player's class
      const upgrade = SPELL_UPGRADES[drop.item] || ALTERNATE_SPELLS[drop.item];
      if (upgrade && upgrade.class === playerClass) {
        drops.items.push({
          id: drop.item,
          ...upgrade,
        });
      }
    }
  }
  
  return drops;
}

// Apply spell upgrade effects
function applyUpgradeToSpell(spell, upgrade) {
  const enhanced = { ...spell };
  
  switch (upgrade.effect.type) {
    case 'explosion':
      enhanced.explosionRadius = upgrade.effect.radius;
      enhanced.explosionDamage = spell.baseDamage * upgrade.effect.damageMultiplier;
      break;
    case 'pierce':
      enhanced.pierceCount = upgrade.effect.count;
      enhanced.speed *= (1 + upgrade.effect.speedBonus);
      break;
    case 'freeze_chance':
      enhanced.freezeChance = upgrade.effect.chance;
      enhanced.freezeDuration = upgrade.effect.duration;
      break;
    case 'split':
      enhanced.splitCount = upgrade.effect.count;
      enhanced.splitDamage = spell.baseDamage * upgrade.effect.damageMultiplier;
      enhanced.splitAngle = upgrade.effect.spreadAngle;
      break;
    case 'homing':
      enhanced.homing = true;
      enhanced.homingTurnRate = upgrade.effect.turnRate;
      enhanced.phaseThrough = upgrade.effect.phaseThrough;
      break;
    case 'empowered_nth':
      enhanced.empowerEveryN = upgrade.effect.n;
      enhanced.empowerMultiplier = upgrade.effect.damageMultiplier;
      break;
  }
  
  return enhanced;
}

module.exports = {
  BASE_SPELLS,
  SPELL_UPGRADES,
  ALTERNATE_SPELLS,
  BOSS_DROP_TABLES,
  calculateBossDrops,
  applyUpgradeToSpell,
};
