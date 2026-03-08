const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// --- Prix de vente par rareté ---
const SELL_PRICES = {
  commune: 30,
  rare: 75,
  epique: 150,
  legendaire: 400,
  chaos: 1000,
  secret: 2000
};

// --- Base de données (chemin configurable via env pour Railway volume) ---
const DB_DIR = process.env.DB_PATH || __dirname;
const DB_FILE = path.join(DB_DIR, 'gacha.db');
const BACKUP_DIR = path.join(DB_DIR, 'backups');

// Créer les dossiers si nécessaire
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

console.log(`[DB] Chemin base de donnees: ${DB_FILE}`);
const db = new Database(DB_FILE);
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

// --- Migration : ajout colonnes avatar et display_name ---
{
  const userCols2 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols2.includes('avatar')) {
    db.exec("ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT '⚔'");
    console.log('Migration: avatar ajouté');
  }
  if (!userCols2.includes('display_name')) {
    db.exec("ALTER TABLE users ADD COLUMN display_name TEXT DEFAULT ''");
    console.log('Migration: display_name ajouté');
  }
}

// --- Migration : ajout colonne excavation_essence ---
{
  const userCols3 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userCols3.includes('excavation_essence')) {
    db.exec("ALTER TABLE users ADD COLUMN excavation_essence INTEGER DEFAULT 0");
    console.log('Migration: excavation_essence ajouté');
  }
}

// --- Tables Mine ---
db.exec(`
  CREATE TABLE IF NOT EXISTS mine_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    grid TEXT NOT NULL DEFAULT '[]',
    hidden_charbon INTEGER DEFAULT 0,
    hidden_fer INTEGER DEFAULT 0,
    hidden_or INTEGER DEFAULT 0,
    hidden_diamant INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS mine_inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    resource TEXT NOT NULL,
    slot_index INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, slot_index)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS mine_upgrades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    mine_speed INTEGER DEFAULT 0,
    inventory_size INTEGER DEFAULT 0,
    luck INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Migration: last_sell_at pour cooldown mine
{
  const cols = db.prepare("PRAGMA table_info(mine_state)").all().map(c => c.name);
  if (!cols.includes('last_sell_at')) {
    db.exec("ALTER TABLE mine_state ADD COLUMN last_sell_at DATETIME DEFAULT NULL");
  }
}

// === BATTLE PASS ===
db.exec(`
  CREATE TABLE IF NOT EXISTS battle_pass (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    xp INTEGER DEFAULT 0,
    current_tier INTEGER DEFAULT 0,
    claimed_tiers TEXT DEFAULT '[]',
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Migration: unlocked_avatars + username_effect
{
  const userColsBP = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userColsBP.includes('unlocked_avatars')) {
    db.exec(`ALTER TABLE users ADD COLUMN unlocked_avatars TEXT DEFAULT '["⚔"]'`);
    console.log('Migration: unlocked_avatars ajouté');
  }
  if (!userColsBP.includes('username_effect')) {
    db.exec("ALTER TABLE users ADD COLUMN username_effect TEXT DEFAULT ''");
    console.log('Migration: username_effect ajouté');
  }
}

// === QUETES & SUCCES ===
db.exec(`
  CREATE TABLE IF NOT EXISTS user_quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    quest_key TEXT NOT NULL,
    type TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    goal INTEGER NOT NULL,
    reward_credits INTEGER DEFAULT 0,
    reward_xp INTEGER DEFAULT 0,
    claimed INTEGER DEFAULT 0,
    assigned_date TEXT NOT NULL,
    UNIQUE(user_id, quest_key, assigned_date)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    achievement_key TEXT NOT NULL,
    unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    claimed INTEGER DEFAULT 0,
    UNIQUE(user_id, achievement_key)
  )
`);

// Migration: stat columns on users
{
  const statCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  const statMigrations = [
    ['stat_boosters_opened', 'INTEGER DEFAULT 0'],
    ['stat_pvp_wins', 'INTEGER DEFAULT 0'],
    ['stat_diamonds_mined', 'INTEGER DEFAULT 0'],
    ['stat_fusions', 'INTEGER DEFAULT 0'],
    ['stat_casino_spins', 'INTEGER DEFAULT 0'],
    ['stat_credits_spent', 'INTEGER DEFAULT 0']
  ];
  for (const [col, type] of statMigrations) {
    if (!statCols.includes(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
      console.log(`Migration: ${col} ajouté`);
    }
  }
}

// Migration: login streak + additional stat columns
{
  const cols2 = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  const newMigrations = [
    ['login_streak', 'INTEGER DEFAULT 0'],
    ['last_streak_date', "TEXT DEFAULT ''"],
    ['stat_pvp_losses', 'INTEGER DEFAULT 0'],
    ['stat_casino_won', 'INTEGER DEFAULT 0'],
    ['stat_total_earned', 'INTEGER DEFAULT 0'],
    ['stat_fusion_success', 'INTEGER DEFAULT 0'],
    ['stat_fusion_fail', 'INTEGER DEFAULT 0'],
    ['stat_boosters_origines', 'INTEGER DEFAULT 0'],
    ['stat_boosters_rift', 'INTEGER DEFAULT 0'],
    ['stat_boosters_avance', 'INTEGER DEFAULT 0']
  ];
  for (const [col, type] of newMigrations) {
    if (!cols2.includes(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
      console.log(`Migration: ${col} ajouté`);
    }
  }
}

// === FRIENDS & CHAT ===
db.exec(`
  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, friend_id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_chat_sr ON chat_messages(sender_id, receiver_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_friend_uid ON friendships(user_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_friend_fid ON friendships(friend_id)');

// === GIFT CODES ===
db.exec(`
  CREATE TABLE IF NOT EXISTS gift_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    credits INTEGER DEFAULT 0,
    card_id INTEGER DEFAULT NULL,
    card_quantity INTEGER DEFAULT 1,
    is_shiny INTEGER DEFAULT 0,
    max_uses INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active INTEGER DEFAULT 1
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS gift_code_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(code_id, user_id)
  )
`);

// --- Seed compte admin ---
{
  const adminUser = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminUser) {
    const hash = bcrypt.hashSync('Gx$9kL#mQ2vR7!', 10);
    db.prepare('INSERT INTO users (username, password, credits, is_admin) VALUES (?, ?, 999999, 1)').run('admin', hash);
    console.log('Compte admin cree');
  } else {
    const newHash = bcrypt.hashSync('Gx$9kL#mQ2vR7!', 10);
    db.prepare('UPDATE users SET is_admin = 1, password = ? WHERE username = ?').run(newHash, 'admin');
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

// --- Système d'éléments (3 classes uniquement) ---
const ELEMENT_ADVANTAGES = {
  feu:   { strong: 'terre', weak: 'eau' },
  terre: { strong: 'eau',   weak: 'feu' },
  eau:   { strong: 'feu',   weak: 'terre' }
};

const ELEMENT_CONFIG = {
  feu:   { icon: '🔥', color: '#ff4422', name: 'Feu' },
  eau:   { icon: '💧', color: '#2299ff', name: 'Eau' },
  terre: { icon: '🌿', color: '#44aa33', name: 'Terre' }
};

// --- Progression de mana par tour ---
const MANA_PROGRESSION = [0, 1, 2, 3, 3, 4, 5, 6]; // index = tour
function getManaForTurn(turn) {
  if (turn <= 0) return 1;
  if (turn >= MANA_PROGRESSION.length) return 6;
  return MANA_PROGRESSION[turn];
}

// --- Cartes : pas de seed automatique, ajout via admin ou script ---
// Les cartes seront ajoutees manuellement

// --- Anciennes migrations de cartes supprimees ---
// Les cartes seront ajoutees via l'admin ou par script

// --- Migrations schema ---
{
  const cardCols = db.prepare("PRAGMA table_info(cards)").all().map(c => c.name);
  if (!cardCols.includes('emoji')) {
    db.exec("ALTER TABLE cards ADD COLUMN emoji TEXT DEFAULT ''");
    console.log('Migration: colonne emoji ajoutee');
  }
  if (!cardCols.includes('passive_desc')) {
    db.exec("ALTER TABLE cards ADD COLUMN passive_desc TEXT DEFAULT ''");
    console.log('Migration: colonne passive_desc ajoutee');
  }
  if (!cardCols.includes('crystal_cost')) {
    db.exec("ALTER TABLE cards ADD COLUMN crystal_cost REAL DEFAULT 1.0");
    console.log('Migration: colonne crystal_cost ajoutee');
  }
}

// --- Seed : cartes de base (8 cartes) ---
{
  const count = db.prepare('SELECT COUNT(*) as c FROM cards').get().c;
  if (count === 0) {
    const insertCard = db.prepare(`
      INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, emoji, passive_desc, crystal_cost)
      VALUES (?, ?, 'creature', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const seedCards = [
      // [name, rarity, element, atk, def, hp, mana, ability_name, ability_desc, emoji, passive_desc, crystal_cost]
      ['Goblin',              'commune',  'terre', 1, 1, 2,  1, 'Appel gobelin',    'Ajoute un Goblin 1/1/1 dans votre main','🗡️', '+1 ATK si un autre Goblin est sur le terrain', 1.0],
      ['Tortue des Rivieres', 'commune',  'eau',   1, 4, 5,  4, 'Carapace marine',  '+2 DEF a un allie jusqu au prochain tour', '🐢', 'Les unites Eau alliees invoquees gagnent +1 PV', 1.0],
      ['Serpent des Marees',  'rare',     'eau',   2, 1, 2,  2, 'Frappe empoisonnee','Empoisonne : 1 degat/tour pendant 4 tours', '🐍', '', 1.0],
      ['Mage de Foudre',     'rare',     'eau',   3, 1, 2,  3, 'Eclair',           '2 degats a une cible (ignore la DEF)', '🌊', '1ere action du tour: 3 degats au lieu de 2', 1.0],
      ['Esprit des Forets',  'rare',     'terre', 1, 3, 4,  3, 'Croissance',       'Invoque une Pousse (0/1/1) qui evolue','🌿', 'Les unites Terre alliees gagnent +1 DEF', 1.5],
      ['Salamandre Ardente', 'rare',     'feu',   3, 1, 3,  3, 'Flamme adjacente', '1 degat a la cible et aux adjacents. Si tue : +1 ATK tour suivant', '🦎', '', 1.0],
      ['Dragonnet de Braise','epique',   'feu',   3, 2, 3,  4, 'Souffle de braise','1 degat a tous les ennemis',           '🐉', 'Si une unite meurt ce tour, +1 ATK temporaire', 1.5],
      ['Golem de Roche',     'epique',   'terre', 2, 5, 6,  5, 'Fortification',    '+2 DEF jusqu a fin du tour',           '🪨', 'Subit 1 degat de moins de toutes les attaques', 1.0],
      // Legendaires
      ['Phoenix Ancestral',  'legendaire','feu',  4, 2, 5,  5, 'Renaissance',      'Ressuscite avec 3 PV a la mort (1x)',  '🔥', 'Inflige 1 degat a tous les ennemis en debut de tour', 2.0],
      ['Leviathan Abyssal',  'legendaire','eau',  3, 4, 8,  6, 'Raz-de-maree',     '3 degats a tous les ennemis',          '🌊', 'Les unites ennemies perdent 1 ATK en debut de tour', 2.0],
      ['Titan Originel',     'legendaire','terre',5, 6, 10, 7, 'Seisme',           '2 degats a tous + stun 1 tour',        '⛰️', 'Immunise aux effets de controle (stun, renvoi)', 2.0],
    ];
    const addSeed = db.transaction(() => {
      for (const c of seedCards) {
        insertCard.run(...c);
      }
      console.log(`${seedCards.length} cartes de base ajoutees.`);
    });
    addSeed();
  }
}

// --- Migration : ajout legendaires si absentes ---
{
  const legCount = db.prepare("SELECT COUNT(*) as c FROM cards WHERE rarity = 'legendaire'").get().c;
  if (legCount === 0) {
    const insertLeg = db.prepare(`
      INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, emoji, passive_desc, crystal_cost)
      VALUES (?, ?, 'creature', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const legendaries = [
      ['Phoenix Ancestral',  'legendaire','feu',  4, 2, 5,  5, 'Renaissance',      'Ressuscite avec 3 PV a la mort (1x)',  '🔥', 'Inflige 1 degat a tous les ennemis en debut de tour', 2.0],
      ['Leviathan Abyssal',  'legendaire','eau',  3, 4, 8,  6, 'Raz-de-maree',     '3 degats a tous les ennemis',          '🌊', 'Les unites ennemies perdent 1 ATK en debut de tour', 2.0],
      ['Titan Originel',     'legendaire','terre',5, 6, 10, 7, 'Seisme',           '2 degats a tous + stun 1 tour',        '⛰️', 'Immunise aux effets de controle (stun, renvoi)', 2.0],
    ];
    for (const c of legendaries) insertLeg.run(...c);
    console.log('Migration: 3 cartes legendaires ajoutees.');
  }
}

// --- Migration : is_temp sur user_cards ---
{
  const ucCols = db.prepare("PRAGMA table_info(user_cards)").all().map(c => c.name);
  if (!ucCols.includes('is_temp')) {
    db.exec("ALTER TABLE user_cards ADD COLUMN is_temp INTEGER DEFAULT 0");
    console.log('Migration: is_temp ajoute');
  }
}

// --- Migration : 10 nouvelles cartes + 4 crystaux ---
{
  const hasCrabe = db.prepare("SELECT id FROM cards WHERE name = 'Crabe de Maree'").get();
  if (!hasCrabe) {
    const insertNew = db.prepare(`
      INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, emoji, passive_desc, crystal_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const newCards = [
      ['Crabe de Maree',        'commune', 'creature', 'eau',    1, 3, 3, 2, 'Carapace reactive',  'Statut: +1 DEF permanent quand attaquee', '🦀', '', 1.0],
      ['Soldat de Terre',       'commune', 'creature', 'terre',  2, 2, 3, 2, 'Garde de terre',     '+1 DEF',                                  '🪖', '', 1.0],
      ['Poisson Combattant',    'commune', 'creature', 'eau',    1, 1, 2, 1, 'Aucun',              '-',                                       '🐟', 'Peut attaquer immediatement apres invocation', 1.0],
      ['Archer des Collines',   'commune', 'creature', 'terre',  2, 1, 2, 2, 'Tir traitre',        'x2 degats aux cibles endormies',          '🏹', '', 1.0],
      ['Guerrier des Falaises', 'rare',    'creature', 'terre',  3, 2, 3, 3, 'Ralliement',         '+1 ATK par unite Terre alliee',            '⛰️', '', 1.0],
      ['Requin des Profondeurs','rare',    'creature', 'eau',    4, 1, 3, 4, 'Morsure sauvage',    '+1 degat aux cibles blessees',             '🦈', 'Apres avoir detruit une unite, peut attaquer une 2e fois ce tour', 1.0],
      ['Sapeur de Terre',       'commune', 'creature', 'terre',  2, 1, 3, 2, 'Aucun',              '-',                                       '⛏️', 'En arrivant, gagne +1 ATK jusqu a fin du tour suivant', 1.0],
      ['Eclaireur des Dunes',   'commune', 'creature', 'terre',  0, 1, 4, 1, 'Soins naturels',     'Soigne 1 PV a un allie (2 si Terre)',      '🏜️', 'Si seule sur le terrain, +2 DEF', 1.0],
      ['Gardien du Recif',      'commune', 'creature', 'eau',    1, 2, 4, 2, 'Protection marine',  '+1 DEF a un allie Eau',                    '🪸', '', 1.0],
      ['Titan de Magma',        'epique',  'creature', 'feu',    5, 3, 6, 4, 'Eruption',           '2 degats a tous les ennemis Eau',          '🌋', 'Les ennemis qui attaquent cette unite subissent 1 degat', 1.2],
    ];
    const crystalCards = [
      ['Crystal Commun',     'commune',    'objet', 'neutre', 0, 0, 0, 1, 'Crystal commun',     'Ajoute 0.4 crystal',  '💎', '', 0],
      ['Crystal Rare',       'rare',       'objet', 'neutre', 0, 0, 0, 1, 'Crystal rare',       'Ajoute 0.8 crystal',  '💎', '', 0],
      ['Crystal Epique',     'epique',     'objet', 'neutre', 0, 0, 0, 1, 'Crystal epique',     'Ajoute 1.2 crystal',  '💎', '', 0],
      ['Crystal Legendaire', 'legendaire', 'objet', 'neutre', 0, 0, 0, 1, 'Crystal legendaire', 'Ajoute 1.8 crystal',  '💎', '', 0],
    ];
    db.transaction(() => {
      for (const c of newCards) insertNew.run(...c);
      for (const c of crystalCards) insertNew.run(...c);
    })();
    console.log('Migration: 10 nouvelles cartes + 4 crystaux ajoutes');
  }
}

// --- Migration : Rework Phoenix Ancestral (swap pouvoir/passif) ---
{
  const phoenix = db.prepare("SELECT id, ability_name FROM cards WHERE name = 'Phoenix Ancestral'").get();
  if (phoenix && phoenix.ability_name === 'Renaissance') {
    db.prepare(`UPDATE cards SET
      ability_name = 'Aura de flamme',
      ability_desc = 'Inflige 1 degat a tous les ennemis',
      passive_desc = 'Ressuscite avec 3 PV a la mort (1x)'
    WHERE name = 'Phoenix Ancestral'`).run();
    console.log('Migration: Phoenix Ancestral reworke');
  }
}

// --- Migration : Rework Leviathan Abyssal (legendaire → epique) ---
{
  const levi = db.prepare("SELECT id, rarity FROM cards WHERE name = 'Leviathan Abyssal'").get();
  if (levi && levi.rarity === 'legendaire') {
    db.prepare(`UPDATE cards SET
      rarity = 'epique', attack = 4, defense = 4, hp = 7, mana_cost = 5,
      ability_name = 'Vague ecrasante',
      ability_desc = 'Renvoie un ennemi en main + 2 degats',
      passive_desc = 'Les unites Eau alliees gagnent +1 ATK',
      crystal_cost = 1.4
    WHERE name = 'Leviathan Abyssal'`).run();
    console.log('Migration: Leviathan Abyssal reworke en epique');
  }
}

// --- Migration : Carte CHAOS - La Voie Lactee ---
{
  const hasVoieLactee = db.prepare("SELECT id FROM cards WHERE name = 'La Voie Lactee'").get();
  if (!hasVoieLactee) {
    db.prepare(`
      INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, emoji, passive_desc, crystal_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('La Voie Lactee', 'secret', 'creature', 'neutre', 2, 5, 10, 6, 'Quitte ou Double', 'Choisis un ennemi : 50% de chance de le tuer instantanement, 50% de chance de tuer ta carte', '🌌', 'Une carte La Voie Lactee max sur le plateau', 1.0);
    console.log('Migration: carte CHAOS La Voie Lactee ajoutee');
  }
}

// --- Migration : 5 nouvelles cartes v1.3.0 (Lumiere, Ombre, Feu, Eau) ---
{
  const hasPretresse = db.prepare("SELECT id FROM cards WHERE name = 'Pretresse Solaire'").get();
  if (!hasPretresse) {
    const insertV3 = db.prepare(`
      INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, emoji, passive_desc, crystal_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const v3Cards = [
      ['Pretresse Solaire',   'rare',       'divin',    'lumiere', 1, 2, 4, 3, 'Lumiere reparatrice', 'Soigne 3 PV a un allie cible',                      '☀️', 'Soigne 1 PV a l allie le plus blesse a chaque fin de tour', 1.5],
      ['Pyromancien Nomade',  'rare',       'mage',     'feu',     1, 1, 2, 2, 'Combustion',          'Inflige 2 degats a un ennemi, subit 1 degat soi-meme','🔥', 'Si un ennemi meurt par Combustion, l auto-degat est annule', 1.0],
      ['Hydre des Abysses',   'epique',     'bete',     'eau',     3, 2, 7, 5, 'Regeneration hydre',  'Gagne +1 ATK permanent (cumulable)',                  '🐙', 'Ne peut pas etre tuee en un seul coup (reste a 1 PV minimum)', 1.5],
      ['Archange Dechu',      'legendaire', 'divin',    'lumiere', 4, 3, 5, 5, 'Jugement celeste',    'Inflige des degats egaux a la DEF de la cible (ignore la DEF)', '👼', 'A sa mort, soigne tous les allies de 2 PV', 1.5],
      ['Faucheur d Ames',     'legendaire', 'guerrier', 'ombre',   6, 2, 6, 7, 'Moisson funeste',     'Tue instantanement un ennemi ayant 3 PV ou moins',   '💀', 'Chaque ennemi tue par Moisson funeste lui rend 2 PV et +1 ATK permanent', 2.0],
    ];
    db.transaction(() => {
      for (const c of v3Cards) insertV3.run(...c);
    })();
    console.log('Migration: 5 nouvelles cartes v1.3.0 ajoutees (Pretresse, Pyromancien, Hydre, Archange, Faucheur)');
  }
}

// --- Migration : MAJ descriptions Tortue & Crabe ---
{
  db.prepare("UPDATE cards SET ability_desc = '+2 DEF a un allie jusqu au prochain tour' WHERE name = 'Tortue des Rivieres'").run();
  db.prepare("UPDATE cards SET ability_desc = 'Statut: +1 DEF permanent quand attaquee' WHERE name = 'Crabe de Maree'").run();
  // v1.4.0 : MAJ descriptions et abilities
  db.prepare("UPDATE cards SET passive_desc = 'Peut attaquer immediatement apres invocation' WHERE name = 'Poisson Combattant'").run();
  db.prepare("UPDATE cards SET ability_name = 'Tir traitre', ability_desc = 'x2 degats aux cibles endormies' WHERE name = 'Archer des Collines'").run();
  db.prepare("UPDATE cards SET passive_desc = 'En arrivant, gagne +1 ATK jusqu a fin du tour suivant' WHERE name = 'Sapeur de Terre'").run();
  db.prepare("UPDATE cards SET ability_desc = '2 degats a une cible (ignore la DEF)' WHERE name = 'Mage de Foudre'").run();
  db.prepare("UPDATE cards SET ability_name = 'Frappe empoisonnee', ability_desc = 'Empoisonne : 1 degat/tour pendant 4 tours', passive_desc = '' WHERE name = 'Serpent des Marees'").run();
  db.prepare("UPDATE cards SET ability_desc = '1 degat a la cible et aux adjacents. Si tue : +1 ATK tour suivant', passive_desc = '' WHERE name = 'Salamandre Ardente'").run();
  db.prepare("UPDATE cards SET ability_desc = 'Statut: +1 ATK par unite Terre alliee' WHERE name = 'Guerrier des Falaises'").run();
  db.prepare("UPDATE cards SET rarity = 'legendaire' WHERE name = 'Archange Dechu'").run();
}

// --- Migration : La Voie Lactee → rareté SECRET ---
{
  const voieLactee = db.prepare("SELECT id, rarity FROM cards WHERE name = 'La Voie Lactee'").get();
  if (voieLactee && voieLactee.rarity === 'chaos') {
    db.prepare("UPDATE cards SET rarity = 'secret' WHERE name = 'La Voie Lactee'").run();
    console.log('Migration: La Voie Lactee promue en SECRET');
  }
}

// --- Migration : Carte SECRET - Koteons ---
{
  const hasKoteons = db.prepare("SELECT id FROM cards WHERE name = 'Koteons'").get();
  if (!hasKoteons) {
    db.prepare(`
      INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, emoji, passive_desc, crystal_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('Koteons', 'secret', 'creature', 'ombre', 3, 4, 8, 6, 'Action de Moderation', 'Supprime la capacite d une carte ennemie choisie pour le reste du combat', '😾', 'Les ennemis reduits au silence perdent 1 DEF', 2.0);
    console.log('Migration: carte SECRET Koteons ajoutee');
  }
}

// --- Migration : 11 nouvelles cartes v1.4.0 ---
{
  const newCards = [
    // COMMUNES (3)
    ['Sentinelle de Pierre', 'commune', 'guerrier', 'terre', 1, 4, 4, 3, 'Mur infranchissable', '+2 DEF ce tour, les ennemis doivent l attaquer en priorite (taunt)', '🗿', '', 1.0],
    ['Louveteau Sauvage', 'commune', 'bete', 'terre', 3, 0, 2, 1, 'Aucun', 'Aucun', '🐺', 'Peut attaquer immediatement. +1 ATK si un autre allie Bete est sur le terrain', 1.0],
    ['Acolyte de l Ombre', 'commune', 'mage', 'ombre', 1, 1, 3, 2, 'Malediction mineure', '-1 ATK a un ennemi (permanent)', '🦇', '', 1.0],
    // RARES (3)
    ['Chaman des Cendres', 'rare', 'mage', 'feu', 2, 1, 4, 3, 'Brasier guerisseur', 'Inflige 2 degats a un ennemi, soigne 2 HP a un allie', '🧙', '', 1.0],
    ['Spectre Glacial', 'rare', 'creature', 'eau', 2, 2, 3, 3, 'Toucher givre', 'Stun un ennemi pour 1 tour + inflige 1 degat', '👻', 'Ne peut pas etre cible par des attaques le tour apres son invocation', 1.0],
    ['Assassin Nocturne', 'rare', 'guerrier', 'ombre', 3, 1, 3, 3, 'Frappe fatale', 'Inflige degats x2 aux cibles avec 50% HP ou moins', '🗡️', '+1 ATK si l ennemi n a qu une seule carte sur le terrain', 1.0],
    // EPIQUES (2)
    ['Dragon des Abysses', 'epique', 'bete', 'eau', 4, 3, 6, 5, 'Tsunami devastateur', '2 degats a tous les ennemis + -1 DEF aux survivants', '🐲', 'Les allies Eau gagnent +1 ATK', 1.5],
    ['Paladin Sacre', 'epique', 'divin', 'lumiere', 3, 4, 7, 5, 'Aegis divin', 'Soigne 2 HP a tous les allies + bouclier de 2 a lui-meme', '⚜️', 'En mourant, confere +2 DEF permanent a l allie le plus faible', 1.5],
    // LEGENDAIRE (1)
    ['Izanami', 'legendaire', 'divin', 'ombre', 5, 3, 7, 6, 'Souffle du Yomi', 'Maudit tous les ennemis : -1 ATK et -1 DEF permanent. Si un ennemi a 2 HP ou moins il meurt instantanement', '👁️', 'Chaque ennemi qui meurt lui rend 2 HP et +1 ATK permanent', 2.0],
    // CHAOS (1)
    ['Le Neant Originel', 'chaos', 'creature', 'neutre', 0, 0, 12, 8, 'Effondrement cosmique', 'Detruit TOUTES les cartes sur le terrain (allies ET ennemis) puis inflige X degats directs a l adversaire (X = cartes detruites x2)', '🕳️', 'Ne peut ni attaquer ni etre attaque. Recoit +1 ATK chaque debut de tour. A 5 ATK l ability se declenche automatiquement. Max 1 sur le terrain', 1.0],
    // SECRET (1)
    ['Lumis', 'secret', 'creature', 'lumiere', 0, 10, 7, 5, 'Sacrifice radieux', 'Active le pouvoir : la carte se suicide au tour suivant et retire 5 PV directement au joueur adverse', '✨', '', 2.0],
  ];

  const insertCard = db.prepare(`
    INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, emoji, passive_desc, crystal_cost)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let addedCount = 0;
  for (const card of newCards) {
    const exists = db.prepare("SELECT id FROM cards WHERE name = ?").get(card[0]);
    if (!exists) {
      insertCard.run(...card);
      addedCount++;
    }
  }
  if (addedCount > 0) console.log('Migration: ' + addedCount + ' nouvelles cartes v1.4.0 ajoutees');
}

// --- Migration : 14 nouvelles cartes v1.5.0 ---
{
  const newCards2 = [
    // COMMUNES (5)
    ['Rat des Egouts', 'commune', 'bete', 'ombre', 2, 0, 1, 1, 'Morsure infectee', 'Empoisonne la cible (1 degat/tour, 2 tours)', '🐀', 'Si le Rat meurt, empoisonne son tueur (1 degat/tour, 2 tours)', 1.0],
    ['Moine Errant', 'commune', 'divin', 'lumiere', 0, 2, 4, 2, 'Meditation', 'Se soigne 2 HP et gagne +1 DEF permanent', '🧘', '', 1.0],
    ['Scarabee de Lave', 'commune', 'bete', 'feu', 2, 2, 2, 2, 'Aucun', 'Aucun', '🪲', 'Quand il meurt, inflige 1 degat a toutes les cartes ennemies (explosion)', 1.0],
    ['Espion des Brumes', 'commune', 'creature', 'eau', 1, 1, 2, 1, 'Infiltration', 'Pioche 1 carte supplementaire', '🌫️', 'Ne peut pas etre cible au premier tour', 1.0],
    ['Champignon Toxique', 'commune', 'creature', 'terre', 0, 0, 3, 1, 'Spores', 'Empoisonne tous les ennemis (1 degat, 1 tour)', '🍄', 'Ne peut pas attaquer. Meurt au bout de 3 tours', 1.0],
    // RARES (4)
    ['Valkyrie Dechue', 'rare', 'guerrier', 'lumiere', 3, 2, 4, 3, 'Jugement guerrier', 'Attaque un ennemi ; si elle le tue, se soigne 3 HP', '🪽', '+1 ATK quand un allie meurt (vengeance)', 1.0],
    ['Alchimiste Fou', 'rare', 'mage', 'feu', 2, 1, 3, 3, 'Transmutation', 'Transforme 2 HP d un allie en +2 ATK permanent pour cet allie', '⚗️', 'Si l allie booste tue un ennemi ce tour, l Alchimiste recupere 2 HP', 1.0],
    ['Ombre Mimetique', 'rare', 'creature', 'ombre', 0, 0, 3, 2, 'Copie', 'Copie l ATK et la DEF de n importe quelle carte sur le terrain', '🪞', 'Perd 1 HP par tour (instable)', 1.0],
    // EPIQUES (2)
    ['Chimere Elementaire', 'epique', 'bete', 'feu', 3, 3, 6, 5, 'Souffle triple', 'Inflige 3 degats a un ennemi (1 Feu + 1 Eau + 1 Terre, ignore resistances elementaires)', '🐲', 'Compte comme Feu, Eau ET Terre pour les synergies d elements', 1.5],
    ['Oracle du Temps', 'epique', 'divin', 'lumiere', 2, 3, 5, 4, 'Distorsion temporelle', 'Annule la derniere action de l adversaire et rejoue votre tour (1x/combat)', '⏳', '', 1.5],
    ['Colosse de Corail', 'epique', 'guerrier', 'eau', 3, 5, 8, 5, 'Recif vivant', 'Invoque un token Corail (0/2/2) sur chaque slot vide allie avec taunt', '🪸', '+1 DEF pour chaque token Corail en vie', 1.5],
    // LEGENDAIRES (2)
    ['Chronos', 'legendaire', 'divin', 'lumiere', 3, 4, 8, 7, 'Boucle temporelle', 'Reinitialise TOUTES les cartes du terrain a leurs stats d origine, annule tous les buffs/debuffs/poison/shield', '⌛', 'Immunise au stun, silence et poison. Debut de tour : un ennemi aleatoire perd son dernier buff', 2.0],
    ['Abyssia', 'legendaire', 'divin', 'eau', 4, 5, 8, 6, 'Maree montante', 'Inflige 2 degats a tous les ennemis. Les survivants ne peuvent pas attaquer au prochain tour', '🌊', 'Soigne 1 HP a tous les allies Eau en debut de tour. Quand un allie Eau meurt, gagne +2 ATK permanent', 2.0],
    // CHAOS (1)
    ['Le De du Destin', 'chaos', 'creature', 'neutre', 1, 1, 6, 3, 'Lancer divin', 'Lance un de (1-6) : 1=se tue, 2=rien, 3=+3 ATK, 4=3 degats AoE, 5=soigne tout le monde de 4 HP, 6=tue un ennemi aleatoire', '🎲', 'Debut de tour : ATK et DEF changent aleatoirement (0-4). Max 1 sur le terrain', 1.0],
  ];

  const insertCard2 = db.prepare(`
    INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, emoji, passive_desc, crystal_cost)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let addedCount2 = 0;
  for (const card of newCards2) {
    const exists = db.prepare("SELECT id FROM cards WHERE name = ?").get(card[0]);
    if (!exists) {
      insertCard2.run(...card);
      addedCount2++;
    }
  }
  if (addedCount2 > 0) console.log('Migration: ' + addedCount2 + ' nouvelles cartes v1.5.0 ajoutees');
}

// --- Tables Decks ---
db.exec(`
  CREATE TABLE IF NOT EXISTS decks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT 'Deck 1',
    is_pvp_deck INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS deck_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deck_id INTEGER NOT NULL,
    user_card_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    FOREIGN KEY (deck_id) REFERENCES decks(id),
    FOREIGN KEY (user_card_id) REFERENCES user_cards(id)
  )
`);

// --- Boosters ---
const BOOSTERS = [
  {
    id: 'origines',
    name: 'BOOSTER ORIGINES',
    description: '5 cartes du monde originel.',
    price: 300,
    cardsPerPack: 5,
    weights: { commune: 54.85, rare: 38, epique: 6, legendaire: 1, chaos: 0.1, secret: 0.05 },
    shinyRate: 0.007
  },
  {
    id: 'rift',
    name: 'BOOSTER RIFT',
    description: '7 cartes de la faille dimensionnelle.',
    price: 415,
    cardsPerPack: 7,
    weights: { commune: 54.85, rare: 38, epique: 6, legendaire: 1, chaos: 0.1, secret: 0.05 },
    shinyRate: 0.007
  },
  {
    id: 'avance',
    name: 'BOOSTER AVANCE',
    description: '8 cartes — legendaires boostees.',
    price: 915,
    cardsPerPack: 8,
    weights: { commune: 53.75, rare: 38, epique: 6, legendaire: 2.1, chaos: 0.1, secret: 0.05 },
    shinyRate: 0.01
  }
];

// ============================================
// SYSTEME DE MINE
// ============================================
const MINE_RESOURCES = {
  charbon: { name: 'Charbon', price: 3, weight: 60, resistMult: 1 },
  fer:     { name: 'Fer',     price: 12, weight: 25, resistMult: 1.2 },
  or:      { name: 'Or',      price: 20, weight: 12, resistMult: 1.5 },
  diamant: { name: 'Diamant', price: 50, weight: 3, resistMult: 2 }
};

const MINE_UPGRADES_CONFIG = {
  mine_speed:     { name: 'Pioche Amelioree', emoji: '⛏', maxLevel: 5, costs: [1,2,3,5,8], desc: '-1 coup necessaire par niveau' },
  inventory_size: { name: 'Sac Elargi',       emoji: '🎒', maxLevel: 5, costs: [1,1,2,3,5], desc: '+1 emplacement par niveau' },
  luck:           { name: 'Oeil du Mineur',    emoji: '👁', maxLevel: 3, costs: [2,4,8],     desc: 'Ressources rares plus frequentes' }
};

const BASE_INVENTORY_SLOTS = 5;
const MINE_GRID_SIZE = 20;

// ============================================
// PASSE DE COMBAT
// ============================================
const BATTLEPASS_TIERS = [
  { tier: 1,  xp_required: 100,  reward_type: 'credits',  reward_value: 200,           label: '200 Credits',       emoji: '💰' },
  { tier: 2,  xp_required: 120,  reward_type: 'avatar',   reward_value: '🎖',          label: 'Avatar: Medaille',  emoji: '🎖' },
  { tier: 3,  xp_required: 140,  reward_type: 'credits',  reward_value: 300,           label: '300 Credits',       emoji: '💰' },
  { tier: 4,  xp_required: 165,  reward_type: 'essence',  reward_value: 1,             label: '1 Essence',         emoji: '⛏' },
  { tier: 5,  xp_required: 190,  reward_type: 'card',     reward_value: 'commune',     label: 'Carte Commune',     emoji: '🃏' },
  { tier: 6,  xp_required: 220,  reward_type: 'credits',  reward_value: 400,           label: '400 Credits',       emoji: '💰' },
  { tier: 7,  xp_required: 250,  reward_type: 'avatar',   reward_value: '🐲',          label: 'Avatar: Dragon',    emoji: '🐲' },
  { tier: 8,  xp_required: 285,  reward_type: 'effect',   reward_value: 'matrix_green',label: 'Effet: Matrix',     emoji: '💚' },
  { tier: 9,  xp_required: 320,  reward_type: 'credits',  reward_value: 500,           label: '500 Credits',       emoji: '💰' },
  { tier: 10, xp_required: 360,  reward_type: 'essence',  reward_value: 2,             label: '2 Essences',        emoji: '⛏' },
  { tier: 11, xp_required: 400,  reward_type: 'card',     reward_value: 'rare',        label: 'Carte Rare',        emoji: '🃏' },
  { tier: 12, xp_required: 450,  reward_type: 'credits',  reward_value: 600,           label: '600 Credits',       emoji: '💰' },
  { tier: 13, xp_required: 500,  reward_type: 'avatar',   reward_value: '👁‍🗨',         label: 'Avatar: Oracle',    emoji: '👁‍🗨' },
  { tier: 14, xp_required: 550,  reward_type: 'credits',  reward_value: 700,           label: '700 Credits',       emoji: '💰' },
  { tier: 15, xp_required: 610,  reward_type: 'effect',   reward_value: 'blood_red',   label: 'Effet: Sang',       emoji: '❤' },
  { tier: 16, xp_required: 670,  reward_type: 'credits',  reward_value: 800,           label: '800 Credits',       emoji: '💰' },
  { tier: 17, xp_required: 740,  reward_type: 'essence',  reward_value: 2,             label: '2 Essences',        emoji: '⛏' },
  { tier: 18, xp_required: 810,  reward_type: 'avatar',   reward_value: '🐦‍🔥',         label: 'Avatar: Phoenix',   emoji: '🐦‍🔥' },
  { tier: 19, xp_required: 890,  reward_type: 'credits',  reward_value: 900,           label: '900 Credits',       emoji: '💰' },
  { tier: 20, xp_required: 970,  reward_type: 'card',     reward_value: 'epique',      label: 'Carte Epique',      emoji: '🃏' },
  { tier: 21, xp_required: 1060, reward_type: 'effect',   reward_value: 'cyber_blue',  label: 'Effet: Cyber',      emoji: '💙' },
  { tier: 22, xp_required: 1150, reward_type: 'credits',  reward_value: 1000,          label: '1000 Credits',      emoji: '💰' },
  { tier: 23, xp_required: 1250, reward_type: 'avatar',   reward_value: '🏴‍☠️',         label: 'Avatar: Pirate',    emoji: '🏴‍☠️' },
  { tier: 24, xp_required: 1350, reward_type: 'essence',  reward_value: 3,             label: '3 Essences',        emoji: '⛏' },
  { tier: 25, xp_required: 1460, reward_type: 'credits',  reward_value: 1200,          label: '1200 Credits',      emoji: '💰' },
  { tier: 26, xp_required: 1580, reward_type: 'card',     reward_value: 'legendaire',  label: 'Carte Legendaire',  emoji: '🃏' },
  { tier: 27, xp_required: 1700, reward_type: 'avatar',   reward_value: '🔱',          label: 'Avatar: Trident',   emoji: '🔱' },
  { tier: 28, xp_required: 1830, reward_type: 'effect',   reward_value: 'shadow_purple',label: 'Effet: Ombre',     emoji: '💜' },
  { tier: 29, xp_required: 1970, reward_type: 'credits',  reward_value: 1500,          label: '1500 Credits',      emoji: '💰' },
  { tier: 30, xp_required: 2100, reward_type: 'multi',    reward_value: { avatar: '👾', effect: 'rainbow_animated' }, label: 'Boss Final + Arc-en-ciel', emoji: '👾' },
];

const USERNAME_EFFECTS = {
  matrix_green:    { name: 'Matrix',        css: 'effect-matrix-green',   desc: 'Vert lumineux digital' },
  blood_red:       { name: 'Sang',          css: 'effect-blood-red',      desc: 'Rouge sang avec lueur sombre' },
  cyber_blue:      { name: 'Cyber',         css: 'effect-cyber-blue',     desc: 'Bleu neon electrique' },
  shadow_purple:   { name: 'Ombre',         css: 'effect-shadow-purple',  desc: 'Violet avec ombre profonde' },
  rainbow_animated:{ name: 'Arc-en-ciel',   css: 'effect-rainbow',        desc: 'Couleurs changeantes animees' }
};

const BP_XP = {
  booster_open:     25,
  daily_login:      40,
  campaign_win:     30,
  campaign_lose:     5,
  pvp_win:          35,
  pvp_lose:         10,
  pvp_realtime_win: 50,
  pvp_realtime_lose:15,
  mine_sell:        20,
  fusion:           15
};

// ============================================
// QUETES JOURNALIERES / HEBDOMADAIRES
// ============================================
const QUEST_POOL = {
  daily: [
    { key: 'open_boosters',  label: 'Ouvre {goal} booster(s)',        goal: [1,2,3], credits: 150, xp: 30, track: 'booster_open' },
    { key: 'win_pvp',        label: 'Gagne {goal} combat(s) PVP',    goal: [1,2],   credits: 200, xp: 40, track: 'pvp_win' },
    { key: 'mine_diamonds',  label: 'Mine {goal} diamant(s)',         goal: [3,5,8], credits: 150, xp: 25, track: 'diamond_mine' },
    { key: 'do_fusions',     label: 'Fais {goal} fusion(s)',          goal: [1,2],   credits: 100, xp: 20, track: 'fusion' },
    { key: 'earn_credits',   label: 'Gagne {goal} credits',          goal: [500,1000], credits: 200, xp: 35, track: 'credits_earned' },
    { key: 'claim_daily',    label: 'Recupere ton bonus du jour',    goal: [1],     credits: 50,  xp: 15, track: 'daily_claim' },
    { key: 'play_casino',    label: 'Joue {goal} fois au casino',    goal: [1,3],   credits: 100, xp: 20, track: 'casino_spin' },
  ],
  weekly: [
    { key: 'open_boosters_w', label: 'Ouvre {goal} boosters',        goal: [10,15], credits: 500, xp: 100, track: 'booster_open' },
    { key: 'win_pvp_w',       label: 'Gagne {goal} PVP',            goal: [5,10],  credits: 600, xp: 120, track: 'pvp_win' },
    { key: 'mine_diamonds_w', label: 'Mine {goal} diamants',        goal: [20,30], credits: 400, xp: 80,  track: 'diamond_mine' },
    { key: 'spend_credits_w', label: 'Depense {goal} credits',      goal: [2000,5000], credits: 500, xp: 90, track: 'credits_spent' },
    { key: 'casino_spins_w',  label: 'Joue {goal} fois au casino',  goal: [10,15], credits: 400, xp: 70,  track: 'casino_spin' },
  ]
};

// ============================================
// SUCCES / ACHIEVEMENTS
// ============================================
const ACHIEVEMENTS = [
  // Collection
  { key: 'collector_10',   label: 'Collectionneur Novice',   desc: '10 cartes',           icon: '🃏', check: (s) => s.cardCount >= 10,       credits: 200 },
  { key: 'collector_50',   label: 'Collectionneur Avance',   desc: '50 cartes',           icon: '📚', check: (s) => s.cardCount >= 50,       credits: 500 },
  { key: 'collector_100',  label: 'Maitre Collectionneur',   desc: '100 cartes',          icon: '👑', check: (s) => s.cardCount >= 100,      credits: 1000 },
  // Combat
  { key: 'first_pvp_win',  label: 'Premiere Victoire',       desc: '1 victoire PVP',      icon: '⚔',  check: (s) => s.pvpWins >= 1,         credits: 100 },
  { key: 'pvp_10',         label: 'Gladiateur',              desc: '10 victoires PVP',    icon: '🏆', check: (s) => s.pvpWins >= 10,        credits: 500 },
  { key: 'pvp_50',         label: 'Champion',                desc: '50 victoires PVP',    icon: '🥇', check: (s) => s.pvpWins >= 50,        credits: 1500 },
  // Mine
  { key: 'diamonds_10',    label: 'Chercheur',               desc: '10 diamants mines',   icon: '⛏',  check: (s) => s.diamondsMined >= 10,  credits: 200 },
  { key: 'diamonds_50',    label: 'Mineur Expert',           desc: '50 diamants mines',   icon: '💎', check: (s) => s.diamondsMined >= 50,  credits: 600 },
  // Boosters
  { key: 'boosters_10',    label: 'Deballeur',               desc: '10 boosters ouverts', icon: '📦', check: (s) => s.boostersOpened >= 10, credits: 200 },
  { key: 'boosters_50',    label: 'Accro aux Boosters',      desc: '50 boosters ouverts', icon: '🎁', check: (s) => s.boostersOpened >= 50, credits: 700 },
  // Fusion
  { key: 'fusion_first',   label: 'Alchimiste',              desc: '1 fusion',            icon: '🔮', check: (s) => s.fusions >= 1,         credits: 100 },
  { key: 'fusion_20',      label: 'Maitre Alchimiste',       desc: '20 fusions',          icon: '⚗',  check: (s) => s.fusions >= 20,        credits: 500 },
  // Casino
  { key: 'casino_first',   label: 'Parieur',                 desc: '1 spin casino',       icon: '🎰', check: (s) => s.casinoSpins >= 1,     credits: 50 },
  { key: 'casino_50',      label: 'Flambeur',                desc: '50 spins casino',     icon: '🎲', check: (s) => s.casinoSpins >= 50,    credits: 500 },
  // Passe
  { key: 'bp_max',         label: 'Combattant Ultime',       desc: 'Palier 30 du Passe',  icon: '🎖',  check: (s) => s.bpTier >= 30,         credits: 2000 },
  // Richesse
  { key: 'rich_5000',      label: 'Riche',                   desc: '5000 credits',        icon: '💰', check: (s) => s.credits >= 5000,      credits: 300 },
  { key: 'rich_20000',     label: 'Millionnaire',            desc: '20000 credits',       icon: '🏦', check: (s) => s.credits >= 20000,     credits: 1000 },
];

// ============================================
// CASINO
// ============================================
const CASINO_COST = 200;

// --- LOGIN STREAK ---
const STREAK_REWARDS = [
  { day: 1, credits: 200, card: null },
  { day: 2, credits: 250, card: null },
  { day: 3, credits: 300, card: null },
  { day: 4, credits: 350, card: null },
  { day: 5, credits: 400, card: null },
  { day: 6, credits: 450, card: null },
  { day: 7, credits: 500, card: 'rare' }
];

// --- DAILY SHOP ---
const DAILY_SHOP_PRICES = { rare: 200, epique: 500, legendaire: 1200 };
function seededRandom(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) { s = ((s << 5) - s) + seed.charCodeAt(i); s = s & s; }
  return function() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// --- ONLINE USERS ---
const onlineUsers = new Set();
const CASINO_SEGMENTS = [
  { label: 'PERDU',            color: '#333333', weight: 30,  reward: { type: 'nothing' } },
  { label: '50 CR',            color: '#2a5a2a', weight: 20,  reward: { type: 'credits', amount: 50 } },
  { label: '100 CR',           color: '#1a4a3a', weight: 15,  reward: { type: 'credits', amount: 100 } },
  { label: '200 CR',           color: '#3a7a3a', weight: 10,  reward: { type: 'credits', amount: 200 } },
  { label: '500 CR',           color: '#4a8a2a', weight: 6,   reward: { type: 'credits', amount: 500 } },
  { label: '1000 CR',          color: '#6aaa2a', weight: 3,   reward: { type: 'credits', amount: 1000 } },
  { label: '25 XP',            color: '#2a4a6a', weight: 8,   reward: { type: 'xp', amount: 25 } },
  { label: '50 XP',            color: '#3a5a8a', weight: 4,   reward: { type: 'xp', amount: 50 } },
  { label: 'CARTE RARE',       color: '#0066ff', weight: 2,   reward: { type: 'card', rarity: 'rare' } },
  { label: 'CARTE EPIQUE',     color: '#aa00ff', weight: 1,   reward: { type: 'card', rarity: 'epique' } },
  { label: 'JACKPOT SECRET',   color: '#ff0000', weight: 0.5, reward: { type: 'card', rarity: 'secret' } },
];

function getBattlePass(userId) {
  let bp = db.prepare('SELECT * FROM battle_pass WHERE user_id = ?').get(userId);
  if (!bp) {
    db.prepare('INSERT INTO battle_pass (user_id, xp, current_tier) VALUES (?, 0, 0)').run(userId);
    bp = { user_id: userId, xp: 0, current_tier: 0, claimed_tiers: '[]' };
  }
  return bp;
}

function addBattlePassXP(userId, amount) {
  if (amount <= 0) return null;
  const bp = getBattlePass(userId);
  const newXP = bp.xp + amount;

  let newTier = 0;
  let cumXP = 0;
  for (let i = 0; i < BATTLEPASS_TIERS.length; i++) {
    cumXP += BATTLEPASS_TIERS[i].xp_required;
    if (newXP >= cumXP) newTier = i + 1;
    else break;
  }

  db.prepare('UPDATE battle_pass SET xp = ?, current_tier = ? WHERE user_id = ?')
    .run(newXP, newTier, userId);
  return { xp: newXP, tier: newTier, xpGained: amount };
}

// ============================================
// HELPERS QUETES / SUCCES
// ============================================

function getISOWeek(d) {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function assignQuests(userId) {
  const today = new Date().toISOString().split('T')[0];
  const week = getISOWeek(new Date());

  // Check if daily quests already assigned today
  const dailyCount = db.prepare('SELECT COUNT(*) as c FROM user_quests WHERE user_id = ? AND type = ? AND assigned_date = ?').get(userId, 'daily', today).c;
  if (dailyCount === 0) {
    // Pick 3 random daily quests
    const pool = [...QUEST_POOL.daily];
    const selected = [];
    for (let i = 0; i < 3 && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      selected.push(pool.splice(idx, 1)[0]);
    }
    const insert = db.prepare('INSERT OR IGNORE INTO user_quests (user_id, quest_key, type, goal, reward_credits, reward_xp, assigned_date) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const q of selected) {
      const goal = q.goal[Math.floor(Math.random() * q.goal.length)];
      insert.run(userId, q.key, 'daily', goal, q.credits, q.xp, today);
    }
  }

  // Check if weekly quests already assigned this week
  const weeklyCount = db.prepare('SELECT COUNT(*) as c FROM user_quests WHERE user_id = ? AND type = ? AND assigned_date = ?').get(userId, 'weekly', week).c;
  if (weeklyCount === 0) {
    const pool = [...QUEST_POOL.weekly];
    const selected = [];
    for (let i = 0; i < 2 && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      selected.push(pool.splice(idx, 1)[0]);
    }
    const insert = db.prepare('INSERT OR IGNORE INTO user_quests (user_id, quest_key, type, goal, reward_credits, reward_xp, assigned_date) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const q of selected) {
      const goal = q.goal[Math.floor(Math.random() * q.goal.length)];
      insert.run(userId, q.key, 'weekly', goal, q.credits, q.xp, week);
    }
  }
}

function updateQuestProgress(userId, trackKey, amount = 1) {
  const today = new Date().toISOString().split('T')[0];
  const week = getISOWeek(new Date());

  // Find all active quests matching this trackKey
  const allQuestDefs = [...QUEST_POOL.daily, ...QUEST_POOL.weekly];
  const matchingKeys = allQuestDefs.filter(q => q.track === trackKey).map(q => q.key);
  if (matchingKeys.length === 0) return;

  for (const qk of matchingKeys) {
    // Update daily
    db.prepare('UPDATE user_quests SET progress = MIN(progress + ?, goal) WHERE user_id = ? AND quest_key = ? AND assigned_date = ? AND claimed = 0')
      .run(amount, userId, qk, today);
    // Update weekly
    db.prepare('UPDATE user_quests SET progress = MIN(progress + ?, goal) WHERE user_id = ? AND quest_key = ? AND assigned_date = ? AND claimed = 0')
      .run(amount, userId, qk, week);
  }
}

function getAchievementStats(userId) {
  const user = db.prepare('SELECT credits, stat_boosters_opened, stat_pvp_wins, stat_diamonds_mined, stat_fusions, stat_casino_spins, stat_credits_spent FROM users WHERE id = ?').get(userId);
  const cardCount = db.prepare('SELECT COUNT(*) as c FROM user_cards WHERE user_id = ?').get(userId).c;
  const bp = db.prepare('SELECT current_tier FROM battle_pass WHERE user_id = ?').get(userId);

  return {
    credits: user?.credits || 0,
    cardCount,
    pvpWins: user?.stat_pvp_wins || 0,
    diamondsMined: user?.stat_diamonds_mined || 0,
    boostersOpened: user?.stat_boosters_opened || 0,
    fusions: user?.stat_fusions || 0,
    casinoSpins: user?.stat_casino_spins || 0,
    creditsSpent: user?.stat_credits_spent || 0,
    bpTier: bp?.current_tier || 0
  };
}

function checkAchievements(userId) {
  const stats = getAchievementStats(userId);
  const already = db.prepare('SELECT achievement_key FROM user_achievements WHERE user_id = ?').all(userId).map(a => a.achievement_key);
  const insert = db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, achievement_key) VALUES (?, ?)');

  const newlyUnlocked = [];
  for (const ach of ACHIEVEMENTS) {
    if (already.includes(ach.key)) continue;
    if (ach.check(stats)) {
      insert.run(userId, ach.key);
      newlyUnlocked.push(ach);
    }
  }
  // Real-time notification
  for (const ach of newlyUnlocked) {
    const sock = userSocketMap.get(userId);
    if (sock && sock.connected) {
      sock.emit('achievement:unlocked', { key: ach.key, label: ach.label, icon: ach.icon });
    }
  }
  return newlyUnlocked;
}

function generateMineGrid(luckLevel = 0) {
  const grid = [];
  const counts = { charbon: 0, fer: 0, or: 0, diamant: 0 };

  // Adjust weights based on luck
  const weights = {};
  const luckBonus = luckLevel * 2;
  for (const [key, data] of Object.entries(MINE_RESOURCES)) {
    if (key === 'charbon') {
      weights[key] = Math.max(data.weight - luckBonus * 3, 20);
    } else {
      weights[key] = data.weight + luckBonus;
    }
  }
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  for (let i = 0; i < MINE_GRID_SIZE * MINE_GRID_SIZE; i++) {
    // Roll resource
    let roll = Math.random() * totalWeight;
    let resource = 'charbon';
    for (const [key, w] of Object.entries(weights)) {
      roll -= w;
      if (roll <= 0) { resource = key; break; }
    }

    // Resistance based on resource rarity
    const mult = MINE_RESOURCES[resource].resistMult;
    const resistance = Math.max(3, Math.floor((3 + Math.random() * 7) * mult));

    grid.push({ resource, resistance, hits: 0, mined: false, collected: false });
    counts[resource]++;
  }

  return { grid, counts };
}

function getMineUpgrades(userId) {
  let upgrades = db.prepare('SELECT * FROM mine_upgrades WHERE user_id = ?').get(userId);
  if (!upgrades) {
    db.prepare('INSERT INTO mine_upgrades (user_id) VALUES (?)').run(userId);
    upgrades = { mine_speed: 0, inventory_size: 0, luck: 0 };
  }
  return upgrades;
}

function getMineInventory(userId) {
  return db.prepare('SELECT * FROM mine_inventory WHERE user_id = ? ORDER BY slot_index').all(userId);
}

function getMaxSlots(userId) {
  const upgrades = getMineUpgrades(userId);
  return BASE_INVENTORY_SLOTS + upgrades.inventory_size;
}

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
  const insertCard = db.prepare('INSERT INTO user_cards (user_id, card_id, is_shiny, is_temp) VALUES (?, ?, ?, ?)');
  const shinyRate = booster.shinyRate || 0.02;

  for (let i = 0; i < booster.cardsPerPack; i++) {
    let rarity = rollRarity(booster.weights);
    let cards = db.prepare('SELECT * FROM cards WHERE rarity = ?').all(rarity);
    // Fallback : si aucune carte de cette rarete, descendre d'un cran
    if (!cards.length) {
      const fallbackOrder = ['secret', 'chaos', 'legendaire', 'epique', 'rare', 'commune'];
      const idx = fallbackOrder.indexOf(rarity);
      for (let f = idx + 1; f < fallbackOrder.length; f++) {
        cards = db.prepare('SELECT * FROM cards WHERE rarity = ?').all(fallbackOrder[f]);
        if (cards.length) { rarity = fallbackOrder[f]; break; }
      }
      if (!cards.length) continue;
    }
    const card = cards[Math.floor(Math.random() * cards.length)];
    const isShiny = Math.random() < shinyRate ? 1 : 0;
    // Crystal items sont toujours TEMP, sinon 8% de chance
    const isTemp = card.name.startsWith('Crystal ') ? 1 : (Math.random() < 0.08 ? 1 : 0);
    insertCard.run(userId, card.id, isShiny, isTemp);
    drawnCards.push({ ...card, is_shiny: isShiny, is_temp: isTemp });
  }

  // Chance de drop Essence d'Excavation (3% par carte tiree)
  const essenceGained = drawnCards.filter(() => Math.random() < 0.03).length;
  if (essenceGained > 0) {
    db.prepare('UPDATE users SET excavation_essence = excavation_essence + ? WHERE id = ?').run(essenceGained, userId);
    for (let e = 0; e < essenceGained; e++) {
      drawnCards.push({
        _isEssence: true,
        name: "Essence d'Excavation",
        rarity: 'epique',
        emoji: '⛏',
        type: 'essence',
        element: 'terre',
        attack: 0, defense: 0, hp: 0, mana_cost: 0,
        ability_name: 'Excavation',
        ability_desc: '+1 Essence d\'Excavation',
        passive_desc: '',
        is_shiny: 0, is_temp: 0
      });
    }
  }

  return drawnCards;
}

// ============================================
// SYSTEME DE COMBAT - Abilities
// ============================================
const ABILITY_MAP = {
  // ===== SEED CARD ABILITIES (keep original) =====
  'Charge':           { type: 'buff_atk',          value: 2 },
  'Rempart':          { type: 'buff_def',          value: 4 },
  'Bouclier algue':   { type: 'buff_def',          value: 3 },
  'Morsure':          { type: 'direct_damage',     value: 2 },
  'Boule de feu':     { type: 'direct_damage',     value: 5 },
  'Tir percant':      { type: 'ignore_def',        value: 0 },
  'Traversee':        { type: 'ignore_def',        value: 0 },
  'Drain de vie':     { type: 'drain',             damage: 4, heal: 2 },
  'Souffle ardent':   { type: 'aoe_damage',        value: 6 },
  'Seisme':           { type: 'stun',              damage: 3 },
  'Flash':            { type: 'stun',              damage: 0 },
  'Chant envoutant':  { type: 'debuff_atk',        value: 3 },
  'Embuscade':        { type: 'first_turn_damage', value: 3 },
  'Jonglerie':        { type: 'random_damage',     damage: 2, hits: 2 },

  // ===== COMMUNES - TERRE (unique per card) =====
  'Pioche brutale':     { type: 'direct_damage',     value: 2 },   // Mineur
  'Griffe de terre':    { type: 'direct_damage',     value: 2 },   // Taupe
  'Carapace blindee':   { type: 'buff_def',          value: 3 },   // Scarabee
  'Coup de massue':     { type: 'direct_damage',     value: 1 },   // Paysan
  'Mur mineral':        { type: 'buff_def',          value: 3 },   // Caillou vivant
  'Regeneration':       { type: 'drain',             damage: 1, heal: 2 },  // Ver de terre
  'Herbe toxique':      { type: 'debuff_atk',        value: 2 },   // Herboriste
  'Spores nocives':     { type: 'poison',            damage: 2 },  // Champignon
  'Tranchant rocheux':  { type: 'direct_damage',     value: 2 },   // Terrassier
  'Morsure de rat':     { type: 'first_turn_damage', value: 2 },   // Rat
  'Garde de pierre':    { type: 'buff_def',          value: 2 },   // Sentinelle
  'Nuee de mandibules': { type: 'random_damage',     damage: 1, hits: 3 },  // Fourmi
  'Coup bas':           { type: 'first_turn_damage', value: 3 },   // Brigand
  'Hache de bois':      { type: 'direct_damage',     value: 2 },   // Bucheron
  'Charge sauvage':     { type: 'buff_atk',          value: 2 },   // Sanglier
  'Piquants':           { type: 'counter',           value: 2 },   // Herisson
  'Elixir acide':       { type: 'drain',             damage: 2, heal: 1 },  // Alchimiste
  'Appel aux armes':    { type: 'buff_team_atk',     value: 1 },   // Fermier

  // ===== COMMUNES - EAU (18 unique) =====
  'Ecaille coupante':   { type: 'direct_damage',     value: 1 },   // Poisson
  'Pince acier':        { type: 'direct_damage',     value: 2 },   // Crabe
  'Filet marin':        { type: 'stun',              damage: 0 },  // Marin
  'Jet d encre':        { type: 'debuff_atk',        value: 2 },   // Pieuvre
  'Decharge electrique':{ type: 'stun',              damage: 1 },  // Meduse
  'Lance de corail':    { type: 'direct_damage',     value: 2 },   // Triton
  'Nage defensive':     { type: 'buff_def',          value: 2 },   // Hippocampe
  'Brume aquatique':    { type: 'debuff_def',        value: 2 },   // Nymphe
  'Sabre de bord':      { type: 'first_turn_damage', value: 2 },   // Pirate
  'Plongeon':           { type: 'first_turn_damage', value: 2 },   // Pelican
  'Glissade':           { type: 'buff_def',          value: 2 },   // Phoque
  'Barricade nacrée':   { type: 'buff_def',          value: 3 },   // Coquillage
  'Onde glaciale':      { type: 'direct_damage',     value: 2 },   // Naiade
  'Jeu aquatique':      { type: 'heal_ally',         value: 2 },   // Loutre
  'Cri du matelot':     { type: 'buff_atk',          value: 2 },   // Moussaillon
  'Electrocution':      { type: 'direct_damage',     value: 2 },   // Anguille
  'Retrait protecteur': { type: 'shield',            value: 3 },   // Tortue
  'Bec tranchant':      { type: 'direct_damage',     value: 1 },   // Mouette

  // ===== COMMUNES - FEU (19 unique) =====
  'Flamme dansante':    { type: 'direct_damage',     value: 2 },   // Torche
  'Queue enflammee':    { type: 'direct_damage',     value: 2 },   // Salamandre
  'Marteau ardent':     { type: 'buff_atk',          value: 2 },   // Forgeron
  'Brulure soudaine':   { type: 'first_turn_damage', value: 3 },   // Braise
  'Bombe artisanale':   { type: 'random_damage',     damage: 1, hits: 3 },  // Artificier
  'Croc brulant':       { type: 'first_turn_damage', value: 2 },   // Fennec
  'Epines brulantes':   { type: 'counter',           value: 2 },   // Cactus ardent
  'Combustion lente':   { type: 'poison',            damage: 2 },  // Charbon
  'Ecaille de braise':  { type: 'buff_def',          value: 2 },   // Lezard
  'Eruption mineure':   { type: 'direct_damage',     value: 2 },   // Volcanologue
  'Suie aveuglante':    { type: 'debuff_atk',        value: 2 },   // Charbonnier
  'Etincelle vive':     { type: 'first_turn_damage', value: 2 },   // Etincelle
  'Morsure de flamme':  { type: 'poison',            damage: 2 },  // Chien de feu
  'Pas de feu':         { type: 'buff_atk',          value: 2 },   // Danseur
  'Coulée de lave':     { type: 'direct_damage',     value: 2 },   // Magma
  'Broche ardente':     { type: 'heal_ally',         value: 2 },   // Cuisinier
  'Dard de flamme':     { type: 'first_turn_damage', value: 2 },   // Mouche de feu
  'Voile de cendres':   { type: 'buff_def',          value: 3 },   // Fumigene
  'Torche vive':        { type: 'direct_damage',     value: 1 },   // Flambeau

  // ===== COMMUNES - OMBRE (19 unique) =====
  'Cri ultrason':       { type: 'debuff_atk',        value: 2 },   // Chauve-souris
  'Toile collante':     { type: 'stun',              damage: 0 },  // Araignee
  'Lame furtive':       { type: 'first_turn_damage', value: 3 },   // Voleur
  'Mauvais presage':    { type: 'debuff_def',        value: 2 },   // Corbeau
  'Rongement':          { type: 'direct_damage',     value: 2 },   // Rat noir
  'Passe-muraille':     { type: 'ignore_def',        value: 0 },   // Spectre
  'Embuscade sombre':   { type: 'first_turn_damage', value: 3 },   // Bandit
  'Etreinte mortelle':  { type: 'drain',             damage: 2, heal: 1 },  // Zombie
  'Os tranchant':       { type: 'direct_damage',     value: 2 },   // Squelette
  'Griffe d ombre':     { type: 'direct_damage',     value: 2 },   // Chat noir
  'Toucher spectral':   { type: 'drain',             damage: 2, heal: 1 },  // Ombre rampante
  'Cocon ténébreux':    { type: 'buff_def',          value: 3 },   // Larve
  'Dague empoisonnee':  { type: 'poison',            damage: 2 },  // Assassin novice
  'Mucus toxique':      { type: 'debuff_atk',        value: 2 },   // Crapaud sombre
  'Effroi':             { type: 'stun',              damage: 0 },  // Ectoplasme
  'Morsure vorace':     { type: 'drain',             damage: 2, heal: 1 },  // Goule
  'Fils invisibles':    { type: 'stun',              damage: 0 },  // Marionnette
  'Venin nocturne':     { type: 'poison',            damage: 2 },  // Serpent venimeux
  'Raid eclair':        { type: 'first_turn_damage', value: 2 },   // Pilleur

  // ===== COMMUNES - LUMIERE (18 unique) =====
  'Elan celeste':       { type: 'buff_atk',          value: 1 },   // Moineau celeste
  'Priere mineure':     { type: 'heal_ally',         value: 2 },   // Pretre novice
  'Oeil du faucon':     { type: 'debuff_def',        value: 2 },   // Eclaireur
  'Poussiere d or':     { type: 'debuff_atk',        value: 2 },   // Papillon
  'Dard sacre':         { type: 'direct_damage',     value: 2 },   // Abeille sacree
  'Mur de lumiere':     { type: 'buff_def',          value: 3 },   // Gardien
  'Trait lumineux':     { type: 'direct_damage',     value: 2 },   // Apprenti mage
  'Toison protectrice': { type: 'buff_def',          value: 2 },   // Agneau
  'Plume doree':        { type: 'heal_ally',         value: 2 },   // Colombe
  'Frappe vertueuse':   { type: 'direct_damage',     value: 2 },   // Paladin novice
  'Farce magique':      { type: 'debuff_atk',        value: 2 },   // Lutin
  'Meditation':         { type: 'buff_def',          value: 3 },   // Moine
  'Bois sacre':         { type: 'buff_atk',          value: 2 },   // Cerf blanc
  'Soin feerique':      { type: 'heal_ally',         value: 2 },   // Fee
  'Fanfare':            { type: 'buff_team_atk',     value: 1 },   // Heraut
  'Ronronnement':       { type: 'heal_ally',         value: 2 },   // Chat blanc
  'Reflet d or':        { type: 'direct_damage',     value: 2 },   // Scarabee dore
  'Courrier rapide':    { type: 'first_turn_damage', value: 2 },   // Messager

  // ===== RARES - TERRE (11 unique) =====
  'Galop':              { type: 'buff_atk',          value: 3 },   // Centaure
  'Ronces':             { type: 'stun',              damage: 2 },  // Druidesse
  'Coup fatal':         { type: 'first_turn_damage', value: 5 },   // Taureau
  'Forteresse':         { type: 'buff_def',          value: 5 },   // Treant
  'Frappe lourde':      { type: 'direct_damage',     value: 4 },   // Gladiateur
  'Muraille vivante':   { type: 'shield',            value: 5 },   // Tortue geante
  'Pioche runique':     { type: 'lifesteal_attack',  percent: 30 },// Nain mineur
  'Regard petrifiant':  { type: 'mark',              damageBonus: 2 },  // Basilic
  'Onde tellurique':    { type: 'debuff_def',        value: 3 },   // Geomancien
  'Rage ursine':        { type: 'buff_atk',          value: 4 },   // Ours brun  (was Frappe lourde)
  'Guerison':           { type: 'drain',             damage: 2, heal: 4 },  // Sage des forets

  // ===== RARES - EAU (10 unique) =====
  'Frenzy':             { type: 'random_damage',     damage: 2, hits: 3 },  // Requin
  'Vague glacee':       { type: 'stun',              damage: 2 },  // Ondine
  'Assaut corsaire':    { type: 'first_turn_damage', value: 5 },   // Corsaire
  'Benediction marine': { type: 'shield',            value: 5 },   // Morse
  'Torrent':            { type: 'direct_damage',     value: 4 },   // Elementaire d eau
  'Aura apaisante':     { type: 'debuff_atk',        value: 3 },   // Kappa
  'Lame spectrale':     { type: 'ignore_def',        value: 0 },   // Pirate fantome
  'Echo aquatique':     { type: 'debuff_def',        value: 3 },   // Dauphin
  'Orage marin':        { type: 'aoe_damage',        value: 3 },   // Invoqueuse de pluie
  'Corne de narval':    { type: 'direct_damage',     value: 5 },   // Narval  (was Torrent)

  // ===== RARES - FEU (11 unique) =====
  'Pluie de feu':       { type: 'aoe_damage',        value: 3 },   // Ifrit
  'Rage':               { type: 'buff_atk',          value: 4 },   // Berserker
  'Corne de taureau':   { type: 'direct_damage',     value: 5 },   // Minotaure  (was Frappe lourde)
  'Soif de sang':       { type: 'drain',             damage: 4, heal: 3 },  // Serpent de lave
  'Griffes multiples':  { type: 'random_damage',     damage: 2, hits: 3 },  // Chimere
  'Rugissement':        { type: 'debuff_atk',        value: 3 },   // Lion de feu
  'Brasier':            { type: 'aoe_damage',        value: 3 },   // Pyromancien  (was Pluie de feu)
  'Dard venimeux':      { type: 'drain',             damage: 4, heal: 3 },  // Scorpion geant (was Soif de sang)
  'Flamme mystique':    { type: 'buff_atk',          value: 3 },   // Djinn (was Galop)
  'Assaut predateur':   { type: 'first_turn_damage', value: 5 },   // Raptor (was Coup fatal)
  'Katana de braise':   { type: 'lifesteal_attack',  percent: 30 },// Samourai de feu (was Frappe lourde)

  // ===== RARES - OMBRE (10 unique) =====
  'Morsure vampirique': { type: 'drain',             damage: 4, heal: 3 },  // Vampire (was Soif de sang)
  'Hurlement bestial':  { type: 'buff_atk',          value: 4 },   // Loup-garou (was Rage)
  'Malediction':        { type: 'debuff_atk',        value: 4 },   // Necromancien
  'Lame de l ombre':    { type: 'first_turn_damage', value: 5 },   // Assassin (was Coup fatal)
  'Griffes de harpie':  { type: 'stun',              damage: 2 },  // Harpie (was Ronces)
  'Toucher du neant':   { type: 'ignore_def',        value: 0 },   // Wraith (was Lame spectrale)
  'Bouclier maudit':    { type: 'shield',            value: 5 },   // Chevalier noir (was Benediction)
  'Queue de manticore': { type: 'drain',             damage: 4, heal: 3 },  // Manticore (was Soif de sang)
  'Flamme necrotique':  { type: 'aoe_damage',        value: 3 },   // Liche (was Pluie de feu)
  'Bond furtif':        { type: 'first_turn_damage', value: 5 },   // Panthere noire (was Coup fatal)

  // ===== RARES - LUMIERE (10 unique) =====
  'Benediction':        { type: 'buff_def',          value: 4 },   // Paladin
  'Aegis celeste':      { type: 'shield',            value: 5 },   // Ange gardien (was Benediction)
  'Corne sacree':       { type: 'drain',             damage: 3, heal: 3 },  // Licorne
  'Serres divines':     { type: 'direct_damage',     value: 4 },   // Griffon (was Frappe lourde)
  'Priere de soin':     { type: 'heal_ally',         value: 4 },   // Pretre (was Guerison)
  'Epee de justice':    { type: 'direct_damage',     value: 4 },   // Templier (was Frappe lourde)
  'Charge ailee':       { type: 'ignore_def',        value: 0 },   // Pegase (was Lame spectrale)
  'Rayon purificateur': { type: 'aoe_damage',        value: 3 },   // Mage blanc (was Pluie de feu)
  'Lance celeste':      { type: 'first_turn_damage', value: 5 },   // Valkyrie (was Coup fatal)
  'Aura bienveillante': { type: 'heal_ally',         value: 4 },   // Esprit sacre (was Guerison)

  // ===== EPIQUES - TERRE (6 unique) =====
  'Avalanche':          { type: 'aoe_damage',        value: 5 },   // Titan de pierre
  'Marteau runique':    { type: 'direct_damage',     value: 7 },   // Roi des nains
  'Multi-tetes':        { type: 'random_damage',     damage: 3, hits: 3 },  // Hydre de terre
  'Eveil naturel':      { type: 'drain',             damage: 5, heal: 4 },  // Druide ancien
  'Pietinement':        { type: 'sacrifice',         selfDamage: 5, targetDamage: 12 }, // Behemoth (was Avalanche)
  'Terreur nocturne':   { type: 'stun',              damage: 5 },  // Sphinx

  // ===== EPIQUES - EAU (5 unique) =====
  'Tentacules geants':  { type: 'random_damage',     damage: 3, hits: 3 },  // Kraken (was Multi-tetes)
  'Raz-de-maree':       { type: 'aoe_damage',        value: 6 },   // Leviathan
  'Maelstrom':          { type: 'stun',              damage: 5 },  // Sorcier des mers (was Terreur nocturne)
  'Purification':       { type: 'direct_damage',     value: 7 },   // Amiral fantome
  'Trident royal':      { type: 'drain',             damage: 5, heal: 3 },  // Roi triton

  // ===== EPIQUES - FEU (6 unique) =====
  'Inferno':            { type: 'aoe_damage',        value: 6 },   // Demon de feu
  'Souffle triple':     { type: 'random_damage',     damage: 3, hits: 3 },  // Hydre de feu (was Multi-tetes)
  'Charge divine':      { type: 'first_turn_damage', value: 6 },   // Wyvern
  'Festin de sang':     { type: 'drain',             damage: 6, heal: 4 },  // Efreet
  'Eruption royale':    { type: 'sacrifice',         selfDamage: 5, targetDamage: 12 }, // Roi volcanique (was Inferno)
  'Marteau infernal':   { type: 'execute',           damage: 4, executeDamage: 12, threshold: 0.3 }, // Guerrier infernal (was Marteau runique)

  // ===== EPIQUES - OMBRE (5 unique) =====
  'Faux mortelle':      { type: 'ignore_def',        value: 0 },   // Faucheur
  'Souffle des ombres': { type: 'aoe_damage',        value: 5 },   // Dragon d ombre (was Avalanche)
  'Festin sanguinaire': { type: 'drain',             damage: 6, heal: 4 },  // Seigneur vampire (was Festin de sang)
  'Armee de morts':     { type: 'aoe_damage',        value: 5 },   // Roi des morts (was Avalanche)
  'Cauchemar vivant':   { type: 'damage_and_heal',   damage: 5, heal: 3 },  // Cauchemar (was Terreur nocturne)

  // ===== EPIQUES - LUMIERE (5 unique) =====
  'Lumiere divine':     { type: 'aoe_damage',        value: 5 },   // Seraphin
  'Frappe sainte':      { type: 'execute',           damage: 4, executeDamage: 12, threshold: 0.3 }, // Champion sacre (was Purification)
  'Harmonie celeste':   { type: 'damage_and_heal',   damage: 5, heal: 4 },  // Druide celeste (was Eveil naturel)
  'Plongeon celeste':   { type: 'first_turn_damage', value: 6 },   // Chimere celeste (was Charge divine)
  'Marteau de lumiere': { type: 'direct_damage',     value: 7 },   // Inquisiteur (was Purification)

  // ===== LEGENDAIRES (15 unique - combo/special) =====
  'Eveil de Gaia':      { type: 'combo', effects: [
    { effect: 'aoe_damage', value: 5 },
    { effect: 'team_heal', value: 3 },
    { effect: 'buff_team_def', value: 2 }
  ]},
  'Appel de la foret':  { type: 'combo', effects: [
    { effect: 'team_heal', value: 4 },
    { effect: 'buff_team_atk', value: 2 },
    { effect: 'shield', value: 6 }
  ]},
  'Poids du monde':     { type: 'combo', effects: [
    { effect: 'damage', value: 8 },
    { effect: 'stun' },
    { effect: 'mark', value: 3 }
  ]},
  'Maree divine':       { type: 'combo', effects: [
    { effect: 'aoe_damage', value: 6 },
    { effect: 'aoe_debuff', value: 3 }
  ]},
  'Abime eternel':      { type: 'combo', effects: [
    { effect: 'damage', value: 8 },
    { effect: 'poison', value: 4 },
    { effect: 'heal', value: 5 }
  ]},
  'Ere glaciaire':      { type: 'combo', effects: [
    { effect: 'aoe_damage', value: 5 },
    { effect: 'stun' },
    { effect: 'buff_team_def', value: 2 }
  ]},
  'Flamme eternelle':   { type: 'sacrifice', selfDamage: 10, targetDamage: 18 },
  'Supernova':          { type: 'combo', effects: [
    { effect: 'aoe_damage', value: 7 },
    { effect: 'poison', value: 3 },
    { effect: 'buff_atk', value: 3 }
  ]},
  'Jugement final':     { type: 'execute', damage: 5, executeDamage: 20, threshold: 0.4 },
  'Apocalypse':         { type: 'combo', effects: [
    { effect: 'aoe_damage', value: 6 },
    { effect: 'aoe_debuff', value: 3 },
    { effect: 'heal', value: 5 }
  ]},
  'Rage du loup':       { type: 'conditional_damage', baseDamage: 5, bonusPerDeadAlly: 5, aoe: true },
  'Foudre olympienne':  { type: 'combo', effects: [
    { effect: 'damage', value: 8 },
    { effect: 'stun' },
    { effect: 'mark', value: 3 }
  ]},
  'Immortalite':        { type: 'combo', effects: [
    { effect: 'revive', value: 20 },
    { effect: 'team_heal', value: 5 },
    { effect: 'shield', value: 10 }
  ]},
  'Jugement divin':     { type: 'combo', effects: [
    { effect: 'damage', value: 6 },
    { effect: 'team_heal', value: 3 },
    { effect: 'buff_team_def', value: 1 }
  ]},
  'Renaissance eternelle': { type: 'revive', hp: 20 },

  // ===== LEGACY (keep for backward compat, may be unused after migration) =====
  'Renaissance':        { type: 'revive',            hp: 15 },

  // ===== STARTER DECK abilities =====
  'Coup de massue':     { type: 'direct_damage',     value: 1 },
  'Morsure de rat':     { type: 'first_turn_damage', value: 2 },
  'Nuee de mandibules': { type: 'random_damage',     damage: 1, hits: 3 },
  'Ecaille coupante':   { type: 'direct_damage',     value: 1 },
  'Pince acier':        { type: 'direct_damage',     value: 2 },
  'Garde de pierre':    { type: 'buff_def',          value: 2 },
  'Coup bas':           { type: 'first_turn_damage', value: 3 },
  'Filet marin':        { type: 'stun',              damage: 0 },

  // ===== NOUVELLES CARTES (v2) =====
  'Appel gobelin':      { type: 'buff_team_atk',     value: 1 },   // Goblin — simplifie (devrait invoquer token)
  'Carapace marine':    { type: 'buff_def_lasting',   value: 2 },   // Tortue des Rivieres (+2 DEF allie, dure jusqu'au prochain tour)
  'Frappe empoisonnee': { type: 'poison_dot',         damage: 1, turns: 4 },  // Serpent des Marees (1 degat/tour, 4 tours)
  'Eclair':             { type: 'direct_damage_ignore_def', value: 2 },   // Mage de Foudre (ignore DEF, 3 si 1ere action)
  'Croissance':         { type: 'buff_team_def',     value: 1 },   // Esprit des Forets — simplifie (devrait invoquer Pousse)
  'Flamme adjacente':   { type: 'adjacent_damage',   value: 1 },   // Salamandre Ardente (cible + adjacents)
  'Souffle de braise':  { type: 'aoe_damage',        value: 1 },   // Dragonnet de Braise
  'Fortification':      { type: 'buff_def',          value: 3 },   // Golem de Roche

  // ===== NOUVELLES CARTES (v3) =====
  'Carapace reactive':  { type: 'reactive_armor',      value: 1 },   // Crabe de Maree (statut: +1 DEF quand attaquee)
  'Garde de terre':     { type: 'buff_def',           value: 1 },   // Soldat de Terre
  'Aucun':              { type: 'none' },                            // Pas de pouvoir
  'Tir traitre':        { type: 'betrayal_shot',       value: 1 },   // Archer des Collines (x2 si cible endormie)
  'Ralliement':         { type: 'ralliement_status',   element: 'terre', value: 1 }, // Guerrier des Falaises (statut: +1 ATK/Terre allie)
  'Morsure sauvage':    { type: 'damage_wounded',     value: 1 },   // Requin des Profondeurs
  'Soins naturels':     { type: 'heal_ally_conditional', baseHeal: 1, bonusHeal: 1, bonusElement: 'terre' }, // Eclaireur
  'Protection marine':  { type: 'buff_def_element',   value: 1, element: 'eau' },  // Gardien du Recif
  'Eruption':           { type: 'aoe_damage_element', value: 2, targetElement: 'eau' }, // Titan de Magma
  'Aura de flamme':     { type: 'none' },              // Phoenix — l'AOE est un passif turn-start
  'Vague ecrasante':    { type: 'bounce_damage',      damage: 2 },  // Leviathan rework

  // ===== NOUVELLES CARTES v1.3.0 =====
  'Lumiere reparatrice': { type: 'heal_ally',          value: 3 },   // Pretresse Solaire
  'Combustion':          { type: 'combustion',         damage: 2, selfDamage: 1 },  // Pyromancien Nomade
  'Regeneration hydre':  { type: 'permanent_atk_buff', value: 1 },   // Hydre des Abysses (+1 ATK permanent cumulable)
  'Jugement celeste':    { type: 'def_as_damage' },                   // Archange Dechu (degats = DEF cible, ignore DEF)
  'Moisson funeste':     { type: 'reap',               threshold: 3 }, // Faucheur d Ames (kill si <= 3 PV)
  'Quitte ou Double':    { type: 'coin_flip' },                        // La Voie Lactee (50/50 kill)

  // ===== CARTES SECRET =====
  'Action de Moderation': { type: 'silence' },                          // Koteons (supprime l'ability d'un ennemi)

  // ===== NOUVELLES CARTES v1.4.0 =====
  'Mur infranchissable':  { type: 'buff_def_lasting', value: 2, taunt: true },  // Sentinelle de Pierre
  'Malediction mineure':  { type: 'debuff_atk',       value: 1 },               // Acolyte de l Ombre
  'Brasier guerisseur':   { type: 'combo',  effects: [{ type: 'direct_damage', value: 2 }, { type: 'heal_ally', value: 2 }] },  // Chaman des Cendres
  'Toucher givre':        { type: 'combo',  effects: [{ type: 'stun', duration: 1 }, { type: 'direct_damage', value: 1 }] },     // Spectre Glacial
  'Frappe fatale':        { type: 'execute_pct',       threshold: 50 },          // Assassin Nocturne (x2 si <= 50% HP)
  'Tsunami devastateur':  { type: 'combo',  effects: [{ type: 'aoe_damage', value: 2 }, { type: 'debuff_def_all', value: 1 }] }, // Dragon des Abysses
  'Aegis divin':          { type: 'combo',  effects: [{ type: 'team_heal', value: 2 }, { type: 'shield', value: 2, target: 'self' }] }, // Paladin Sacre
  'Souffle du Yomi':      { type: 'combo',  effects: [{ type: 'debuff_atk_all', value: 1 }, { type: 'debuff_def_all', value: 1 }, { type: 'reap', threshold: 2 }] }, // Izanami
  'Effondrement cosmique': { type: 'apocalypse' },                              // Le Neant Originel (detruit tout + degats directs)
  'Sacrifice radieux':    { type: 'delayed_sacrifice', directDamage: 5 },       // Lumis (suicide + 5 degats joueur)

  // ===== NOUVELLES CARTES v1.5.0 =====
  'Morsure infectee':     { type: 'combo', effects: [{ type: 'direct_damage', value: 2 }, { type: 'poison', damage: 1, duration: 2 }] },  // Rat des Egouts
  'Meditation':           { type: 'combo', effects: [{ type: 'heal_self', value: 2 }, { type: 'buff_def_lasting', value: 1 }] },           // Moine Errant
  'Infiltration':         { type: 'draw_card', value: 1 },                              // Espion des Brumes (pioche 1 carte)
  'Spores':               { type: 'poison_all', damage: 1, duration: 1 },               // Champignon Toxique (empoisonne tous ennemis)
  'Jugement guerrier':    { type: 'combo', effects: [{ type: 'direct_damage', value: 3 }, { type: 'heal_on_kill', value: 3 }] },           // Valkyrie Dechue
  'Transmutation':        { type: 'transfer_hp_to_atk', hpCost: 2, atkGain: 2, target: 'ally' },  // Alchimiste Fou
  'Copie':                { type: 'copy_stats', target: 'any' },                        // Ombre Mimetique (copie ATK/DEF d'une carte)
  'Souffle triple':       { type: 'direct_damage', value: 3, ignoreResistance: true },  // Chimere Elementaire
  'Distorsion temporelle': { type: 'undo_last_action', uses: 1 },                       // Oracle du Temps (annule derniere action, 1x/combat)
  'Recif vivant':         { type: 'summon_token', token: { name: 'Corail', atk: 0, def: 2, hp: 2, taunt: true } },  // Colosse de Corail
  'Boucle temporelle':    { type: 'reset_all_stats' },                                  // Chronos (reinitialise toutes les cartes)
  'Maree montante':       { type: 'combo', effects: [{ type: 'aoe_damage', value: 2 }, { type: 'stun_all', duration: 1 }] },              // Abyssia
  'Lancer divin':         { type: 'dice_roll', outcomes: { 1: 'self_kill', 2: 'nothing', 3: { type: 'buff_atk', value: 3 }, 4: { type: 'aoe_damage', value: 3 }, 5: { type: 'heal_all', value: 4 }, 6: 'kill_random_enemy' } },  // Le De du Destin
};

// ============================================
// ITEM EFFECTS MAP (for objet cards in combat)
// ============================================
const ITEM_EFFECTS = {
  'Soin mineur':     { target: 'ally',        type: 'heal',               value: 5 },
  'Lancer':          { target: 'enemy',       type: 'damage',             value: 3 },
  'Herboristerie':   { target: 'ally',        type: 'heal',               value: 3 },
  'Premiers soins':  { target: 'ally',        type: 'heal',               value: 4 },
  'Lancer precis':   { target: 'enemy',       type: 'damage_ignore_def',  value: 2 },
  'Rage chimique':   { target: 'ally',        type: 'buff_atk',           value: 3 },
  'Protection':      { target: 'ally',        type: 'shield',             value: 4 },
  'Aveuglement':     { target: 'enemy',       type: 'stun' },
  'Empoisonnement':  { target: 'enemy',       type: 'poison',             value: 2 },
  'Soin de groupe':  { target: 'team',        type: 'team_heal',          value: 3 },
  'Enchantement':    { target: 'ally',        type: 'buff_atk_permanent', value: 5 },
  'Foudroiement':    { target: 'enemy',       type: 'damage',             value: 7 },
  'Cri de guerre':   { target: 'team',        type: 'buff_team_atk',      value: 2 },
  'Miracle':         { target: 'ally',        type: 'heal',               value: 12 },
  'Destruction':     { target: 'all_enemies', type: 'aoe_damage',         value: 4 },
  // Crystaux
  'Crystal commun':     { target: 'self', type: 'add_crystal', value: 0.4 },
  'Crystal rare':       { target: 'self', type: 'add_crystal', value: 0.8 },
  'Crystal epique':     { target: 'self', type: 'add_crystal', value: 1.2 },
  'Crystal legendaire': { target: 'self', type: 'add_crystal', value: 1.8 },
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

function calcDamage(attacker, defender, ignoreDef, attackerField) {
  const atkStats = attacker.effectiveStats || getEffectiveStats(attacker);
  const defStats = defender.effectiveStats || getEffectiveStats(defender);
  const defVal = ignoreDef ? 0 : (defStats.defense + (defender.buffDef || 0) + (defender.permanentBonusDef || 0));
  let atkVal = atkStats.attack + (attacker.buffAtk || 0) + (attacker.permanentBonusAtk || 0);

  // Passif Goblin : +1 ATK si un autre Goblin est sur le terrain
  if (attacker.name === 'Goblin' && attackerField) {
    const otherGoblins = attackerField.filter(u => u && u.alive && u.name === 'Goblin' && u !== attacker).length;
    if (otherGoblins > 0) atkVal += 1;
  }

  let baseDamage = Math.max(1, atkVal - defVal);
  // Passif Mark : bonus degats si cible marquee
  if (defender.marked > 0) baseDamage += defender.marked;
  const elemMod = getElementMod(attacker.element, defender.element);
  let dmg = Math.max(1, Math.floor(baseDamage * elemMod));
  // Passif Mage : Fragilite (+1 degat subi des attaques normales)
  if (defender.type === 'mage') dmg += 1;

  // Passif Golem de Roche : -1 degat subi
  if (defender.name === 'Golem de Roche') dmg = Math.max(1, dmg - 1);

  // Passif Requin : woundedBonus (+1 degat aux unites blessees)
  if (attacker.woundedBonus && attacker.woundedBonus > 0 && defender.currentHp < defender.maxHp) {
    dmg += attacker.woundedBonus;
  }

  return dmg;
}

// Helper pour appliquer des degats avec shield, counter, grace
function applyDamage(target, damage, events, source, battle) {
  let remaining = damage;
  // Shield absorbe en premier
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, remaining);
    target.shield -= absorbed;
    remaining -= absorbed;
    events.push({ type: 'shield_absorb', unit: target.name, absorbed });
  }
  // Passif Hydre des Abysses : ne peut pas etre tuee en un seul coup (reste a 1 PV)
  if (target.name === 'Hydre des Abysses' && target.currentHp > 1 && remaining >= target.currentHp) {
    target.currentHp = 1;
    events.push({ type: 'type_passive', desc: `${target.name} survit au coup fatal ! (1 PV)` });
    // On skip le reste de applyDamage (counter, etc.) car les degats sont deja appliques
  } else {
    target.currentHp = Math.max(0, target.currentHp - remaining);
  }
  // Counter : reflete des degats
  if (target.counterDamage > 0 && source && source.alive) {
    source.currentHp = Math.max(0, source.currentHp - target.counterDamage);
    events.push({ type: 'counter_damage', unit: target.name, target: source.name, damage: target.counterDamage });
    if (source.currentHp <= 0) checkKO(source, events, battle);
  }
  // Statut Carapace reactive : +1 DEF permanent quand attaquee
  if (target.alive && target.currentHp > 0 && (target.reactiveArmor || 0) > 0) {
    target.permanentBonusDef = (target.permanentBonusDef || 0) + target.reactiveArmor;
    events.push({ type: 'type_passive', desc: `${target.name} renforce sa carapace ! +${target.reactiveArmor} DEF permanent` });
  }

  // Passif Titan de Magma : 1 degat aux attaquants
  if (target.alive && target.currentHp > 0 && target.name === 'Titan de Magma' && source && source.alive) {
    source.currentHp = Math.max(0, source.currentHp - 1);
    events.push({ type: 'type_passive', desc: `${target.name} brule ${source.name} ! 1 degat` });
    if (source.currentHp <= 0) checkKO(source, events, battle);
  }

  if (target.currentHp <= 0) checkKO(target, events, battle);
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
    // Passif Guerrier : +10% PV max
    if (card.type === 'guerrier') {
      es.hp = Math.floor(es.hp * 1.1);
    }
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
      is_temp: card.is_temp || 0,
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
      canRevive: ABILITY_MAP[card.ability_name]?.type === 'revive' || card.name === 'Phoenix Ancestral',
      // Nouveaux champs
      shield: 0,
      poisoned: 0,
      marked: 0,
      counterDamage: 0,
      permanentBonusAtk: 0,
      permanentBonusDef: 0,
      lowHpDefTriggered: false,
      graceUsed: false,
      lifestealPercent: 0,
      woundedBonus: 0,
      reactiveArmor: 0,
      lastingDefBuff: 0,
      lastingAtkBuff: 0,
      lastingAtkTurns: 0,
      poisonDot: 0,
      poisonDotTurns: 0,
      ralliement: false,
      silenced: false,
    };
  };

  // Passif Bete : Instinct de meute (+1 ATK si 2+ Betes dans l equipe)
  const applyPackBonus = (team) => {
    const beteCount = team.filter(u => u.type === 'bete').length;
    if (beteCount >= 2) {
      team.filter(u => u.type === 'bete').forEach(u => { u.permanentBonusAtk += 1; });
    }
  };

  const pTeam = playerCards.map((c, i) => makeUnit(c, i, 'player'));
  const eTeam = enemyCards.map((c, i) => makeUnit(c, i, 'enemy'));
  applyPackBonus(pTeam);
  applyPackBonus(eTeam);

  const state = {
    battleId,
    battleType,
    nodeId: nodeId || null,
    turn: 1,
    phase: 'player_turn',
    playerTeam: pTeam,
    enemyTeam: eTeam,
    log: [],
    result: null,
    lastAction: Date.now(),
    deadTempCards: [],
  };

  activeBattles.set(battleId, state);
  return state;
}

function resolveAbility(unit, targets, allAllies, allEnemies, battle) {
  const ability = ABILITY_MAP[unit.ability_name];
  if (!ability || unit.usedAbility || unit.silenced) return [];
  unit.usedAbility = true;

  const events = [];
  const abilityName = unit.ability_name;

  // Passif Mage : +20% degats d ability
  const mageDmgMult = (unit.type === 'mage') ? 1.2 : 1;
  const scaleDmg = (val) => Math.max(1, Math.floor(val * mageDmgMult));

  const pickTarget = () => targets[0] || allEnemies.find(e => e.alive);
  const weakestAlly = () => allAllies.filter(a => a.alive && a !== unit).sort((a, b) => a.currentHp - b.currentHp)[0];

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
      const target = pickTarget();
      if (target) {
        let dmgVal = ability.value;
        const dmg = scaleDmg(dmgVal);
        applyDamage(target, dmg, events, unit, battle);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg });
      }
      break;
    }
    case 'direct_damage_ignore_def': {
      // Eclair du Mage de Foudre : degats directs ignorant la DEF
      const target = pickTarget();
      if (target) {
        let dmgVal = ability.value;
        // Passif Mage de Foudre : 3 degats au lieu de 2 (1ere action)
        if (unit.name === 'Mage de Foudre' && abilityName === 'Eclair') dmgVal = 3;
        const dmg = scaleDmg(dmgVal);
        target.currentHp = Math.max(0, target.currentHp - dmg);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg, desc: `${dmg} degats (ignore DEF)` });
        if (target.currentHp <= 0) checkKO(target, events, battle);
      }
      break;
    }
    case 'betrayal_shot': {
      // Archer des Collines : x2 degats si cible endormie (justDeployed)
      const target = pickTarget();
      if (target) {
        let dmgVal = ability.value;
        if (target.justDeployed) dmgVal *= 2;
        const dmg = scaleDmg(dmgVal);
        applyDamage(target, dmg, events, unit, battle);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg, desc: target.justDeployed ? `x2 sur cible endormie !` : '' });
      }
      break;
    }
    case 'poison_dot': {
      // Serpent des Marees : empoisonne la cible (1 degat/tour pendant N tours)
      const target = pickTarget();
      if (target) {
        target.poisonDot = (target.poisonDot || 0) + ability.damage;
        target.poisonDotTurns = Math.max(target.poisonDotTurns || 0, ability.turns);
        events.push({ type: 'ability_poison', unit: unit.name, target: target.name, ability: abilityName, desc: `Empoisonne ! ${ability.damage} degat/tour pendant ${ability.turns} tours` });
      }
      break;
    }
    case 'adjacent_damage': {
      // Salamandre Ardente : degats a la cible + ennemis adjacents
      const target = pickTarget();
      let killedAny = false;
      if (target && battle && battle.isDeckBattle) {
        const enemyField = unit.side === 'player' ? battle.enemyField : battle.playerField;
        const targetIdx = enemyField.indexOf(target);
        const dmg = scaleDmg(ability.value);
        const hitTargets = [];
        for (let i = Math.max(0, targetIdx - 1); i <= Math.min(2, targetIdx + 1); i++) {
          const t = enemyField[i];
          if (t && t.alive) {
            applyDamage(t, dmg, events, unit, battle);
            hitTargets.push(t.name);
            if (!t.alive) killedAny = true;
          }
        }
        events.push({ type: 'ability_aoe', unit: unit.name, ability: abilityName, damage: dmg, desc: `Flamme sur ${hitTargets.join(', ')}` });
      } else if (target) {
        const dmg = scaleDmg(ability.value);
        applyDamage(target, dmg, events, unit, battle);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg });
        if (!target.alive) killedAny = true;
      }
      // Si tue un ennemi : +1 ATK tour suivant
      if (killedAny && unit.name === 'Salamandre Ardente') {
        unit.permanentBonusAtk = (unit.permanentBonusAtk || 0) + 1;
        unit.lastingAtkBuff = (unit.lastingAtkBuff || 0) + 1;
        unit.lastingAtkTurns = 2;
        events.push({ type: 'type_passive', desc: `${unit.name} s'enflamme ! +1 ATK (tour suivant)` });
      }
      break;
    }
    case 'ralliement_status': {
      // Guerrier des Falaises : statut Ralliement (+1 ATK par Terre allie)
      unit.ralliement = true;
      const earthAllies = allAllies.filter(a => a.alive && a.element === ability.element && a !== unit).length;
      unit.buffAtk += earthAllies * ability.value;
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Ralliement ! +${earthAllies} ATK (${earthAllies} Terre allies)` });
      break;
    }
    case 'ignore_def':
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Ignore DEF' });
      break;
    case 'drain': {
      const target = pickTarget();
      if (target) {
        const dmg = scaleDmg(ability.damage);
        applyDamage(target, dmg, events, unit, battle);
        unit.currentHp = Math.min(unit.maxHp, unit.currentHp + ability.heal);
        events.push({ type: 'ability_drain', unit: unit.name, target: target.name, ability: abilityName, damage: dmg, heal: ability.heal });
      }
      break;
    }
    case 'aoe_damage': {
      const dmg = scaleDmg(ability.value);
      allEnemies.filter(e => e.alive).forEach(enemy => {
        applyDamage(enemy, dmg, events, unit, battle);
        events.push({ type: 'ability_aoe', unit: unit.name, target: enemy.name, ability: abilityName, damage: dmg });
      });
      break;
    }
    case 'revive':
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Peut revenir avec ${ability.hp || ability.value} PV` });
      break;
    case 'stun': {
      const target = pickTarget();
      if (target) {
        if (ability.damage > 0) {
          const dmg = scaleDmg(ability.damage);
          applyDamage(target, dmg, events, unit, battle);
        }
        // Passif Titan Originel : immunise aux effets de controle
        if (target.name === 'Titan Originel') {
          events.push({ type: 'type_passive', desc: `${target.name} est immunise au controle !` });
        } else {
          target.stunned = true;
          events.push({ type: 'ability_stun', unit: unit.name, target: target.name, ability: abilityName, damage: ability.damage || 0 });
        }
      }
      break;
    }
    case 'debuff_atk': {
      const target = pickTarget();
      if (target) {
        target.buffAtk -= ability.value;
        events.push({ type: 'ability_debuff', unit: unit.name, target: target.name, ability: abilityName, desc: `-${ability.value} ATK` });
      }
      break;
    }
    case 'first_turn_damage': {
      if (battle.turn === 1) {
        const target = pickTarget();
        if (target) {
          const dmg = scaleDmg(ability.value);
          applyDamage(target, dmg, events, unit, battle);
          events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg });
        }
      }
      break;
    }
    case 'random_damage': {
      for (let h = 0; h < ability.hits; h++) {
        const aliveEnemies = allEnemies.filter(e => e.alive);
        if (aliveEnemies.length === 0) break;
        const target = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
        const dmg = scaleDmg(ability.damage);
        applyDamage(target, dmg, events, unit, battle);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg });
      }
      break;
    }
    // ===== NOUVEAUX TYPES =====
    case 'heal_ally': {
      const ally = weakestAlly();
      if (ally) {
        ally.currentHp = Math.min(ally.maxHp, ally.currentHp + ability.value);
        events.push({ type: 'ability_heal', unit: unit.name, target: ally.name, ability: abilityName, heal: ability.value });
      } else {
        // Pas d allie, se soigne soi-meme
        unit.currentHp = Math.min(unit.maxHp, unit.currentHp + ability.value);
        events.push({ type: 'ability_heal', unit: unit.name, target: unit.name, ability: abilityName, heal: ability.value });
      }
      break;
    }
    case 'debuff_def': {
      const target = pickTarget();
      if (target) {
        target.buffDef -= ability.value;
        events.push({ type: 'ability_debuff', unit: unit.name, target: target.name, ability: abilityName, desc: `-${ability.value} DEF` });
      }
      break;
    }
    case 'counter':
      unit.counterDamage = ability.value;
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Contre-attaque ${ability.value} degats` });
      break;
    case 'buff_team_atk':
      allAllies.filter(a => a.alive).forEach(a => { a.buffAtk += ability.value; });
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${ability.value} ATK a l equipe` });
      break;
    case 'buff_team_def':
      allAllies.filter(a => a.alive).forEach(a => { a.buffDef += ability.value; });
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${ability.value} DEF a l equipe` });
      break;
    case 'poison': {
      const target = pickTarget();
      if (target) {
        target.poisoned = (target.poisoned || 0) + ability.damage;
        events.push({ type: 'ability_poison', unit: unit.name, target: target.name, ability: abilityName, damage: ability.damage });
      }
      break;
    }
    case 'shield':
      unit.shield = (unit.shield || 0) + ability.value;
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Bouclier +${ability.value}` });
      break;
    case 'execute': {
      const target = pickTarget();
      if (target) {
        const isLow = (target.currentHp / target.maxHp) <= ability.threshold;
        const dmg = scaleDmg(isLow ? ability.executeDamage : ability.damage);
        applyDamage(target, dmg, events, unit, battle);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg, executed: isLow });
      }
      break;
    }
    case 'lifesteal_attack':
      unit.lifestealPercent = ability.percent;
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Vole ${ability.percent}% PV` });
      break;
    case 'sacrifice': {
      const target = pickTarget();
      if (target) {
        const dmg = scaleDmg(ability.targetDamage);
        unit.currentHp = Math.max(1, unit.currentHp - ability.selfDamage);
        applyDamage(target, dmg, events, unit, battle);
        events.push({ type: 'ability_sacrifice', unit: unit.name, target: target.name, ability: abilityName, selfDamage: ability.selfDamage, targetDamage: dmg });
      }
      break;
    }
    case 'aoe_debuff':
      allEnemies.filter(e => e.alive).forEach(e => {
        if (ability.stat === 'atk') e.buffAtk -= ability.value;
        else e.buffDef -= ability.value;
      });
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `-${ability.value} ${ability.stat === 'atk' ? 'ATK' : 'DEF'} a tous` });
      break;
    case 'damage_and_heal': {
      const target = pickTarget();
      const ally = weakestAlly();
      if (target) {
        const dmg = scaleDmg(ability.damage);
        applyDamage(target, dmg, events, unit, battle);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg });
      }
      if (ally) {
        ally.currentHp = Math.min(ally.maxHp, ally.currentHp + ability.heal);
        events.push({ type: 'ability_heal', unit: unit.name, target: ally.name, ability: abilityName, heal: ability.heal });
      }
      break;
    }
    case 'team_heal':
      allAllies.filter(a => a.alive).forEach(a => {
        a.currentHp = Math.min(a.maxHp, a.currentHp + ability.value);
      });
      events.push({ type: 'ability_team_heal', unit: unit.name, ability: abilityName, heal: ability.value });
      break;
    case 'mark': {
      const target = pickTarget();
      if (target) {
        target.marked = ability.damageBonus;
        events.push({ type: 'ability_mark', unit: unit.name, target: target.name, ability: abilityName, bonus: ability.damageBonus });
      }
      break;
    }
    case 'conditional_damage': {
      const deadAllies = allAllies.filter(a => !a.alive).length;
      const deadEnemies = allEnemies.filter(e => !e.alive).length;
      let dmg = ability.baseDamage;
      if (ability.bonusPerDeadAlly) dmg += deadAllies * ability.bonusPerDeadAlly;
      if (ability.bonusPerDeadEnemy) dmg += deadEnemies * ability.bonusPerDeadEnemy;
      dmg = scaleDmg(dmg);
      if (ability.aoe) {
        allEnemies.filter(e => e.alive).forEach(enemy => {
          applyDamage(enemy, dmg, events, unit, battle);
          events.push({ type: 'ability_aoe', unit: unit.name, target: enemy.name, ability: abilityName, damage: dmg });
        });
      } else {
        const target = pickTarget();
        if (target) {
          applyDamage(target, dmg, events, unit, battle);
          events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg });
        }
      }
      break;
    }
    // ===== NOUVELLES ABILITIES (v3) =====
    case 'none':
      break;
    case 'buff_atk_per_element': {
      const count = allAllies.filter(a => a.alive && a.element === ability.element).length;
      unit.buffAtk += count * ability.value;
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${count * ability.value} ATK (${count} allies ${ability.element})` });
      break;
    }
    case 'damage_wounded': {
      unit.woundedBonus = ability.value;
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${ability.value} degat aux cibles blessees` });
      break;
    }
    case 'heal_ally_conditional': {
      const ally = weakestAlly();
      if (ally) {
        const heal = (ally.element === ability.bonusElement) ? (ability.baseHeal + ability.bonusHeal) : ability.baseHeal;
        ally.currentHp = Math.min(ally.maxHp, ally.currentHp + heal);
        events.push({ type: 'ability_heal', unit: unit.name, target: ally.name, ability: abilityName, heal });
      }
      break;
    }
    case 'buff_def_element': {
      const ally = allAllies.filter(a => a.alive && a.element === ability.element && a !== unit)[0];
      if (ally) {
        ally.buffDef += ability.value;
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${ability.value} DEF a ${ally.name}` });
      }
      break;
    }
    case 'aoe_damage_element': {
      const dmg = scaleDmg(ability.value);
      allEnemies.filter(e => e.alive && e.element === ability.targetElement).forEach(enemy => {
        applyDamage(enemy, dmg, events, unit, battle);
        events.push({ type: 'ability_aoe', unit: unit.name, target: enemy.name, ability: abilityName, damage: dmg });
      });
      break;
    }
    // ===== NOUVELLES ABILITIES v1.3.0 =====
    case 'combustion': {
      const target = pickTarget();
      if (target) {
        const dmg = scaleDmg(ability.damage);
        applyDamage(target, dmg, events, unit, battle);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg });
        // Passif Pyromancien : si l ennemi meurt, pas d auto-degat
        if (target.alive || target.currentHp > 0) {
          unit.currentHp = Math.max(0, unit.currentHp - ability.selfDamage);
          events.push({ type: 'ability_self_damage', unit: unit.name, ability: abilityName, damage: ability.selfDamage });
          if (unit.currentHp <= 0) checkKO(unit, events, battle);
        } else {
          events.push({ type: 'type_passive', desc: `${unit.name} : ennemi detruit, auto-degat annule !` });
        }
      }
      break;
    }
    case 'permanent_atk_buff': {
      unit.permanentBonusAtk += ability.value;
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${ability.value} ATK permanent (total: +${unit.permanentBonusAtk})` });
      // Reset usedAbility pour permettre la reutilisation au tour suivant
      unit.usedAbility = false;
      break;
    }
    case 'def_as_damage': {
      const target = pickTarget();
      if (target) {
        const targetDef = (target.effectiveStats?.defense || target.defense) + (target.buffDef || 0) + (target.permanentBonusDef || 0);
        const dmg = scaleDmg(Math.max(1, targetDef));
        // Ignore la DEF pour les degats
        target.currentHp = Math.max(0, target.currentHp - dmg);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg, desc: `Degats = DEF cible (${dmg})` });
        if (target.currentHp <= 0) checkKO(target, events, battle);
      }
      break;
    }
    case 'reap': {
      const target = pickTarget();
      if (target) {
        if (target.currentHp <= ability.threshold) {
          // Execution instantanee
          target.currentHp = 0;
          events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: target.currentHp, desc: `Execution ! (cible avait ${target.currentHp} PV)` });
          checkKO(target, events, battle);
          // Passif Faucheur : +2 PV et +1 ATK permanent par kill via ability
          if (!target.alive) {
            unit.currentHp = Math.min(unit.maxHp, unit.currentHp + 2);
            unit.permanentBonusAtk += 1;
            events.push({ type: 'type_passive', desc: `${unit.name} moissonne ! +2 PV, +1 ATK permanent` });
          }
        } else {
          // Cible trop de PV, attaque normale
          const dmg = calcDamage(unit, target, false);
          applyDamage(target, dmg, events, unit, battle);
          events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg, desc: `Cible a ${target.currentHp} PV (> ${ability.threshold}), attaque normale` });
          // Passif Faucheur si kill via attaque normale de l ability
          if (!target.alive && unit.name === 'Faucheur d Ames') {
            unit.currentHp = Math.min(unit.maxHp, unit.currentHp + 2);
            unit.permanentBonusAtk += 1;
            events.push({ type: 'type_passive', desc: `${unit.name} moissonne ! +2 PV, +1 ATK permanent` });
          }
        }
      }
      break;
    }
    case 'coin_flip': {
      const target = pickTarget();
      if (target) {
        const success = Math.random() < 0.5;
        if (success) {
          target.currentHp = 0;
          events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: 9999, desc: 'Quitte ou Double : SUCCES ! Ennemi elimine !' });
          checkKO(target, events, battle);
        } else {
          unit.currentHp = 0;
          events.push({ type: 'ability_damage', unit: unit.name, target: unit.name, ability: abilityName, damage: 9999, desc: 'Quitte ou Double : ECHEC ! Votre carte est detruite !' });
          checkKO(unit, events, battle);
        }
      }
      break;
    }
    case 'silence': {
      // Koteons : supprime la capacité d'un ennemi choisi
      const target = pickTarget();
      if (target && !target.silenced) {
        target.silenced = true;
        target.usedAbility = true;
        // Passif Koteons : les ennemis réduits au silence perdent 1 DEF
        target.permanentBonusDef = (target.permanentBonusDef || 0) - 1;
        events.push({ type: 'ability', unit: unit.name, target: target.name, ability: abilityName, desc: `${target.name} est reduit au silence ! Capacite supprimee & -1 DEF` });
      } else if (target && target.silenced) {
        events.push({ type: 'ability', unit: unit.name, target: target.name, ability: abilityName, desc: `${target.name} est deja reduit au silence !` });
      }
      break;
    }
    case 'buff_def_lasting': {
      // Tortue des Rivieres : +DEF a un allie, dure jusqu'au prochain tour
      const ally = allAllies.filter(a => a.alive && a !== unit)[0] || unit;
      ally.permanentBonusDef = (ally.permanentBonusDef || 0) + ability.value;
      ally.lastingDefBuff = (ally.lastingDefBuff || 0) + ability.value;
      events.push({ type: 'ability', unit: unit.name, target: ally.name, ability: abilityName, desc: `+${ability.value} DEF a ${ally.name} (jusqu'au prochain tour)` });
      break;
    }
    case 'reactive_armor': {
      // Crabe de Maree : statut reactif — +1 DEF quand attaquee
      unit.reactiveArmor = (unit.reactiveArmor || 0) + ability.value;
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `${unit.name} active sa Carapace reactive !` });
      break;
    }
    case 'bounce_damage': {
      const target = pickTarget();
      if (target) {
        const dmg = scaleDmg(ability.damage);
        applyDamage(target, dmg, events, unit, battle);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg });
        if (target.alive && target.name !== 'Titan Originel' && battle && battle.isDeckBattle) {
          const field = target.side === 'player' ? battle.playerField : battle.enemyField;
          const hand = target.side === 'player' ? battle.playerHand : battle.enemyHand;
          if (field && hand) {
            const idx = field.indexOf(target);
            if (idx !== -1) {
              field[idx] = null;
              hand.push(makeHandCard(target));
              events.push({ type: 'type_passive', desc: `${unit.name} renvoie ${target.name} en main !` });
            }
          }
        }
      }
      break;
    }
    case 'combo':
      for (const fx of ability.effects) {
        switch (fx.effect) {
          case 'damage': {
            const t = pickTarget();
            if (t) {
              const d = scaleDmg(fx.value);
              applyDamage(t, d, events, unit, battle);
              events.push({ type: 'ability_damage', unit: unit.name, target: t.name, ability: abilityName, damage: d });
            }
            break;
          }
          case 'aoe_damage': {
            const d = scaleDmg(fx.value);
            allEnemies.filter(e => e.alive).forEach(e => {
              applyDamage(e, d, events, unit, battle);
              events.push({ type: 'ability_aoe', unit: unit.name, target: e.name, ability: abilityName, damage: d });
            });
            break;
          }
          case 'heal':
            unit.currentHp = Math.min(unit.maxHp, unit.currentHp + fx.value);
            events.push({ type: 'ability_heal', unit: unit.name, target: unit.name, ability: abilityName, heal: fx.value });
            break;
          case 'team_heal':
            allAllies.filter(a => a.alive).forEach(a => {
              a.currentHp = Math.min(a.maxHp, a.currentHp + fx.value);
            });
            events.push({ type: 'ability_team_heal', unit: unit.name, ability: abilityName, heal: fx.value });
            break;
          case 'buff_atk':
            unit.buffAtk += fx.value;
            events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${fx.value} ATK` });
            break;
          case 'buff_def':
            unit.buffDef += fx.value;
            events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${fx.value} DEF` });
            break;
          case 'buff_team_atk':
            allAllies.filter(a => a.alive).forEach(a => { a.buffAtk += fx.value; });
            events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${fx.value} ATK equipe` });
            break;
          case 'buff_team_def':
            allAllies.filter(a => a.alive).forEach(a => { a.buffDef += fx.value; });
            events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${fx.value} DEF equipe` });
            break;
          case 'debuff_atk': {
            const t = pickTarget();
            if (t) t.buffAtk -= fx.value;
            events.push({ type: 'ability_debuff', unit: unit.name, target: t?.name, ability: abilityName, desc: `-${fx.value} ATK` });
            break;
          }
          case 'aoe_debuff':
            allEnemies.filter(e => e.alive).forEach(e => { e.buffAtk -= fx.value; });
            events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `-${fx.value} ATK a tous` });
            break;
          case 'stun': {
            const t = pickTarget();
            if (t) t.stunned = true;
            events.push({ type: 'ability_stun', unit: unit.name, target: t?.name, ability: abilityName, damage: 0 });
            break;
          }
          case 'mark': {
            const t = pickTarget();
            if (t) t.marked = fx.damageBonus || fx.value;
            events.push({ type: 'ability_mark', unit: unit.name, target: t?.name, ability: abilityName, bonus: fx.damageBonus || fx.value });
            break;
          }
          case 'shield':
            unit.shield = (unit.shield || 0) + fx.value;
            events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Bouclier +${fx.value}` });
            break;
          case 'poison': {
            const t = pickTarget();
            if (t) t.poisoned = (t.poisoned || 0) + fx.value;
            events.push({ type: 'ability_poison', unit: unit.name, target: t?.name, ability: abilityName, damage: fx.value });
            break;
          }
          case 'revive':
            unit.canRevive = true;
            events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Revient avec ${fx.value} PV` });
            break;
        }
      }
      break;
  }
  return events;
}

function checkKO(unit, events, battle) {
  if (unit.currentHp <= 0) {
    // Passif Divin : Grace (15% de survivre a 1 PV, une seule fois)
    if (unit.type === 'divin' && !unit.graceUsed && Math.random() < 0.15) {
      unit.currentHp = 1;
      unit.graceUsed = true;
      events.push({ type: 'grace_survive', unit: unit.name });
      return;
    }
    if (unit.canRevive) {
      // Phoenix Ancestral : revive avec 3 PV (passif)
      let reviveHp;
      if (unit.name === 'Phoenix Ancestral') {
        reviveHp = 3;
      } else {
        const ability = ABILITY_MAP[unit.ability_name];
        reviveHp = ability.hp || ability.value;
        // For combo abilities, find the revive effect's value
        if (!reviveHp && ability.type === 'combo' && ability.effects) {
          const reviveEffect = ability.effects.find(fx => fx.effect === 'revive');
          if (reviveEffect) reviveHp = reviveEffect.value;
        }
      }
      unit.currentHp = reviveHp || 15;
      unit.canRevive = false;
      events.push({ type: 'revive', unit: unit.name, hp: unit.currentHp });
    } else {
      unit.alive = false;
      events.push({ type: 'ko', unit: unit.name });
      // Passif Archange Dechu : a sa mort, soigne 2 PV a tous les allies
      if (unit.name === 'Archange Dechu' && battle) {
        const allies = unit.side === 'player' ? battle.playerTeam : battle.enemyTeam;
        // Support deck battles (field-based)
        const allyList = battle.isDeckBattle
          ? (unit.side === 'player' ? (battle.playerField || []).filter(u => u && u.alive) : (battle.enemyField || []).filter(u => u && u.alive))
          : (allies ? allies.filter(u => u.alive) : []);
        allyList.forEach(a => {
          a.currentHp = Math.min(a.maxHp, a.currentHp + 2);
        });
        if (allyList.length > 0) {
          events.push({ type: 'type_passive', desc: `${unit.name} tombe ! Soigne 2 PV a tous les allies` });
        }
      }
      // Cartes TEMP : tracker pour suppression en fin de combat
      if (battle && unit.is_temp && unit.userCardId) {
        battle.deadTempCards.push(unit.userCardId);
        events.push({ type: 'temp_death', unit: unit.name });
      }
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

  // Aura Divin ennemie
  const divinCountE = battle.enemyTeam.filter(u => u.alive && u.type === 'divin').length;
  if (divinCountE > 0) {
    battle.enemyTeam.filter(u => u.alive).forEach(u => {
      u.currentHp = Math.min(u.maxHp, u.currentHp + divinCountE);
    });
    events.push({ type: 'type_passive', desc: `Aura divine ennemie : +${divinCountE} PV` });
  }
  // Passif Phoenix Ancestral ennemi : 1 degat a toutes les unites joueur
  const phoenixCountEC = battle.enemyTeam.filter(u => u.alive && u.name === 'Phoenix Ancestral').length;
  if (phoenixCountEC > 0) {
    battle.playerTeam.filter(u => u.alive).forEach(u => {
      u.currentHp = Math.max(0, u.currentHp - phoenixCountEC);
      if (u.currentHp <= 0) checkKO(u, events, battle);
    });
    events.push({ type: 'type_passive', desc: `Phoenix Ancestral ennemi : ${phoenixCountEC} degat(s) a vos unites` });
  }
  // Passif Leviathan Abyssal ennemi : +1 ATK aux allies Eau
  const leviathanCountEC = battle.enemyTeam.filter(u => u.alive && u.name === 'Leviathan Abyssal').length;
  if (leviathanCountEC > 0) {
    battle.enemyTeam.filter(u => u.alive && u.element === 'eau').forEach(u => {
      u.buffAtk += leviathanCountEC;
    });
    events.push({ type: 'type_passive', desc: `Leviathan Abyssal ennemi : +${leviathanCountEC} ATK aux unites Eau` });
  }
  // Passif Pretresse Solaire ennemie : soigne 1 PV a l allie le plus blesse
  const pretresseCountEC = battle.enemyTeam.filter(u => u.alive && u.name === 'Pretresse Solaire').length;
  if (pretresseCountEC > 0) {
    for (let i = 0; i < pretresseCountEC; i++) {
      const wounded = battle.enemyTeam.filter(u => u.alive && u.currentHp < u.maxHp).sort((a, b) => a.currentHp - b.currentHp)[0];
      if (wounded) {
        wounded.currentHp = Math.min(wounded.maxHp, wounded.currentHp + 1);
        events.push({ type: 'type_passive', desc: `Pretresse Solaire ennemie soigne ${wounded.name} de 1 PV` });
      }
    }
  }

  for (const enemy of aliveEnemies) {
    if (!enemy.alive || battle.playerTeam.filter(p => p.alive).length === 0) continue;

    // Tick poison ennemi
    if (enemy.poisoned > 0) {
      enemy.currentHp = Math.max(1, enemy.currentHp - enemy.poisoned);
      events.push({ type: 'poison_tick', unit: enemy.name, damage: enemy.poisoned });
      enemy.poisoned = 0;
      if (enemy.currentHp <= 0) { checkKO(enemy, events, battle); continue; }
    }
    // Tick poison DOT ennemi
    if (enemy.poisonDotTurns > 0 && enemy.poisonDot > 0) {
      enemy.currentHp = Math.max(1, enemy.currentHp - enemy.poisonDot);
      events.push({ type: 'poison_tick', unit: enemy.name, damage: enemy.poisonDot, desc: `Poison (${enemy.poisonDotTurns} tours restants)` });
      enemy.poisonDotTurns--;
      if (enemy.poisonDotTurns <= 0) enemy.poisonDot = 0;
      if (enemy.currentHp <= 0) { checkKO(enemy, events, battle); continue; }
    }

    // Fortification Guerrier ennemi
    if (enemy.type === 'guerrier' && !enemy.lowHpDefTriggered && enemy.currentHp / enemy.maxHp < 0.3) {
      enemy.permanentBonusDef += 2;
      enemy.lowHpDefTriggered = true;
      events.push({ type: 'type_passive', desc: `${enemy.name} active Fortification ! +2 DEF` });
    }

    if (enemy.stunned) {
      enemy.stunned = false;
      events.push({ type: 'stunned', unit: enemy.name });
      continue;
    }

    // Ability on first attack
    if (!enemy.usedAbility) {
      const abilityEvents = resolveAbility(enemy, battle.playerTeam.filter(p => p.alive), battle.enemyTeam, battle.playerTeam, battle);
      events.push(...abilityEvents);
      if (checkWin(battle)) return events;
    }

    // Target weakest player
    const currentAlivePlayers = battle.playerTeam.filter(p => p.alive);
    if (currentAlivePlayers.length === 0) break;
    const target = currentAlivePlayers.reduce((a, b) => a.currentHp < b.currentHp ? a : b);

    const ignoreDef = ABILITY_MAP[enemy.ability_name]?.type === 'ignore_def';
    const dmg = calcDamage(enemy, target, ignoreDef);
    applyDamage(target, dmg, events, enemy, battle);
    events.push({ type: 'attack', attacker: enemy.name, attackerIndex: enemy.index, target: target.name, targetIndex: target.index, damage: dmg, side: 'enemy' });

    // Lifesteal ennemi
    if (enemy.lifestealPercent > 0) {
      const healed = Math.floor(dmg * enemy.lifestealPercent / 100);
      enemy.currentHp = Math.min(enemy.maxHp, enemy.currentHp + healed);
    }
    // Feroce Bete ennemi
    if (!target.alive && enemy.type === 'bete') {
      enemy.permanentBonusAtk += 1;
    }
    // Passif Salamandre Ardente ennemi
    if (enemy.name === 'Salamandre Ardente' && !target.alive) {
      enemy.permanentBonusAtk = (enemy.permanentBonusAtk || 0) + 1;
      enemy.lastingAtkBuff = (enemy.lastingAtkBuff || 0) + 1;
      enemy.lastingAtkTurns = 2;
      events.push({ type: 'type_passive', desc: `${enemy.name} s'enflamme ! +1 ATK (tour suivant)` });
    }
    // Passif Dragonnet de Braise ennemi
    if (!target.alive) {
      battle.enemyTeam.filter(u => u.alive && u.name === 'Dragonnet de Braise' && u !== enemy).forEach(u => {
        u.buffAtk += 1;
        events.push({ type: 'type_passive', desc: `${u.name} s'embrase ! +1 ATK` });
      });
    }

    if (checkWin(battle)) return events;
  }

  return events;
}

// ============================================
// DECK BATTLE ENGINE — deck/hand/field/energy
// ============================================

let deckHandIdCounter = 1;

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function makeHandCard(card) {
  const id = deckHandIdCounter++;
  const es = getEffectiveStats(card);
  return {
    handId: id,
    cardId: card.id || null,
    userCardId: card.user_card_id || null,
    name: card.name,
    emoji: card.emoji || '',
    rarity: card.rarity,
    type: card.type,
    element: card.element,
    attack: card.attack,
    defense: card.defense,
    hp: card.hp,
    mana_cost: card.mana_cost,
    is_fused: card.is_fused || 0,
    is_shiny: card.is_shiny || 0,
    is_temp: card.is_temp || 0,
    ability_name: card.ability_name,
    ability_desc: card.ability_desc,
    passive_desc: card.passive_desc || '',
    crystal_cost: card.crystal_cost || 1,
    effectiveStats: es,
  };
}

function makeDeckFieldUnit(handCard, side) {
  const es = { ...handCard.effectiveStats };
  // Passif Guerrier : +10% PV max
  if (handCard.type === 'guerrier') {
    es.hp = Math.floor(es.hp * 1.1);
  }
  return {
    handId: handCard.handId,
    cardId: handCard.cardId,
    userCardId: handCard.userCardId,
    name: handCard.name,
    emoji: handCard.emoji,
    rarity: handCard.rarity,
    type: handCard.type,
    element: handCard.element,
    attack: handCard.attack,
    defense: handCard.defense,
    hp: handCard.hp,
    mana_cost: handCard.mana_cost,
    is_fused: handCard.is_fused,
    is_shiny: handCard.is_shiny,
    is_temp: handCard.is_temp || 0,
    ability_name: handCard.ability_name,
    ability_desc: handCard.ability_desc,
    passive_desc: handCard.passive_desc || '',
    crystal_cost: handCard.crystal_cost || 1,
    effectiveStats: es,
    side,
    currentHp: es.hp,
    maxHp: es.hp,
    alive: true,
    buffAtk: 0,
    buffDef: 0,
    stunned: false,
    usedAbility: false,
    hasAttacked: false,
    canRevive: ABILITY_MAP[handCard.ability_name]?.type === 'revive' || handCard.name === 'Phoenix Ancestral',
    shield: 0,
    poisoned: 0,
    marked: 0,
    counterDamage: 0,
    permanentBonusAtk: 0,
    permanentBonusDef: 0,
    lowHpDefTriggered: false,
    graceUsed: false,
    lifestealPercent: 0,
    woundedBonus: 0,
    reactiveArmor: 0,
    lastingDefBuff: 0,
    lastingAtkBuff: 0,
    lastingAtkTurns: 0,
    poisonDot: 0,
    poisonDotTurns: 0,
    ralliement: false,
  };
}

function createDeckBattleState(playerCards, enemyCards, battleType) {
  const battleId = 'battle_' + (battleIdCounter++);

  const pDeck = shuffleArray(playerCards.map(c => makeHandCard(c)));
  const eDeck = shuffleArray(enemyCards.map(c => makeHandCard(c)));

  const pHand = pDeck.splice(0, 5);
  const eHand = eDeck.splice(0, 5);

  const state = {
    battleId,
    battleType,
    isDeckBattle: true,
    turn: 1,
    phase: 'player_turn',
    maxTurns: 20,
    playerDeck: pDeck,
    playerHand: pHand,
    playerField: [null, null, null],
    playerEnergy: getManaForTurn(1),
    playerMaxEnergy: getManaForTurn(1),
    playerCrystal: 0,
    playerCrystalRate: 0.3,
    playerMaxCrystal: 2,
    playerHp: 20,
    playerMaxHp: 20,
    enemyDeck: eDeck,
    enemyHand: eHand,
    enemyField: [null, null, null],
    enemyEnergy: getManaForTurn(1),
    enemyMaxEnergy: getManaForTurn(1),
    enemyCrystal: 0,
    enemyCrystalRate: 0.3,
    enemyMaxCrystal: 2,
    enemyHp: 20,
    enemyMaxHp: 20,
    attackedThisTurn: [],
    log: [],
    result: null,
    lastAction: Date.now(),
    deadTempCards: [],
  };

  activeBattles.set(battleId, state);
  return state;
}

function getDeckBattleSnapshot(battle) {
  return {
    battleId: battle.battleId,
    turn: battle.turn,
    phase: battle.phase,
    result: battle.result,
    playerHand: battle.playerHand,
    playerField: battle.playerField,
    playerEnergy: battle.playerEnergy,
    playerMaxEnergy: battle.playerMaxEnergy,
    playerCrystal: Math.round((battle.playerCrystal || 0) * 100) / 100,
    playerMaxCrystal: battle.playerMaxCrystal || 2,
    playerDeckCount: battle.playerDeck.length,
    playerHp: battle.playerHp,
    playerMaxHp: battle.playerMaxHp,
    enemyField: battle.enemyField,
    enemyHandCount: battle.enemyHand.length,
    enemyEnergy: battle.enemyEnergy,
    enemyMaxEnergy: battle.enemyMaxEnergy,
    enemyCrystal: Math.round((battle.enemyCrystal || 0) * 100) / 100,
    enemyMaxCrystal: battle.enemyMaxCrystal || 2,
    enemyDeckCount: battle.enemyDeck.length,
    enemyHp: battle.enemyHp,
    enemyMaxHp: battle.enemyMaxHp,
    attackedThisTurn: battle.attackedThisTurn || [],
  };
}

function getFieldAlive(field) {
  return field.filter(u => u !== null && u.alive);
}

function cleanDeadFromField(field) {
  for (let i = 0; i < field.length; i++) {
    if (field[i] && !field[i].alive) field[i] = null;
  }
}

function getPackBonus(field, unit) {
  if (unit.type !== 'bete') return 0;
  const beteCount = field.filter(u => u && u.alive && u.type === 'bete').length;
  return beteCount >= 2 ? 1 : 0;
}

function checkDeckWin(battle) {
  // Win by reducing opponent HP to 0
  if (battle.enemyHp <= 0) {
    battle.result = 'victory';
    return 'victory';
  }

  if (battle.playerHp <= 0) {
    battle.result = 'defeat';
    return 'defeat';
  }

  if (battle.turn > battle.maxTurns) {
    if (battle.playerHp > battle.enemyHp) { battle.result = 'victory'; return 'victory'; }
    if (battle.enemyHp > battle.playerHp) { battle.result = 'defeat'; return 'defeat'; }
    battle.result = 'draw';
    return 'draw';
  }

  return null;
}

function resolveItemEffect(item, target, allAllies, allEnemies, events, battle) {
  const effect = ITEM_EFFECTS[item.ability_name];
  if (!effect) return;

  switch (effect.type) {
    case 'heal':
      if (target && target.alive) {
        target.currentHp = Math.min(target.maxHp, target.currentHp + effect.value);
        events.push({ type: 'item_heal', item: item.name, target: target.name, emoji: item.emoji, heal: effect.value });
      }
      break;
    case 'damage':
      if (target && target.alive) {
        applyDamage(target, effect.value, events, null, battle);
        events.push({ type: 'item_damage', item: item.name, target: target.name, emoji: item.emoji, damage: effect.value });
      }
      break;
    case 'damage_ignore_def':
      if (target && target.alive) {
        // Bypass shield for ignore def items
        target.currentHp = Math.max(0, target.currentHp - effect.value);
        if (target.currentHp <= 0) checkKO(target, events, battle);
        events.push({ type: 'item_damage', item: item.name, target: target.name, emoji: item.emoji, damage: effect.value, ignoreDef: true });
      }
      break;
    case 'buff_atk':
      if (target && target.alive) {
        target.buffAtk += effect.value;
        events.push({ type: 'item_buff', item: item.name, target: target.name, emoji: item.emoji, desc: `+${effect.value} ATK` });
      }
      break;
    case 'buff_atk_permanent':
      if (target && target.alive) {
        target.permanentBonusAtk += effect.value;
        events.push({ type: 'item_buff', item: item.name, target: target.name, emoji: item.emoji, desc: `+${effect.value} ATK permanent` });
      }
      break;
    case 'shield':
      if (target && target.alive) {
        target.shield += effect.value;
        events.push({ type: 'item_buff', item: item.name, target: target.name, emoji: item.emoji, desc: `+${effect.value} bouclier` });
      }
      break;
    case 'stun':
      if (target && target.alive) {
        target.stunned = true;
        events.push({ type: 'item_stun', item: item.name, target: target.name, emoji: item.emoji });
      }
      break;
    case 'poison':
      if (target && target.alive) {
        target.poisoned = (target.poisoned || 0) + effect.value;
        events.push({ type: 'item_poison', item: item.name, target: target.name, emoji: item.emoji, damage: effect.value });
      }
      break;
    case 'team_heal':
      allAllies.forEach(u => {
        if (u && u.alive) u.currentHp = Math.min(u.maxHp, u.currentHp + effect.value);
      });
      events.push({ type: 'item_team_heal', item: item.name, emoji: item.emoji, heal: effect.value });
      break;
    case 'buff_team_atk':
      allAllies.forEach(u => {
        if (u && u.alive) u.buffAtk += effect.value;
      });
      events.push({ type: 'item_buff', item: item.name, emoji: item.emoji, desc: `+${effect.value} ATK equipe` });
      break;
    case 'aoe_damage':
      allEnemies.forEach(u => {
        if (u && u.alive) {
          applyDamage(u, effect.value, events, null, battle);
          events.push({ type: 'item_aoe', item: item.name, target: u.name, emoji: item.emoji, damage: effect.value });
        }
      });
      break;
    case 'add_crystal':
      // Crystal items add crystal to player — handled in use-item route
      events.push({ type: 'item_buff', item: item.name, emoji: item.emoji, desc: `+${effect.value} crystal` });
      break;
  }
}

function aiDeckTurn(battle) {
  const events = [];

  // Divin aura for enemy field
  const divinCount = getFieldAlive(battle.enemyField).filter(u => u.type === 'divin').length;
  if (divinCount > 0) {
    getFieldAlive(battle.enemyField).forEach(u => {
      u.currentHp = Math.min(u.maxHp, u.currentHp + divinCount);
    });
    events.push({ type: 'type_passive', desc: `Aura divine ennemie : +${divinCount} PV` });
  }

  // Passif Esprit des Forets : +1 DEF pour les unites Terre ennemies
  const espritCountE = getFieldAlive(battle.enemyField).filter(u => u.name === 'Esprit des Forets').length;
  if (espritCountE > 0) {
    getFieldAlive(battle.enemyField).filter(u => u.element === 'terre').forEach(u => {
      u.buffDef += espritCountE;
    });
    events.push({ type: 'type_passive', desc: `Esprit des Forets ennemi : +${espritCountE} DEF Terre` });
  }

  // Passif Eclaireur des Dunes ennemi : +2 DEF si seule
  const eclaireurAliveE = getFieldAlive(battle.enemyField);
  eclaireurAliveE.filter(u => u.name === 'Eclaireur des Dunes').forEach(u => {
    if (eclaireurAliveE.length === 1) {
      u.buffDef += 2;
      events.push({ type: 'type_passive', desc: `${u.name} ennemi est seule ! +2 DEF` });
    }
  });

  // 1. Deploy: play most expensive affordable creature to empty slots
  let keepDeploying = true;
  while (keepDeploying) {
    keepDeploying = false;
    const emptySlots = [];
    for (let i = 0; i < 3; i++) {
      if (!battle.enemyField[i] || !battle.enemyField[i].alive) {
        battle.enemyField[i] = null;
        emptySlots.push(i);
      }
    }
    if (emptySlots.length === 0) break;

    const creatures = battle.enemyHand
      .filter(c => c.type !== 'objet' && c.mana_cost <= battle.enemyEnergy)
      .sort((a, b) => b.mana_cost - a.mana_cost);

    if (creatures.length > 0) {
      const card = creatures[0];
      const slot = emptySlots[0];
      const handIdx = battle.enemyHand.indexOf(card);
      battle.enemyHand.splice(handIdx, 1);

      const unit = makeDeckFieldUnit(card, 'enemy');
      unit.justDeployed = true; // summoning sickness
      battle.enemyField[slot] = unit;
      battle.enemyEnergy -= card.mana_cost;

      events.push({ type: 'enemy_deploy', slot, name: unit.name, emoji: unit.emoji, mana_cost: unit.mana_cost });

      // Passif Tortue : unites Eau invoquees +1 PV
      if (unit.element === 'eau') {
        const tortueCount = getFieldAlive(battle.enemyField).filter(u => u.name === 'Tortue des Rivieres' && u !== unit).length;
        if (tortueCount > 0) {
          unit.maxHp += tortueCount;
          unit.currentHp += tortueCount;
          events.push({ type: 'type_passive', desc: `Tortue : +${tortueCount} PV a ${unit.name}` });
        }
      }

      // Passif Sapeur de Terre : +1 ATK jusqu'a fin du tour suivant
      if (unit.name === 'Sapeur de Terre') {
        unit.permanentBonusAtk = (unit.permanentBonusAtk || 0) + 1;
        unit.lastingAtkBuff = (unit.lastingAtkBuff || 0) + 1;
        unit.lastingAtkTurns = 2;
        events.push({ type: 'type_passive', desc: `${unit.name} se prepare ! +1 ATK (2 tours)` });
      }

      // Passif Poisson Combattant : pas de summoning sickness
      if (unit.name === 'Poisson Combattant') {
        unit.justDeployed = false;
        events.push({ type: 'type_passive', desc: `${unit.name} pret au combat ! Peut attaquer immediatement` });
      }

      keepDeploying = true;
    }
  }

  // 2. Use abilities (costs crystal)
  for (let i = 0; i < 3; i++) {
    const unit = battle.enemyField[i];
    if (!unit || !unit.alive || unit.usedAbility || unit.stunned) continue;

    const crystalCost = unit.crystal_cost || 1;
    if ((battle.enemyCrystal || 0) < crystalCost) continue;

    const ability = ABILITY_MAP[unit.ability_name];
    if (!ability) continue;

    const playerAlive = getFieldAlive(battle.playerField);
    const enemyAlive = getFieldAlive(battle.enemyField);

    // Skip offensive abilities if no player targets
    if (playerAlive.length === 0 && !['buff_atk', 'buff_def', 'buff_team_atk', 'buff_team_def', 'shield', 'heal_ally', 'counter', 'lifesteal_attack', 'revive'].includes(ability.type)) continue;

    const abilityEvents = resolveAbility(unit, playerAlive, enemyAlive, playerAlive, battle);
    events.push(...abilityEvents);
    battle.enemyCrystal -= crystalCost;

    cleanDeadFromField(battle.playerField);
    if (checkDeckWin(battle)) return events;
  }

  // 3. Use items from hand (heal weakest ally, damage weakest enemy)
  const itemsToPlay = [...battle.enemyHand.filter(c => c.type === 'objet')];
  for (const item of itemsToPlay) {
    if (item.mana_cost > battle.enemyEnergy) continue;
    if (!battle.enemyHand.includes(item)) continue;

    const effect = ITEM_EFFECTS[item.ability_name];
    if (!effect) continue;

    const playerAlive = getFieldAlive(battle.playerField);
    const enemyAlive = getFieldAlive(battle.enemyField);

    let target = null;
    if (effect.target === 'ally') {
      target = enemyAlive.length > 0 ? enemyAlive.reduce((a, b) => a.currentHp < b.currentHp ? a : b) : null;
      if (!target || (effect.type === 'heal' && target.currentHp >= target.maxHp * 0.8)) continue;
    } else if (effect.target === 'enemy') {
      target = playerAlive.length > 0 ? playerAlive.reduce((a, b) => a.currentHp < b.currentHp ? a : b) : null;
      if (!target) continue;
    } else if (effect.target === 'team') {
      if (enemyAlive.length === 0) continue;
    } else if (effect.target === 'all_enemies') {
      if (playerAlive.length === 0) continue;
    } else if (effect.target === 'self') {
      // Crystal items — no target needed, always playable
    }

    resolveItemEffect(item, target, enemyAlive, playerAlive, events, battle);

    // Crystal items : ajouter crystal a l'ennemi
    if (effect.type === 'add_crystal') {
      battle.enemyCrystal = Math.min(battle.enemyMaxCrystal, (battle.enemyCrystal || 0) + effect.value);
    }

    const idx = battle.enemyHand.indexOf(item);
    if (idx >= 0) battle.enemyHand.splice(idx, 1);
    battle.enemyEnergy -= item.mana_cost;

    cleanDeadFromField(battle.playerField);
    if (checkDeckWin(battle)) return events;
  }

  // 4. Attack with each field creature (target weakest player unit or avatar)
  for (let i = 0; i < 3; i++) {
    const unit = battle.enemyField[i];
    if (!unit || !unit.alive) continue;

    // Summoning sickness: skip attack if just deployed
    if (unit.justDeployed) continue;

    if (unit.stunned) {
      unit.stunned = false;
      events.push({ type: 'stunned', unit: unit.name });
      continue;
    }

    // Attacks cost 1 energy for AI too
    if (battle.enemyEnergy < 1) break;

    // Fortification Guerrier
    if (unit.type === 'guerrier' && !unit.lowHpDefTriggered && unit.currentHp / unit.maxHp < 0.3) {
      unit.permanentBonusDef += 2;
      unit.lowHpDefTriggered = true;
      events.push({ type: 'type_passive', desc: `${unit.name} active Fortification ! +2 DEF` });
    }

    const playerAlive = getFieldAlive(battle.playerField);

    if (playerAlive.length === 0) {
      // No player cards on field: attack player avatar
      const totalAtk = unit.effectiveStats.attack + (unit.buffAtk || 0) + (unit.permanentBonusAtk || 0);
      const dmg = Math.max(1, totalAtk);
      battle.playerHp = Math.max(0, battle.playerHp - dmg);
      battle.enemyEnergy -= 1;
      events.push({ type: 'avatar_damage', attacker: unit.name, damage: dmg, targetHp: battle.playerHp, side: 'enemy' });
      if (checkDeckWin(battle)) return events;
      continue;
    }

    const target = playerAlive.reduce((a, b) => a.currentHp < b.currentHp ? a : b);

    const ignoreDef = ABILITY_MAP[unit.ability_name]?.type === 'ignore_def';

    // Bete pack bonus (temp)
    const packBonus = getPackBonus(battle.enemyField, unit);
    unit.permanentBonusAtk += packBonus;
    const dmg = calcDamage(unit, target, ignoreDef, battle.enemyField);
    unit.permanentBonusAtk -= packBonus;

    applyDamage(target, dmg, events, unit, battle);
    const targetSlot = battle.playerField.indexOf(target);
    events.push({ type: 'attack', attacker: unit.name, attackerSlot: i, target: target.name, targetSlot, damage: dmg, side: 'enemy' });

    battle.enemyEnergy -= 1;

    // Lifesteal
    if (unit.lifestealPercent > 0) {
      const healed = Math.floor(dmg * unit.lifestealPercent / 100);
      unit.currentHp = Math.min(unit.maxHp, unit.currentHp + healed);
    }
    // Passif Salamandre : +1 ATK si elle detruit un ennemi
    if (unit.name === 'Salamandre Ardente' && !target.alive) {
      unit.permanentBonusAtk = (unit.permanentBonusAtk || 0) + 1;
      unit.lastingAtkBuff = (unit.lastingAtkBuff || 0) + 1;
      unit.lastingAtkTurns = 2;
      events.push({ type: 'type_passive', desc: `${unit.name} s'enflamme ! +1 ATK (tour suivant)` });
    }
    // Feroce Bete
    if (!target.alive && unit.type === 'bete') {
      unit.permanentBonusAtk += 1;
      events.push({ type: 'type_passive', desc: `${unit.name} gagne en feroce ! +1 ATK` });
    }

    // Passif Dragonnet de Braise : +1 ATK temporaire si une unite meurt
    if (!target.alive) {
      getFieldAlive(battle.enemyField).filter(u => u.name === 'Dragonnet de Braise').forEach(u => {
        u.buffAtk += 1;
        events.push({ type: 'type_passive', desc: `${u.name} s'embrase ! +1 ATK` });
      });
    }

    // Passif Requin des Profondeurs ennemi : attaque bonus apres un kill
    if (!target.alive && unit.name === 'Requin des Profondeurs' && unit.alive) {
      const newPlayerAlive = getFieldAlive(battle.playerField);
      if (newPlayerAlive.length > 0 && battle.enemyEnergy >= 1) {
        const newTarget = newPlayerAlive.reduce((a, b) => a.currentHp < b.currentHp ? a : b);
        const bonusDmg = calcDamage(unit, newTarget, false, battle.enemyField);
        applyDamage(newTarget, bonusDmg, events, unit, battle);
        const newTargetSlot = battle.playerField.indexOf(newTarget);
        events.push({ type: 'type_passive', desc: `${unit.name} sent le sang ! Attaque bonus` });
        events.push({ type: 'attack', attacker: unit.name, attackerSlot: i, target: newTarget.name, targetSlot: newTargetSlot, damage: bonusDmg, side: 'enemy' });
        battle.enemyEnergy -= 1;
      }
    }

    cleanDeadFromField(battle.playerField);
    if (checkDeckWin(battle)) return events;
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
const sessionDb = new Database(path.join(__dirname, 'sessions.db'));
const sessionMiddleware = session({
  store: new SqliteStore({ client: sessionDb, expired: { clear: true, intervalMs: 900000 } }),
  secret: 'gacha-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
});
app.use(sessionMiddleware);

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Non connecte' });
  }
  next();
}

// --- Routes AUTH ---
app.post('/api/check-username', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Champs requis' });
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  res.json({ exists: !!existing });
});

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs requis' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Pseudo: 3-20 caracteres' });
  if (password.length < 6) return res.status(400).json({ error: 'Mot de passe: 6 caracteres min' });
  if (!/[A-Z]/.test(password)) return res.status(400).json({ error: 'Mot de passe: 1 majuscule requise' });

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
  const user = db.prepare('SELECT username, credits, last_daily, avatar, display_name, excavation_essence, username_effect, unlocked_avatars, login_streak, last_streak_date FROM users WHERE id = ?').get(req.session.userId);
  const cardCount = db.prepare('SELECT COUNT(*) as c FROM user_cards WHERE user_id = ?').get(req.session.userId).c;

  const today = new Date().toISOString().split('T')[0];
  const canClaimDaily = user.last_daily !== today;

  // Calculate current streak for display
  let displayStreak = user.login_streak || 0;
  if (user.last_streak_date) {
    const lastDate = new Date(user.last_streak_date);
    const todayDate = new Date(today);
    const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
    if (diffDays > 1) displayStreak = 0;
  }

  const bp = db.prepare('SELECT xp, current_tier FROM battle_pass WHERE user_id = ?').get(req.session.userId);

  res.json({
    username: user.username,
    displayName: user.display_name || user.username,
    avatar: user.avatar || '⚔',
    credits: user.credits,
    essence: user.excavation_essence || 0,
    cardCount,
    canClaimDaily,
    loginStreak: displayStreak,
    streakRewards: STREAK_REWARDS,
    usernameEffect: user.username_effect || '',
    unlockedAvatars: JSON.parse(user.unlocked_avatars || '["⚔"]'),
    battlePassTier: bp?.current_tier || 0,
    battlePassXP: bp?.xp || 0
  });
});

// User settings (avatar + display name)
const VALID_AVATARS = [
  '⚔','🗡','🛡','🏹','🔮','💀','🐉','👑','🦅','🐺',
  '🦁','🔥','❄','⚡','🌙','☀','💎','🎭','👹','🧙',
  '🤖','👻','🦇','🐍','🦂','🌋','🌊','🌿','⭐','💫',
  '🏰','🗿','🎲','🃏','🪄','🧿','⛏','🦴','🕷','🎯'
];

app.post('/api/settings', requireAuth, (req, res) => {
  const { avatar, displayName } = req.body;
  const userId = req.session.userId;

  if (avatar !== undefined) {
    const u = db.prepare('SELECT unlocked_avatars FROM users WHERE id = ?').get(userId);
    const unlockedAvatars = JSON.parse(u.unlocked_avatars || '["⚔"]');
    const allAllowed = [...VALID_AVATARS, ...unlockedAvatars];
    if (!allAllowed.includes(avatar)) {
      return res.status(400).json({ error: 'Avatar non deverrouille' });
    }
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, userId);
  }

  if (displayName !== undefined) {
    const trimmed = displayName.trim();
    if (trimmed.length < 3 || trimmed.length > 20) {
      return res.status(400).json({ error: 'Pseudo: 3-20 caracteres' });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      return res.status(400).json({ error: 'Pseudo: lettres, chiffres, _ et - uniquement' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(display_name) = LOWER(?) AND id != ?').get(trimmed, userId);
    const existingUsername = db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?').get(trimmed, userId);
    if (existing || existingUsername) {
      return res.status(409).json({ error: 'Ce pseudo est deja pris' });
    }
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(trimmed, userId);
  }

  const user = db.prepare('SELECT username, avatar, display_name FROM users WHERE id = ?').get(userId);
  res.json({ success: true, avatar: user.avatar || '⚔', displayName: user.display_name || user.username });
});

app.post('/api/daily', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare('SELECT credits, last_daily, login_streak, last_streak_date FROM users WHERE id = ?').get(userId);
  const today = new Date().toISOString().split('T')[0];

  if (user.last_daily === today) {
    return res.status(400).json({ error: 'Deja recupere aujourd\'hui !' });
  }

  // Calculate streak
  let newStreak = 1;
  if (user.last_streak_date) {
    const lastDate = new Date(user.last_streak_date);
    const todayDate = new Date(today);
    const diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      newStreak = (user.login_streak >= 7) ? 1 : user.login_streak + 1;
    } else {
      newStreak = 1;
    }
  }

  const reward = STREAK_REWARDS[newStreak - 1];
  const creditAmount = reward.credits;

  db.prepare('UPDATE users SET credits = credits + ?, last_daily = ?, login_streak = ?, last_streak_date = ?, stat_total_earned = stat_total_earned + ? WHERE id = ?')
    .run(creditAmount, today, newStreak, today, creditAmount, userId);
  addBattlePassXP(userId, BP_XP.daily_login);
  updateQuestProgress(userId, 'daily_claim', 1);
  updateQuestProgress(userId, 'credits_earned', creditAmount);
  checkAchievements(userId);

  let cardGiven = null;
  if (reward.card) {
    const cards = db.prepare('SELECT * FROM cards WHERE rarity = ?').all(reward.card);
    if (cards.length > 0) {
      const card = cards[Math.floor(Math.random() * cards.length)];
      db.prepare('INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)').run(userId, card.id);
      cardGiven = { name: card.name, rarity: card.rarity, emoji: card.emoji };
    }
  }

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  res.json({ success: true, amount: creditAmount, credits: newCredits, streakDay: newStreak, cardGiven });
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

  db.prepare('UPDATE users SET credits = credits - ?, stat_boosters_opened = stat_boosters_opened + 1, stat_credits_spent = stat_credits_spent + ? WHERE id = ?').run(booster.price, booster.price, req.session.userId);
  // Track per-booster type
  const boosterCol = 'stat_boosters_' + req.params.id;
  if (['stat_boosters_origines', 'stat_boosters_rift', 'stat_boosters_avance'].includes(boosterCol)) {
    db.prepare(`UPDATE users SET ${boosterCol} = ${boosterCol} + 1 WHERE id = ?`).run(req.session.userId);
  }
  const cards = openBooster(booster.id, req.session.userId);
  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.session.userId).credits;
  addBattlePassXP(req.session.userId, BP_XP.booster_open);
  updateQuestProgress(req.session.userId, 'booster_open', 1);
  updateQuestProgress(req.session.userId, 'credits_spent', booster.price);
  checkAchievements(req.session.userId);

  res.json({ success: true, cards, credits: newCredits });
});

// --- Routes COLLECTION (updated with shiny/fused grouping) ---
app.get('/api/collection', requireAuth, (req, res) => {
  const cards = db.prepare(`
    SELECT c.*, uc.is_shiny, uc.is_fused, uc.is_temp, COUNT(*) as count, MIN(uc.id) as user_card_id
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ?
    GROUP BY c.id, uc.is_shiny, uc.is_fused, uc.is_temp
    ORDER BY
      CASE c.rarity WHEN 'secret' THEN -1 WHEN 'chaos' THEN 0 WHEN 'legendaire' THEN 1 WHEN 'epique' THEN 2 WHEN 'rare' THEN 3 WHEN 'commune' THEN 4 END,
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
    SELECT c.*, uc.is_shiny, uc.is_fused, uc.is_temp, COUNT(*) as count, MIN(uc.id) as user_card_id
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ?
    GROUP BY c.id, uc.is_shiny, uc.is_fused, uc.is_temp
    ORDER BY
      CASE c.rarity WHEN 'secret' THEN -1 WHEN 'chaos' THEN 0 WHEN 'legendaire' THEN 1 WHEN 'epique' THEN 2 WHEN 'rare' THEN 3 WHEN 'commune' THEN 4 END,
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
      CASE c.rarity WHEN 'secret' THEN -1 WHEN 'chaos' THEN 0 WHEN 'legendaire' THEN 1 WHEN 'epique' THEN 2 WHEN 'rare' THEN 3 WHEN 'commune' THEN 4 END,
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
  addBattlePassXP(req.session.userId, BP_XP.fusion);
  db.prepare('UPDATE users SET stat_fusions = stat_fusions + 1 WHERE id = ?').run(req.session.userId);
  if (success) {
    db.prepare('UPDATE users SET stat_fusion_success = stat_fusion_success + 1 WHERE id = ?').run(req.session.userId);
  } else {
    db.prepare('UPDATE users SET stat_fusion_fail = stat_fusion_fail + 1 WHERE id = ?').run(req.session.userId);
  }
  updateQuestProgress(req.session.userId, 'fusion', 1);
  checkAchievements(req.session.userId);

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
      SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, uc.is_temp, c.*
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

  // --- Passifs de debut de tour ---
  // Aura Divin (soigne 1 PV/Divin vivant)
  const divinCountP = battle.playerTeam.filter(u => u.alive && u.type === 'divin').length;
  if (divinCountP > 0) {
    battle.playerTeam.filter(u => u.alive).forEach(u => {
      u.currentHp = Math.min(u.maxHp, u.currentHp + divinCountP);
    });
    events.push({ type: 'type_passive', desc: `Aura divine : +${divinCountP} PV a l equipe` });
  }
  // Passif Phoenix Ancestral : 1 degat a tous les ennemis en debut de tour
  const phoenixCountPC = battle.playerTeam.filter(u => u.alive && u.name === 'Phoenix Ancestral').length;
  if (phoenixCountPC > 0) {
    battle.enemyTeam.filter(u => u.alive).forEach(u => {
      u.currentHp = Math.max(0, u.currentHp - phoenixCountPC);
      if (u.currentHp <= 0) checkKO(u, events, battle);
    });
    events.push({ type: 'type_passive', desc: `Phoenix Ancestral : ${phoenixCountPC} degat(s) a tous les ennemis` });
  }
  // Passif Leviathan Abyssal : +1 ATK aux allies Eau
  const leviathanCountPC = battle.playerTeam.filter(u => u.alive && u.name === 'Leviathan Abyssal').length;
  if (leviathanCountPC > 0) {
    battle.playerTeam.filter(u => u.alive && u.element === 'eau').forEach(u => {
      u.buffAtk += leviathanCountPC;
    });
    events.push({ type: 'type_passive', desc: `Leviathan Abyssal : +${leviathanCountPC} ATK aux unites Eau` });
  }
  // Passif Pretresse Solaire : soigne 1 PV a l allie le plus blesse
  const pretresseCountPC = battle.playerTeam.filter(u => u.alive && u.name === 'Pretresse Solaire').length;
  if (pretresseCountPC > 0) {
    for (let i = 0; i < pretresseCountPC; i++) {
      const wounded = battle.playerTeam.filter(u => u.alive && u.currentHp < u.maxHp).sort((a, b) => a.currentHp - b.currentHp)[0];
      if (wounded) {
        wounded.currentHp = Math.min(wounded.maxHp, wounded.currentHp + 1);
        events.push({ type: 'type_passive', desc: `Pretresse Solaire soigne ${wounded.name} de 1 PV` });
      }
    }
  }
  // Tick Poison joueur
  if (attacker.poisoned > 0) {
    attacker.currentHp = Math.max(1, attacker.currentHp - attacker.poisoned);
    events.push({ type: 'poison_tick', unit: attacker.name, damage: attacker.poisoned });
    attacker.poisoned = 0;
  }
  // Tick poison DOT joueur
  if (attacker.poisonDotTurns > 0 && attacker.poisonDot > 0) {
    attacker.currentHp = Math.max(1, attacker.currentHp - attacker.poisonDot);
    events.push({ type: 'poison_tick', unit: attacker.name, damage: attacker.poisonDot, desc: `Poison (${attacker.poisonDotTurns} tours restants)` });
    attacker.poisonDotTurns--;
    if (attacker.poisonDotTurns <= 0) attacker.poisonDot = 0;
  }
  // Fortification Guerrier
  if (attacker.type === 'guerrier' && !attacker.lowHpDefTriggered && attacker.currentHp / attacker.maxHp < 0.3) {
    attacker.permanentBonusDef += 2;
    attacker.lowHpDefTriggered = true;
    events.push({ type: 'type_passive', desc: `${attacker.name} active Fortification ! +2 DEF permanent` });
  }

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
      applyDamage(target, dmg, events, attacker, battle);
      events.push({ type: 'attack', attacker: attacker.name, attackerIndex, target: target.name, targetIndex, damage: dmg, side: 'player' });
      // Lifesteal
      if (attacker.lifestealPercent > 0) {
        const healed = Math.floor(dmg * attacker.lifestealPercent / 100);
        attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + healed);
        events.push({ type: 'ability_heal', unit: attacker.name, target: attacker.name, ability: 'Vampirisme', heal: healed });
      }
      // Passif Bete : Feroce (+1 ATK permanent sur KO)
      if (!target.alive && attacker.type === 'bete') {
        attacker.permanentBonusAtk += 1;
        events.push({ type: 'type_passive', desc: `${attacker.name} gagne en feroce ! +1 ATK permanent` });
      }
      // Passif Salamandre Ardente : +1 ATK si detruit un ennemi
      if (attacker.name === 'Salamandre Ardente' && !target.alive) {
        attacker.permanentBonusAtk = (attacker.permanentBonusAtk || 0) + 1;
        attacker.lastingAtkBuff = (attacker.lastingAtkBuff || 0) + 1;
        attacker.lastingAtkTurns = 2;
        events.push({ type: 'type_passive', desc: `${attacker.name} s'enflamme ! +1 ATK (tour suivant)` });
      }
      // Passif Dragonnet de Braise : +1 ATK temporaire si une unite meurt
      if (!target.alive) {
        battle.playerTeam.filter(u => u.alive && u.name === 'Dragonnet de Braise' && u !== attacker).forEach(u => {
          u.buffAtk += 1;
          events.push({ type: 'type_passive', desc: `${u.name} s'embrase ! +1 ATK` });
        });
      }
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

  // Reset buffs temporaires chaque tour (mais pas les permanents)
  const resetTurnBuffs = (u) => {
    u.buffAtk = 0; u.buffDef = 0;
    u.marked = 0; u.counterDamage = 0;
    u.lifestealPercent = 0;
    // Retirer buff Carapace marine (dure 1 tour)
    if (u.lastingDefBuff > 0) {
      u.permanentBonusDef = Math.max(0, (u.permanentBonusDef || 0) - u.lastingDefBuff);
      u.lastingDefBuff = 0;
    }
    // Retirer buff Sapeur de Terre (dure N tours)
    if (u.lastingAtkBuff > 0 && u.lastingAtkTurns !== undefined) {
      u.lastingAtkTurns--;
      if (u.lastingAtkTurns <= 0) {
        u.permanentBonusAtk = Math.max(0, (u.permanentBonusAtk || 0) - u.lastingAtkBuff);
        u.lastingAtkBuff = 0;
      }
    }
    // Ralliement : recalculer +ATK par Terre allie
    if (u.ralliement && u.alive) {
      const allies = u.side === 'player' ? battle.playerTeam : battle.enemyTeam;
      const earthCount = allies.filter(a => a.alive && a.element === 'terre' && a !== u).length;
      u.buffAtk += earthCount;
    }
  };
  battle.playerTeam.forEach(resetTurnBuffs);
  battle.enemyTeam.forEach(resetTurnBuffs);

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

  // Battle Pass XP
  if (battle.battleType === 'campaign') {
    addBattlePassXP(req.session.userId, battle.result === 'victory' ? BP_XP.campaign_win : BP_XP.campaign_lose);
  } else if (battle.battleType === 'pvp') {
    addBattlePassXP(req.session.userId, battle.result === 'victory' ? BP_XP.pvp_win : BP_XP.pvp_lose);
  }
  // Quest/achievement hooks
  if (battle.result === 'victory' && (battle.battleType === 'pvp')) {
    db.prepare('UPDATE users SET stat_pvp_wins = stat_pvp_wins + 1 WHERE id = ?').run(req.session.userId);
    updateQuestProgress(req.session.userId, 'pvp_win', 1);
  }
  if (reward > 0) {
    updateQuestProgress(req.session.userId, 'credits_earned', reward);
  }
  checkAchievements(req.session.userId);

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.session.userId).credits;

  // Supprimer les cartes TEMP mortes en combat
  if (battle.deadTempCards && battle.deadTempCards.length > 0) {
    const deleteTemp = db.prepare('DELETE FROM user_cards WHERE id = ?');
    const deleteTempTransaction = db.transaction(() => {
      for (const ucId of battle.deadTempCards) {
        deleteTemp.run(ucId);
      }
    });
    deleteTempTransaction();
  }

  activeBattles.delete(battleId);

  res.json({
    success: true,
    result: battle.result,
    reward,
    credits: newCredits,
    droppedCard,
    deadTempCards: battle.deadTempCards || [],
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
        SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, uc.is_temp, c.*
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
        SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, uc.is_temp, c.*
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
      SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, uc.is_temp, c.*
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
        SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, uc.is_temp, c.*
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
// DECK BATTLE ROUTES (new system)
// ============================================

// Start a deck-based PvP battle
app.post('/api/battle/start-deck', requireAuth, (req, res) => {
  const { deckId } = req.body; // deckId: number or 'starter'

  let playerCards;

  if (deckId === 'starter') {
    playerCards = STARTER_DECK.map(c => ({ ...c }));
  } else {
    const deck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(deckId, req.session.userId);
    if (!deck) return res.status(404).json({ error: 'Deck introuvable' });

    const cards = db.prepare(`
      SELECT dc.position, uc.id as user_card_id, uc.is_shiny, uc.is_fused, uc.is_temp, c.*
      FROM deck_cards dc
      JOIN user_cards uc ON dc.user_card_id = uc.id
      JOIN cards c ON uc.card_id = c.id
      WHERE dc.deck_id = ?
      ORDER BY dc.position
    `).all(deck.id);

    if (cards.length !== 20) return res.status(400).json({ error: 'Deck incomplet' });
    playerCards = cards;
  }

  // Find opponent PvP deck
  let enemyCards;
  let opponentName = 'Entraineur';

  const pvpDeck = db.prepare(`
    SELECT d.*, u.username FROM decks d
    JOIN users u ON d.user_id = u.id
    WHERE d.is_pvp_deck = 1 AND d.user_id != ?
    ORDER BY RANDOM() LIMIT 1
  `).get(req.session.userId);

  if (pvpDeck) {
    const oppCards = db.prepare(`
      SELECT dc.position, uc.id as user_card_id, uc.is_shiny, uc.is_fused, uc.is_temp, c.*
      FROM deck_cards dc
      JOIN user_cards uc ON dc.user_card_id = uc.id
      JOIN cards c ON uc.card_id = c.id
      WHERE dc.deck_id = ?
      ORDER BY dc.position
    `).all(pvpDeck.id);

    if (oppCards.length === 20) {
      enemyCards = oppCards;
      opponentName = pvpDeck.username;
    }
  }

  // Fallback: use starter deck
  if (!enemyCards) {
    enemyCards = STARTER_DECK.map(c => ({ ...c }));
  }

  const battle = createDeckBattleState(playerCards, enemyCards, 'pvp');

  res.json({
    ...getDeckBattleSnapshot(battle),
    opponentName,
  });
});

// Deploy a creature from hand to field
app.post('/api/battle/deploy', requireAuth, (req, res) => {
  const { battleId, handIndex, fieldSlot } = req.body;

  const battle = activeBattles.get(battleId);
  if (!battle || !battle.isDeckBattle) return res.status(404).json({ error: 'Combat introuvable' });
  if (battle.result) return res.status(400).json({ error: 'Combat termine' });
  if (battle.phase !== 'player_turn') return res.status(400).json({ error: 'Pas votre tour' });

  battle.lastAction = Date.now();

  const card = battle.playerHand[handIndex];
  if (!card) return res.status(400).json({ error: 'Carte introuvable en main' });
  if (card.type === 'objet') return res.status(400).json({ error: 'Utilisez use-item pour les objets' });
  if (fieldSlot < 0 || fieldSlot > 2) return res.status(400).json({ error: 'Slot invalide' });
  if (battle.playerField[fieldSlot] && battle.playerField[fieldSlot].alive) {
    return res.status(400).json({ error: 'Slot occupe' });
  }
  if (card.mana_cost > battle.playerEnergy) return res.status(400).json({ error: 'Pas assez d energie' });

  // Deploy
  battle.playerHand.splice(handIndex, 1);
  battle.playerField[fieldSlot] = null; // clean dead
  const unit = makeDeckFieldUnit(card, 'player');
  unit.justDeployed = true; // summoning sickness
  battle.playerField[fieldSlot] = unit;
  battle.playerEnergy -= card.mana_cost;

  const events = [{ type: 'deploy', slot: fieldSlot, name: unit.name, emoji: unit.emoji, mana_cost: unit.mana_cost }];

  // Passif Tortue des Rivieres : unites Eau invoquees gagnent +1 PV
  if (unit.element === 'eau') {
    const tortueCount = getFieldAlive(battle.playerField).filter(u => u.name === 'Tortue des Rivieres' && u !== unit).length;
    if (tortueCount > 0) {
      unit.maxHp += tortueCount;
      unit.currentHp += tortueCount;
      events.push({ type: 'type_passive', desc: `Tortue des Rivieres : +${tortueCount} PV max a ${unit.name}` });
    }
  }

  // Passif Sapeur de Terre : +1 ATK jusqu'a fin du tour suivant
  if (unit.name === 'Sapeur de Terre') {
    unit.permanentBonusAtk = (unit.permanentBonusAtk || 0) + 1;
    unit.lastingAtkBuff = (unit.lastingAtkBuff || 0) + 1;
    unit.lastingAtkTurns = 2;
    events.push({ type: 'type_passive', desc: `${unit.name} se prepare ! +1 ATK (2 tours)` });
  }

  // Passif Poisson Combattant : pas de summoning sickness
  if (unit.name === 'Poisson Combattant') {
    unit.justDeployed = false;
    events.push({ type: 'type_passive', desc: `${unit.name} pret au combat ! Peut attaquer immediatement` });
  }

  res.json({ events, ...getDeckBattleSnapshot(battle) });
});

// Attack with a field creature
app.post('/api/battle/attack-card', requireAuth, (req, res) => {
  const { battleId, fieldSlot, targetSlot } = req.body;

  const battle = activeBattles.get(battleId);
  if (!battle || !battle.isDeckBattle) return res.status(404).json({ error: 'Combat introuvable' });
  if (battle.result) return res.status(400).json({ error: 'Combat termine' });
  if (battle.phase !== 'player_turn') return res.status(400).json({ error: 'Pas votre tour' });

  battle.lastAction = Date.now();

  const attacker = battle.playerField[fieldSlot];
  if (!attacker || !attacker.alive) return res.status(400).json({ error: 'Pas de carte dans ce slot' });
  if (attacker.stunned) return res.status(400).json({ error: 'Carte etourdie' });
  if (attacker.justDeployed) return res.status(400).json({ error: 'Carte vient d etre posee (sommeil d invocation)' });
  if (battle.attackedThisTurn.includes(fieldSlot)) return res.status(400).json({ error: 'Deja attaque ce tour' });
  if (battle.playerEnergy < 1) return res.status(400).json({ error: 'Pas assez d energie pour attaquer' });

  const target = battle.enemyField[targetSlot];
  if (!target || !target.alive) return res.status(400).json({ error: 'Pas de cible dans ce slot' });

  // Attacks cost 1 energy
  battle.playerEnergy -= 1;

  const events = [];

  // Fortification Guerrier
  if (attacker.type === 'guerrier' && !attacker.lowHpDefTriggered && attacker.currentHp / attacker.maxHp < 0.3) {
    attacker.permanentBonusDef += 2;
    attacker.lowHpDefTriggered = true;
    events.push({ type: 'type_passive', desc: `${attacker.name} active Fortification ! +2 DEF` });
  }

  const ignoreDef = ABILITY_MAP[attacker.ability_name]?.type === 'ignore_def';

  // Bete pack bonus
  const packBonus = getPackBonus(battle.playerField, attacker);
  attacker.permanentBonusAtk += packBonus;
  const dmg = calcDamage(attacker, target, ignoreDef, battle.playerField);
  attacker.permanentBonusAtk -= packBonus;

  applyDamage(target, dmg, events, attacker, battle);
  events.push({ type: 'attack', attacker: attacker.name, attackerSlot: fieldSlot, target: target.name, targetSlot, damage: dmg, side: 'player' });

  // Passif Salamandre : +1 ATK tour suivant si elle detruit un ennemi
  if (attacker.name === 'Salamandre Ardente' && !target.alive) {
    attacker.permanentBonusAtk = (attacker.permanentBonusAtk || 0) + 1;
    attacker.lastingAtkBuff = (attacker.lastingAtkBuff || 0) + 1;
    attacker.lastingAtkTurns = 2;
    events.push({ type: 'type_passive', desc: `${attacker.name} s'enflamme ! +1 ATK (tour suivant)` });
  }

  battle.attackedThisTurn.push(fieldSlot);

  // Lifesteal
  if (attacker.lifestealPercent > 0) {
    const healed = Math.floor(dmg * attacker.lifestealPercent / 100);
    attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + healed);
    events.push({ type: 'ability_heal', unit: attacker.name, target: attacker.name, ability: 'Vampirisme', heal: healed });
  }
  // Feroce Bete
  if (!target.alive && attacker.type === 'bete') {
    attacker.permanentBonusAtk += 1;
    events.push({ type: 'type_passive', desc: `${attacker.name} gagne en feroce ! +1 ATK` });
  }

  // Passif Dragonnet de Braise : +1 ATK temporaire si une unite meurt ce tour
  if (!target.alive) {
    getFieldAlive(battle.playerField).filter(u => u.name === 'Dragonnet de Braise').forEach(u => {
      u.buffAtk += 1;
      events.push({ type: 'type_passive', desc: `${u.name} s'embrase ! +1 ATK` });
    });
  }

  // Passif Requin des Profondeurs : peut attaquer une 2e fois apres un kill
  if (!target.alive && attacker.name === 'Requin des Profondeurs' && attacker.alive) {
    const idx = battle.attackedThisTurn.indexOf(fieldSlot);
    if (idx !== -1) {
      battle.attackedThisTurn.splice(idx, 1);
      events.push({ type: 'type_passive', desc: `${attacker.name} sent le sang ! Peut attaquer a nouveau` });
    }
  }

  cleanDeadFromField(battle.enemyField);
  checkDeckWin(battle);

  res.json({ events, ...getDeckBattleSnapshot(battle) });
});

// Use ability of a field creature
app.post('/api/battle/use-ability', requireAuth, (req, res) => {
  const { battleId, fieldSlot, targetSlot } = req.body;

  const battle = activeBattles.get(battleId);
  if (!battle || !battle.isDeckBattle) return res.status(404).json({ error: 'Combat introuvable' });
  if (battle.result) return res.status(400).json({ error: 'Combat termine' });
  if (battle.phase !== 'player_turn') return res.status(400).json({ error: 'Pas votre tour' });

  battle.lastAction = Date.now();

  const unit = battle.playerField[fieldSlot];
  if (!unit || !unit.alive) return res.status(400).json({ error: 'Pas de carte dans ce slot' });
  if (unit.usedAbility) return res.status(400).json({ error: 'Ability deja utilisee ce combat' });
  if (unit.stunned) return res.status(400).json({ error: 'Carte etourdie' });

  // Pouvoir coute du crystal (pas de l'energie)
  const crystalCost = unit.crystal_cost || 1;
  if ((battle.playerCrystal || 0) < crystalCost) return res.status(400).json({ error: `Pas assez de crystal (${crystalCost} requis)` });

  const ability = ABILITY_MAP[unit.ability_name];
  if (!ability) return res.status(400).json({ error: 'Pas d ability' });

  const enemyAlive = getFieldAlive(battle.enemyField);
  const playerAlive = getFieldAlive(battle.playerField);

  let targets = enemyAlive;
  if (targetSlot !== undefined && targetSlot !== null) {
    const t = battle.enemyField[targetSlot];
    if (t && t.alive) targets = [t];
  }

  const events = resolveAbility(unit, targets, playerAlive, enemyAlive, battle);
  battle.playerCrystal -= crystalCost;

  cleanDeadFromField(battle.enemyField);
  cleanDeadFromField(battle.playerField);
  checkDeckWin(battle);

  res.json({ events, ...getDeckBattleSnapshot(battle) });
});

// Use an item from hand
app.post('/api/battle/use-item', requireAuth, (req, res) => {
  const { battleId, handIndex, targetSlot, targetSide } = req.body;

  const battle = activeBattles.get(battleId);
  if (!battle || !battle.isDeckBattle) return res.status(404).json({ error: 'Combat introuvable' });
  if (battle.result) return res.status(400).json({ error: 'Combat termine' });
  if (battle.phase !== 'player_turn') return res.status(400).json({ error: 'Pas votre tour' });

  battle.lastAction = Date.now();

  const item = battle.playerHand[handIndex];
  if (!item) return res.status(400).json({ error: 'Carte introuvable en main' });
  if (item.type !== 'objet') return res.status(400).json({ error: 'Ce n est pas un objet' });
  if (item.mana_cost > battle.playerEnergy) return res.status(400).json({ error: 'Pas assez d energie' });

  const effect = ITEM_EFFECTS[item.ability_name];
  if (!effect) return res.status(400).json({ error: 'Effet inconnu' });

  const playerAlive = getFieldAlive(battle.playerField);
  const enemyAlive = getFieldAlive(battle.enemyField);

  let target = null;
  if (effect.target === 'ally' && targetSlot !== undefined) {
    target = battle.playerField[targetSlot];
    if (!target || !target.alive) return res.status(400).json({ error: 'Cible alliee invalide' });
  } else if (effect.target === 'enemy' && targetSlot !== undefined) {
    target = battle.enemyField[targetSlot];
    if (!target || !target.alive) return res.status(400).json({ error: 'Cible ennemie invalide' });
  }

  const events = [];
  resolveItemEffect(item, target, playerAlive, enemyAlive, events, battle);

  // Crystal items : ajouter crystal au joueur
  if (effect.type === 'add_crystal') {
    battle.playerCrystal = Math.min(battle.playerMaxCrystal, (battle.playerCrystal || 0) + effect.value);
  }

  battle.playerHand.splice(handIndex, 1);
  battle.playerEnergy -= item.mana_cost;

  cleanDeadFromField(battle.enemyField);
  cleanDeadFromField(battle.playerField);
  checkDeckWin(battle);

  res.json({ events, ...getDeckBattleSnapshot(battle) });
});

// Attack enemy avatar (only when no enemy cards on field)
app.post('/api/battle/attack-avatar', requireAuth, (req, res) => {
  const { battleId, fieldSlot } = req.body;

  const battle = activeBattles.get(battleId);
  if (!battle || !battle.isDeckBattle) return res.status(404).json({ error: 'Combat introuvable' });
  if (battle.result) return res.status(400).json({ error: 'Combat termine' });
  if (battle.phase !== 'player_turn') return res.status(400).json({ error: 'Pas votre tour' });

  battle.lastAction = Date.now();

  const attacker = battle.playerField[fieldSlot];
  if (!attacker || !attacker.alive) return res.status(400).json({ error: 'Pas de carte dans ce slot' });
  if (attacker.stunned) return res.status(400).json({ error: 'Carte etourdie' });
  if (attacker.justDeployed) return res.status(400).json({ error: 'Sommeil d invocation' });
  if (battle.attackedThisTurn.includes(fieldSlot)) return res.status(400).json({ error: 'Deja attaque ce tour' });
  if (battle.playerEnergy < 1) return res.status(400).json({ error: 'Pas assez d energie' });

  const enemyAlive = getFieldAlive(battle.enemyField);
  if (enemyAlive.length > 0) return res.status(400).json({ error: 'Il reste des cartes ennemies' });

  battle.playerEnergy -= 1;

  const totalAtk = attacker.effectiveStats.attack + (attacker.buffAtk || 0) + (attacker.permanentBonusAtk || 0);
  const dmg = Math.max(1, totalAtk);

  battle.enemyHp = Math.max(0, battle.enemyHp - dmg);
  battle.attackedThisTurn.push(fieldSlot);

  const events = [{ type: 'avatar_damage', attacker: attacker.name, damage: dmg, targetHp: battle.enemyHp, side: 'player' }];

  checkDeckWin(battle);
  res.json({ events, ...getDeckBattleSnapshot(battle) });
});

// Use ability on enemy avatar (only when no enemy cards on field)
app.post('/api/battle/use-ability-avatar', requireAuth, (req, res) => {
  const { battleId, fieldSlot } = req.body;

  const battle = activeBattles.get(battleId);
  if (!battle || !battle.isDeckBattle) return res.status(404).json({ error: 'Combat introuvable' });
  if (battle.result) return res.status(400).json({ error: 'Combat termine' });
  if (battle.phase !== 'player_turn') return res.status(400).json({ error: 'Pas votre tour' });

  battle.lastAction = Date.now();

  const unit = battle.playerField[fieldSlot];
  if (!unit || !unit.alive) return res.status(400).json({ error: 'Pas de carte dans ce slot' });
  if (unit.usedAbility) return res.status(400).json({ error: 'Ability deja utilisee' });
  if (unit.stunned) return res.status(400).json({ error: 'Carte etourdie' });

  const crystalCost = unit.crystal_cost || 1;
  if ((battle.playerCrystal || 0) < crystalCost) return res.status(400).json({ error: 'Pas assez de crystal' });

  const enemyAlive = getFieldAlive(battle.enemyField);
  if (enemyAlive.length > 0) return res.status(400).json({ error: 'Il reste des cartes ennemies' });

  const ability = ABILITY_MAP[unit.ability_name];
  if (!ability) return res.status(400).json({ error: 'Pas d ability' });

  // Direct damage abilities deal to avatar
  let dmg = 0;
  if (['direct_damage', 'aoe_damage', 'ignore_def'].includes(ability.type)) {
    dmg = ability.value || 1;
  } else if (ability.type === 'sacrifice') {
    unit.currentHp = Math.max(1, unit.currentHp - Math.floor(unit.maxHp * ability.selfPercent / 100));
    dmg = ability.value || 3;
  } else {
    // Buff/heal/etc abilities - just resolve normally on allies
    const playerAlive = getFieldAlive(battle.playerField);
    const events = resolveAbility(unit, [], playerAlive, [], battle);
    battle.playerCrystal -= crystalCost;
    checkDeckWin(battle);
    return res.json({ events, ...getDeckBattleSnapshot(battle) });
  }

  battle.enemyHp = Math.max(0, battle.enemyHp - dmg);
  battle.playerCrystal -= crystalCost;
  unit.usedAbility = true;

  const events = [
    { type: 'ability', unit: unit.name, ability: unit.ability_name, desc: unit.ability_desc },
    { type: 'avatar_damage', attacker: unit.name, damage: dmg, targetHp: battle.enemyHp, side: 'player' }
  ];

  checkDeckWin(battle);
  res.json({ events, ...getDeckBattleSnapshot(battle) });
});

// End player turn — process effects + AI turn + new turn
app.post('/api/battle/end-turn', requireAuth, (req, res) => {
  const { battleId } = req.body;

  const battle = activeBattles.get(battleId);
  if (!battle || !battle.isDeckBattle) return res.status(404).json({ error: 'Combat introuvable' });
  if (battle.result) return res.status(400).json({ error: 'Combat termine' });
  if (battle.phase !== 'player_turn') return res.status(400).json({ error: 'Pas votre tour' });

  battle.lastAction = Date.now();
  const events = [];

  // 1. Poison ticks on player field
  for (const unit of getFieldAlive(battle.playerField)) {
    if (unit.poisoned > 0) {
      unit.currentHp = Math.max(1, unit.currentHp - unit.poisoned);
      events.push({ type: 'poison_tick', unit: unit.name, damage: unit.poisoned });
      unit.poisoned = 0;
      if (unit.currentHp <= 0) checkKO(unit, events, battle);
    }
    if (unit.alive && unit.poisonDotTurns > 0 && unit.poisonDot > 0) {
      unit.currentHp = Math.max(1, unit.currentHp - unit.poisonDot);
      events.push({ type: 'poison_tick', unit: unit.name, damage: unit.poisonDot, desc: `Poison (${unit.poisonDotTurns} tours restants)` });
      unit.poisonDotTurns--;
      if (unit.poisonDotTurns <= 0) unit.poisonDot = 0;
      if (unit.currentHp <= 0) checkKO(unit, events, battle);
    }
  }
  cleanDeadFromField(battle.playerField);

  // 2. Reset temp buffs on player field
  for (const unit of getFieldAlive(battle.playerField)) {
    unit.buffAtk = 0; unit.buffDef = 0;
    unit.marked = 0; unit.counterDamage = 0;
    unit.lifestealPercent = 0; unit.hasAttacked = false;
    if (unit.lastingDefBuff > 0) {
      unit.permanentBonusDef = Math.max(0, (unit.permanentBonusDef || 0) - unit.lastingDefBuff);
      unit.lastingDefBuff = 0;
    }
    if (unit.lastingAtkBuff > 0 && unit.lastingAtkTurns !== undefined) {
      unit.lastingAtkTurns--;
      if (unit.lastingAtkTurns <= 0) {
        unit.permanentBonusAtk = Math.max(0, (unit.permanentBonusAtk || 0) - unit.lastingAtkBuff);
        unit.lastingAtkBuff = 0;
      }
    }
    if (unit.ralliement && unit.alive) {
      const earthCount = getFieldAlive(battle.playerField).filter(a => a.alive && a.element === 'terre' && a !== unit).length;
      unit.buffAtk += earthCount;
    }
  }

  if (checkDeckWin(battle)) {
    return res.json({ events, ...getDeckBattleSnapshot(battle) });
  }

  // 3. Enemy turn
  battle.phase = 'enemy_turn';

  // Clear summoning sickness on enemy units
  for (const unit of getFieldAlive(battle.enemyField)) {
    unit.justDeployed = false;
  }

  // Enemy energy for this turn (new mana progression)
  battle.enemyMaxEnergy = getManaForTurn(battle.turn);
  battle.enemyEnergy = battle.enemyMaxEnergy;
  // Enemy crystal fills
  battle.enemyCrystal = Math.min(battle.enemyMaxCrystal, (battle.enemyCrystal || 0) + (battle.enemyCrystalRate || 0.3));

  // Enemy draws 1 card
  if (battle.enemyHand.length < 7 && battle.enemyDeck.length > 0) {
    battle.enemyHand.push(battle.enemyDeck.shift());
    events.push({ type: 'enemy_draw' });
  }

  // Enemy turn-start passives
  // Esprit des Forets ennemi : +1 DEF Terre
  const espritCountE = getFieldAlive(battle.enemyField).filter(u => u.name === 'Esprit des Forets').length;
  if (espritCountE > 0) {
    getFieldAlive(battle.enemyField).filter(u => u.element === 'terre').forEach(u => {
      u.buffDef += espritCountE;
    });
    events.push({ type: 'type_passive', desc: `Esprit des Forets ennemi : +${espritCountE} DEF aux Terre` });
  }

  // Passif Eclaireur des Dunes ennemi : +2 DEF si seule
  const enemyAliveUnitsET = getFieldAlive(battle.enemyField);
  enemyAliveUnitsET.filter(u => u.name === 'Eclaireur des Dunes').forEach(u => {
    if (enemyAliveUnitsET.length === 1) {
      u.buffDef += 2;
      events.push({ type: 'type_passive', desc: `${u.name} ennemi est seule ! +2 DEF` });
    }
  });

  // Phoenix Ancestral ennemi : 1 degat a toutes vos unites
  const phoenixCountE = getFieldAlive(battle.enemyField).filter(u => u.name === 'Phoenix Ancestral').length;
  if (phoenixCountE > 0) {
    getFieldAlive(battle.playerField).forEach(u => {
      u.currentHp = Math.max(0, u.currentHp - phoenixCountE);
      if (u.currentHp <= 0) checkKO(u, events, battle);
    });
    cleanDeadFromField(battle.playerField);
    events.push({ type: 'type_passive', desc: `Phoenix Ancestral ennemi : ${phoenixCountE} degat(s) a vos unites` });
  }

  // Leviathan Abyssal ennemi : +1 ATK aux allies Eau ennemis
  const leviathanCountE = getFieldAlive(battle.enemyField).filter(u => u.name === 'Leviathan Abyssal').length;
  if (leviathanCountE > 0) {
    getFieldAlive(battle.enemyField).filter(u => u.element === 'eau').forEach(u => {
      u.buffAtk += leviathanCountE;
    });
    events.push({ type: 'type_passive', desc: `Leviathan Abyssal ennemi : +${leviathanCountE} ATK aux unites Eau` });
  }
  // Passif Pretresse Solaire ennemie : soigne 1 PV a l allie le plus blesse
  const pretresseCountED = getFieldAlive(battle.enemyField).filter(u => u.name === 'Pretresse Solaire').length;
  if (pretresseCountED > 0) {
    for (let i = 0; i < pretresseCountED; i++) {
      const wounded = getFieldAlive(battle.enemyField).filter(u => u.currentHp < u.maxHp).sort((a, b) => a.currentHp - b.currentHp)[0];
      if (wounded) {
        wounded.currentHp = Math.min(wounded.maxHp, wounded.currentHp + 1);
        events.push({ type: 'type_passive', desc: `Pretresse Solaire ennemie soigne ${wounded.name} de 1 PV` });
      }
    }
  }

  if (checkDeckWin(battle)) {
    return res.json({ events, ...getDeckBattleSnapshot(battle) });
  }

  // AI plays
  const aiEvents = aiDeckTurn(battle);
  events.push(...aiEvents);

  if (checkDeckWin(battle)) {
    return res.json({ events, ...getDeckBattleSnapshot(battle) });
  }

  // 4. Poison ticks on enemy field
  for (const unit of getFieldAlive(battle.enemyField)) {
    if (unit.poisoned > 0) {
      unit.currentHp = Math.max(1, unit.currentHp - unit.poisoned);
      events.push({ type: 'poison_tick', unit: unit.name, damage: unit.poisoned });
      unit.poisoned = 0;
      if (unit.currentHp <= 0) checkKO(unit, events, battle);
    }
    if (unit.alive && unit.poisonDotTurns > 0 && unit.poisonDot > 0) {
      unit.currentHp = Math.max(1, unit.currentHp - unit.poisonDot);
      events.push({ type: 'poison_tick', unit: unit.name, damage: unit.poisonDot, desc: `Poison (${unit.poisonDotTurns} tours restants)` });
      unit.poisonDotTurns--;
      if (unit.poisonDotTurns <= 0) unit.poisonDot = 0;
      if (unit.currentHp <= 0) checkKO(unit, events, battle);
    }
  }
  cleanDeadFromField(battle.enemyField);

  // 5. Reset temp buffs on enemy field
  for (const unit of getFieldAlive(battle.enemyField)) {
    unit.buffAtk = 0; unit.buffDef = 0;
    unit.marked = 0; unit.counterDamage = 0;
    unit.lifestealPercent = 0;
    if (unit.lastingDefBuff > 0) {
      unit.permanentBonusDef = Math.max(0, (unit.permanentBonusDef || 0) - unit.lastingDefBuff);
      unit.lastingDefBuff = 0;
    }
    if (unit.lastingAtkBuff > 0 && unit.lastingAtkTurns !== undefined) {
      unit.lastingAtkTurns--;
      if (unit.lastingAtkTurns <= 0) {
        unit.permanentBonusAtk = Math.max(0, (unit.permanentBonusAtk || 0) - unit.lastingAtkBuff);
        unit.lastingAtkBuff = 0;
      }
    }
    if (unit.ralliement && unit.alive) {
      const earthCount = getFieldAlive(battle.enemyField).filter(a => a.alive && a.element === 'terre' && a !== unit).length;
      unit.buffAtk += earthCount;
    }
  }

  if (checkDeckWin(battle)) {
    return res.json({ events, ...getDeckBattleSnapshot(battle) });
  }

  // 6. New turn
  battle.turn++;
  battle.phase = 'player_turn';
  battle.attackedThisTurn = [];

  // Clear summoning sickness on player units
  for (const unit of getFieldAlive(battle.playerField)) {
    unit.justDeployed = false;
  }

  // Player energy (new mana progression)
  battle.playerMaxEnergy = getManaForTurn(battle.turn);
  battle.playerEnergy = battle.playerMaxEnergy;
  // Player crystal fills
  battle.playerCrystal = Math.min(battle.playerMaxCrystal, (battle.playerCrystal || 0) + (battle.playerCrystalRate || 0.3));

  // Player draws 1 card
  if (battle.playerHand.length < 7 && battle.playerDeck.length > 0) {
    const drawn = battle.playerDeck.shift();
    battle.playerHand.push(drawn);
    events.push({ type: 'player_draw', card: drawn });
  }

  // Divin aura for player field
  const divinCountP = getFieldAlive(battle.playerField).filter(u => u.type === 'divin').length;
  if (divinCountP > 0) {
    getFieldAlive(battle.playerField).forEach(u => {
      u.currentHp = Math.min(u.maxHp, u.currentHp + divinCountP);
    });
    events.push({ type: 'type_passive', desc: `Aura divine : +${divinCountP} PV` });
  }

  // Passif Esprit des Forets : +1 DEF pour toutes les unites Terre alliees (buff temporaire)
  const espritCountP = getFieldAlive(battle.playerField).filter(u => u.name === 'Esprit des Forets').length;
  if (espritCountP > 0) {
    getFieldAlive(battle.playerField).filter(u => u.element === 'terre').forEach(u => {
      u.buffDef += espritCountP;
    });
    events.push({ type: 'type_passive', desc: `Esprit des Forets : +${espritCountP} DEF aux unites Terre` });
  }

  // Passif Eclaireur des Dunes : +2 DEF si seule sur le terrain
  const playerAliveUnits = getFieldAlive(battle.playerField);
  playerAliveUnits.filter(u => u.name === 'Eclaireur des Dunes').forEach(u => {
    if (playerAliveUnits.length === 1) {
      u.buffDef += 2;
      events.push({ type: 'type_passive', desc: `${u.name} est seule ! +2 DEF` });
    }
  });

  // Passif Phoenix Ancestral : 1 degat a tous les ennemis en debut de tour
  const phoenixCountP = getFieldAlive(battle.playerField).filter(u => u.name === 'Phoenix Ancestral').length;
  if (phoenixCountP > 0) {
    getFieldAlive(battle.enemyField).forEach(u => {
      u.currentHp = Math.max(0, u.currentHp - phoenixCountP);
      if (u.currentHp <= 0) checkKO(u, events, battle);
    });
    cleanDeadFromField(battle.enemyField);
    events.push({ type: 'type_passive', desc: `Phoenix Ancestral : ${phoenixCountP} degat(s) a tous les ennemis` });
  }

  // Passif Leviathan Abyssal : +1 ATK aux allies Eau en debut de tour
  const leviathanCountP = getFieldAlive(battle.playerField).filter(u => u.name === 'Leviathan Abyssal').length;
  if (leviathanCountP > 0) {
    getFieldAlive(battle.playerField).filter(u => u.element === 'eau').forEach(u => {
      u.buffAtk += leviathanCountP;
    });
    events.push({ type: 'type_passive', desc: `Leviathan Abyssal : +${leviathanCountP} ATK aux unites Eau` });
  }
  // Passif Pretresse Solaire : soigne 1 PV a l allie le plus blesse
  const pretresseCountPD = getFieldAlive(battle.playerField).filter(u => u.name === 'Pretresse Solaire').length;
  if (pretresseCountPD > 0) {
    for (let i = 0; i < pretresseCountPD; i++) {
      const wounded = getFieldAlive(battle.playerField).filter(u => u.currentHp < u.maxHp).sort((a, b) => a.currentHp - b.currentHp)[0];
      if (wounded) {
        wounded.currentHp = Math.min(wounded.maxHp, wounded.currentHp + 1);
        events.push({ type: 'type_passive', desc: `Pretresse Solaire soigne ${wounded.name} de 1 PV` });
      }
    }
  }

  // Check turn limit
  checkDeckWin(battle);

  res.json({ events, ...getDeckBattleSnapshot(battle) });
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
  const totalTempCards = db.prepare('SELECT COUNT(*) as c FROM user_cards WHERE is_temp = 1').get().c;
  const totalShinyCards = db.prepare('SELECT COUNT(*) as c FROM user_cards WHERE is_shiny = 1').get().c;
  res.json({ totalUsers, totalCards, totalCardTypes, totalBattles, totalPvpTeams, totalTempCards, totalShinyCards });
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
  const { userId, cardId, isShiny, isFused, isTemp } = req.body;
  if (!userId || !cardId) return res.status(400).json({ error: 'userId et cardId requis' });
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card) return res.status(404).json({ error: 'Carte introuvable' });
  db.prepare('INSERT INTO user_cards (user_id, card_id, is_shiny, is_fused, is_temp) VALUES (?, ?, ?, ?, ?)')
    .run(userId, cardId, isShiny ? 1 : 0, isFused ? 1 : 0, isTemp ? 1 : 0);
  res.json({ success: true, username: user.username, card: card.name });
});

// List all card templates
app.get('/api/admin/cards', requireAdmin, (req, res) => {
  const cards = db.prepare('SELECT * FROM cards ORDER BY id').all();
  res.json(cards);
});

// Create a new card template
app.post('/api/admin/create-card', requireAdmin, (req, res) => {
  const { name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, image, emoji, crystal_cost, passive_desc } = req.body;
  if (!name || !rarity || !type || !element) return res.status(400).json({ error: 'Champs obligatoires manquants' });

  const existing = db.prepare('SELECT id FROM cards WHERE name = ?').get(name);
  if (existing) return res.status(409).json({ error: 'Une carte avec ce nom existe deja' });

  const result = db.prepare(`
    INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, image, emoji, crystal_cost, passive_desc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, rarity, type, element, attack || 1, defense || 1, hp || 10, mana_cost || 1, ability_name || 'Aucun', ability_desc || '-', image || '', emoji || '', crystal_cost || 1, passive_desc || '');

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, card });
});

// Modify an existing card template
app.post('/api/admin/modify-card', requireAdmin, (req, res) => {
  const { cardId, name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, image, emoji, passive_desc, crystal_cost } = req.body;
  if (!cardId) return res.status(400).json({ error: 'cardId requis' });

  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card) return res.status(404).json({ error: 'Carte introuvable' });

  db.prepare(`
    UPDATE cards SET
      name = ?, rarity = ?, type = ?, element = ?,
      attack = ?, defense = ?, hp = ?, mana_cost = ?,
      ability_name = ?, ability_desc = ?, image = ?,
      emoji = ?, passive_desc = ?, crystal_cost = ?
    WHERE id = ?
  `).run(
    name || card.name, rarity || card.rarity, type || card.type, element || card.element,
    attack ?? card.attack, defense ?? card.defense, hp ?? card.hp, mana_cost ?? card.mana_cost,
    ability_name || card.ability_name, ability_desc || card.ability_desc, image ?? card.image,
    emoji ?? card.emoji, passive_desc ?? card.passive_desc, crystal_cost ?? card.crystal_cost,
    cardId
  );

  const updated = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  res.json({ success: true, card: updated });
});

// Get boosters config
app.get('/api/admin/boosters', requireAdmin, (req, res) => {
  res.json(BOOSTERS.map(b => ({
    id: b.id, name: b.name, price: b.price,
    cardsPerPack: b.cardsPerPack, weights: b.weights, shinyRate: b.shinyRate
  })));
});

// Update booster config
app.post('/api/admin/update-booster', requireAdmin, (req, res) => {
  const { boosterId, weights, shinyRate, price } = req.body;
  const booster = BOOSTERS.find(b => b.id === boosterId);
  if (!booster) return res.status(404).json({ error: 'Booster introuvable' });

  if (weights) {
    if (weights.commune !== undefined) booster.weights.commune = Number(weights.commune);
    if (weights.rare !== undefined) booster.weights.rare = Number(weights.rare);
    if (weights.epique !== undefined) booster.weights.epique = Number(weights.epique);
    if (weights.legendaire !== undefined) booster.weights.legendaire = Number(weights.legendaire);
    if (weights.chaos !== undefined) booster.weights.chaos = Number(weights.chaos);
  }
  if (shinyRate !== undefined) booster.shinyRate = Number(shinyRate);
  if (price !== undefined) booster.price = Number(price);

  res.json({ success: true, booster: { id: booster.id, name: booster.name, price: booster.price, weights: booster.weights, shinyRate: booster.shinyRate } });
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

  const resetTx = db.transaction(() => {
    // Supprimer deck_cards d'abord (reference user_cards et decks)
    const deckIds = db.prepare('SELECT id FROM decks WHERE user_id = ?').all(userId).map(d => d.id);
    for (const dId of deckIds) {
      db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(dId);
    }
    db.prepare('DELETE FROM decks WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_cards WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM campaign_progress WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM pvp_teams WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM battle_log WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM mine_state WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM mine_inventory WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM mine_upgrades WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM battle_pass WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_quests WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM user_achievements WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM friendships WHERE user_id = ? OR friend_id = ?').run(userId, userId);
    db.prepare('DELETE FROM chat_messages WHERE sender_id = ? OR receiver_id = ?').run(userId, userId);
    db.prepare('UPDATE users SET credits = 1000, excavation_essence = 0, unlocked_avatars = \'["⚔"]\', username_effect = \'\', avatar = \'⚔\', login_streak = 0, last_streak_date = \'\', stat_boosters_opened = 0, stat_pvp_wins = 0, stat_pvp_losses = 0, stat_diamonds_mined = 0, stat_fusions = 0, stat_fusion_success = 0, stat_fusion_fail = 0, stat_casino_spins = 0, stat_casino_won = 0, stat_credits_spent = 0, stat_total_earned = 0, stat_boosters_origines = 0, stat_boosters_rift = 0, stat_boosters_avance = 0 WHERE id = ?').run(userId);
  });
  resetTx();
  res.json({ success: true, username: user.username });
});

// Set user credits to exact amount
app.post('/api/admin/set-credits', requireAdmin, (req, res) => {
  const { userId, credits } = req.body;
  if (!userId || credits === undefined) return res.status(400).json({ error: 'userId et credits requis' });
  db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(credits, userId);
  res.json({ success: true });
});

// ============================================
// GIFT CODES ROUTES
// ============================================

// Admin: list all gift codes
app.get('/api/admin/gift-codes', requireAdmin, (req, res) => {
  const codes = db.prepare(`
    SELECT gc.*, c.name as card_name, c.rarity as card_rarity, c.emoji as card_emoji
    FROM gift_codes gc
    LEFT JOIN cards c ON gc.card_id = c.id
    ORDER BY gc.created_at DESC
  `).all();
  res.json(codes);
});

// Admin: create gift code
app.post('/api/admin/create-gift-code', requireAdmin, (req, res) => {
  const { code, credits, cardId, cardQuantity, isShiny, maxUses } = req.body;
  if (!code || code.trim().length < 3) return res.status(400).json({ error: 'Code trop court (min 3 caracteres)' });

  const existing = db.prepare('SELECT id FROM gift_codes WHERE UPPER(code) = UPPER(?)').get(code.trim());
  if (existing) return res.status(400).json({ error: 'Ce code existe deja' });

  if (cardId) {
    const card = db.prepare('SELECT id FROM cards WHERE id = ?').get(cardId);
    if (!card) return res.status(400).json({ error: 'Carte introuvable' });
  }

  db.prepare(`INSERT INTO gift_codes (code, credits, card_id, card_quantity, is_shiny, max_uses) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(code.trim().toUpperCase(), credits || 0, cardId || null, cardQuantity || 1, isShiny ? 1 : 0, maxUses || 1);

  res.json({ success: true });
});

// Admin: delete gift code
app.post('/api/admin/delete-gift-code', requireAdmin, (req, res) => {
  const { codeId } = req.body;
  if (!codeId) return res.status(400).json({ error: 'codeId requis' });
  db.prepare('DELETE FROM gift_code_uses WHERE code_id = ?').run(codeId);
  db.prepare('DELETE FROM gift_codes WHERE id = ?').run(codeId);
  res.json({ success: true });
});

// Player: redeem a gift code
app.post('/api/redeem-code', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { code } = req.body;
  if (!code || !code.trim()) return res.status(400).json({ error: 'Code vide' });

  const gc = db.prepare('SELECT * FROM gift_codes WHERE UPPER(code) = UPPER(?) AND is_active = 1').get(code.trim());
  if (!gc) return res.json({ success: false, error: 'Code invalide ou expire' });

  if (gc.used_count >= gc.max_uses) return res.json({ success: false, error: 'Code deja utilise au maximum' });

  const alreadyUsed = db.prepare('SELECT id FROM gift_code_uses WHERE code_id = ? AND user_id = ?').get(gc.id, userId);
  if (alreadyUsed) return res.json({ success: false, error: 'Tu as deja utilise ce code !' });

  const rewards = { credits: gc.credits, cards: [] };

  const redeemTx = db.transaction(() => {
    // Donner credits
    if (gc.credits > 0) {
      db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(gc.credits, userId);
    }
    // Donner cartes
    if (gc.card_id) {
      for (let i = 0; i < gc.card_quantity; i++) {
        db.prepare('INSERT INTO user_cards (user_id, card_id, is_shiny) VALUES (?, ?, ?)').run(userId, gc.card_id, gc.is_shiny);
      }
      const cardInfo = db.prepare('SELECT name, rarity, emoji FROM cards WHERE id = ?').get(gc.card_id);
      if (cardInfo) rewards.cards.push({ ...cardInfo, quantity: gc.card_quantity, isShiny: gc.is_shiny });
    }
    // Log usage
    db.prepare('INSERT INTO gift_code_uses (code_id, user_id) VALUES (?, ?)').run(gc.id, userId);
    db.prepare('UPDATE gift_codes SET used_count = used_count + 1 WHERE id = ?').run(gc.id);
  });
  redeemTx();

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  res.json({ success: true, rewards, credits: newCredits });
});

// ============================================
// DECK ROUTES
// ============================================

// Starter deck — cartes faibles pour tester sans collection
const STARTER_DECK = [
  // 4x Goblin (1 mana, terre)
  { name:'Goblin',emoji:'🗡️',rarity:'commune',type:'creature',element:'terre',attack:2,defense:1,hp:3,mana_cost:1,ability_name:'Appel gobelin',ability_desc:'Invoque un Goblin 1/1/2',crystal_cost:1 },
  { name:'Goblin',emoji:'🗡️',rarity:'commune',type:'creature',element:'terre',attack:2,defense:1,hp:3,mana_cost:1,ability_name:'Appel gobelin',ability_desc:'Invoque un Goblin 1/1/2',crystal_cost:1 },
  { name:'Goblin',emoji:'🗡️',rarity:'commune',type:'creature',element:'terre',attack:2,defense:1,hp:3,mana_cost:1,ability_name:'Appel gobelin',ability_desc:'Invoque un Goblin 1/1/2',crystal_cost:1 },
  { name:'Goblin',emoji:'🗡️',rarity:'commune',type:'creature',element:'terre',attack:2,defense:1,hp:3,mana_cost:1,ability_name:'Appel gobelin',ability_desc:'Invoque un Goblin 1/1/2',crystal_cost:1 },
  // 3x Tortue des Rivieres (4 mana, eau)
  { name:'Tortue des Rivieres',emoji:'🐢',rarity:'commune',type:'creature',element:'eau',attack:1,defense:4,hp:5,mana_cost:4,ability_name:'Carapace marine',ability_desc:'+2 DEF a un allie jusqu au prochain tour',crystal_cost:1 },
  { name:'Tortue des Rivieres',emoji:'🐢',rarity:'commune',type:'creature',element:'eau',attack:1,defense:4,hp:5,mana_cost:4,ability_name:'Carapace marine',ability_desc:'+2 DEF a un allie jusqu au prochain tour',crystal_cost:1 },
  { name:'Tortue des Rivieres',emoji:'🐢',rarity:'commune',type:'creature',element:'eau',attack:1,defense:4,hp:5,mana_cost:4,ability_name:'Carapace marine',ability_desc:'+2 DEF a un allie jusqu au prochain tour',crystal_cost:1 },
  // 3x Serpent des Marees (2 mana, eau)
  { name:'Serpent des Marees',emoji:'🐍',rarity:'rare',type:'creature',element:'eau',attack:2,defense:1,hp:3,mana_cost:2,ability_name:'Frappe empoisonnee',ability_desc:'Empoisonne : 1 degat/tour 4 tours',crystal_cost:1 },
  { name:'Serpent des Marees',emoji:'🐍',rarity:'rare',type:'creature',element:'eau',attack:2,defense:1,hp:3,mana_cost:2,ability_name:'Frappe empoisonnee',ability_desc:'Empoisonne : 1 degat/tour 4 tours',crystal_cost:1 },
  { name:'Serpent des Marees',emoji:'🐍',rarity:'rare',type:'creature',element:'eau',attack:2,defense:1,hp:3,mana_cost:2,ability_name:'Frappe empoisonnee',ability_desc:'Empoisonne : 1 degat/tour 4 tours',crystal_cost:1 },
  // 3x Mage de Foudre (3 mana, eau)
  { name:'Mage de Foudre',emoji:'🌊',rarity:'rare',type:'creature',element:'eau',attack:3,defense:1,hp:3,mana_cost:3,ability_name:'Eclair',ability_desc:'2 degats (ignore DEF)',crystal_cost:1 },
  { name:'Mage de Foudre',emoji:'🌊',rarity:'rare',type:'creature',element:'eau',attack:3,defense:1,hp:3,mana_cost:3,ability_name:'Eclair',ability_desc:'2 degats (ignore DEF)',crystal_cost:1 },
  { name:'Mage de Foudre',emoji:'🌊',rarity:'rare',type:'creature',element:'eau',attack:3,defense:1,hp:3,mana_cost:3,ability_name:'Eclair',ability_desc:'2 degats (ignore DEF)',crystal_cost:1 },
  // 2x Salamandre Ardente (3 mana, feu)
  { name:'Salamandre Ardente',emoji:'🦎',rarity:'rare',type:'creature',element:'feu',attack:3,defense:1,hp:3,mana_cost:3,ability_name:'Flamme adjacente',ability_desc:'1 degat cible + adjacents',crystal_cost:1 },
  { name:'Salamandre Ardente',emoji:'🦎',rarity:'rare',type:'creature',element:'feu',attack:3,defense:1,hp:3,mana_cost:3,ability_name:'Flamme adjacente',ability_desc:'1 degat cible + adjacents',crystal_cost:1 },
  // 2x Esprit des Forets (3 mana, terre)
  { name:'Esprit des Forets',emoji:'🌿',rarity:'rare',type:'creature',element:'terre',attack:1,defense:3,hp:4,mana_cost:3,ability_name:'Croissance',ability_desc:'+1 DEF equipe',crystal_cost:1.5 },
  { name:'Esprit des Forets',emoji:'🌿',rarity:'rare',type:'creature',element:'terre',attack:1,defense:3,hp:4,mana_cost:3,ability_name:'Croissance',ability_desc:'+1 DEF equipe',crystal_cost:1.5 },
  // 2x Dragonnet de Braise (4 mana, feu)
  { name:'Dragonnet de Braise',emoji:'🐉',rarity:'epique',type:'creature',element:'feu',attack:3,defense:2,hp:4,mana_cost:4,ability_name:'Souffle de braise',ability_desc:'1 degat a tous les ennemis',crystal_cost:1.5 },
  { name:'Dragonnet de Braise',emoji:'🐉',rarity:'epique',type:'creature',element:'feu',attack:3,defense:2,hp:4,mana_cost:4,ability_name:'Souffle de braise',ability_desc:'1 degat a tous les ennemis',crystal_cost:1.5 },
  // 1x Golem de Roche (5 mana, terre)
  { name:'Golem de Roche',emoji:'🪨',rarity:'epique',type:'creature',element:'terre',attack:2,defense:5,hp:7,mana_cost:5,ability_name:'Fortification',ability_desc:'+3 DEF ce tour',crystal_cost:1 },
];

// GET /api/decks — Liste des decks du joueur
app.get('/api/decks', requireAuth, (req, res) => {
  const decks = db.prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY created_at').all(req.session.userId);
  const result = decks.map(deck => {
    const cards = db.prepare(`
      SELECT dc.position, dc.user_card_id, uc.is_shiny, uc.is_fused, c.*
      FROM deck_cards dc
      JOIN user_cards uc ON dc.user_card_id = uc.id
      JOIN cards c ON uc.card_id = c.id
      WHERE dc.deck_id = ?
      ORDER BY dc.position
    `).all(deck.id);
    return { ...deck, cards };
  });
  res.json(result);
});

// POST /api/decks — Creer un deck
app.post('/api/decks', requireAuth, (req, res) => {
  const { name, cardIds } = req.body;
  if (!cardIds || cardIds.length !== 20) return res.status(400).json({ error: '20 cartes requises' });

  // Max 3 decks
  const count = db.prepare('SELECT COUNT(*) as c FROM decks WHERE user_id = ?').get(req.session.userId).c;
  if (count >= 3) return res.status(400).json({ error: 'Maximum 3 decks' });

  // Check uniqueness
  if (new Set(cardIds).size !== 20) return res.status(400).json({ error: 'Pas de doublons' });

  // Validate ownership + count creatures/objets
  let objCount = 0;
  for (const ucId of cardIds) {
    const uc = db.prepare(`
      SELECT uc.id, c.type FROM user_cards uc JOIN cards c ON uc.card_id = c.id
      WHERE uc.id = ? AND uc.user_id = ?
    `).get(ucId, req.session.userId);
    if (!uc) return res.status(400).json({ error: `Carte ${ucId} introuvable` });
    if (uc.type === 'objet') objCount++;
  }
  if (objCount > 8) return res.status(400).json({ error: 'Maximum 8 objets par deck' });
  if ((20 - objCount) < 12) return res.status(400).json({ error: 'Minimum 12 creatures par deck' });

  const deckName = name || `Deck ${count + 1}`;
  const result = db.prepare('INSERT INTO decks (user_id, name) VALUES (?, ?)').run(req.session.userId, deckName);
  const deckId = result.lastInsertRowid;

  const insertCard = db.prepare('INSERT INTO deck_cards (deck_id, user_card_id, position) VALUES (?, ?, ?)');
  const addCards = db.transaction(() => {
    cardIds.forEach((ucId, i) => insertCard.run(deckId, ucId, i));
  });
  addCards();

  res.json({ success: true, deckId });
});

// PUT /api/decks/:id — Modifier un deck
app.put('/api/decks/:id', requireAuth, (req, res) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!deck) return res.status(404).json({ error: 'Deck introuvable' });

  const { name, cardIds } = req.body;
  if (name) db.prepare('UPDATE decks SET name = ? WHERE id = ?').run(name, deck.id);

  if (cardIds) {
    if (cardIds.length !== 20) return res.status(400).json({ error: '20 cartes requises' });
    if (new Set(cardIds).size !== 20) return res.status(400).json({ error: 'Pas de doublons' });

    let objCount = 0;
    for (const ucId of cardIds) {
      const uc = db.prepare(`
        SELECT uc.id, c.type FROM user_cards uc JOIN cards c ON uc.card_id = c.id
        WHERE uc.id = ? AND uc.user_id = ?
      `).get(ucId, req.session.userId);
      if (!uc) return res.status(400).json({ error: `Carte ${ucId} introuvable` });
      if (uc.type === 'objet') objCount++;
    }
    if (objCount > 8) return res.status(400).json({ error: 'Maximum 8 objets par deck' });

    db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deck.id);
    const insertCard = db.prepare('INSERT INTO deck_cards (deck_id, user_card_id, position) VALUES (?, ?, ?)');
    const addCards = db.transaction(() => {
      cardIds.forEach((ucId, i) => insertCard.run(deck.id, ucId, i));
    });
    addCards();
  }

  res.json({ success: true });
});

// DELETE /api/decks/:id — Supprimer un deck
app.delete('/api/decks/:id', requireAuth, (req, res) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!deck) return res.status(404).json({ error: 'Deck introuvable' });

  db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deck.id);
  db.prepare('DELETE FROM decks WHERE id = ?').run(deck.id);
  res.json({ success: true });
});

// POST /api/decks/:id/set-pvp — Definir comme deck PvP actif
app.post('/api/decks/:id/set-pvp', requireAuth, (req, res) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!deck) return res.status(404).json({ error: 'Deck introuvable' });

  db.prepare('UPDATE decks SET is_pvp_deck = 0 WHERE user_id = ?').run(req.session.userId);
  db.prepare('UPDATE decks SET is_pvp_deck = 1 WHERE id = ?').run(deck.id);
  res.json({ success: true });
});

// --- User cards list (for team selection) ---
app.get('/api/my-cards', requireAuth, (req, res) => {
  const cards = db.prepare(`
    SELECT uc.id as user_card_id, uc.is_shiny, uc.is_fused, uc.is_temp, c.*
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ?
    ORDER BY
      CASE c.rarity WHEN 'secret' THEN -1 WHEN 'chaos' THEN 0 WHEN 'legendaire' THEN 1 WHEN 'epique' THEN 2 WHEN 'rare' THEN 3 WHEN 'commune' THEN 4 END,
      uc.is_fused DESC, uc.is_shiny DESC, c.attack DESC
  `).all(req.session.userId);
  res.json(cards);
});

// --- Pages ---
// ============================================
// MINE API ENDPOINTS
// ============================================

// GET mine state (or create new mine)
app.get('/api/mine/state', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const upgrades = getMineUpgrades(userId);
  const maxSlots = BASE_INVENTORY_SLOTS + upgrades.inventory_size;

  let mine = db.prepare('SELECT * FROM mine_state WHERE user_id = ?').get(userId);
  if (!mine) {
    const { grid, counts } = generateMineGrid(upgrades.luck);
    db.prepare('INSERT INTO mine_state (user_id, grid, hidden_charbon, hidden_fer, hidden_or, hidden_diamant) VALUES (?, ?, ?, ?, ?, ?)')
      .run(userId, JSON.stringify(grid), counts.charbon, counts.fer, counts.or, counts.diamant);
    mine = db.prepare('SELECT * FROM mine_state WHERE user_id = ?').get(userId);
  }

  const grid = JSON.parse(mine.grid);
  // Hide resources of unmined blocks
  const clientGrid = grid.map(b => ({
    resistance: b.resistance,
    hits: b.hits,
    mined: b.mined,
    collected: b.collected,
    resource: b.mined ? b.resource : null
  }));

  const inventory = getMineInventory(userId);
  const user = db.prepare('SELECT credits, excavation_essence FROM users WHERE id = ?').get(userId);

  // Cooldown restock (4 minutes)
  let cooldownRemaining = 0;
  if (mine.last_sell_at) {
    const sellTime = new Date(mine.last_sell_at + 'Z').getTime();
    const elapsed = Date.now() - sellTime;
    const cooldownMs = 4 * 60 * 1000; // 4 minutes
    if (elapsed < cooldownMs) {
      cooldownRemaining = Math.ceil((cooldownMs - elapsed) / 1000);
    }
  }

  res.json({
    grid: clientGrid,
    hiddenResources: {
      charbon: mine.hidden_charbon,
      fer: mine.hidden_fer,
      or: mine.hidden_or,
      diamant: mine.hidden_diamant
    },
    inventory,
    maxSlots,
    upgrades: { mine_speed: upgrades.mine_speed, inventory_size: upgrades.inventory_size, luck: upgrades.luck },
    essence: user.excavation_essence || 0,
    credits: user.credits,
    cooldownRemaining
  });
});

// POST hit a block
app.post('/api/mine/hit', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { index } = req.body;

  // Check cooldown
  const mineCheck = db.prepare('SELECT last_sell_at FROM mine_state WHERE user_id = ?').get(userId);
  if (mineCheck && mineCheck.last_sell_at) {
    const elapsed = Date.now() - new Date(mineCheck.last_sell_at + 'Z').getTime();
    if (elapsed < 4 * 60 * 1000) {
      return res.json({ success: false, cooldown: true });
    }
  }

  if (index === undefined || index < 0 || index >= MINE_GRID_SIZE * MINE_GRID_SIZE) {
    return res.status(400).json({ error: 'Index invalide' });
  }

  const mine = db.prepare('SELECT * FROM mine_state WHERE user_id = ?').get(userId);
  if (!mine) return res.status(400).json({ error: 'Aucune mine active' });

  const grid = JSON.parse(mine.grid);
  const block = grid[index];

  if (block.mined) {
    return res.json({ success: false, error: 'Bloc deja mine', block: { ...block, resource: block.resource } });
  }

  const upgrades = getMineUpgrades(userId);
  const speedReduction = upgrades.mine_speed;
  const adjustedResistance = Math.max(1, block.resistance - speedReduction);

  block.hits++;

  let inventoryItem = null;
  let inventoryFull = false;

  if (block.hits >= adjustedResistance) {
    block.mined = true;

    // Auto-collect if inventory not full
    const inventory = getMineInventory(userId);
    const maxSlots = BASE_INVENTORY_SLOTS + upgrades.inventory_size;

    if (inventory.length < maxSlots) {
      const nextSlot = inventory.length;
      db.prepare('INSERT INTO mine_inventory (user_id, resource, slot_index) VALUES (?, ?, ?)').run(userId, block.resource, nextSlot);
      block.collected = true;
      inventoryItem = { slot: nextSlot, resource: block.resource };

      // Update hidden count
      const col = 'hidden_' + block.resource;
      db.prepare(`UPDATE mine_state SET ${col} = ${col} - 1 WHERE user_id = ?`).run(userId);

      // Track diamond mining for quests/achievements
      if (block.resource === 'diamant') {
        db.prepare('UPDATE users SET stat_diamonds_mined = stat_diamonds_mined + 1 WHERE id = ?').run(userId);
        updateQuestProgress(userId, 'diamond_mine', 1);
        checkAchievements(userId);
      }
    } else {
      inventoryFull = true;
    }
  }

  // Save grid
  db.prepare('UPDATE mine_state SET grid = ? WHERE user_id = ?').run(JSON.stringify(grid), userId);

  const crackLevel = Math.min(4, Math.floor((block.hits / adjustedResistance) * 4));

  res.json({
    success: true,
    block: {
      hits: block.hits,
      resistance: block.resistance,
      adjustedResistance,
      crackLevel,
      mined: block.mined,
      collected: block.collected,
      resource: block.mined ? block.resource : null
    },
    inventoryItem,
    inventoryFull
  });
});

// POST collect uncollected mined resource
app.post('/api/mine/collect', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { index } = req.body;

  const mine = db.prepare('SELECT * FROM mine_state WHERE user_id = ?').get(userId);
  if (!mine) return res.status(400).json({ error: 'Aucune mine active' });

  const grid = JSON.parse(mine.grid);
  const block = grid[index];

  if (!block || !block.mined || block.collected) {
    return res.status(400).json({ error: 'Bloc non collectible' });
  }

  const inventory = getMineInventory(userId);
  const maxSlots = getMaxSlots(userId);

  if (inventory.length >= maxSlots) {
    return res.json({ success: false, inventoryFull: true });
  }

  const nextSlot = inventory.length;
  db.prepare('INSERT INTO mine_inventory (user_id, resource, slot_index) VALUES (?, ?, ?)').run(userId, block.resource, nextSlot);
  block.collected = true;

  const col = 'hidden_' + block.resource;
  db.prepare(`UPDATE mine_state SET grid = ?, ${col} = ${col} - 1 WHERE user_id = ?`).run(JSON.stringify(grid), userId);

  res.json({ success: true, inventoryItem: { slot: nextSlot, resource: block.resource } });
});

// POST sell one resource
app.post('/api/mine/sell', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { slot } = req.body;

  const item = db.prepare('SELECT * FROM mine_inventory WHERE user_id = ? AND slot_index = ?').get(userId, slot);
  if (!item) return res.status(400).json({ error: 'Emplacement vide' });

  const price = MINE_RESOURCES[item.resource]?.price || 0;

  const sellTx = db.transaction(() => {
    db.prepare('DELETE FROM mine_inventory WHERE user_id = ? AND slot_index = ?').run(userId, slot);
    // Reindex remaining slots
    const remaining = db.prepare('SELECT * FROM mine_inventory WHERE user_id = ? ORDER BY slot_index').all(userId);
    db.prepare('DELETE FROM mine_inventory WHERE user_id = ?').run(userId);
    remaining.forEach((r, i) => {
      db.prepare('INSERT INTO mine_inventory (user_id, resource, slot_index) VALUES (?, ?, ?)').run(userId, r.resource, i);
    });
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(price, userId);
  });
  sellTx();

  const credits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  const inventory = getMineInventory(userId);

  res.json({ success: true, credits, soldPrice: price, soldResource: item.resource, inventory });
});

// POST sell all resources
app.post('/api/mine/sell-all', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const items = getMineInventory(userId);

  if (!items.length) return res.json({ success: false, error: 'Inventaire vide' });

  let totalPrice = 0;
  items.forEach(item => { totalPrice += MINE_RESOURCES[item.resource]?.price || 0; });

  // Vend tout + auto-reset la mine
  const upgrades = getMineUpgrades(userId);
  const { grid, counts } = generateMineGrid(upgrades.luck);

  const sellAllTx = db.transaction(() => {
    db.prepare('DELETE FROM mine_inventory WHERE user_id = ?').run(userId);
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(totalPrice, userId);
    db.prepare('UPDATE mine_state SET grid = ?, hidden_charbon = ?, hidden_fer = ?, hidden_or = ?, hidden_diamant = ?, created_at = CURRENT_TIMESTAMP, last_sell_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(JSON.stringify(grid), counts.charbon, counts.fer, counts.or, counts.diamant, userId);
  });
  sellAllTx();
  addBattlePassXP(userId, BP_XP.mine_sell);
  updateQuestProgress(userId, 'credits_earned', totalPrice);
  checkAchievements(userId);

  const credits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;

  const clientGrid = grid.map(b => ({
    resistance: b.resistance,
    hits: b.hits,
    mined: b.mined,
    collected: b.collected,
    resource: null
  }));

  res.json({ success: true, credits, totalSold: totalPrice, itemsSold: items.length, grid: clientGrid, hiddenResources: counts, cooldownSeconds: 240 });
});

// POST reset mine
app.post('/api/mine/reset', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const items = getMineInventory(userId);

  if (items.length > 0) {
    return res.status(400).json({ error: 'Videz votre inventaire avant de reset la mine' });
  }

  const upgrades = getMineUpgrades(userId);
  const { grid, counts } = generateMineGrid(upgrades.luck);

  db.prepare('UPDATE mine_state SET grid = ?, hidden_charbon = ?, hidden_fer = ?, hidden_or = ?, hidden_diamant = ?, created_at = CURRENT_TIMESTAMP WHERE user_id = ?')
    .run(JSON.stringify(grid), counts.charbon, counts.fer, counts.or, counts.diamant, userId);

  const clientGrid = grid.map(b => ({
    resistance: b.resistance,
    hits: b.hits,
    mined: b.mined,
    collected: b.collected,
    resource: null
  }));

  res.json({ success: true, grid: clientGrid, hiddenResources: counts });
});

// GET upgrades
app.get('/api/mine/upgrades', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const upgrades = getMineUpgrades(userId);
  const user = db.prepare('SELECT excavation_essence FROM users WHERE id = ?').get(userId);

  const available = {};
  for (const [key, config] of Object.entries(MINE_UPGRADES_CONFIG)) {
    const currentLevel = upgrades[key] || 0;
    available[key] = {
      ...config,
      level: currentLevel,
      nextCost: currentLevel < config.maxLevel ? config.costs[currentLevel] : null,
      maxed: currentLevel >= config.maxLevel
    };
  }

  res.json({ upgrades: available, essence: user.excavation_essence || 0 });
});

// POST buy upgrade
app.post('/api/mine/upgrade', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { type } = req.body;

  const config = MINE_UPGRADES_CONFIG[type];
  if (!config) return res.status(400).json({ error: 'Amelioration invalide' });

  const upgrades = getMineUpgrades(userId);
  const currentLevel = upgrades[type] || 0;

  if (currentLevel >= config.maxLevel) return res.status(400).json({ error: 'Niveau maximum atteint' });

  const cost = config.costs[currentLevel];
  const user = db.prepare('SELECT excavation_essence FROM users WHERE id = ?').get(userId);

  if ((user.excavation_essence || 0) < cost) {
    return res.status(400).json({ error: 'Pas assez d\'essence' });
  }

  const upgradeTx = db.transaction(() => {
    db.prepare('UPDATE users SET excavation_essence = excavation_essence - ? WHERE id = ?').run(cost, userId);
    db.prepare(`UPDATE mine_upgrades SET ${type} = ${type} + 1 WHERE user_id = ?`).run(userId);
  });
  upgradeTx();

  const newEssence = db.prepare('SELECT excavation_essence FROM users WHERE id = ?').get(userId).excavation_essence;
  const newUpgrades = getMineUpgrades(userId);

  res.json({ success: true, essence: newEssence, upgrades: newUpgrades });
});

// ============================================
// BATTLE PASS ROUTES
// ============================================
app.get('/api/battlepass', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const bp = getBattlePass(userId);
  const claimedTiers = JSON.parse(bp.claimed_tiers || '[]');

  let cumXP = 0;
  let currentTierXP = bp.xp;
  let currentTierRequired = BATTLEPASS_TIERS[0].xp_required;
  for (let i = 0; i < BATTLEPASS_TIERS.length; i++) {
    if (bp.xp >= cumXP + BATTLEPASS_TIERS[i].xp_required) {
      cumXP += BATTLEPASS_TIERS[i].xp_required;
    } else {
      currentTierXP = bp.xp - cumXP;
      currentTierRequired = BATTLEPASS_TIERS[i].xp_required;
      break;
    }
  }
  if (bp.current_tier >= 30) { currentTierXP = currentTierRequired; }

  res.json({
    xp: bp.xp,
    currentTier: bp.current_tier,
    claimedTiers,
    currentTierXP,
    currentTierRequired,
    tiers: BATTLEPASS_TIERS,
    effects: USERNAME_EFFECTS
  });
});

app.post('/api/battlepass/claim', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { tier } = req.body;

  if (!tier || tier < 1 || tier > 30) return res.status(400).json({ error: 'Palier invalide' });

  const bp = getBattlePass(userId);
  if (bp.current_tier < tier) return res.status(400).json({ error: 'Palier non atteint' });

  const claimedTiers = JSON.parse(bp.claimed_tiers || '[]');
  if (claimedTiers.includes(tier)) return res.status(400).json({ error: 'Deja reclame' });

  const tierData = BATTLEPASS_TIERS.find(t => t.tier === tier);
  if (!tierData) return res.status(400).json({ error: 'Palier introuvable' });

  let cardGiven = null;

  const claimTx = db.transaction(() => {
    switch (tierData.reward_type) {
      case 'credits':
        db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(tierData.reward_value, userId);
        break;
      case 'essence':
        db.prepare('UPDATE users SET excavation_essence = excavation_essence + ? WHERE id = ?').run(tierData.reward_value, userId);
        break;
      case 'avatar': {
        const u = db.prepare('SELECT unlocked_avatars FROM users WHERE id = ?').get(userId);
        const unlocked = JSON.parse(u.unlocked_avatars || '["⚔"]');
        if (!unlocked.includes(tierData.reward_value)) {
          unlocked.push(tierData.reward_value);
          db.prepare('UPDATE users SET unlocked_avatars = ? WHERE id = ?').run(JSON.stringify(unlocked), userId);
        }
        break;
      }
      case 'effect':
        // Auto-equip l'effet
        db.prepare('UPDATE users SET username_effect = ? WHERE id = ?').run(tierData.reward_value, userId);
        break;
      case 'card': {
        const rarity = tierData.reward_value;
        const pool = db.prepare('SELECT id, name, emoji, rarity FROM cards WHERE rarity = ?').all(rarity);
        if (pool.length > 0) {
          const picked = pool[Math.floor(Math.random() * pool.length)];
          db.prepare('INSERT INTO user_cards (user_id, card_id, is_shiny) VALUES (?, ?, 0)').run(userId, picked.id);
          cardGiven = picked;
        }
        break;
      }
      case 'multi': {
        const val = tierData.reward_value;
        if (val.avatar) {
          const u = db.prepare('SELECT unlocked_avatars FROM users WHERE id = ?').get(userId);
          const unlocked = JSON.parse(u.unlocked_avatars || '["⚔"]');
          if (!unlocked.includes(val.avatar)) {
            unlocked.push(val.avatar);
            db.prepare('UPDATE users SET unlocked_avatars = ? WHERE id = ?').run(JSON.stringify(unlocked), userId);
          }
        }
        if (val.effect) {
          db.prepare('UPDATE users SET username_effect = ? WHERE id = ?').run(val.effect, userId);
        }
        break;
      }
    }
    claimedTiers.push(tier);
    db.prepare('UPDATE battle_pass SET claimed_tiers = ? WHERE user_id = ?').run(JSON.stringify(claimedTiers), userId);
  });
  claimTx();

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  res.json({ success: true, tier, reward: { type: tierData.reward_type, label: tierData.label, emoji: tierData.emoji }, cardGiven, credits: newCredits });
});

app.post('/api/battlepass/set-effect', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { effect } = req.body;

  if (!effect || effect === '') {
    db.prepare('UPDATE users SET username_effect = "" WHERE id = ?').run(userId);
    return res.json({ success: true, activeEffect: '' });
  }

  // Verifier que l'effet est deverrouille
  const bp = getBattlePass(userId);
  const claimed = JSON.parse(bp.claimed_tiers || '[]');
  let isUnlocked = false;
  for (const t of BATTLEPASS_TIERS) {
    if (!claimed.includes(t.tier)) continue;
    if (t.reward_type === 'effect' && t.reward_value === effect) { isUnlocked = true; break; }
    if (t.reward_type === 'multi' && t.reward_value.effect === effect) { isUnlocked = true; break; }
  }
  if (!isUnlocked) return res.status(400).json({ error: 'Effet non deverrouille' });

  db.prepare('UPDATE users SET username_effect = ? WHERE id = ?').run(effect, userId);
  res.json({ success: true, activeEffect: effect });
});

// ============================================
// QUETES ROUTES
// ============================================

app.get('/api/quests', requireAuth, (req, res) => {
  const userId = req.session.userId;
  assignQuests(userId);

  const today = new Date().toISOString().split('T')[0];
  const week = getISOWeek(new Date());

  const daily = db.prepare('SELECT * FROM user_quests WHERE user_id = ? AND type = ? AND assigned_date = ? ORDER BY id').all(userId, 'daily', today);
  const weekly = db.prepare('SELECT * FROM user_quests WHERE user_id = ? AND type = ? AND assigned_date = ? ORDER BY id').all(userId, 'weekly', week);

  // Attach labels from QUEST_POOL
  const addLabel = (q) => {
    const allDefs = [...QUEST_POOL.daily, ...QUEST_POOL.weekly];
    const def = allDefs.find(d => d.key === q.quest_key);
    return {
      ...q,
      label: def ? def.label.replace('{goal}', q.goal) : q.quest_key,
      canClaim: q.progress >= q.goal && !q.claimed
    };
  };

  res.json({
    daily: daily.map(addLabel),
    weekly: weekly.map(addLabel)
  });
});

app.post('/api/quests/claim', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { questId } = req.body;
  if (!questId) return res.status(400).json({ error: 'questId requis' });

  const quest = db.prepare('SELECT * FROM user_quests WHERE id = ? AND user_id = ?').get(questId, userId);
  if (!quest) return res.status(404).json({ error: 'Quete introuvable' });
  if (quest.claimed) return res.status(400).json({ error: 'Deja reclamee' });
  if (quest.progress < quest.goal) return res.status(400).json({ error: 'Quete pas terminee' });

  db.prepare('UPDATE user_quests SET claimed = 1 WHERE id = ?').run(questId);
  db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(quest.reward_credits, userId);
  addBattlePassXP(userId, quest.reward_xp);

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  checkAchievements(userId);

  res.json({ success: true, credits: newCredits, xpGained: quest.reward_xp, creditsGained: quest.reward_credits });
});

// ============================================
// ACHIEVEMENTS ROUTES
// ============================================

app.get('/api/achievements', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const stats = getAchievementStats(userId);
  const unlocked = db.prepare('SELECT * FROM user_achievements WHERE user_id = ?').all(userId);
  const unlockedMap = {};
  for (const u of unlocked) {
    unlockedMap[u.achievement_key] = u;
  }

  const result = ACHIEVEMENTS.map(ach => ({
    key: ach.key,
    label: ach.label,
    desc: ach.desc,
    icon: ach.icon,
    credits: ach.credits,
    unlocked: !!unlockedMap[ach.key],
    claimed: unlockedMap[ach.key]?.claimed === 1,
    canClaim: !!unlockedMap[ach.key] && unlockedMap[ach.key].claimed === 0
  }));

  res.json({ achievements: result, stats });
});

app.post('/api/achievements/claim', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { achievementKey } = req.body;
  if (!achievementKey) return res.status(400).json({ error: 'achievementKey requis' });

  const ach = db.prepare('SELECT * FROM user_achievements WHERE user_id = ? AND achievement_key = ?').get(userId, achievementKey);
  if (!ach) return res.status(404).json({ error: 'Succes non debloque' });
  if (ach.claimed) return res.status(400).json({ error: 'Deja reclame' });

  const achDef = ACHIEVEMENTS.find(a => a.key === achievementKey);
  if (!achDef) return res.status(404).json({ error: 'Succes inconnu' });

  db.prepare('UPDATE user_achievements SET claimed = 1 WHERE id = ?').run(ach.id);
  db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(achDef.credits, userId);

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  res.json({ success: true, credits: newCredits, creditsGained: achDef.credits });
});

// ============================================
// CASINO ROUTES
// ============================================

app.get('/api/casino/info', requireAuth, (req, res) => {
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.session.userId);
  res.json({
    segments: CASINO_SEGMENTS.map(s => ({ label: s.label, color: s.color })),
    cost: CASINO_COST,
    credits: user.credits
  });
});

app.post('/api/casino/spin', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  if (user.credits < CASINO_COST) return res.status(400).json({ error: 'Pas assez de credits (200 CR)' });

  // Deduct cost
  db.prepare('UPDATE users SET credits = credits - ?, stat_credits_spent = stat_credits_spent + ?, stat_casino_spins = stat_casino_spins + 1 WHERE id = ?')
    .run(CASINO_COST, CASINO_COST, userId);

  // Weighted random selection
  const totalWeight = CASINO_SEGMENTS.reduce((a, s) => a + s.weight, 0);
  let roll = Math.random() * totalWeight;
  let selectedIdx = 0;
  for (let i = 0; i < CASINO_SEGMENTS.length; i++) {
    roll -= CASINO_SEGMENTS[i].weight;
    if (roll <= 0) { selectedIdx = i; break; }
  }

  const segment = CASINO_SEGMENTS[selectedIdx];
  let rewardInfo = { label: segment.label, type: segment.reward.type };
  let cardGiven = null;

  if (segment.reward.type === 'credits' && segment.reward.amount > 0) {
    db.prepare('UPDATE users SET credits = credits + ?, stat_casino_won = stat_casino_won + ?, stat_total_earned = stat_total_earned + ? WHERE id = ?').run(segment.reward.amount, segment.reward.amount, segment.reward.amount, userId);
    rewardInfo.amount = segment.reward.amount;
  } else if (segment.reward.type === 'xp') {
    addBattlePassXP(userId, segment.reward.amount);
    rewardInfo.amount = segment.reward.amount;
  } else if (segment.reward.type === 'card') {
    const cards = db.prepare('SELECT * FROM cards WHERE rarity = ?').all(segment.reward.rarity);
    if (cards.length > 0) {
      const card = cards[Math.floor(Math.random() * cards.length)];
      db.prepare('INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)').run(userId, card.id);
      cardGiven = { name: card.name, rarity: card.rarity, emoji: card.emoji };
      rewardInfo.card = cardGiven;
    }
  }

  // Quest/achievement hooks
  updateQuestProgress(userId, 'casino_spin', 1);
  updateQuestProgress(userId, 'credits_spent', CASINO_COST);
  if (segment.reward.type === 'credits' && segment.reward.amount > 0) {
    updateQuestProgress(userId, 'credits_earned', segment.reward.amount);
  }
  checkAchievements(userId);

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;

  res.json({
    success: true,
    segmentIndex: selectedIdx,
    reward: rewardInfo,
    cardGiven,
    credits: newCredits
  });
});

// ============================================
// DAILY SHOP (BOUTIQUE ROTATIVE)
// ============================================
app.get('/api/shop/daily-cards', requireAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const rng = seededRandom('dailyshop-' + today);
  const eligibleCards = db.prepare("SELECT * FROM cards WHERE rarity IN ('rare', 'epique', 'legendaire')").all();
  if (eligibleCards.length < 3) return res.json({ cards: [], resetIn: 0 });

  const byRarity = { rare: [], epique: [], legendaire: [] };
  for (const c of eligibleCards) { if (byRarity[c.rarity]) byRarity[c.rarity].push(c); }

  const picked = [];
  for (const r of ['rare', 'epique', 'legendaire']) {
    if (byRarity[r].length > 0) {
      const idx = Math.floor(rng() * byRarity[r].length);
      picked.push({ ...byRarity[r][idx], shopPrice: DAILY_SHOP_PRICES[r] });
    }
  }

  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const resetIn = Math.floor((tomorrow - now) / 1000);

  res.json({ cards: picked, resetIn });
});

app.post('/api/shop/buy-card', requireAuth, (req, res) => {
  const { cardId } = req.body;
  const userId = req.session.userId;
  const today = new Date().toISOString().split('T')[0];
  const rng = seededRandom('dailyshop-' + today);
  const eligibleCards = db.prepare("SELECT * FROM cards WHERE rarity IN ('rare', 'epique', 'legendaire')").all();
  const byRarity = { rare: [], epique: [], legendaire: [] };
  for (const c of eligibleCards) { if (byRarity[c.rarity]) byRarity[c.rarity].push(c); }

  let validCard = null;
  for (const r of ['rare', 'epique', 'legendaire']) {
    if (byRarity[r].length > 0) {
      const idx = Math.floor(rng() * byRarity[r].length);
      if (byRarity[r][idx].id === cardId) { validCard = byRarity[r][idx]; break; }
    }
  }
  if (!validCard) return res.status(400).json({ error: 'Carte non disponible aujourd\'hui' });

  const price = DAILY_SHOP_PRICES[validCard.rarity];
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  if (user.credits < price) return res.status(400).json({ error: 'Pas assez de credits !' });

  db.prepare('UPDATE users SET credits = credits - ?, stat_credits_spent = stat_credits_spent + ? WHERE id = ?').run(price, price, userId);
  db.prepare('INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)').run(userId, cardId);
  updateQuestProgress(userId, 'credits_spent', price);
  checkAchievements(userId);

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  res.json({ success: true, card: validCard, credits: newCredits });
});

// ============================================
// STATS API
// ============================================
app.get('/api/stats', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare(`SELECT credits,
    stat_pvp_wins, stat_pvp_losses,
    stat_casino_spins, stat_casino_won, stat_credits_spent,
    stat_fusions, stat_fusion_success, stat_fusion_fail,
    stat_boosters_opened, stat_boosters_origines, stat_boosters_rift, stat_boosters_avance,
    stat_diamonds_mined, stat_total_earned,
    created_at FROM users WHERE id = ?`).get(userId);

  const cardCount = db.prepare('SELECT COUNT(*) as c FROM user_cards WHERE user_id = ?').get(userId).c;
  const rarityBreakdown = db.prepare(`
    SELECT c.rarity, COUNT(*) as count FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id WHERE uc.user_id = ? GROUP BY c.rarity
  `).all(userId);

  const totalPvp = (user.stat_pvp_wins || 0) + (user.stat_pvp_losses || 0);
  res.json({
    pvp: { wins: user.stat_pvp_wins || 0, losses: user.stat_pvp_losses || 0, winRate: totalPvp > 0 ? Math.round((user.stat_pvp_wins / totalPvp) * 100) : 0 },
    casino: { spins: user.stat_casino_spins || 0, spent: (user.stat_casino_spins || 0) * CASINO_COST, won: user.stat_casino_won || 0, net: (user.stat_casino_won || 0) - ((user.stat_casino_spins || 0) * CASINO_COST) },
    fusion: { total: user.stat_fusions || 0, success: user.stat_fusion_success || 0, fail: user.stat_fusion_fail || 0, rate: (user.stat_fusions || 0) > 0 ? Math.round(((user.stat_fusion_success || 0) / (user.stat_fusions || 0)) * 100) : 0 },
    boosters: { total: user.stat_boosters_opened || 0, origines: user.stat_boosters_origines || 0, rift: user.stat_boosters_rift || 0, avance: user.stat_boosters_avance || 0 },
    cards: { total: cardCount, byRarity: Object.fromEntries(rarityBreakdown.map(r => [r.rarity, r.count])) },
    credits: { current: user.credits, totalSpent: user.stat_credits_spent || 0, totalEarned: user.stat_total_earned || 0 },
    mine: { diamondsMined: user.stat_diamonds_mined || 0 },
    memberSince: user.created_at
  });
});

// ============================================
// FRIENDS API
// ============================================
app.get('/api/friends', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const friends = db.prepare(`
    SELECT f.id as friendshipId,
      CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END as friendUserId,
      CASE WHEN f.user_id = ? THEN u2.username ELSE u1.username END as username,
      CASE WHEN f.user_id = ? THEN u2.display_name ELSE u1.display_name END as displayName,
      CASE WHEN f.user_id = ? THEN u2.avatar ELSE u1.avatar END as avatar
    FROM friendships f
    JOIN users u1 ON f.user_id = u1.id
    JOIN users u2 ON f.friend_id = u2.id
    WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
  `).all(userId, userId, userId, userId, userId, userId);
  friends.forEach(f => { f.online = onlineUsers.has(f.friendUserId); });

  const pendingReceived = db.prepare(`
    SELECT f.id as friendshipId, u.username, u.display_name as displayName, u.avatar
    FROM friendships f JOIN users u ON f.user_id = u.id
    WHERE f.friend_id = ? AND f.status = 'pending'
  `).all(userId);

  const pendingSent = db.prepare(`
    SELECT f.id as friendshipId, u.username, u.display_name as displayName, u.avatar
    FROM friendships f JOIN users u ON f.friend_id = u.id
    WHERE f.user_id = ? AND f.status = 'pending'
  `).all(userId);

  const unreadCounts = db.prepare('SELECT sender_id, COUNT(*) as count FROM chat_messages WHERE receiver_id = ? AND is_read = 0 GROUP BY sender_id').all(userId);
  const unreadMap = Object.fromEntries(unreadCounts.map(u => [u.sender_id, u.count]));
  friends.forEach(f => { f.unreadCount = unreadMap[f.friendUserId] || 0; });

  res.json({ friends, pendingReceived, pendingSent });
});

app.post('/api/friends/request', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Pseudo requis' });

  const target = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE OR display_name = ? COLLATE NOCASE').get(username, username);
  if (!target) return res.status(404).json({ error: 'Joueur introuvable' });
  if (target.id === userId) return res.status(400).json({ error: 'Tu ne peux pas t\'ajouter toi-meme' });

  const existing = db.prepare('SELECT * FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)').get(userId, target.id, target.id, userId);
  if (existing) {
    if (existing.status === 'accepted') return res.status(400).json({ error: 'Deja amis !' });
    return res.status(400).json({ error: 'Demande deja envoyee' });
  }

  db.prepare('INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, ?)').run(userId, target.id, 'pending');
  const sock = userSocketMap.get(target.id);
  if (sock && sock.connected) {
    const sender = db.prepare('SELECT username, display_name, avatar FROM users WHERE id = ?').get(userId);
    sock.emit('friend:request', { username: sender.display_name || sender.username, avatar: sender.avatar });
  }
  res.json({ success: true });
});

app.post('/api/friends/accept', requireAuth, (req, res) => {
  const { friendshipId } = req.body;
  const friendship = db.prepare('SELECT * FROM friendships WHERE id = ? AND friend_id = ? AND status = ?').get(friendshipId, req.session.userId, 'pending');
  if (!friendship) return res.status(404).json({ error: 'Demande introuvable' });
  db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', friendshipId);
  const sock = userSocketMap.get(friendship.user_id);
  if (sock && sock.connected) {
    const accepter = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(req.session.userId);
    sock.emit('friend:accepted', { username: accepter.display_name || accepter.username });
  }
  res.json({ success: true });
});

app.post('/api/friends/decline', requireAuth, (req, res) => {
  const { friendshipId } = req.body;
  const f = db.prepare('SELECT * FROM friendships WHERE id = ? AND friend_id = ? AND status = ?').get(friendshipId, req.session.userId, 'pending');
  if (!f) return res.status(404).json({ error: 'Demande introuvable' });
  db.prepare('DELETE FROM friendships WHERE id = ?').run(friendshipId);
  res.json({ success: true });
});

app.post('/api/friends/remove', requireAuth, (req, res) => {
  const { friendshipId } = req.body;
  const f = db.prepare('SELECT * FROM friendships WHERE id = ? AND (user_id = ? OR friend_id = ?)').get(friendshipId, req.session.userId, req.session.userId);
  if (!f) return res.status(404).json({ error: 'Ami introuvable' });
  db.prepare('DELETE FROM friendships WHERE id = ?').run(friendshipId);
  res.json({ success: true });
});

// ============================================
// CHAT API
// ============================================
app.get('/api/chat/:friendId', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const friendId = parseInt(req.params.friendId);
  const friendship = db.prepare('SELECT id FROM friendships WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = ?').get(userId, friendId, friendId, userId, 'accepted');
  if (!friendship) return res.status(403).json({ error: 'Non amis' });

  const messages = db.prepare('SELECT id, sender_id, receiver_id, message, created_at, is_read FROM chat_messages WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?) ORDER BY created_at DESC LIMIT 50').all(userId, friendId, friendId, userId);
  db.prepare('UPDATE chat_messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ? AND is_read = 0').run(friendId, userId);
  res.json(messages.reverse());
});

app.post('/api/chat/:friendId', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const friendId = parseInt(req.params.friendId);
  const { message } = req.body;
  if (!message || message.trim().length === 0) return res.status(400).json({ error: 'Message vide' });
  if (message.length > 500) return res.status(400).json({ error: 'Message trop long (max 500)' });

  const friendship = db.prepare('SELECT id FROM friendships WHERE ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)) AND status = ?').get(userId, friendId, friendId, userId, 'accepted');
  if (!friendship) return res.status(403).json({ error: 'Non amis' });

  const result = db.prepare('INSERT INTO chat_messages (sender_id, receiver_id, message) VALUES (?, ?, ?)').run(userId, friendId, message.trim());
  const msg = { id: result.lastInsertRowid, sender_id: userId, receiver_id: friendId, message: message.trim(), created_at: new Date().toISOString(), is_read: 0 };

  const sock = userSocketMap.get(friendId);
  if (sock && sock.connected) {
    const sender = db.prepare('SELECT username, display_name, avatar FROM users WHERE id = ?').get(userId);
    sock.emit('chat:message', { ...msg, senderName: sender.display_name || sender.username, senderAvatar: sender.avatar });
  }
  res.json(msg);
});

// ============================================
// PAGE ROUTES
// ============================================
app.get('/intro', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'intro.html')); });
app.get('/menu', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'menu.html')); });
app.get('/shop', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'shop.html')); });
app.get('/collection', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'collection.html')); });
app.get('/fusion', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'fusion.html')); });
app.get('/mine', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'mine.html')); });
app.get('/combat', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'combat.html')); });
app.get('/campaign', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'campaign.html')); });
app.get('/battle', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'battle.html')); });
app.get('/pvp', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'pvp.html')); });
app.get('/decks', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'decks.html')); });
app.get('/battlepass', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'battlepass.html')); });
app.get('/casino', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'casino.html')); });
app.get('/stats', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'stats.html')); });
app.get('/admin', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.get('/wiki', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'wiki.html')); });

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/menu');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// BACKUP SYSTEM
// ============================================

function createBackup(label) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `gacha-${label || 'auto'}-${timestamp}.db`;
  const backupPath = path.join(BACKUP_DIR, backupName);
  try {
    db.backup(backupPath);
    // Garder seulement les 20 derniers backups
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .sort()
      .reverse();
    if (backups.length > 20) {
      backups.slice(20).forEach(f => {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch(e) {}
      });
    }
    console.log(`[BACKUP] Sauvegarde: ${backupName}`);
    return { success: true, name: backupName, path: backupPath };
  } catch (err) {
    console.error(`[BACKUP] Erreur: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Backup automatique toutes les heures
const BACKUP_INTERVAL = (process.env.BACKUP_INTERVAL_MIN || 60) * 60 * 1000;
setInterval(() => createBackup('auto'), BACKUP_INTERVAL);

// Backup au démarrage
createBackup('startup');

// Backup à l'arrêt propre
function gracefulShutdown(signal) {
  console.log(`[SHUTDOWN] Signal ${signal} recu, sauvegarde en cours...`);
  createBackup('shutdown');
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// --- Routes admin backup ---
app.get('/api/admin/backups', requireAdmin, (req, res) => {
  try {
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: stat.size, date: stat.mtime };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(backups);
  } catch (err) {
    res.json([]);
  }
});

app.post('/api/admin/backup', requireAdmin, (req, res) => {
  const result = createBackup('manual');
  if (result.success) {
    res.json({ success: true, name: result.name });
  } else {
    res.status(500).json({ error: result.error });
  }
});

app.post('/api/admin/restore', requireAdmin, (req, res) => {
  const { backupName } = req.body;
  if (!backupName) return res.status(400).json({ error: 'backupName requis' });

  const backupPath = path.join(BACKUP_DIR, backupName);
  if (!fs.existsSync(backupPath)) return res.status(404).json({ error: 'Backup introuvable' });

  // Sécurité: vérifier que le nom ne contient pas de traversal
  if (backupName.includes('..') || backupName.includes('/')) {
    return res.status(400).json({ error: 'Nom invalide' });
  }

  try {
    // D'abord sauvegarder l'état actuel
    createBackup('pre-restore');

    // Fermer la DB, copier le backup, la DB se reconnectera au prochain appel
    // Note: avec better-sqlite3, on ne peut pas fermer et rouvrir facilement
    // Donc on copie les données du backup dans la DB actuelle
    const backupDb = new Database(backupPath, { readonly: true });

    // Vider et remplir les tables principales
    const tables = ['users', 'cards', 'user_cards', 'campaign_progress', 'pvp_teams', 'battle_log'];

    db.exec('BEGIN');
    for (const table of tables) {
      try {
        const rows = backupDb.prepare(`SELECT * FROM ${table}`).all();
        db.prepare(`DELETE FROM ${table}`).run();
        if (rows.length > 0) {
          const cols = Object.keys(rows[0]);
          const placeholders = cols.map(() => '?').join(',');
          const insert = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`);
          for (const row of rows) {
            insert.run(...cols.map(c => row[c]));
          }
        }
      } catch (e) {
        console.log(`[RESTORE] Table ${table} ignoree: ${e.message}`);
      }
    }
    db.exec('COMMIT');
    backupDb.close();

    console.log(`[RESTORE] Base restauree depuis: ${backupName}`);
    res.json({ success: true, restored: backupName });
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch(e) {}
    console.error(`[RESTORE] Erreur: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PVP TEMPS REEL — Socket.io
// ============================================

const io = new Server(server);
io.engine.use(sessionMiddleware);

const pvpQueue = [];
const pvpBattles = new Map();
const userSocketMap = new Map();
let pvpBattleIdCounter = 1;

// --- Helpers PVP ---

function getPvpSides(battle, side) {
  const me = battle[side];
  const oppSide = side === 'p1' ? 'p2' : 'p1';
  const opp = battle[oppSide];
  return { me, opp, oppSide };
}

function getPvpSnapshot(battle, side) {
  const me = battle[side];
  const oppSide = side === 'p1' ? 'p2' : 'p1';
  const opp = battle[oppSide];
  return {
    battleId: battle.battleId,
    turn: battle.turn,
    phase: battle.currentTurn === side ? 'player_turn' : 'enemy_turn',
    result: convertPvpResult(battle.result, side),
    playerHand: me.hand,
    playerField: me.field,
    playerEnergy: me.energy,
    playerMaxEnergy: me.maxEnergy,
    playerCrystal: Math.round((me.crystal || 0) * 100) / 100,
    playerMaxCrystal: me.maxCrystal || 2,
    playerDeckCount: me.deck.length,
    playerHp: me.hp,
    playerMaxHp: me.maxHp,
    enemyField: opp.field,
    enemyHandCount: opp.hand.length,
    enemyEnergy: opp.energy,
    enemyMaxEnergy: opp.maxEnergy,
    enemyCrystal: Math.round((opp.crystal || 0) * 100) / 100,
    enemyMaxCrystal: opp.maxCrystal || 2,
    enemyDeckCount: opp.deck.length,
    enemyHp: opp.hp,
    enemyMaxHp: opp.maxHp,
    attackedThisTurn: me.attackedThisTurn || [],
    isPvp: true,
  };
}

function convertPvpResult(result, side) {
  if (!result) return null;
  if (result.winner === 'draw') return 'draw';
  if (result.winner === side) return 'victory';
  return 'defeat';
}

function checkPvpWin(battle) {
  if (battle.p2.hp <= 0) { battle.result = { winner: 'p1' }; return true; }
  if (battle.p1.hp <= 0) { battle.result = { winner: 'p2' }; return true; }
  if (battle.turn > battle.maxTurns) {
    if (battle.p1.hp > battle.p2.hp) battle.result = { winner: 'p1' };
    else if (battle.p2.hp > battle.p1.hp) battle.result = { winner: 'p2' };
    else battle.result = { winner: 'draw' };
    return true;
  }
  return false;
}

function emitPvpUpdate(battle, actingSide, events) {
  const oppSide = actingSide === 'p1' ? 'p2' : 'p1';
  const actingSocket = userSocketMap.get(battle[actingSide].userId);
  const oppSocket = userSocketMap.get(battle[oppSide].userId);

  if (actingSocket && actingSocket.connected) {
    actingSocket.emit('pvp:update', { events, ...getPvpSnapshot(battle, actingSide) });
  }
  const flipped = flipEventSides(events);
  if (oppSocket && oppSocket.connected) {
    oppSocket.emit('pvp:update', { events: flipped, ...getPvpSnapshot(battle, oppSide) });
  }
}

function flipEventSides(events) {
  return events.map(e => {
    const f = { ...e };
    if (f.type === 'deploy') f.type = 'enemy_deploy';
    else if (f.type === 'enemy_deploy') f.type = 'deploy';
    if (f.type === 'player_draw') { f.type = 'enemy_draw'; delete f.card; }
    else if (f.type === 'enemy_draw') f.type = 'player_draw';
    if (f.side === 'player') f.side = 'enemy';
    else if (f.side === 'enemy') f.side = 'player';
    return f;
  });
}

function finalizePvpBattle(battle) {
  for (const side of ['p1', 'p2']) {
    const player = battle[side];
    const oppSide = side === 'p1' ? 'p2' : 'p1';
    let reward = 0, result;

    if (!battle.result) { result = 'draw'; reward = 50; }
    else if (battle.result.winner === 'draw') { result = 'draw'; reward = 50; }
    else if (battle.result.winner === side) { result = 'victory'; reward = 200; }
    else { result = 'defeat'; reward = 25; }

    try {
      db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(reward, player.userId);
      db.prepare('INSERT INTO battle_log (user_id, battle_type, opponent_info, result, reward_credits) VALUES (?, ?, ?, ?, ?)')
        .run(player.userId, 'pvp_realtime', battle[oppSide].username, result, reward);
      addBattlePassXP(player.userId, result === 'victory' ? BP_XP.pvp_realtime_win : result === 'defeat' ? BP_XP.pvp_realtime_lose : BP_XP.pvp_lose);
      // Quest/achievement hooks
      if (result === 'victory') {
        db.prepare('UPDATE users SET stat_pvp_wins = stat_pvp_wins + 1 WHERE id = ?').run(player.userId);
        updateQuestProgress(player.userId, 'pvp_win', 1);
      }
      if (result === 'defeat') {
        db.prepare('UPDATE users SET stat_pvp_losses = stat_pvp_losses + 1 WHERE id = ?').run(player.userId);
      }
      if (reward > 0) updateQuestProgress(player.userId, 'credits_earned', reward);
      checkAchievements(player.userId);
    } catch(e) { console.error('[PVP] DB error:', e.message); }

    const sock = userSocketMap.get(player.userId);
    if (sock && sock.connected) {
      sock.emit('pvp:battle-end', { result, reward });
      sock.pvpBattleId = null;
      sock.pvpSide = null;
    }
  }
  setTimeout(() => pvpBattles.delete(battle.battleId), 60000);
}

function applyPvpDeployPassives(unit, myField, events) {
  if (unit.element === 'eau') {
    const tortueCount = getFieldAlive(myField).filter(u => u.name === 'Tortue des Rivieres' && u !== unit).length;
    if (tortueCount > 0) {
      unit.maxHp += tortueCount;
      unit.currentHp += tortueCount;
      events.push({ type: 'type_passive', desc: `Tortue des Rivieres : +${tortueCount} PV max a ${unit.name}` });
    }
  }
  if (unit.name === 'Sapeur de Terre') {
    unit.permanentBonusAtk = (unit.permanentBonusAtk || 0) + 1;
    unit.lastingAtkBuff = (unit.lastingAtkBuff || 0) + 1;
    unit.lastingAtkTurns = 2;
    events.push({ type: 'type_passive', desc: `${unit.name} se prepare ! +1 ATK (2 tours)` });
  }
  if (unit.name === 'Poisson Combattant') {
    unit.justDeployed = false;
    events.push({ type: 'type_passive', desc: `${unit.name} pret au combat ! Peut attaquer immediatement` });
  }
}

function applyTurnStartPassives(activeField, oppField, events) {
  // Divin aura
  const divinCount = getFieldAlive(activeField).filter(u => u.type === 'divin').length;
  if (divinCount > 0) {
    getFieldAlive(activeField).forEach(u => { u.currentHp = Math.min(u.maxHp, u.currentHp + divinCount); });
    events.push({ type: 'type_passive', desc: `Aura divine : +${divinCount} PV` });
  }
  // Esprit des Forets
  const espritCount = getFieldAlive(activeField).filter(u => u.name === 'Esprit des Forets').length;
  if (espritCount > 0) {
    getFieldAlive(activeField).filter(u => u.element === 'terre').forEach(u => { u.buffDef += espritCount; });
    events.push({ type: 'type_passive', desc: `Esprit des Forets : +${espritCount} DEF aux Terre` });
  }
  // Eclaireur des Dunes
  const aliveUnits = getFieldAlive(activeField);
  aliveUnits.filter(u => u.name === 'Eclaireur des Dunes').forEach(u => {
    if (aliveUnits.length === 1) { u.buffDef += 2; events.push({ type: 'type_passive', desc: `${u.name} est seule ! +2 DEF` }); }
  });
  // Phoenix Ancestral
  const phoenixCount = getFieldAlive(activeField).filter(u => u.name === 'Phoenix Ancestral').length;
  if (phoenixCount > 0) {
    getFieldAlive(oppField).forEach(u => {
      u.currentHp = Math.max(0, u.currentHp - phoenixCount);
      if (u.currentHp <= 0) checkKO(u, events, { deadTempCards: [] });
    });
    cleanDeadFromField(oppField);
    events.push({ type: 'type_passive', desc: `Phoenix Ancestral : ${phoenixCount} degat(s) aux ennemis` });
  }
  // Leviathan Abyssal
  const leviathanCount = getFieldAlive(activeField).filter(u => u.name === 'Leviathan Abyssal').length;
  if (leviathanCount > 0) {
    getFieldAlive(activeField).filter(u => u.element === 'eau').forEach(u => { u.buffAtk += leviathanCount; });
    events.push({ type: 'type_passive', desc: `Leviathan Abyssal : +${leviathanCount} ATK aux Eau` });
  }
  // Pretresse Solaire
  const pretresseCount = getFieldAlive(activeField).filter(u => u.name === 'Pretresse Solaire').length;
  if (pretresseCount > 0) {
    for (let i = 0; i < pretresseCount; i++) {
      const wounded = getFieldAlive(activeField).filter(u => u.currentHp < u.maxHp).sort((a, b) => a.currentHp - b.currentHp)[0];
      if (wounded) { wounded.currentHp = Math.min(wounded.maxHp, wounded.currentHp + 1); events.push({ type: 'type_passive', desc: `Pretresse Solaire soigne ${wounded.name} de 1 PV` }); }
    }
  }
}

function tryMatchPlayers() {
  while (pvpQueue.length >= 2) {
    const p1 = pvpQueue.shift();
    const p2 = pvpQueue.shift();
    const s1 = userSocketMap.get(p1.userId);
    const s2 = userSocketMap.get(p2.userId);
    if (!s1 || !s1.connected) { pvpQueue.unshift(p2); continue; }
    if (!s2 || !s2.connected) { pvpQueue.unshift(p1); continue; }
    createPvpBattle(p1, p2);
  }
}

function createPvpBattle(p1Data, p2Data) {
  const battleId = 'pvp_' + (pvpBattleIdCounter++);

  const p1Deck = shuffleArray(p1Data.playerCards.map(c => makeHandCard(c)));
  const p2Deck = shuffleArray(p2Data.playerCards.map(c => makeHandCard(c)));
  const p1Hand = p1Deck.splice(0, 5);
  const p2Hand = p2Deck.splice(0, 5);
  const firstPlayer = Math.random() < 0.5 ? 'p1' : 'p2';

  const state = {
    battleId,
    isPvp: true,
    isDeckBattle: true,
    turn: 1,
    maxTurns: 20,
    currentTurn: firstPlayer,
    p1: {
      userId: p1Data.userId, username: p1Data.username,
      deck: p1Deck, hand: p1Hand, field: [null, null, null],
      energy: getManaForTurn(1), maxEnergy: getManaForTurn(1),
      crystal: 0, crystalRate: 0.3, maxCrystal: 2,
      hp: 20, maxHp: 20, attackedThisTurn: [],
    },
    p2: {
      userId: p2Data.userId, username: p2Data.username,
      deck: p2Deck, hand: p2Hand, field: [null, null, null],
      energy: getManaForTurn(1), maxEnergy: getManaForTurn(1),
      crystal: 0, crystalRate: 0.3, maxCrystal: 2,
      hp: 20, maxHp: 20, attackedThisTurn: [],
    },
    result: null,
    deadTempCards: [],
    lastAction: Date.now(),
  };

  pvpBattles.set(battleId, state);

  const s1 = userSocketMap.get(p1Data.userId);
  const s2 = userSocketMap.get(p2Data.userId);
  s1.pvpBattleId = battleId; s1.pvpSide = 'p1';
  s2.pvpBattleId = battleId; s2.pvpSide = 'p2';
  s1.join(battleId);
  s2.join(battleId);

  s1.emit('pvp:battle-start', {
    ...getPvpSnapshot(state, 'p1'),
    opponentName: p2Data.username,
    myTurn: firstPlayer === 'p1',
  });
  s2.emit('pvp:battle-start', {
    ...getPvpSnapshot(state, 'p2'),
    opponentName: p1Data.username,
    myTurn: firstPlayer === 'p2',
  });

  console.log(`[PVP] Match: ${p1Data.username} vs ${p2Data.username} (${battleId})`);
}

function handlePvpDisconnect(userId) {
  for (const [battleId, battle] of pvpBattles) {
    if (battle.result) continue;
    let disconnectedSide = null;
    if (battle.p1.userId === userId) disconnectedSide = 'p1';
    if (battle.p2.userId === userId) disconnectedSide = 'p2';
    if (disconnectedSide) {
      battle.disconnectTimer = setTimeout(() => {
        const winnerSide = disconnectedSide === 'p1' ? 'p2' : 'p1';
        battle.result = { winner: winnerSide };
        finalizePvpBattle(battle);
      }, 30000);
      const oppSide = disconnectedSide === 'p1' ? 'p2' : 'p1';
      const oppSocket = userSocketMap.get(battle[oppSide].userId);
      if (oppSocket) oppSocket.emit('pvp:opponent-disconnected', { timeout: 30 });
      break;
    }
  }
}

// --- Socket.io Connection ---

io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (!sess || !sess.userId) { socket.disconnect(); return; }
  const userId = sess.userId;
  userSocketMap.set(userId, socket);

  // --- Friends online status ---
  onlineUsers.add(userId);
  const friendIds = db.prepare(`
    SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END as fid
    FROM friendships WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'
  `).all(userId, userId, userId);
  for (const { fid } of friendIds) {
    const fSock = userSocketMap.get(fid);
    if (fSock && fSock.connected) fSock.emit('friend:status', { userId, online: true });
  }

  socket.on('chat:typing', ({ friendId }) => {
    const fSock = userSocketMap.get(friendId);
    if (fSock && fSock.connected) fSock.emit('chat:typing', { userId });
  });

  // Check reconnection to active PVP battle
  for (const [battleId, battle] of pvpBattles) {
    if (battle.result) continue;
    let side = null;
    if (battle.p1.userId === userId) side = 'p1';
    if (battle.p2.userId === userId) side = 'p2';
    if (side) {
      socket.pvpBattleId = battleId;
      socket.pvpSide = side;
      socket.join(battleId);
      if (battle.disconnectTimer) { clearTimeout(battle.disconnectTimer); battle.disconnectTimer = null; }
      socket.emit('pvp:reconnect', { ...getPvpSnapshot(battle, side), opponentName: battle[side === 'p1' ? 'p2' : 'p1'].username, myTurn: battle.currentTurn === side });
      const oppSide = side === 'p1' ? 'p2' : 'p1';
      const oppSocket = userSocketMap.get(battle[oppSide].userId);
      if (oppSocket) oppSocket.emit('pvp:opponent-reconnected');
      break;
    }
  }

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    const offFriends = db.prepare(`
      SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END as fid
      FROM friendships WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'
    `).all(userId, userId, userId);
    for (const { fid } of offFriends) {
      const fSock = userSocketMap.get(fid);
      if (fSock && fSock.connected) fSock.emit('friend:status', { userId, online: false });
    }
    const qIdx = pvpQueue.findIndex(p => p.userId === userId);
    if (qIdx !== -1) pvpQueue.splice(qIdx, 1);
    handlePvpDisconnect(userId);
    userSocketMap.delete(userId);
  });

  // --- Matchmaking ---

  socket.on('pvp:join-queue', ({ deckId }) => {
    if (pvpQueue.some(p => p.userId === userId)) { socket.emit('pvp:error', { message: 'Deja en file' }); return; }

    let playerCards;
    if (deckId === 'starter') {
      playerCards = STARTER_DECK.map(c => ({ ...c }));
    } else {
      const deck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
      if (!deck) { socket.emit('pvp:error', { message: 'Deck introuvable' }); return; }
      const cards = db.prepare(`SELECT dc.position, uc.id as user_card_id, uc.is_shiny, uc.is_fused, uc.is_temp, c.* FROM deck_cards dc JOIN user_cards uc ON dc.user_card_id = uc.id JOIN cards c ON uc.card_id = c.id WHERE dc.deck_id = ? ORDER BY dc.position`).all(deck.id);
      if (cards.length !== 20) { socket.emit('pvp:error', { message: 'Deck incomplet (20 cartes)' }); return; }
      playerCards = cards;
    }

    const user = db.prepare('SELECT username, display_name FROM users WHERE id = ?').get(userId);
    pvpQueue.push({ userId, username: user.display_name || user.username, deckId, playerCards, socketId: socket.id, joinedAt: Date.now() });
    socket.emit('pvp:queued');
    tryMatchPlayers();
  });

  socket.on('pvp:leave-queue', () => {
    const idx = pvpQueue.findIndex(p => p.userId === userId);
    if (idx !== -1) pvpQueue.splice(idx, 1);
  });

  // --- PVP Battle Actions ---

  socket.on('pvp:deploy', ({ handIndex, fieldSlot }) => {
    const battle = pvpBattles.get(socket.pvpBattleId);
    if (!battle || battle.result || battle.currentTurn !== socket.pvpSide) return;
    const { me } = getPvpSides(battle, socket.pvpSide);

    const card = me.hand[handIndex];
    if (!card || card.type === 'objet') return;
    if (fieldSlot < 0 || fieldSlot > 2) return;
    if (me.field[fieldSlot] && me.field[fieldSlot].alive) return;
    if (card.mana_cost > me.energy) return;

    me.hand.splice(handIndex, 1);
    me.field[fieldSlot] = null;
    const unit = makeDeckFieldUnit(card, 'player');
    unit.justDeployed = true;
    me.field[fieldSlot] = unit;
    me.energy -= card.mana_cost;

    const events = [{ type: 'deploy', slot: fieldSlot, name: unit.name, emoji: unit.emoji, mana_cost: unit.mana_cost }];
    applyPvpDeployPassives(unit, me.field, events);
    battle.lastAction = Date.now();
    emitPvpUpdate(battle, socket.pvpSide, events);
  });

  socket.on('pvp:attack-card', ({ fieldSlot, targetSlot }) => {
    const battle = pvpBattles.get(socket.pvpBattleId);
    if (!battle || battle.result || battle.currentTurn !== socket.pvpSide) return;
    const { me, opp } = getPvpSides(battle, socket.pvpSide);

    const attacker = me.field[fieldSlot];
    if (!attacker || !attacker.alive || attacker.stunned || attacker.justDeployed) return;
    if (me.attackedThisTurn.includes(fieldSlot)) return;
    if (me.energy < 1) return;
    const target = opp.field[targetSlot];
    if (!target || !target.alive) return;

    me.energy -= 1;
    const events = [];

    // Fortification Guerrier
    if (attacker.type === 'guerrier' && !attacker.lowHpDefTriggered && attacker.currentHp / attacker.maxHp < 0.3) {
      attacker.permanentBonusDef += 2; attacker.lowHpDefTriggered = true;
      events.push({ type: 'type_passive', desc: `${attacker.name} active Fortification ! +2 DEF` });
    }

    const packBonus = getPackBonus(me.field, attacker);
    attacker.permanentBonusAtk += packBonus;
    const dmg = calcDamage(attacker, target, false, me.field);
    attacker.permanentBonusAtk -= packBonus;

    applyDamage(target, dmg, events, attacker, battle);
    events.push({ type: 'attack', attacker: attacker.name, attackerSlot: fieldSlot, target: target.name, targetSlot, damage: dmg, side: 'player' });

    if (attacker.name === 'Salamandre Ardente' && !target.alive) {
      attacker.permanentBonusAtk = (attacker.permanentBonusAtk || 0) + 1;
      attacker.lastingAtkBuff = (attacker.lastingAtkBuff || 0) + 1; attacker.lastingAtkTurns = 2;
      events.push({ type: 'type_passive', desc: `${attacker.name} s'enflamme ! +1 ATK` });
    }

    me.attackedThisTurn.push(fieldSlot);

    if (attacker.lifestealPercent > 0) {
      const healed = Math.floor(dmg * attacker.lifestealPercent / 100);
      attacker.currentHp = Math.min(attacker.maxHp, attacker.currentHp + healed);
      events.push({ type: 'ability_heal', unit: attacker.name, target: attacker.name, ability: 'Vampirisme', heal: healed });
    }
    if (!target.alive && attacker.type === 'bete') {
      attacker.permanentBonusAtk += 1;
      events.push({ type: 'type_passive', desc: `${attacker.name} gagne en feroce ! +1 ATK` });
    }
    if (!target.alive) {
      getFieldAlive(me.field).filter(u => u.name === 'Dragonnet de Braise').forEach(u => {
        u.buffAtk += 1; events.push({ type: 'type_passive', desc: `${u.name} s'embrase ! +1 ATK` });
      });
    }
    if (!target.alive && attacker.name === 'Requin des Profondeurs' && attacker.alive) {
      const idx = me.attackedThisTurn.indexOf(fieldSlot);
      if (idx !== -1) { me.attackedThisTurn.splice(idx, 1); events.push({ type: 'type_passive', desc: `${attacker.name} sent le sang ! Peut attaquer a nouveau` }); }
    }

    cleanDeadFromField(opp.field);
    checkPvpWin(battle);
    battle.lastAction = Date.now();
    emitPvpUpdate(battle, socket.pvpSide, events);
    if (battle.result) finalizePvpBattle(battle);
  });

  socket.on('pvp:attack-avatar', ({ fieldSlot }) => {
    const battle = pvpBattles.get(socket.pvpBattleId);
    if (!battle || battle.result || battle.currentTurn !== socket.pvpSide) return;
    const { me, opp } = getPvpSides(battle, socket.pvpSide);

    const attacker = me.field[fieldSlot];
    if (!attacker || !attacker.alive || attacker.stunned || attacker.justDeployed) return;
    if (me.attackedThisTurn.includes(fieldSlot) || me.energy < 1) return;
    if (getFieldAlive(opp.field).length > 0) return;

    me.energy -= 1;
    const totalAtk = attacker.effectiveStats.attack + (attacker.buffAtk || 0) + (attacker.permanentBonusAtk || 0);
    const dmg = Math.max(1, totalAtk);
    opp.hp = Math.max(0, opp.hp - dmg);
    me.attackedThisTurn.push(fieldSlot);

    const events = [{ type: 'avatar_damage', attacker: attacker.name, damage: dmg, targetHp: opp.hp, side: 'player' }];
    checkPvpWin(battle);
    battle.lastAction = Date.now();
    emitPvpUpdate(battle, socket.pvpSide, events);
    if (battle.result) finalizePvpBattle(battle);
  });

  socket.on('pvp:use-ability', ({ fieldSlot, targetSlot }) => {
    const battle = pvpBattles.get(socket.pvpBattleId);
    if (!battle || battle.result || battle.currentTurn !== socket.pvpSide) return;
    const { me, opp } = getPvpSides(battle, socket.pvpSide);

    const unit = me.field[fieldSlot];
    if (!unit || !unit.alive || unit.usedAbility || unit.stunned) return;
    const crystalCost = unit.crystal_cost || 1;
    if ((me.crystal || 0) < crystalCost) return;
    const ability = ABILITY_MAP[unit.ability_name];
    if (!ability) return;

    const myAlive = getFieldAlive(me.field);
    const oppAlive = getFieldAlive(opp.field);
    let targets = oppAlive;
    if (targetSlot !== undefined && targetSlot !== null) {
      const t = opp.field[targetSlot];
      if (t && t.alive) targets = [t];
    }

    const events = resolveAbility(unit, targets, myAlive, oppAlive, battle);
    me.crystal -= crystalCost;
    cleanDeadFromField(opp.field);
    cleanDeadFromField(me.field);
    checkPvpWin(battle);
    battle.lastAction = Date.now();
    emitPvpUpdate(battle, socket.pvpSide, events);
    if (battle.result) finalizePvpBattle(battle);
  });

  socket.on('pvp:use-ability-avatar', ({ fieldSlot }) => {
    const battle = pvpBattles.get(socket.pvpBattleId);
    if (!battle || battle.result || battle.currentTurn !== socket.pvpSide) return;
    const { me, opp } = getPvpSides(battle, socket.pvpSide);

    const unit = me.field[fieldSlot];
    if (!unit || !unit.alive || unit.usedAbility || unit.stunned) return;
    const crystalCost = unit.crystal_cost || 1;
    if ((me.crystal || 0) < crystalCost) return;
    if (getFieldAlive(opp.field).length > 0) return;
    const ability = ABILITY_MAP[unit.ability_name];
    if (!ability) return;

    let dmg = 0;
    const events = [];
    if (['direct_damage', 'direct_damage_ignore_def', 'aoe_damage', 'ignore_def'].includes(ability.type)) {
      dmg = ability.value || 1;
    } else if (ability.type === 'sacrifice') {
      unit.currentHp = Math.max(1, unit.currentHp - Math.floor(unit.maxHp * ability.selfPercent / 100));
      dmg = ability.value || 3;
    } else {
      const myAlive = getFieldAlive(me.field);
      const abilityEvents = resolveAbility(unit, [], myAlive, [], battle);
      me.crystal -= crystalCost;
      emitPvpUpdate(battle, socket.pvpSide, abilityEvents);
      return;
    }

    opp.hp = Math.max(0, opp.hp - dmg);
    me.crystal -= crystalCost;
    unit.usedAbility = true;
    events.push({ type: 'ability', unit: unit.name, ability: unit.ability_name, desc: unit.ability_desc });
    events.push({ type: 'avatar_damage', attacker: unit.name, damage: dmg, targetHp: opp.hp, side: 'player' });
    checkPvpWin(battle);
    battle.lastAction = Date.now();
    emitPvpUpdate(battle, socket.pvpSide, events);
    if (battle.result) finalizePvpBattle(battle);
  });

  socket.on('pvp:use-item', ({ handIndex, targetSlot, targetSide }) => {
    const battle = pvpBattles.get(socket.pvpBattleId);
    if (!battle || battle.result || battle.currentTurn !== socket.pvpSide) return;
    const { me, opp } = getPvpSides(battle, socket.pvpSide);

    const item = me.hand[handIndex];
    if (!item || item.type !== 'objet') return;
    if (item.mana_cost > me.energy) return;
    const effect = ITEM_EFFECTS[item.ability_name];
    if (!effect) return;

    const myAlive = getFieldAlive(me.field);
    const oppAlive = getFieldAlive(opp.field);
    let target = null;
    if (effect.target === 'ally' && targetSlot !== undefined) {
      target = me.field[targetSlot];
      if (!target || !target.alive) return;
    } else if (effect.target === 'enemy' && targetSlot !== undefined) {
      target = opp.field[targetSlot];
      if (!target || !target.alive) return;
    }

    const events = [];
    resolveItemEffect(item, target, myAlive, oppAlive, events, battle);
    if (effect.type === 'add_crystal') {
      me.crystal = Math.min(me.maxCrystal, (me.crystal || 0) + effect.value);
    }
    me.hand.splice(handIndex, 1);
    me.energy -= item.mana_cost;
    cleanDeadFromField(opp.field);
    cleanDeadFromField(me.field);
    checkPvpWin(battle);
    battle.lastAction = Date.now();
    emitPvpUpdate(battle, socket.pvpSide, events);
    if (battle.result) finalizePvpBattle(battle);
  });

  socket.on('pvp:end-turn', () => {
    const battle = pvpBattles.get(socket.pvpBattleId);
    if (!battle || battle.result || battle.currentTurn !== socket.pvpSide) return;
    const side = socket.pvpSide;
    const { me, opp, oppSide } = getPvpSides(battle, side);
    const events = [];

    // 1. Poison ticks on current player's field
    for (const unit of getFieldAlive(me.field)) {
      if (unit.poisoned > 0) {
        unit.currentHp = Math.max(1, unit.currentHp - unit.poisoned);
        events.push({ type: 'poison_tick', unit: unit.name, damage: unit.poisoned });
        unit.poisoned = 0;
        if (unit.currentHp <= 0) checkKO(unit, events, battle);
      }
      if (unit.alive && unit.poisonDotTurns > 0 && unit.poisonDot > 0) {
        unit.currentHp = Math.max(1, unit.currentHp - unit.poisonDot);
        events.push({ type: 'poison_tick', unit: unit.name, damage: unit.poisonDot, desc: `Poison (${unit.poisonDotTurns} tours)` });
        unit.poisonDotTurns--;
        if (unit.poisonDotTurns <= 0) unit.poisonDot = 0;
        if (unit.currentHp <= 0) checkKO(unit, events, battle);
      }
    }
    cleanDeadFromField(me.field);

    // 2. Reset temp buffs
    for (const unit of getFieldAlive(me.field)) {
      unit.buffAtk = 0; unit.buffDef = 0;
      unit.marked = 0; unit.counterDamage = 0;
      unit.lifestealPercent = 0; unit.hasAttacked = false;
      if (unit.lastingDefBuff > 0) {
        unit.permanentBonusDef = Math.max(0, (unit.permanentBonusDef || 0) - unit.lastingDefBuff);
        unit.lastingDefBuff = 0;
      }
      if (unit.lastingAtkBuff > 0 && unit.lastingAtkTurns !== undefined) {
        unit.lastingAtkTurns--;
        if (unit.lastingAtkTurns <= 0) { unit.permanentBonusAtk = Math.max(0, (unit.permanentBonusAtk || 0) - unit.lastingAtkBuff); unit.lastingAtkBuff = 0; }
      }
      if (unit.ralliement && unit.alive) {
        const earthCount = getFieldAlive(me.field).filter(a => a.alive && a.element === 'terre' && a !== unit).length;
        unit.buffAtk += earthCount;
      }
    }

    if (checkPvpWin(battle)) {
      emitPvpUpdate(battle, side, events);
      finalizePvpBattle(battle);
      return;
    }

    // 3. Switch to opponent's turn
    battle.currentTurn = oppSide;
    battle.turn++;

    // Clear summoning sickness
    for (const unit of getFieldAlive(opp.field)) { unit.justDeployed = false; }

    // Opponent energy
    opp.maxEnergy = getManaForTurn(battle.turn);
    opp.energy = opp.maxEnergy;
    opp.crystal = Math.min(opp.maxCrystal, (opp.crystal || 0) + (opp.crystalRate || 0.3));
    opp.attackedThisTurn = [];

    // Opponent draws
    if (opp.hand.length < 7 && opp.deck.length > 0) {
      opp.hand.push(opp.deck.shift());
      events.push({ type: 'enemy_draw' });
    }

    // Turn-start passives for opponent
    applyTurnStartPassives(opp.field, me.field, events);

    if (checkPvpWin(battle)) {
      emitPvpUpdate(battle, side, events);
      finalizePvpBattle(battle);
      return;
    }

    battle.lastAction = Date.now();
    emitPvpUpdate(battle, side, events);

    const oppSocket = userSocketMap.get(opp.userId);
    if (oppSocket && oppSocket.connected) oppSocket.emit('pvp:your-turn');
  });

  socket.on('pvp:surrender', () => {
    const battle = pvpBattles.get(socket.pvpBattleId);
    if (!battle || battle.result) return;
    const winnerSide = socket.pvpSide === 'p1' ? 'p2' : 'p1';
    battle.result = { winner: winnerSide };
    emitPvpUpdate(battle, socket.pvpSide, [{ type: 'surrender', side: 'player' }]);
    finalizePvpBattle(battle);
  });
});

// Cleanup stale PVP battles
setInterval(() => {
  const now = Date.now();
  for (const [id, battle] of pvpBattles) {
    if (now - battle.lastAction > 30 * 60 * 1000) pvpBattles.delete(id);
  }
}, 5 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Gacha Game lance sur http://0.0.0.0:${PORT}`);
});
