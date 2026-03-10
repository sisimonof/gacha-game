// mine.js — Mine scene avec pierres minables

let mineData = null;
let cooldownInterval = null;
let cooldownSecondsLeft = 0;
let cooldownTotal = 840;

const RESOURCE_NAMES = { charbon: 'Charbon', fer: 'Fer', or: 'Or', diamant: 'Diamant' };
const RESOURCE_PRICES = { charbon: 10, fer: 18, or: 35, diamant: 55 };
const RESOURCE_COLORS = {
  charbon: '#888',
  fer: '#c0c0d0',
  or: '#f0c040',
  diamant: '#40d0ff'
};

// Positions des pierres sur l'image de mine (% relatif)
// Image: murs verts, entree mine au centre, pioches gauche, marchand droite
// Sol vert = bande ~63-90% du haut, zone libre centre-gauche
const ROCK_POSITIONS = [
  { left: 18, top: 76 },
  { left: 38, top: 73 },
  { left: 55, top: 77 },
  { left: 27, top: 86 },
  { left: 47, top: 86 },
  { left: 12, top: 86 },
  { left: 58, top: 86 },
  { left: 35, top: 93 }
];

// Positions minerais au sol (juste en dessous/a cote des pierres)
const MINERAL_POSITIONS = [
  { left: 21, top: 85 },
  { left: 41, top: 82 },
  { left: 58, top: 86 },
  { left: 30, top: 94 },
  { left: 50, top: 94 },
  { left: 15, top: 94 },
  { left: 61, top: 94 },
  { left: 38, top: 98 }
];

// === INIT ===
async function init() {
  // Move popup to end of body to fix z-index stacking with flexbox layout
  const popup = document.getElementById('mine-shop-popup');
  if (popup) document.body.appendChild(popup);

  await loadMineState();
  setupShop();
}

async function loadMineState() {
  try {
    const res = await fetch('/api/mine/state');
    if (!res.ok) {
      if (res.status === 401) { window.location.href = '/'; return; }
      return;
    }
    mineData = await res.json();
    cooldownTotal = mineData.cooldownTotal || 840;

    updateNav();
    renderRocks();
    renderMinerals();

    if (mineData.cooldownRemaining > 0) {
      startCooldownTimer(mineData.cooldownRemaining);
    }
  } catch (e) {
    console.error('Erreur chargement mine:', e);
  }
}

function updateNav() {
  document.getElementById('nav-credits').textContent = mineData.credits;
  document.getElementById('nav-essence').textContent = mineData.essence;
  fetch('/api/me').then(r => r.json()).then(d => {
    document.getElementById('nav-username').textContent = d.displayName || d.username;
    mineData.credits = d.credits;
    mineData.essence = d.essence || 0;
    document.getElementById('nav-credits').textContent = d.credits;
    document.getElementById('nav-essence').textContent = d.essence || 0;
    const eEl = document.getElementById('nav-energy');
    if (eEl) eEl.textContent = d.energy != null ? d.energy : '--';
  }).catch(() => {});
}

// === RENDER ROCKS ===
function renderRocks() {
  const container = document.getElementById('mine-rocks');
  container.innerHTML = '';

  if (!mineData || !mineData.rocks) return;

  mineData.rocks.forEach((rock, i) => {
    if (rock.mined) return;

    const pos = ROCK_POSITIONS[i] || ROCK_POSITIONS[i % ROCK_POSITIONS.length];
    const el = document.createElement('div');
    el.className = 'mine-rock';
    el.style.left = pos.left + '%';
    el.style.top = pos.top + '%';
    el.dataset.index = i;
    el.title = 'Cliquez pour miner !';

    const img = document.createElement('img');
    img.src = '/img/mine/block.png';
    img.className = 'mine-rock-img';
    img.draggable = false;
    el.appendChild(img);

    const pick = document.createElement('div');
    pick.className = 'mine-rock-pick';
    pick.textContent = '\u26CF';
    el.appendChild(pick);

    el.addEventListener('click', () => hitRock(i, el));
    container.appendChild(el);
  });
}

// === RENDER MINERALS ON GROUND ===
function renderMinerals() {
  const container = document.getElementById('mine-minerals-ground');
  container.innerHTML = '';

  if (!mineData || !mineData.rocks) return;

  mineData.rocks.forEach((rock, i) => {
    if (!rock.mined) return;

    const pos = MINERAL_POSITIONS[i] || MINERAL_POSITIONS[i % MINERAL_POSITIONS.length];
    const el = document.createElement('div');
    el.className = 'mine-mineral-ground';
    el.style.left = pos.left + '%';
    el.style.top = pos.top + '%';

    const img = document.createElement('img');
    img.src = `/img/mine/${rock.mineral}.png`;
    img.className = 'mine-mineral-img';
    img.draggable = false;
    el.appendChild(img);

    const label = document.createElement('span');
    label.className = 'mine-mineral-label';
    label.textContent = RESOURCE_NAMES[rock.mineral];
    label.style.color = RESOURCE_COLORS[rock.mineral];
    el.appendChild(label);

    container.appendChild(el);
  });
}

// === MINE A ROCK ===
async function hitRock(index, el) {
  if (el.classList.contains('mine-rock--breaking')) return;
  el.classList.add('mine-rock--breaking');
  el.style.animation = 'rockShake 0.4s ease-in-out';

  try {
    const res = await fetch('/api/mine/hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index })
    });
    const data = await res.json();

    if (data.noEnergy) {
      showNotification("Pas assez d'\u00e9nergie !", 'error');
      el.classList.remove('mine-rock--breaking');
      el.style.animation = '';
      return;
    }

    if (data.success) {
      mineData.rocks[index].mined = true;
      mineData.rocks[index].mineral = data.mineral;
      if (!mineData.minerals) mineData.minerals = [];
      mineData.minerals.push({ resource: data.mineral });

      setTimeout(() => {
        el.classList.add('mine-rock--explode');

        if (data.mineral === 'diamant') {
          flashScreen('rgba(64,208,255,0.3)');
          showNotification('DIAMANT trouve !', 'diamant');
        } else if (data.mineral === 'or') {
          flashScreen('rgba(240,192,64,0.2)');
          showNotification('OR trouve !', 'or');
        } else if (data.mineral === 'fer') {
          showNotification('Fer trouve !', 'fer');
        } else {
          showNotification('Charbon trouve', 'charbon');
        }

        setTimeout(() => {
          renderRocks();
          renderMinerals();
          if (data.allMined) {
            cooldownTotal = data.cooldownTotal || 840;
            startCooldownTimer(cooldownTotal);
          }
        }, 300);
      }, 400);
    } else if (data.cooldown) {
      showNotification('Mine en restock...', 'error');
    }
  } catch (e) {
    console.error('Erreur mine/hit:', e);
    el.classList.remove('mine-rock--breaking');
  }
}

// === SHOP ===
function setupShop() {
  document.getElementById('mine-shop-hitbox').addEventListener('click', openShop);
  document.getElementById('mine-shop-close').addEventListener('click', closeShop);
  document.getElementById('mine-shop-popup').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeShop();
  });

  document.querySelectorAll('.mine-shop-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.stab;
      document.querySelectorAll('.mine-shop-panel').forEach(p => p.classList.add('hidden'));
      document.querySelectorAll('.mine-shop-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(`stab-${tabName}`).classList.remove('hidden');
      tab.classList.add('active');
      if (tabName === 'upgrade') loadUpgrades();
      if (tabName === 'craft') loadCraftRecipes();
    });
  });

  document.getElementById('mine-sell-all-btn').addEventListener('click', sellAll);
}

function openShop() {
  document.getElementById('mine-shop-popup').classList.remove('hidden');
  renderSellTab();
}

function closeShop() {
  document.getElementById('mine-shop-popup').classList.add('hidden');
}

function renderSellTab() {
  const list = document.getElementById('mine-sell-list');
  const totalEl = document.getElementById('mine-sell-total');
  const btn = document.getElementById('mine-sell-all-btn');
  list.innerHTML = '';

  const minerals = mineData?.minerals || [];

  if (!minerals.length) {
    list.innerHTML = '<p class="mine-sell-empty">Aucun minerai a vendre. Minez des pierres !</p>';
    totalEl.textContent = '';
    btn.disabled = true;
    return;
  }

  const counts = {};
  let totalPrice = 0;
  minerals.forEach(m => {
    counts[m.resource] = (counts[m.resource] || 0) + 1;
    totalPrice += RESOURCE_PRICES[m.resource] || 0;
  });

  for (const [resource, count] of Object.entries(counts)) {
    const row = document.createElement('div');
    row.className = 'mine-sell-row';
    row.innerHTML = `
      <img src="/img/mine/${resource}.png" class="mine-sell-icon">
      <span class="mine-sell-name">${RESOURCE_NAMES[resource]}</span>
      <span class="mine-sell-count">x${count}</span>
      <span class="mine-sell-price" style="color:${RESOURCE_COLORS[resource]}">${count * RESOURCE_PRICES[resource]} CR</span>
    `;
    list.appendChild(row);
  }

  totalEl.innerHTML = `<strong>TOTAL : ${totalPrice} CR</strong>`;
  btn.disabled = false;
}

async function sellAll() {
  try {
    const res = await fetch('/api/mine/sell-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (data.success) {
      showNotification(`+${data.totalSold} CR (${data.itemsSold} minerais)`, 'sell');
      if (data.totalSold && typeof showCreditsReward === 'function') showCreditsReward(data.totalSold);
      mineData.credits = data.credits;
      mineData.minerals = [];
      document.getElementById('nav-credits').textContent = data.credits;
      renderSellTab();
      renderMinerals();
    }
  } catch (e) {
    console.error('Erreur sell-all:', e);
  }
}

async function loadUpgrades() {
  try {
    const res = await fetch('/api/mine/upgrades');
    const data = await res.json();

    mineData.essence = data.essence;
    document.getElementById('shop-essence').textContent = data.essence;
    document.getElementById('nav-essence').textContent = data.essence;

    const grid = document.getElementById('mine-upgrades-grid');
    grid.innerHTML = '';

    for (const [key, upgrade] of Object.entries(data.upgrades)) {
      const card = document.createElement('div');
      card.className = `mine-upgrade-card ${upgrade.maxed ? 'mine-upgrade--maxed' : ''}`;

      const levelBar = Array.from({ length: upgrade.maxLevel }, (_, i) =>
        `<span class="mine-level-pip ${i < upgrade.level ? 'pip--filled' : ''}"></span>`
      ).join('');

      card.innerHTML = `
        <div class="mine-upgrade-emoji">${upgrade.emoji}</div>
        <h3 class="mine-upgrade-name">${upgrade.name}</h3>
        <p class="mine-upgrade-desc">${upgrade.desc}</p>
        <div class="mine-level-bar">${levelBar}</div>
        <p class="mine-upgrade-level">Niv. ${upgrade.level}/${upgrade.maxLevel}</p>
        ${upgrade.maxed
          ? '<div class="mine-upgrade-maxed">MAX</div>'
          : `<button class="mine-upgrade-btn" data-type="${key}" ${data.essence < upgrade.nextCost ? 'disabled' : ''}>
               \u26CF ${upgrade.nextCost} Essence
             </button>`
        }
      `;
      grid.appendChild(card);
    }

    grid.querySelectorAll('.mine-upgrade-btn').forEach(btn => {
      btn.addEventListener('click', () => purchaseUpgrade(btn.dataset.type));
    });
  } catch (e) {
    console.error('Erreur load upgrades:', e);
  }
}

async function purchaseUpgrade(type) {
  try {
    const res = await fetch('/api/mine/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type })
    });
    const data = await res.json();

    if (data.success) {
      showNotification('Amelioration achetee !', 'upgrade');
      mineData.essence = data.essence;
      document.getElementById('nav-essence').textContent = data.essence;
      loadUpgrades();
    } else {
      showNotification(data.error || 'Erreur', 'error');
    }
  } catch (e) {
    console.error('Erreur upgrade:', e);
  }
}

// === COOLDOWN TIMER ===
function startCooldownTimer(seconds) {
  cooldownSecondsLeft = seconds;
  const overlay = document.getElementById('mine-timer-overlay');
  const timerEl = document.getElementById('mine-timer-value');
  const barEl = document.getElementById('mine-timer-bar');

  overlay.classList.remove('hidden');
  if (cooldownInterval) clearInterval(cooldownInterval);

  function updateDisplay() {
    const mins = Math.floor(cooldownSecondsLeft / 60);
    const secs = cooldownSecondsLeft % 60;
    timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    const progress = ((cooldownTotal - cooldownSecondsLeft) / cooldownTotal) * 100;
    barEl.style.width = `${progress}%`;
  }

  updateDisplay();

  cooldownInterval = setInterval(() => {
    cooldownSecondsLeft--;
    if (cooldownSecondsLeft <= 0) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
      overlay.classList.add('hidden');
      showNotification('Mine prete ! Nouvelles pierres !', 'reset');
      loadMineState();
    } else {
      updateDisplay();
    }
  }, 1000);
}

// === HELPERS ===
function flashScreen(color) {
  const flash = document.createElement('div');
  flash.className = 'mine-flash';
  flash.style.background = color;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 400);
}

function showNotification(text, type = 'info') {
  const el = document.getElementById('mine-notification');
  el.textContent = text;
  el.className = `mine-notification mine-notif--${type}`;
  el.classList.remove('hidden');
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => el.classList.add('hidden'), 2500);
}

// === CRAFT ===
let craftData = null;

async function loadCraftRecipes() {
  try {
    const res = await fetch('/api/craft/recipes');
    const data = await res.json();
    craftData = data;
    renderCraftTab();
  } catch (e) {
    console.error('Erreur load craft recipes:', e);
  }
}

function renderCraftTab() {
  const grid = document.getElementById('mine-craft-grid');
  grid.innerHTML = '';

  if (!craftData || !craftData.recipes || !craftData.recipes.length) {
    grid.innerHTML = '<p class="mine-sell-empty">Aucune recette disponible.</p>';
    return;
  }

  const resources = craftData.resources || {};
  const essence = craftData.essence || 0;

  craftData.recipes.forEach(recipe => {
    const card = document.createElement('div');
    card.className = 'mine-upgrade-card';

    let costsHtml = '';
    if (recipe.costs) {
      for (const [res, amount] of Object.entries(recipe.costs)) {
        let owned;
        if (res === 'essence') {
          owned = essence;
        } else {
          owned = resources[res] || 0;
        }
        const enough = owned >= amount;
        const color = enough ? '#4f4' : '#f44';
        const label = res === 'essence' ? 'Essence' : (RESOURCE_NAMES[res] || res);
        costsHtml += `<span style="color:${color}">${label}: ${owned}/${amount}</span><br>`;
      }
    }

    card.innerHTML = `
      <div class="mine-upgrade-emoji">${recipe.emoji || '\u2728'}</div>
      <h3 class="mine-upgrade-name">${recipe.name}</h3>
      <div class="mine-craft-costs">${costsHtml}</div>
      <button class="mine-upgrade-btn mine-craft-btn" data-recipe="${recipe.id}">FABRIQUER</button>
    `;
    grid.appendChild(card);
  });

  grid.querySelectorAll('.mine-craft-btn').forEach(btn => {
    btn.addEventListener('click', () => doCraft(btn.dataset.recipe));
  });
}

async function doCraft(recipeId) {
  try {
    const res = await fetch('/api/craft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipeId })
    });
    const data = await res.json();

    if (data.success) {
      showNotification(data.message || 'Objet fabrique !', 'upgrade');
      updateNav();
      loadCraftRecipes();
    } else {
      showNotification(data.error || 'Craft impossible', 'error');
    }
  } catch (e) {
    console.error('Erreur craft:', e);
  }
}

// === START ===
init();
