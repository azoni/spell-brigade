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
      "The ley lines whisper of your deeds, traveler. What brings you to my vigil?",
      "I have watched this Sanctuary since before the first stone was laid. Ask, and I shall guide you.",
      "The balance shifts. Darkness presses at every border. But you... you carry a spark worth protecting.",
      "Each wizard who passes through shapes the fate of these lands. What will your legacy be?",
      "The healing fountain remembers all who drink from it. The portal hub connects all who are brave enough to travel.",
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
        "You have the look of someone searching for purpose. I am Seraphina — I keep the ledger of this realm's unfinished business.",
        "Six bosses hold dominion over the zones beyond. Each one a tyrant. Each one... killable.",
        "No one has defeated them all. Not yet.",
      ],
      questOffer: [
        "Here is what stands between this world and peace:",
        "The Blossom Behemoth chokes the Meadow. The Ancient Treant poisons the Forest.",
        "The Magma Titan scorches the Volcanic Wastes. The Frost Wyrm freezes the northern passes.",
        "The Crystal Golem guards power beyond measure. And in the deepest dark... the Void Overlord waits.",
        "Bring me proof of their deaths. All six. Then this realm will know its first true Champion.",
      ],
      questActive: "The bosses still breathe. Check your quest log — and don't come back empty-handed.",
      questComplete: "It's done. I... did not think I would live to see this day. You are the Champion of the Realm. Kneel for no one.",
      prompt: "Will you hunt the six?",
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
        "Hold. I am Aldric. The door behind me leads to the Dragon's Gauntlet.",
        "I've stood this post for eleven years. I've watched hundreds enter. I can count the survivors on one hand.",
        "This is not a quest. This is a death sentence with a small chance of glory.",
      ],
      warning: [
        "The Gauntlet is five chambers deep. Each one worse than the last.",
        "Skeletal hordes. Flame sentinels. Mini-bosses that would be zone bosses anywhere else.",
        "And at the bottom... the Infernal Dragon. It doesn't negotiate.",
        "Level 30 at minimum. Anything less is suicide.",
      ],
      prompt: "Still want to go in?",
      tooWeak: "No. Come back stronger. I won't send you to die. (Recommended: Level 30)",
      enter: "... Brave or foolish. Either way — may your spells fly true. Step through.",
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
      "Don't stare — yes, I changed again. It's what I do. Perhaps you'd like to try a new look yourself?",
      "Form is temporary. Power is permanent. I can reshape your exterior if the current one bores you.",
      "Ah, a visitor! Last one ran screaming when I shifted mid-sentence. You seem braver. Want a new appearance?",
      "Identity is a costume, dear. I've worn thousands. Shall I tailor one for you?",
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
      "Reality is my clay and nightmares are my inspiration. Describe a challenge and I'll build it from nothing.",
      "You want danger? I weave pocket dimensions — each one a death trap tailored to your description. Interested?",
      "Every dungeon I've built still exists somewhere between dimensions. Some have challengers inside them right now. Want your own?",
      "Most architects build walls. I build entire worlds. Tell me your worst fear and I'll make it fightable.",
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
      "You smell like Sanctuary air. Soft. My bounties will fix that — if you survive them.",
      "Every beast on that board has killed someone I trained. Don't add your name to the list.",
      "Back for more? Good. The wilds don't thin themselves. Pick a bounty and make it bleed.",
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
      "Oh! Don't mind the mess — I'm mid-experiment. But if you're heading out, I could use some ingredients...",
      "Every zone hides reagents that could save lives or end them. I prefer the former. Will you gather for me?",
      "The flora of these lands holds more power than most wizards realize. Bring me samples and I'll prove it.",
    ],
  },
};

// ============================================
// QUEST DEFINITIONS
// ============================================
export const HUNT_QUESTS = [
  { id: 'hunt_slimes', name: 'The Oozing Menace', description: 'The Meadow is overrun. Grimjaw needs 30 Slimes cleared before they reach the Sanctuary walls.', target: 'slime', zone: 'meadow', required: 30, reward: { maxHealth: 10 }, rewardText: '+10 Max HP', tier: 1 },
  { id: 'hunt_bats', name: 'Silent Wings', description: 'Travelers report Bat swarms ambushing anyone who strays from the path. Eliminate 25 to restore safe passage.', target: 'bat', zone: 'meadow', required: 25, reward: { speed: 5 }, rewardText: '+5 Speed', tier: 1 },
  { id: 'hunt_skeletons', name: 'Restless Dead', description: 'Something is raising the dead in the Forest. Put 25 Skeletons back in the ground before their numbers swell.', target: 'skeleton', zone: 'forest', required: 25, reward: { damagePercent: 5 }, rewardText: '+5% Damage', tier: 2 },
  { id: 'hunt_wolves', name: 'Alpha Hunt', description: 'A Wolf pack has grown bold, attacking anyone entering the treeline. Thin the pack by 20 to break their territory.', target: 'wolf', zone: 'forest', required: 20, reward: { maxHealth: 15 }, rewardText: '+15 Max HP', tier: 2 },
  { id: 'hunt_fire_imps', name: 'Embers of Chaos', description: 'Fire Imps pour from volcanic vents, spreading wildfire. Destroy 20 before the Wastes become impassable.', target: 'fire_imp', zone: 'volcanic', required: 20, reward: { maxHealth: 15, speed: 5 }, rewardText: '+15 Max HP, +5 Speed', tier: 3 },
  { id: 'hunt_yetis', name: 'The Frozen Siege', description: 'Yetis have sealed the northern passes. Grimjaw needs 15 brought down to reopen the trade routes.', target: 'yeti', zone: 'frozen', required: 15, reward: { maxHealth: 20 }, rewardText: '+20 Max HP', tier: 4 },
  { id: 'hunt_demons', name: 'Into the Abyss', description: 'Demons are spilling through rifts in the deepest zone. Only the strongest survive. Banish 10 back to the void.', target: 'demon', zone: 'abyss', required: 10, reward: { damagePercent: 10 }, rewardText: '+10% Damage', tier: 5 },
  { id: 'hunt_crystal_drakes', name: 'Shattered Scales', description: 'Crystal Drakes hoard magical energy that could power the Sanctuary. Defeat 12 and claim their resonance.', target: 'crystal_drake', zone: 'crystal_caves', required: 12, reward: { maxHealth: 15, damagePercent: 5 }, rewardText: '+15 Max HP, +5% Damage', tier: 4 },
];

export const COLLECT_QUESTS = [
  { id: 'collect_meadow_herbs', name: 'Willow\'s Remedy', description: 'Willow\'s healing stores are running low. Gather 8 Silverleaf Herbs from the Meadow — the wounded depend on it.', item: 'silverleaf', zone: 'meadow', required: 8, reward: { healBonus: 10 }, rewardText: '+10% Healing', tier: 1, itemColor: '#4ade80', itemEmoji: '🌿' },
  { id: 'collect_forest_mushrooms', name: 'The Glowing Spores', description: 'A rare Glowcap bloom has been spotted in the Forest. Willow needs 6 — their bioluminescence can brew powerful speed tonics.', item: 'glowcap', zone: 'forest', required: 6, reward: { speed: 8 }, rewardText: '+8 Speed', tier: 2, itemColor: '#a855f7', itemEmoji: '🍄' },
  { id: 'collect_fire_crystals', name: 'Heart of the Volcano', description: 'Emberstones form only in the hottest volcanic vents. Retrieve 5 — Willow can forge them into damage-amplifying elixirs.', item: 'emberstone', zone: 'volcanic', required: 5, reward: { damagePercent: 8 }, rewardText: '+8% Damage', tier: 3, itemColor: '#f97316', itemEmoji: '🔶' },
  { id: 'collect_frost_flowers', name: 'Blossoms of the Tundra', description: 'Frostbloom Flowers only grow where magic and ice converge. Find 4 in the Frozen Expanse for a vitality brew.', item: 'frostbloom', zone: 'frozen', required: 4, reward: { maxHealth: 25 }, rewardText: '+25 Max HP', tier: 4, itemColor: '#67e8f9', itemEmoji: '❄️' },
  { id: 'collect_void_shards', name: 'Fragments of the Abyss', description: 'Void Shards contain concentrated dark energy. Willow dares not enter the Abyss herself. Bring back 3 — the power they hold is extraordinary.', item: 'void_shard', zone: 'abyss', required: 3, reward: { damagePercent: 12, maxHealth: 10 }, rewardText: '+12% Damage, +10 Max HP', tier: 5, itemColor: '#6366f1', itemEmoji: '💎' },
  { id: 'collect_prism_dust', name: 'Crystalline Resonance', description: 'The Crystal Caves hum with arcane frequency. Collect 5 handfuls of Prism Dust — Willow can distill it into a cooldown tonic.', item: 'prism_dust', zone: 'crystal_caves', required: 5, reward: { cooldownReduction: 5 }, rewardText: '5% Cooldown Reduction', tier: 4, itemColor: '#ec4899', itemEmoji: '✨' },
];

// NPC State tracking
const npcStates = new Map();

