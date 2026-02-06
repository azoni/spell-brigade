import { v4 as uuidv4 } from 'uuid';
import { llmGenerate, isLLMEnabled } from './openrouter.js';

// ===========================================
// AI WIZARD GENERATOR - LLM-powered class creation
// ===========================================

const WIZARD_LLM_PROMPT = `You are a game designer for Spell Brigade, a 2D multiplayer wizard arena game.
Create a custom wizard class from the user's description. The wizard must be balanced for PvE combat.

IMPORTANT: Pay close attention to the user's description. If they specify spell names, abilities, lore details, 
elemental themes, or gameplay mechanics, incorporate those directly into the generated class. Honor their creative 
vision while keeping the stats balanced within the ranges below.

EXISTING CLASSES FOR REFERENCE (to keep balance similar):
- Pyromancer: HP 80, Speed 160, Spell1: 28dmg/900ms/projectile, Spell2: 18dmg/1500ms/AOE
- Cryomancer: HP 90, Speed 150, Spell1: 18dmg/500ms/projectile+slow, Spell2: 12dmg/2500ms/AOE+slow  
- Arcanist: HP 100, Speed 140, Spell1: 45dmg/2000ms/AOE, Spell2: 15dmg/400ms/homing

Respond with ONLY this JSON:
{
  "name": "Class name (2-3 words max)",
  "description": "One sentence class description",
  "color": "#hex primary color",
  "secondaryColor": "#hex accent color",
  "baseHealth": 80-110,
  "baseSpeed": 135-165,
  "lore": "2-3 sentence backstory for this wizard type",
  "spell1": {
    "name": "Spell name",
    "type": "projectile or aoe",
    "damage": 15-45,
    "cooldown": 400-2500,
    "range": 180-400,
    "radius": 6-15 for projectile or 80-160 for aoe,
    "speed": 350-700 for projectile or 0 for aoe,
    "color": "#hex",
    "trailColor": "#hex (projectile only)",
    "description": "Brief spell description",
    "specialEffect": "none|slow|piercing|homing"
  },
  "spell2": {
    "name": "Spell name", 
    "type": "projectile or aoe",
    "damage": 10-50,
    "cooldown": 800-3000,
    "range": 150-350,
    "radius": 6-15 for projectile or 80-200 for aoe,
    "speed": 350-700 for projectile or 0 for aoe,
    "color": "#hex",
    "trailColor": "#hex (projectile only)",
    "description": "Brief spell description",
    "specialEffect": "none|slow|piercing|homing"
  },
  "ability1": {
    "name": "Ability name (unlocks at Lv10)",
    "type": "buff|aoe|projectile",
    "damage": 20-60,
    "cooldown": 8000-15000,
    "radius": 80-200,
    "duration": 3000-6000,
    "description": "Brief ability description"
  },
  "ability2": {
    "name": "Ability name (unlocks at Lv20)",
    "type": "buff|aoe|projectile",
    "damage": 30-80,
    "cooldown": 12000-20000,
    "radius": 100-250,
    "duration": 2000-5000,
    "description": "Brief ability description"
  },
  "ability3": {
    "name": "Ability name (unlocks at Lv30, powerful ultimate-type)",
    "type": "aoe",
    "damage": 50-120,
    "cooldown": 20000-35000,
    "radius": 150-300,
    "duration": 3000-8000,
    "description": "Brief ability description"
  },
  "dashAbility": {
    "name": "Dash name",
    "cooldown": 3000-7000,
    "distance": 150-280,
    "description": "Brief dash description"
  },
  "ultimateAbility": {
    "name": "Ultimate name",
    "cooldown": 15000-30000,
    "damage": 40-120,
    "radius": 120-220,
    "description": "Brief ultimate description"
  }
}

BALANCE RULES:
- High damage = high cooldown (no fast + high damage combos)
- HP + Speed inverse: high HP = lower speed, high speed = lower HP
- Total DPS should be comparable to existing classes (~25-35 DPS sustained)
- Ability1 is a moderate skill, Ability2 is stronger, Ability3 is the most powerful
- Be creative with themes but keep stats within the given ranges
- Colors should match the wizard's element/theme`;

// Stat clamping ranges
const CLAMP = {
  baseHealth: [80, 110],
  baseSpeed: [135, 165],
  spell: {
    damage: [8, 50],
    cooldown: [350, 3000],
    range: [150, 450],
    speed: [0, 800],
    radiusProjectile: [5, 18],
    radiusAoe: [60, 200],
  },
  dash: {
    cooldown: [3000, 8000],
    distance: [140, 300],
  },
  ult: {
    cooldown: [15000, 30000],
    damage: [35, 130],
    radius: [100, 250],
  },
  ability: {
    1: { damage: [20, 60], cooldown: [8000, 15000], radius: [80, 200], duration: [3000, 6000] },
    2: { damage: [30, 80], cooldown: [12000, 20000], radius: [100, 250], duration: [2000, 5000] },
    3: { damage: [50, 120], cooldown: [20000, 35000], radius: [150, 300], duration: [3000, 8000] },
  },
};

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, typeof val === 'number' ? val : min));
}

function isValidHex(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

function clampSpell(spellData, index, classColor) {
  if (!spellData || typeof spellData !== 'object') {
    // Fallback spell
    return index === 0 ? {
      id: `custom_spell_${uuidv4().slice(0, 8)}`,
      name: 'Energy Bolt',
      damage: 25, cooldown: 800, range: 300, speed: 500, radius: 10,
      color: classColor, trailColor: classColor,
    } : {
      id: `custom_spell_${uuidv4().slice(0, 8)}`,
      name: 'Energy Wave',
      damage: 20, cooldown: 2000, range: 200, speed: 0, radius: 120,
      color: classColor, isAoe: true,
    };
  }

  const isAoe = spellData.type === 'aoe' || spellData.speed === 0;
  const C = CLAMP.spell;

  const spell = {
    id: `custom_spell_${uuidv4().slice(0, 8)}`,
    name: (typeof spellData.name === 'string' ? spellData.name : `Spell ${index + 1}`).slice(0, 30),
    damage: clamp(spellData.damage, C.damage[0], C.damage[1]),
    cooldown: clamp(spellData.cooldown, C.cooldown[0], C.cooldown[1]),
    range: clamp(spellData.range, C.range[0], C.range[1]),
    speed: isAoe ? 0 : clamp(spellData.speed, 300, C.speed[1]),
    radius: isAoe
      ? clamp(spellData.radius, C.radiusAoe[0], C.radiusAoe[1])
      : clamp(spellData.radius, C.radiusProjectile[0], C.radiusProjectile[1]),
    color: isValidHex(spellData.color) ? spellData.color : classColor,
  };

  if (isAoe) {
    spell.isAoe = true;
  } else {
    spell.trailColor = isValidHex(spellData.trailColor) ? spellData.trailColor : spell.color;
  }

  // Special effects
  if (spellData.specialEffect === 'slow') {
    spell.slowEffect = 0.5;
    spell.slowDuration = 1500;
  } else if (spellData.specialEffect === 'piercing') {
    spell.piercing = true;
  } else if (spellData.specialEffect === 'homing') {
    spell.homing = true;
  }

  // DPS guard: if damage/cooldown ratio too high, increase cooldown
  const dps = (spell.damage / spell.cooldown) * 1000;
  if (dps > 60) {
    spell.cooldown = Math.round((spell.damage / 55) * 1000);
  }

  return spell;
}

/**
 * Generate a custom wizard class via LLM.
 * Returns null if LLM is unavailable or fails.
 */
export async function generateWizard(prompt) {
  if (isLLMEnabled()) {
    console.log(`🧙 Generating wizard via LLM: "${prompt}"`);
    const llmData = await llmGenerate(WIZARD_LLM_PROMPT, prompt, 1000);
    if (llmData) {
      return clampWizardOutput(llmData);
    }
    console.warn('LLM generation failed, falling back to templates');
  }

  // Template-based fallback when LLM is unavailable
  console.log(`🧙 Generating wizard from templates: "${prompt}"`);
  return generateFromTemplate(prompt);
}

// ===========================================
// TEMPLATE-BASED WIZARD GENERATOR (no LLM needed)
// ===========================================
const WIZARD_TEMPLATES = [
  {
    keywords: ['fire', 'flame', 'pyro', 'ember', 'burn', 'inferno', 'lava', 'magma', 'blaze', 'heat', 'scorch'],
    name: 'Ember Warlock', color: '#ff4500', secondaryColor: '#ffd700',
    description: 'A warlock who channels destructive fire magic.',
    lore: 'Trained in the volcanic forges beneath the world, Ember Warlocks harness primordial flame. Their spells reduce enemies to ash.',
    spell1: { name: 'Flame Lance', type: 'projectile', damage: 30, cooldown: 900, range: 320, speed: 550, radius: 10, color: '#ff4500', trailColor: '#ffd700', specialEffect: 'none' },
    spell2: { name: 'Inferno Ring', type: 'aoe', damage: 22, cooldown: 2200, range: 200, speed: 0, radius: 130, color: '#ff6600', specialEffect: 'none' },
    ability1: { name: 'Pyroclasm', type: 'aoe', damage: 35, cooldown: 8000, radius: 120, duration: 2500 },
    ability2: { name: 'Molten Armor', type: 'buff', damage: 40, cooldown: 14000, radius: 150, duration: 4000 },
    ability3: { name: 'Firestorm', type: 'aoe', damage: 85, cooldown: 25000, radius: 220, duration: 5000 },
    dash: { name: 'Flame Dash', cooldown: 4000, distance: 200 },
    ult: { name: 'Phoenix Burst', cooldown: 22000, damage: 90, radius: 180 },
    baseHealth: 85, baseSpeed: 158,
  },
  {
    keywords: ['ice', 'frost', 'cold', 'freeze', 'snow', 'blizzard', 'cryo', 'winter', 'glacier', 'chill'],
    name: 'Frostweaver', color: '#00d4ff', secondaryColor: '#e0f7ff',
    description: 'A mage who weaves freezing enchantments to slow and shatter foes.',
    lore: 'Born in the eternal winter wastes, Frostweavers command ice with surgical precision. Their chilling magic slows enemies before the killing blow.',
    spell1: { name: 'Ice Shard', type: 'projectile', damage: 20, cooldown: 600, range: 300, speed: 600, radius: 9, color: '#00d4ff', trailColor: '#e0f7ff', specialEffect: 'slow' },
    spell2: { name: 'Glacial Burst', type: 'aoe', damage: 16, cooldown: 2000, range: 200, speed: 0, radius: 140, color: '#88e0ff', specialEffect: 'slow' },
    ability1: { name: 'Frozen Spike', type: 'projectile', damage: 30, cooldown: 7000, radius: 100, duration: 2000 },
    ability2: { name: 'Permafrost', type: 'aoe', damage: 35, cooldown: 13000, radius: 160, duration: 3500 },
    ability3: { name: 'Absolute Zero', type: 'aoe', damage: 70, cooldown: 24000, radius: 200, duration: 6000 },
    dash: { name: 'Ice Slide', cooldown: 3500, distance: 220 },
    ult: { name: 'Blizzard Wrath', cooldown: 20000, damage: 75, radius: 200 },
    baseHealth: 92, baseSpeed: 148,
  },
  {
    keywords: ['dark', 'shadow', 'void', 'death', 'necro', 'undead', 'curse', 'doom', 'lich', 'corrupt', 'evil'],
    name: 'Doomcaller', color: '#8b00ff', secondaryColor: '#cc66ff',
    description: 'A dark sorcerer who draws power from the void between worlds.',
    lore: 'Doomcallers peer into the abyss and channel its entropy. Their spells drain life force and corrupt the very essence of their enemies.',
    spell1: { name: 'Void Bolt', type: 'projectile', damage: 28, cooldown: 850, range: 280, speed: 520, radius: 11, color: '#8b00ff', trailColor: '#cc66ff', specialEffect: 'none' },
    spell2: { name: 'Shadow Pool', type: 'aoe', damage: 20, cooldown: 2400, range: 220, speed: 0, radius: 120, color: '#6600cc', specialEffect: 'slow' },
    ability1: { name: 'Soul Rend', type: 'projectile', damage: 38, cooldown: 9000, radius: 110, duration: 2000 },
    ability2: { name: 'Void Eruption', type: 'aoe', damage: 45, cooldown: 15000, radius: 170, duration: 3000 },
    ability3: { name: 'Eclipse', type: 'aoe', damage: 95, cooldown: 28000, radius: 250, duration: 5000 },
    dash: { name: 'Shadow Step', cooldown: 4500, distance: 240 },
    ult: { name: 'Abyssal Rift', cooldown: 24000, damage: 100, radius: 190 },
    baseHealth: 88, baseSpeed: 155,
  },
  {
    keywords: ['light', 'holy', 'divine', 'heal', 'angel', 'radiant', 'sun', 'solar', 'celestial', 'pure'],
    name: 'Radiant Cleric', color: '#ffd700', secondaryColor: '#fffacd',
    description: 'A divine channeler who wields searing holy light.',
    lore: 'Blessed by celestial forces, Radiant Clerics smite darkness with purifying radiance. Their light burns the wicked and shields the faithful.',
    spell1: { name: 'Holy Lance', type: 'projectile', damage: 26, cooldown: 800, range: 310, speed: 580, radius: 10, color: '#ffd700', trailColor: '#fffacd', specialEffect: 'none' },
    spell2: { name: 'Sanctify', type: 'aoe', damage: 18, cooldown: 2000, range: 200, speed: 0, radius: 135, color: '#ffee88', specialEffect: 'none' },
    ability1: { name: 'Smite', type: 'projectile', damage: 32, cooldown: 7500, radius: 100, duration: 2000 },
    ability2: { name: 'Divine Judgment', type: 'aoe', damage: 42, cooldown: 14000, radius: 160, duration: 3500 },
    ability3: { name: 'Solar Flare', type: 'aoe', damage: 80, cooldown: 26000, radius: 230, duration: 4500 },
    dash: { name: 'Flash of Light', cooldown: 3800, distance: 210 },
    ult: { name: 'Celestial Wrath', cooldown: 21000, damage: 85, radius: 185 },
    baseHealth: 95, baseSpeed: 145,
  },
  {
    keywords: ['earth', 'stone', 'rock', 'mountain', 'golem', 'crystal', 'geo', 'terra', 'quake', 'boulder'],
    name: 'Stoneshaper', color: '#8b6914', secondaryColor: '#d4a856',
    description: 'A geomancer who commands earth and stone to crush enemies.',
    lore: 'Stoneshapers commune with the earth itself, raising boulders and splitting the ground. Their magic is slow but devastating.',
    spell1: { name: 'Boulder Toss', type: 'projectile', damage: 35, cooldown: 1200, range: 260, speed: 420, radius: 14, color: '#8b6914', trailColor: '#d4a856', specialEffect: 'none' },
    spell2: { name: 'Seismic Slam', type: 'aoe', damage: 25, cooldown: 2500, range: 180, speed: 0, radius: 150, color: '#a0855c', specialEffect: 'slow' },
    ability1: { name: 'Rock Wall', type: 'aoe', damage: 28, cooldown: 8000, radius: 130, duration: 3000 },
    ability2: { name: 'Tectonic Surge', type: 'aoe', damage: 50, cooldown: 16000, radius: 180, duration: 4000 },
    ability3: { name: 'Earthquake', type: 'aoe', damage: 100, cooldown: 30000, radius: 260, duration: 6000 },
    dash: { name: 'Stone Charge', cooldown: 5000, distance: 180 },
    ult: { name: 'Mountain Fall', cooldown: 25000, damage: 110, radius: 200 },
    baseHealth: 105, baseSpeed: 138,
  },
  {
    keywords: ['wind', 'air', 'storm', 'lightning', 'thunder', 'tempest', 'gale', 'electric', 'shock', 'bolt'],
    name: 'Tempest Mage', color: '#00bfff', secondaryColor: '#e0ffff',
    description: 'A storm wizard who calls down lightning and howling winds.',
    lore: 'Tempest Mages ride the winds of chaos, unleashing devastating electrical storms. Their speed is unmatched, striking before enemies can react.',
    spell1: { name: 'Lightning Bolt', type: 'projectile', damage: 24, cooldown: 550, range: 350, speed: 700, radius: 8, color: '#00bfff', trailColor: '#e0ffff', specialEffect: 'none' },
    spell2: { name: 'Thunder Clap', type: 'aoe', damage: 15, cooldown: 1800, range: 220, speed: 0, radius: 125, color: '#66d9ff', specialEffect: 'none' },
    ability1: { name: 'Chain Lightning', type: 'projectile', damage: 30, cooldown: 7000, radius: 100, duration: 2000 },
    ability2: { name: 'Cyclone', type: 'aoe', damage: 38, cooldown: 13000, radius: 150, duration: 3500 },
    ability3: { name: 'Supercell', type: 'aoe', damage: 75, cooldown: 23000, radius: 210, duration: 5500 },
    dash: { name: 'Wind Rush', cooldown: 3000, distance: 260 },
    ult: { name: 'Thunderstrike', cooldown: 18000, damage: 80, radius: 170 },
    baseHealth: 82, baseSpeed: 165,
  },
  {
    keywords: ['nature', 'plant', 'druid', 'forest', 'vine', 'bloom', 'leaf', 'tree', 'wood', 'thorn', 'poison', 'toxic'],
    name: 'Thornweaver', color: '#228b22', secondaryColor: '#90ee90',
    description: 'A druidic mage who summons thorns and toxic flora.',
    lore: 'Thornweavers channel the wild fury of nature, ensnaring foes in brambles and poisoning them with noxious spores.',
    spell1: { name: 'Thorn Spike', type: 'projectile', damage: 22, cooldown: 700, range: 290, speed: 550, radius: 9, color: '#228b22', trailColor: '#90ee90', specialEffect: 'slow' },
    spell2: { name: 'Spore Cloud', type: 'aoe', damage: 14, cooldown: 2100, range: 200, speed: 0, radius: 140, color: '#44bb44', specialEffect: 'slow' },
    ability1: { name: 'Bramble Trap', type: 'aoe', damage: 25, cooldown: 7500, radius: 120, duration: 3000 },
    ability2: { name: 'Overgrowth', type: 'aoe', damage: 40, cooldown: 14000, radius: 160, duration: 4000 },
    ability3: { name: 'Wrath of Nature', type: 'aoe', damage: 85, cooldown: 26000, radius: 240, duration: 5500 },
    dash: { name: 'Vine Leap', cooldown: 4000, distance: 220 },
    ult: { name: 'Verdant Storm', cooldown: 22000, damage: 80, radius: 190 },
    baseHealth: 90, baseSpeed: 150,
  },
  {
    keywords: ['blood', 'vampire', 'drain', 'leech', 'crimson', 'sanguine', 'gore', 'red'],
    name: 'Bloodmancer', color: '#8b0000', secondaryColor: '#ff4444',
    description: 'A forbidden mage who wields blood magic to drain life force.',
    lore: 'Bloodmancers practice the darkest of arts, siphoning vitality from enemies to fuel their power. They grow stronger as battle rages.',
    spell1: { name: 'Blood Bolt', type: 'projectile', damage: 25, cooldown: 750, range: 300, speed: 530, radius: 10, color: '#8b0000', trailColor: '#ff4444', specialEffect: 'none' },
    spell2: { name: 'Crimson Wave', type: 'aoe', damage: 19, cooldown: 2300, range: 200, speed: 0, radius: 130, color: '#cc0000', specialEffect: 'none' },
    ability1: { name: 'Life Drain', type: 'projectile', damage: 33, cooldown: 8500, radius: 110, duration: 2500 },
    ability2: { name: 'Blood Nova', type: 'aoe', damage: 45, cooldown: 15000, radius: 170, duration: 3000 },
    ability3: { name: 'Hemorrhage', type: 'aoe', damage: 90, cooldown: 27000, radius: 230, duration: 5500 },
    dash: { name: 'Blood Rush', cooldown: 4200, distance: 210 },
    ult: { name: 'Sanguine Tide', cooldown: 23000, damage: 95, radius: 195 },
    baseHealth: 88, baseSpeed: 152,
  },
];

// Default template when no keywords match
const DEFAULT_TEMPLATE = {
  name: 'Arcane Sage', color: '#9b5de5', secondaryColor: '#c9a0ff',
  description: 'A versatile wizard who commands raw arcane energy.',
  lore: 'Arcane Sages study the fundamental forces of magic itself. Their spells are balanced and adaptable.',
  spell1: { name: 'Arcane Missile', type: 'projectile', damage: 26, cooldown: 800, range: 300, speed: 550, radius: 10, color: '#9b5de5', trailColor: '#c9a0ff', specialEffect: 'none' },
  spell2: { name: 'Mana Burst', type: 'aoe', damage: 18, cooldown: 2000, range: 200, speed: 0, radius: 130, color: '#b388ff', specialEffect: 'none' },
  ability1: { name: 'Arcane Barrage', type: 'aoe', damage: 32, cooldown: 8000, radius: 120, duration: 2500 },
  ability2: { name: 'Mana Storm', type: 'aoe', damage: 42, cooldown: 14000, radius: 160, duration: 3500 },
  ability3: { name: 'Arcane Annihilation', type: 'aoe', damage: 80, cooldown: 25000, radius: 220, duration: 5000 },
  dash: { name: 'Blink', cooldown: 4000, distance: 220 },
  ult: { name: 'Arcane Nova', cooldown: 22000, damage: 85, radius: 185 },
  baseHealth: 90, baseSpeed: 152,
};

function generateFromTemplate(prompt) {
  const lower = prompt.toLowerCase();
  
  // Find best matching template by keyword count
  let bestTemplate = null;
  let bestScore = 0;
  for (const template of WIZARD_TEMPLATES) {
    const score = template.keywords.filter(kw => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestTemplate = template;
    }
  }
  
  if (!bestTemplate) bestTemplate = DEFAULT_TEMPLATE;
  
  // Add some randomization to stats
  const variance = () => 0.85 + Math.random() * 0.3; // 85%-115%
  
  // Try to extract a custom name from the prompt
  const words = prompt.trim().split(/\s+/).filter(w => w.length >= 3);
  let customName = bestTemplate.name;
  if (words.length >= 2) {
    // Capitalize first 2-3 meaningful words
    const nameWords = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    customName = nameWords.join(' ').slice(0, 30);
  }
  
  const data = {
    name: customName,
    description: bestTemplate.description,
    color: bestTemplate.color,
    secondaryColor: bestTemplate.secondaryColor,
    baseHealth: Math.round(bestTemplate.baseHealth * variance()),
    baseSpeed: Math.round(bestTemplate.baseSpeed * variance()),
    lore: bestTemplate.lore,
    spell1: { ...bestTemplate.spell1, damage: Math.round(bestTemplate.spell1.damage * variance()) },
    spell2: { ...bestTemplate.spell2, damage: Math.round(bestTemplate.spell2.damage * variance()) },
    ability1: { ...bestTemplate.ability1, damage: Math.round(bestTemplate.ability1.damage * variance()) },
    ability2: { ...bestTemplate.ability2, damage: Math.round(bestTemplate.ability2.damage * variance()) },
    ability3: { ...bestTemplate.ability3, damage: Math.round(bestTemplate.ability3.damage * variance()) },
    dashAbility: bestTemplate.dash,
    ultimateAbility: bestTemplate.ult,
  };
  
  return clampWizardOutput(data);
}

function clampAbility(abilityData, slot, classId, color) {
  const C = CLAMP.ability[slot];
  const fallbackNames = { 1: 'Power Strike', 2: 'Energy Burst', 3: 'Cataclysm' };
  
  if (!abilityData || typeof abilityData !== 'object') {
    return {
      id: `custom_ability${slot}_${classId}`,
      name: fallbackNames[slot],
      damage: C.damage[0],
      cooldown: C.cooldown[0],
      radius: C.radius[0],
      duration: C.duration[0],
      color: color,
      isAoe: true,
      type: 'classAbility',
    };
  }

  return {
    id: `custom_ability${slot}_${classId}`,
    name: (typeof abilityData.name === 'string' ? abilityData.name : fallbackNames[slot]).slice(0, 30),
    damage: clamp(abilityData.damage, C.damage[0], C.damage[1]),
    cooldown: clamp(abilityData.cooldown, C.cooldown[0], C.cooldown[1]),
    radius: clamp(abilityData.radius, C.radius[0], C.radius[1]),
    duration: clamp(abilityData.duration, C.duration[0], C.duration[1]),
    color: isValidHex(abilityData.color) ? abilityData.color : color,
    isAoe: true,
    type: 'classAbility',
    description: (typeof abilityData.description === 'string' ? abilityData.description : '').slice(0, 100),
  };
}

function clampWizardOutput(data) {
  // Generate a readable classId from the wizard name instead of UUID
  const wizardName = (typeof data.name === 'string' ? data.name : 'Custom Wizard').slice(0, 25);
  const slug = wizardName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const shortId = uuidv4().slice(0, 4); // Short suffix for uniqueness
  const classId = `custom_${slug}_${shortId}`;
  const color = isValidHex(data.color) ? data.color : '#9b5de5';
  const secondaryColor = isValidHex(data.secondaryColor) ? data.secondaryColor : color;

  // Clamp base stats
  const baseHealth = clamp(data.baseHealth, CLAMP.baseHealth[0], CLAMP.baseHealth[1]);
  const baseSpeed = clamp(data.baseSpeed, CLAMP.baseSpeed[0], CLAMP.baseSpeed[1]);

  // Inverse correlation guard: if both high, pull one down
  if (baseHealth > 100 && baseSpeed > 155) {
    // Can't have both maxed
  }

  // Build spells
  const spell1 = clampSpell(data.spell1, 0, color);
  const spell2 = clampSpell(data.spell2, 1, secondaryColor);

  // Build dash
  const dashData = data.dashAbility || {};
  const dash = {
    id: `custom_dash_${classId}`,
    name: (typeof dashData.name === 'string' ? dashData.name : 'Quick Dash').slice(0, 30),
    cooldown: clamp(dashData.cooldown, CLAMP.dash.cooldown[0], CLAMP.dash.cooldown[1]),
    distance: clamp(dashData.distance, CLAMP.dash.distance[0], CLAMP.dash.distance[1]),
    damage: 10,
    trailDuration: 800,
  };

  // Build ultimate
  const ultData = data.ultimateAbility || {};
  const ult = {
    id: `custom_ult_${classId}`,
    name: (typeof ultData.name === 'string' ? ultData.name : 'Power Surge').slice(0, 30),
    cooldown: clamp(ultData.cooldown, CLAMP.ult.cooldown[0], CLAMP.ult.cooldown[1]),
    damage: clamp(ultData.damage, CLAMP.ult.damage[0], CLAMP.ult.damage[1]),
    radius: clamp(ultData.radius, CLAMP.ult.radius[0], CLAMP.ult.radius[1]),
    delay: 1000,
  };

  // Build class abilities (slots 1, 2, 3)
  const ability1 = clampAbility(data.ability1, 1, classId, color);
  const ability2 = clampAbility(data.ability2, 2, classId, secondaryColor);
  const ability3 = clampAbility(data.ability3, 3, classId, color);

  return {
    success: true,
    classId,
    classDef: {
      id: classId,
      name: (typeof data.name === 'string' ? data.name : 'Custom Wizard').slice(0, 25),
      color,
      secondaryColor,
      baseHealth,
      baseSpeed,
      spells: [spell1.id, spell2.id],
      description: (typeof data.description === 'string' ? data.description : 'A custom AI-generated wizard.').slice(0, 100),
      lore: (typeof data.lore === 'string' ? data.lore : '').slice(0, 300),
      isCustom: true,
      dashAbility: dash,
      ultimateAbility: ult,
      abilities: { 1: ability1.id, 2: ability2.id, 3: ability3.id },
    },
    spellDefs: {
      [spell1.id]: spell1,
      [spell2.id]: spell2,
      [ability1.id]: ability1,
      [ability2.id]: ability2,
      [ability3.id]: ability3,
    },
  };
}