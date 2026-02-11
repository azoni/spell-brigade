import { v4 as uuidv4 } from 'uuid';
import { llmGenerate, isLLMEnabled } from './openrouter.js';

// ===========================================
// AI WIZARD GENERATOR - Claude-powered class creation
// ===========================================

const WIZARD_SYSTEM_PROMPT = `You are the lead game designer for Spell Brigade, a 2D top-down multiplayer wizard arena.
Players roam zones killing monsters, leveling up, and unlocking abilities.

Your job: turn a player's wizard concept into a fully realized, balanced, FUN class — like it was hand-designed.

## CRITICAL: HONOR THE PLAYER'S VISION
The player might describe ANYTHING — a lightning samurai, a giraffe that throws chairs, a pizza wizard, a cosmic horror squid, a robot made of bees. YOUR JOB is to make it WORK as a playable class. Be WILDLY creative with spell names and descriptions while keeping the numbers balanced.

Examples of good adaptation:
- "giraffe that throws chairs" → "Chair Giraffe" class with spells like "Folding Chair Fling" (projectile), "Table Flip" (AOE), "Neck Whip" (dash)
- "pizza wizard" → "Slice Mage" with "Pepperoni Bolt", "Cheese Flood" (AOE slow), "Delivery Dash"
- "darkness edgelord" → "Abyssal Reaper" with "Shadow Rend", "Void Collapse", "Death's Door"

The spell NAMES and DESCRIPTIONS must directly reference the player's concept. Generic names like "Energy Bolt" or "Power Strike" are FORBIDDEN — every spell must feel unique to what the player described.

## HOW COMBAT WORKS
- 2 base spells auto-fire at nearest enemy (left-click primary, right-click secondary)
- 3 class abilities unlock at levels 10, 20, 30 (hotkeys 1/2/3)
- 1 dash ability (Shift) — movement/escape
- 1 ultimate ability (Q) — big cooldown, big impact
- Spells: PROJECTILE (travels toward target) or AOE (instant area damage, speed=0)

## REAL CLASSES FOR BALANCE REFERENCE

Pyromancer (glass cannon): HP 80, Speed 195
  Primary: Fireball — 28dmg, 900ms cd, range 320, speed 450, radius 12
  Secondary: Flame Wave — 18dmg AOE, 1500ms cd, radius 120
  Lv10: Flame Shield — 15dmg, 12s cd, radius 80
  Lv20: Meteor Strike — 80dmg, 18s cd, radius 100
  Lv30: Inferno — 150dmg, 45s cd, radius 250
  Dash: Fire Dash — 4s cd, 200 distance, trail damage
  Ult: Meteor — 100dmg, 20s cd, radius 150

Cryomancer (control): HP 90, Speed 185
  Primary: Frost Bolt — 18dmg, 500ms cd, speed 550, SLOW 50%/1.5s
  Secondary: Blizzard — 12dmg AOE, 2500ms cd, radius 150, SLOW 30%
  Dash: Frost Step — 5s cd, 180 dist, freeze on arrival (2s, 60 radius)
  Ult: Ice Nova — 50dmg, 25s cd, radius 200, freeze 3s

Void Lord (dark powerhouse): HP 95, Speed 190
  Primary: Void Bolt — 30dmg, 700ms cd, speed 500, PIERCING
  Secondary: Annihilate — 45dmg AOE, 2500ms cd, radius 120
  Lv10: Void Rift — 30dmg, 10s cd, radius 100, duration 3s
  Lv20: Soul Drain — 40dmg, 14s cd, HOMING, LIFESTEAL 30%
  Lv30: Apocalypse — 120dmg, 45s cd, radius 250
  Dash: Void Shift — 5s cd, 200 dist, INVULNERABLE, 25dmg on arrival
  Ult: Void Rift — 80dmg, 22s cd, radius 200, pull enemies

Shadow Archer (fragile sniper): HP 75, Speed 200
  Primary: Shadow Arrow — 26dmg, 550ms cd, speed 800, range 500, PIERCING
  Secondary: Piercing Volley — 45dmg AOE, 2000ms cd, radius 160
  Dash: Shadow Step — 5s cd, 220 dist, invulnerable, 20dmg on arrival
  Ult: Arrow Storm — 70dmg, 22s cd, radius 250, 5 waves

## DESIGN PHILOSOPHY
1. HONOR THE PLAYER'S VISION — if they say "giraffe that throws chairs", EVERY spell must reference giraffes and chairs
2. Each class needs a CLEAR IDENTITY — what makes it unique? Speed? Control? Burst? Sustain?
3. Spells should SYNERGIZE — e.g. slow from spell1 helps spell2 land
4. Balance: high damage = high cooldown, high HP = lower speed, fast attacks = lower per-hit damage
5. Primary DPS (damage/cooldown*1000) should be 25-45 range
6. Colors MUST match the theme — pick colors that FIT the concept (giraffe=amber/brown, pizza=red/yellow, cosmic=purple/teal)
7. Abilities SCALE: Lv10 is utility/moderate, Lv20 is strong, Lv30 is devastating
8. Special effects (slow/piercing/homing) used sparingly — max 1-2 per class
9. Dash should match theme (fire=flame trail, shadow=teleport, giraffe=long stride, robot=jet boost)
10. Names should be evocative AND thematic — "Folding Chair Fling" not "Chair Attack", "Pepperoni Bolt" not "Food Projectile"
11. Lore should be 1-2 sentences explaining the class's backstory in a fun way
12. The description should be a catchy one-liner that sells the class fantasy
13. IMPORTANT: Every ability description MUST specifically say what happens visually and mechanically — "Summons a ring of fire that burns enemies in a wide area" not just "Deals AOE fire damage". Players READ these in their skill bar, so make them vivid and match the theme exactly.

## OUTPUT — RESPOND WITH ONLY THIS JSON, NO MARKDOWN, NO EXPLANATION:
{
  "name": "2-3 word class name",
  "description": "One-line class pitch",
  "color": "#hex primary",
  "secondaryColor": "#hex accent",
  "baseHealth": 75-110,
  "baseSpeed": 170-200,
  "lore": "2-3 sentence backstory",
  "spell1": {
    "name": "Primary name", "type": "projectile",
    "damage": 18-35, "cooldown": 400-1200, "range": 250-500,
    "radius": 6-16, "speed": 350-800,
    "color": "#hex", "trailColor": "#hex",
    "description": "What it does",
    "specialEffect": "none|slow|piercing|homing"
  },
  "spell2": {
    "name": "Secondary name", "type": "projectile|aoe",
    "damage": 12-50, "cooldown": 1200-3000, "range": 150-400,
    "radius": "8-16 projectile OR 80-180 aoe",
    "speed": "350-700 projectile OR 0 aoe",
    "color": "#hex", "trailColor": "#hex if projectile",
    "description": "What it does",
    "specialEffect": "none|slow|piercing|homing"
  },
  "ability1": {
    "name": "Lv10 ability", "type": "aoe",
    "damage": 15-40, "cooldown": 8000-14000,
    "radius": 80-160, "duration": 2000-5000,
    "description": "What it does"
  },
  "ability2": {
    "name": "Lv20 ability", "type": "aoe",
    "damage": 40-80, "cooldown": 14000-20000,
    "radius": 100-200, "duration": 2000-5000,
    "description": "What it does"
  },
  "ability3": {
    "name": "Lv30 ability (devastating)", "type": "aoe",
    "damage": 100-160, "cooldown": 35000-50000,
    "radius": 180-280, "duration": 3000-8000,
    "description": "What it does"
  },
  "dashAbility": {
    "name": "Dash name", "cooldown": 3000-6000,
    "distance": 160-250, "description": "Thematic dash"
  },
  "ultimateAbility": {
    "name": "Ultimate name", "cooldown": 18000-28000,
    "damage": 60-120, "radius": 140-250,
    "description": "What the ult does"
  },
  "iconStyle": "skull|flame|crystal|moon|bolt|leaf|shield|eye|sword|spiral|wave|star",
  "bodyStyle": "wizard|warrior|archer|hulk|beast|elemental|creature",
  "projectileShape": "orb|bolt|thrown|shard|wisp|arrow",
  "headgear": "pointyHat|hood|helmet|crown|horns|none|antlers|halo|ears"
}

AVATAR VISUAL RULES:
- bodyStyle determines the character's silhouette on screen. MATCH IT to the concept:
  "wizard" = classic robed mage (default), "warrior" = armored fighter, "archer" = slim + hooded,
  "hulk" = massive muscular body (ogres, giants, brutes), "beast" = animal/furry body,
  "elemental" = pure energy being (no solid form), "creature" = alien/tentacled/weird
- projectileShape determines what the auto-attack looks like:
  "orb" = glowing sphere, "bolt" = elongated energy, "thrown" = spinning object (pizza, chair, dumbbell),
  "shard" = angular crystal, "wisp" = ghostly trail, "arrow" = pointed triangular
- headgear: pick what fits. Giraffe? "none" or "horns". Knight? "helmet". Wizard? "pointyHat". Beast? "ears"
- Examples: pizza wizard → bodyStyle:"wizard", projectileShape:"thrown", headgear:"pointyHat"
  lightning samurai → bodyStyle:"warrior", projectileShape:"bolt", headgear:"helmet"
  cosmic horror squid → bodyStyle:"creature", projectileShape:"wisp", headgear:"none"
  robot made of bees → bodyStyle:"creature", projectileShape:"thrown", headgear:"none"
  shadow assassin → bodyStyle:"archer", projectileShape:"bolt", headgear:"hood"
  rage ogre → bodyStyle:"hulk", projectileShape:"thrown", headgear:"horns"`;

// Stat clamping
const CLAMP = {
  baseHealth: [75, 110],
  baseSpeed: [165, 205],
  spell: {
    damage: [12, 55],
    cooldown: [350, 3500],
    range: [150, 550],
    speed: [0, 900],
    radiusProjectile: [5, 18],
    radiusAoe: [80, 220],
  },
  dash: { cooldown: [3000, 7000], distance: [140, 280] },
  ult: { cooldown: [15000, 30000], damage: [40, 130], radius: [140, 280] },
  ability: {
    1: { damage: [15, 50], cooldown: [8000, 15000], radius: [100, 200], duration: [2000, 6000] },
    2: { damage: [30, 90], cooldown: [12000, 22000], radius: [130, 240], duration: [2000, 5000] },
    3: { damage: [80, 170], cooldown: [28000, 55000], radius: [180, 320], duration: [3000, 8000] },
  },
};

// Valid icon styles that match client WIZARD_ICONS
const VALID_ICON_STYLES = ['skull', 'flame', 'crystal', 'moon', 'bolt', 'leaf', 'shield', 'eye', 'sword', 'spiral', 'wave', 'star'];
const VALID_BODY_STYLES = ['wizard', 'warrior', 'archer', 'hulk', 'beast', 'elemental', 'creature'];
const VALID_PROJECTILE_SHAPES = ['orb', 'bolt', 'thrown', 'shard', 'wisp', 'arrow'];
const VALID_HEADGEAR = ['pointyHat', 'hood', 'helmet', 'crown', 'horns', 'none', 'antlers', 'halo', 'ears'];

// Auto-pick icon based on class theme if LLM didn't provide one
function pickIconStyle(data) {
  const text = `${data.name || ''} ${data.description || ''} ${data.lore || ''}`.toLowerCase();
  if (/death|necro|skull|bone|undead|lich|dark|doom|skeleton/.test(text)) return 'skull';
  if (/fire|flame|pyro|ember|burn|lava|magma|inferno|phoenix/.test(text)) return 'flame';
  if (/ice|frost|crystal|gem|diamond|prism|glass|shard/.test(text)) return 'crystal';
  if (/moon|lunar|night|shadow|dream|twilight|eclipse/.test(text)) return 'moon';
  if (/lightning|thunder|storm|electric|bolt|shock|tempest/.test(text)) return 'bolt';
  if (/nature|leaf|tree|vine|thorn|forest|druid|plant|root/.test(text)) return 'leaf';
  if (/shield|armor|protect|guard|paladin|holy|divine|radiant/.test(text)) return 'shield';
  if (/eye|see|vision|mind|psychic|illusion|all.?seeing/.test(text)) return 'eye';
  if (/sword|blade|warrior|knight|slash|samurai|steel/.test(text)) return 'sword';
  if (/time|chrono|spiral|portal|rift|void|warp|dimension/.test(text)) return 'spiral';
  if (/water|ocean|wave|tide|sea|aqua|flood|rain/.test(text)) return 'wave';
  return 'star'; // default
}

function pickBodyStyle(data) {
  const text = `${data.name || ''} ${data.description || ''} ${data.lore || ''}`.toLowerCase();
  if (/hulk|brute|ogre|giant|golem|titan|colossus|troll|orc|muscle|buff|rage/.test(text)) return 'hulk';
  if (/archer|ranger|sniper|hunter|assassin|rogue|thief|ninja|shadow/.test(text)) return 'archer';
  if (/warrior|knight|paladin|samurai|gladiator|fighter|soldier|guard|swords/.test(text)) return 'warrior';
  if (/beast|animal|wolf|bear|cat|dragon|giraffe|dog|lion|tiger|fox|deer/.test(text)) return 'beast';
  if (/elemental|spirit|energy|wisp|ghost|phantom|spectral|ethereal|cosmic|astral/.test(text)) return 'elemental';
  if (/creature|tentacle|squid|alien|horror|aberration|bug|insect|robot|bee|spider/.test(text)) return 'creature';
  return 'wizard';
}

function pickProjectileShape(data) {
  const text = `${data.name || ''} ${data.description || ''} ${data.spell1?.name || ''}`.toLowerCase();
  if (/throw|fling|hurl|toss|pizza|chair|rock|bomb|grenade|object|dumbbell/.test(text)) return 'thrown';
  if (/arrow|dart|spike|needle|javelin|spear|lance/.test(text)) return 'arrow';
  if (/bolt|beam|ray|laser|lightning|zap|shock|strike/.test(text)) return 'bolt';
  if (/shard|crystal|gem|ice|frost|prism|glass/.test(text)) return 'shard';
  if (/wisp|ghost|spirit|soul|phantom|haunt|ethereal|smoke|mist/.test(text)) return 'wisp';
  return 'orb';
}

function pickHeadgear(data) {
  const text = `${data.name || ''} ${data.description || ''} ${data.lore || ''}`.toLowerCase();
  if (/beast|animal|wolf|bear|cat|fox|bunny|rabbit|dog/.test(text)) return 'ears';
  if (/helmet|knight|warrior|paladin|soldier|gladiator|samurai/.test(text)) return 'helmet';
  if (/hood|rogue|assassin|thief|shadow|ranger|ninja|archer/.test(text)) return 'hood';
  if (/crown|king|queen|royal|noble|prince|princess/.test(text)) return 'crown';
  if (/horn|demon|devil|dragon|bull|ram|goat|minotaur|ogre|oni/.test(text)) return 'horns';
  if (/antler|deer|elk|moose|stag|druid|forest/.test(text)) return 'antlers';
  if (/angel|divine|holy|celestial|seraph/.test(text)) return 'halo';
  if (/robot|golem|elemental|slime|blob|cosmic|tentacle|alien|bug/.test(text)) return 'none';
  return 'pointyHat';
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, typeof val === 'number' ? val : min));
}
function isValidHex(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

function clampSpell(spellData, index, classColor) {
  if (!spellData || typeof spellData !== 'object') {
    return index === 0 ? {
      id: `custom_spell_${uuidv4().slice(0, 8)}`,
      name: 'Energy Bolt', damage: 25, cooldown: 800, range: 300, speed: 500, radius: 10,
      color: classColor, trailColor: classColor,
    } : {
      id: `custom_spell_${uuidv4().slice(0, 8)}`,
      name: 'Energy Wave', damage: 20, cooldown: 2000, range: 200, speed: 0, radius: 120,
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
    description: (typeof spellData.description === 'string' ? spellData.description : '').slice(0, 100),
  };

  if (isAoe) {
    spell.isAoe = true;
  } else {
    spell.trailColor = isValidHex(spellData.trailColor) ? spellData.trailColor : spell.color;
  }

  if (spellData.specialEffect === 'slow') { spell.slowEffect = 0.5; spell.slowDuration = 1500; }
  else if (spellData.specialEffect === 'piercing') { spell.piercing = true; }
  else if (spellData.specialEffect === 'homing') { spell.homing = true; }

  // DPS guard
  const dps = (spell.damage / spell.cooldown) * 1000;
  if (dps > 55) { spell.cooldown = Math.round((spell.damage / 50) * 1000); }

  return spell;
}

function clampAbility(abilityData, slot, classId, color) {
  const C = CLAMP.ability[slot];
  const fallbackNames = { 1: 'Power Strike', 2: 'Energy Burst', 3: 'Cataclysm' };
  // Each slot gets a distinct execution style
  const styles = { 1: 'burst', 2: 'targeted', 3: 'sustained' };
  
  if (!abilityData || typeof abilityData !== 'object') {
    return {
      id: `custom_ability${slot}_${classId}`, name: fallbackNames[slot],
      damage: C.damage[0], cooldown: C.cooldown[0], radius: C.radius[0], duration: C.duration[0],
      color, isAoe: true, type: 'classAbility', style: styles[slot],
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
    isAoe: true, type: 'classAbility', style: styles[slot],
    description: (typeof abilityData.description === 'string' ? abilityData.description : '').slice(0, 100),
  };
}

function clampWizardOutput(data) {
  const wizardName = (typeof data.name === 'string' ? data.name : 'Custom Wizard').slice(0, 25);
  const slug = wizardName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const classId = `custom_${slug}_${uuidv4().slice(0, 4)}`;
  const color = isValidHex(data.color) ? data.color : '#9b5de5';
  const secondaryColor = isValidHex(data.secondaryColor) ? data.secondaryColor : color;

  const baseHealth = clamp(data.baseHealth, CLAMP.baseHealth[0], CLAMP.baseHealth[1]);
  const baseSpeed = clamp(data.baseSpeed, CLAMP.baseSpeed[0], CLAMP.baseSpeed[1]);

  const spell1 = clampSpell(data.spell1, 0, color);
  const spell2 = clampSpell(data.spell2, 1, secondaryColor);

  const dashData = data.dashAbility || {};
  const dash = {
    id: `custom_dash_${classId}`,
    name: (typeof dashData.name === 'string' ? dashData.name : 'Quick Dash').slice(0, 30),
    description: (typeof dashData.description === 'string' ? dashData.description : 'Dash forward with elemental energy.').slice(0, 100),
    cooldown: clamp(dashData.cooldown, CLAMP.dash.cooldown[0], CLAMP.dash.cooldown[1]),
    distance: clamp(dashData.distance, CLAMP.dash.distance[0], CLAMP.dash.distance[1]),
    damage: 10, trailDuration: 800,
  };

  const ultData = data.ultimateAbility || {};
  const ult = {
    id: `custom_ult_${classId}`,
    name: (typeof ultData.name === 'string' ? ultData.name : 'Power Surge').slice(0, 30),
    description: (typeof ultData.description === 'string' ? ultData.description : 'Unleash devastating elemental power.').slice(0, 100),
    cooldown: clamp(ultData.cooldown, CLAMP.ult.cooldown[0], CLAMP.ult.cooldown[1]),
    damage: clamp(ultData.damage, CLAMP.ult.damage[0], CLAMP.ult.damage[1]),
    radius: clamp(ultData.radius, CLAMP.ult.radius[0], CLAMP.ult.radius[1]),
    delay: 1000,
  };

  const ability1 = clampAbility(data.ability1, 1, classId, color);
  const ability2 = clampAbility(data.ability2, 2, classId, secondaryColor);
  const ability3 = clampAbility(data.ability3, 3, classId, color);

  return {
    success: true,
    classId,
    classDef: {
      id: classId,
      name: wizardName,
      color, secondaryColor, baseHealth, baseSpeed,
      spells: [spell1.id, spell2.id],
      description: (typeof data.description === 'string' ? data.description : 'A custom AI-generated wizard.').slice(0, 100),
      lore: (typeof data.lore === 'string' ? data.lore : '').slice(0, 300),
      iconStyle: VALID_ICON_STYLES.includes(data.iconStyle) ? data.iconStyle : pickIconStyle(data),
      bodyStyle: VALID_BODY_STYLES.includes(data.bodyStyle) ? data.bodyStyle : pickBodyStyle(data),
      projectileShape: VALID_PROJECTILE_SHAPES.includes(data.projectileShape) ? data.projectileShape : pickProjectileShape(data),
      headgear: VALID_HEADGEAR.includes(data.headgear) ? data.headgear : pickHeadgear(data),
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

// ===========================================
// MAIN ENTRY POINT
// ===========================================
export async function generateWizard(prompt, quality = 'premium') {
  if (isLLMEnabled()) {
    console.log(`🧙 Generating wizard via LLM (${quality}): "${prompt}"`);
    const llmData = await llmGenerate(
      WIZARD_SYSTEM_PROMPT,
      `Create a wizard class based on this player concept:\n\n"${prompt}"\n\nRespond with ONLY the JSON. No markdown fences, no explanation.`,
      1500,
      quality
    );
    if (llmData) {
      console.log(`🧙 LLM returned: "${llmData.name}"`);
      const result = clampWizardOutput(llmData);
      result.generatedBy = 'ai';
      result.modelUsed = quality;
      return result;
    }
    console.warn('LLM generation failed, falling back to templates');
  } else {
    console.log('🧙 No API key configured — using template fallback');
  }

  console.log(`🧙 Template fallback: "${prompt}"`);
  const result = generateFromTemplate(prompt);
  result.generatedBy = 'template';
  return result;
}

// ===========================================
// TEMPLATE FALLBACK (no LLM needed)
// ===========================================
const TEMPLATES = [
  {
    keywords: ['fire', 'flame', 'pyro', 'ember', 'burn', 'inferno', 'lava', 'magma', 'blaze', 'heat', 'scorch', 'phoenix'],
    name: 'Ember Warlock', color: '#ff4500', secondaryColor: '#ffd700',
    description: 'A warlock who channels destructive fire magic.',
    lore: 'Trained in volcanic forges, Ember Warlocks harness primordial flame to reduce enemies to ash.',
    spell1: { name: 'Flame Lance', type: 'projectile', damage: 30, cooldown: 900, range: 320, speed: 550, radius: 10, color: '#ff4500', trailColor: '#ffd700', specialEffect: 'none', description: 'A searing lance of fire' },
    spell2: { name: 'Inferno Ring', type: 'aoe', damage: 22, cooldown: 2200, range: 200, speed: 0, radius: 130, color: '#ff6600', specialEffect: 'none', description: 'Ring of fire erupts around you' },
    ability1: { name: 'Pyroclasm', type: 'aoe', damage: 35, cooldown: 10000, radius: 120, duration: 2500, description: 'Volcanic eruption at your feet' },
    ability2: { name: 'Molten Armor', type: 'aoe', damage: 55, cooldown: 16000, radius: 150, duration: 4000, description: 'Coat yourself in magma, burning nearby enemies' },
    ability3: { name: 'Firestorm', type: 'aoe', damage: 130, cooldown: 42000, radius: 240, duration: 5000, description: 'Rain fire from the sky, devastating everything' },
    dash: { name: 'Flame Dash', description: 'Dash forward trailing fire.', cooldown: 4000, distance: 200 },
    ult: { name: 'Phoenix Burst', description: 'Erupt in a phoenix-shaped explosion.', cooldown: 22000, damage: 90, radius: 180 },
    baseHealth: 85, baseSpeed: 190,
  },
  {
    keywords: ['ice', 'frost', 'cold', 'freeze', 'snow', 'blizzard', 'cryo', 'winter', 'glacier', 'chill', 'frozen'],
    name: 'Frostweaver', color: '#00d4ff', secondaryColor: '#e0f7ff',
    description: 'A mage who weaves freezing enchantments to slow and shatter foes.',
    lore: 'Born in the eternal winter wastes, Frostweavers command ice with surgical precision.',
    spell1: { name: 'Ice Shard', type: 'projectile', damage: 20, cooldown: 600, range: 300, speed: 600, radius: 9, color: '#00d4ff', trailColor: '#e0f7ff', specialEffect: 'slow', description: 'Razor-sharp ice that slows on hit' },
    spell2: { name: 'Glacial Burst', type: 'aoe', damage: 16, cooldown: 2000, range: 200, speed: 0, radius: 140, color: '#88e0ff', specialEffect: 'slow', description: 'Freezing explosion around you' },
    ability1: { name: 'Frozen Spike', type: 'aoe', damage: 30, cooldown: 9000, radius: 100, duration: 2000, description: 'Summon a massive ice spike' },
    ability2: { name: 'Permafrost', type: 'aoe', damage: 55, cooldown: 16000, radius: 160, duration: 3500, description: 'Freeze the ground, trapping enemies' },
    ability3: { name: 'Absolute Zero', type: 'aoe', damage: 120, cooldown: 40000, radius: 220, duration: 6000, description: 'Drop temperature to absolute zero' },
    dash: { name: 'Ice Slide', description: 'Glide on ice leaving a frozen trail.', cooldown: 3500, distance: 200 },
    ult: { name: 'Blizzard Wrath', description: 'Summon a devastating blizzard.', cooldown: 20000, damage: 75, radius: 200 },
    baseHealth: 92, baseSpeed: 182,
  },
  {
    keywords: ['dark', 'shadow', 'void', 'death', 'necro', 'undead', 'curse', 'doom', 'lich', 'corrupt', 'evil', 'demon'],
    name: 'Doomcaller', color: '#8b00ff', secondaryColor: '#cc66ff',
    description: 'A dark sorcerer who draws power from the void.',
    lore: 'Doomcallers peer into the abyss and channel its entropy to corrupt everything they touch.',
    spell1: { name: 'Void Bolt', type: 'projectile', damage: 28, cooldown: 850, range: 280, speed: 520, radius: 11, color: '#8b00ff', trailColor: '#cc66ff', specialEffect: 'none', description: 'A bolt of pure void energy' },
    spell2: { name: 'Shadow Pool', type: 'aoe', damage: 20, cooldown: 2400, range: 220, speed: 0, radius: 120, color: '#6600cc', specialEffect: 'slow', description: 'Pool of darkness that slows enemies' },
    ability1: { name: 'Soul Rend', type: 'aoe', damage: 35, cooldown: 10000, radius: 110, duration: 2000, description: 'Rip the soul from nearby enemies' },
    ability2: { name: 'Void Eruption', type: 'aoe', damage: 60, cooldown: 16000, radius: 170, duration: 3000, description: 'The void erupts in a devastating blast' },
    ability3: { name: 'Eclipse', type: 'aoe', damage: 130, cooldown: 42000, radius: 250, duration: 5000, description: 'Plunge the area into total darkness' },
    dash: { name: 'Shadow Step', description: 'Vanish into shadow, reappear ahead.', cooldown: 4500, distance: 220 },
    ult: { name: 'Abyssal Rift', description: 'Tear open a rift to the abyss.', cooldown: 24000, damage: 100, radius: 190 },
    baseHealth: 88, baseSpeed: 186,
  },
  {
    keywords: ['light', 'holy', 'divine', 'heal', 'angel', 'radiant', 'sun', 'solar', 'celestial', 'pure', 'paladin', 'priest'],
    name: 'Radiant Cleric', color: '#ffd700', secondaryColor: '#fffacd',
    description: 'A divine channeler wielding searing holy light.',
    lore: 'Blessed by celestial forces, Radiant Clerics smite darkness with purifying radiance.',
    spell1: { name: 'Holy Lance', type: 'projectile', damage: 26, cooldown: 800, range: 310, speed: 580, radius: 10, color: '#ffd700', trailColor: '#fffacd', specialEffect: 'none', description: 'A spear of divine light' },
    spell2: { name: 'Sanctify', type: 'aoe', damage: 18, cooldown: 2000, range: 200, speed: 0, radius: 135, color: '#ffee88', specialEffect: 'none', description: 'Purifying burst of holy energy' },
    ability1: { name: 'Smite', type: 'aoe', damage: 32, cooldown: 9000, radius: 100, duration: 2000, description: 'Channel divine wrath' },
    ability2: { name: 'Divine Judgment', type: 'aoe', damage: 58, cooldown: 16000, radius: 160, duration: 3500, description: 'Judge the unworthy with holy fire' },
    ability3: { name: 'Solar Flare', type: 'aoe', damage: 125, cooldown: 42000, radius: 240, duration: 4500, description: 'Unleash the full power of the sun' },
    dash: { name: 'Flash of Light', description: 'Teleport in a flash of radiance.', cooldown: 3800, distance: 210 },
    ult: { name: 'Celestial Wrath', description: 'Call down divine judgment.', cooldown: 21000, damage: 85, radius: 185 },
    baseHealth: 95, baseSpeed: 178,
  },
  {
    keywords: ['earth', 'stone', 'rock', 'mountain', 'golem', 'geo', 'terra', 'quake', 'boulder', 'tank', 'iron', 'metal'],
    name: 'Stoneshaper', color: '#8b6914', secondaryColor: '#d4a856',
    description: 'A geomancer who commands earth and stone.',
    lore: 'Stoneshapers commune with the earth itself, raising boulders and splitting the ground.',
    spell1: { name: 'Boulder Toss', type: 'projectile', damage: 35, cooldown: 1200, range: 260, speed: 420, radius: 14, color: '#8b6914', trailColor: '#d4a856', specialEffect: 'none', description: 'Hurl a massive boulder' },
    spell2: { name: 'Seismic Slam', type: 'aoe', damage: 25, cooldown: 2500, range: 180, speed: 0, radius: 150, color: '#a0855c', specialEffect: 'slow', description: 'Slam the ground, cracking earth' },
    ability1: { name: 'Rock Wall', type: 'aoe', damage: 28, cooldown: 10000, radius: 130, duration: 3000, description: 'Raise a wall of stone' },
    ability2: { name: 'Tectonic Surge', type: 'aoe', damage: 60, cooldown: 18000, radius: 180, duration: 4000, description: 'Unleash seismic force from below' },
    ability3: { name: 'Earthquake', type: 'aoe', damage: 140, cooldown: 45000, radius: 260, duration: 6000, description: 'Devastating earthquake levels everything' },
    dash: { name: 'Stone Charge', description: 'Charge through earth with rocky force.', cooldown: 5000, distance: 180 },
    ult: { name: 'Mountain Fall', description: 'Drop a massive boulder.', cooldown: 25000, damage: 110, radius: 200 },
    baseHealth: 108, baseSpeed: 172,
  },
  {
    keywords: ['wind', 'air', 'storm', 'lightning', 'thunder', 'tempest', 'gale', 'electric', 'shock', 'bolt', 'samurai', 'speed'],
    name: 'Tempest Mage', color: '#00bfff', secondaryColor: '#e0ffff',
    description: 'A storm wizard who calls down lightning.',
    lore: 'Tempest Mages ride the winds of chaos, striking with devastating electrical storms.',
    spell1: { name: 'Lightning Bolt', type: 'projectile', damage: 24, cooldown: 550, range: 350, speed: 700, radius: 8, color: '#00bfff', trailColor: '#e0ffff', specialEffect: 'none', description: 'A crackling bolt of lightning' },
    spell2: { name: 'Thunder Clap', type: 'aoe', damage: 15, cooldown: 1800, range: 220, speed: 0, radius: 125, color: '#66d9ff', specialEffect: 'none', description: 'Deafening thunder damages all nearby' },
    ability1: { name: 'Chain Lightning', type: 'aoe', damage: 30, cooldown: 9000, radius: 120, duration: 2000, description: 'Lightning arcs between enemies' },
    ability2: { name: 'Cyclone', type: 'aoe', damage: 50, cooldown: 15000, radius: 160, duration: 3500, description: 'Summon a raging cyclone' },
    ability3: { name: 'Supercell', type: 'aoe', damage: 120, cooldown: 40000, radius: 230, duration: 5500, description: 'Unleash a supercell thunderstorm' },
    dash: { name: 'Wind Rush', description: 'Ride a gust of wind.', cooldown: 3000, distance: 240 },
    ult: { name: 'Thunderstrike', description: 'Call down a massive lightning bolt.', cooldown: 18000, damage: 80, radius: 170 },
    baseHealth: 80, baseSpeed: 198,
  },
  {
    keywords: ['nature', 'plant', 'druid', 'forest', 'vine', 'bloom', 'leaf', 'tree', 'wood', 'thorn', 'poison', 'toxic', 'swamp'],
    name: 'Thornweaver', color: '#228b22', secondaryColor: '#90ee90',
    description: 'A druidic mage who summons thorns and toxic flora.',
    lore: 'Thornweavers channel the wild fury of nature, ensnaring foes in brambles.',
    spell1: { name: 'Thorn Spike', type: 'projectile', damage: 22, cooldown: 700, range: 290, speed: 550, radius: 9, color: '#228b22', trailColor: '#90ee90', specialEffect: 'slow', description: 'A venomous thorn that slows' },
    spell2: { name: 'Spore Cloud', type: 'aoe', damage: 14, cooldown: 2100, range: 200, speed: 0, radius: 140, color: '#44bb44', specialEffect: 'slow', description: 'Toxic spore cloud around you' },
    ability1: { name: 'Bramble Trap', type: 'aoe', damage: 25, cooldown: 9000, radius: 120, duration: 3000, description: 'Thorny brambles entangle enemies' },
    ability2: { name: 'Overgrowth', type: 'aoe', damage: 50, cooldown: 16000, radius: 160, duration: 4000, description: 'Nature explodes in wild growth' },
    ability3: { name: 'Wrath of Nature', type: 'aoe', damage: 130, cooldown: 42000, radius: 250, duration: 5500, description: 'Unleash nature\'s full devastation' },
    dash: { name: 'Vine Leap', description: 'Leap forward on a vine.', cooldown: 4000, distance: 210 },
    ult: { name: 'Verdant Storm', description: 'Storm of thorns and vines.', cooldown: 22000, damage: 80, radius: 190 },
    baseHealth: 90, baseSpeed: 184,
  },
  {
    keywords: ['blood', 'vampire', 'drain', 'leech', 'crimson', 'sanguine', 'gore', 'red', 'hemomancer'],
    name: 'Bloodmancer', color: '#8b0000', secondaryColor: '#ff4444',
    description: 'A forbidden mage wielding blood magic.',
    lore: 'Bloodmancers siphon vitality from enemies to fuel their dark power.',
    spell1: { name: 'Blood Bolt', type: 'projectile', damage: 25, cooldown: 750, range: 300, speed: 530, radius: 10, color: '#8b0000', trailColor: '#ff4444', specialEffect: 'none', description: 'A bolt of crystallized blood' },
    spell2: { name: 'Crimson Wave', type: 'aoe', damage: 19, cooldown: 2300, range: 200, speed: 0, radius: 130, color: '#cc0000', specialEffect: 'none', description: 'Wave of blood magic around you' },
    ability1: { name: 'Life Drain', type: 'aoe', damage: 33, cooldown: 10000, radius: 110, duration: 2500, description: 'Drain life from nearby enemies' },
    ability2: { name: 'Blood Nova', type: 'aoe', damage: 55, cooldown: 16000, radius: 170, duration: 3000, description: 'Explosive nova of blood energy' },
    ability3: { name: 'Hemorrhage', type: 'aoe', damage: 125, cooldown: 42000, radius: 240, duration: 5500, description: 'Enemies bleed out violently' },
    dash: { name: 'Blood Rush', description: 'Surge forward fueled by blood.', cooldown: 4200, distance: 210 },
    ult: { name: 'Sanguine Tide', description: 'Wave of blood magic devastates all.', cooldown: 23000, damage: 95, radius: 195 },
    baseHealth: 88, baseSpeed: 186,
  },
  {
    keywords: ['time', 'chrono', 'clock', 'temporal', 'warp', 'haste', 'rewind', 'age', 'hourglass'],
    name: 'Chronomancer', color: '#c4a000', secondaryColor: '#f0e68c',
    description: 'A time-bending mage who warps reality.',
    lore: 'Chronomancers manipulate time itself, aging enemies to dust or rewinding wounds.',
    spell1: { name: 'Time Bolt', type: 'projectile', damage: 22, cooldown: 600, range: 320, speed: 650, radius: 8, color: '#c4a000', trailColor: '#f0e68c', specialEffect: 'slow', description: 'Bolt that slows the target\'s time' },
    spell2: { name: 'Temporal Rift', type: 'aoe', damage: 18, cooldown: 2200, range: 250, speed: 0, radius: 130, color: '#daa520', specialEffect: 'slow', description: 'Rift distorts time around you' },
    ability1: { name: 'Haste Field', type: 'aoe', damage: 20, cooldown: 10000, radius: 100, duration: 4000, description: 'Accelerate time around you' },
    ability2: { name: 'Age Warp', type: 'aoe', damage: 58, cooldown: 16000, radius: 140, duration: 3000, description: 'Age enemies rapidly' },
    ability3: { name: 'Time Stop', type: 'aoe', damage: 110, cooldown: 42000, radius: 220, duration: 4000, description: 'Freeze time, then shatter it' },
    dash: { name: 'Time Skip', description: 'Skip forward through time.', cooldown: 3500, distance: 230 },
    ult: { name: 'Temporal Collapse', description: 'Collapse time around you.', cooldown: 22000, damage: 90, radius: 200 },
    baseHealth: 85, baseSpeed: 192,
  },
  {
    keywords: ['water', 'ocean', 'sea', 'wave', 'tide', 'aqua', 'hydro', 'rain', 'tsunami', 'river'],
    name: 'Tidecaller', color: '#0077be', secondaryColor: '#87ceeb',
    description: 'A hydromancer who commands the fury of the ocean.',
    lore: 'Tidecallers draw power from the depths, summoning crushing waves and whirlpools.',
    spell1: { name: 'Water Bolt', type: 'projectile', damage: 24, cooldown: 700, range: 310, speed: 560, radius: 10, color: '#0077be', trailColor: '#87ceeb', specialEffect: 'slow', description: 'Pressurized water blast' },
    spell2: { name: 'Tidal Surge', type: 'aoe', damage: 17, cooldown: 2000, range: 200, speed: 0, radius: 140, color: '#4da6d9', specialEffect: 'slow', description: 'Wave crashes outward from you' },
    ability1: { name: 'Whirlpool', type: 'aoe', damage: 28, cooldown: 9000, radius: 110, duration: 3000, description: 'Vortex pulls enemies in' },
    ability2: { name: 'Tsunami', type: 'aoe', damage: 55, cooldown: 16000, radius: 170, duration: 3500, description: 'Massive wave crashes through enemies' },
    ability3: { name: 'Maelstrom', type: 'aoe', damage: 120, cooldown: 42000, radius: 240, duration: 5000, description: 'Summon an apocalyptic maelstrom' },
    dash: { name: 'Tidal Dash', description: 'Ride a wave forward.', cooldown: 3800, distance: 210 },
    ult: { name: 'Ocean\'s Wrath', description: 'Crushing deep-sea pressure.', cooldown: 22000, damage: 85, radius: 190 },
    baseHealth: 90, baseSpeed: 185,
  },
];

const DEFAULT_TEMPLATE = {
  name: 'Arcane Sage', color: '#9b5de5', secondaryColor: '#c9a0ff',
  description: 'A versatile wizard of raw arcane energy.',
  lore: 'Arcane Sages study the fundamental forces of magic itself.',
  spell1: { name: 'Arcane Missile', type: 'projectile', damage: 26, cooldown: 800, range: 300, speed: 550, radius: 10, color: '#9b5de5', trailColor: '#c9a0ff', specialEffect: 'none', description: 'A bolt of pure arcane energy' },
  spell2: { name: 'Mana Burst', type: 'aoe', damage: 18, cooldown: 2000, range: 200, speed: 0, radius: 130, color: '#b388ff', specialEffect: 'none', description: 'Arcane energy explodes outward' },
  ability1: { name: 'Arcane Barrage', type: 'aoe', damage: 32, cooldown: 10000, radius: 120, duration: 2500, description: 'Rapid barrage of arcane bolts' },
  ability2: { name: 'Mana Storm', type: 'aoe', damage: 55, cooldown: 16000, radius: 160, duration: 3500, description: 'Storm of raw arcane power' },
  ability3: { name: 'Arcane Annihilation', type: 'aoe', damage: 125, cooldown: 42000, radius: 240, duration: 5000, description: 'Total arcane devastation' },
  dash: { name: 'Blink', description: 'Teleport a short distance.', cooldown: 4000, distance: 220 },
  ult: { name: 'Arcane Nova', description: 'Detonate pure arcane energy.', cooldown: 22000, damage: 85, radius: 185 },
  baseHealth: 90, baseSpeed: 184,
};

function generateFromTemplate(prompt) {
  const lower = prompt.toLowerCase();
  
  let bestTemplate = null;
  let bestScore = 0;
  for (const t of TEMPLATES) {
    const score = t.keywords.filter(kw => lower.includes(kw)).length;
    if (score > bestScore) { bestScore = score; bestTemplate = t; }
  }
  if (!bestTemplate) bestTemplate = DEFAULT_TEMPLATE;
  
  const v = () => 0.96 + Math.random() * 0.1;
  
  // Try to extract custom name from prompt
  const words = prompt.trim().split(/\s+/).filter(w => w.length >= 3 && !['the','and','who','with','that','from'].includes(w.toLowerCase()));
  let customName = bestTemplate.name;
  if (words.length >= 2) {
    customName = words.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ').slice(0, 25);
  }
  
  return clampWizardOutput({
    name: customName,
    description: bestTemplate.description,
    color: bestTemplate.color,
    secondaryColor: bestTemplate.secondaryColor,
    baseHealth: Math.round(bestTemplate.baseHealth * v()),
    baseSpeed: Math.round(bestTemplate.baseSpeed * v()),
    lore: bestTemplate.lore,
    spell1: { ...bestTemplate.spell1, damage: Math.round(bestTemplate.spell1.damage * v()) },
    spell2: { ...bestTemplate.spell2, damage: Math.round(bestTemplate.spell2.damage * v()) },
    ability1: { ...bestTemplate.ability1, damage: Math.round(bestTemplate.ability1.damage * v()) },
    ability2: { ...bestTemplate.ability2, damage: Math.round(bestTemplate.ability2.damage * v()) },
    ability3: { ...bestTemplate.ability3, damage: Math.round(bestTemplate.ability3.damage * v()) },
    dashAbility: bestTemplate.dash,
    ultimateAbility: bestTemplate.ult,
  });
}
