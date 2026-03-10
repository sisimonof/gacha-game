const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const bcrypt = require('bcryptjs');
const cookieParser = require('cookie-parser');
const Database = require('better-sqlite3');
const crypto = require('crypto');
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
  CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
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

// Migration: profile_frame + unlocked_frames
{
  const userColsFrames = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (!userColsFrames.includes('profile_frame')) {
    db.exec("ALTER TABLE users ADD COLUMN profile_frame TEXT DEFAULT 'none'");
    console.log('Migration: profile_frame ajouté');
  }
  if (!userColsFrames.includes('unlocked_frames')) {
    db.exec(`ALTER TABLE users ADD COLUMN unlocked_frames TEXT DEFAULT '["none","flames"]'`);
    console.log('Migration: unlocked_frames ajouté');
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
    ['stat_credits_spent', 'INTEGER DEFAULT 0'],
    ['pvp_rating', 'INTEGER DEFAULT 1000']
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
    ['stat_boosters_avance', 'INTEGER DEFAULT 0'],
    ['stat_market_sales', 'INTEGER DEFAULT 0'],
    ['stat_market_purchases', 'INTEGER DEFAULT 0'],
    ['tutorial_completed', 'INTEGER DEFAULT 0'],
    // Phase 1: Energy system
    ['energy', 'INTEGER DEFAULT 100'],
    ['last_energy_update', "TEXT DEFAULT ''"],
    ['energy_purchases_today', 'INTEGER DEFAULT 0'],
    ['energy_purchases_date', "TEXT DEFAULT ''"],
    // Phase 2: Craft stats
    ['stat_crafts', 'INTEGER DEFAULT 0'],
    // Phase 3: Awakening stats
    ['stat_awakenings', 'INTEGER DEFAULT 0'],
    // Phase 5: Guild
    ['guild_id', 'INTEGER DEFAULT NULL']
  ];
  for (const [col, type] of newMigrations) {
    if (!cols2.includes(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
      console.log(`Migration: ${col} ajouté`);
    }
  }
}

// Phase 3: Awakening level on user_cards
{
  const ucCols = db.prepare("PRAGMA table_info(user_cards)").all().map(c => c.name);
  if (!ucCols.includes('awakening_level')) {
    db.exec("ALTER TABLE user_cards ADD COLUMN awakening_level INTEGER DEFAULT 0");
    console.log('Migration: awakening_level ajouté à user_cards');
  }
}

// Phase 2: Craft items table
db.exec(`
  CREATE TABLE IF NOT EXISTS user_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_key TEXT NOT NULL,
    quantity INTEGER DEFAULT 0,
    UNIQUE(user_id, item_key),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Phase 5: Guild tables
db.exec(`
  CREATE TABLE IF NOT EXISTS guilds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    leader_id INTEGER NOT NULL,
    emoji TEXT DEFAULT '⚔',
    treasury INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (leader_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS guild_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL UNIQUE,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_boss_attack TEXT DEFAULT '',
    FOREIGN KEY (guild_id) REFERENCES guilds(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS guild_chat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_guild_chat ON guild_chat(guild_id);
  CREATE TABLE IF NOT EXISTS guild_boss (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id INTEGER NOT NULL UNIQUE,
    boss_name TEXT DEFAULT 'Dragon Ancestral',
    boss_hp INTEGER DEFAULT 10000,
    boss_max_hp INTEGER DEFAULT 10000,
    boss_emoji TEXT DEFAULT '🐉',
    week_key TEXT NOT NULL DEFAULT '',
    rewards_distributed INTEGER DEFAULT 0
  );
`)

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

// === MARCHE (Trading Market) ===
db.exec(`
  CREATE TABLE IF NOT EXISTS market_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    user_card_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    price INTEGER NOT NULL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sold_at DATETIME DEFAULT NULL,
    buyer_id INTEGER DEFAULT NULL,
    FOREIGN KEY (seller_id) REFERENCES users(id),
    FOREIGN KEY (user_card_id) REFERENCES user_cards(id),
    FOREIGN KEY (card_id) REFERENCES cards(id)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_market_status ON market_listings(status)');
db.exec('CREATE INDEX IF NOT EXISTS idx_market_seller ON market_listings(seller_id)');

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
      ['Serpent des Marees',  'rare',     'eau',   2, 1, 2,  2, 'Frappe empoisonnee','Applique poison pendant 4 tours', '🐍', '', 1.0],
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

// --- Migration : Phoenix Ancestral DOT AoE (v2) ---
{
  const phoenix = db.prepare("SELECT id, ability_desc FROM cards WHERE name = 'Phoenix Ancestral'").get();
  if (phoenix && phoenix.ability_desc === 'Inflige 1 degat a tous les ennemis') {
    db.prepare("UPDATE cards SET ability_desc = 'Brule tous les ennemis (1 degat/tour, 2 tours)' WHERE name = 'Phoenix Ancestral'").run();
    console.log('Migration: Phoenix Ancestral DOT AoE');
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
  db.prepare("UPDATE cards SET ability_name = 'Frappe empoisonnee', ability_desc = 'Applique poison pendant 4 tours', passive_desc = '' WHERE name = 'Serpent des Marees'").run();
  db.prepare("UPDATE cards SET ability_desc = '1 degat a la cible et aux adjacents. Si tue : +1 ATK tour suivant', passive_desc = '' WHERE name = 'Salamandre Ardente'").run();
  db.prepare("UPDATE cards SET ability_desc = 'Statut: +1 ATK par unite Terre alliee' WHERE name = 'Guerrier des Falaises'").run();
  db.prepare("UPDATE cards SET rarity = 'legendaire' WHERE name = 'Archange Dechu'").run();
  // v1.5.0 fix: rename Meditation -> Meditation interieure for Moine Errant (conflict with Moine)
  db.prepare("UPDATE cards SET ability_name = 'Meditation interieure' WHERE name = 'Moine Errant' AND ability_name = 'Meditation'").run();
  // v2.1.1 fix: rename Souffle triple -> Souffle tri-elementaire for Chimere Elementaire (conflict with Hydre de feu)
  db.prepare("UPDATE cards SET ability_name = 'Souffle tri-elementaire' WHERE name = 'Chimere Elementaire' AND ability_name = 'Souffle triple'").run();
  // Standardisation poison : descriptions uniformes
  db.prepare("UPDATE cards SET ability_desc = 'Applique poison pendant 4 tours' WHERE name = 'Serpent des Marees'").run();
  db.prepare("UPDATE cards SET ability_desc = 'Applique poison pendant 2 tours' WHERE ability_name = 'Spores nocives'").run();
  db.prepare("UPDATE cards SET ability_desc = 'Applique poison pendant 2 tours' WHERE ability_name = 'Combustion lente'").run();
  db.prepare("UPDATE cards SET ability_desc = 'Applique poison pendant 2 tours' WHERE ability_name = 'Morsure de flamme'").run();
  db.prepare("UPDATE cards SET ability_desc = 'Applique poison pendant 2 tours' WHERE ability_name = 'Dague empoisonnee'").run();
  db.prepare("UPDATE cards SET ability_desc = 'Applique poison pendant 2 tours' WHERE ability_name = 'Venin nocturne'").run();
  db.prepare("UPDATE cards SET ability_desc = 'Inflige 2 degats et applique poison pendant 2 tours' WHERE name = 'Rat des Egouts'").run();
  db.prepare("UPDATE cards SET ability_desc = 'Applique poison a tous les ennemis pendant 1 tour' WHERE name = 'Champignon Toxique'").run();
  db.prepare("UPDATE cards SET ability_desc = 'Mord 3 ennemis aleatoires (2 degats) et applique poison pendant 2 tours' WHERE name = 'Hydre Venimeuse'").run();
  db.prepare("UPDATE cards SET passive_desc = 'Quand touchee, applique poison a l attaquant pendant 2 tours' WHERE name = 'Hydre Venimeuse'").run();
  db.prepare("UPDATE cards SET passive_desc = 'Si le Rat meurt, applique poison a son tueur pendant 2 tours' WHERE name = 'Rat des Egouts'").run();
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

// --- Migration : Carte SECRET - Pines ---
{
  const hasPines = db.prepare("SELECT id FROM cards WHERE name = 'Pines'").get();
  if (!hasPines) {
    db.prepare(`
      INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, emoji, passive_desc, crystal_cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('Pines', 'secret', 'creature', 'terre', 3, 5, 8, 5, 'Emprise des Pins', 'Choisis une carte dans la main adverse : elle sera obligatoirement jouee en premier au prochain tour ennemi', '🌲', 'Immunise aux degats des cartes de type Terre', 2.0);
    console.log('Migration: carte SECRET Pines ajoutee');
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
    ['Rat des Egouts', 'commune', 'bete', 'ombre', 2, 0, 1, 1, 'Morsure infectee', 'Inflige 2 degats et applique poison pendant 2 tours', '🐀', 'Si le Rat meurt, applique poison a son tueur pendant 2 tours', 1.0],
    ['Moine Errant', 'commune', 'divin', 'lumiere', 0, 2, 4, 2, 'Meditation interieure', 'Se soigne 2 HP et gagne +1 DEF permanent', '🧘', '', 1.0],
    ['Scarabee de Lave', 'commune', 'bete', 'feu', 2, 2, 2, 2, 'Aucun', 'Aucun', '🪲', 'Quand il meurt, inflige 1 degat a toutes les cartes ennemies (explosion)', 1.0],
    ['Espion des Brumes', 'commune', 'creature', 'eau', 1, 1, 2, 1, 'Infiltration', 'Pioche 1 carte supplementaire', '🌫️', 'Ne peut pas etre cible au premier tour', 1.0],
    ['Champignon Toxique', 'commune', 'creature', 'terre', 0, 0, 3, 1, 'Spores', 'Applique poison a tous les ennemis pendant 1 tour', '🍄', 'Ne peut pas attaquer. Meurt au bout de 3 tours', 1.0],
    // RARES (4)
    ['Valkyrie Dechue', 'rare', 'guerrier', 'lumiere', 3, 2, 4, 3, 'Jugement guerrier', 'Attaque un ennemi ; si elle le tue, se soigne 3 HP', '🪽', '+1 ATK quand un allie meurt (vengeance)', 1.0],
    ['Alchimiste Fou', 'rare', 'mage', 'feu', 2, 1, 3, 3, 'Transmutation', 'Transforme 2 HP d un allie en +2 ATK permanent pour cet allie', '⚗️', 'Si l allie booste tue un ennemi ce tour, l Alchimiste recupere 2 HP', 1.0],
    ['Ombre Mimetique', 'rare', 'creature', 'ombre', 0, 0, 3, 2, 'Copie', 'Copie l ATK et la DEF de n importe quelle carte sur le terrain', '🪞', 'Perd 1 HP par tour (instable)', 1.0],
    // EPIQUES (2)
    ['Chimere Elementaire', 'epique', 'bete', 'feu', 3, 3, 6, 5, 'Souffle tri-elementaire', 'Inflige 3 degats a un ennemi (ignore DEF)', '🐲', 'Compte comme Feu, Eau ET Terre pour les synergies d elements', 1.5],
    ['Oracle du Temps', 'epique', 'divin', 'lumiere', 2, 3, 5, 4, 'Distorsion temporelle', 'Annule la derniere action de l adversaire et rejoue votre tour (1x/combat)', '⏳', '', 1.5],
    ['Colosse de Corail', 'epique', 'guerrier', 'eau', 3, 5, 8, 5, 'Recif vivant', 'Invoque un token Corail (0/2/2) sur chaque slot vide allie avec taunt', '🪸', '+1 DEF pour chaque token Corail en vie', 1.5],
    // LEGENDAIRES (2)
    ['Chronos', 'legendaire', 'divin', 'lumiere', 3, 4, 8, 7, 'Boucle temporelle', 'Reinitialise TOUTES les cartes, annule buffs/debuffs/poison/shield', '⌛', 'Immunise au stun, silence et poison. Debut de tour : un ennemi aleatoire perd son dernier buff', 2.0],
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

// --- Migration : 10 nouvelles cartes v0.2.3 ---
{
  const newCards3 = [
    // COMMUNES (2)
    ['Plante Carnivore', 'commune', 'bete', 'terre', 2, 1, 3, 2, 'Digestion', 'Inflige 2 degats et se soigne de 2 PV', '🌿', 'Regenere 1 PV par tour', 1.0],
    ['Mouette Pirate', 'commune', 'bete', 'eau', 2, 0, 2, 1, 'Pillage', 'Vole 1 ATK a un ennemi', '🦅', 'Deploy : vole 1 mana a l adversaire', 1.0],
    // RARES (2)
    ['Forgeron Nain', 'rare', 'guerrier', 'terre', 2, 3, 5, 3, 'Forge ardente', 'Donne +2 DEF a un allie et gagne +1 ATK', '🔨', 'Deploy : allies Terre gagnent +1 DEF', 1.0],
    ['Pyromane', 'rare', 'mage', 'feu', 3, 0, 3, 2, 'Cocktail Molotov', 'Inflige 2 degats a tous les ennemis mais subit 1 degat', '🧨', 'Chaque kill : +1 ATK permanent', 1.0],
    // EPIQUES (2)
    ['Golem de Miroir', 'epique', 'guerrier', 'lumiere', 0, 6, 8, 5, 'Reflet parfait', 'Renvoie 100% des degats recus jusqu au tour suivant', '🪞', 'Renvoie 1 degat a chaque attaquant (permanent)', 1.5],
    ['Hydre Venimeuse', 'epique', 'bete', 'ombre', 3, 2, 6, 5, 'Morsure triple', 'Mord 3 ennemis aleatoires (2 degats) et applique poison pendant 2 tours', '🐍', 'Quand touchee, applique poison a l attaquant pendant 2 tours', 1.5],
    // LEGENDAIRES (3)
    ['Marionnettiste', 'legendaire', 'mage', 'ombre', 1, 2, 4, 3, 'Fils du marionnettiste', 'Echange une de vos cartes avec une carte ennemie pendant 3 tours', '🎭', 'Les cartes volees ont -1 ATK', 2.0],
    ['Anubis', 'legendaire', 'divin', 'ombre', 4, 4, 8, 7, 'Jugement final', 'Ressuscite un allie mort a 50% PV et inflige 3 degats a un ennemi', '🐺', 'Chaque mort alliee : +1 ATK permanent', 2.0],
    ['Yggdrasil', 'legendaire', 'divin', 'terre', 0, 8, 12, 8, 'Benediction mondiale', 'Soigne tous les allies de 3 PV et purifie tous les effets negatifs', '🌳', 'Regenere 2 PV par tour a tous les allies', 2.0],
    // CHAOS (1)
    ['Le Parasite', 'chaos', 'creature', 'ombre', 1, 0, 4, 2, 'Infection', 'Infecte un ennemi (1 degat/tour, 3 tours). Si la cible meurt, l infection se propage', '🦠', 'Deploy : s attache a l ennemi le plus fort (infection permanente)', 1.0],
  ];

  const insertCard3 = db.prepare(`
    INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, emoji, passive_desc, crystal_cost)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let addedCount3 = 0;
  for (const card of newCards3) {
    const exists = db.prepare("SELECT id FROM cards WHERE name = ?").get(card[0]);
    if (!exists) {
      insertCard3.run(...card);
      addedCount3++;
    }
  }
  if (addedCount3 > 0) console.log('Migration: ' + addedCount3 + ' nouvelles cartes v0.2.3 ajoutees');
}

// --- Migration : 3 nouvelles cartes v0.2.4 ---
{
  const newCards4 = [
    ['Crabe Blinde', 'rare', 'bete', 'eau', 1, 3, 3, 2, 'Pincement', 'Inflige 1 degat et retire 1 DEF permanent a la cible', '🦀', '+1 DEF quand il est attaque (max 3 stacks)', 1.0],
    ['Tortue Bombe', 'rare', 'bete', 'feu', 0, 4, 5, 3, 'Carapace piegee', 'Se sacrifie et inflige ses DEF actuels en degats a tous les ennemis', '💣', '+1 DEF par tour (accumule la puissance)', 1.0],
    ['Tisseuse d Ames', 'epique', 'creature', 'ombre', 2, 2, 5, 4, 'Lien vital', 'Lie 2 ennemis : les degats subis par l un sont aussi subis par l autre (3 tours)', '🕸️', 'Quand un ennemi lie meurt, vole 2 ATK permanent', 1.5],
  ];

  const insertCard4 = db.prepare(`
    INSERT INTO cards (name, rarity, type, element, attack, defense, hp, mana_cost, ability_name, ability_desc, emoji, passive_desc, crystal_cost)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let addedCount4 = 0;
  for (const card of newCards4) {
    const exists = db.prepare("SELECT id FROM cards WHERE name = ?").get(card[0]);
    if (!exists) {
      insertCard4.run(...card);
      addedCount4++;
    }
  }
  if (addedCount4 > 0) console.log('Migration: ' + addedCount4 + ' nouvelles cartes v0.2.4 ajoutees');
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
  charbon: { name: 'Charbon', price: 10, weight: 70 },
  fer:     { name: 'Fer',     price: 18, weight: 15 },
  or:      { name: 'Or',      price: 35, weight: 8 },
  diamant: { name: 'Diamant', price: 55, weight: 4 }
};

const MINE_UPGRADES_CONFIG = {
  mine_speed:     { name: 'Pierre Supplementaire', emoji: '🪨', maxLevel: 5, costs: [2,4,6,10,15], desc: '+1 pierre a miner par niveau' },
  inventory_size: { name: 'Restock Rapide',        emoji: '⏱',  maxLevel: 5, costs: [2,3,5,8,12],  desc: '-2 min de temps de restock' },
  luck:           { name: 'Chance Augmentee',       emoji: '🍀', maxLevel: 5, costs: [3,5,8,12,18], desc: 'Minerais rares plus frequents' }
};

const BASE_ROCKS = 3;
const MINE_COOLDOWN = 840; // 14 minutes en secondes

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
  combat_win:       35,
  combat_lose:      10,
  mine_sell:        20,
  fusion:           15
};

// ============================================
// ENERGY SYSTEM
// ============================================
const ENERGY_CONFIG = {
  max: 100,
  regen_interval: 300, // 1 énergie toutes les 5 min (300s)
  costs: { pve_battle: 10, pvp_battle: 8, mine_tap: 5 },
  purchase: { amount: 50, price: 300, max_per_day: 3 }
};

function getEnergy(userId) {
  const user = db.prepare('SELECT energy, last_energy_update FROM users WHERE id = ?').get(userId);
  if (!user) return { energy: 0, nextRegenAt: null };
  let energy = user.energy;
  if (user.last_energy_update && energy < ENERGY_CONFIG.max) {
    const elapsed = Math.floor((Date.now() - new Date(user.last_energy_update + 'Z').getTime()) / 1000);
    const regenned = Math.floor(elapsed / ENERGY_CONFIG.regen_interval);
    if (regenned > 0) {
      energy = Math.min(ENERGY_CONFIG.max, energy + regenned);
      const now = new Date().toISOString();
      db.prepare('UPDATE users SET energy = ?, last_energy_update = ? WHERE id = ?').run(energy, now, userId);
    }
  }
  const secsToNext = ENERGY_CONFIG.regen_interval - (user.last_energy_update ? Math.floor((Date.now() - new Date(user.last_energy_update + 'Z').getTime()) / 1000) % ENERGY_CONFIG.regen_interval : 0);
  return { energy, max: ENERGY_CONFIG.max, nextRegenIn: energy >= ENERGY_CONFIG.max ? null : secsToNext };
}

function consumeEnergy(userId, amount) {
  const { energy } = getEnergy(userId); // recalculates regen first
  if (energy < amount) return { success: false, energy, needed: amount };
  const newEnergy = energy - amount;
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET energy = ?, last_energy_update = ? WHERE id = ?').run(newEnergy, now, userId);
  updateQuestProgress(userId, 'energy_spent', amount);
  return { success: true, energy: newEnergy };
}

// ============================================
// CRAFT SYSTEM
// ============================================
const CRAFT_ITEMS = {
  pierre_eveil: { name: "Pierre d'Eveil", emoji: '🌟', desc: "Necessaire pour l'eveil des cartes fusionnees" },
  booster_ticket: { name: 'Ticket Booster', emoji: '🎫', desc: 'Ouvre un booster gratuit (Origines)' }
};

const CRAFT_RECIPES = [
  { id: 'pierre_eveil', name: "Pierre d'Eveil", emoji: '🌟',
    cost: { fer: 10, or: 5 }, result: { type: 'item', key: 'pierre_eveil', qty: 1 } },
  { id: 'booster_ticket', name: 'Ticket Booster', emoji: '🎫',
    cost: { diamant: 20 }, result: { type: 'item', key: 'booster_ticket', qty: 1 } },
  { id: 'essence_craft', name: '1 Essence', emoji: '⛏',
    cost: { charbon: 50 }, result: { type: 'essence', qty: 1 } },
  { id: 'random_commune', name: 'Carte Commune', emoji: '🃏',
    cost: { fer: 5, charbon: 10 }, result: { type: 'card', rarity: 'commune' } },
  { id: 'random_rare', name: 'Carte Rare', emoji: '✨',
    cost: { or: 3, diamant: 2 }, result: { type: 'card', rarity: 'rare' } }
];

function getUserResourceCounts(userId) {
  const inv = db.prepare('SELECT resource, COUNT(*) as count FROM mine_inventory WHERE user_id = ? GROUP BY resource').all(userId);
  const counts = { charbon: 0, fer: 0, or: 0, diamant: 0 };
  for (const r of inv) counts[r.resource] = r.count;
  return counts;
}

function deductResources(userId, costs) {
  for (const [resource, amount] of Object.entries(costs)) {
    const ids = db.prepare('SELECT id FROM mine_inventory WHERE user_id = ? AND resource = ? LIMIT ?').all(userId, resource, amount);
    for (const row of ids) {
      db.prepare('DELETE FROM mine_inventory WHERE id = ?').run(row.id);
    }
  }
}

function getUserItems(userId) {
  return db.prepare('SELECT * FROM user_items WHERE user_id = ?').all(userId);
}

function addUserItem(userId, itemKey, qty) {
  const existing = db.prepare('SELECT * FROM user_items WHERE user_id = ? AND item_key = ?').get(userId, itemKey);
  if (existing) {
    db.prepare('UPDATE user_items SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
  } else {
    db.prepare('INSERT INTO user_items (user_id, item_key, quantity) VALUES (?, ?, ?)').run(userId, itemKey, qty);
  }
}

// ============================================
// AWAKENING (EVEIL) SYSTEM
// ============================================
const AWAKENING_CONFIG = [
  { level: 1, label: 'Eveil I',
    cost: { credits: 3000, essence: 5, pierre_eveil: 1 },
    bonuses: { attack: 1, defense: 1, hp: 1 } },
  { level: 2, label: 'Eveil II',
    cost: { credits: 8000, essence: 15, pierre_eveil: 3 },
    bonuses: { attack: 2, defense: 2, hp: 2 } }
];

// ============================================
// SPECIAL DAILY CHALLENGES
// ============================================
const SPECIAL_CHALLENGE_POOL = [
  { key: 'element_water', label: 'Victoire avec un deck 100% Eau 🌊', goal: [1], credits: 300, xp: 50, track: 'special_element_water', validation: { type: 'element_deck', element: 'eau' } },
  { key: 'element_fire', label: 'Victoire avec un deck 100% Feu 🔥', goal: [1], credits: 300, xp: 50, track: 'special_element_fire', validation: { type: 'element_deck', element: 'feu' } },
  { key: 'element_earth', label: 'Victoire avec un deck 100% Terre 🌿', goal: [1], credits: 300, xp: 50, track: 'special_element_earth', validation: { type: 'element_deck', element: 'terre' } },
  { key: 'element_shadow', label: 'Victoire avec un deck 100% Ombre 🌑', goal: [1], credits: 300, xp: 50, track: 'special_element_shadow', validation: { type: 'element_deck', element: 'ombre' } },
  { key: 'element_light', label: 'Victoire avec un deck 100% Lumiere ✨', goal: [1], credits: 300, xp: 50, track: 'special_element_light', validation: { type: 'element_deck', element: 'lumiere' } },
  { key: 'no_abilities', label: 'Victoire sans utiliser de capacites ❌', goal: [1], credits: 500, xp: 60, track: 'special_no_ability', validation: { type: 'no_abilities' } },
  { key: 'speed_8', label: 'Victoire en moins de 8 tours ⚡', goal: [1], credits: 200, xp: 40, track: 'special_speed', validation: { type: 'max_turns', turns: 8 } },
];

// ============================================
// GUILD SYSTEM
// ============================================
const GUILD_CONFIG = {
  create_cost: 500,
  max_members: 20,
  boss: { max_hp: 10000, attacks_per_day: 1 },
  donate_min: 50,
  donate_max: 5000
};

function ensureGuildBoss(guildId) {
  const week = getISOWeek(new Date());
  let boss = db.prepare('SELECT * FROM guild_boss WHERE guild_id = ?').get(guildId);
  if (!boss || boss.week_key !== week) {
    // Distribute rewards if boss was killed last week
    if (boss && boss.boss_hp <= 0 && !boss.rewards_distributed) {
      distributeGuildBossRewards(guildId);
    }
    db.prepare('DELETE FROM guild_boss WHERE guild_id = ?').run(guildId);
    db.prepare('INSERT INTO guild_boss (guild_id, boss_hp, boss_max_hp, boss_name, week_key) VALUES (?, ?, ?, ?, ?)')
      .run(guildId, GUILD_CONFIG.boss.max_hp, GUILD_CONFIG.boss.max_hp, 'Dragon Ancestral', week);
    // Reset all member boss attacks for new week
    db.prepare("UPDATE guild_members SET last_boss_attack = '' WHERE guild_id = ?").run(guildId);
    boss = db.prepare('SELECT * FROM guild_boss WHERE guild_id = ?').get(guildId);
  }
  return boss;
}

function distributeGuildBossRewards(guildId) {
  const members = db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?').all(guildId);
  const reward = 500;
  for (const m of members) {
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(reward, m.user_id);
    // Give a random rare card
    const rareCard = db.prepare("SELECT id FROM cards WHERE rarity = 'rare' ORDER BY RANDOM() LIMIT 1").get();
    if (rareCard) {
      db.prepare('INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)').run(m.user_id, rareCard.id);
    }
  }
  db.prepare('UPDATE guild_boss SET rewards_distributed = 1 WHERE guild_id = ?').run(guildId);
}

// ============================================
// QUETES JOURNALIERES / HEBDOMADAIRES
// ============================================
const QUEST_POOL = {
  daily: [
    { key: 'open_boosters',  label: 'Ouvre {goal} booster(s)',        goal: [1,2,3], credits: 150, xp: 30, track: 'booster_open' },
    { key: 'win_combat',     label: 'Gagne {goal} combat(s)',         goal: [1,2],   credits: 200, xp: 40, track: 'combat_win' },
    { key: 'mine_diamonds',  label: 'Mine {goal} diamant(s)',         goal: [3,5,8], credits: 150, xp: 25, track: 'diamond_mine' },
    { key: 'do_fusions',     label: 'Fais {goal} fusion(s)',          goal: [1,2],   credits: 100, xp: 20, track: 'fusion' },
    { key: 'earn_credits',   label: 'Gagne {goal} credits',          goal: [500,1000], credits: 200, xp: 35, track: 'credits_earned' },
    { key: 'claim_daily',    label: 'Recupere ton bonus du jour',    goal: [1],     credits: 50,  xp: 15, track: 'daily_claim' },
    { key: 'play_casino',    label: 'Joue {goal} fois au casino',    goal: [1,3],   credits: 100, xp: 20, track: 'casino_spin' },
    { key: 'spend_energy',   label: 'Depense {goal} energie',         goal: [30,50], credits: 100, xp: 20, track: 'energy_spent' },
    { key: 'craft_item',     label: 'Fabrique {goal} objet(s)',       goal: [1,2],   credits: 150, xp: 25, track: 'craft' },
  ],
  weekly: [
    { key: 'open_boosters_w', label: 'Ouvre {goal} boosters',        goal: [10,15], credits: 500, xp: 100, track: 'booster_open' },
    { key: 'win_combat_w',    label: 'Gagne {goal} combats',         goal: [5,10],  credits: 600, xp: 120, track: 'combat_win' },
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
  { key: 'first_combat_win', label: 'Premiere Victoire',     desc: '1 victoire combat',   icon: '⚔',  check: (s) => s.pvpWins >= 1,         credits: 100 },
  { key: 'combat_10',       label: 'Gladiateur',             desc: '10 victoires combat', icon: '🏆', check: (s) => s.pvpWins >= 10,        credits: 500 },
  { key: 'combat_50',       label: 'Champion',               desc: '50 victoires combat', icon: '🥇', check: (s) => s.pvpWins >= 50,        credits: 1500 },
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
  // Craft
  { key: 'crafter_first',  label: 'Artisan',                 desc: '1er objet fabrique',  icon: '🔨', check: (s) => s.crafts >= 1,          credits: 100 },
  { key: 'crafter_10',     label: 'Maitre Artisan',          desc: '10 objets fabriques', icon: '⚒',  check: (s) => s.crafts >= 10,         credits: 500 },
  // Awakening
  { key: 'awakening_first',label: 'Eveille',                 desc: '1ere carte eveillee', icon: '⭐', check: (s) => s.awakenings >= 1,      credits: 300 },
  // Guild
  { key: 'guild_joined',   label: 'Coequipier',              desc: 'Rejoins une guilde',  icon: '🏰', check: (s) => s.inGuild,              credits: 100 },
];

// ============================================
// CASINO
// ============================================
const CASINO_COST = 200;

// --- PROFILE FRAMES ---
const PROFILE_FRAMES = {
  none:    { label: 'Aucun',       css: '',              emoji: '⬜' },
  flames:  { label: 'Flammes',     css: 'frame-flames',  emoji: '🔥' },
  glitch:  { label: 'Glitch',      css: 'frame-glitch',  emoji: '📺' },
  rainbow: { label: 'Arc-en-ciel', css: 'frame-rainbow', emoji: '🌈' },
  neon:    { label: 'Neon',        css: 'frame-neon',     emoji: '💡' },
  frost:   { label: 'Givre',       css: 'frame-frost',    emoji: '❄' },
  skull:   { label: 'Crane',       css: 'frame-skull',    emoji: '💀' },
  diamond: { label: 'Diamant',     css: 'frame-diamond',  emoji: '💎' },
};

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

  // Assign 1 special daily challenge
  const specialCount = db.prepare('SELECT COUNT(*) as c FROM user_quests WHERE user_id = ? AND type = ? AND assigned_date = ?').get(userId, 'special', today).c;
  if (specialCount === 0 && SPECIAL_CHALLENGE_POOL.length > 0) {
    const challenge = SPECIAL_CHALLENGE_POOL[Math.floor(Math.random() * SPECIAL_CHALLENGE_POOL.length)];
    const goal = challenge.goal[Math.floor(Math.random() * challenge.goal.length)];
    db.prepare('INSERT OR IGNORE INTO user_quests (user_id, quest_key, type, goal, reward_credits, reward_xp, assigned_date) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, challenge.key, 'special', goal, challenge.credits, challenge.xp, today);
  }
}

function updateQuestProgress(userId, trackKey, amount = 1) {
  const today = new Date().toISOString().split('T')[0];
  const week = getISOWeek(new Date());

  // Find all active quests matching this trackKey
  const allQuestDefs = [...QUEST_POOL.daily, ...QUEST_POOL.weekly, ...SPECIAL_CHALLENGE_POOL];
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
  const user = db.prepare('SELECT credits, stat_boosters_opened, stat_pvp_wins, stat_diamonds_mined, stat_fusions, stat_casino_spins, stat_credits_spent, stat_crafts, stat_awakenings, guild_id FROM users WHERE id = ?').get(userId);
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
    bpTier: bp?.current_tier || 0,
    crafts: user?.stat_crafts || 0,
    awakenings: user?.stat_awakenings || 0,
    inGuild: !!(user?.guild_id)
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

function generateMineRocks(extraStone = 0, luckLevel = 0) {
  const numRocks = BASE_ROCKS + extraStone;
  const rocks = [];

  // Ajuster les poids selon la chance
  const weights = {};
  const luckBonus = luckLevel * 3;
  for (const [key, data] of Object.entries(MINE_RESOURCES)) {
    if (key === 'charbon') {
      weights[key] = Math.max(data.weight - luckBonus * 2, 15);
    } else {
      weights[key] = data.weight + luckBonus;
    }
  }
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);

  for (let i = 0; i < numRocks; i++) {
    let roll = Math.random() * totalWeight;
    let mineral = 'charbon';
    for (const [key, w] of Object.entries(weights)) {
      roll -= w;
      if (roll <= 0) { mineral = key; break; }
    }
    rocks.push({ id: i, mined: false, mineral });
  }

  return rocks;
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

function getMineCooldown(userId) {
  const upgrades = getMineUpgrades(userId);
  // -2 min par niveau de faster_restock (inventory_size column)
  return Math.max(120, MINE_COOLDOWN - upgrades.inventory_size * 120);
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
  'Spores nocives':     { type: 'poison_dot',         damage: 1, turns: 2 },  // Champignon
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
  'Combustion lente':   { type: 'poison_dot',         damage: 1, turns: 2 },  // Charbon
  'Ecaille de braise':  { type: 'buff_def',          value: 2 },   // Lezard
  'Eruption mineure':   { type: 'direct_damage',     value: 2 },   // Volcanologue
  'Suie aveuglante':    { type: 'debuff_atk',        value: 2 },   // Charbonnier
  'Etincelle vive':     { type: 'first_turn_damage', value: 2 },   // Etincelle
  'Morsure de flamme':  { type: 'poison_dot',         damage: 1, turns: 2 },  // Chien de feu
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
  'Dague empoisonnee':  { type: 'poison_dot',         damage: 1, turns: 2 },  // Assassin novice
  'Mucus toxique':      { type: 'debuff_atk',        value: 2 },   // Crapaud sombre
  'Effroi':             { type: 'stun',              damage: 0 },  // Ectoplasme
  'Morsure vorace':     { type: 'drain',             damage: 2, heal: 1 },  // Goule
  'Fils invisibles':    { type: 'stun',              damage: 0 },  // Marionnette
  'Venin nocturne':     { type: 'poison_dot',         damage: 1, turns: 2 },  // Serpent venimeux
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
  'Appel gobelin':      { type: 'summon_one_token',   token: { name: 'Goblin', atk: 1, def: 1, hp: 2 } },   // Goblin — invoque 1 token Goblin
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
  'Aura de flamme':     { type: 'dot_aoe', damage: 1, duration: 2 },  // Phoenix — brule tous les ennemis 2 tours
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
  'Mur infranchissable':  { type: 'buff_def_lasting', value: 2 },               // Sentinelle de Pierre
  'Malediction mineure':  { type: 'debuff_atk',       value: 1 },               // Acolyte de l Ombre
  'Brasier guerisseur':   { type: 'combo',  effects: [{ effect: 'damage', value: 2 }, { effect: 'heal_ally', value: 2 }] },       // Chaman des Cendres
  'Toucher givre':        { type: 'combo',  effects: [{ effect: 'stun', duration: 1 }, { effect: 'damage', value: 1 }] },          // Spectre Glacial
  'Frappe fatale':        { type: 'execute_pct', threshold: 50, executeDamage: 5, damage: 2 },  // Assassin Nocturne (x2 si <= 50% HP)
  'Tsunami devastateur':  { type: 'combo',  effects: [{ effect: 'aoe_damage', value: 2 }, { effect: 'debuff_def_all', value: 1 }] }, // Dragon des Abysses
  'Aegis divin':          { type: 'combo',  effects: [{ effect: 'team_heal', value: 2 }, { effect: 'shield', value: 2 }] },        // Paladin Sacre
  'Souffle du Yomi':      { type: 'combo',  effects: [{ effect: 'aoe_debuff', value: 1 }, { effect: 'debuff_def_all', value: 1 }, { effect: 'reap', threshold: 2 }] }, // Izanami
  'Effondrement cosmique': { type: 'apocalypse' },                              // Le Neant Originel (detruit tout + degats directs)
  'Sacrifice radieux':    { type: 'delayed_sacrifice', directDamage: 5 },       // Lumis (suicide + 5 degats joueur)

  // ===== NOUVELLES CARTES v1.5.0 =====
  'Morsure infectee':     { type: 'combo', effects: [{ effect: 'damage', value: 2 }, { effect: 'poison', value: 2 }] },              // Rat des Egouts (poison 2 tours)
  'Meditation interieure': { type: 'combo', effects: [{ effect: 'heal', value: 2 }, { effect: 'buff_def_lasting', value: 1 }] },     // Moine Errant
  'Infiltration':         { type: 'draw_card', value: 1 },                              // Espion des Brumes (pioche 1 carte)
  'Spores':               { type: 'poison_all', damage: 1, turns: 1 },                   // Champignon Toxique (poison tous ennemis 1 tour)
  'Jugement guerrier':    { type: 'combo', effects: [{ effect: 'damage', value: 3 }, { effect: 'heal_on_kill', value: 3 }] },        // Valkyrie Dechue
  'Transmutation':        { type: 'transfer_hp_to_atk', hpCost: 2, atkGain: 2, target: 'ally' },  // Alchimiste Fou
  'Copie':                { type: 'copy_stats' },                                       // Ombre Mimetique (copie ATK/DEF d'une carte)
  'Souffle tri-elementaire': { type: 'direct_damage_ignore_def', value: 3 },              // Chimere Elementaire (ignore resistances)
  'Distorsion temporelle': { type: 'undo_last_action' },                                // Oracle du Temps (annule debuffs allies + buffs ennemis)
  'Recif vivant':         { type: 'summon_token', token: { name: 'Corail', atk: 0, def: 2, hp: 2 } },  // Colosse de Corail
  'Boucle temporelle':    { type: 'reset_all_stats' },                                  // Chronos (reinitialise toutes les cartes)
  'Maree montante':       { type: 'combo', effects: [{ effect: 'aoe_damage', value: 2 }, { effect: 'stun_all', duration: 1 }] },     // Abyssia
  'Lancer divin':         { type: 'dice_roll', outcomes: { 1: 'self_kill', 2: 'nothing', 3: { type: 'buff_atk', value: 3 }, 4: { type: 'aoe_damage', value: 3 }, 5: { type: 'heal_all', value: 4 }, 6: 'kill_random_enemy' } },  // Le De du Destin

  // ===== NOUVELLES CARTES v0.2.3 =====
  'Digestion':              { type: 'drain', damage: 2, heal: 2 },                              // Plante Carnivore
  'Pillage':                { type: 'steal_atk', value: 1 },                                    // Mouette Pirate
  'Forge ardente':          { type: 'combo', effects: [{ effect: 'buff_ally_def', value: 2 }, { effect: 'buff_atk', value: 1 }] },  // Forgeron Nain
  'Cocktail Molotov':       { type: 'aoe_damage_self', aoeDamage: 2, selfDamage: 1 },           // Pyromane
  'Reflet parfait':         { type: 'reflect_all', duration: 1 },                               // Golem de Miroir
  'Morsure triple':         { type: 'random_damage_poison', hits: 3, damage: 2, poisonTurns: 2 },  // Hydre Venimeuse
  'Fils du marionnettiste': { type: 'swap_card', duration: 3 },                                 // Marionnettiste
  'Jugement final':         { type: 'combo', effects: [{ effect: 'revive_ally', hpPercent: 0.5 }, { effect: 'damage', value: 3 }] },  // Anubis
  'Benediction mondiale':   { type: 'combo', effects: [{ effect: 'team_heal', value: 3 }, { effect: 'cleanse_all' }] },  // Yggdrasil
  'Infection':              { type: 'infect', dot: 1, duration: 3 },                            // Le Parasite

  // ===== NOUVELLES CARTES v0.2.4 =====
  'Pincement':              { type: 'damage_debuff_def', damage: 1, defDebuff: 1 },             // Crabe Blinde
  'Carapace piegee':        { type: 'sacrifice_aoe_def' },                                      // Tortue Bombe
  'Lien vital':             { type: 'link_enemies', duration: 3 },                              // Tisseuse d Ames

  // ===== CARTE SECRET - Pines =====
  'Emprise des Pins':       { type: 'force_deploy' },                                          // Pines (choisir carte adverse a deployer)
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
  'Empoisonnement':  { target: 'enemy',       type: 'poison',             value: 3 },
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
  const awLvl = card.awakening_level || 0;
  let awAtk = 0, awDef = 0, awHp = 0;
  for (let i = 0; i < awLvl && i < AWAKENING_CONFIG.length; i++) {
    awAtk += AWAKENING_CONFIG[i].bonuses.attack;
    awDef += AWAKENING_CONFIG[i].bonuses.defense;
    awHp += AWAKENING_CONFIG[i].bonuses.hp;
  }
  return {
    attack: card.attack * mult + awAtk,
    defense: card.defense * mult + awDef,
    hp: card.hp * mult + awHp,
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

  // Passif Louveteau Sauvage : +1 ATK si un autre allie Bete est sur le terrain
  if (attacker.name === 'Louveteau Sauvage' && attackerField) {
    const otherBetes = attackerField.filter(u => u && u.alive && u.type === 'bete' && u !== attacker).length;
    if (otherBetes > 0) atkVal += 1;
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
function applyDamage(target, damage, events, source, battle, isLinkedDamage) {
  // Passif Pines : immunise aux degats des cartes Terre
  if (target.name === 'Pines' && source && hasElement(source, 'terre')) {
    events.push({ type: 'type_passive', desc: `${target.name} 🌲 est immunise aux degats Terre !` });
    return;
  }
  // Track last attacker for death-trigger passives (Rat des Egouts)
  if (source && source.name) target.lastAttacker = source.name;
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

  // Passif Golem de Miroir : renvoie 1 degat permanent aux attaquants
  if (target.alive && target.currentHp > 0 && target.name === 'Golem de Miroir' && source && source.alive) {
    source.currentHp = Math.max(0, source.currentHp - 1);
    events.push({ type: 'type_passive', desc: `${target.name} renvoie 1 degat a ${source.name} !` });
    if (source.currentHp <= 0) checkKO(source, events, battle);
  }

  // Reflect (Reflet parfait) : renvoie un % des degats
  if (target.alive && target.currentHp > 0 && (target.reflectDamage || 0) > 0 && source && source.alive) {
    const reflected = Math.max(1, Math.floor(remaining * target.reflectDamage));
    source.currentHp = Math.max(0, source.currentHp - reflected);
    events.push({ type: 'type_passive', desc: `${target.name} renvoie ${reflected} degats a ${source.name} !` });
    if (source.currentHp <= 0) checkKO(source, events, battle);
  }

  // Passif Hydre Venimeuse : empoisonne l'attaquant
  if (target.alive && target.currentHp > 0 && target.name === 'Hydre Venimeuse' && source && source.alive) {
    source.poisonDot = 1;
    source.poisonDotTurns = Math.max(source.poisonDotTurns || 0, 2);
    events.push({ type: 'type_passive', desc: `${target.name} empoisonne ${source.name} ! Poison pendant 2 tours` });
  }

  // Passif Crabe Blinde : +1 DEF quand attaque (max 3 stacks)
  if (target.alive && target.currentHp > 0 && target.name === 'Crabe Blinde' && (target.crabDefStacks || 0) < 3) {
    target.permanentBonusDef = (target.permanentBonusDef || 0) + 1;
    target.crabDefStacks = (target.crabDefStacks || 0) + 1;
    events.push({ type: 'type_passive', desc: `Crabe Blinde se renforce ! +1 DEF (${target.crabDefStacks}/3)` });
  }

  // Lien vital : l'ennemi lie subit les memes degats
  if (!isLinkedDamage && target.linkedTo && battle) {
    const allUnits = [...(battle.playerField || []), ...(battle.enemyField || [])];
    const linked = allUnits.find(u => u && u.alive && u.name === target.linkedTo);
    if (linked) {
      const linkedDmg = Math.max(0, damage - (target.shield || 0));
      if (linkedDmg > 0) {
        applyDamage(linked, linkedDmg, events, source, battle, true);
        events.push({ type: 'type_passive', desc: `Lien vital : ${linked.name} subit ${linkedDmg} degats !` });
      }
    }
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

function createBattleState(playerCards, enemyCards, battleType) {
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
      // Poison standardise : 1 degat/tour pendant N tours
      const target = pickTarget();
      if (target) {
        if (target.name === 'Chronos') {
          events.push({ type: 'type_passive', desc: `${target.name} est immunise au poison !` });
        } else {
          target.poisonDot = 1;
          target.poisonDotTurns = Math.max(target.poisonDotTurns || 0, ability.turns);
          events.push({ type: 'ability_poison', unit: unit.name, target: target.name, ability: abilityName, desc: `Applique poison pendant ${ability.turns} tours` });
        }
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
      const earthAllies = allAllies.filter(a => a.alive && hasElement(a, ability.element) && a !== unit).length;
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
        // Passif Titan Originel / Chronos : immunise aux effets de controle
        if (target.name === 'Titan Originel' || target.name === 'Chronos') {
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
      // Degats bonus uniquement a la premiere utilisation (embuscade)
      if (!unit.usedFirstTurnAbility) {
        unit.usedFirstTurnAbility = true;
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
        if (target.name === 'Chronos') {
          events.push({ type: 'type_passive', desc: `${target.name} est immunise au poison !` });
        } else {
          const turns = ability.turns || ability.damage || 2;
          target.poisonDot = 1;
          target.poisonDotTurns = Math.max(target.poisonDotTurns || 0, turns);
          events.push({ type: 'ability_poison', unit: unit.name, target: target.name, ability: abilityName, desc: `Applique poison pendant ${turns} tours` });
        }
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
    case 'dot_aoe': {
      // Phoenix : applique un burn AoE a tous les ennemis
      const targets = allEnemies.filter(e => e.alive);
      targets.forEach(e => {
        e.burnAoe = { damage: ability.damage, turnsLeft: ability.duration, source: unit.name };
      });
      if (targets.length > 0) {
        events.push({ type: 'ability_aoe', unit: unit.name, ability: abilityName, desc: `Aura de flamme ! ${targets.length} ennemi(s) brulent (${ability.damage} degat/tour, ${ability.duration} tours)` });
      } else {
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Aucun ennemi a bruler !' });
      }
      break;
    }
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
      if (target && target.name === 'Chronos') {
        events.push({ type: 'type_passive', desc: `${target.name} est immunise au silence !` });
      } else if (target && !target.silenced) {
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
      // Sentinelle de Pierre : taunt (les ennemis doivent l'attaquer en priorite)
      if (unit.name === 'Sentinelle de Pierre') {
        unit.taunt = true;
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `${unit.name} provoque les ennemis ! (taunt)` });
      }
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
    // ===== NOUVELLES ABILITIES v1.4.0 =====
    case 'execute_pct': {
      // Assassin Nocturne : x2 degats si cible <= X% HP
      const target = pickTarget();
      if (target) {
        const hpPercent = target.currentHp / target.maxHp;
        const isLow = hpPercent <= (ability.threshold / 100);
        const dmg = scaleDmg(isLow ? ability.executeDamage : ability.damage);
        applyDamage(target, dmg, events, unit, battle);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg, desc: isLow ? 'Frappe fatale ! Degats doubles !' : '' });
      }
      break;
    }
    case 'apocalypse': {
      // Le Neant Originel : detruit tout sur le terrain
      const allUnits = [...allAllies.filter(a => a.alive && a !== unit), ...allEnemies.filter(e => e.alive)];
      allUnits.forEach(u => {
        u.currentHp = 0;
        checkKO(u, events, battle);
      });
      unit.currentHp = 0;
      events.push({ type: 'ability_aoe', unit: unit.name, ability: abilityName, desc: 'Effondrement cosmique ! Tout est detruit !' });
      checkKO(unit, events, battle);
      break;
    }
    case 'delayed_sacrifice': {
      // Lumis : sacrifice + degats directs ignoring DEF
      const target = pickTarget();
      if (target) {
        const dmg = scaleDmg(ability.directDamage);
        target.currentHp = Math.max(0, target.currentHp - dmg);
        events.push({ type: 'ability_damage', unit: unit.name, target: target.name, ability: abilityName, damage: dmg, desc: `Sacrifice radieux ! ${dmg} degats directs !` });
        if (target.currentHp <= 0) checkKO(target, events, battle);
      }
      unit.currentHp = 0;
      events.push({ type: 'ability_sacrifice', unit: unit.name, ability: abilityName, desc: `${unit.name} se sacrifie !` });
      checkKO(unit, events, battle);
      break;
    }
    // ===== NOUVELLES ABILITIES v1.5.0 =====
    case 'draw_card': {
      // Espion des Brumes : pioche 1 carte du deck
      if (battle && battle.isDeckBattle) {
        const deck = unit.side === 'player' ? battle.playerDeck : battle.enemyDeck;
        const hand = unit.side === 'player' ? battle.playerHand : battle.enemyHand;
        if (deck && deck.length > 0 && hand) {
          const drawn = deck.shift();
          hand.push(drawn);
          events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Pioche ${drawn.name} !` });
        } else {
          events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Pas de carte a piocher !' });
        }
      } else {
        unit.buffAtk += ability.value;
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${ability.value} ATK (renseignement)` });
      }
      break;
    }
    case 'poison_all': {
      // Champignon Toxique : empoisonne tous les ennemis (sauf immunises)
      const turns = ability.turns || 1;
      allEnemies.filter(e => e.alive).forEach(e => {
        if (e.name === 'Chronos') return; // immunise
        e.poisonDot = 1;
        e.poisonDotTurns = Math.max(e.poisonDotTurns || 0, turns);
      });
      events.push({ type: 'ability_poison', unit: unit.name, ability: abilityName, desc: `Spores ! Tous les ennemis empoisonnes pendant ${turns} tour(s)` });
      break;
    }
    case 'transfer_hp_to_atk': {
      // Alchimiste Fou : perd HP, allie gagne ATK
      const ally = ability.target === 'ally' ? (weakestAlly() || unit) : unit;
      unit.currentHp = Math.max(1, unit.currentHp - ability.hpCost);
      ally.buffAtk += ability.atkGain;
      // Track boosted ally for Alchimiste Fou passive (heal if boosted ally kills)
      if (unit.name === 'Alchimiste Fou' && ally !== unit) {
        ally.boostedByAlchimiste = unit;
      }
      events.push({ type: 'ability', unit: unit.name, target: ally.name, ability: abilityName, desc: `Transmutation ! -${ability.hpCost} PV, ${ally.name} +${ability.atkGain} ATK` });
      break;
    }
    case 'copy_stats': {
      // Ombre Mimetique : copie ATK/DEF d'une cible
      const target = pickTarget();
      if (target) {
        const tAtk = (target.effectiveStats?.attack || target.attack || 0) + (target.buffAtk || 0) + (target.permanentBonusAtk || 0);
        const tDef = (target.effectiveStats?.defense || target.defense || 0) + (target.buffDef || 0) + (target.permanentBonusDef || 0);
        const uAtk = (unit.effectiveStats?.attack || unit.attack || 0) + (unit.buffAtk || 0) + (unit.permanentBonusAtk || 0);
        const uDef = (unit.effectiveStats?.defense || unit.defense || 0) + (unit.buffDef || 0) + (unit.permanentBonusDef || 0);
        unit.buffAtk += (tAtk - uAtk);
        unit.buffDef += (tDef - uDef);
        events.push({ type: 'ability', unit: unit.name, target: target.name, ability: abilityName, desc: `Copie ${target.name} ! ATK=${tAtk}, DEF=${tDef}` });
      }
      break;
    }
    case 'undo_last_action': {
      // Oracle du Temps : annule debuffs allies et buffs ennemis
      allAllies.filter(a => a.alive).forEach(a => {
        if (a.buffAtk < 0) a.buffAtk = 0;
        if (a.buffDef < 0) a.buffDef = 0;
        a.stunned = false;
        a.poisonDot = 0;
        a.poisonDotTurns = 0;
      });
      allEnemies.filter(e => e.alive).forEach(e => {
        if (e.buffAtk > 0) e.buffAtk = 0;
        if (e.buffDef > 0) e.buffDef = 0;
      });
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Distorsion temporelle ! Buffs ennemis et debuffs allies annules !' });
      break;
    }
    case 'summon_token': {
      // Colosse de Corail : invoque un token sur CHAQUE slot vide
      if (battle && battle.isDeckBattle) {
        const field = unit.side === 'player' ? battle.playerField : battle.enemyField;
        let summoned = 0;
        for (let si = 0; si < field.length; si++) {
          if (field[si] === null || (field[si] && !field[si].alive)) {
            const token = {
              name: ability.token.name, emoji: '🪸',
              attack: ability.token.atk, defense: ability.token.def,
              hp: ability.token.hp, currentHp: ability.token.hp, maxHp: ability.token.hp,
              alive: true, side: unit.side, ability_name: null, usedAbility: true,
              buffAtk: 0, buffDef: 0, permanentBonusAtk: 0, permanentBonusDef: 0,
              element: unit.element, type: unit.type, isToken: true, taunt: true,
              effectiveStats: { attack: ability.token.atk, defense: ability.token.def }
            };
            field[si] = token;
            summoned++;
          }
        }
        if (summoned > 0) {
          events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Invoque ${summoned} ${ability.token.name}(s) avec taunt !` });
        } else {
          events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Pas de place pour invoquer !' });
        }
      } else {
        unit.shield = (unit.shield || 0) + ability.token.def;
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Recif protecteur ! Bouclier +${ability.token.def}` });
      }
      break;
    }
    case 'summon_one_token': {
      // Goblin : invoque UN token sur le premier slot vide
      if (battle && battle.isDeckBattle) {
        const field = unit.side === 'player' ? battle.playerField : battle.enemyField;
        let summoned = false;
        for (let si = 0; si < field.length; si++) {
          if (field[si] === null || (field[si] && !field[si].alive)) {
            const token = {
              name: ability.token.name, emoji: '🗡️',
              attack: ability.token.atk, defense: ability.token.def,
              hp: ability.token.hp, currentHp: ability.token.hp, maxHp: ability.token.hp,
              alive: true, side: unit.side, ability_name: null, usedAbility: true,
              buffAtk: 0, buffDef: 0, permanentBonusAtk: 0, permanentBonusDef: 0,
              element: 'terre', type: 'creature', isToken: true, taunt: false,
              justDeployed: true,
              effectiveStats: { attack: ability.token.atk, defense: ability.token.def }
            };
            field[si] = token;
            summoned = true;
            break;
          }
        }
        if (summoned) {
          events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Invoque un ${ability.token.name} !` });
        } else {
          events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Pas de place pour invoquer !' });
        }
      } else {
        // Fallback non-deck battle
        unit.buffAtk += 1;
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: '+1 ATK (renfort gobelin)' });
      }
      break;
    }
    case 'reset_all_stats': {
      // Chronos : reinitialise tous les buffs/debuffs
      const allUnits = [...allAllies.filter(a => a.alive), ...allEnemies.filter(e => e.alive)];
      allUnits.forEach(u => {
        u.buffAtk = 0; u.buffDef = 0;
        u.stunned = false; u.poisonDot = 0; u.poisonDotTurns = 0;
        u.shield = 0; u.marked = 0; u.silenced = false;
      });
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Boucle temporelle ! Toutes les stats reinitialises !' });
      break;
    }
    case 'dice_roll': {
      // Le De du Destin : lance un de, effet aleatoire
      const roll = Math.floor(Math.random() * 6) + 1;
      const outcome = ability.outcomes[roll];
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Lance le de... ${roll} !` });
      if (outcome === 'self_kill') {
        unit.currentHp = 0;
        events.push({ type: 'ability_damage', unit: unit.name, target: unit.name, ability: abilityName, desc: 'Le de maudit ! Auto-destruction !' });
        checkKO(unit, events, battle);
      } else if (outcome === 'nothing') {
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Rien ne se passe...' });
      } else if (outcome === 'kill_random_enemy') {
        const alive = allEnemies.filter(e => e.alive);
        if (alive.length > 0) {
          const t = alive[Math.floor(Math.random() * alive.length)];
          t.currentHp = 0;
          events.push({ type: 'ability_damage', unit: unit.name, target: t.name, ability: abilityName, desc: `Coup divin ! ${t.name} elimine !` });
          checkKO(t, events, battle);
        }
      } else if (typeof outcome === 'object') {
        if (outcome.type === 'buff_atk') {
          unit.buffAtk += outcome.value;
          events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `+${outcome.value} ATK !` });
        } else if (outcome.type === 'aoe_damage') {
          const dmg = scaleDmg(outcome.value);
          allEnemies.filter(e => e.alive).forEach(e => { applyDamage(e, dmg, events, unit, battle); });
          events.push({ type: 'ability_aoe', unit: unit.name, ability: abilityName, damage: dmg, desc: `Tempete divine ! ${dmg} degats a tous !` });
        } else if (outcome.type === 'heal_all') {
          allAllies.filter(a => a.alive).forEach(a => { a.currentHp = Math.min(a.maxHp, a.currentHp + outcome.value); });
          events.push({ type: 'ability_team_heal', unit: unit.name, ability: abilityName, heal: outcome.value, desc: `Benediction ! +${outcome.value} PV a tous !` });
        }
      }
      break;
    }
    // === NOUVELLES ABILITIES v0.2.3 ===
    case 'steal_atk': {
      // Mouette Pirate : vole ATK a un ennemi
      const target = pickTarget();
      if (target) {
        target.permanentBonusAtk = (target.permanentBonusAtk || 0) - ability.value;
        unit.permanentBonusAtk = (unit.permanentBonusAtk || 0) + ability.value;
        events.push({ type: 'ability', unit: unit.name, target: target.name, ability: abilityName, desc: `Vole ${ability.value} ATK a ${target.name} !` });
      }
      break;
    }
    case 'aoe_damage_self': {
      // Pyromane : AoE + self-damage
      const dmg = scaleDmg(ability.aoeDamage);
      allEnemies.filter(e => e.alive).forEach(e => {
        applyDamage(e, dmg, events, unit, battle);
        events.push({ type: 'ability_aoe', unit: unit.name, target: e.name, ability: abilityName, damage: dmg });
      });
      // Self-damage
      unit.currentHp = Math.max(0, unit.currentHp - ability.selfDamage);
      events.push({ type: 'ability_damage', unit: unit.name, target: unit.name, ability: abilityName, damage: ability.selfDamage, desc: `${unit.name} subit ${ability.selfDamage} degat(s) !` });
      if (unit.currentHp <= 0) checkKO(unit, events, battle);
      break;
    }
    case 'reflect_all': {
      // Golem de Miroir : reflect 100% des degats pendant N tours
      unit.reflectDamage = 1.0;
      unit.reflectTurns = ability.duration;
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Renvoie 100% des degats pendant ${ability.duration} tour(s) !` });
      break;
    }
    case 'random_damage_poison': {
      // Hydre Venimeuse : N hits random + poison
      for (let i = 0; i < ability.hits; i++) {
        const alive = allEnemies.filter(e => e.alive);
        if (alive.length === 0) break;
        const t = alive[Math.floor(Math.random() * alive.length)];
        const d = scaleDmg(ability.damage);
        applyDamage(t, d, events, unit, battle);
        if (t.name !== 'Chronos') {
          t.poisonDot = 1;
          t.poisonDotTurns = Math.max(t.poisonDotTurns || 0, ability.poisonTurns);
        }
        events.push({ type: 'ability_damage', unit: unit.name, target: t.name, ability: abilityName, damage: d, desc: `Morsure ${i + 1} ! ${d} degats + poison ${ability.poisonTurns} tours` });
      }
      break;
    }
    case 'swap_card': {
      // Marionnettiste : echange une carte alliee avec une carte ennemie
      const allyField = unit.side === 'player' ? battle.playerField : battle.enemyField;
      const enemyField = unit.side === 'player' ? battle.enemyField : battle.playerField;
      const swappableAllies = allyField.filter(u => u && u.alive && u !== unit && !u.swappedOriginalSide);
      const swappableEnemies = enemyField.filter(u => u && u.alive && !u.swappedOriginalSide);
      if (swappableAllies.length > 0 && swappableEnemies.length > 0) {
        const allyCard = swappableAllies[Math.floor(Math.random() * swappableAllies.length)];
        const enemyCard = swappableEnemies[Math.floor(Math.random() * swappableEnemies.length)];
        const allyIdx = allyField.indexOf(allyCard);
        const enemyIdx = enemyField.indexOf(enemyCard);
        // Save original sides
        allyCard.swappedOriginalSide = allyCard.side;
        enemyCard.swappedOriginalSide = enemyCard.side;
        // Swap sides
        allyCard.side = enemyCard.side === 'player' ? 'player' : 'enemy';
        enemyCard.side = allyCard.swappedOriginalSide;
        // Swap positions
        allyField[allyIdx] = enemyCard;
        enemyField[enemyIdx] = allyCard;
        // Set timers
        allyCard.swapTimer = ability.duration;
        enemyCard.swapTimer = ability.duration;
        // Marionnettiste debuff : -1 ATK aux cartes volees
        enemyCard.permanentBonusAtk = (enemyCard.permanentBonusAtk || 0) - 1;
        allyCard.permanentBonusAtk = (allyCard.permanentBonusAtk || 0) - 1;
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `${allyCard.name} et ${enemyCard.name} echanges pour ${ability.duration} tours ! (-1 ATK)` });
      } else {
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Pas assez de cibles pour l echange !' });
      }
      break;
    }
    case 'infect': {
      // Le Parasite : infecte un ennemi
      const target = pickTarget();
      if (target) {
        target.infectedDot = ability.dot;
        target.infectedDotTurns = ability.duration;
        events.push({ type: 'ability', unit: unit.name, target: target.name, ability: abilityName, desc: `${target.name} infecte ! (${ability.dot} degat/tour, ${ability.duration} tours)` });
      }
      break;
    }

    // === NOUVELLES ABILITIES v0.2.4 ===
    case 'damage_debuff_def': {
      // Crabe Blinde : 1 dmg + retire DEF permanent
      const target = pickTarget();
      if (target) {
        const dmg = scaleDmg(ability.damage);
        applyDamage(target, dmg, events, unit, battle);
        target.permanentBonusDef = Math.max(-(target.effectiveStats?.defense || 0), (target.permanentBonusDef || 0) - ability.defDebuff);
        events.push({ type: 'ability', unit: unit.name, target: target.name, ability: abilityName, desc: `${dmg} degats + ${target.name} perd ${ability.defDebuff} DEF permanent !` });
      }
      break;
    }
    case 'sacrifice_aoe_def': {
      // Tortue Bombe : DEF totale en AoE puis suicide
      const totalDef = (unit.effectiveStats?.defense || unit.defense || 0) + (unit.buffDef || 0) + (unit.permanentBonusDef || 0);
      const dmg = Math.max(1, totalDef);
      allEnemies.filter(e => e.alive).forEach(e => {
        applyDamage(e, dmg, events, unit, battle);
        events.push({ type: 'ability_aoe', unit: unit.name, target: e.name, ability: abilityName, damage: dmg });
      });
      events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `${unit.name} explose ! ${dmg} degats a tous les ennemis !` });
      unit.currentHp = 0;
      checkKO(unit, events, battle);
      break;
    }
    case 'link_enemies': {
      // Tisseuse d Ames : lie 2 ennemis
      const alive = allEnemies.filter(e => e.alive && !e.linkedTo);
      if (alive.length >= 2) {
        const t1 = alive[Math.floor(Math.random() * alive.length)];
        const remaining = alive.filter(e => e !== t1);
        const t2 = remaining[Math.floor(Math.random() * remaining.length)];
        t1.linkedTo = t2.name;
        t1.linkedTurns = ability.duration;
        t2.linkedTo = t1.name;
        t2.linkedTurns = ability.duration;
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `${t1.name} et ${t2.name} sont lies ! (${ability.duration} tours)` });
      } else if (alive.length === 1) {
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Pas assez de cibles pour le lien !' });
      }
      break;
    }

    case 'force_deploy': {
      // Pines : Emprise des Pins — montre la main ennemie, le joueur choisit quelle carte sera deployee
      const side = unit.side;
      const enemyHand = side === 'player' ? battle.enemyHand : battle.playerHand;
      const deployable = enemyHand.filter(c => c.type !== 'objet');
      if (deployable.length === 0) {
        events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'L\'adversaire n\'a aucune creature en main !' });
        unit.usedAbility = false; // Refund ability usage
      } else {
        // Mark that we're waiting for the player to pick which enemy card to force
        battle.forceDeployPending = {
          sourceSlot: unit.side === 'player' ? battle.playerField.indexOf(unit) : battle.enemyField.indexOf(unit),
          sourceSide: unit.side
        };
        // Send enemy hand info for the picker
        const enemyHandInfo = enemyHand.map((c, i) => ({
          index: i,
          name: c.name,
          emoji: c.emoji,
          attack: c.attack,
          defense: c.defense,
          hp: c.hp,
          mana_cost: c.mana_cost,
          type: c.type,
          element: c.element
        }));
        events.push({
          type: 'force_deploy_pick',
          unit: unit.name,
          ability: abilityName,
          enemyHand: enemyHandInfo,
          desc: `${unit.name} 🌲 utilise Emprise des Pins ! Choisissez la carte adverse a forcer.`
        });
        // Don't consume crystal yet — will be consumed when pick is confirmed
        unit.usedAbility = false; // Will be set true when pick is made
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
            if (t) {
              if (t.name === 'Chronos') {
                events.push({ type: 'type_passive', desc: `${t.name} est immunise au poison !` });
              } else {
                const turns = fx.value || 2;
                t.poisonDot = 1;
                t.poisonDotTurns = Math.max(t.poisonDotTurns || 0, turns);
                events.push({ type: 'ability_poison', unit: unit.name, target: t.name, ability: abilityName, desc: `Applique poison pendant ${turns} tours` });
              }
            }
            break;
          }
          case 'revive':
            unit.canRevive = true;
            events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `Revient avec ${fx.value} PV` });
            break;
          case 'heal_ally': {
            const ally = allAllies.filter(a => a.alive && a !== unit).sort((a, b) => a.currentHp - b.currentHp)[0];
            if (ally) {
              ally.currentHp = Math.min(ally.maxHp, ally.currentHp + fx.value);
              events.push({ type: 'ability_heal', unit: unit.name, target: ally.name, ability: abilityName, heal: fx.value });
            } else {
              unit.currentHp = Math.min(unit.maxHp, unit.currentHp + fx.value);
              events.push({ type: 'ability_heal', unit: unit.name, target: unit.name, ability: abilityName, heal: fx.value });
            }
            break;
          }
          case 'debuff_def_all':
            allEnemies.filter(e => e.alive).forEach(e => { e.buffDef -= fx.value; });
            events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `-${fx.value} DEF a tous les ennemis` });
            break;
          case 'stun_all':
            allEnemies.filter(e => e.alive).forEach(e => {
              if (e.name !== 'Titan Originel') e.stunned = true;
            });
            events.push({ type: 'ability_stun', unit: unit.name, ability: abilityName, desc: 'Tous les ennemis etourdis !' });
            break;
          case 'reap': {
            const t = pickTarget();
            if (t && t.currentHp <= fx.threshold) {
              t.currentHp = 0;
              events.push({ type: 'ability_damage', unit: unit.name, target: t.name, ability: abilityName, desc: `Fauche ! ${t.name} elimine !` });
              checkKO(t, events, battle);
            } else if (t) {
              events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `${t.name} a trop de PV pour etre fauche` });
            }
            break;
          }
          case 'heal_on_kill': {
            const anyDead = allEnemies.some(e => !e.alive);
            if (anyDead) {
              unit.currentHp = Math.min(unit.maxHp, unit.currentHp + fx.value);
              events.push({ type: 'ability_heal', unit: unit.name, target: unit.name, ability: abilityName, heal: fx.value, desc: 'Guerison par execution !' });
            }
            break;
          }
          case 'buff_def_lasting': {
            const ally = allAllies.filter(a => a.alive && a !== unit)[0] || unit;
            ally.permanentBonusDef = (ally.permanentBonusDef || 0) + fx.value;
            events.push({ type: 'ability', unit: unit.name, target: ally.name, ability: abilityName, desc: `+${fx.value} DEF permanent a ${ally.name}` });
            break;
          }
          case 'buff_ally_def': {
            // Forgeron Nain : buff DEF d un allie
            const ally = allAllies.filter(a => a.alive && a !== unit).sort((a, b) => a.currentHp - b.currentHp)[0];
            if (ally) {
              ally.permanentBonusDef = (ally.permanentBonusDef || 0) + fx.value;
              events.push({ type: 'ability', unit: unit.name, target: ally.name, ability: abilityName, desc: `+${fx.value} DEF permanent a ${ally.name}` });
            } else {
              unit.permanentBonusDef = (unit.permanentBonusDef || 0) + fx.value;
              events.push({ type: 'ability', unit: unit.name, target: unit.name, ability: abilityName, desc: `+${fx.value} DEF permanent a ${unit.name}` });
            }
            break;
          }
          case 'revive_ally': {
            // Anubis : ressuscite un allie mort
            if (battle && battle.isDeckBattle) {
              const deadList = unit.side === 'player' ? battle.playerDeadAllies : battle.enemyDeadAllies;
              const field = unit.side === 'player' ? battle.playerField : battle.enemyField;
              const emptySlot = field.findIndex(s => s === null || (s && !s.alive));
              if (deadList && deadList.length > 0 && emptySlot !== -1) {
                const revived = deadList.pop();
                const reviveHp = Math.max(1, Math.floor(revived.maxHp * (fx.hpPercent || 0.5)));
                revived.currentHp = reviveHp;
                revived.alive = true;
                revived.stunned = false;
                revived.poisonDot = 0;
                revived.poisonDotTurns = 0;
                revived.usedAbility = false;
                revived.hasAttacked = false;
                revived.side = unit.side;
                field[emptySlot] = revived;
                events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: `${revived.name} ressuscite avec ${reviveHp} PV !` });
              } else {
                events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Aucun allie a ressusciter ou pas de place !' });
              }
            }
            break;
          }
          case 'cleanse_all': {
            // Yggdrasil : purifie tous les allies
            allAllies.filter(a => a.alive).forEach(a => {
              a.poisonDot = 0;
              a.poisonDotTurns = 0;
              a.stunned = false;
              a.marked = 0;
              a.infectedDot = 0;
              a.infectedDotTurns = 0;
            });
            events.push({ type: 'ability', unit: unit.name, ability: abilityName, desc: 'Purification ! Tous les effets negatifs retires !' });
            break;
          }
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
      // === PASSIFS DE MORT v1.4.0/v1.5.0 ===
      if (battle) {
        const getAllies = () => battle.isDeckBattle
          ? (unit.side === 'player' ? (battle.playerField || []).filter(u => u && u.alive) : (battle.enemyField || []).filter(u => u && u.alive))
          : ((unit.side === 'player' ? battle.playerTeam : battle.enemyTeam) || []).filter(u => u.alive);
        const getEnemies = () => battle.isDeckBattle
          ? (unit.side === 'player' ? (battle.enemyField || []).filter(u => u && u.alive) : (battle.playerField || []).filter(u => u && u.alive))
          : ((unit.side === 'player' ? battle.enemyTeam : battle.playerTeam) || []).filter(u => u.alive);

        // Rat des Egouts : empoisonne son tueur
        if (unit.name === 'Rat des Egouts' && unit.lastAttacker) {
          const killer = [...getAllies(), ...getEnemies()].find(u => u.name === unit.lastAttacker && u.alive);
          if (killer) {
            killer.poisonDot = 1;
            killer.poisonDotTurns = Math.max(killer.poisonDotTurns || 0, 2);
            events.push({ type: 'type_passive', desc: `${unit.name} empoisonne ${killer.name} en mourant ! Poison pendant 2 tours` });
          }
        }
        // Scarabee de Lave : explosion — 1 degat a tous les ennemis
        if (unit.name === 'Scarabee de Lave') {
          getEnemies().forEach(e => {
            e.currentHp = Math.max(0, e.currentHp - 1);
            if (e.currentHp <= 0 && e.alive) { e.alive = false; events.push({ type: 'ko', unit: e.name }); }
          });
          events.push({ type: 'type_passive', desc: `${unit.name} explose ! 1 degat a tous les ennemis !` });
        }
        // Paladin Sacre : +2 DEF permanent a l allie le plus faible
        if (unit.name === 'Paladin Sacre') {
          const allies = getAllies();
          if (allies.length > 0) {
            const weakest = allies.sort((a, b) => a.currentHp - b.currentHp)[0];
            weakest.permanentBonusDef = (weakest.permanentBonusDef || 0) + 2;
            events.push({ type: 'type_passive', desc: `${unit.name} tombe ! +2 DEF permanent a ${weakest.name}` });
          }
        }
        // Valkyrie Dechue : quand un ALLIE meurt, elle gagne +1 ATK
        // (trigger on any ally death for all alive Valkyries)
        getAllies().filter(a => a.name === 'Valkyrie Dechue' && a.alive).forEach(v => {
          v.permanentBonusAtk = (v.permanentBonusAtk || 0) + 1;
          events.push({ type: 'type_passive', desc: `${v.name} : vengeance ! +1 ATK permanent` });
        });
        // Izanami : quand un ENNEMI meurt, elle gagne +2 HP et +1 ATK permanent
        // (trigger for Izanami on the OTHER side)
        const izanamiSide = unit.side === 'player' ? 'enemy' : 'player';
        const izanamiField = battle.isDeckBattle
          ? (izanamiSide === 'player' ? battle.playerField : battle.enemyField)
          : (izanamiSide === 'player' ? battle.playerTeam : battle.enemyTeam);
        if (izanamiField) {
          (Array.isArray(izanamiField) ? izanamiField : []).filter(u => u && u.alive && u.name === 'Izanami').forEach(iz => {
            iz.currentHp = Math.min(iz.maxHp, iz.currentHp + 2);
            iz.permanentBonusAtk = (iz.permanentBonusAtk || 0) + 1;
            events.push({ type: 'type_passive', desc: `Izanami absorbe l ame de ${unit.name} ! +2 PV, +1 ATK` });
          });
        }
        // Abyssia : quand un allie Eau meurt, +2 ATK permanent
        if (hasElement(unit, 'eau')) {
          getAllies().filter(a => a.name === 'Abyssia' && a.alive).forEach(ab => {
            ab.permanentBonusAtk = (ab.permanentBonusAtk || 0) + 2;
            events.push({ type: 'type_passive', desc: `Abyssia : vague de colere ! +2 ATK permanent` });
          });
        }
        // Alchimiste Fou : si le tueur a ete booste par Transmutation, heal 2 PV
        if (unit.lastAttacker) {
          const killer = [...getAllies(), ...getEnemies()].find(u => u && u.alive && u.name === unit.lastAttacker);
          if (killer && killer.boostedByAlchimiste && killer.boostedByAlchimiste.alive) {
            const alch = killer.boostedByAlchimiste;
            alch.currentHp = Math.min(alch.maxHp, alch.currentHp + 2);
            events.push({ type: 'type_passive', desc: `Alchimiste Fou recupere 2 PV ! (${killer.name} a tue)` });
            killer.boostedByAlchimiste = null;
          }
        }

        // === PASSIFS MORT v0.2.3 ===
        // Pyromane : le tueur gagne +1 ATK permanent s'il est Pyromane
        if (unit.lastAttacker) {
          const killer = [...getAllies(), ...getEnemies()].find(u => u && u.alive && u.name === unit.lastAttacker);
          if (killer && killer.name === 'Pyromane') {
            killer.permanentBonusAtk = (killer.permanentBonusAtk || 0) + 1;
            events.push({ type: 'type_passive', desc: `Pyromane : +1 ATK permanent ! (kill bonus)` });
          }
        }
        // Anubis : quand un ALLIE meurt, Anubis gagne +1 ATK permanent
        getAllies().filter(a => a.name === 'Anubis' && a.alive).forEach(anubis => {
          anubis.permanentBonusAtk = (anubis.permanentBonusAtk || 0) + 1;
          events.push({ type: 'type_passive', desc: `Anubis : +1 ATK permanent (mort alliee)` });
        });
        // Infection spread : si un infecte meurt, propager a un allie vivant
        if ((unit.infectedDot || 0) > 0) {
          const allies = getAllies();
          const uninfected = allies.filter(a => (a.infectedDot || 0) === 0);
          if (uninfected.length > 0) {
            const target = uninfected[Math.floor(Math.random() * uninfected.length)];
            target.infectedDot = unit.infectedDot;
            target.infectedDotTurns = 3;
            events.push({ type: 'type_passive', desc: `L infection se propage a ${target.name} !` });
          }
        }
        // Tisseuse d Ames : quand un ennemi lie meurt, la Tisseuse du camp oppose gagne +2 ATK
        if (unit.linkedTo) {
          const enemies = getEnemies();
          const tisseuse = enemies.find(a => a.name === "Tisseuse d Ames" && a.alive);
          if (tisseuse) {
            tisseuse.permanentBonusAtk = (tisseuse.permanentBonusAtk || 0) + 2;
            events.push({ type: 'type_passive', desc: `Tisseuse d Ames vole 2 ATK ! (lien brise)` });
          }
          // Nettoyer le lien du partenaire
          const partner = [...getAllies(), ...getEnemies()].find(u => u && u.alive && u.linkedTo === unit.name);
          if (partner) {
            partner.linkedTo = null;
            partner.linkedTurns = 0;
          }
        }
      }

      // Sauvegarder les morts pour Anubis revive
      if (battle && battle.isDeckBattle) {
        const deadList = unit.side === 'player' ? battle.playerDeadAllies : battle.enemyDeadAllies;
        if (deadList && !unit.isToken) deadList.push(unit);
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
  // Burn AoE (Phoenix etc) : inflige degats aux unites joueur qui brulent
  battle.playerTeam.filter(u => u.alive && u.burnAoe).forEach(u => {
    u.currentHp = Math.max(0, u.currentHp - u.burnAoe.damage);
    events.push({ type: 'type_passive', desc: `${u.name} brule ! -${u.burnAoe.damage} PV` });
    if (u.currentHp <= 0) checkKO(u, events, battle);
    u.burnAoe.turnsLeft--;
    if (u.burnAoe.turnsLeft <= 0) u.burnAoe = null;
  });
  // Burn AoE : inflige degats aux unites ennemies qui brulent
  battle.enemyTeam.filter(u => u.alive && u.burnAoe).forEach(u => {
    u.currentHp = Math.max(0, u.currentHp - u.burnAoe.damage);
    events.push({ type: 'type_passive', desc: `${u.name} brule ! -${u.burnAoe.damage} PV` });
    if (u.currentHp <= 0) checkKO(u, events, battle);
    u.burnAoe.turnsLeft--;
    if (u.burnAoe.turnsLeft <= 0) u.burnAoe = null;
  });
  // Passif Leviathan Abyssal ennemi : +1 ATK aux allies Eau
  const leviathanCountEC = battle.enemyTeam.filter(u => u.alive && u.name === 'Leviathan Abyssal').length;
  if (leviathanCountEC > 0) {
    battle.enemyTeam.filter(u => u.alive && hasElement(u, 'eau')).forEach(u => {
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
    awakening_level: card.awakening_level || 0,
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
    // Rank synergy
    rankBonus: null, // 'left', 'center', 'right' — set on deployment
    rankBonusAtk: 0,
    rankBonusDef: 0,
    comboKillBonusAtk: 0, // Combo kill temp bonus
    // v0.2.3 new properties
    reflectDamage: 0,
    reflectTurns: 0,
    infectedDot: 0,
    infectedDotTurns: 0,
    swappedOriginalSide: null,
    swapTimer: 0,
    // v0.2.4 new properties
    linkedTo: null,
    linkedTurns: 0,
    crabDefStacks: 0,
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
    // Challenge tracking
    abilityUsedCount: 0,
    playerDeployedElements: [],
    // New mechanics
    playerBonusMana: 0,   // Unspent mana carry-over (max 2)
    enemyBonusMana: 0,
    playerKillsThisTurn: 0, // Combo kill tracking
    enemyKillsThisTurn: 0,
    comboKillActive: false, // Whether combo kill bonus is active this turn
    // v0.2.3
    playerDeadAllies: [],
    enemyDeadAllies: [],
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
    // New mechanics
    playerBonusMana: battle.playerBonusMana || 0,
    enemyBonusMana: battle.enemyBonusMana || 0,
    playerKillsThisTurn: battle.playerKillsThisTurn || 0,
    comboKillActive: battle.comboKillActive || false,
    testMode: battle.testMode || false,
  };
}

// Chimere Elementaire compte comme Feu, Eau ET Terre pour les synergies
function hasElement(unit, element) {
  if (unit.element === element) return true;
  if (unit.name === 'Chimere Elementaire') return ['feu', 'eau', 'terre'].includes(element);
  return false;
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

  // Deck exhaustion: field empty + deck empty + can't deploy anything = lose
  const MAX_POSSIBLE_ENERGY = 6;
  if (battle.enemyDeck && battle.enemyDeck.length === 0 && getFieldAlive(battle.enemyField).length === 0) {
    if (!battle.enemyHand || battle.enemyHand.length === 0) {
      battle.result = 'victory';
      return 'victory';
    }
    // Hand has cards but no deployable creature (only items or all too expensive)
    const canDeploy = battle.enemyHand.some(c => c.type !== 'objet' && c.mana_cost <= MAX_POSSIBLE_ENERGY);
    if (!canDeploy) {
      battle.result = 'victory';
      return 'victory';
    }
  }
  if (battle.playerDeck && battle.playerDeck.length === 0 && getFieldAlive(battle.playerField).length === 0) {
    if (!battle.playerHand || battle.playerHand.length === 0) {
      battle.result = 'defeat';
      return 'defeat';
    }
    const canDeploy = battle.playerHand.some(c => c.type !== 'objet' && c.mana_cost <= MAX_POSSIBLE_ENERGY);
    if (!canDeploy) {
      battle.result = 'defeat';
      return 'defeat';
    }
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
        const turns = effect.value || 2;
        target.poisonDot = 1;
        target.poisonDotTurns = Math.max(target.poisonDotTurns || 0, turns);
        events.push({ type: 'item_poison', item: item.name, target: target.name, emoji: item.emoji, desc: `Applique poison pendant ${turns} tours` });
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
    getFieldAlive(battle.enemyField).filter(u => hasElement(u, 'terre')).forEach(u => {
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

  // 0. Force Deploy: si Pines a force une carte, la deployer en priorite
  if (battle.forcedEnemyDeploy !== undefined && battle.forcedEnemyDeploy !== null) {
    const forcedIdx = battle.forcedEnemyDeploy;
    delete battle.forcedEnemyDeploy;

    if (forcedIdx >= 0 && forcedIdx < battle.enemyHand.length) {
      const forcedCard = battle.enemyHand[forcedIdx];
      // Trouver un slot vide
      let forcedSlot = -1;
      for (let i = 0; i < 3; i++) {
        if (!battle.enemyField[i] || !battle.enemyField[i].alive) {
          battle.enemyField[i] = null;
          forcedSlot = i;
          break;
        }
      }
      if (forcedSlot >= 0 && forcedCard.type !== 'objet') {
        battle.enemyHand.splice(forcedIdx, 1);
        const unit = makeDeckFieldUnit(forcedCard, 'enemy');
        unit.justDeployed = true;
        battle.enemyField[forcedSlot] = unit;
        // Deduire le mana normalement (meme si cher, force deploy impose le cout)
        battle.enemyEnergy = Math.max(0, battle.enemyEnergy - forcedCard.mana_cost);

        // Rank Synergy
        const eRankName = forcedSlot === 0 ? 'left' : forcedSlot === 1 ? 'center' : 'right';
        unit.rankBonus = eRankName;
        if (forcedSlot === 1) {
          unit.rankBonusDef = 1;
          unit.permanentBonusDef += 1;
        } else {
          unit.rankBonusAtk = 1;
          unit.permanentBonusAtk += 1;
        }

        events.push({
          type: 'enemy_deploy',
          slot: forcedSlot,
          name: unit.name,
          emoji: unit.emoji,
          mana_cost: unit.mana_cost,
          rankBonus: eRankName,
          forced: true,
          desc: `🌲 ${unit.name} est force de combattre par Emprise des Pins !`
        });
      } else {
        events.push({ type: 'system_msg', msg: '🌲 Emprise des Pins : impossible de deployer (pas de slot ou objet) !' });
      }
    }
  }

  // 1. Deploy: IA amelioree — placement strategique
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

    const MAX_ONE_AI = ['La Voie Lactee', 'Le Neant Originel', 'Le De du Destin'];
    const creatures = battle.enemyHand
      .filter(c => c.type !== 'objet' && c.mana_cost <= battle.enemyEnergy)
      .filter(c => !MAX_ONE_AI.includes(c.name) || !getFieldAlive(battle.enemyField).some(u => u.name === c.name))
      .sort((a, b) => {
        // Prioriser les cartes avec le meilleur ratio stats/cout
        const aVal = (a.attack * 2 + a.defense + a.hp) / Math.max(1, a.mana_cost);
        const bVal = (b.attack * 2 + b.defense + b.hp) / Math.max(1, b.mana_cost);
        return bVal - aVal;
      });

    if (creatures.length > 0) {
      const card = creatures[0];
      // Placement strategique : ATK haute → flancs (0,2), DEF haute → centre (1)
      let slot;
      if (card.defense > card.attack && emptySlots.includes(1)) {
        slot = 1; // Centre pour les tanks
      } else {
        // Préférer les flancs pour les attaquants
        slot = emptySlots.find(s => s !== 1) ?? emptySlots[0];
      }
      const handIdx = battle.enemyHand.indexOf(card);
      battle.enemyHand.splice(handIdx, 1);

      const unit = makeDeckFieldUnit(card, 'enemy');
      unit.justDeployed = true; // summoning sickness
      battle.enemyField[slot] = unit;
      battle.enemyEnergy -= card.mana_cost;

      // Rank Synergy for enemy
      const eRankName = slot === 0 ? 'left' : slot === 1 ? 'center' : 'right';
      unit.rankBonus = eRankName;
      if (slot === 1) {
        unit.rankBonusDef = 1;
        unit.permanentBonusDef += 1;
      } else {
        unit.rankBonusAtk = 1;
        unit.permanentBonusAtk += 1;
      }

      events.push({ type: 'enemy_deploy', slot, name: unit.name, emoji: unit.emoji, mana_cost: unit.mana_cost, rankBonus: eRankName });

      // Passif Tortue : unites Eau invoquees +1 PV
      if (hasElement(unit, 'eau')) {
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
      // Passif Louveteau Sauvage : pas de summoning sickness
      if (unit.name === 'Louveteau Sauvage') {
        unit.justDeployed = false;
        events.push({ type: 'type_passive', desc: `${unit.name} bondit ! Peut attaquer immediatement` });
      }
      // Passif Spectre Glacial / Espion des Brumes ennemi : intangible 1 tour
      if (unit.name === 'Spectre Glacial' || unit.name === 'Espion des Brumes') {
        unit.untargetable = true;
        unit.untargetableTurns = 1;
        events.push({ type: 'type_passive', desc: `${unit.name} est intangible pour 1 tour !` });
      }
      // Passif Champignon Toxique ennemi
      if (unit.name === 'Champignon Toxique') {
        unit.cannotAttack = true;
        unit.deathTimer = 3;
      }
      // Passif Le Neant Originel ennemi
      if (unit.name === 'Le Neant Originel') {
        unit.cannotAttack = true;
        unit.untargetable = true;
      }

      // === PASSIFS DEPLOY v0.2.3 (AI) ===
      // Mouette Pirate ennemi : vole 1 mana au joueur
      if (unit.name === 'Mouette Pirate') {
        if (battle.playerEnergy > 0) {
          battle.playerEnergy -= 1;
          battle.enemyEnergy += 1;
          events.push({ type: 'type_passive', desc: `${unit.name} ennemi vole 1 mana !` });
        }
      }

      // Forgeron Nain ennemi : allies Terre +1 DEF
      if (unit.name === 'Forgeron Nain') {
        getFieldAlive(battle.enemyField).filter(u => hasElement(u, 'terre') && u !== unit).forEach(u => {
          u.permanentBonusDef = (u.permanentBonusDef || 0) + 1;
          events.push({ type: 'type_passive', desc: `Forgeron Nain ennemi : +1 DEF a ${u.name}` });
        });
      }

      // Le Parasite ennemi : s'attache a votre unite la plus forte
      if (unit.name === 'Le Parasite') {
        const playerUnits = getFieldAlive(battle.playerField);
        if (playerUnits.length > 0) {
          const strongest = playerUnits.reduce((a, b) => {
            const atkA = (a.effectiveStats?.attack || a.attack || 0) + (a.buffAtk || 0) + (a.permanentBonusAtk || 0);
            const atkB = (b.effectiveStats?.attack || b.attack || 0) + (b.buffAtk || 0) + (b.permanentBonusAtk || 0);
            return atkA > atkB ? a : b;
          });
          strongest.infectedDot = 1;
          strongest.infectedDotTurns = 99;
          events.push({ type: 'type_passive', desc: `${unit.name} ennemi s attache a ${strongest.name} !` });
        }
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

    // IA ne peut pas utiliser force_deploy (c'est un pouvoir interactif joueur)
    if (ability.type === 'force_deploy') continue;

    const playerAlive = getFieldAlive(battle.playerField);
    const enemyAlive = getFieldAlive(battle.enemyField);

    // Skip offensive abilities if no player targets
    if (playerAlive.length === 0 && !['buff_atk', 'buff_def', 'buff_team_atk', 'buff_team_def', 'shield', 'heal_ally', 'counter', 'lifesteal_attack', 'revive', 'reflect_all'].includes(ability.type)) continue;

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
    if (unit.cannotAttack) continue;

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

    const playerAlive = getFieldAlive(battle.playerField).filter(u => !u.untargetable);

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

    // Taunt: priorite aux unites avec taunt
    const taunters = playerAlive.filter(u => u.taunt);
    const candidates = taunters.length > 0 ? taunters : playerAlive;

    // IA améliorée : prioriser les cibles qu'on peut tuer, sinon les plus dangereuses
    const unitAtk = (unit.effectiveStats?.attack || unit.attack) + (unit.buffAtk || 0) + (unit.permanentBonusAtk || 0);
    const killable = candidates.filter(u => {
      const def = (u.effectiveStats?.defense || u.defense) + (u.buffDef || 0) + (u.permanentBonusDef || 0);
      const dmgEstimate = Math.max(1, unitAtk - def);
      return u.currentHp <= dmgEstimate;
    });

    let target;
    if (killable.length > 0) {
      // Tuer l'ennemi le plus dangereux parmi ceux qu'on peut achever
      target = killable.reduce((a, b) => {
        const aAtk = (a.effectiveStats?.attack || a.attack) + (a.buffAtk || 0) + (a.permanentBonusAtk || 0);
        const bAtk = (b.effectiveStats?.attack || b.attack) + (b.buffAtk || 0) + (b.permanentBonusAtk || 0);
        return bAtk > aAtk ? b : a;
      });
    } else {
      // Cibler l'ennemi le plus dangereux (ATK la plus haute)
      target = candidates.reduce((a, b) => {
        const aAtk = (a.effectiveStats?.attack || a.attack) + (a.buffAtk || 0) + (a.permanentBonusAtk || 0);
        const bAtk = (b.effectiveStats?.attack || b.attack) + (b.buffAtk || 0) + (b.permanentBonusAtk || 0);
        return bAtk > aAtk ? b : a;
      });
    }

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

// --- Middleware ---
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
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

const AUTH_COOKIE = 'gacha_remember';
const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateAuthToken(userId, res) {
  const token = crypto.randomBytes(48).toString('hex');
  db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(userId);
  db.prepare('INSERT INTO auth_tokens (user_id, token) VALUES (?, ?)').run(userId, token);
  if (res) {
    res.cookie(AUTH_COOKIE, token, { maxAge: AUTH_COOKIE_MAX_AGE, httpOnly: true, sameSite: 'lax' });
  }
  return token;
}

function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE);
}

// Try to restore session from remember-me cookie
function tryAutoReconnect(req) {
  const token = req.cookies && req.cookies[AUTH_COOKIE];
  if (!token) return false;
  const row = db.prepare('SELECT user_id FROM auth_tokens WHERE token = ?').get(token);
  if (!row) return false;
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(row.user_id);
  if (!user) return false;
  req.session.userId = user.id;
  req.session.username = user.username;
  return true;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    // Try auto-reconnect from remember cookie
    if (tryAutoReconnect(req)) {
      // Session restored, rotate token for security
      generateAuthToken(req.session.userId, res);
      return next();
    }
    const isApi = req.path.startsWith('/api/');
    if (isApi) {
      return res.status(401).json({ error: 'Non connecte' });
    }
    return res.redirect('/');
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
  generateAuthToken(result.lastInsertRowid, res);
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
  generateAuthToken(user.id, res);
  res.json({ success: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  if (req.session.userId) {
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(req.session.userId);
  }
  clearAuthCookie(res);
  req.session.destroy();
  res.json({ success: true });
});

// --- Routes USER ---
app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT username, credits, last_daily, avatar, display_name, excavation_essence, username_effect, unlocked_avatars, login_streak, last_streak_date, profile_frame, unlocked_frames, tutorial_completed, guild_id FROM users WHERE id = ?').get(req.session.userId);
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

  // Calculate current tier XP progress
  let currentTierXP = bp?.xp || 0;
  let currentTierRequired = BATTLEPASS_TIERS[0]?.xp_required || 100;
  if (bp && bp.xp > 0) {
    let cumXP = 0;
    for (let i = 0; i < BATTLEPASS_TIERS.length; i++) {
      if (bp.xp >= cumXP + BATTLEPASS_TIERS[i].xp_required) {
        cumXP += BATTLEPASS_TIERS[i].xp_required;
      } else {
        currentTierXP = bp.xp - cumXP;
        currentTierRequired = BATTLEPASS_TIERS[i].xp_required;
        break;
      }
    }
    if ((bp?.current_tier || 0) >= 30) currentTierXP = currentTierRequired;
  }

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
    profileFrame: user.profile_frame || 'none',
    unlockedFrames: JSON.parse(user.unlocked_frames || '["none"]'),
    battlePassTier: bp?.current_tier || 0,
    battlePassXP: bp?.xp || 0,
    currentTierXP,
    currentTierRequired,
    tutorialCompleted: user.tutorial_completed || 0,
    // Energy system
    ...getEnergy(req.session.userId),
    // Guild info
    guildId: user.guild_id || null,
    guildName: user.guild_id ? (db.prepare('SELECT name FROM guilds WHERE id = ?').get(user.guild_id)?.name || null) : null,
  });
});

// --- Tutorial API ---
app.post('/api/tutorial/open-pack', requireAuth, (req, res) => {
  const user = db.prepare('SELECT tutorial_completed FROM users WHERE id = ?').get(req.session.userId);
  if (user.tutorial_completed) return res.status(400).json({ error: 'Tutoriel deja complete' });

  const communes = db.prepare("SELECT * FROM cards WHERE rarity = 'commune' ORDER BY RANDOM() LIMIT 3").all();
  const rares = db.prepare("SELECT * FROM cards WHERE rarity = 'rare' ORDER BY RANDOM() LIMIT 2").all();
  const cards = [...communes, ...rares];

  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  const insert = db.prepare('INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)');
  cards.forEach(c => insert.run(req.session.userId, c.id));

  res.json({ cards });
});

app.post('/api/tutorial/complete', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET tutorial_completed = 1 WHERE id = ?').run(req.session.userId);
  res.json({ success: true });
});

// User settings (avatar + display name)
const VALID_AVATARS = [
  '⚔','🗡','🛡','🏹','🔮','💀','🐉','👑','🦅','🐺',
  '🦁','🔥','❄','⚡','🌙','☀','💎','🎭','👹','🧙',
  '🤖','👻','🦇','🐍','🦂','🌋','🌊','🌿','⭐','💫',
  '🏰','🗿','🎲','🃏','🪄','🧿','⛏','🦴','🕷','🎯'
];

app.post('/api/settings', requireAuth, (req, res) => {
  const { avatar, displayName, profileFrame } = req.body;
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

  if (profileFrame !== undefined) {
    if (!PROFILE_FRAMES[profileFrame]) {
      return res.status(400).json({ error: 'Cadre invalide' });
    }
    const u = db.prepare('SELECT unlocked_frames FROM users WHERE id = ?').get(userId);
    const unlockedFrames = JSON.parse(u.unlocked_frames || '["none"]');
    if (!unlockedFrames.includes(profileFrame)) {
      return res.status(400).json({ error: 'Cadre non deverrouille' });
    }
    db.prepare('UPDATE users SET profile_frame = ? WHERE id = ?').run(profileFrame, userId);
  }

  const user = db.prepare('SELECT username, avatar, display_name, profile_frame FROM users WHERE id = ?').get(userId);
  res.json({ success: true, avatar: user.avatar || '⚔', displayName: user.display_name || user.username, profileFrame: user.profile_frame || 'none' });
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
    SELECT c.*, uc.is_shiny, uc.is_fused, uc.is_temp, uc.awakening_level, COUNT(*) as count, MIN(uc.id) as user_card_id
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ?
    GROUP BY c.id, uc.is_shiny, uc.is_fused, uc.is_temp, uc.awakening_level
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
    SELECT c.*, uc.is_shiny, uc.is_fused, uc.is_temp, uc.awakening_level, COUNT(*) as count, MIN(uc.id) as user_card_id
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ?
    GROUP BY c.id, uc.is_shiny, uc.is_fused, uc.is_temp, uc.awakening_level
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

  const success = Math.random() < 0.45;

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
// BATTLE ACTION
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
  // Burn AoE (Phoenix etc) : inflige degats aux unites ennemies qui brulent
  battle.enemyTeam.filter(u => u.alive && u.burnAoe).forEach(u => {
    u.currentHp = Math.max(0, u.currentHp - u.burnAoe.damage);
    events.push({ type: 'type_passive', desc: `${u.name} brule ! -${u.burnAoe.damage} PV` });
    if (u.currentHp <= 0) checkKO(u, events, battle);
    u.burnAoe.turnsLeft--;
    if (u.burnAoe.turnsLeft <= 0) u.burnAoe = null;
  });
  // Burn AoE : inflige degats aux unites joueur qui brulent
  battle.playerTeam.filter(u => u.alive && u.burnAoe).forEach(u => {
    u.currentHp = Math.max(0, u.currentHp - u.burnAoe.damage);
    events.push({ type: 'type_passive', desc: `${u.name} brule ! -${u.burnAoe.damage} PV` });
    if (u.currentHp <= 0) checkKO(u, events, battle);
    u.burnAoe.turnsLeft--;
    if (u.burnAoe.turnsLeft <= 0) u.burnAoe = null;
  });
  // Passif Leviathan Abyssal : +1 ATK aux allies Eau
  const leviathanCountPC = battle.playerTeam.filter(u => u.alive && u.name === 'Leviathan Abyssal').length;
  if (leviathanCountPC > 0) {
    battle.playerTeam.filter(u => u.alive && hasElement(u, 'eau')).forEach(u => {
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
      const earthCount = allies.filter(a => a.alive && hasElement(a, 'terre') && a !== u).length;
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
    reward = 150;
  } else if (battle.result === 'defeat') {
    reward = 25;
  }

  if (reward > 0) {
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(reward, req.session.userId);
  }

  // Log battle
  db.prepare('INSERT INTO battle_log (user_id, battle_type, opponent_info, result, reward_credits) VALUES (?, ?, ?, ?, ?)')
    .run(req.session.userId, battle.battleType || 'ia', 'IA', battle.result, reward);

  // Battle Pass XP
  addBattlePassXP(req.session.userId, battle.result === 'victory' ? BP_XP.combat_win : BP_XP.combat_lose);

  // Quest/achievement hooks
  if (battle.result === 'victory') {
    db.prepare('UPDATE users SET stat_pvp_wins = stat_pvp_wins + 1 WHERE id = ?').run(req.session.userId);
    updateQuestProgress(req.session.userId, 'combat_win', 1);

    // Validate special daily challenges
    const today = new Date().toISOString().split('T')[0];
    const specialQuests = db.prepare('SELECT * FROM user_quests WHERE user_id = ? AND type = ? AND assigned_date = ? AND claimed = 0').all(req.session.userId, 'special', today);
    for (const sq of specialQuests) {
      const challengeDef = SPECIAL_CHALLENGE_POOL.find(c => c.key === sq.quest_key);
      if (!challengeDef) continue;
      let passed = false;
      const v = challengeDef.validation;
      if (v.type === 'element_deck') {
        const elems = battle.playerDeployedElements || [];
        passed = elems.length > 0 && elems.every(e => e === v.element);
      } else if (v.type === 'no_abilities') {
        passed = (battle.abilityUsedCount || 0) === 0;
      } else if (v.type === 'max_turns') {
        passed = battle.turn <= v.turns;
      }
      if (passed) updateQuestProgress(req.session.userId, challengeDef.track, 1);
    }
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
// DECK BATTLE ROUTES
// ============================================

// Start a deck-based IA battle
app.post('/api/battle/start-deck', requireAuth, (req, res) => {
  const { deckId } = req.body; // deckId: number or 'starter'

  // Energy check
  const energyResult = consumeEnergy(req.session.userId, ENERGY_CONFIG.costs.pve_battle);
  if (!energyResult.success) return res.status(400).json({ error: `Pas assez d'energie (${ENERGY_CONFIG.costs.pve_battle} requis, ${energyResult.energy} dispo)`, noEnergy: true });

  let playerCards;

  if (deckId === 'starter') {
    playerCards = STARTER_DECK.map(c => ({ ...c }));
  } else {
    const deck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(deckId, req.session.userId);
    if (!deck) return res.status(404).json({ error: 'Deck introuvable' });

    const cards = db.prepare(`
      SELECT dc.position, uc.id as user_card_id, uc.is_shiny, uc.is_fused, uc.is_temp, uc.awakening_level, c.*
      FROM deck_cards dc
      JOIN user_cards uc ON dc.user_card_id = uc.id
      JOIN cards c ON uc.card_id = c.id
      WHERE dc.deck_id = ?
      ORDER BY dc.position
    `).all(deck.id);

    if (cards.length !== 20) return res.status(400).json({ error: 'Deck incomplet' });
    playerCards = cards;
  }

  // Generate AI opponent deck — adapte au niveau du joueur
  const { enemyCards, opponentName } = buildAIDeck(playerCards);

  const battle = createDeckBattleState(playerCards, enemyCards, 'ia');

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

  // Max 1 on field restriction
  const MAX_ONE_CARDS = ['La Voie Lactee', 'Le Neant Originel', 'Le De du Destin'];
  if (MAX_ONE_CARDS.includes(card.name)) {
    const alreadyOnField = getFieldAlive(battle.playerField).some(u => u.name === card.name);
    if (alreadyOnField) return res.status(400).json({ error: `${card.name} : max 1 sur le terrain !` });
  }

  // Deploy
  battle.playerHand.splice(handIndex, 1);
  battle.playerField[fieldSlot] = null; // clean dead
  const unit = makeDeckFieldUnit(card, 'player');
  unit.justDeployed = battle.testMode ? false : true; // summoning sickness (disabled in test mode)
  battle.playerField[fieldSlot] = unit;
  if (!battle.testMode) battle.playerEnergy -= card.mana_cost;

  // Track deployed element for special challenges
  if (card.element) battle.playerDeployedElements.push(card.element);

  // Rank Synergy: LEFT/RIGHT = +1 ATK, CENTER = +1 DEF
  const rankName = fieldSlot === 0 ? 'left' : fieldSlot === 1 ? 'center' : 'right';
  unit.rankBonus = rankName;
  if (fieldSlot === 1) {
    unit.rankBonusDef = 1;
    unit.permanentBonusDef += 1;
  } else {
    unit.rankBonusAtk = 1;
    unit.permanentBonusAtk += 1;
  }

  const events = [{ type: 'deploy', slot: fieldSlot, name: unit.name, emoji: unit.emoji, mana_cost: unit.mana_cost, rankBonus: rankName }];

  // Passif Tortue des Rivieres : unites Eau invoquees gagnent +1 PV
  if (hasElement(unit, 'eau')) {
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

  // Passif Louveteau Sauvage : pas de summoning sickness
  if (unit.name === 'Louveteau Sauvage') {
    unit.justDeployed = false;
    events.push({ type: 'type_passive', desc: `${unit.name} bondit ! Peut attaquer immediatement` });
  }

  // Passif Spectre Glacial / Espion des Brumes : ne peut pas etre cible au premier tour
  if (unit.name === 'Spectre Glacial' || unit.name === 'Espion des Brumes') {
    unit.untargetable = true;
    unit.untargetableTurns = 1;
    events.push({ type: 'type_passive', desc: `${unit.name} est intangible pour 1 tour !` });
  }

  // Passif Champignon Toxique : ne peut pas attaquer, meurt au bout de 3 tours
  if (unit.name === 'Champignon Toxique') {
    unit.cannotAttack = true;
    unit.deathTimer = 3;
    events.push({ type: 'type_passive', desc: `${unit.name} ne peut pas attaquer. Meurt dans 3 tours.` });
  }

  // Passif Le Neant Originel : ne peut pas attaquer ni etre attaque
  if (unit.name === 'Le Neant Originel') {
    unit.cannotAttack = true;
    unit.untargetable = true;
    events.push({ type: 'type_passive', desc: `${unit.name} accumule sa puissance...` });
  }

  // === PASSIFS DEPLOY v0.2.3 ===
  // Mouette Pirate : vole 1 mana a l adversaire
  if (unit.name === 'Mouette Pirate') {
    if (battle.enemyEnergy > 0) {
      battle.enemyEnergy -= 1;
      battle.playerEnergy += 1;
      events.push({ type: 'type_passive', desc: `${unit.name} vole 1 mana a l adversaire !` });
    }
  }

  // Forgeron Nain : allies Terre +1 DEF
  if (unit.name === 'Forgeron Nain') {
    getFieldAlive(battle.playerField).filter(u => hasElement(u, 'terre') && u !== unit).forEach(u => {
      u.permanentBonusDef = (u.permanentBonusDef || 0) + 1;
      events.push({ type: 'type_passive', desc: `Forgeron Nain : +1 DEF a ${u.name}` });
    });
  }

  // Le Parasite : s'attache a l'ennemi le plus fort
  if (unit.name === 'Le Parasite') {
    const enemies = getFieldAlive(battle.enemyField);
    if (enemies.length > 0) {
      const strongest = enemies.reduce((a, b) => {
        const atkA = (a.effectiveStats?.attack || a.attack || 0) + (a.buffAtk || 0) + (a.permanentBonusAtk || 0);
        const atkB = (b.effectiveStats?.attack || b.attack || 0) + (b.buffAtk || 0) + (b.permanentBonusAtk || 0);
        return atkA > atkB ? a : b;
      });
      strongest.infectedDot = 1;
      strongest.infectedDotTurns = 99;
      events.push({ type: 'type_passive', desc: `${unit.name} s attache a ${strongest.name} ! (1 degat/tour)` });
    }
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
  if (attacker.cannotAttack) return res.status(400).json({ error: 'Cette carte ne peut pas attaquer' });
  if (battle.attackedThisTurn.includes(fieldSlot)) return res.status(400).json({ error: 'Deja attaque ce tour' });
  if (battle.playerEnergy < 1) return res.status(400).json({ error: 'Pas assez d energie pour attaquer' });

  const target = battle.enemyField[targetSlot];
  if (!target || !target.alive) return res.status(400).json({ error: 'Pas de cible dans ce slot' });
  if (target.untargetable) return res.status(400).json({ error: 'Cette carte ne peut pas etre ciblee' });

  // Attacks cost 1 energy
  if (!battle.testMode) battle.playerEnergy -= 1;

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

  // Combo Kill tracking
  if (!target.alive) {
    battle.playerKillsThisTurn = (battle.playerKillsThisTurn || 0) + 1;
    if (battle.playerKillsThisTurn >= 3 && !battle.comboKillActive) {
      battle.comboKillActive = true;
      getFieldAlive(battle.playerField).forEach(u => {
        u.comboKillBonusAtk = 1;
        u.buffAtk += 1;
      });
      events.push({ type: 'combo_kill', side: 'player', kills: battle.playerKillsThisTurn });
    }
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

  // Track ability usage for special challenges
  battle.abilityUsedCount = (battle.abilityUsedCount || 0) + 1;

  // Si force_deploy pending, ne pas deduire le crystal maintenant (sera deduit a la confirmation du pick)
  if (!battle.forceDeployPending) {
    if (!battle.testMode) battle.playerCrystal -= crystalCost;
  }

  cleanDeadFromField(battle.enemyField);
  cleanDeadFromField(battle.playerField);
  checkDeckWin(battle);

  res.json({ events, ...getDeckBattleSnapshot(battle) });
});

// Force Deploy Pick - Pines ability: player picks which enemy card to force deploy
app.post('/api/battle/force-deploy-pick', requireAuth, (req, res) => {
  const { battleId, cardIndex } = req.body;

  const battle = activeBattles.get(battleId);
  if (!battle || !battle.isDeckBattle) return res.status(404).json({ error: 'Combat introuvable' });
  if (battle.result) return res.status(400).json({ error: 'Combat termine' });
  if (!battle.forceDeployPending) return res.status(400).json({ error: 'Pas de force deploy en attente' });

  battle.lastAction = Date.now();

  const enemyHand = battle.enemyHand;
  if (cardIndex < 0 || cardIndex >= enemyHand.length) {
    return res.status(400).json({ error: 'Index de carte invalide' });
  }

  const chosenCard = enemyHand[cardIndex];
  if (chosenCard.type === 'objet') {
    return res.status(400).json({ error: 'Impossible de forcer un objet' });
  }

  // Store the forced deploy choice
  battle.forcedEnemyDeploy = cardIndex;

  // Now consume the ability and crystal
  const pending = battle.forceDeployPending;
  const field = pending.sourceSide === 'player' ? battle.playerField : battle.enemyField;
  const sourceUnit = field[pending.sourceSlot];
  if (sourceUnit && sourceUnit.alive) {
    sourceUnit.usedAbility = true;
    const crystalCost = sourceUnit.crystal_cost || 1;
    if (!battle.testMode) {
      if (pending.sourceSide === 'player') {
        battle.playerCrystal -= crystalCost;
      } else {
        battle.enemyCrystal -= crystalCost;
      }
    }
  }

  delete battle.forceDeployPending;

  const events = [{
    type: 'force_deploy_confirmed',
    chosenCard: chosenCard.name,
    chosenEmoji: chosenCard.emoji,
    desc: `🌲 Emprise des Pins : ${chosenCard.name} ${chosenCard.emoji} sera force de combattre au prochain tour !`
  }];

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
    if (!battle.testMode) battle.playerCrystal -= crystalCost;
    checkDeckWin(battle);
    return res.json({ events, ...getDeckBattleSnapshot(battle) });
  }

  battle.enemyHp = Math.max(0, battle.enemyHp - dmg);
  if (!battle.testMode) battle.playerCrystal -= crystalCost;
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
    if (unit.poisonDotTurns > 0 && unit.poisonDot > 0) {
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
      const earthCount = getFieldAlive(battle.playerField).filter(a => a.alive && hasElement(a, 'terre') && a !== unit).length;
      unit.buffAtk += earthCount;
    }
    // Tick untargetable countdown
    if (unit.untargetable && unit.untargetableTurns > 0) {
      unit.untargetableTurns--;
      if (unit.untargetableTurns <= 0 && unit.name !== 'Le Neant Originel') unit.untargetable = false;
    }
    // Tick deathTimer (Champignon Toxique)
    if (unit.deathTimer > 0) {
      unit.deathTimer--;
      if (unit.deathTimer <= 0) {
        unit.currentHp = 0;
        events.push({ type: 'type_passive', desc: `${unit.name} se decompose et meurt !` });
        checkKO(unit, events, battle);
      }
    }
    // Passif Assassin Nocturne : +1 ATK si ennemi n'a qu'une seule carte
    if (unit.name === 'Assassin Nocturne' && getFieldAlive(battle.enemyField).length === 1) {
      unit.buffAtk += 1;
      events.push({ type: 'type_passive', desc: `${unit.name} : cible isolee ! +1 ATK` });
    }
  }
  cleanDeadFromField(battle.playerField);

  if (checkDeckWin(battle)) {
    return res.json({ events, ...getDeckBattleSnapshot(battle) });
  }

  // 3. Enemy turn
  battle.phase = 'enemy_turn';

  // Clear summoning sickness on enemy units + tick passives
  for (const unit of getFieldAlive(battle.enemyField)) {
    unit.justDeployed = false;
    // Tick untargetable
    if (unit.untargetable && unit.untargetableTurns > 0) {
      unit.untargetableTurns--;
      if (unit.untargetableTurns <= 0 && unit.name !== 'Le Neant Originel') unit.untargetable = false;
    }
    // Tick deathTimer (Champignon Toxique)
    if (unit.deathTimer > 0) {
      unit.deathTimer--;
      if (unit.deathTimer <= 0) {
        unit.currentHp = 0;
        events.push({ type: 'type_passive', desc: `${unit.name} ennemi se decompose et meurt !` });
        checkKO(unit, events, battle);
      }
    }
    // Passif Assassin Nocturne ennemi : +1 ATK si joueur n'a qu'une seule carte
    if (unit.name === 'Assassin Nocturne' && getFieldAlive(battle.playerField).length === 1) {
      unit.buffAtk += 1;
      events.push({ type: 'type_passive', desc: `${unit.name} ennemi : cible isolee ! +1 ATK` });
    }
  }
  cleanDeadFromField(battle.enemyField);

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
  // Esprit des Forets ennemi : +1 DEF Terre + soin 1 PV/tour
  const espritCountE = getFieldAlive(battle.enemyField).filter(u => u.name === 'Esprit des Forets').length;
  if (espritCountE > 0) {
    getFieldAlive(battle.enemyField).filter(u => hasElement(u, 'terre')).forEach(u => {
      u.buffDef += espritCountE;
    });
    events.push({ type: 'type_passive', desc: `Esprit des Forets ennemi : +${espritCountE} DEF aux Terre` });
    // Soin 1 PV par Esprit des Forets
    getFieldAlive(battle.enemyField).filter(u => u.name === 'Esprit des Forets').forEach(u => {
      u.currentHp = Math.min(u.maxHp, u.currentHp + 1);
    });
  }

  // Passif Eclaireur des Dunes ennemi : +2 DEF si seule
  const enemyAliveUnitsET = getFieldAlive(battle.enemyField);
  enemyAliveUnitsET.filter(u => u.name === 'Eclaireur des Dunes').forEach(u => {
    if (enemyAliveUnitsET.length === 1) {
      u.buffDef += 2;
      events.push({ type: 'type_passive', desc: `${u.name} ennemi est seule ! +2 DEF` });
    }
  });

  // Burn AoE ennemi : inflige degats aux unites joueur qui brulent
  getFieldAlive(battle.playerField).forEach(u => {
    if (u.burnAoe) {
      u.currentHp = Math.max(0, u.currentHp - u.burnAoe.damage);
      events.push({ type: 'type_passive', desc: `${u.name} brule ! -${u.burnAoe.damage} PV` });
      if (u.currentHp <= 0) checkKO(u, events, battle);
      u.burnAoe.turnsLeft--;
      if (u.burnAoe.turnsLeft <= 0) u.burnAoe = null;
    }
  });
  cleanDeadFromField(battle.playerField);
  // Burn AoE ennemi : inflige degats aux unites ennemies qui brulent
  getFieldAlive(battle.enemyField).forEach(u => {
    if (u.burnAoe) {
      u.currentHp = Math.max(0, u.currentHp - u.burnAoe.damage);
      events.push({ type: 'type_passive', desc: `${u.name} brule ! -${u.burnAoe.damage} PV` });
      if (u.currentHp <= 0) checkKO(u, events, battle);
      u.burnAoe.turnsLeft--;
      if (u.burnAoe.turnsLeft <= 0) u.burnAoe = null;
    }
  });
  cleanDeadFromField(battle.enemyField);

  // Leviathan Abyssal ennemi : +1 ATK aux allies Eau ennemis
  const leviathanCountE = getFieldAlive(battle.enemyField).filter(u => u.name === 'Leviathan Abyssal').length;
  if (leviathanCountE > 0) {
    getFieldAlive(battle.enemyField).filter(u => hasElement(u, 'eau')).forEach(u => {
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

  // === PASSIFS v1.4.0/v1.5.0 ENNEMIS ===
  // Dragon des Abysses ennemi : +1 ATK allies Eau
  const dragonAbyssesCountE = getFieldAlive(battle.enemyField).filter(u => u.name === 'Dragon des Abysses').length;
  if (dragonAbyssesCountE > 0) {
    getFieldAlive(battle.enemyField).filter(u => hasElement(u, 'eau')).forEach(u => { u.buffAtk += dragonAbyssesCountE; });
    events.push({ type: 'type_passive', desc: `Dragon des Abysses ennemi : +${dragonAbyssesCountE} ATK Eau` });
  }
  // Ombre Mimetique ennemie : -1 HP par tour (instable)
  getFieldAlive(battle.enemyField).filter(u => u.name === 'Ombre Mimetique').forEach(u => {
    u.currentHp = Math.max(1, u.currentHp - 1);
    events.push({ type: 'type_passive', desc: `${u.name} ennemi perd 1 PV (instable)` });
  });
  // Abyssia ennemie : soigne 1 HP allies Eau
  const abyssiaCountE = getFieldAlive(battle.enemyField).filter(u => u.name === 'Abyssia').length;
  if (abyssiaCountE > 0) {
    getFieldAlive(battle.enemyField).filter(u => hasElement(u, 'eau')).forEach(u => {
      u.currentHp = Math.min(u.maxHp, u.currentHp + abyssiaCountE);
    });
    events.push({ type: 'type_passive', desc: `Abyssia ennemie : +${abyssiaCountE} PV aux Eau` });
  }
  // Le De du Destin ennemi : ATK et DEF aleatoires (0-4)
  getFieldAlive(battle.enemyField).filter(u => u.name === 'Le De du Destin').forEach(u => {
    const newAtk = Math.floor(Math.random() * 5);
    const newDef = Math.floor(Math.random() * 5);
    u.buffAtk = newAtk - ((u.effectiveStats?.attack || u.attack || 0) + (u.permanentBonusAtk || 0));
    u.buffDef = newDef - ((u.effectiveStats?.defense || u.defense || 0) + (u.permanentBonusDef || 0));
    events.push({ type: 'type_passive', desc: `${u.name} ennemi : ATK=${newAtk}, DEF=${newDef} (aleatoire)` });
  });
  // Le Neant Originel ennemi : +1 ATK permanent par tour, auto-trigger a 5+ ATK
  getFieldAlive(battle.enemyField).filter(u => u.name === 'Le Neant Originel').forEach(u => {
    u.permanentBonusAtk = (u.permanentBonusAtk || 0) + 1;
    const totalAtk = (u.effectiveStats?.attack || u.attack || 0) + (u.buffAtk || 0) + (u.permanentBonusAtk || 0);
    events.push({ type: 'type_passive', desc: `${u.name} ennemi gagne en puissance ! ATK ${totalAtk}` });
    if (totalAtk >= 5 && !u.usedAbility) {
      const ae = resolveAbility(u, getFieldAlive(battle.playerField), getFieldAlive(battle.enemyField), getFieldAlive(battle.playerField), battle);
      events.push(...ae);
      cleanDeadFromField(battle.playerField);
      cleanDeadFromField(battle.enemyField);
    }
  });
  // Chronos ennemi : retire un buff aleatoire d un joueur
  getFieldAlive(battle.enemyField).filter(u => u.name === 'Chronos').forEach(() => {
    const buffed = getFieldAlive(battle.playerField).filter(p => p.buffAtk > 0 || p.buffDef > 0 || (p.permanentBonusAtk || 0) > 0);
    if (buffed.length > 0) {
      const t = buffed[Math.floor(Math.random() * buffed.length)];
      if (t.buffAtk > 0) t.buffAtk = Math.max(0, t.buffAtk - 1);
      else if ((t.permanentBonusAtk || 0) > 0) t.permanentBonusAtk -= 1;
      else if (t.buffDef > 0) t.buffDef = Math.max(0, t.buffDef - 1);
      events.push({ type: 'type_passive', desc: `Chronos ennemi neutralise un buff de ${t.name}` });
    }
  });
  // Colosse de Corail ennemi : +1 DEF par token Corail en vie
  getFieldAlive(battle.enemyField).filter(u => u.name === 'Colosse de Corail').forEach(colosse => {
    const tokenCount = getFieldAlive(battle.enemyField).filter(u => u.isToken && u.name === 'Corail').length;
    if (tokenCount > 0) {
      colosse.buffDef += tokenCount;
      events.push({ type: 'type_passive', desc: `Colosse de Corail ennemi : +${tokenCount} DEF (tokens Corail)` });
    }
  });

  // === PASSIFS TURN-START v0.2.3 ENNEMIS ===
  // Plante Carnivore ennemie : regen 1 PV/tour
  getFieldAlive(battle.enemyField).filter(u => u.name === 'Plante Carnivore').forEach(u => {
    if (u.currentHp < u.maxHp) {
      u.currentHp = Math.min(u.maxHp, u.currentHp + 1);
      events.push({ type: 'type_passive', desc: `Plante Carnivore ennemie regenere 1 PV` });
    }
  });
  // Yggdrasil ennemi : regen 2 PV a tous les allies ennemis
  const yggCountE = getFieldAlive(battle.enemyField).filter(u => u.name === 'Yggdrasil').length;
  if (yggCountE > 0) {
    getFieldAlive(battle.enemyField).forEach(u => {
      if (u.currentHp < u.maxHp) {
        u.currentHp = Math.min(u.maxHp, u.currentHp + 2 * yggCountE);
      }
    });
    events.push({ type: 'type_passive', desc: `Yggdrasil ennemi regenere ${2 * yggCountE} PV a tous` });
  }
  // Tortue Bombe ennemie : +1 DEF/tour
  getFieldAlive(battle.enemyField).filter(u => u.name === 'Tortue Bombe').forEach(u => {
    u.permanentBonusDef = (u.permanentBonusDef || 0) + 1;
    events.push({ type: 'type_passive', desc: `Tortue Bombe ennemie accumule sa puissance ! +1 DEF` });
  });

  if (checkDeckWin(battle)) {
    return res.json({ events, ...getDeckBattleSnapshot(battle) });
  }

  // AI plays
  const aiEvents = aiDeckTurn(battle);
  events.push(...aiEvents);

  // After AI turn: if field is empty and deck is empty, AI is exhausted
  if (getFieldAlive(battle.enemyField).length === 0 && battle.enemyDeck.length === 0) {
    const hasPlayableCreature = battle.enemyHand.some(c => c.type !== 'objet' && c.mana_cost <= 6);
    if (!hasPlayableCreature) {
      battle.result = 'victory';
      events.push({ type: 'system_msg', msg: 'L\'adversaire n\'a plus de cartes jouables ! Victoire !' });
      return res.json({ events, ...getDeckBattleSnapshot(battle) });
    }
  }

  if (checkDeckWin(battle)) {
    return res.json({ events, ...getDeckBattleSnapshot(battle) });
  }

  // 4. Poison ticks on enemy field
  for (const unit of getFieldAlive(battle.enemyField)) {
    if (unit.poisonDotTurns > 0 && unit.poisonDot > 0) {
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
      const earthCount = getFieldAlive(battle.enemyField).filter(a => a.alive && hasElement(a, 'terre') && a !== unit).length;
      unit.buffAtk += earthCount;
    }
  }

  if (checkDeckWin(battle)) {
    return res.json({ events, ...getDeckBattleSnapshot(battle) });
  }

  // 6. New turn
  battle.turn++;

  // Vérifier limite de tours immédiatement après incrémentation
  if (battle.turn > battle.maxTurns) {
    checkDeckWin(battle);
    return res.json({ events, ...getDeckBattleSnapshot(battle) });
  }

  battle.phase = 'player_turn';
  battle.attackedThisTurn = [];

  // Reset combo kill bonus from previous turn
  if (battle.comboKillActive) {
    for (const unit of getFieldAlive(battle.playerField)) {
      if (unit.comboKillBonusAtk > 0) {
        unit.buffAtk = Math.max(0, unit.buffAtk - unit.comboKillBonusAtk);
        unit.comboKillBonusAtk = 0;
      }
    }
    battle.comboKillActive = false;
  }
  battle.playerKillsThisTurn = 0;
  battle.enemyKillsThisTurn = 0;

  // Clear summoning sickness on player units
  for (const unit of getFieldAlive(battle.playerField)) {
    unit.justDeployed = false;
  }

  // Unspent Mana Carry-Over: carry 1 mana if player has leftover, max +2 stored
  if (battle.playerEnergy > 0) {
    battle.playerBonusMana = Math.min(2, (battle.playerBonusMana || 0) + 1);
    events.push({ type: 'mana_carry', side: 'player', stored: battle.playerBonusMana });
  }

  // Player energy (new mana progression) + bonus mana
  battle.playerMaxEnergy = getManaForTurn(battle.turn);
  battle.playerEnergy = battle.playerMaxEnergy + (battle.playerBonusMana || 0);
  // Player crystal fills
  battle.playerCrystal = Math.min(battle.playerMaxCrystal, (battle.playerCrystal || 0) + (battle.playerCrystalRate || 0.3));

  // Test mode: reset unlimited resources + reset usedAbility
  if (battle.testMode) {
    battle.playerEnergy = 99; battle.playerMaxEnergy = 99;
    battle.playerCrystal = 99; battle.playerMaxCrystal = 99;
    battle.enemyEnergy = 99; battle.enemyMaxEnergy = 99;
    battle.enemyCrystal = 99; battle.enemyMaxCrystal = 99;
    for (const u of getFieldAlive(battle.playerField)) { u.usedAbility = false; }
    for (const u of getFieldAlive(battle.enemyField)) { u.usedAbility = false; }
  }

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
    getFieldAlive(battle.playerField).filter(u => hasElement(u, 'terre')).forEach(u => {
      u.buffDef += espritCountP;
    });
    events.push({ type: 'type_passive', desc: `Esprit des Forets : +${espritCountP} DEF aux unites Terre` });
    // Soin 1 PV par Esprit des Forets
    getFieldAlive(battle.playerField).filter(u => u.name === 'Esprit des Forets').forEach(u => {
      u.currentHp = Math.min(u.maxHp, u.currentHp + 1);
    });
  }

  // Passif Eclaireur des Dunes : +2 DEF si seule sur le terrain
  const playerAliveUnits = getFieldAlive(battle.playerField);
  playerAliveUnits.filter(u => u.name === 'Eclaireur des Dunes').forEach(u => {
    if (playerAliveUnits.length === 1) {
      u.buffDef += 2;
      events.push({ type: 'type_passive', desc: `${u.name} est seule ! +2 DEF` });
    }
  });

  // Burn AoE (Phoenix etc) : inflige degats aux unites ennemies qui brulent
  getFieldAlive(battle.enemyField).forEach(u => {
    if (u.burnAoe) {
      u.currentHp = Math.max(0, u.currentHp - u.burnAoe.damage);
      events.push({ type: 'type_passive', desc: `${u.name} brule ! -${u.burnAoe.damage} PV` });
      if (u.currentHp <= 0) checkKO(u, events, battle);
      u.burnAoe.turnsLeft--;
      if (u.burnAoe.turnsLeft <= 0) u.burnAoe = null;
    }
  });
  cleanDeadFromField(battle.enemyField);
  // Burn AoE : inflige degats aux unites joueur qui brulent
  getFieldAlive(battle.playerField).forEach(u => {
    if (u.burnAoe) {
      u.currentHp = Math.max(0, u.currentHp - u.burnAoe.damage);
      events.push({ type: 'type_passive', desc: `${u.name} brule ! -${u.burnAoe.damage} PV` });
      if (u.currentHp <= 0) checkKO(u, events, battle);
      u.burnAoe.turnsLeft--;
      if (u.burnAoe.turnsLeft <= 0) u.burnAoe = null;
    }
  });
  cleanDeadFromField(battle.playerField);

  // Passif Leviathan Abyssal : +1 ATK aux allies Eau en debut de tour
  const leviathanCountP = getFieldAlive(battle.playerField).filter(u => u.name === 'Leviathan Abyssal').length;
  if (leviathanCountP > 0) {
    getFieldAlive(battle.playerField).filter(u => hasElement(u, 'eau')).forEach(u => {
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

  // === PASSIFS v1.4.0/v1.5.0 JOUEUR ===
  // Dragon des Abysses joueur : +1 ATK allies Eau
  const dragonAbyssesCountP = getFieldAlive(battle.playerField).filter(u => u.name === 'Dragon des Abysses').length;
  if (dragonAbyssesCountP > 0) {
    getFieldAlive(battle.playerField).filter(u => hasElement(u, 'eau')).forEach(u => { u.buffAtk += dragonAbyssesCountP; });
    events.push({ type: 'type_passive', desc: `Dragon des Abysses : +${dragonAbyssesCountP} ATK Eau` });
  }
  // Ombre Mimetique joueur : -1 HP par tour (instable)
  getFieldAlive(battle.playerField).filter(u => u.name === 'Ombre Mimetique').forEach(u => {
    u.currentHp = Math.max(1, u.currentHp - 1);
    events.push({ type: 'type_passive', desc: `${u.name} perd 1 PV (instable)` });
  });
  // Abyssia joueur : soigne 1 HP allies Eau
  const abyssiaCountP = getFieldAlive(battle.playerField).filter(u => u.name === 'Abyssia').length;
  if (abyssiaCountP > 0) {
    getFieldAlive(battle.playerField).filter(u => hasElement(u, 'eau')).forEach(u => {
      u.currentHp = Math.min(u.maxHp, u.currentHp + abyssiaCountP);
    });
    events.push({ type: 'type_passive', desc: `Abyssia : +${abyssiaCountP} PV aux Eau` });
  }
  // Le De du Destin joueur : ATK et DEF aleatoires (0-4)
  getFieldAlive(battle.playerField).filter(u => u.name === 'Le De du Destin').forEach(u => {
    const newAtk = Math.floor(Math.random() * 5);
    const newDef = Math.floor(Math.random() * 5);
    u.buffAtk = newAtk - ((u.effectiveStats?.attack || u.attack || 0) + (u.permanentBonusAtk || 0));
    u.buffDef = newDef - ((u.effectiveStats?.defense || u.defense || 0) + (u.permanentBonusDef || 0));
    events.push({ type: 'type_passive', desc: `${u.name} : ATK=${newAtk}, DEF=${newDef} (aleatoire)` });
  });
  // Le Neant Originel joueur : +1 ATK permanent par tour, auto-trigger a 5+ ATK
  getFieldAlive(battle.playerField).filter(u => u.name === 'Le Neant Originel').forEach(u => {
    u.permanentBonusAtk = (u.permanentBonusAtk || 0) + 1;
    const totalAtk = (u.effectiveStats?.attack || u.attack || 0) + (u.buffAtk || 0) + (u.permanentBonusAtk || 0);
    events.push({ type: 'type_passive', desc: `${u.name} gagne en puissance ! ATK ${totalAtk}` });
    if (totalAtk >= 5 && !u.usedAbility) {
      const ae = resolveAbility(u, getFieldAlive(battle.enemyField), getFieldAlive(battle.playerField), getFieldAlive(battle.enemyField), battle);
      events.push(...ae);
      cleanDeadFromField(battle.playerField);
      cleanDeadFromField(battle.enemyField);
    }
  });
  // Chronos joueur : retire un buff aleatoire d un ennemi
  getFieldAlive(battle.playerField).filter(u => u.name === 'Chronos').forEach(() => {
    const buffed = getFieldAlive(battle.enemyField).filter(e => e.buffAtk > 0 || e.buffDef > 0 || (e.permanentBonusAtk || 0) > 0);
    if (buffed.length > 0) {
      const t = buffed[Math.floor(Math.random() * buffed.length)];
      if (t.buffAtk > 0) t.buffAtk = Math.max(0, t.buffAtk - 1);
      else if ((t.permanentBonusAtk || 0) > 0) t.permanentBonusAtk -= 1;
      else if (t.buffDef > 0) t.buffDef = Math.max(0, t.buffDef - 1);
      events.push({ type: 'type_passive', desc: `Chronos neutralise un buff de ${t.name}` });
    }
  });
  // Colosse de Corail joueur : +1 DEF par token Corail en vie
  getFieldAlive(battle.playerField).filter(u => u.name === 'Colosse de Corail').forEach(colosse => {
    const tokenCount = getFieldAlive(battle.playerField).filter(u => u.isToken && u.name === 'Corail').length;
    if (tokenCount > 0) {
      colosse.buffDef += tokenCount;
      events.push({ type: 'type_passive', desc: `Colosse de Corail : +${tokenCount} DEF (tokens Corail)` });
    }
  });

  // === PASSIFS TURN-START v0.2.3 JOUEUR ===
  // Plante Carnivore : regen 1 PV/tour
  getFieldAlive(battle.playerField).filter(u => u.name === 'Plante Carnivore').forEach(u => {
    if (u.currentHp < u.maxHp) {
      u.currentHp = Math.min(u.maxHp, u.currentHp + 1);
      events.push({ type: 'type_passive', desc: `Plante Carnivore regenere 1 PV` });
    }
  });
  // Yggdrasil : regen 2 PV a tous les allies
  const yggCountP = getFieldAlive(battle.playerField).filter(u => u.name === 'Yggdrasil').length;
  if (yggCountP > 0) {
    getFieldAlive(battle.playerField).forEach(u => {
      if (u.currentHp < u.maxHp) {
        u.currentHp = Math.min(u.maxHp, u.currentHp + 2 * yggCountP);
      }
    });
    events.push({ type: 'type_passive', desc: `Yggdrasil regenere ${2 * yggCountP} PV a tous les allies` });
  }
  // Tortue Bombe joueur : +1 DEF/tour
  getFieldAlive(battle.playerField).filter(u => u.name === 'Tortue Bombe').forEach(u => {
    u.permanentBonusDef = (u.permanentBonusDef || 0) + 1;
    events.push({ type: 'type_passive', desc: `Tortue Bombe accumule sa puissance ! +1 DEF` });
  });
  // Infection tick (joueur) : les unites infectees perdent des PV
  for (const unit of getFieldAlive(battle.playerField)) {
    if (unit.infectedDot > 0 && unit.infectedDotTurns > 0) {
      unit.currentHp = Math.max(1, unit.currentHp - unit.infectedDot);
      events.push({ type: 'poison_tick', unit: unit.name, damage: unit.infectedDot, desc: `Infection ! (${unit.infectedDotTurns} tours)` });
      unit.infectedDotTurns--;
      if (unit.infectedDotTurns <= 0) unit.infectedDot = 0;
      if (unit.currentHp <= 0) checkKO(unit, events, battle);
    }
  }
  cleanDeadFromField(battle.playerField);
  // Infection tick (ennemi) : les unites ennemies infectees perdent des PV
  for (const unit of getFieldAlive(battle.enemyField)) {
    if (unit.infectedDot > 0 && unit.infectedDotTurns > 0) {
      unit.currentHp = Math.max(1, unit.currentHp - unit.infectedDot);
      events.push({ type: 'poison_tick', unit: unit.name, damage: unit.infectedDot, desc: `Infection ! (${unit.infectedDotTurns} tours)` });
      unit.infectedDotTurns--;
      if (unit.infectedDotTurns <= 0) unit.infectedDot = 0;
      if (unit.currentHp <= 0) checkKO(unit, events, battle);
    }
  }
  cleanDeadFromField(battle.enemyField);
  // Reflect decay (tous) : expiration du reflect
  for (const unit of [...getFieldAlive(battle.playerField), ...getFieldAlive(battle.enemyField)]) {
    if (unit.reflectTurns > 0) {
      unit.reflectTurns--;
      if (unit.reflectTurns <= 0) {
        unit.reflectDamage = 0;
        events.push({ type: 'type_passive', desc: `${unit.name} : le reflet s estompe` });
      }
    }
  }
  // Swap timer decay : decrémenter les echanges du Marionnettiste
  for (const unit of [...getFieldAlive(battle.playerField), ...getFieldAlive(battle.enemyField)]) {
    if (unit.swapTimer > 0) {
      unit.swapTimer--;
      if (unit.swapTimer <= 0 && unit.swappedOriginalSide) {
        // Re-swap : remettre la carte a sa place
        const currentField = unit.side === 'player' ? battle.playerField : battle.enemyField;
        const originalField = unit.swappedOriginalSide === 'player' ? battle.playerField : battle.enemyField;
        const currentIdx = currentField.indexOf(unit);
        if (currentIdx !== -1) {
          // Trouver un slot vide dans le champ d'origine
          const emptySlot = originalField.findIndex(s => s === null || (s && !s.alive));
          if (emptySlot !== -1) {
            currentField[currentIdx] = null;
            unit.side = unit.swappedOriginalSide;
            unit.swappedOriginalSide = null;
            originalField[emptySlot] = unit;
            events.push({ type: 'type_passive', desc: `${unit.name} retourne dans son camp !` });
          }
        }
      }
    }
  }

  // Link decay (lien vital) : decrémenter les liens
  for (const unit of [...getFieldAlive(battle.playerField), ...getFieldAlive(battle.enemyField)]) {
    if (unit.linkedTurns > 0) {
      unit.linkedTurns--;
      if (unit.linkedTurns <= 0) {
        unit.linkedTo = null;
        events.push({ type: 'type_passive', desc: `${unit.name} : le lien se brise` });
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
  const totalTempCards = db.prepare('SELECT COUNT(*) as c FROM user_cards WHERE is_temp = 1').get().c;
  const totalShinyCards = db.prepare('SELECT COUNT(*) as c FROM user_cards WHERE is_shiny = 1').get().c;
  res.json({ totalUsers, totalCards, totalCardTypes, totalBattles, totalTempCards, totalShinyCards });
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

// Reset a user (delete all cards, reset credits)
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

// ============================================
// ADMIN: TEST BATTLE
// ============================================
app.post('/api/admin/battle/test-start', requireAdmin, (req, res) => {
  const { playerCardIds, enemyCardIds } = req.body;

  // Build player cards
  let playerCards;
  if (playerCardIds && playerCardIds.length > 0) {
    const placeholders = playerCardIds.map(() => '?').join(',');
    const dbCards = db.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...playerCardIds);
    const cardMap = {};
    dbCards.forEach(c => { cardMap[c.id] = c; });
    // Preserve order and duplicates from selection
    playerCards = playerCardIds.map(id => cardMap[id]).filter(Boolean);
    // Pad to 20 by cycling
    const base = [...playerCards];
    while (playerCards.length < 20) {
      playerCards.push({ ...base[playerCards.length % base.length] });
    }
  } else {
    playerCards = STARTER_DECK.map(c => ({ ...c }));
  }

  // Build enemy cards
  let enemyCards;
  if (enemyCardIds && enemyCardIds.length > 0) {
    const placeholders = enemyCardIds.map(() => '?').join(',');
    const dbCards = db.prepare(`SELECT * FROM cards WHERE id IN (${placeholders})`).all(...enemyCardIds);
    const cardMap = {};
    dbCards.forEach(c => { cardMap[c.id] = c; });
    enemyCards = enemyCardIds.map(id => cardMap[id]).filter(Boolean);
    const base = [...enemyCards];
    while (enemyCards.length < 20) {
      enemyCards.push({ ...base[enemyCards.length % base.length] });
    }
  } else {
    enemyCards = STARTER_DECK.map(c => ({ ...c }));
  }

  const battle = createDeckBattleState(playerCards, enemyCards, 'test');

  // Override for test mode: unlimited resources
  battle.testMode = true;
  battle.playerEnergy = 99;
  battle.playerMaxEnergy = 99;
  battle.playerCrystal = 99;
  battle.playerMaxCrystal = 99;
  battle.enemyEnergy = 99;
  battle.enemyMaxEnergy = 99;
  battle.enemyCrystal = 99;
  battle.enemyMaxCrystal = 99;

  // Remove summoning sickness from initial hand
  battle.playerHand.forEach(c => { c.noSickness = true; });

  const snap = getDeckBattleSnapshot(battle);
  snap.opponentName = 'MODE TEST';
  res.json(snap);
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

// --- Build AI Deck adapte au joueur ---
const AI_NAMES = ['Maitre d\'Arene', 'Champion du Rift', 'Gardien des Abimes', 'Sentinelle Celeste', 'Erudit des Ombres', 'Gladiateur Infernal'];

function buildAIDeck(playerCards) {
  const RARITY_WEIGHT = { commune: 1, rare: 2, epique: 4, legendaire: 7 };

  // Calculer le power level du joueur
  const playerPower = playerCards.reduce((sum, c) => {
    return sum + (c.attack + c.defense + c.hp) * (RARITY_WEIGHT[c.rarity] || 1);
  }, 0);

  // Compter les raretés du joueur
  const playerRarities = {};
  playerCards.forEach(c => { playerRarities[c.rarity] = (playerRarities[c.rarity] || 0) + 1; });

  // Récupérer toutes les cartes creature de la DB
  const allCards = db.prepare("SELECT * FROM cards WHERE type = 'creature'").all();
  if (allCards.length === 0) {
    return { enemyCards: STARTER_DECK.map(c => ({ ...c })), opponentName: 'Entraineur IA' };
  }

  // Grouper par rareté
  const byRarity = {};
  allCards.forEach(c => {
    if (!byRarity[c.rarity]) byRarity[c.rarity] = [];
    byRarity[c.rarity].push(c);
  });

  const deck = [];
  const cardCounts = {};

  // Construire avec un ratio de raretés similaire au joueur
  const targetRarities = {
    commune: playerRarities.commune || 8,
    rare: playerRarities.rare || 7,
    epique: playerRarities.epique || 4,
    legendaire: Math.min(playerRarities.legendaire || 0, 3)
  };

  // Si le joueur est faible (que des communes), donner un deck plus fort quand meme
  const totalNonCommune = (targetRarities.rare || 0) + (targetRarities.epique || 0) + (targetRarities.legendaire || 0);
  if (totalNonCommune < 4) {
    targetRarities.rare = Math.max(targetRarities.rare, 6);
    targetRarities.epique = Math.max(targetRarities.epique, 2);
  }

  // Remplir chaque rareté
  for (const rarity of ['legendaire', 'epique', 'rare', 'commune']) {
    const pool = byRarity[rarity] || [];
    if (pool.length === 0) continue;
    let needed = targetRarities[rarity] || 0;

    // Mélanger le pool
    const shuffled = [...pool].sort(() => Math.random() - 0.5);

    for (const card of shuffled) {
      if (needed <= 0 || deck.length >= 20) break;
      const count = cardCounts[card.name] || 0;
      const maxCopies = rarity === 'legendaire' ? 1 : 3;
      if (count >= maxCopies) continue;
      deck.push({ ...card });
      cardCounts[card.name] = count + 1;
      needed--;
    }
  }

  // Compléter à 20 si pas assez
  while (deck.length < 20) {
    const pool = byRarity.commune || byRarity.rare || allCards;
    const card = pool[Math.floor(Math.random() * pool.length)];
    const count = cardCounts[card.name] || 0;
    if (count >= 3) continue;
    deck.push({ ...card });
    cardCounts[card.name] = count + 1;
  }

  // Mélanger le deck final
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const opponentName = AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)];
  return { enemyCards: deck, opponentName };
}

// Starter deck — cartes faibles pour tester sans collection
const STARTER_DECK = [
  // 4x Goblin (1 mana, terre)
  { name:'Goblin',emoji:'🗡️',rarity:'commune',type:'creature',element:'terre',attack:2,defense:1,hp:3,mana_cost:1,ability_name:'Appel gobelin',ability_desc:'Invoque un Goblin 1/1/2',crystal_cost:1,passive_desc:'+1 ATK si un autre Goblin est sur le terrain' },
  { name:'Goblin',emoji:'🗡️',rarity:'commune',type:'creature',element:'terre',attack:2,defense:1,hp:3,mana_cost:1,ability_name:'Appel gobelin',ability_desc:'Invoque un Goblin 1/1/2',crystal_cost:1,passive_desc:'+1 ATK si un autre Goblin est sur le terrain' },
  { name:'Goblin',emoji:'🗡️',rarity:'commune',type:'creature',element:'terre',attack:2,defense:1,hp:3,mana_cost:1,ability_name:'Appel gobelin',ability_desc:'Invoque un Goblin 1/1/2',crystal_cost:1,passive_desc:'+1 ATK si un autre Goblin est sur le terrain' },
  { name:'Goblin',emoji:'🗡️',rarity:'commune',type:'creature',element:'terre',attack:2,defense:1,hp:3,mana_cost:1,ability_name:'Appel gobelin',ability_desc:'Invoque un Goblin 1/1/2',crystal_cost:1,passive_desc:'+1 ATK si un autre Goblin est sur le terrain' },
  // 3x Tortue des Rivieres (4 mana, eau)
  { name:'Tortue des Rivieres',emoji:'🐢',rarity:'commune',type:'creature',element:'eau',attack:1,defense:4,hp:5,mana_cost:4,ability_name:'Carapace marine',ability_desc:'+2 DEF a un allie jusqu au prochain tour',crystal_cost:1,passive_desc:'Les unites Eau alliees gagnent +1 PV' },
  { name:'Tortue des Rivieres',emoji:'🐢',rarity:'commune',type:'creature',element:'eau',attack:1,defense:4,hp:5,mana_cost:4,ability_name:'Carapace marine',ability_desc:'+2 DEF a un allie jusqu au prochain tour',crystal_cost:1,passive_desc:'Les unites Eau alliees gagnent +1 PV' },
  { name:'Tortue des Rivieres',emoji:'🐢',rarity:'commune',type:'creature',element:'eau',attack:1,defense:4,hp:5,mana_cost:4,ability_name:'Carapace marine',ability_desc:'+2 DEF a un allie jusqu au prochain tour',crystal_cost:1,passive_desc:'Les unites Eau alliees gagnent +1 PV' },
  // 3x Serpent des Marees (2 mana, eau)
  { name:'Serpent des Marees',emoji:'🐍',rarity:'rare',type:'creature',element:'eau',attack:2,defense:1,hp:3,mana_cost:2,ability_name:'Frappe empoisonnee',ability_desc:'Applique poison pendant 4 tours',crystal_cost:1,passive_desc:'Poison dure 1 tour de plus' },
  { name:'Serpent des Marees',emoji:'🐍',rarity:'rare',type:'creature',element:'eau',attack:2,defense:1,hp:3,mana_cost:2,ability_name:'Frappe empoisonnee',ability_desc:'Applique poison pendant 4 tours',crystal_cost:1,passive_desc:'Poison dure 1 tour de plus' },
  { name:'Serpent des Marees',emoji:'🐍',rarity:'rare',type:'creature',element:'eau',attack:2,defense:1,hp:3,mana_cost:2,ability_name:'Frappe empoisonnee',ability_desc:'Applique poison pendant 4 tours',crystal_cost:1,passive_desc:'Poison dure 1 tour de plus' },
  // 3x Mage de Foudre (3 mana, eau)
  { name:'Mage de Foudre',emoji:'🌊',rarity:'rare',type:'creature',element:'eau',attack:3,defense:1,hp:3,mana_cost:3,ability_name:'Eclair',ability_desc:'2 degats (ignore DEF)',crystal_cost:1,passive_desc:'+20% degats ability' },
  { name:'Mage de Foudre',emoji:'🌊',rarity:'rare',type:'creature',element:'eau',attack:3,defense:1,hp:3,mana_cost:3,ability_name:'Eclair',ability_desc:'2 degats (ignore DEF)',crystal_cost:1,passive_desc:'+20% degats ability' },
  { name:'Mage de Foudre',emoji:'🌊',rarity:'rare',type:'creature',element:'eau',attack:3,defense:1,hp:3,mana_cost:3,ability_name:'Eclair',ability_desc:'2 degats (ignore DEF)',crystal_cost:1,passive_desc:'+20% degats ability' },
  // 2x Salamandre Ardente (3 mana, feu)
  { name:'Salamandre Ardente',emoji:'🦎',rarity:'rare',type:'creature',element:'feu',attack:3,defense:1,hp:3,mana_cost:3,ability_name:'Flamme adjacente',ability_desc:'1 degat cible + adjacents',crystal_cost:1,passive_desc:'+1 ATK par KO realise' },
  { name:'Salamandre Ardente',emoji:'🦎',rarity:'rare',type:'creature',element:'feu',attack:3,defense:1,hp:3,mana_cost:3,ability_name:'Flamme adjacente',ability_desc:'1 degat cible + adjacents',crystal_cost:1,passive_desc:'+1 ATK par KO realise' },
  // 2x Esprit des Forets (3 mana, terre)
  { name:'Esprit des Forets',emoji:'🌿',rarity:'rare',type:'creature',element:'terre',attack:1,defense:3,hp:4,mana_cost:3,ability_name:'Croissance',ability_desc:'+1 DEF equipe',crystal_cost:1.5,passive_desc:'Soin 1 PV par tour' },
  { name:'Esprit des Forets',emoji:'🌿',rarity:'rare',type:'creature',element:'terre',attack:1,defense:3,hp:4,mana_cost:3,ability_name:'Croissance',ability_desc:'+1 DEF equipe',crystal_cost:1.5,passive_desc:'Soin 1 PV par tour' },
  // 2x Dragonnet de Braise (4 mana, feu)
  { name:'Dragonnet de Braise',emoji:'🐉',rarity:'epique',type:'creature',element:'feu',attack:3,defense:2,hp:4,mana_cost:4,ability_name:'Souffle de braise',ability_desc:'1 degat a tous les ennemis',crystal_cost:1.5,passive_desc:'+1 ATK si 2+ Betes sur le terrain' },
  { name:'Dragonnet de Braise',emoji:'🐉',rarity:'epique',type:'creature',element:'feu',attack:3,defense:2,hp:4,mana_cost:4,ability_name:'Souffle de braise',ability_desc:'1 degat a tous les ennemis',crystal_cost:1.5,passive_desc:'+1 ATK si 2+ Betes sur le terrain' },
  // 1x Golem de Roche (5 mana, terre)
  { name:'Golem de Roche',emoji:'🪨',rarity:'epique',type:'creature',element:'terre',attack:2,defense:5,hp:7,mana_cost:5,ability_name:'Fortification',ability_desc:'+3 DEF ce tour',crystal_cost:1,passive_desc:'+2 DEF si PV < 30%' },
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

// Admin reset mine (for testing)
app.post('/api/mine/reset', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const upgrades = getMineUpgrades(userId);
  const rocks = generateMineRocks(upgrades.mine_speed, upgrades.luck);
  db.prepare('UPDATE mine_state SET grid = ?, last_sell_at = NULL WHERE user_id = ?').run(JSON.stringify(rocks), userId);
  db.prepare('DELETE FROM mine_inventory WHERE user_id = ?').run(userId);
  res.json({ success: true, rocks: rocks.length });
});

// GET mine state (or create new mine)
app.get('/api/mine/state', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const upgrades = getMineUpgrades(userId);
  const cooldownTotal = getMineCooldown(userId);

  let mine = db.prepare('SELECT * FROM mine_state WHERE user_id = ?').get(userId);

  // Verifier si le cooldown est expire et regenerer les pierres
  let cooldownRemaining = 0;
  let needsRegen = false;

  if (mine && mine.last_sell_at) {
    const sellTime = new Date(mine.last_sell_at + 'Z').getTime();
    const elapsed = Date.now() - sellTime;
    const cooldownMs = cooldownTotal * 1000;
    if (elapsed < cooldownMs) {
      cooldownRemaining = Math.ceil((cooldownMs - elapsed) / 1000);
    } else {
      // Cooldown expire, verifier si les pierres doivent etre regenerees
      const rocks = JSON.parse(mine.grid || '[]');
      const allMined = rocks.length > 0 && rocks.every(r => r.mined);
      if (allMined) needsRegen = true;
    }
  }

  // Detecter ancien format (grille 400 blocs) et forcer regen
  if (mine && !needsRegen) {
    const oldGrid = JSON.parse(mine.grid || '[]');
    if (oldGrid.length > 10) needsRegen = true; // Ancien format 20x20
  }

  if (!mine || needsRegen) {
    const rocks = generateMineRocks(upgrades.mine_speed, upgrades.luck);
    if (!mine) {
      db.prepare('INSERT INTO mine_state (user_id, grid, hidden_charbon, hidden_fer, hidden_or, hidden_diamant) VALUES (?, ?, 0, 0, 0, 0)')
        .run(userId, JSON.stringify(rocks));
    } else {
      db.prepare('UPDATE mine_state SET grid = ?, last_sell_at = NULL, created_at = CURRENT_TIMESTAMP WHERE user_id = ?')
        .run(JSON.stringify(rocks), userId);
      // Supprimer les minerais restants au sol
      db.prepare('DELETE FROM mine_inventory WHERE user_id = ?').run(userId);
    }
    mine = db.prepare('SELECT * FROM mine_state WHERE user_id = ?').get(userId);
    cooldownRemaining = 0;
  }

  const rocks = JSON.parse(mine.grid || '[]');
  const minerals = getMineInventory(userId);
  const user = db.prepare('SELECT credits, excavation_essence FROM users WHERE id = ?').get(userId);

  res.json({
    rocks,
    minerals,
    upgrades: { mine_speed: upgrades.mine_speed, inventory_size: upgrades.inventory_size, luck: upgrades.luck },
    essence: user.excavation_essence || 0,
    credits: user.credits,
    cooldownRemaining,
    cooldownTotal
  });
});

// POST miner une pierre
app.post('/api/mine/hit', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { index } = req.body;

  // Energy check
  const energyResult = consumeEnergy(userId, ENERGY_CONFIG.costs.mine_tap);
  if (!energyResult.success) return res.json({ success: false, noEnergy: true, energy: energyResult.energy, needed: ENERGY_CONFIG.costs.mine_tap });

  const mine = db.prepare('SELECT * FROM mine_state WHERE user_id = ?').get(userId);
  if (!mine) return res.status(400).json({ error: 'Aucune mine active' });

  // Verifier cooldown
  const upgrades = getMineUpgrades(userId);
  const cooldownTotal = getMineCooldown(userId);
  if (mine.last_sell_at) {
    const elapsed = Date.now() - new Date(mine.last_sell_at + 'Z').getTime();
    if (elapsed < cooldownTotal * 1000) {
      return res.json({ success: false, cooldown: true });
    }
  }

  const rocks = JSON.parse(mine.grid || '[]');
  if (index === undefined || index < 0 || index >= rocks.length) {
    return res.status(400).json({ error: 'Index invalide' });
  }

  const rock = rocks[index];
  if (rock.mined) {
    return res.json({ success: false, error: 'Pierre deja minee' });
  }

  // Miner la pierre
  rock.mined = true;
  const mineral = rock.mineral;

  // Ajouter le minerai au sol (mine_inventory)
  const inventory = getMineInventory(userId);
  const nextSlot = inventory.length;
  db.prepare('INSERT INTO mine_inventory (user_id, resource, slot_index) VALUES (?, ?, ?)').run(userId, mineral, nextSlot);

  // Track diamond mining
  if (mineral === 'diamant') {
    db.prepare('UPDATE users SET stat_diamonds_mined = stat_diamonds_mined + 1 WHERE id = ?').run(userId);
    updateQuestProgress(userId, 'diamond_mine', 1);
    checkAchievements(userId);
  }

  // Verifier si toutes les pierres sont minees
  const allMined = rocks.every(r => r.mined);

  if (allMined) {
    // Demarrer le cooldown de 14 minutes
    db.prepare('UPDATE mine_state SET grid = ?, last_sell_at = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(JSON.stringify(rocks), userId);
  } else {
    db.prepare('UPDATE mine_state SET grid = ? WHERE user_id = ?')
      .run(JSON.stringify(rocks), userId);
  }

  res.json({
    success: true,
    mineral,
    rock: { id: rock.id, mined: true, mineral },
    allMined,
    cooldownTotal: allMined ? cooldownTotal : 0
  });
});

// POST vendre tous les minerais
app.post('/api/mine/sell-all', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const items = getMineInventory(userId);

  if (!items.length) return res.json({ success: false, error: 'Rien a vendre' });

  let totalPrice = 0;
  const details = {};
  items.forEach(item => {
    const price = MINE_RESOURCES[item.resource]?.price || 0;
    totalPrice += price;
    details[item.resource] = (details[item.resource] || 0) + 1;
  });

  const sellAllTx = db.transaction(() => {
    db.prepare('DELETE FROM mine_inventory WHERE user_id = ?').run(userId);
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(totalPrice, userId);
  });
  sellAllTx();

  addBattlePassXP(userId, BP_XP.mine_sell);
  updateQuestProgress(userId, 'credits_earned', totalPrice);
  checkAchievements(userId);

  const credits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;

  res.json({ success: true, credits, totalSold: totalPrice, itemsSold: items.length, details });
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

// POST acheter amelioration
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
  const special = db.prepare('SELECT * FROM user_quests WHERE user_id = ? AND type = ? AND assigned_date = ? ORDER BY id').all(userId, 'special', today);

  // Attach labels from QUEST_POOL
  const addLabel = (q) => {
    const allDefs = [...QUEST_POOL.daily, ...QUEST_POOL.weekly, ...SPECIAL_CHALLENGE_POOL];
    const def = allDefs.find(d => d.key === q.quest_key);
    return {
      ...q,
      label: def ? def.label.replace('{goal}', q.goal) : q.quest_key,
      canClaim: q.progress >= q.goal && !q.claimed
    };
  };

  res.json({
    daily: daily.map(addLabel),
    weekly: weekly.map(addLabel),
    special: special.map(addLabel)
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

// --- FREE DAILY BOOSTER ---
app.post('/api/daily-booster', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare('SELECT last_daily FROM users WHERE id = ?').get(userId);
  const today = new Date().toISOString().split('T')[0];

  if (user.last_daily === today) {
    return res.status(400).json({ error: 'Deja recupere aujourd\'hui !' });
  }

  // Give 3 free cards (like a mini booster)
  const weights = { commune: 60, rare: 30, epique: 8, legendaire: 2 };
  const cards = [];
  for (let i = 0; i < 3; i++) {
    const roll = Math.random() * 100;
    let rarity = 'commune';
    let cumul = 0;
    for (const [r, w] of Object.entries(weights)) {
      cumul += w;
      if (roll < cumul) { rarity = r; break; }
    }
    const pool = db.prepare('SELECT * FROM cards WHERE rarity = ?').all(rarity);
    if (pool.length > 0) {
      const card = pool[Math.floor(Math.random() * pool.length)];
      db.prepare('INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)').run(userId, card.id);
      cards.push(card);
    }
  }

  db.prepare('UPDATE users SET last_daily = ? WHERE id = ?').run(today, userId);
  addBattlePassXP(userId, BP_XP.daily_login);
  updateQuestProgress(userId, 'daily_claim', 1);
  checkAchievements(userId);

  res.json({ success: true, cards });
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

  const totalCombat = (user.stat_pvp_wins || 0) + (user.stat_pvp_losses || 0);
  res.json({
    combat: { wins: user.stat_pvp_wins || 0, losses: user.stat_pvp_losses || 0, winRate: totalCombat > 0 ? Math.round((user.stat_pvp_wins / totalCombat) * 100) : 0 },
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
// MARCHE (Trading Market) API
// ============================================

function isCardOnMarket(userCardId) {
  return !!db.prepare("SELECT id FROM market_listings WHERE user_card_id = ? AND status = 'active'").get(userCardId);
}

app.get('/market', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'market.html'));
});

app.get('/api/market', requireAuth, (req, res) => {
  const { rarity, element, search, sort, page } = req.query;
  const pageSize = 20;
  const offset = ((parseInt(page) || 1) - 1) * pageSize;

  let where = "WHERE ml.status = 'active'";
  const params = [];

  if (rarity && rarity !== 'all') { where += ' AND c.rarity = ?'; params.push(rarity); }
  if (element && element !== 'all') { where += ' AND c.element = ?'; params.push(element); }
  if (search) { where += ' AND c.name LIKE ?'; params.push('%' + search + '%'); }

  let orderBy = 'ORDER BY ml.created_at DESC';
  if (sort === 'price_asc') orderBy = 'ORDER BY ml.price ASC';
  else if (sort === 'price_desc') orderBy = 'ORDER BY ml.price DESC';
  else if (sort === 'rarity') orderBy = "ORDER BY CASE c.rarity WHEN 'secret' THEN 0 WHEN 'chaos' THEN 1 WHEN 'legendaire' THEN 2 WHEN 'epique' THEN 3 WHEN 'rare' THEN 4 WHEN 'commune' THEN 5 END";

  const total = db.prepare(`SELECT COUNT(*) as total FROM market_listings ml JOIN cards c ON ml.card_id = c.id ${where}`).get(...params).total;

  const listings = db.prepare(`
    SELECT ml.id as listingId, ml.price, ml.created_at as listedAt,
      ml.seller_id as sellerId, u.username as sellerName, u.display_name as sellerDisplayName, u.avatar as sellerAvatar,
      c.id as cardId, c.name, c.rarity, c.type, c.element, c.attack, c.defense, c.hp, c.mana_cost, c.ability_name, c.ability_desc, c.image, c.emoji,
      uc.is_shiny, uc.is_fused, uc.is_temp
    FROM market_listings ml
    JOIN user_cards uc ON ml.user_card_id = uc.id
    JOIN cards c ON ml.card_id = c.id
    JOIN users u ON ml.seller_id = u.id
    ${where} ${orderBy} LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  res.json({ listings, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / pageSize) });
});

app.get('/api/market/my-listings', requireAuth, (req, res) => {
  const listings = db.prepare(`
    SELECT ml.id as listingId, ml.price, ml.status, ml.created_at as listedAt,
      c.id as cardId, c.name, c.rarity, c.type, c.element, c.attack, c.defense, c.hp, c.emoji, c.image,
      uc.is_shiny, uc.is_fused, uc.is_temp
    FROM market_listings ml
    JOIN user_cards uc ON ml.user_card_id = uc.id
    JOIN cards c ON ml.card_id = c.id
    WHERE ml.seller_id = ? AND ml.status = 'active'
    ORDER BY ml.created_at DESC
  `).all(req.session.userId);
  res.json(listings);
});

app.get('/api/market/my-cards', requireAuth, (req, res) => {
  const cards = db.prepare(`
    SELECT uc.id as userCardId, uc.is_shiny, uc.is_fused, uc.is_temp,
      c.id as cardId, c.name, c.rarity, c.type, c.element, c.attack, c.defense, c.hp, c.mana_cost, c.ability_name, c.ability_desc, c.emoji, c.image
    FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ?
    ORDER BY CASE c.rarity WHEN 'secret' THEN 0 WHEN 'chaos' THEN 1 WHEN 'legendaire' THEN 2 WHEN 'epique' THEN 3 WHEN 'rare' THEN 4 WHEN 'commune' THEN 5 END, c.name
  `).all(req.session.userId);

  // Mark cards already on market
  cards.forEach(card => {
    card.onMarket = isCardOnMarket(card.userCardId);
  });
  res.json(cards);
});

app.post('/api/market/sell', requireAuth, (req, res) => {
  const { userCardId, price } = req.body;
  const userId = req.session.userId;

  if (!userCardId || !price) return res.status(400).json({ error: 'Parametres manquants' });
  const intPrice = parseInt(price);
  if (!Number.isInteger(intPrice) || intPrice < 10 || intPrice > 999999) return res.status(400).json({ error: 'Prix entre 10 et 999 999 CR' });

  const userCard = db.prepare('SELECT uc.*, c.name, c.rarity FROM user_cards uc JOIN cards c ON uc.card_id = c.id WHERE uc.id = ? AND uc.user_id = ?').get(userCardId, userId);
  if (!userCard) return res.status(400).json({ error: 'Carte introuvable' });
  if (isCardOnMarket(userCardId)) return res.status(400).json({ error: 'Carte deja en vente' });

  const inDeck = db.prepare('SELECT id FROM deck_cards WHERE user_card_id = ?').get(userCardId);
  if (inDeck) return res.status(400).json({ error: 'Retirez la carte de votre deck d\'abord' });

  const activeCount = db.prepare("SELECT COUNT(*) as c FROM market_listings WHERE seller_id = ? AND status = 'active'").get(userId).c;
  if (activeCount >= 20) return res.status(400).json({ error: 'Maximum 20 cartes en vente' });

  db.prepare('INSERT INTO market_listings (seller_id, user_card_id, card_id, price) VALUES (?, ?, ?, ?)').run(userId, userCardId, userCard.card_id, intPrice);
  res.json({ success: true, message: userCard.name + ' en vente pour ' + intPrice + ' CR' });
});

app.post('/api/market/buy', requireAuth, (req, res) => {
  const { listingId } = req.body;
  const buyerId = req.session.userId;

  const buyTx = db.transaction(() => {
    const listing = db.prepare("SELECT * FROM market_listings WHERE id = ? AND status = 'active'").get(listingId);
    if (!listing) throw new Error('Offre introuvable ou deja vendue');
    if (listing.seller_id === buyerId) throw new Error('Impossible d\'acheter votre propre carte');

    const buyer = db.prepare('SELECT credits FROM users WHERE id = ?').get(buyerId);
    if (buyer.credits < listing.price) throw new Error('Credits insuffisants');

    const tax = Math.floor(listing.price * 0.10);
    const sellerReceives = listing.price - tax;

    db.prepare('UPDATE users SET credits = credits - ?, stat_market_purchases = stat_market_purchases + 1 WHERE id = ?').run(listing.price, buyerId);
    db.prepare('UPDATE users SET credits = credits + ?, stat_market_sales = stat_market_sales + 1, stat_total_earned = stat_total_earned + ? WHERE id = ?').run(sellerReceives, sellerReceives, listing.seller_id);
    db.prepare('UPDATE user_cards SET user_id = ? WHERE id = ?').run(buyerId, listing.user_card_id);
    db.prepare("UPDATE market_listings SET status = 'sold', sold_at = CURRENT_TIMESTAMP, buyer_id = ? WHERE id = ?").run(buyerId, listingId);

    return { listing, sellerReceives, tax };
  });

  try {
    const result = buyTx();
    const card = db.prepare('SELECT name, emoji FROM cards WHERE id = ?').get(result.listing.card_id);
    const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(buyerId).credits;

    // Notify seller via socket
    const sellerSocket = userSocketMap.get(result.listing.seller_id);
    if (sellerSocket) {
      sellerSocket.emit('notification', { message: (card.emoji || '') + ' ' + card.name + ' vendue pour ' + result.listing.price + ' CR (recu: ' + result.sellerReceives + ' CR)', type: 'success' });
    }

    res.json({ success: true, credits: newCredits, message: (card.emoji || '') + ' ' + card.name + ' achetee pour ' + result.listing.price + ' CR (taxe: ' + result.tax + ' CR)' });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/market/cancel', requireAuth, (req, res) => {
  const { listingId } = req.body;
  const listing = db.prepare("SELECT * FROM market_listings WHERE id = ? AND seller_id = ? AND status = 'active'").get(listingId, req.session.userId);
  if (!listing) return res.status(400).json({ error: 'Offre introuvable' });

  db.prepare("UPDATE market_listings SET status = 'cancelled' WHERE id = ?").run(listingId);
  res.json({ success: true, message: 'Offre annulee' });
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
      CASE WHEN f.user_id = ? THEN u2.avatar ELSE u1.avatar END as avatar,
      CASE WHEN f.user_id = ? THEN u2.profile_frame ELSE u1.profile_frame END as profileFrame
    FROM friendships f
    JOIN users u1 ON f.user_id = u1.id
    JOIN users u2 ON f.friend_id = u2.id
    WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
  `).all(userId, userId, userId, userId, userId, userId, userId);
  friends.forEach(f => { f.online = onlineUsers.has(f.friendUserId); });

  const pendingReceived = db.prepare(`
    SELECT f.id as friendshipId, u.username, u.display_name as displayName, u.avatar, u.profile_frame as profileFrame
    FROM friendships f JOIN users u ON f.user_id = u.id
    WHERE f.friend_id = ? AND f.status = 'pending'
  `).all(userId);

  const pendingSent = db.prepare(`
    SELECT f.id as friendshipId, u.username, u.display_name as displayName, u.avatar, u.profile_frame as profileFrame
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
// ============================================
// ENERGY API
// ============================================
app.get('/api/energy', requireAuth, (req, res) => {
  const data = getEnergy(req.session.userId);
  const user = db.prepare('SELECT energy_purchases_today, energy_purchases_date FROM users WHERE id = ?').get(req.session.userId);
  const today = new Date().toISOString().split('T')[0];
  const purchasesToday = user.energy_purchases_date === today ? user.energy_purchases_today : 0;
  res.json({ ...data, purchasesToday, maxPurchases: ENERGY_CONFIG.purchase.max_per_day, purchasePrice: ENERGY_CONFIG.purchase.price, purchaseAmount: ENERGY_CONFIG.purchase.amount });
});

app.post('/api/energy/buy', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const today = new Date().toISOString().split('T')[0];
  const user = db.prepare('SELECT credits, energy_purchases_today, energy_purchases_date FROM users WHERE id = ?').get(userId);
  const purchasesToday = user.energy_purchases_date === today ? user.energy_purchases_today : 0;
  if (purchasesToday >= ENERGY_CONFIG.purchase.max_per_day) return res.status(400).json({ error: 'Maximum d\'achats atteint aujourd\'hui' });
  if (user.credits < ENERGY_CONFIG.purchase.price) return res.status(400).json({ error: 'Pas assez de credits' });

  const { energy } = getEnergy(userId);
  const newEnergy = Math.min(ENERGY_CONFIG.max, energy + ENERGY_CONFIG.purchase.amount);
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET energy = ?, last_energy_update = ?, credits = credits - ?, energy_purchases_today = ?, energy_purchases_date = ? WHERE id = ?')
    .run(newEnergy, now, ENERGY_CONFIG.purchase.price, purchasesToday + 1, today, userId);

  updateQuestProgress(userId, 'credits_spent', ENERGY_CONFIG.purchase.price);
  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  res.json({ success: true, energy: newEnergy, credits: newCredits, purchasesToday: purchasesToday + 1 });
});

// ============================================
// CRAFT API
// ============================================
app.get('/api/craft/recipes', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const resources = getUserResourceCounts(userId);
  const items = getUserItems(userId);
  const user = db.prepare('SELECT excavation_essence FROM users WHERE id = ?').get(userId);

  const recipes = CRAFT_RECIPES.map(r => {
    const canAfford = Object.entries(r.cost).every(([res, amt]) => (resources[res] || 0) >= amt);
    return { ...r, canAfford };
  });

  res.json({ recipes, resources, items, essence: user.excavation_essence || 0 });
});

app.post('/api/craft', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { recipeId } = req.body;
  const recipe = CRAFT_RECIPES.find(r => r.id === recipeId);
  if (!recipe) return res.status(400).json({ error: 'Recette inconnue' });

  const resources = getUserResourceCounts(userId);
  for (const [resource, amount] of Object.entries(recipe.cost)) {
    if ((resources[resource] || 0) < amount) return res.status(400).json({ error: `Pas assez de ${MINE_RESOURCES[resource]?.name || resource}` });
  }

  // Deduct resources
  deductResources(userId, recipe.cost);

  // Grant result
  let resultInfo = {};
  const result = recipe.result;
  if (result.type === 'item') {
    addUserItem(userId, result.key, result.qty);
    resultInfo = { type: 'item', name: CRAFT_ITEMS[result.key]?.name || result.key, qty: result.qty };
  } else if (result.type === 'essence') {
    db.prepare('UPDATE users SET excavation_essence = excavation_essence + ? WHERE id = ?').run(result.qty, userId);
    resultInfo = { type: 'essence', qty: result.qty };
  } else if (result.type === 'card') {
    const card = db.prepare('SELECT * FROM cards WHERE rarity = ? ORDER BY RANDOM() LIMIT 1').get(result.rarity);
    if (card) {
      db.prepare('INSERT INTO user_cards (user_id, card_id) VALUES (?, ?)').run(userId, card.id);
      resultInfo = { type: 'card', card };
    }
  }

  db.prepare('UPDATE users SET stat_crafts = stat_crafts + 1 WHERE id = ?').run(userId);
  addBattlePassXP(userId, 15);
  updateQuestProgress(userId, 'craft', 1);
  checkAchievements(userId);

  res.json({ success: true, result: resultInfo });
});

app.get('/api/items', requireAuth, (req, res) => {
  const items = getUserItems(req.session.userId);
  res.json(items.map(i => ({ ...i, ...(CRAFT_ITEMS[i.item_key] || {}) })));
});

// ============================================
// AWAKENING (EVEIL) API
// ============================================
app.get('/api/awakening/available', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const cards = db.prepare(`
    SELECT uc.id as user_card_id, uc.awakening_level, uc.is_fused, uc.is_shiny, c.*
    FROM user_cards uc JOIN cards c ON uc.card_id = c.id
    WHERE uc.user_id = ? AND uc.is_fused = 1 AND uc.awakening_level < 2
    ORDER BY CASE c.rarity WHEN 'secret' THEN -1 WHEN 'chaos' THEN 0 WHEN 'legendaire' THEN 1 WHEN 'epique' THEN 2 WHEN 'rare' THEN 3 WHEN 'commune' THEN 4 END, c.attack DESC
  `).all(userId);

  const user = db.prepare('SELECT credits, excavation_essence FROM users WHERE id = ?').get(userId);
  const items = getUserItems(userId);
  const pierreCount = items.find(i => i.item_key === 'pierre_eveil')?.quantity || 0;

  const result = cards.map(card => {
    const nextLevel = card.awakening_level + 1;
    const config = AWAKENING_CONFIG[nextLevel - 1];
    if (!config) return null;
    const canAfford = user.credits >= config.cost.credits && user.excavation_essence >= config.cost.essence && pierreCount >= config.cost.pierre_eveil;
    return { ...card, nextLevel, config, canAfford, pierreCount, userCredits: user.credits, userEssence: user.excavation_essence };
  }).filter(Boolean);

  res.json(result);
});

app.post('/api/awakening', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { userCardId } = req.body;
  if (!userCardId) return res.status(400).json({ error: 'userCardId requis' });

  const uc = db.prepare('SELECT uc.*, c.name, c.emoji, c.rarity FROM user_cards uc JOIN cards c ON uc.card_id = c.id WHERE uc.id = ? AND uc.user_id = ?').get(userCardId, userId);
  if (!uc) return res.status(404).json({ error: 'Carte introuvable' });
  if (!uc.is_fused) return res.status(400).json({ error: 'Carte non fusionnee' });
  if (uc.awakening_level >= 2) return res.status(400).json({ error: 'Eveil maximum atteint' });

  const nextLevel = uc.awakening_level + 1;
  const config = AWAKENING_CONFIG[nextLevel - 1];
  if (!config) return res.status(400).json({ error: 'Configuration introuvable' });

  const user = db.prepare('SELECT credits, excavation_essence FROM users WHERE id = ?').get(userId);
  if (user.credits < config.cost.credits) return res.status(400).json({ error: 'Pas assez de credits' });
  if (user.excavation_essence < config.cost.essence) return res.status(400).json({ error: 'Pas assez d\'essence' });

  const items = getUserItems(userId);
  const pierreCount = items.find(i => i.item_key === 'pierre_eveil')?.quantity || 0;
  if (pierreCount < config.cost.pierre_eveil) return res.status(400).json({ error: 'Pas assez de Pierre d\'Eveil' });

  // Deduct costs
  db.prepare('UPDATE users SET credits = credits - ?, excavation_essence = excavation_essence - ?, stat_awakenings = stat_awakenings + 1 WHERE id = ?')
    .run(config.cost.credits, config.cost.essence, userId);
  db.prepare('UPDATE user_items SET quantity = quantity - ? WHERE user_id = ? AND item_key = ?')
    .run(config.cost.pierre_eveil, userId, 'pierre_eveil');
  // Clean up 0-quantity items
  db.prepare('DELETE FROM user_items WHERE user_id = ? AND item_key = ? AND quantity <= 0').run(userId, 'pierre_eveil');

  // Upgrade card
  db.prepare('UPDATE user_cards SET awakening_level = ? WHERE id = ?').run(nextLevel, userCardId);

  addBattlePassXP(userId, 50);
  checkAchievements(userId);

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  res.json({ success: true, newLevel: nextLevel, label: config.label, bonuses: config.bonuses, credits: newCredits });
});

// ============================================
// GUILD API
// ============================================
app.post('/api/guilds/create', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { name, emoji } = req.body;
  if (!name || name.length < 2 || name.length > 20) return res.status(400).json({ error: 'Nom entre 2 et 20 caracteres' });

  const user = db.prepare('SELECT credits, guild_id FROM users WHERE id = ?').get(userId);
  if (user.guild_id) return res.status(400).json({ error: 'Tu es deja dans une guilde' });
  if (user.credits < GUILD_CONFIG.create_cost) return res.status(400).json({ error: `Il faut ${GUILD_CONFIG.create_cost} credits` });

  const existing = db.prepare('SELECT id FROM guilds WHERE name = ?').get(name);
  if (existing) return res.status(400).json({ error: 'Nom deja pris' });

  const guildEmoji = emoji || '⚔';
  const result = db.prepare('INSERT INTO guilds (name, leader_id, emoji) VALUES (?, ?, ?)').run(name, userId, guildEmoji);
  const guildId = result.lastInsertRowid;

  db.prepare('INSERT INTO guild_members (guild_id, user_id, role) VALUES (?, ?, ?)').run(guildId, userId, 'leader');
  db.prepare('UPDATE users SET guild_id = ?, credits = credits - ? WHERE id = ?').run(guildId, GUILD_CONFIG.create_cost, userId);

  checkAchievements(userId);
  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  res.json({ success: true, guildId, credits: newCredits });
});

app.get('/api/guilds', requireAuth, (req, res) => {
  const guilds = db.prepare(`
    SELECT g.*, u.username as leader_name, u.avatar as leader_avatar,
      (SELECT COUNT(*) FROM guild_members WHERE guild_id = g.id) as member_count
    FROM guilds g JOIN users u ON g.leader_id = u.id
    ORDER BY member_count DESC, g.created_at DESC
  `).all();
  res.json(guilds);
});

app.get('/api/guilds/my', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare('SELECT guild_id FROM users WHERE id = ?').get(userId);
  if (!user.guild_id) return res.json({ guild: null });

  const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(user.guild_id);
  if (!guild) return res.json({ guild: null });

  const members = db.prepare(`
    SELECT gm.*, u.username, u.avatar, u.display_name, u.pvp_rating
    FROM guild_members gm JOIN users u ON gm.user_id = u.id
    WHERE gm.guild_id = ? ORDER BY CASE gm.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, gm.joined_at
  `).all(guild.id);

  const myMember = members.find(m => m.user_id === userId);
  const boss = ensureGuildBoss(guild.id);

  const today = new Date().toISOString().split('T')[0];
  const canAttackBoss = myMember && myMember.last_boss_attack !== today && boss.boss_hp > 0;

  res.json({ guild, members, myRole: myMember?.role || 'member', boss, canAttackBoss });
});

app.post('/api/guilds/join', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { guildId } = req.body;

  const user = db.prepare('SELECT guild_id FROM users WHERE id = ?').get(userId);
  if (user.guild_id) return res.status(400).json({ error: 'Tu es deja dans une guilde' });

  const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId);
  if (!guild) return res.status(404).json({ error: 'Guilde introuvable' });

  const memberCount = db.prepare('SELECT COUNT(*) as c FROM guild_members WHERE guild_id = ?').get(guildId).c;
  if (memberCount >= GUILD_CONFIG.max_members) return res.status(400).json({ error: 'Guilde pleine' });

  db.prepare('INSERT INTO guild_members (guild_id, user_id, role) VALUES (?, ?, ?)').run(guildId, userId, 'member');
  db.prepare('UPDATE users SET guild_id = ? WHERE id = ?').run(guildId, userId);

  checkAchievements(userId);
  res.json({ success: true });
});

app.post('/api/guilds/leave', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare('SELECT guild_id FROM users WHERE id = ?').get(userId);
  if (!user.guild_id) return res.status(400).json({ error: 'Pas dans une guilde' });

  const guild = db.prepare('SELECT * FROM guilds WHERE id = ?').get(user.guild_id);
  const member = db.prepare('SELECT * FROM guild_members WHERE guild_id = ? AND user_id = ?').get(user.guild_id, userId);

  if (member.role === 'leader') {
    // Transfer leadership or disband
    const nextLeader = db.prepare("SELECT * FROM guild_members WHERE guild_id = ? AND user_id != ? ORDER BY CASE role WHEN 'officer' THEN 0 ELSE 1 END, joined_at LIMIT 1").get(user.guild_id, userId);
    if (nextLeader) {
      db.prepare("UPDATE guild_members SET role = 'leader' WHERE id = ?").run(nextLeader.id);
      db.prepare('UPDATE guilds SET leader_id = ? WHERE id = ?').run(nextLeader.user_id, user.guild_id);
    } else {
      // Disband
      db.prepare('DELETE FROM guild_members WHERE guild_id = ?').run(user.guild_id);
      db.prepare('DELETE FROM guild_chat WHERE guild_id = ?').run(user.guild_id);
      db.prepare('DELETE FROM guild_boss WHERE guild_id = ?').run(user.guild_id);
      db.prepare('DELETE FROM guilds WHERE id = ?').run(user.guild_id);
    }
  }

  db.prepare('DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?').run(user.guild_id, userId);
  db.prepare('UPDATE users SET guild_id = NULL WHERE id = ?').run(userId);
  res.json({ success: true });
});

app.post('/api/guilds/kick', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { targetUserId } = req.body;
  const user = db.prepare('SELECT guild_id FROM users WHERE id = ?').get(userId);
  if (!user.guild_id) return res.status(400).json({ error: 'Pas dans une guilde' });

  const myRole = db.prepare('SELECT role FROM guild_members WHERE guild_id = ? AND user_id = ?').get(user.guild_id, userId);
  if (!myRole || (myRole.role !== 'leader' && myRole.role !== 'officer')) return res.status(403).json({ error: 'Permission refusee' });

  const targetRole = db.prepare('SELECT role FROM guild_members WHERE guild_id = ? AND user_id = ?').get(user.guild_id, targetUserId);
  if (!targetRole) return res.status(404).json({ error: 'Membre introuvable' });
  if (targetRole.role === 'leader') return res.status(403).json({ error: 'Impossible de kick le leader' });

  db.prepare('DELETE FROM guild_members WHERE guild_id = ? AND user_id = ?').run(user.guild_id, targetUserId);
  db.prepare('UPDATE users SET guild_id = NULL WHERE id = ?').run(targetUserId);
  res.json({ success: true });
});

app.post('/api/guilds/promote', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { targetUserId, role } = req.body;
  if (!['officer', 'member'].includes(role)) return res.status(400).json({ error: 'Role invalide' });

  const user = db.prepare('SELECT guild_id FROM users WHERE id = ?').get(userId);
  const myRole = db.prepare('SELECT role FROM guild_members WHERE guild_id = ? AND user_id = ?').get(user.guild_id, userId);
  if (!myRole || myRole.role !== 'leader') return res.status(403).json({ error: 'Seul le leader peut promouvoir' });

  db.prepare('UPDATE guild_members SET role = ? WHERE guild_id = ? AND user_id = ?').run(role, user.guild_id, targetUserId);
  res.json({ success: true });
});

app.post('/api/guilds/donate', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { amount } = req.body;
  if (!amount || amount < GUILD_CONFIG.donate_min || amount > GUILD_CONFIG.donate_max) return res.status(400).json({ error: `Montant entre ${GUILD_CONFIG.donate_min} et ${GUILD_CONFIG.donate_max}` });

  const user = db.prepare('SELECT credits, guild_id FROM users WHERE id = ?').get(userId);
  if (!user.guild_id) return res.status(400).json({ error: 'Pas dans une guilde' });
  if (user.credits < amount) return res.status(400).json({ error: 'Pas assez de credits' });

  db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(amount, userId);
  db.prepare('UPDATE guilds SET treasury = treasury + ? WHERE id = ?').run(amount, user.guild_id);

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  const guild = db.prepare('SELECT treasury FROM guilds WHERE id = ?').get(user.guild_id);
  res.json({ success: true, credits: newCredits, treasury: guild.treasury });
});

app.get('/api/guilds/chat', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare('SELECT guild_id FROM users WHERE id = ?').get(userId);
  if (!user.guild_id) return res.json({ messages: [] });

  const messages = db.prepare(`
    SELECT gc.*, u.username, u.avatar, u.display_name
    FROM guild_chat gc JOIN users u ON gc.sender_id = u.id
    WHERE gc.guild_id = ? ORDER BY gc.id DESC LIMIT 50
  `).all(user.guild_id);

  res.json({ messages: messages.reverse() });
});

app.post('/api/guilds/chat', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { message } = req.body;
  if (!message || message.length > 500) return res.status(400).json({ error: 'Message invalide' });

  const user = db.prepare('SELECT guild_id, username, avatar, display_name FROM users WHERE id = ?').get(userId);
  if (!user.guild_id) return res.status(400).json({ error: 'Pas dans une guilde' });

  db.prepare('INSERT INTO guild_chat (guild_id, sender_id, message) VALUES (?, ?, ?)').run(user.guild_id, userId, message);

  // Broadcast to online guild members via Socket.IO
  const members = db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ?').all(user.guild_id);
  for (const m of members) {
    if (m.user_id === userId) continue;
    const sock = userSocketMap.get(m.user_id);
    if (sock && sock.connected) {
      sock.emit('guild:message', { senderId: userId, senderName: user.display_name || user.username, avatar: user.avatar, message, timestamp: new Date().toISOString() });
    }
  }

  res.json({ success: true });
});

app.get('/api/guilds/boss', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare('SELECT guild_id FROM users WHERE id = ?').get(userId);
  if (!user.guild_id) return res.status(400).json({ error: 'Pas dans une guilde' });

  const boss = ensureGuildBoss(user.guild_id);
  const member = db.prepare('SELECT last_boss_attack FROM guild_members WHERE guild_id = ? AND user_id = ?').get(user.guild_id, userId);
  const today = new Date().toISOString().split('T')[0];
  const canAttack = member && member.last_boss_attack !== today && boss.boss_hp > 0;

  res.json({ boss, canAttack });
});

app.post('/api/guilds/boss/attack', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = db.prepare('SELECT guild_id FROM users WHERE id = ?').get(userId);
  if (!user.guild_id) return res.status(400).json({ error: 'Pas dans une guilde' });

  const boss = ensureGuildBoss(user.guild_id);
  if (boss.boss_hp <= 0) return res.status(400).json({ error: 'Boss deja vaincu cette semaine' });

  const today = new Date().toISOString().split('T')[0];
  const member = db.prepare('SELECT last_boss_attack FROM guild_members WHERE guild_id = ? AND user_id = ?').get(user.guild_id, userId);
  if (member.last_boss_attack === today) return res.status(400).json({ error: 'Tu as deja attaque aujourd\'hui' });

  // Simulate boss attack — random damage based on player's best cards
  const topCards = db.prepare(`
    SELECT c.attack, c.defense, uc.is_fused, uc.awakening_level FROM user_cards uc
    JOIN cards c ON uc.card_id = c.id WHERE uc.user_id = ?
    ORDER BY c.attack DESC LIMIT 5
  `).all(userId);

  let totalDamage = 0;
  for (const card of topCards) {
    const mult = card.is_fused ? 2 : 1;
    const awBonus = card.awakening_level || 0;
    const atk = card.attack * mult + awBonus;
    totalDamage += atk + Math.floor(Math.random() * 3);
  }
  totalDamage = Math.max(50, Math.min(500, totalDamage));

  const newHp = Math.max(0, boss.boss_hp - totalDamage);
  db.prepare('UPDATE guild_boss SET boss_hp = ? WHERE guild_id = ?').run(newHp, user.guild_id);
  db.prepare('UPDATE guild_members SET last_boss_attack = ? WHERE guild_id = ? AND user_id = ?').run(today, user.guild_id, userId);

  // Reward based on damage
  const reward = Math.floor(50 + (totalDamage / 500) * 150);
  db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(reward, userId);

  addBattlePassXP(userId, 20);
  updateQuestProgress(userId, 'guild_boss', 1);

  // If boss killed, distribute rewards
  if (newHp <= 0) {
    distributeGuildBossRewards(user.guild_id);
  }

  const newCredits = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
  res.json({ success: true, damage: totalDamage, bossHp: newHp, bossMaxHp: boss.boss_max_hp, reward, credits: newCredits, bossKilled: newHp <= 0 });
});

// ============================================
// PAGE ROUTES
// ============================================
app.get('/tutorial', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'tutorial.html')); });
app.get('/intro', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'intro.html')); });
app.get('/menu', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'menu.html')); });
app.get('/shop', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'shop.html')); });
app.get('/collection', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'collection.html')); });
app.get('/fusion', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'fusion.html')); });
// Endpoint pour sauvegarder une image generee par canvas
app.post('/api/mine/save-bg', requireAuth, (req, res) => {
  const { data } = req.body;
  if (!data) return res.status(400).json({ error: 'No data' });
  const base64 = data.replace(/^data:image\/png;base64,/, '');
  const buf = Buffer.from(base64, 'base64');
  const filePath = path.join(__dirname, 'public', 'img', 'mine', 'mine-bg.png');
  fs.writeFileSync(filePath, buf);
  res.json({ success: true });
});

app.get('/mine', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'mine.html')); });
app.get('/combat', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'combat.html')); });
app.get('/battle', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'battle.html')); });
app.get('/pvp-battle', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'pvp-battle.html')); });
app.get('/decks', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'decks.html')); });
app.get('/battlepass', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'battlepass.html')); });
app.get('/casino', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'casino.html')); });
app.get('/guilds', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'guilds.html')); });
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
    const tables = ['users', 'cards', 'user_cards', 'battle_log'];

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
// Socket.io — Friends / Notifications
// ============================================

const io = new Server(server);
io.engine.use(sessionMiddleware);

const userSocketMap = new Map();
const pvpQueue = []; // { userId, deckId }
const pvpBattles = new Map(); // battleId → { battle, player1Id, player2Id, turnTimer }

// --- PvP Helper Functions ---

function getPvpBattleForUser(userId) {
  for (const [battleId, pvp] of pvpBattles) {
    if (pvp.player1Id === userId || pvp.player2Id === userId) return { battleId, pvp };
  }
  return null;
}

function getPvpSnapshot(pvp, forUserId) {
  const battle = pvp.battle;
  const isPlayer1 = forUserId === pvp.player1Id;
  return {
    battleId: battle.battleId,
    turn: battle.turn,
    phase: battle.phase,
    result: battle.result,
    currentTurnPlayer: battle.currentTurnPlayer,
    playerHand: isPlayer1 ? battle.playerHand : battle.enemyHand,
    playerField: isPlayer1 ? battle.playerField : battle.enemyField,
    playerEnergy: isPlayer1 ? battle.playerEnergy : battle.enemyEnergy,
    playerMaxEnergy: isPlayer1 ? battle.playerMaxEnergy : battle.enemyMaxEnergy,
    playerCrystal: Math.round((isPlayer1 ? battle.playerCrystal : battle.enemyCrystal) * 100) / 100,
    playerMaxCrystal: (isPlayer1 ? battle.playerMaxCrystal : battle.enemyMaxCrystal) || 2,
    playerDeckCount: (isPlayer1 ? battle.playerDeck : battle.enemyDeck).length,
    playerHp: isPlayer1 ? battle.playerHp : battle.enemyHp,
    playerMaxHp: isPlayer1 ? battle.playerMaxHp : battle.enemyMaxHp,
    enemyField: isPlayer1 ? battle.enemyField : battle.playerField,
    enemyHandCount: (isPlayer1 ? battle.enemyHand : battle.playerHand).length,
    enemyEnergy: isPlayer1 ? battle.enemyEnergy : battle.playerEnergy,
    enemyMaxEnergy: isPlayer1 ? battle.enemyMaxEnergy : battle.playerMaxEnergy,
    enemyCrystal: Math.round((isPlayer1 ? battle.enemyCrystal : battle.playerCrystal) * 100) / 100,
    enemyMaxCrystal: (isPlayer1 ? battle.enemyMaxCrystal : battle.playerMaxCrystal) || 2,
    enemyDeckCount: (isPlayer1 ? battle.enemyDeck : battle.playerDeck).length,
    enemyHp: isPlayer1 ? battle.enemyHp : battle.playerHp,
    enemyMaxHp: isPlayer1 ? battle.enemyMaxHp : battle.playerMaxHp,
    attackedThisTurn: battle.attackedThisTurn || [],
    pvp: true,
  };
}

function pvpSwitchTurn(pvp) {
  const battle = pvp.battle;
  if (battle.currentTurnPlayer === pvp.player1Id) {
    battle.currentTurnPlayer = pvp.player2Id;
  } else {
    battle.currentTurnPlayer = pvp.player1Id;
    // Nouveau tour complet (les 2 joueurs ont joue)
    battle.turn++;
    if (battle.turn > battle.maxTurns) {
      checkDeckWin(battle);
      return;
    }
  }
  battle.phase = 'player_turn';
  battle.attackedThisTurn = [];

  // Regénérer énergie + crystal pour le joueur actif
  const isP1Turn = battle.currentTurnPlayer === pvp.player1Id;
  const energy = getManaForTurn(battle.turn);
  if (isP1Turn) {
    battle.playerEnergy = energy;
    battle.playerMaxEnergy = energy;
    battle.playerCrystal = Math.min((battle.playerCrystal || 0) + (battle.playerCrystalRate || 0.3), battle.playerMaxCrystal || 2);
    for (const u of getFieldAlive(battle.playerField)) { u.justDeployed = false; u.usedAbility = false; }
  } else {
    battle.enemyEnergy = energy;
    battle.enemyMaxEnergy = energy;
    battle.enemyCrystal = Math.min((battle.enemyCrystal || 0) + (battle.enemyCrystalRate || 0.3), battle.enemyMaxCrystal || 2);
    for (const u of getFieldAlive(battle.enemyField)) { u.justDeployed = false; u.usedAbility = false; }
  }

  // Draw card
  if (isP1Turn && battle.playerDeck.length > 0) {
    battle.playerHand.push(battle.playerDeck.pop());
  } else if (!isP1Turn && battle.enemyDeck.length > 0) {
    battle.enemyHand.push(battle.enemyDeck.pop());
  }
}

function pvpEndBattle(pvp, battleId) {
  if (pvp.turnTimer) clearTimeout(pvp.turnTimer);
  const battle = pvp.battle;

  // Déterminer le résultat pour chaque joueur
  let p1Result, p2Result;
  if (battle.playerHp <= 0) { p1Result = 'defeat'; p2Result = 'victory'; }
  else if (battle.enemyHp <= 0) { p1Result = 'victory'; p2Result = 'defeat'; }
  else if (battle.result === 'victory') { p1Result = 'victory'; p2Result = 'defeat'; }
  else if (battle.result === 'defeat') { p1Result = 'defeat'; p2Result = 'victory'; }
  else { p1Result = 'draw'; p2Result = 'draw'; }

  // Récompenses
  const winReward = 100;
  const loseReward = 20;

  // Mise à jour DB
  if (p1Result === 'victory') {
    db.prepare('UPDATE users SET stat_pvp_wins = stat_pvp_wins + 1, credits = credits + ?, pvp_rating = pvp_rating + 25 WHERE id = ?').run(winReward, pvp.player1Id);
    db.prepare('UPDATE users SET stat_pvp_losses = stat_pvp_losses + 1, credits = credits + ?, pvp_rating = MAX(0, pvp_rating - 20) WHERE id = ?').run(loseReward, pvp.player2Id);
  } else if (p2Result === 'victory') {
    db.prepare('UPDATE users SET stat_pvp_wins = stat_pvp_wins + 1, credits = credits + ?, pvp_rating = pvp_rating + 25 WHERE id = ?').run(winReward, pvp.player2Id);
    db.prepare('UPDATE users SET stat_pvp_losses = stat_pvp_losses + 1, credits = credits + ?, pvp_rating = MAX(0, pvp_rating - 20) WHERE id = ?').run(loseReward, pvp.player1Id);
  }

  // Log
  db.prepare('INSERT INTO battle_log (user_id, battle_type, opponent_info, result, reward_credits) VALUES (?, ?, ?, ?, ?)').run(pvp.player1Id, 'pvp', `PvP vs ${pvp.player2Name}`, p1Result, p1Result === 'victory' ? winReward : loseReward);
  db.prepare('INSERT INTO battle_log (user_id, battle_type, opponent_info, result, reward_credits) VALUES (?, ?, ?, ?, ?)').run(pvp.player2Id, 'pvp', `PvP vs ${pvp.player1Name}`, p2Result, p2Result === 'victory' ? winReward : loseReward);

  // Notifier les joueurs
  const s1 = userSocketMap.get(pvp.player1Id);
  const s2 = userSocketMap.get(pvp.player2Id);
  if (s1 && s1.connected) s1.emit('pvp:result', { result: p1Result, reward: p1Result === 'victory' ? winReward : loseReward });
  if (s2 && s2.connected) s2.emit('pvp:result', { result: p2Result, reward: p2Result === 'victory' ? winReward : loseReward });

  pvpBattles.delete(battleId);
}

function pvpStartTurnTimer(pvp, battleId) {
  if (pvp.turnTimer) clearTimeout(pvp.turnTimer);
  pvp.turnTimer = setTimeout(() => {
    // Auto end-turn après 60s
    const battle = pvp.battle;
    if (battle.result) return;
    pvpSwitchTurn(pvp);
    const s1 = userSocketMap.get(pvp.player1Id);
    const s2 = userSocketMap.get(pvp.player2Id);
    if (s1 && s1.connected) s1.emit('pvp:update', { events: [{ type: 'system', desc: 'Temps ecoule ! Tour passe.' }], ...getPvpSnapshot(pvp, pvp.player1Id) });
    if (s2 && s2.connected) s2.emit('pvp:update', { events: [{ type: 'system', desc: 'Temps ecoule ! Tour passe.' }], ...getPvpSnapshot(pvp, pvp.player2Id) });
    if (battle.result) { pvpEndBattle(pvp, battleId); return; }
    pvpStartTurnTimer(pvp, battleId);
  }, 60000);
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

  // ====== PvP Matchmaking & Combat ======

  socket.on('pvp:queue', (data) => {
    const deckId = data?.deckId;
    // Vérifier que le joueur n'est pas déjà en queue ou en combat
    if (pvpQueue.find(q => q.userId === userId)) return;
    if (getPvpBattleForUser(userId)) { socket.emit('pvp:error', { error: 'Deja en combat' }); return; }

    // Energy check for PvP
    const energyResult = consumeEnergy(userId, ENERGY_CONFIG.costs.pvp_battle);
    if (!energyResult.success) { socket.emit('pvp:error', { error: `Pas assez d'energie (${ENERGY_CONFIG.costs.pvp_battle} requis)`, noEnergy: true }); return; }

    // Charger le deck du joueur
    let playerCards;
    if (deckId === 'starter') {
      playerCards = STARTER_DECK.map(c => ({ ...c }));
    } else {
      const deck = db.prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?').get(deckId, userId);
      if (!deck) { socket.emit('pvp:error', { error: 'Deck introuvable' }); return; }
      const cards = db.prepare(`
        SELECT dc.position, uc.is_fused, uc.is_shiny, uc.is_temp, uc.awakening_level, c.* FROM deck_cards dc
        JOIN user_cards uc ON dc.user_card_id = uc.id
        JOIN cards c ON uc.card_id = c.id
        WHERE dc.deck_id = ? ORDER BY dc.position
      `).all(deck.id);
      if (cards.length !== 20) { socket.emit('pvp:error', { error: 'Deck incomplet' }); return; }
      playerCards = cards;
    }

    // Chercher un adversaire dans la queue
    if (pvpQueue.length > 0) {
      const opponent = pvpQueue.shift();
      const opponentSocket = userSocketMap.get(opponent.userId);
      if (!opponentSocket || !opponentSocket.connected) {
        // L'adversaire s'est déconnecté, on se remet dans la queue
        pvpQueue.push({ userId, deckId, cards: playerCards });
        socket.emit('pvp:waiting', { position: pvpQueue.length });
        return;
      }

      // Match trouvé ! Créer le combat
      const battle = createDeckBattleState(opponent.cards, playerCards, 'pvp');
      battle.currentTurnPlayer = opponent.userId; // Player 1 commence
      const battleId = battle.battleId;

      const p1Name = db.prepare('SELECT username FROM users WHERE id = ?').get(opponent.userId)?.username || 'Joueur 1';
      const p2Name = db.prepare('SELECT username FROM users WHERE id = ?').get(userId)?.username || 'Joueur 2';

      const pvp = {
        battle,
        player1Id: opponent.userId,
        player2Id: userId,
        player1Name: p1Name,
        player2Name: p2Name,
        turnTimer: null
      };
      pvpBattles.set(battleId, pvp);

      // Notifier les 2 joueurs
      opponentSocket.emit('pvp:matched', {
        battleId,
        opponentName: p2Name,
        ...getPvpSnapshot(pvp, opponent.userId)
      });
      socket.emit('pvp:matched', {
        battleId,
        opponentName: p1Name,
        ...getPvpSnapshot(pvp, userId)
      });

      pvpStartTurnTimer(pvp, battleId);
    } else {
      // Pas d'adversaire, on attend
      pvpQueue.push({ userId, deckId, cards: playerCards });
      socket.emit('pvp:waiting', { position: pvpQueue.length });
    }
  });

  socket.on('pvp:cancel', () => {
    const idx = pvpQueue.findIndex(q => q.userId === userId);
    if (idx >= 0) pvpQueue.splice(idx, 1);
    socket.emit('pvp:cancelled');
  });

  socket.on('pvp:deploy', (data) => {
    const found = getPvpBattleForUser(userId);
    if (!found) return;
    const { pvp, battleId } = found;
    const battle = pvp.battle;
    if (battle.result || battle.currentTurnPlayer !== userId) return;

    const isP1 = userId === pvp.player1Id;
    const hand = isP1 ? battle.playerHand : battle.enemyHand;
    const field = isP1 ? battle.playerField : battle.enemyField;
    const energyKey = isP1 ? 'playerEnergy' : 'enemyEnergy';

    const { handIndex, fieldSlot } = data;
    if (handIndex < 0 || handIndex >= hand.length) return;
    if (fieldSlot < 0 || fieldSlot > 2) return;
    if (field[fieldSlot] && field[fieldSlot].alive) return;

    const card = hand[handIndex];
    if (card.mana_cost > battle[energyKey]) return;

    hand.splice(handIndex, 1);
    const unit = makeDeckFieldUnit(card, isP1 ? 'player' : 'enemy');
    unit.justDeployed = true;
    field[fieldSlot] = unit;
    battle[energyKey] -= card.mana_cost;

    // Rank synergy
    if (fieldSlot === 1) { unit.rankBonusDef = 1; unit.permanentBonusDef += 1; }
    else { unit.rankBonusAtk = 1; unit.permanentBonusAtk += 1; }

    const events = [{ type: isP1 ? 'deploy' : 'enemy_deploy', slot: fieldSlot, name: unit.name, emoji: unit.emoji, mana_cost: unit.mana_cost }];

    // Envoyer aux 2 joueurs
    const s1 = userSocketMap.get(pvp.player1Id);
    const s2 = userSocketMap.get(pvp.player2Id);
    if (s1 && s1.connected) s1.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player1Id) });
    if (s2 && s2.connected) s2.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player2Id) });
  });

  socket.on('pvp:attack', (data) => {
    const found = getPvpBattleForUser(userId);
    if (!found) return;
    const { pvp, battleId } = found;
    const battle = pvp.battle;
    if (battle.result || battle.currentTurnPlayer !== userId) return;

    const isP1 = userId === pvp.player1Id;
    const attackerField = isP1 ? battle.playerField : battle.enemyField;
    const defenderField = isP1 ? battle.enemyField : battle.playerField;
    const energyKey = isP1 ? 'playerEnergy' : 'enemyEnergy';

    const { attackerSlot, targetSlot } = data;
    const attacker = attackerField[attackerSlot];
    const target = defenderField[targetSlot];
    if (!attacker || !attacker.alive || attacker.justDeployed) return;
    if (!target || !target.alive) return;
    if (battle[energyKey] < 1) return;
    if ((battle.attackedThisTurn || []).includes(attackerSlot)) return;

    battle.attackedThisTurn = battle.attackedThisTurn || [];
    battle.attackedThisTurn.push(attackerSlot);
    battle[energyKey] -= 1;

    const events = [];
    const dmg = calcDamage(attacker, target, false, attackerField);
    applyDamage(target, dmg, events, attacker, battle);
    events.push({ type: 'attack', attacker: attacker.name, attackerSlot, target: target.name, targetSlot, damage: dmg, side: isP1 ? 'player' : 'enemy' });

    if (!target.alive) {
      cleanDeadFromField(defenderField);
    }

    checkDeckWin(battle);

    const s1 = userSocketMap.get(pvp.player1Id);
    const s2 = userSocketMap.get(pvp.player2Id);
    if (s1 && s1.connected) s1.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player1Id) });
    if (s2 && s2.connected) s2.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player2Id) });

    if (battle.result) pvpEndBattle(pvp, battleId);
  });

  socket.on('pvp:attack-avatar', (data) => {
    const found = getPvpBattleForUser(userId);
    if (!found) return;
    const { pvp, battleId } = found;
    const battle = pvp.battle;
    if (battle.result || battle.currentTurnPlayer !== userId) return;

    const isP1 = userId === pvp.player1Id;
    const attackerField = isP1 ? battle.playerField : battle.enemyField;
    const defenderField = isP1 ? battle.enemyField : battle.playerField;
    const energyKey = isP1 ? 'playerEnergy' : 'enemyEnergy';
    const hpKey = isP1 ? 'enemyHp' : 'playerHp';

    // Vérifier que le terrain adverse est vide
    if (getFieldAlive(defenderField).length > 0) return;

    const { attackerSlot } = data;
    const attacker = attackerField[attackerSlot];
    if (!attacker || !attacker.alive || attacker.justDeployed) return;
    if (battle[energyKey] < 1) return;
    if ((battle.attackedThisTurn || []).includes(attackerSlot)) return;

    battle.attackedThisTurn = battle.attackedThisTurn || [];
    battle.attackedThisTurn.push(attackerSlot);
    battle[energyKey] -= 1;

    const totalAtk = (attacker.effectiveStats?.attack || attacker.attack) + (attacker.buffAtk || 0) + (attacker.permanentBonusAtk || 0);
    const dmg = Math.max(1, totalAtk);
    battle[hpKey] = Math.max(0, battle[hpKey] - dmg);

    const events = [{ type: 'avatar_damage', attacker: attacker.name, attackerSlot, damage: dmg, side: isP1 ? 'player' : 'enemy' }];

    checkDeckWin(battle);

    const s1 = userSocketMap.get(pvp.player1Id);
    const s2 = userSocketMap.get(pvp.player2Id);
    if (s1 && s1.connected) s1.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player1Id) });
    if (s2 && s2.connected) s2.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player2Id) });

    if (battle.result) pvpEndBattle(pvp, battleId);
  });

  socket.on('pvp:use-ability', (data) => {
    const found = getPvpBattleForUser(userId);
    if (!found) return;
    const { pvp, battleId } = found;
    const battle = pvp.battle;
    if (battle.result || battle.currentTurnPlayer !== userId) return;

    const isP1 = userId === pvp.player1Id;
    const myField = isP1 ? battle.playerField : battle.enemyField;
    const enemyFieldArr = isP1 ? battle.enemyField : battle.playerField;
    const crystalKey = isP1 ? 'playerCrystal' : 'enemyCrystal';

    const { fieldSlot } = data;
    const unit = myField[fieldSlot];
    if (!unit || !unit.alive || unit.usedAbility || unit.silenced || unit.stunned) return;

    const ability = ABILITY_MAP[unit.ability_name];
    if (!ability) return;
    const crystalCost = unit.crystal_cost || 1;
    if (battle[crystalKey] < crystalCost) return;

    battle[crystalKey] -= crystalCost;
    unit.usedAbility = true;

    const allAllies = getFieldAlive(myField);
    const allEnemies = getFieldAlive(enemyFieldArr);
    const events = resolveAbility(unit, allAllies, allEnemies, allAllies, battle);

    checkDeckWin(battle);

    const s1 = userSocketMap.get(pvp.player1Id);
    const s2 = userSocketMap.get(pvp.player2Id);
    if (s1 && s1.connected) s1.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player1Id) });
    if (s2 && s2.connected) s2.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player2Id) });

    if (battle.result) pvpEndBattle(pvp, battleId);
  });

  socket.on('pvp:end-turn', () => {
    const found = getPvpBattleForUser(userId);
    if (!found) return;
    const { pvp, battleId } = found;
    const battle = pvp.battle;
    if (battle.result || battle.currentTurnPlayer !== userId) return;

    const events = [];

    // Burn AoE turn-start
    getFieldAlive(battle.playerField).forEach(u => {
      if (u.burnAoe) {
        u.currentHp = Math.max(0, u.currentHp - u.burnAoe.damage);
        events.push({ type: 'type_passive', desc: `${u.name} brule ! -${u.burnAoe.damage} PV` });
        if (u.currentHp <= 0) checkKO(u, events, battle);
        u.burnAoe.turnsLeft--;
        if (u.burnAoe.turnsLeft <= 0) u.burnAoe = null;
      }
    });
    cleanDeadFromField(battle.playerField);
    getFieldAlive(battle.enemyField).forEach(u => {
      if (u.burnAoe) {
        u.currentHp = Math.max(0, u.currentHp - u.burnAoe.damage);
        events.push({ type: 'type_passive', desc: `${u.name} brule ! -${u.burnAoe.damage} PV` });
        if (u.currentHp <= 0) checkKO(u, events, battle);
        u.burnAoe.turnsLeft--;
        if (u.burnAoe.turnsLeft <= 0) u.burnAoe = null;
      }
    });
    cleanDeadFromField(battle.enemyField);

    pvpSwitchTurn(pvp);

    if (battle.result) {
      const s1 = userSocketMap.get(pvp.player1Id);
      const s2 = userSocketMap.get(pvp.player2Id);
      if (s1 && s1.connected) s1.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player1Id) });
      if (s2 && s2.connected) s2.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player2Id) });
      pvpEndBattle(pvp, battleId);
      return;
    }

    pvpStartTurnTimer(pvp, battleId);

    const s1 = userSocketMap.get(pvp.player1Id);
    const s2 = userSocketMap.get(pvp.player2Id);
    if (s1 && s1.connected) s1.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player1Id) });
    if (s2 && s2.connected) s2.emit('pvp:update', { events, ...getPvpSnapshot(pvp, pvp.player2Id) });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);

    // PvP: retirer de la queue
    const qIdx = pvpQueue.findIndex(q => q.userId === userId);
    if (qIdx >= 0) pvpQueue.splice(qIdx, 1);

    // PvP: forfait si en combat
    const found = getPvpBattleForUser(userId);
    if (found) {
      const { pvp, battleId } = found;
      const battle = pvp.battle;
      if (!battle.result) {
        // Le joueur qui se déconnecte perd
        if (userId === pvp.player1Id) {
          battle.playerHp = 0;
          battle.result = 'defeat';
        } else {
          battle.enemyHp = 0;
          battle.result = 'victory';
        }
        pvpEndBattle(pvp, battleId);
      }
    }

    const offFriends = db.prepare(`
      SELECT CASE WHEN user_id = ? THEN friend_id ELSE user_id END as fid
      FROM friendships WHERE (user_id = ? OR friend_id = ?) AND status = 'accepted'
    `).all(userId, userId, userId);
    for (const { fid } of offFriends) {
      const fSock = userSocketMap.get(fid);
      if (fSock && fSock.connected) fSock.emit('friend:status', { userId, online: false });
    }
    userSocketMap.delete(userId);
  });

});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Gacha Game lance sur http://0.0.0.0:${PORT}`);
});
