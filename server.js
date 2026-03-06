const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Prix de vente par rareté ---
const SELL_PRICES = {
  commune: 30,
  rare: 75,
  epique: 150,
  legendaire: 400
};

// --- Base de données ---
const db = new Database(path.join(__dirname, 'gacha.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    credits INTEGER DEFAULT 1000,
    last_daily TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rarity TEXT NOT NULL,
    type TEXT NOT NULL,
    element TEXT NOT NULL,
    attack INTEGER NOT NULL,
    defense INTEGER NOT NULL,
    hp INTEGER NOT NULL,
    mana_cost INTEGER NOT NULL,
    ability_name TEXT NOT NULL,
    ability_desc TEXT NOT NULL,
    image TEXT DEFAULT ''
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (card_id) REFERENCES cards(id)
  )
`);

// --- Migration : ajout colonnes shiny/fused ---
{
  const cols = db.prepare("PRAGMA table_info(user_cards)").all().map(c => c.name);
  if (!cols.includes('is_shiny')) {
    db.exec("ALTER TABLE user_cards ADD COLUMN is_shiny INTEGER DEFAULT 0");
    console.log('Migration: is_shiny ajouté');
  }
  if (!cols.includes('is_fused')) {
    db.exec("ALTER TABLE user_cards ADD COLUMN is_fused INTEGER DEFAULT 0");
    console.log('Migration: is_fused ajouté');
  }
}

// --- Migration : ajout colonne is_admin ---
{
  const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols.includes('is_admin')) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0");
    console.log('Migration: is_admin ajouté');
  }
}

// --- Seed compte admin ---
{
  const adminUser = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminUser) {
    const hash = bcrypt.hashSync('admin123321', 10);
    db.prepare('INSERT INTO users (username, password, credits, is_admin) VALUES (?, ?, 999999, 1)').run('admin', hash);
    console.log('Compte admin cree (admin / admin123321)');
  } else {
    db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run('admin');
  }
}

// --- Nouvelles tables ---
db.exec(`
  CREATE TABLE IF NOT EXISTS campaign_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    current_node INTEGER DEFAULT 0,
    completed_nodes TEXT DEFAULT '[]',
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS pvp_teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    card1_id INTEGER,
    card2_id INTEGER,
    card3_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS battle_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    battle_type TEXT NOT NULL,
    opponent_info TEXT NOT NULL,
    result TEXT NOT NULL,
    reward_credits INTEGER DEFAULT 0,
    played_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// --- Système d'éléments ---
const ELEMENT_ADVANTAGES = {
  feu:     { strong: 'terre',   weak: 'eau' },
  terre:   { strong: 'eau',     weak: 'feu' },
  eau:     { strong: 'feu',     weak: 'terre' },
  lumiere: { strong: 'ombre',   weak: 'ombre' },
  ombre:   { strong: 'lumiere', weak: 'lumiere' }
};

const ELEMENT_CONFIG = {
  feu:     { icon: '🔥', color: '#ff4422', name: 'Feu' },
  eau:     { icon: '💧', color: '#2299ff', name: 'Eau' },
  terre:   { icon: '🌿', color: '#44aa33', name: 'Terre' },
  lumiere: { icon: '✨', color: '#ffcc00', name: 'Lumière' },
  ombre:   { icon: '🌑', color: '#9944cc', name: 'Ombre' }
};

// --- Seed des cartes ---
const cardCount = db.prepare('SELECT COUNT(*) as c FROM cards').get().c;
if (cardCount === 0) {
  const insert = db.prepare(`
    INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedCards = db.transaction(() => {
    insert.run('Soldat',  'commune', 'guerrier', 'terre',   3, 4, 20, 2, 'Charge',       '+2 ATK ce tour',     'soldat.png');
    insert.run('Loup',    'commune', 'bete',     'ombre',   4, 2, 15, 1, 'Morsure',      '2 degats directs',   'loup.png');
    insert.run('Archer',  'commune', 'guerrier', 'eau',     3, 2, 14, 2, 'Tir percant',  'Ignore la DEF',      'archer.png');
    insert.run('Chevalier', 'rare', 'guerrier', 'lumiere', 5, 7, 30, 3, 'Rempart',       '+4 DEF ce tour',     'chevalier.png');
    insert.run('Mage',      'rare', 'mage',     'feu',     6, 3, 18, 3, 'Boule de feu',  '5 degats',           'mage.png');
    insert.run('Sorciere', 'epique', 'mage',  'ombre',   7, 4, 22, 4, 'Drain de vie',   '4 degats +2 PV',    'sorciere.png');
    insert.run('Dragon',   'epique', 'bete',  'feu',     9, 6, 35, 5, 'Souffle ardent', '6 degats a tous',    'dragon.png');
    insert.run('Archange', 'legendaire', 'divin', 'lumiere', 8, 8, 40, 6, 'Jugement divin', '10 degats',       'archange.png');
    insert.run('Phenix',   'legendaire', 'bete',  'feu',     9, 5, 35, 6, 'Renaissance',    'Revient avec 15 PV une fois', 'phenix.png');
  });

  seedCards();
  console.log('Cartes seedees.');
}

// --- Migration : ajout nouvelles cartes ---
const newCards = [
  ['Golem',  'epique', 'bete',    'terre', 5, 9, 38, 4, 'Seisme',          '3 degats + stun 1 tour',   'golem.png'],
  ['Sirene', 'rare',   'mage',    'eau',   4, 5, 24, 3, 'Chant envoutant', 'Reduit ATK ennemi de 3',   'sirene.png'],
  ['Phenix', 'legendaire', 'bete','feu',   9, 5, 35, 6, 'Renaissance',     'Revient avec 15 PV une fois', 'phenix.png'],
  ['Gobelin',    'commune', 'guerrier', 'terre',   4, 2, 12, 1, 'Embuscade',      '3 degats si premier tour',   'gobelin.png'],
  ['Fantome',    'commune', 'mage',     'ombre',   3, 1, 10, 1, 'Traversee',      'Ignore la DEF',              'fantome.png'],
  ['Grenouille', 'commune', 'guerrier', 'eau',     2, 5, 18, 2, 'Bouclier algue', '+3 DEF ce tour',             'grenouille.png'],
  ['Luciole',    'commune', 'mage',     'lumiere', 3, 3, 13, 1, 'Flash',          'Aveugle 1 tour',             'luciole.png'],
  ['Pyromane',   'commune', 'mage',     'feu',    4, 1, 11, 1, 'Jonglerie',      '2 degats aleatoires x2',     'pyromane.png'],
];
{
  const insertMigrate = db.prepare(`
    INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const c of newCards) {
    const exists = db.prepare('SELECT id FROM cards WHERE name = ?').get(c[0]);
    if (!exists) {
      insertMigrate.run(...c);
      console.log(`Carte ajoutee : ${c[0]}`);
    }
  }
}

// --- Migration : pool de 200 cartes ---
{
  const insert200 = db.prepare(`
    INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const cards200 = [
    // ===== COMMUNES - TERRE (18) =====
    ['Mineur',        'commune','guerrier','terre',  3,4,18,2,'Charge',        '+2 ATK ce tour',''],
    ['Taupe',         'commune','bete',    'terre',  2,3,16,1,'Morsure rapide','2 degats 1er tour',''],
    ['Scarabee',      'commune','bete',    'terre',  3,5,14,1,'Carapace',      '+2 DEF ce tour',''],
    ['Paysan',        'commune','guerrier','terre',  3,3,20,1,'Coup de poing', '1 degat direct',''],
    ['Caillou vivant','commune','bete',    'terre',  2,6,22,2,'Mur de pierre', '+2 DEF ce tour',''],
    ['Ver de terre',  'commune','bete',    'terre',  1,2,12,1,'Regeneration',  '1 degat +2 PV',''],
    ['Herboriste',    'commune','mage',    'terre',  2,3,15,2,'Toxine',        '-2 ATK ennemi',''],
    ['Champignon',    'commune','bete',    'terre',  2,4,18,1,'Toxine',        '-2 ATK ennemi',''],
    ['Terrassier',    'commune','guerrier','terre',  4,3,16,2,'Griffure',      '2 degats directs',''],
    ['Rat',           'commune','bete',    'terre',  3,1,10,1,'Morsure rapide','2 degats 1er tour',''],
    ['Sentinelle',    'commune','guerrier','terre',  3,5,20,2,'Mur de pierre', '+2 DEF ce tour',''],
    ['Fourmi',        'commune','bete',    'terre',  2,2,12,1,'Rafale',        '1 degat x3',''],
    ['Brigand',       'commune','guerrier','terre',  4,2,14,1,'Coup sournois', '3 degats 1er tour',''],
    ['Bucheron',      'commune','guerrier','terre',  4,3,18,2,'Griffure',      '2 degats directs',''],
    ['Sanglier',      'commune','bete',    'terre',  4,3,17,1,'Charge',        '+2 ATK ce tour',''],
    ['Herisson',      'commune','bete',    'terre',  2,5,15,1,'Piqure',        '1 degat direct',''],
    ['Alchimiste',    'commune','mage',    'terre',  3,2,13,2,'Siphon',        '2 degats +1 PV',''],
    ['Fermier',       'commune','guerrier','terre',  3,4,19,2,'Cri de guerre', '+2 ATK ce tour',''],
    // ===== COMMUNES - EAU (18) =====
    ['Poisson',       'commune','bete',    'eau',    3,2,14,1,'Piqure',        '1 degat direct',''],
    ['Crabe',         'commune','bete',    'eau',    3,5,18,1,'Griffure',      '2 degats directs',''],
    ['Marin',         'commune','guerrier','eau',    3,3,16,2,'Paralysie',     'Stun 1 tour',''],
    ['Pieuvre',        'commune','bete',    'eau',    4,2,15,1,'Toxine',        '-2 ATK ennemi',''],
    ['Meduse',        'commune','bete',    'eau',    2,1,12,1,'Paralysie',     'Stun 1 tour',''],
    ['Triton',        'commune','guerrier','eau',    3,4,20,2,'Griffure',      '2 degats directs',''],
    ['Hippocampe',    'commune','bete',    'eau',    2,3,14,1,'Carapace',      '+2 DEF ce tour',''],
    ['Nymphe',        'commune','mage',    'eau',    3,2,13,2,'Toxine',        '-2 ATK ennemi',''],
    ['Pirate',        'commune','guerrier','eau',    4,2,15,1,'Morsure rapide','2 degats 1er tour',''],
    ['Pelican',       'commune','bete',    'eau',    3,2,14,1,'Morsure rapide','2 degats 1er tour',''],
    ['Phoque',        'commune','bete',    'eau',    2,4,18,1,'Carapace',      '+2 DEF ce tour',''],
    ['Coquillage',    'commune','bete',    'eau',    1,6,22,1,'Ecran de fumee','+3 DEF ce tour',''],
    ['Naiade',        'commune','mage',    'eau',    3,3,15,2,'Griffure',      '2 degats directs',''],
    ['Loutre',        'commune','bete',    'eau',    3,3,16,1,'Carapace',      '+2 DEF ce tour',''],
    ['Moussaillon',   'commune','guerrier','eau',    3,2,14,1,'Cri de guerre', '+2 ATK ce tour',''],
    ['Anguille',      'commune','bete',    'eau',    4,1,11,1,'Griffure',      '2 degats directs',''],
    ['Tortue',        'commune','bete',    'eau',    2,5,20,1,'Ecran de fumee','+3 DEF ce tour',''],
    ['Mouette',       'commune','bete',    'eau',    3,2,13,1,'Piqure',        '1 degat direct',''],
    // ===== COMMUNES - FEU (19) =====
    ['Torche',        'commune','mage',    'feu',    4,1,12,1,'Griffure',      '2 degats directs',''],
    ['Salamandre',    'commune','bete',    'feu',    4,2,14,1,'Griffure',      '2 degats directs',''],
    ['Forgeron',      'commune','guerrier','feu',    4,4,18,2,'Charge',        '+2 ATK ce tour',''],
    ['Braise',        'commune','bete',    'feu',    3,1,10,1,'Coup sournois', '3 degats 1er tour',''],
    ['Artificier',    'commune','guerrier','feu',    4,1,12,1,'Rafale',        '1 degat x3',''],
    ['Fennec',        'commune','bete',    'feu',    3,2,13,1,'Morsure rapide','2 degats 1er tour',''],
    ['Cactus ardent', 'commune','bete',    'feu',    2,5,18,1,'Piqure',        '1 degat direct',''],
    ['Charbon',       'commune','bete',    'feu',    2,3,16,1,'Charge',        '+2 ATK ce tour',''],
    ['Lezard',        'commune','bete',    'feu',    3,2,14,1,'Carapace',      '+2 DEF ce tour',''],
    ['Volcanologue',  'commune','mage',    'feu',    3,2,14,2,'Griffure',      '2 degats directs',''],
    ['Charbonnier',   'commune','guerrier','feu',    3,3,16,2,'Toxine',        '-2 ATK ennemi',''],
    ['Etincelle',     'commune','mage',    'feu',    4,1,11,1,'Morsure rapide','2 degats 1er tour',''],
    ['Chien de feu',  'commune','bete',    'feu',    4,2,15,1,'Toxine',        '-2 ATK ennemi',''],
    ['Danseur',       'commune','guerrier','feu',    4,2,14,1,'Charge',        '+2 ATK ce tour',''],
    ['Magma',         'commune','bete',    'feu',    3,4,18,2,'Griffure',      '2 degats directs',''],
    ['Cuisinier',     'commune','guerrier','feu',    3,3,16,1,'Griffure',      '2 degats directs',''],
    ['Mouche de feu', 'commune','bete',    'feu',    3,1,10,1,'Morsure rapide','2 degats 1er tour',''],
    ['Fumigene',      'commune','mage',    'feu',    2,3,15,2,'Ecran de fumee','+3 DEF ce tour',''],
    ['Flambeau',      'commune','guerrier','feu',    3,2,14,1,'Coup de poing', '1 degat direct',''],
    // ===== COMMUNES - OMBRE (19) =====
    ['Chauve-souris', 'commune','bete',    'ombre',  3,1,12,1,'Toxine',        '-2 ATK ennemi',''],
    ['Araignee',      'commune','bete',    'ombre',  3,2,14,1,'Paralysie',     'Stun 1 tour',''],
    ['Voleur',        'commune','guerrier','ombre',  4,1,13,1,'Coup sournois', '3 degats 1er tour',''],
    ['Corbeau',       'commune','bete',    'ombre',  3,2,13,1,'Toxine',        '-2 ATK ennemi',''],
    ['Rat noir',      'commune','bete',    'ombre',  3,1,11,1,'Griffure',      '2 degats directs',''],
    ['Spectre',       'commune','mage',    'ombre',  4,1,10,1,'Passe-muraille','Ignore la DEF',''],
    ['Bandit',        'commune','guerrier','ombre',  4,2,14,1,'Coup sournois', '3 degats 1er tour',''],
    ['Zombie',        'commune','guerrier','ombre',  3,3,20,1,'Siphon',        '2 degats +1 PV',''],
    ['Squelette',     'commune','guerrier','ombre',  3,2,14,1,'Griffure',      '2 degats directs',''],
    ['Chat noir',     'commune','bete',    'ombre',  3,3,14,1,'Griffure',      '2 degats directs',''],
    ['Ombre rampante','commune','mage',    'ombre',  3,2,13,1,'Siphon',        '2 degats +1 PV',''],
    ['Larve',         'commune','bete',    'ombre',  2,2,16,1,'Ecran de fumee','+3 DEF ce tour',''],
    ['Assassin novice','commune','guerrier','ombre', 5,1,11,1,'Griffure',      '2 degats directs',''],
    ['Crapaud sombre','commune','bete',    'ombre',  2,4,18,1,'Toxine',        '-2 ATK ennemi',''],
    ['Ectoplasme',    'commune','mage',    'ombre',  3,1,12,1,'Effroi',        'Stun 1 tour',''],
    ['Goule',         'commune','bete',    'ombre',  4,2,16,1,'Siphon',        '2 degats +1 PV',''],
    ['Marionnette',   'commune','mage',    'ombre',  3,3,15,2,'Paralysie',     'Stun 1 tour',''],
    ['Serpent venimeux','commune','bete',   'ombre',  3,2,13,1,'Toxine',        '-2 ATK ennemi',''],
    ['Pilleur',       'commune','guerrier','ombre',  4,2,15,1,'Morsure rapide','2 degats 1er tour',''],
    // ===== COMMUNES - LUMIERE (18) =====
    ['Moineau celeste','commune','bete',   'lumiere',3,2,14,1,'Elan',          '+1 ATK ce tour',''],
    ['Pretre novice', 'commune','mage',    'lumiere',2,3,16,2,'Regeneration',  '1 degat +2 PV',''],
    ['Eclaireur',     'commune','guerrier','lumiere',3,3,16,1,'Toxine',        '-2 ATK ennemi',''],
    ['Papillon',      'commune','bete',    'lumiere',2,2,12,1,'Toxine',        '-2 ATK ennemi',''],
    ['Abeille sacree','commune','bete',    'lumiere',3,2,13,1,'Griffure',      '2 degats directs',''],
    ['Gardien',       'commune','guerrier','lumiere',3,5,20,2,'Ecran de fumee','+3 DEF ce tour',''],
    ['Apprenti mage', 'commune','mage',    'lumiere',3,2,14,2,'Griffure',      '2 degats directs',''],
    ['Agneau',        'commune','bete',    'lumiere',1,4,18,1,'Carapace',      '+2 DEF ce tour',''],
    ['Colombe',       'commune','bete',    'lumiere',2,3,15,1,'Carapace',      '+2 DEF ce tour',''],
    ['Paladin novice','commune','guerrier','lumiere',4,4,18,2,'Griffure',      '2 degats directs',''],
    ['Lutin',         'commune','bete',    'lumiere',3,2,13,1,'Toxine',        '-2 ATK ennemi',''],
    ['Moine',         'commune','guerrier','lumiere',2,4,18,2,'Ecran de fumee','+3 DEF ce tour',''],
    ['Cerf blanc',    'commune','bete',    'lumiere',3,3,16,1,'Cri de guerre', '+2 ATK ce tour',''],
    ['Fee',           'commune','mage',    'lumiere',2,2,12,1,'Regeneration',  '1 degat +2 PV',''],
    ['Heraut',        'commune','guerrier','lumiere',3,3,16,1,'Cri de guerre', '+2 ATK ce tour',''],
    ['Chat blanc',    'commune','bete',    'lumiere',3,2,14,1,'Carapace',      '+2 DEF ce tour',''],
    ['Scarabee dore', 'commune','bete',    'lumiere',3,4,16,1,'Griffure',      '2 degats directs',''],
    ['Messager',      'commune','guerrier','lumiere',3,2,14,1,'Morsure rapide','2 degats 1er tour',''],
    // ===== RARES - TERRE (11) =====
    ['Centaure',      'rare','guerrier','terre',  5,5,28,3,'Galop',          '+3 ATK ce tour',''],
    ['Druidesse',     'rare','mage',    'terre',  4,6,26,3,'Ronces',         '2 degats + stun',''],
    ['Taureau',       'rare','bete',    'terre',  6,4,25,2,'Coup fatal',     '5 degats 1er tour',''],
    ['Treant',        'rare','bete',    'terre',  4,7,32,3,'Forteresse',     '+5 DEF ce tour',''],
    ['Gladiateur',    'rare','guerrier','terre',  6,5,26,3,'Frappe lourde',  '4 degats directs',''],
    ['Tortue geante', 'rare','bete',    'terre',  3,7,30,3,'Forteresse',     '+5 DEF ce tour',''],
    ['Nain mineur',   'rare','guerrier','terre',  5,6,28,3,'Frappe lourde',  '4 degats directs',''],
    ['Basilic',       'rare','bete',    'terre',  5,4,24,3,'Ronces',         '2 degats + stun',''],
    ['Geomancien',    'rare','mage',    'terre',  5,5,22,3,'Rugissement',    '-3 ATK ennemi',''],
    ['Ours brun',     'rare','bete',    'terre',  6,5,28,2,'Frappe lourde',  '4 degats directs',''],
    ['Sage des forets','rare','mage',   'terre',  4,5,24,3,'Guerison',       '2 degats +4 PV',''],
    // ===== RARES - EAU (10) =====
    ['Requin',        'rare','bete',    'eau',    7,3,24,2,'Frenzy',         '2 degats x3',''],
    ['Ondine',        'rare','mage',    'eau',    5,5,24,3,'Vague glacee',   '2 degats + stun',''],
    ['Corsaire',      'rare','guerrier','eau',    6,4,26,3,'Coup fatal',     '5 degats 1er tour',''],
    ['Morse',         'rare','bete',    'eau',    4,6,30,3,'Benediction',    '+4 DEF ce tour',''],
    ['Elementaire d eau','rare','mage', 'eau',    5,5,26,3,'Torrent',        '4 degats directs',''],
    ['Kappa',         'rare','bete',    'eau',    5,5,24,3,'Rugissement',    '-3 ATK ennemi',''],
    ['Pirate fantome','rare','guerrier','eau',    6,3,22,2,'Lame spectrale', 'Ignore la DEF',''],
    ['Dauphin',       'rare','bete',    'eau',    4,4,24,2,'Rugissement',    '-3 ATK ennemi',''],
    ['Invoqueuse de pluie','rare','mage','eau',   5,4,22,3,'Pluie de feu',  '3 degats a tous',''],
    ['Narval',        'rare','bete',    'eau',    6,4,26,2,'Torrent',        '4 degats directs',''],
    // ===== RARES - FEU (11) =====
    ['Ifrit',         'rare','mage',    'feu',    7,3,22,3,'Pluie de feu',  '3 degats a tous',''],
    ['Berserker',     'rare','guerrier','feu',    7,2,24,2,'Rage',           '+4 ATK ce tour',''],
    ['Minotaure',     'rare','guerrier','feu',    6,5,28,3,'Frappe lourde',  '4 degats directs',''],
    ['Serpent de lave','rare','bete',    'feu',    5,4,24,3,'Soif de sang',  '4 degats +3 PV',''],
    ['Chimere',       'rare','bete',    'feu',    6,4,26,3,'Frenzy',         '2 degats x3',''],
    ['Lion de feu',   'rare','bete',    'feu',    6,4,26,2,'Rugissement',    '-3 ATK ennemi',''],
    ['Pyromancien',   'rare','mage',    'feu',    6,3,20,3,'Pluie de feu',  '3 degats a tous',''],
    ['Scorpion geant','rare','bete',    'feu',    5,5,24,2,'Soif de sang',  '4 degats +3 PV',''],
    ['Djinn',         'rare','mage',    'feu',    5,4,22,3,'Galop',          '+3 ATK ce tour',''],
    ['Raptor',        'rare','bete',    'feu',    7,3,22,2,'Coup fatal',     '5 degats 1er tour',''],
    ['Samourai de feu','rare','guerrier','feu',   6,5,26,3,'Frappe lourde',  '4 degats directs',''],
    // ===== RARES - OMBRE (10) =====
    ['Vampire',       'rare','mage',    'ombre',  6,3,22,3,'Soif de sang',  '4 degats +3 PV',''],
    ['Loup-garou',    'rare','bete',    'ombre',  7,3,24,2,'Rage',           '+4 ATK ce tour',''],
    ['Necromancien',  'rare','mage',    'ombre',  5,4,22,3,'Malediction',    '-4 ATK ennemi',''],
    ['Assassin',      'rare','guerrier','ombre',  7,2,20,2,'Coup fatal',     '5 degats 1er tour',''],
    ['Harpie',        'rare','bete',    'ombre',  5,3,22,2,'Ronces',         '2 degats + stun',''],
    ['Wraith',        'rare','mage',    'ombre',  6,2,20,3,'Lame spectrale', 'Ignore la DEF',''],
    ['Chevalier noir','rare','guerrier','ombre',  6,6,28,3,'Benediction',    '+4 DEF ce tour',''],
    ['Manticore',     'rare','bete',    'ombre',  6,4,26,3,'Soif de sang',   '4 degats +3 PV',''],
    ['Liche',         'rare','mage',    'ombre',  5,5,24,3,'Pluie de feu',  '3 degats a tous',''],
    ['Panthere noire','rare','bete',    'ombre',  6,3,22,2,'Coup fatal',     '5 degats 1er tour',''],
    // ===== RARES - LUMIERE (10) =====
    ['Paladin',       'rare','guerrier','lumiere', 5,7,30,3,'Benediction',   '+4 DEF ce tour',''],
    ['Ange gardien',  'rare','divin',   'lumiere', 5,5,26,3,'Benediction',   '+4 DEF ce tour',''],
    ['Licorne',       'rare','bete',    'lumiere', 5,5,28,3,'Corne sacree',  '3 degats +3 PV',''],
    ['Griffon',       'rare','bete',    'lumiere', 6,5,26,3,'Frappe lourde', '4 degats directs',''],
    ['Pretre',        'rare','mage',    'lumiere', 4,6,28,3,'Guerison',      '2 degats +4 PV',''],
    ['Templier',      'rare','guerrier','lumiere', 6,6,28,3,'Frappe lourde', '4 degats directs',''],
    ['Pegase',        'rare','bete',    'lumiere', 5,4,24,2,'Lame spectrale','Ignore la DEF',''],
    ['Mage blanc',    'rare','mage',    'lumiere', 5,4,24,3,'Pluie de feu', '3 degats a tous',''],
    ['Valkyrie',      'rare','guerrier','lumiere', 6,5,26,3,'Coup fatal',    '5 degats 1er tour',''],
    ['Esprit sacre',  'rare','mage',    'lumiere', 4,5,26,3,'Guerison',      '2 degats +4 PV',''],
    // ===== EPIQUES - TERRE (6) =====
    ['Titan de pierre','epique','guerrier','terre',7,9,38,5,'Avalanche',     '5 degats a tous',''],
    ['Roi des nains', 'epique','guerrier','terre', 8,7,34,4,'Marteau runique','7 degats directs',''],
    ['Hydre de terre','epique','bete',    'terre', 7,6,36,4,'Multi-tetes',   '3 degats x3',''],
    ['Druide ancien', 'epique','mage',    'terre', 6,7,32,4,'Eveil naturel', '5 degats +4 PV',''],
    ['Behemoth',      'epique','bete',    'terre', 8,8,38,5,'Avalanche',     '5 degats a tous',''],
    ['Sphinx',        'epique','bete',    'terre', 7,6,30,4,'Terreur nocturne','5 degats + stun',''],
    // ===== EPIQUES - EAU (5) =====
    ['Kraken',        'epique','bete',    'eau',   8,5,34,4,'Multi-tetes',   '3 degats x3',''],
    ['Leviathan',     'epique','bete',    'eau',   9,6,36,5,'Raz-de-maree',  '6 degats a tous',''],
    ['Sorcier des mers','epique','mage',  'eau',   7,6,28,4,'Terreur nocturne','5 degats + stun',''],
    ['Amiral fantome','epique','guerrier','eau',   8,5,30,4,'Purification',  '7 degats directs',''],
    ['Roi triton',    'epique','guerrier','eau',   7,7,34,4,'Trident royal', '5 degats +3 PV',''],
    // ===== EPIQUES - FEU (6) =====
    ['Demon de feu',  'epique','mage',    'feu',   9,4,30,4,'Inferno',       '6 degats a tous',''],
    ['Hydre de feu',  'epique','bete',    'feu',   8,5,32,4,'Multi-tetes',   '3 degats x3',''],
    ['Wyvern',        'epique','bete',    'feu',   8,6,34,5,'Charge divine', '6 degats 1er tour',''],
    ['Efreet',        'epique','divin',   'feu',   8,5,32,4,'Festin de sang','6 degats +4 PV',''],
    ['Roi volcanique','epique','guerrier','feu',   7,7,34,5,'Inferno',       '6 degats a tous',''],
    ['Guerrier infernal','epique','guerrier','feu',8,6,30,4,'Marteau runique','7 degats directs',''],
    // ===== EPIQUES - OMBRE (5) =====
    ['Faucheur',      'epique','mage',    'ombre', 9,3,28,4,'Faux mortelle', 'Ignore la DEF',''],
    ['Dragon d ombre','epique','bete',    'ombre', 8,6,34,5,'Avalanche',     '5 degats a tous',''],
    ['Seigneur vampire','epique','mage',  'ombre', 7,5,30,4,'Festin de sang','6 degats +4 PV',''],
    ['Roi des morts', 'epique','guerrier','ombre', 8,7,36,5,'Avalanche',     '5 degats a tous',''],
    ['Cauchemar',     'epique','bete',    'ombre', 8,4,30,4,'Terreur nocturne','5 degats + stun',''],
    // ===== EPIQUES - LUMIERE (5) =====
    ['Seraphin',      'epique','divin',   'lumiere',7,8,36,5,'Lumiere divine','5 degats a tous',''],
    ['Champion sacre','epique','guerrier','lumiere',8,7,34,4,'Purification',  '7 degats directs',''],
    ['Druide celeste','epique','mage',    'lumiere',6,7,32,4,'Eveil naturel', '5 degats +4 PV',''],
    ['Chimere celeste','epique','bete',   'lumiere',8,6,32,4,'Charge divine', '6 degats 1er tour',''],
    ['Inquisiteur',   'epique','guerrier','lumiere',8,6,30,4,'Purification',  '7 degats directs',''],
    // ===== LEGENDAIRES - TERRE (3) =====
    ['Gaia',          'legendaire','divin',   'terre',  9,10,50,7,'Colere terrestre','8 degats a tous',''],
    ['Roi des forets','legendaire','divin',   'terre',  9,8,45,6,'Renaissance totale','Revient avec 25 PV',''],
    ['Atlas',         'legendaire','guerrier','terre',  10,9,48,6,'Poids du monde','6 degats + stun',''],
    // ===== LEGENDAIRES - EAU (3) =====
    ['Poseidon',      'legendaire','divin','eau',      9,8,45,6,'Tsunami',     '8 degats a tous',''],
    ['Serpent de mer', 'legendaire','bete', 'eau',      10,7,42,6,'Abime',      '8 degats +5 PV',''],
    ['Reine des glaces','legendaire','mage','eau',      9,7,40,6,'Blizzard',   '7 degats a tous',''],
    // ===== LEGENDAIRES - FEU (2) =====
    ['Ifrit supreme', 'legendaire','divin','feu',      10,6,40,6,'Apocalypse', '9 degats a tous',''],
    ['Empereur dragon','legendaire','bete', 'feu',      10,8,45,7,'Supernova',  '9 degats a tous',''],
    // ===== LEGENDAIRES - OMBRE (3) =====
    ['Thanatos',      'legendaire','divin','ombre',     10,6,38,6,'Sentence mortelle','15 degats directs',''],
    ['Roi demon',     'legendaire','divin','ombre',     10,7,42,6,'Apocalypse', '9 degats a tous',''],
    ['Fenrir',        'legendaire','bete', 'ombre',     10,5,40,6,'Ragnarok',   '5 degats x3',''],
    // ===== LEGENDAIRES - LUMIERE (2) =====
    ['Zeus',          'legendaire','divin','lumiere',   10,8,45,7,'Foudre supreme','12 degats directs',''],
    ['Gardien eternel','legendaire','divin','lumiere',  8,10,50,7,'Immortalite','Revient avec 25 PV',''],
  ];
  const add200 = db.transaction(() => {
    let added = 0;
    for (const c of cards200) {
      const exists = db.prepare('SELECT id FROM cards WHERE name = ?').get(c[0]);
      if (!exists) { insert200.run(...c); added++; }
    }
    if (added > 0) console.log(`${added} nouvelles cartes ajoutees (pool 200).`);
  });
  add200();
}

// --- Boosters ---
const BOOSTERS = [
  {
    id: 'origines',
    name: 'BOOSTER ORIGINES',
    description: '5 cartes du monde originel.',
    price: 300,
    cardsPerPack: 5,
    weights: { commune: 60, rare: 25, epique: 12, legendaire: 3 }
  }
];

function rollRarity(weights) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [rarity, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return rarity;
  }
  return 'commune';
}

function openBooster(boosterId, userId) {
  const booster = BOOSTERS.find(b => b.id === boosterId);
  if (!booster) return null;

  const drawnCards = [];
  const insertCard = db.prepare('INSERT INTO user_cards (user_id, card_id, is_shiny) VALUES (?, ?, ?)');

  for (let i = 0; i < booster.cardsPerPack; i++) {
    const rarity = rollRarity(booster.weights);
    const cards = db.prepare('SELECT * FROM cards WHERE rarity = ?').all(rarity);
    const card = cards[Math.floor(Math.random() * cards.length)];
    const isShiny = Math.random() < 0.05 ? 1 : 0;
    insertCard.run(userId, card.id, isShiny);
    drawnCards.push({ ...card, is_shiny: isShiny });
  }

  return drawnCards;
}

// ============================================
// SYSTEME DE COMBAT - Abilities
// ============================================
const ABILITY_MAP = {
  'Charge':         { type: 'buff_atk',          value: 2 },
  'Rempart':        { type: 'buff_def',          value: 4 },
  'Bouclier algue': { type: 'buff_def',          value: 3 },
  'Morsure':        { type: 'direct_damage',     value: 2 },
  'Boule de feu':   { type: 'direct_damage',     value: 5 },
  'Jugement divin': { type: 'direct_damage',     value: 10 },
  'Tir percant':    { type: 'ignore_def',        value: 0 },
  'Traversee':      { type: 'ignore_def',        value: 0 },
  'Drain de vie':   { type: 'drain',             damage: 4, heal: 2 },
  'Souffle ardent': { type: 'aoe_damage',        value: 6 },
  'Renaissance':    { type: 'revive',            value: 15 },
  'Seisme':         { type: 'stun',              damage: 3 },
  'Flash':          { type: 'stun',              damage: 0 },
  'Chant envoutant':{ type: 'debuff_atk',        value: 3 },
  'Embuscade':      { type: 'first_turn_damage', value: 3 },
  'Jonglerie':      { type: 'random_damage',     damage: 2, hits: 2 },
  // --- Nouvelles abilities (pool 200 cartes) ---
  'Griffure':         { type: 'direct_damage',     value: 2 },
  'Coup de poing':    { type: 'direct_damage',     value: 1 },
  'Mur de pierre':    { type: 'buff_def',          value: 2 },
  'Elan':             { type: 'buff_atk',          value: 1 },
  'Piqure':           { type: 'direct_damage',     value: 1 },
  'Toxine':           { type: 'debuff_atk',        value: 2 },
  'Morsure rapide':   { type: 'first_turn_damage', value: 2 },
  'Carapace':         { type: 'buff_def',          value: 2 },
  'Cri de guerre':    { type: 'buff_atk',          value: 2 },
  'Siphon':           { type: 'drain',             damage: 2, heal: 1 },
  'Rafale':           { type: 'random_damage',     damage: 1, hits: 3 },
  'Ecran de fumee':   { type: 'buff_def',          value: 3 },
  'Effroi':           { type: 'stun',              damage: 0 },
  'Paralysie':        { type: 'stun',              damage: 0 },
  'Coup sournois':    { type: 'first_turn_damage', value: 3 },
  'Regeneration':     { type: 'drain',             damage: 1, heal: 2 },
  'Passe-muraille':   { type: 'ignore_def',        value: 0 },
  'Galop':            { type: 'buff_atk',          value: 3 },
  'Ronces':           { type: 'stun',              damage: 2 },
  'Frappe lourde':    { type: 'direct_damage',     value: 4 },
  'Forteresse':       { type: 'buff_def',          value: 5 },
  'Frenzy':           { type: 'random_damage',     damage: 2, hits: 3 },
  'Vague glacee':     { type: 'stun',              damage: 2 },
  'Malediction':      { type: 'debuff_atk',        value: 4 },
  'Coup fatal':       { type: 'first_turn_damage', value: 5 },
  'Soif de sang':     { type: 'drain',             damage: 4, heal: 3 },
  'Lame spectrale':   { type: 'ignore_def',        value: 0 },
  'Benediction':      { type: 'buff_def',          value: 4 },
  'Guerison':         { type: 'drain',             damage: 2, heal: 4 },
  'Rage':             { type: 'buff_atk',          value: 4 },
  'Pluie de feu':     { type: 'aoe_damage',        value: 3 },
  'Rugissement':      { type: 'debuff_atk',        value: 3 },
  'Torrent':          { type: 'direct_damage',     value: 4 },
  'Corne sacree':     { type: 'drain',             damage: 3, heal: 3 },
  'Avalanche':        { type: 'aoe_damage',        value: 5 },
  'Marteau runique':  { type: 'direct_damage',     value: 7 },
  'Multi-tetes':      { type: 'random_damage',     damage: 3, hits: 3 },
  'Eveil naturel':    { type: 'drain',             damage: 5, heal: 4 },
  'Inferno':          { type: 'aoe_damage',        value: 6 },
  'Faux mortelle':    { type: 'ignore_def',        value: 0 },
  'Festin de sang':   { type: 'drain',             damage: 6, heal: 4 },
  'Terreur nocturne': { type: 'stun',              damage: 5 },
  'Lumiere divine':   { type: 'aoe_damage',        value: 5 },
  'Charge divine':    { type: 'first_turn_damage', value: 6 },
  'Purification':     { type: 'direct_damage',     value: 7 },
  'Raz-de-maree':     { type: 'aoe_damage',        value: 6 },
  'Trident royal':    { type: 'drain',             damage: 5, heal: 3 },
  'Colere terrestre': { type: 'aoe_damage',        value: 8 },
  'Renaissance totale':{ type: 'revive',           value: 25 },
  'Tsunami':          { type: 'aoe_damage',        value: 8 },
  'Sentence mortelle':{ type: 'direct_damage',     value: 15 },
  'Ragnarok':         { type: 'random_damage',     damage: 5, hits: 3 },
  'Foudre supreme':   { type: 'direct_damage',     value: 12 },
  'Supernova':        { type: 'aoe_damage',        value: 9 },
  'Immortalite':      { type: 'revive',            value: 25 },
  'Apocalypse':       { type: 'aoe_damage',        value: 9 },
  'Poids du monde':   { type: 'stun',              damage: 6 },
  'Abime':            { type: 'drain',             damage: 8, heal: 5 },
  'Blizzard':         { type: 'aoe_damage',        value: 7 },
};

function getEffectiveStats(card) {
  const mult = card.is_fused ? 2 : 1;
  return {
    attack: card.attack * mult,
    defense: card.defense * mult,
    hp: card.hp * mult,
  };
}

function getElementMod(attackerElem, defenderElem) {
  const adv = ELEMENT_ADVANTAGES[attackerElem];
  if (!adv) return 1;
  if (adv.strong === defenderElem) return 1.5;
  if (adv.weak === defenderElem) return 0.75;
  return 1;
}

function calcDamage(attacker, defender, ignoreDef) {
  const atkStats = attacker.effectiveStats || getEffectiveStats(attacker);
  const defStats = defender.effectiveStats || getEffectiveStats(defender);
  const defVal = ignoreDef ? 0 : (defStats.defense + (defender.buffDef || 0));
  const atkVal = atkStats.attack + (attacker.buffAtk || 0);
  const baseDamage = Math.max(1, atkVal - defVal);
  const elemMod = getElementMod(attacker.element, defender.element);
  return Math.max(1, Math.floor(baseDamage * elemMod));
}

// --- Battle state management ---
const activeBattles = new Map();

// Cleanup stale battles every 30 min
setInterval(() => {
  const now = Date.now();
  for (const [id, battle] of activeBattles) {
    if (now - battle.lastAction > 30 * 60 * 1000) {
      activeBattles.delete(id);
    }
  }
}, 5 * 60 * 1000);

let battleIdCounter = 1;

function createBattleState(playerCards, enemyCards, battleType, nodeId) {
  const battleId = 'battle_' + (battleIdCounter++);

  const makeUnit = (card, index, side) => {
    const es = getEffectiveStats(card);
    return {
      index,
      side,
      cardId: card.id,
      userCardId: card.user_card_id || null,
      name: card.name,
      image: card.image,
      rarity: card.rarity,
      type: card.type,
      element: card.element,
      attack: card.attack,
      defense: card.defense,
      hp: card.hp,
      is_fused: card.is_fused || 0,
      is_shiny: card.is_shiny || 0,
      ability_name: card.ability_name,
      ability_desc: card.ability_desc,
      effectiveStats: es,
      currentHp: es.hp,
      maxHp: es.hp,
      alive: true,
      buffAtk: 0,
      buffDef: 0,
      stunned: false,
      usedAbility: false,
      canRevive: card.ability_name === 'Renaissance',
    };
  };

  const state = {
    battleId,
    battleType,
    nodeId: nodeId || null,
    turn: 1,
    phase: 'player_turn',
    playerTeam: playerCards.map((c, i) => makeUnit(c, i, 'player')),
    enemyTeam: enemyCards.map((c, i) => makeUnit(c, i, 'enemy')),
    log: [],
    result: null,
    lastAction: Date.now(),
  };

  activeBattles.set(battleId, state);
  return state;
}

function resolveAbility(unit, targets, allAllies, allEnemies, battle) {
  const ability = ABILITY_MAP[unit.ability_name];
  if (!ability || unit.usedAbility) return [];
  unit.usedAbility = true;

  const events = [];
  const abilityName = unit.ability_name;

  switch (ability.type) {
    case 'buff_atk':
      unit.buffAtk += ability.value;
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${ability.value} ATK` });
      break;
    case 'buff_def':
      unit.buffDef += ability.value;
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${ability.value} DEF` });
      break;
    case 'direct_damage': {
      const target = targets[0] || allEnemies.find(e => e.alive);
      if (target) {
        target.currentHp = Math.max(0, target.currentHp - ability.value);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: ability.value });
        if (target.currentHp <= 0) checkKO(target, events);
      }
      break;
    }
    case 'ignore_def':
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Ignore DEF' });
      break;
    case 'drain': {
      const target = targets[0] || allEnemies.find(e => e.alive);
      if (target) {
        target.currentHp = Math.max(0, target.currentHp - ability.damage);
        unit.currentHp = Math.min(unit.maxHp, unit.currentHp + ability.heal);
        events.push({ type: 'ability_drain', unit: unit.name, target: target.name, ability: abilityName, damage: ability.damage, heal: ability.heal });
        if (target.currentHp <= 0) checkKO(target, events);
      }
      break;
    }
    case 'aoe_damage':
      allEnemies.filter(e => e.alive).forEach(enemy => {
        enemy.currentHp = Math.max(0, enemy.currentHp - ability.value);
        events.push({ type: 'ability_aoe', unit: unit.name, target: enemy.name, ability: abilityName, damage: ability.value });
        if (enemy.currentHp <= 0) checkKO(enemy, events);
      });
      break;
    case 'revive':
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Peut revenir avec ${ability.value} PV` });
      break;
    case 'stun': {
      const target = targets[0] || allEnemies.find(e => e.alive);
      if (target) {
        if (ability.damage > 0) {
          target.currentHp = Math.max(0, target.currentHp - ability.damage);
        }
        target.stunned = true;
        events.push({ type: 'ability_stun', unit: unit.name, target: target.name, ability: abilityName, damage: ability.damage || 0 });
        if (target.currentHp <= 0) checkKO(target, events);
      }
      break;
    }
    case 'debuff_atk': {
      const target = targets[0] || allEnemies.find(e => e.alive);
      if (target) {
        target.buffAtk -= ability.value;
        events.push({ type: 'ability_debuff', unit: unit.name, target: target.name, ability: abilityName, desc: `-${ability.value} ATK` });
      }
      break;
    }
    case 'first_turn_damage': {
      if (battle.turn === 1) {
        const target = targets[0] || allEnemies.find(e => e.alive);
        if (target) {
          target.currentHp = Math.max(0, target.currentHp - ability.value);
          events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: ability.value });
          if (target.currentHp <= 0) checkKO(target, events);
        }
      }
      break;
    }
    case 'random_damage': {
      for (let h = 0; h < ability.hits; h++) {
        const aliveEnemies = allEnemies.filter(e => e.alive);
        if (aliveEnemies.length === 0) break;
        const target = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
        target.currentHp = Math.max(0, target.currentHp - ability.damage);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: ability.damage });
        if (target.currentHp <= 0) checkKO(target, events);
      }
      break;
    }
  }
  return events;
}

function checkKO(unit, events) {
  if (unit.currentHp <= 0) {
    if (unit.canRevive) {
      const ability = ABILITY_MAP[unit.ability_name];
      unit.currentHp = ability.value;
      unit.canRevive = false;
      events.push({ type: 'revive', unit: unit.name, hp: ability.value });
    } else {
      unit.alive = false;
      events.push({ type: 'ko', unit: unit.name });
    }
  }
}

function checkWin(battle) {
  const playerAlive = battle.playerTeam.some(u => u.alive);
  const enemyAlive = battle.enemyTeam.some(u => u.alive);
  if (!enemyAlive) { battle.result = 'victory'; return 'victory'; }
  if (!playerAlive) { battle.result = 'defeat'; return 'defeat'; }
  return null;
}

function aiTurn(battle) {
  const events = [];
  const aliveEnemies = battle.enemyTeam.filter(u => u.alive);
  const alivePlayers = battle.playerTeam.filter(u => u.alive);

  for (const enemy of aliveEnemies) {
    if (!enemy.alive || alivePlayers.filter(p => p.alive).length === 0) continue;

    if (enemy.stunned) {
      enemy.stunned = false;
      events.push({ type: 'stunned', unit: enemy.name });
      continue;
    }

    // Ability on first attack
    if (!enemy.usedAbility) {
      const abilityEvents = resolveAbility(enemy, alivePlayers, battle.enemyTeam, battle.playerTeam, battle);
      events.push(...abilityEvents);
      if (checkWin(battle)) return events;
    }

    // Target weakest player
    const currentAlivePlayers = battle.playerTeam.filter(p => p.alive);
    if (currentAlivePlayers.length === 0) break;
    const target = currentAlivePlayers.reduce((a, b) => a.currentHp < b.currentHp ? a : b);

    const ignoreDef = ABILITY_MAP[enemy.ability_name]?.type === 'ignore_def';
    const dmg = calcDamage(enemy, target, ignoreDef);
    target.currentHp = Math.max(0, target.currentHp - dmg);
    events.push({ type: 'attack', attacker: enemy.name, attackerIndex: enemy.index, target: target.name, targetIndex: target.index, damage: dmg, side: 'enemy' });

    if (target.currentHp <= 0) checkKO(target, events);
    if (checkWin(battle)) return events;
  }

  return events;
}

// ============================================
// CAMPAGNE - 15 noeuds
// ============================================
const CAMPAIGN_NODES = [
  { id: 0,  name: 'Foret des Debutants',  reward: 50,  dropChance: 0.10, enemies: [{ rarity: 'commune', count: 3 }], statMult: 1.0 },
  { id: 1,  name: 'Plaines Brumeuses',    reward: 75,  dropChance: 0.11, enemies: [{ rarity: 'commune', count: 3 }], statMult: 1.2 },
  { id: 2,  name: 'Marais Sombres',       reward: 80,  dropChance: 0.13, enemies: [{ rarity: 'commune', count: 3 }], statMult: 1.4 },
  { id: 3,  name: 'Collines Ventees',     reward: 100, dropChance: 0.14, enemies: [{ rarity: 'commune', count: 2 }, { rarity: 'rare', count: 1 }], statMult: 1.6 },
  { id: 4,  name: 'Village Abandonne',    reward: 120, dropChance: 0.16, enemies: [{ rarity: 'commune', count: 2 }, { rarity: 'rare', count: 1 }], statMult: 1.8 },
  { id: 5,  name: 'Caverne des Echos',    reward: 150, dropChance: 0.17, enemies: [{ rarity: 'commune', count: 1 }, { rarity: 'rare', count: 2 }], statMult: 2.0 },
  { id: 6,  name: 'Riviere Gelee',        reward: 175, dropChance: 0.19, enemies: [{ rarity: 'rare', count: 3 }], statMult: 2.2 },
  { id: 7,  name: 'Tour de Garde',        reward: 200, dropChance: 0.20, enemies: [{ rarity: 'rare', count: 2 }, { rarity: 'epique', count: 1 }], statMult: 2.4 },
  { id: 8,  name: 'Desert de Cendres',    reward: 225, dropChance: 0.21, enemies: [{ rarity: 'rare', count: 2 }, { rarity: 'epique', count: 1 }], statMult: 2.6 },
  { id: 9,  name: 'Foret Maudite',        reward: 250, dropChance: 0.23, enemies: [{ rarity: 'rare', count: 1 }, { rarity: 'epique', count: 2 }], statMult: 2.8 },
  { id: 10, name: 'Citadelle Noire',      reward: 300, dropChance: 0.24, enemies: [{ rarity: 'epique', count: 3 }], statMult: 3.0 },
  { id: 11, name: 'Pic des Tempetes',     reward: 350, dropChance: 0.26, enemies: [{ rarity: 'epique', count: 2 }, { rarity: 'legendaire', count: 1 }], statMult: 3.2 },
  { id: 12, name: 'Abime des Ombres',     reward: 400, dropChance: 0.27, enemies: [{ rarity: 'epique', count: 2 }, { rarity: 'legendaire', count: 1 }], statMult: 3.4 },
  { id: 13, name: 'Volcan Ancien',        reward: 450, dropChance: 0.29, enemies: [{ rarity: 'epique', count: 1 }, { rarity: 'legendaire', count: 2 }], statMult: 3.6 },
  { id: 14, name: 'Sanctuaire Celeste',   reward: 500, dropChance: 0.30, enemies: [{ rarity: 'legendaire', count: 3 }], statMult: 3.6 },
];

function generateEnemies(node) {
  const enemies = [];
  for (const group of node.enemies) {
    const pool = db.prepare('SELECT * FROM cards WHERE rarity = ?').all(group.rarity);
    for (let i = 0; i < group.count; i++) {
      const card = pool[Math.floor(Math.random() * pool.length)];
      enemies.push({
        ...card,
        is_fused: 0,
        is_shiny: 0,
        attack: Math.round(card.attack * node.statMult),
        defense: Math.round(card.defense * node.statMult),
        hp: Math.round(card.hp * node.statMult),
      });
    }
  }
  return enemies;
}

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'gacha-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Non connecte' });
  }
  next();
}

// --- Routes AUTH ---
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs requis' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Pseudo: 3-20 caracteres' });
  if (password.length < 4) return res.status(400).json({ error: 'Mot de passe: 4 caracteres min' });

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Pseudo deja pris' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password, credits) VALUES (?, ?, 1000)').run(username, hash);
  req.session.userId = result.lastInsertRowid;
  req.session.username = username;
  res.json({ success: true, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs requis' });

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Identifiants incorrects' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// --- Routes USER ---
app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT username, credits, last_daily FROM users WHERE id = ?').get(req.session.userId);
  const cardCount = db.prepare('SELECT COUNT(*) as c FROM user_cards WHERE user_id = ?').get(req.session.userId).c;

  const today = new Date().toISOString().split('T')[0];
  const canClaimDaily = user.last_daily !== today;

  res.json({
    username: user.username,
    credits: user.credits,
    cardCount,
    canClaimDaily
  });
});

app.post('/api/daily', requireAuth, (req, res) => {
  const user = db.prepare('SELECT credits, last_daily FROM users WHERE id = ?').get(req.session.userId);
  const today = new Date().toISOString().split('T')[0];

  if (user.last_daily === today) {
    return res.status(400).json({ error: 'Deja recupere aujourd\'hui !' });
  }

  const DAILY_AMOUNT = 200;
  db.prepare('UPDATE users SET credits = credits + ?, last_daily = ? WHERE id = ?')
    .run(DAILY_AMOUNT, today, req.session.userId);

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.session.userId).credits;
  res.json({ success: true, amount: DAILY_AMOUNT, credits: newCredits });
});

// --- Routes BOUTIQUE ---
app.get('/api/boosters', requireAuth, (req, res) => {
  res.json(BOOSTERS);
});

app.post('/api/boosters/:id/open', requireAuth, (req, res) => {
  const booster = BOOSTERS.find(b => b.id === req.params.id);
  if (!booster) return res.status(404).json({ error: 'Booster introuvable' });

  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.session.userId);
  if (user.credits < booster.price) {
    return res.status(400).json({ error: 'Pas assez de credits !' });
  }

  db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(booster.price, req.session.userId);
  const cards = openBooster(booster.id, req.session.userId);
  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.session.userId).credits;

  res.json({ success: true, cards, credits: newCredits });
});

// --- Routes COLLECTION (updated with shiny/fused grouping) ---
app.get('/api/collection', requireAuth, (req, res) => {
  const cards = db.prepare(`
    SELECT c.*, uc.is_shiny, uc.is_fused, COUNT(*) as count, MIN(uc.id) as user_card_id
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ?
    GROUP BY c.id, uc.is_shiny, uc.is_fused
    ORDER BY
      CASE c.rarity WHEN 'legendaire' THEN 1 WHEN 'epique' THEN 2 WHEN 'rare' THEN 3 WHEN 'commune' THEN 4 END,
      uc.is_fused DESC, uc.is_shiny DESC, c.attack DESC
  `).all(req.session.userId);
  res.json(cards);
});

// --- Route VENTE (updated: accept user_card_id, shiny/fused price multipliers) ---
app.post('/api/collection/sell', requireAuth, (req, res) => {
  const { card_id, user_card_id } = req.body;

  let userCard;
  if (user_card_id) {
    userCard = db.prepare('SELECT uc.*, c.rarity, c.name FROM user_cards uc JOIN cards c ON uc.card_id = c.id WHERE uc.id = ? AND uc.user_id = ?')
      .get(user_card_id, req.session.userId);
  } else if (card_id) {
    userCard = db.prepare('SELECT uc.*, c.rarity, c.name FROM user_cards uc JOIN cards c ON uc.card_id = c.id WHERE uc.card_id = ? AND uc.user_id = ? LIMIT 1')
      .get(card_id, req.session.userId);
  }

  if (!userCard) return res.status(400).json({ error: 'Carte introuvable' });

  let sellPrice = SELL_PRICES[userCard.rarity] || 0;
  if (userCard.is_shiny) sellPrice *= 3;
  if (userCard.is_fused) sellPrice *= 2;

  const sellTransaction = db.transaction(() => {
    db.prepare('DELETE FROM user_cards WHERE id = ?').run(userCard.id);
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(sellPrice, req.session.userId);
  });

  try {
    sellTransaction();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.session.userId).credits;
  const collection = db.prepare(`
    SELECT c.*, uc.is_shiny, uc.is_fused, COUNT(*) as count, MIN(uc.id) as user_card_id
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ?
    GROUP BY c.id, uc.is_shiny, uc.is_fused
    ORDER BY
      CASE c.rarity WHEN 'legendaire' THEN 1 WHEN 'epique' THEN 2 WHEN 'rare' THEN 3 WHEN 'commune' THEN 4 END,
      uc.is_fused DESC, uc.is_shiny DESC, c.attack DESC
  `).all(req.session.userId);

  res.json({ success: true, credits: newCredits, soldPrice: sellPrice, collection });
});

app.get('/api/sell-prices', requireAuth, (req, res) => {
  res.json(SELL_PRICES);
});

app.get('/api/elements', (req, res) => {
  res.json({ config: ELEMENT_CONFIG, advantages: ELEMENT_ADVANTAGES });
});

// ============================================
// FUSION ROUTES
// ============================================
app.get('/api/fusion/available', requireAuth, (req, res) => {
  const cards = db.prepare(`
    SELECT c.*, COUNT(*) as count
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ? AND uc.is_fused = 0 AND uc.is_shiny = 0
    GROUP BY c.id
    HAVING count >= 5
    ORDER BY
      CASE c.rarity WHEN 'legendaire' THEN 1 WHEN 'epique' THEN 2 WHEN 'rare' THEN 3 WHEN 'commune' THEN 4 END,
      c.attack DESC
  `).all(req.session.userId);
  res.json(cards);
});

app.post('/api/fusion', requireAuth, (req, res) => {
  const { card_id } = req.body;
  if (!card_id) return res.status(400).json({ error: 'card_id requis' });

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(card_id);
  if (!card) return res.status(404).json({ error: 'Carte introuvable' });

  const copies = db.prepare(
    'SELECT id FROM user_cards WHERE user_id = ? AND card_id = ? AND is_fused = 0 AND is_shiny = 0 ORDER BY id LIMIT 5'
  ).all(req.session.userId, card_id);

  if (copies.length < 5) {
    return res.status(400).json({ error: 'Il faut 5 copies non-fusionnees' });
  }

  const success = Math.random() < 0.35;

  const fusionTransaction = db.transaction(() => {
    for (const copy of copies) {
      db.prepare('DELETE FROM user_cards WHERE id = ?').run(copy.id);
    }
    if (success) {
      db.prepare('INSERT INTO user_cards (user_id, card_id, is_fused) VALUES (?, ?, 1)')
        .run(req.session.userId, card_id);
    }
  });

  try {
    fusionTransaction();
  } catch (e) {
    return res.status(500).json({ error: 'Erreur lors de la fusion' });
  }

  res.json({ success: true, fused: success, card });
});

// ============================================
// CAMPAIGN ROUTES
// ============================================
app.get('/api/campaign/progress', requireAuth, (req, res) => {
  let progress = db.prepare('SELECT * FROM campaign_progress WHERE user_id = ?').get(req.session.userId);
  if (!progress) {
    db.prepare('INSERT INTO campaign_progress (user_id) VALUES (?)').run(req.session.userId);
    progress = { current_node: 0, completed_nodes: '[]' };
  }
  const completed = JSON.parse(progress.completed_nodes || '[]');
  res.json({
    currentNode: progress.current_node,
    completedNodes: completed,
    nodes: CAMPAIGN_NODES.map(n => ({
      id: n.id,
      name: n.name,
      reward: n.reward,
      enemies: n.enemies,
      locked: n.id > 0 && !completed.includes(n.id - 1) && n.id !== progress.current_node,
      completed: completed.includes(n.id),
    }))
  });
});

app.post('/api/campaign/start', requireAuth, (req, res) => {
  const { nodeId, team } = req.body;
  if (nodeId === undefined || !team || team.length !== 3) {
    return res.status(400).json({ error: 'nodeId et team (3 cartes) requis' });
  }

  const node = CAMPAIGN_NODES[nodeId];
  if (!node) return res.status(404).json({ error: 'Noeud introuvable' });

  let progress = db.prepare('SELECT * FROM campaign_progress WHERE user_id = ?').get(req.session.userId);
  if (!progress) {
    db.prepare('INSERT INTO campaign_progress (user_id) VALUES (?)').run(req.session.userId);
    progress = { current_node: 0, completed_nodes: '[]' };
  }
  const completed = JSON.parse(progress.completed_nodes || '[]');

  if (nodeId > 0 && !completed.includes(nodeId - 1) && nodeId !== progress.current_node) {
    return res.status(400).json({ error: 'Noeud verrouille' });
  }

  // Load player cards
  const playerCards = [];
  for (const ucId of team) {
    const uc = db.prepare(`
      SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, c.*
      FROM user_cards uc JOIN cards c ON uc.card_id = c.id
      WHERE uc.id = ? AND uc.user_id = ?
    `).get(ucId, req.session.userId);
    if (!uc) return res.status(400).json({ error: `Carte ${ucId} introuvable` });
    playerCards.push(uc);
  }

  const enemies = generateEnemies(node);
  const battle = createBattleState(playerCards, enemies, 'campaign', nodeId);

  res.json({
    battleId: battle.battleId,
    playerTeam: battle.playerTeam,
    enemyTeam: battle.enemyTeam,
    turn: battle.turn,
    phase: battle.phase,
  });
});

// ============================================
// BATTLE ACTION (shared campaign + pvp)
// ============================================
app.post('/api/battle/action', requireAuth, (req, res) => {
  const { battleId, attackerIndex, targetIndex } = req.body;

  const battle = activeBattles.get(battleId);
  if (!battle) return res.status(404).json({ error: 'Combat introuvable' });

  battle.lastAction = Date.now();

  const attacker = battle.playerTeam[attackerIndex];
  const target = battle.enemyTeam[targetIndex];

  if (!attacker || !target) return res.status(400).json({ error: 'Index invalide' });
  if (!attacker.alive) return res.status(400).json({ error: 'Cette carte est KO' });
  if (!target.alive) return res.status(400).json({ error: 'Cible deja KO' });

  const events = [];

  // Player stunned check
  if (attacker.stunned) {
    attacker.stunned = false;
    events.push({ type: 'stunned', unit: attacker.name });
  } else {
    // Player ability (first use)
    if (!attacker.usedAbility) {
      const abilityEvents = resolveAbility(attacker, [target], battle.playerTeam, battle.enemyTeam, battle);
      events.push(...abilityEvents);
    }

    if (checkWin(battle)) {
      return res.json({ events, ...getBattleSnapshot(battle) });
    }

    // Normal attack (if target still alive)
    if (target.alive) {
      const ignoreDef = ABILITY_MAP[attacker.ability_name]?.type === 'ignore_def';
      const dmg = calcDamage(attacker, target, ignoreDef);
      target.currentHp = Math.max(0, target.currentHp - dmg);
      events.push({ type: 'attack', attacker: attacker.name, attackerIndex, target: target.name, targetIndex, damage: dmg, side: 'player' });

      if (target.currentHp <= 0) checkKO(target, events);
    }
  }

  let result = checkWin(battle);
  if (result) {
    return res.json({ events, ...getBattleSnapshot(battle) });
  }

  // AI turn
  const aiEvents = aiTurn(battle);
  events.push(...aiEvents);

  battle.turn++;

  // Reset buffs each turn
  battle.playerTeam.forEach(u => { u.buffAtk = 0; u.buffDef = 0; });
  battle.enemyTeam.forEach(u => { u.buffAtk = 0; u.buffDef = 0; });

  res.json({ events, ...getBattleSnapshot(battle) });
});

function getBattleSnapshot(battle) {
  return {
    battleId: battle.battleId,
    playerTeam: battle.playerTeam,
    enemyTeam: battle.enemyTeam,
    turn: battle.turn,
    result: battle.result,
  };
}

// ============================================
// BATTLE END (distribute rewards)
// ============================================
app.post('/api/battle/end', requireAuth, (req, res) => {
  const { battleId } = req.body;
  const battle = activeBattles.get(battleId);
  if (!battle) return res.status(404).json({ error: 'Combat introuvable' });

  let reward = 0;
  let droppedCard = null;

  if (battle.result === 'victory') {
    if (battle.battleType === 'campaign') {
      const node = CAMPAIGN_NODES[battle.nodeId];
      if (node) {
        reward = node.reward;

        // Update progress
        let progress = db.prepare('SELECT * FROM campaign_progress WHERE user_id = ?').get(req.session.userId);
        const completed = JSON.parse(progress.completed_nodes || '[]');
        if (!completed.includes(battle.nodeId)) {
          completed.push(battle.nodeId);
        }
        const nextNode = Math.max(progress.current_node, battle.nodeId + 1);
        db.prepare('UPDATE campaign_progress SET completed_nodes = ?, current_node = ? WHERE user_id = ?')
          .run(JSON.stringify(completed), Math.min(nextNode, 14), req.session.userId);

        // Card drop
        if (Math.random() < node.dropChance) {
          const rarities = node.enemies.map(e => e.rarity);
          const dropRarity = rarities[Math.floor(Math.random() * rarities.length)];
          const pool = db.prepare('SELECT * FROM cards WHERE rarity = ?').all(dropRarity);
          if (pool.length > 0) {
            droppedCard = pool[Math.floor(Math.random() * pool.length)];
            db.prepare('INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)').run(req.session.userId, droppedCard.id);
          }
        }
      }
    } else if (battle.battleType === 'pvp') {
      reward = 150;
    }
  } else if (battle.result === 'defeat' && battle.battleType === 'pvp') {
    reward = 25;
  }

  if (reward > 0) {
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(reward, req.session.userId);
  }

  // Log battle
  db.prepare('INSERT INTO battle_log (user_id, battle_type, opponent_info, result, reward_credits) VALUES (?, ?, ?, ?, ?)')
    .run(req.session.userId, battle.battleType, battle.battleType === 'pvp' ? 'PvP' : `Node ${battle.nodeId}`, battle.result, reward);

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.session.userId).credits;

  activeBattles.delete(battleId);

  res.json({
    success: true,
    result: battle.result,
    reward,
    credits: newCredits,
    droppedCard,
  });
});

// ============================================
// PVP ROUTES
// ============================================
app.post('/api/pvp/set-team', requireAuth, (req, res) => {
  const { cardIds } = req.body;
  if (!cardIds || cardIds.length !== 3) return res.status(400).json({ error: '3 cartes requises' });

  for (const ucId of cardIds) {
    const uc = db.prepare('SELECT id FROM user_cards WHERE id = ? AND user_id = ?').get(ucId, req.session.userId);
    if (!uc) return res.status(400).json({ error: `Carte ${ucId} introuvable` });
  }

  const existing = db.prepare('SELECT id FROM pvp_teams WHERE user_id = ?').get(req.session.userId);
  if (existing) {
    db.prepare('UPDATE pvp_teams SET card1_id = ?, card2_id = ?, card3_id = ? WHERE user_id = ?')
      .run(cardIds[0], cardIds[1], cardIds[2], req.session.userId);
  } else {
    db.prepare('INSERT INTO pvp_teams (user_id, card1_id, card2_id, card3_id) VALUES (?, ?, ?, ?)')
      .run(req.session.userId, cardIds[0], cardIds[1], cardIds[2]);
  }

  res.json({ success: true });
});

app.get('/api/pvp/team', requireAuth, (req, res) => {
  const team = db.prepare('SELECT * FROM pvp_teams WHERE user_id = ?').get(req.session.userId);
  if (!team) return res.json({ team: null });

  const cards = [];
  for (const colName of ['card1_id', 'card2_id', 'card3_id']) {
    if (team[colName]) {
      const uc = db.prepare(`
        SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, c.*
        FROM user_cards uc JOIN cards c ON uc.card_id = c.id
        WHERE uc.id = ?
      `).get(team[colName]);
      if (uc) cards.push(uc);
    }
  }

  res.json({ team: cards });
});

app.post('/api/pvp/find-opponent', requireAuth, (req, res) => {
  const opponent = db.prepare(`
    SELECT pt.*, u.username FROM pvp_teams pt
    JOIN users u ON pt.user_id = u.id
    WHERE pt.user_id != ?
    ORDER BY RANDOM() LIMIT 1
  `).get(req.session.userId);

  if (!opponent) return res.status(404).json({ error: 'Aucun adversaire disponible' });

  const cards = [];
  for (const colName of ['card1_id', 'card2_id', 'card3_id']) {
    if (opponent[colName]) {
      const uc = db.prepare(`
        SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, c.*
        FROM user_cards uc JOIN cards c ON uc.card_id = c.id
        WHERE uc.id = ?
      `).get(opponent[colName]);
      if (uc) cards.push(uc);
    }
  }

  res.json({
    opponentUserId: opponent.user_id,
    opponentName: opponent.username,
    opponentTeam: cards,
  });
});

app.post('/api/pvp/start', requireAuth, (req, res) => {
  const { opponentUserId, team } = req.body;
  if (!opponentUserId || !team || team.length !== 3) {
    return res.status(400).json({ error: 'opponentUserId et team (3 cartes) requis' });
  }

  // Load player cards
  const playerCards = [];
  for (const ucId of team) {
    const uc = db.prepare(`
      SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, c.*
      FROM user_cards uc JOIN cards c ON uc.card_id = c.id
      WHERE uc.id = ? AND uc.user_id = ?
    `).get(ucId, req.session.userId);
    if (!uc) return res.status(400).json({ error: `Carte ${ucId} introuvable` });
    playerCards.push(uc);
  }

  // Load opponent cards
  const oppTeam = db.prepare('SELECT * FROM pvp_teams WHERE user_id = ?').get(opponentUserId);
  if (!oppTeam) return res.status(404).json({ error: 'Adversaire sans equipe' });

  const enemyCards = [];
  for (const colName of ['card1_id', 'card2_id', 'card3_id']) {
    if (oppTeam[colName]) {
      const uc = db.prepare(`
        SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, c.*
        FROM user_cards uc JOIN cards c ON uc.card_id = c.id
        WHERE uc.id = ?
      `).get(oppTeam[colName]);
      if (uc) enemyCards.push(uc);
    }
  }

  if (enemyCards.length === 0) return res.status(400).json({ error: 'Equipe adverse invalide' });

  const battle = createBattleState(playerCards, enemyCards, 'pvp', null);

  res.json({
    battleId: battle.battleId,
    playerTeam: battle.playerTeam,
    enemyTeam: battle.enemyTeam,
    turn: battle.turn,
    phase: battle.phase,
  });
});

// ============================================
// ADMIN SYSTEM
// ============================================
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Non connecte' });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'Acces refuse' });
  next();
}

// Check if current user is admin
app.get('/api/admin/check', requireAuth, (req, res) => {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  res.json({ isAdmin: !!(user && user.is_admin) });
});

// Dashboard stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalCards = db.prepare('SELECT COUNT(*) as c FROM user_cards').get().c;
  const totalCardTypes = db.prepare('SELECT COUNT(*) as c FROM cards').get().c;
  const totalBattles = db.prepare('SELECT COUNT(*) as c FROM battle_log').get().c;
  const totalPvpTeams = db.prepare('SELECT COUNT(*) as c FROM pvp_teams').get().c;
  res.json({ totalUsers, totalCards, totalCardTypes, totalBattles, totalPvpTeams });
});

// List all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.credits, u.is_admin, u.created_at,
           (SELECT COUNT(*) FROM user_cards WHERE user_id = u.id) as card_count
    FROM users u ORDER BY u.id
  `).all();
  res.json(users);
});

// Give credits to a user
app.post('/api/admin/give-credits', requireAdmin, (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount) return res.status(400).json({ error: 'userId et amount requis' });
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(amount, userId);
  const updated = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  res.json({ success: true, username: user.username, newCredits: updated.credits });
});

// Give a card to a user
app.post('/api/admin/give-card', requireAdmin, (req, res) => {
  const { userId, cardId, isShiny, isFused } = req.body;
  if (!userId || !cardId) return res.status(400).json({ error: 'userId et cardId requis' });
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card) return res.status(404).json({ error: 'Carte introuvable' });
  db.prepare('INSERT INTO user_cards (user_id, card_id, is_shiny, is_fused) VALUES (?, ?, ?, ?)')
    .run(userId, cardId, isShiny ? 1 : 0, isFused ? 1 : 0);
  res.json({ success: true, username: user.username, card: card.name });
});

// List all card templates
app.get('/api/admin/cards', requireAdmin, (req, res) => {
  const cards = db.prepare('SELECT * FROM cards ORDER BY id').all();
  res.json(cards);
});

// Create a new card template
app.post('/api/admin/create-card', requireAdmin, (req, res) => {
  const { name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, image } = req.body;
  if (!name || !rarity || !type || !element) return res.status(400).json({ error: 'Champs obligatoires manquants' });

  const existing = db.prepare('SELECT id FROM cards WHERE name = ?').get(name);
  if (existing) return res.status(409).json({ error: 'Une carte avec ce nom existe deja' });

  const result = db.prepare(`
    INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, rarity, type, element, attack || 1, defense || 1, hp || 10, mana_cost || 1, ability_name || 'Aucun', ability_desc || '-', image || '');

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, card });
});

// Modify an existing card template
app.post('/api/admin/modify-card', requireAdmin, (req, res) => {
  const { cardId, name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, image } = req.body;
  if (!cardId) return res.status(400).json({ error: 'cardId requis' });

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card) return res.status(404).json({ error: 'Carte introuvable' });

  db.prepare(`
    UPDATE cards SET
      name = ?, rarity = ?, type = ?, element = ?,
      attack = ?, defense = ?, hp = ?, mana_cost = ?,
      ability_name = ?, ability_desc = ?, image = ?
    WHERE id = ?
  `).run(
    name || card.name, rarity || card.rarity, type || card.type, element || card.element,
    attack ?? card.attack, defense ?? card.defense, hp ?? card.hp, mana_cost ?? card.mana_cost,
    ability_name || card.ability_name, ability_desc || card.ability_desc, image ?? card.image,
    cardId
  );

  const updated = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  res.json({ success: true, card: updated });
});

// Delete a card template
app.post('/api/admin/delete-card', requireAdmin, (req, res) => {
  const { cardId } = req.body;
  if (!cardId) return res.status(400).json({ error: 'cardId requis' });
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card) return res.status(404).json({ error: 'Carte introuvable' });
  db.prepare('DELETE FROM user_cards WHERE card_id = ?').run(cardId);
  db.prepare('DELETE FROM cards WHERE id = ?').run(cardId);
  res.json({ success: true, deletedCard: card.name });
});

// Reset a user (delete all cards, reset credits, reset campaign)
app.post('/api/admin/reset-user', requireAdmin, (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId requis' });
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  db.prepare('DELETE FROM user_cards WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM campaign_progress WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM pvp_teams WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM battle_log WHERE user_id = ?').run(userId);
  db.prepare('UPDATE users SET credits = 1000 WHERE id = ?').run(userId);
  res.json({ success: true, username: user.username });
});

// Set user credits to exact amount
app.post('/api/admin/set-credits', requireAdmin, (req, res) => {
  const { userId, credits } = req.body;
  if (!userId || credits === undefined) return res.status(400).json({ error: 'userId et credits requis' });
  db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(credits, userId);
  res.json({ success: true });
});

// --- User cards list (for team selection) ---
app.get('/api/my-cards', requireAuth, (req, res) => {
  const cards = db.prepare(`
    SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, c.*
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ?
    ORDER BY
      CASE c.rarity WHEN 'legendaire' THEN 1 WHEN 'epique' THEN 2 WHEN 'rare' THEN 3 WHEN 'commune' THEN 4 END,
      uc.is_fused DESC, uc.is_shiny DESC, c.attack DESC
  `).all(req.session.userId);
  res.json(cards);
});

// --- Pages ---
app.get('/menu', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'menu.html')); });
app.get('/shop', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'shop.html')); });
app.get('/collection', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'collection.html')); });
app.get('/fusion', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'fusion.html')); });
app.get('/combat', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'combat.html')); });
app.get('/campaign', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'campaign.html')); });
app.get('/battle', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'battle.html')); });
app.get('/pvp', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'pvp.html')); });
app.get('/admin', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/menu');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Gacha Game lance sur http://localhost:${PORT}`);
});
