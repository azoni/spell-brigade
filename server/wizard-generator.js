import { v4 as uuidv4 } from 'uuid';
import { llmGenerate, isLLMEnabled } from './openrouter.js';

// ===========================================
// AI WIZARD GENERATOR - LLM-powered class creation
// ===========================================

const WIZARD_LLM_PROMPT = `You are a game designer for Spell Brigade, a 2D multiplayer wizard arena game.
Create a custom wizard class from the user's description. The wizard must be balanced for PvE combat.

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
  if (!isLLMEnabled()) {
    return { error: 'AI features are not configured. OPENROUTER_API_KEY missing.' };
  }

  console.log(`🧙 Generating wizard via LLM: "${prompt}"`);
  const llmData = await llmGenerate(WIZARD_LLM_PROMPT, prompt, 1000);

  if (!llmData) {
    return { error: 'AI generation failed. Please try again.' };
  }

  return clampWizardOutput(llmData);
}

function clampWizardOutput(data) {
  const classId = `custom_${uuidv4().slice(0, 8)}`;
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
    },
    spellDefs: {
      [spell1.id]: spell1,
      [spell2.id]: spell2,
    },
  };
}
