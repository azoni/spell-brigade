// ===========================================
// SKINS & RANKS
// ===========================================

export const SKINS = {
  // Pyromancer skins
  pyromancer_default: { id: 'pyromancer_default', class: 'pyromancer', name: 'Apprentice', color: '#ff6b35', requiredXp: 0 },
  pyromancer_ember: { id: 'pyromancer_ember', class: 'pyromancer', name: 'Ember Mage', color: '#f97316', requiredXp: 500 },
  pyromancer_inferno: { id: 'pyromancer_inferno', class: 'pyromancer', name: 'Inferno Master', color: '#dc2626', requiredXp: 2000 },
  pyromancer_phoenix: { id: 'pyromancer_phoenix', class: 'pyromancer', name: 'Phoenix Lord', color: '#fbbf24', requiredXp: 5000, special: true },
  pyromancer_shadow: { id: 'pyromancer_shadow', class: 'pyromancer', name: 'Shadow Flame', color: '#7c3aed', requiredXp: 10000, special: true },
  
  // Cryomancer skins
  cryomancer_default: { id: 'cryomancer_default', class: 'cryomancer', name: 'Apprentice', color: '#4ecdc4', requiredXp: 0 },
  cryomancer_frost: { id: 'cryomancer_frost', class: 'cryomancer', name: 'Frost Weaver', color: '#06b6d4', requiredXp: 500 },
  cryomancer_glacier: { id: 'cryomancer_glacier', class: 'cryomancer', name: 'Glacier Knight', color: '#0284c7', requiredXp: 2000 },
  cryomancer_blizzard: { id: 'cryomancer_blizzard', class: 'cryomancer', name: 'Blizzard King', color: '#e0f2fe', requiredXp: 5000, special: true },
  cryomancer_void: { id: 'cryomancer_void', class: 'cryomancer', name: 'Void Ice', color: '#1e1b4b', requiredXp: 10000, special: true },
  
  // Arcanist skins
  arcanist_default: { id: 'arcanist_default', class: 'arcanist', name: 'Apprentice', color: '#9b5de5', requiredXp: 0 },
  arcanist_mystic: { id: 'arcanist_mystic', class: 'arcanist', name: 'Mystic Sage', color: '#a855f7', requiredXp: 500 },
  arcanist_archmage: { id: 'arcanist_archmage', class: 'arcanist', name: 'Archmage', color: '#7c3aed', requiredXp: 2000 },
  arcanist_celestial: { id: 'arcanist_celestial', class: 'arcanist', name: 'Celestial', color: '#fcd34d', requiredXp: 5000, special: true },
  arcanist_cosmic: { id: 'arcanist_cosmic', class: 'arcanist', name: 'Cosmic Entity', color: '#1e1b4b', requiredXp: 10000, special: true },
  
  // Voidlord skins (unlocked after dragon kill)
  voidlord_default: { id: 'voidlord_default', class: 'voidlord', name: 'Void Lord', color: '#1a0a2e', requiredXp: 0 },
  voidlord_ascended: { id: 'voidlord_ascended', class: 'voidlord', name: 'Ascended', color: '#ff00ff', requiredXp: 5000 },
  
  // Shadow Archer skins (Admin)
  shadowarcher_default: { id: 'shadowarcher_default', class: 'shadowarcher', name: 'Shadow Archer', color: '#334155', requiredXp: 0 },
  shadowarcher_crimson: { id: 'shadowarcher_crimson', class: 'shadowarcher', name: 'Crimson Hunter', color: '#991b1b', requiredXp: 0 },
};

// XP thresholds for titles/ranks
export const RANKS = [
  { xp: 0, title: 'Novice', icon: '🌱' },
  { xp: 100, title: 'Apprentice', icon: '📖' },
  { xp: 500, title: 'Adept', icon: '⭐' },
  { xp: 1500, title: 'Expert', icon: '🌟' },
  { xp: 3000, title: 'Master', icon: '💫' },
  { xp: 6000, title: 'Grandmaster', icon: '👑' },
  { xp: 10000, title: 'Legend', icon: '🏆' },
  { xp: 20000, title: 'Mythic', icon: '🔮' },
];

