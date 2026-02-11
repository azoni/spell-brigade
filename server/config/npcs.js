// ===========================================
// NPCs
// ===========================================

export const NPCS = {
  ethereal_guide: {
    id: 'ethereal_guide',
    name: 'Ethereal Guide',
    type: 'guide',
    x: 10000, y: 8200,
    radius: 20,
    zone: 'sanctuary',
    color: '#67e8f9',
    interactRange: 80,
    stationary: true,
    greetings: [
      "Welcome, traveler. The realm awaits your courage.",
      "Ah, another brave soul. May the arcane guide your path.",
      "Greetings, wizard. The sanctuary protects all who seek refuge.",
      "The world beyond grows dark. Prepare yourself well.",
      "I have watched countless heroes pass through. Will you be different?",
      "The healing fountain at the center restores your strength. Use it wisely.",
      "The portal hub will take you to any zone. But beware - some require great power.",
    ],
  },
  quest_master: {
    id: 'quest_master',
    name: 'Quest Master Seraphina',
    type: 'quest_master',
    x: 9800, y: 8800,
    radius: 18,
    zone: 'sanctuary',
    color: '#ffd93d',
    interactRange: 80,
    stationary: true,
    dialogues: {
      initial: [
        "Greetings, young wizard. I am Seraphina, keeper of quests.",
        "The realm is threatened by powerful bosses in each zone.",
        "Only by defeating them all can peace be restored.",
      ],
      questOffer: [
        "I have a task for you, if you're brave enough.",
        "Six mighty bosses terrorize the lands: the Blossom Behemoth in the Meadow,",
        "the Ancient Treant in the Forest, the Magma Titan in the Volcanic Wastes,",
        "the Frost Wyrm in the Frozen Expanse, the Crystal Golem in the Crystal Caves,",
        "and the Void Overlord in the Abyss.",
        "Defeat them all, and you shall be known as Champion of the Realm!",
      ],
      questActive: "Your quest continues. Check your quest log to see your progress.",
      questComplete: "Incredible! You have defeated all the bosses! You are truly a Champion!",
      prompt: "Will you accept this quest?",
    },
    quest: {
      id: 'allBosses',
      name: 'Champion of the Realm',
      description: 'Defeat all 6 zone bosses to prove your worth.',
      reward: { xp: 5000, title: 'Champion' },
    },
  },
  knight_commander: {
    id: 'knight_commander',
    name: 'Knight Commander Aldric',
    type: 'knight',
    x: 11200, y: 9400,
    radius: 18,
    zone: 'sanctuary',
    color: '#a8a29e',
    interactRange: 80,
    stationary: true, // Stands guard near southeast
    dialogues: {
      initial: [
        "Halt, wizard. I am Knight Commander Aldric.",
        "I guard the passage to the Dragon's Gauntlet - a dungeon of unspeakable danger.",
        "Many have entered. Few have returned.",
      ],
      warning: [
        "You seek to challenge the Infernal Dragon?",
        "I would advise reaching at least level 30 before attempting such folly.",
        "The creatures within grow stronger the deeper you venture.",
        "At the end awaits the dragon itself... a beast of nightmares.",
      ],
      prompt: "Do you wish to enter the Dragon's Gauntlet?",
      tooWeak: "You are not ready. Return when you have grown stronger. (Recommended: Level 30)",
      enter: "Very well. May your flames burn bright, wizard. Step through when ready.",
    },
  },
  shapeshifter: {
    id: 'shapeshifter',
    name: 'Mirage the Shapeshifter',
    type: 'shapeshifter',
    x: 9600, y: 9300,
    radius: 20,
    zone: 'sanctuary',
    color: '#ec4899',
    interactRange: 80,
    stationary: true,
    forms: [
      { name: 'Mirage the Shapeshifter', emoji: '🦋', color: '#ec4899', desc: 'A butterfly of prismatic light' },
      { name: 'Umbra the Shadow', emoji: '👻', color: '#6b7280', desc: 'A wisp of living darkness' },
      { name: 'Prism the Elemental', emoji: '💎', color: '#06b6d4', desc: 'A crystalline being of pure energy' },
      { name: 'Phoenix Ember', emoji: '🔥', color: '#f97316', desc: 'A bird made of eternal flame' },
      { name: 'Whisper the Fae', emoji: '✨', color: '#a855f7', desc: 'A mischievous fairy creature' },
      { name: 'Tempest the Storm', emoji: '⚡', color: '#fbbf24', desc: 'Lightning given physical form' },
      { name: 'Frost Bloom', emoji: '❄️', color: '#67e8f9', desc: 'An ice flower that never melts' },
      { name: 'The Wandering Eye', emoji: '👁️', color: '#ef4444', desc: 'A floating orb of arcane sight' },
    ],
    currentFormIndex: 0,
    lastFormChange: 0,
    formChangeInterval: 15 * 60 * 1000, // 15 minutes
    greetings: [
      "Ah, you see me as I am now... but in a moment, I could be anything.",
      "Identity is fluid, young one. Would you like to change your appearance?",
      "I have walked this world in a thousand forms. Perhaps you seek a new look?",
      "The mirror shows what we choose to be. Let me help you reshape yourself.",
    ],
    skinPrompt: "Would you like to change your appearance?",
  },
  dungeon_architect: {
    id: 'dungeon_architect',
    name: 'Arcanus the Dreamweaver',
    type: 'dungeon_architect',
    x: 11400, y: 8800,
    radius: 20,
    zone: 'sanctuary',
    color: '#8b5cf6',
    interactRange: 80,
    stationary: true,
    emoji: '🏗️',
    greetings: [
      "Ah, a visitor! I am Arcanus, weaver of pocket dimensions.",
      "I can shape the fabric of reality into any dungeon you can imagine.",
      "Describe your nightmare, and I shall build it for you to conquer.",
      "Want to test your skills? I have dungeons crafted by other wizards too.",
    ],
  },
  hunt_master: {
    id: 'hunt_master',
    name: 'Hunt Master Grimjaw',
    type: 'hunt_master',
    x: 10400, y: 8600,
    radius: 20,
    zone: 'sanctuary',
    color: '#ef4444',
    interactRange: 80,
    stationary: true,
    greetings: [
      "Hah! Another hunter? Good. The wilds need thinning.",
      "You want to prove yourself? I've got bounties that need filling.",
      "Kill enough beasts and I'll make it worth your while, warrior.",
    ],
  },
  herbalist: {
    id: 'herbalist',
    name: 'Herbalist Willow',
    type: 'herbalist',
    x: 9500, y: 8500,
    radius: 18,
    zone: 'sanctuary',
    color: '#4ade80',
    interactRange: 80,
    stationary: true,
    greetings: [
      "Oh hello, dear! I'm Willow. I study the magical flora of these lands.",
      "The zones are filled with rare reagents — if you could gather some for me...",
      "Each herb has powerful properties. Bring them back and I'll brew something special!",
    ],
  },
};

// ============================================
// QUEST DEFINITIONS
// ============================================
export const HUNT_QUESTS = [
  { id: 'hunt_slimes', name: 'Slime Slaughter', description: 'Defeat 30 Slimes in the Meadow.', target: 'slime', zone: 'meadow', required: 30, reward: { maxHealth: 10 }, rewardText: '+10 Max HP', tier: 1 },
  { id: 'hunt_bats', name: 'Bat Purge', description: 'Defeat 25 Bats in the Meadow.', target: 'bat', zone: 'meadow', required: 25, reward: { speed: 5 }, rewardText: '+5 Speed', tier: 1 },
  { id: 'hunt_skeletons', name: 'Bone Collector', description: 'Defeat 25 Skeletons in the Forest.', target: 'skeleton', zone: 'forest', required: 25, reward: { damagePercent: 5 }, rewardText: '+5% Damage', tier: 2 },
  { id: 'hunt_wolves', name: 'Wolf Cull', description: 'Defeat 20 Wolves in the Forest.', target: 'wolf', zone: 'forest', required: 20, reward: { maxHealth: 15 }, rewardText: '+15 Max HP', tier: 2 },
  { id: 'hunt_fire_imps', name: 'Imp Exterminator', description: 'Defeat 20 Fire Imps in the Volcanic Wastes.', target: 'fire_imp', zone: 'volcanic', required: 20, reward: { maxHealth: 15, speed: 5 }, rewardText: '+15 Max HP, +5 Speed', tier: 3 },
  { id: 'hunt_yetis', name: 'Yeti Hunter', description: 'Defeat 15 Yetis in the Frozen Expanse.', target: 'yeti', zone: 'frozen', required: 15, reward: { maxHealth: 20 }, rewardText: '+20 Max HP', tier: 4 },
  { id: 'hunt_demons', name: 'Demon Slayer', description: 'Defeat 10 Demons in the Abyss.', target: 'demon', zone: 'abyss', required: 10, reward: { damagePercent: 10 }, rewardText: '+10% Damage', tier: 5 },
  { id: 'hunt_crystal_drakes', name: 'Drake Tamer', description: 'Defeat 12 Crystal Drakes in the Crystal Caves.', target: 'crystal_drake', zone: 'crystal_caves', required: 12, reward: { maxHealth: 15, damagePercent: 5 }, rewardText: '+15 Max HP, +5% Damage', tier: 4 },
];

export const COLLECT_QUESTS = [
  { id: 'collect_meadow_herbs', name: 'Meadow Remedies', description: 'Gather 8 Silverleaf Herbs from the Meadow.', item: 'silverleaf', zone: 'meadow', required: 8, reward: { healBonus: 10 }, rewardText: '+10% Healing', tier: 1, itemColor: '#4ade80', itemEmoji: '🌿' },
  { id: 'collect_forest_mushrooms', name: 'Forest Fungi', description: 'Gather 6 Glowcap Mushrooms from the Forest.', item: 'glowcap', zone: 'forest', required: 6, reward: { speed: 8 }, rewardText: '+8 Speed', tier: 2, itemColor: '#a855f7', itemEmoji: '🍄' },
  { id: 'collect_fire_crystals', name: 'Volcanic Crystals', description: 'Gather 5 Emberstone Crystals from the Volcanic Wastes.', item: 'emberstone', zone: 'volcanic', required: 5, reward: { damagePercent: 8 }, rewardText: '+8% Damage', tier: 3, itemColor: '#f97316', itemEmoji: '🔶' },
  { id: 'collect_frost_flowers', name: 'Frozen Blossoms', description: 'Gather 4 Frostbloom Flowers from the Frozen Expanse.', item: 'frostbloom', zone: 'frozen', required: 4, reward: { maxHealth: 25 }, rewardText: '+25 Max HP', tier: 4, itemColor: '#67e8f9', itemEmoji: '❄️' },
  { id: 'collect_void_shards', name: 'Abyssal Fragments', description: 'Gather 3 Void Shards from the Abyss.', item: 'void_shard', zone: 'abyss', required: 3, reward: { damagePercent: 12, maxHealth: 10 }, rewardText: '+12% Damage, +10 Max HP', tier: 5, itemColor: '#6366f1', itemEmoji: '💎' },
  { id: 'collect_prism_dust', name: 'Crystal Essence', description: 'Gather 5 Prism Dust from the Crystal Caves.', item: 'prism_dust', zone: 'crystal_caves', required: 5, reward: { cooldownReduction: 5 }, rewardText: '5% Cooldown Reduction', tier: 4, itemColor: '#ec4899', itemEmoji: '✨' },
];

// NPC State tracking
const npcStates = new Map();

