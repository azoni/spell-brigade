// ===========================================
// NPCs
// ===========================================

export const NPCS = {
  ethereal_guide: {
    id: 'ethereal_guide',
    name: 'Ethereal Guide',
    type: 'guide',
    x: 3350, y: 2600,
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
    x: 3200, y: 2900,
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
    x: 3750, y: 3200,
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
    x: 3150, y: 3100,
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
    x: 3800, y: 2900,
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
};

// NPC State tracking
const npcStates = new Map();

