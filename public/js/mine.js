// mine.js — Mine game logic

let mineState = null;
let currentCredits = 0;
let currentEssence = 0;
let isHitting = false;

const RESOURCE_NAMES = {
  charbon: 'Charbon',
  fer: 'Fer',
  or: 'Or',
  diamant: 'Diamant'
};

const RESOURCE_PRICES = {
  charbon: 3,
  fer: 12,
  or: 20,
  diamant: 50
};

// === INIT ===
async function init() {
  await loadMineState();
  setupTabs();
  setupButtons();
}

async function loadMineState() {
  try {
    const res = await fetch('/api/mine/state');
    if (!res.ok) {
      if (res.status === 401) { window.location.href = '/'; return; }
      return;
    }
    mineState = await res.json();
    currentCredits = mineState.credits;
    currentEssence = mineState.essence;

    updateNav();
    renderMineGrid(mineState.grid);
    renderInventory(mineState.inventory, mineState.maxSlots);
    renderHiddenResources(mineState.hiddenResources);
    updateButtons();
  } catch (e) {
    console.error('Erreur chargement mine:', e);
  }
}

function updateNav() {
  document.getElementById('nav-credits').textContent = currentCredits;
  document.getElementById('nav-essence').textContent = currentEssence;
  // Try to load username
  fetch('/api/me').then(r => r.json()).then(d => {
    document.getElementById('nav-username').textContent = d.displayName || d.username;
    currentCredits = d.credits;
    currentEssence = d.essence || 0;
    document.getElementById('nav-credits').textContent = currentCredits;
    document.getElementById('nav-essence').textContent = currentEssence;
  }).catch(() => {});
}

// === TAB SWITCHING ===
function setupTabs() {
  document.querySelectorAll('.mine-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.mine-panel').forEach(p => p.classList.add('hidden'));
      document.querySelectorAll('.mine-tab').forEach(t => t.classList.remove('active'));
      document.getElementById(`tab-${tabName}`).classList.remove('hidden');
      tab.classList.add('active');

      if (tabName === 'collecter') renderCollecterTab();
      if (tabName === 'shop') renderPierreShop();
    });
  });
}

function setupButtons() {
  document.getElementById('mine-sell-all').addEventListener('click', sellAll);
  document.getElementById('mine-reset').addEventListener('click', resetMine);
  document.getElementById('collecter-sell-all').addEventListener('click', sellAll);
  document.getElementById('collecter-reset').addEventListener('click', resetMine);
}

function updateButtons() {
  const inv = mineState?.inventory || [];
  const hasItems = inv.length > 0;
  document.getElementById('mine-sell-all').disabled = !hasItems;
  document.getElementById('mine-reset').disabled = hasItems;
  const cs = document.getElementById('collecter-sell-all');
  const cr = document.getElementById('collecter-reset');
  if (cs) cs.disabled = !hasItems;
  if (cr) cr.disabled = hasItems;
}

// === MINE GRID RENDERING ===
function renderMineGrid(grid) {
  const container = document.getElementById('mine-grid');
  container.innerHTML = '';

  grid.forEach((block, i) => {
    const div = document.createElement('div');
    div.className = 'mine-block';
    div.dataset.index = i;

    if (block.mined) {
      div.classList.add('mine-block--mined');
      if (block.resource) {
        div.classList.add(`mine-block--${block.resource}`);
        const img = document.createElement('img');
        img.src = `/img/mine/${block.resource}.png`;
        img.className = 'mine-block-resource';
        div.appendChild(img);
        if (!block.collected) {
          div.classList.add('mine-block--uncollected');
        }
      }
    } else {
      // Crack level
      const upgrades = mineState?.upgrades || {};
      const adjusted = Math.max(1, block.resistance - (upgrades.mine_speed || 0));
      const progress = block.hits / adjusted;
      const crackLevel = Math.min(4, Math.floor(progress * 5));
      if (crackLevel > 0) div.classList.add(`mine-block--crack-${crackLevel}`);
      div.addEventListener('click', () => hitBlock(i));
    }

    container.appendChild(div);
  });
}

function updateSingleBlock(index, blockData) {
  const div = document.querySelector(`.mine-block[data-index="${index}"]`);
  if (!div) return;

  // Remove old classes
  div.className = 'mine-block';
  div.innerHTML = '';

  if (blockData.mined) {
    div.classList.add('mine-block--mined');
    if (blockData.resource) {
      div.classList.add(`mine-block--${blockData.resource}`);
      div.classList.add('mine-block--breaking');
      const img = document.createElement('img');
      img.src = `/img/mine/${blockData.resource}.png`;
      img.className = 'mine-block-resource';
      div.appendChild(img);
      if (blockData.collected) {
        // Collected - slightly dimmer
      } else {
        div.classList.add('mine-block--uncollected');
        div.addEventListener('click', () => collectResource(index));
      }
      // Flash effect for rare resources
      if (blockData.resource === 'diamant') {
        flashScreen('rgba(100,200,255,0.3)');
        showNotification('💎 DIAMANT trouve !', 'diamant');
      } else if (blockData.resource === 'or') {
        flashScreen('rgba(255,200,0,0.2)');
        showNotification('🟡 OR trouve !', 'or');
      }
    }
  } else {
    // Update crack
    const crackLevel = blockData.crackLevel || 0;
    if (crackLevel > 0) div.classList.add(`mine-block--crack-${crackLevel}`);
    div.classList.add('mine-block--hit');
    setTimeout(() => div.classList.remove('mine-block--hit'), 150);
    div.addEventListener('click', () => hitBlock(index));
  }
}

// === MINING LOGIC ===
async function hitBlock(index) {
  if (isHitting) return;
  isHitting = true;

  try {
    const res = await fetch('/api/mine/hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index })
    });
    const data = await res.json();

    if (data.success) {
      // Update local state
      mineState.grid[index] = {
        ...mineState.grid[index],
        hits: data.block.hits,
        mined: data.block.mined,
        collected: data.block.collected,
        resource: data.block.resource
      };

      updateSingleBlock(index, data.block);

      if (data.inventoryItem) {
        mineState.inventory.push(data.inventoryItem);
        renderInventory(mineState.inventory, mineState.maxSlots);
        // Update hidden resources
        if (data.block.resource && mineState.hiddenResources[data.block.resource] !== undefined) {
          mineState.hiddenResources[data.block.resource]--;
          renderHiddenResources(mineState.hiddenResources);
        }
      }

      if (data.inventoryFull) {
        showInventoryWarning(true);
      }

      updateButtons();
    }
  } catch (e) {
    console.error('Erreur mine/hit:', e);
  }

  isHitting = false;
}

async function collectResource(index) {
  try {
    const res = await fetch('/api/mine/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index })
    });
    const data = await res.json();

    if (data.success) {
      mineState.grid[index].collected = true;
      mineState.inventory.push(data.inventoryItem);
      renderInventory(mineState.inventory, mineState.maxSlots);

      const resource = mineState.grid[index].resource;
      if (resource && mineState.hiddenResources[resource] !== undefined) {
        mineState.hiddenResources[resource]--;
        renderHiddenResources(mineState.hiddenResources);
      }

      // Update block visual
      const div = document.querySelector(`.mine-block[data-index="${index}"]`);
      if (div) div.classList.remove('mine-block--uncollected');

      updateButtons();
    } else if (data.inventoryFull) {
      showInventoryWarning(true);
    }
  } catch (e) {
    console.error('Erreur collect:', e);
  }
}

// === INVENTORY ===
function renderInventory(items, maxSlots) {
  const container = document.getElementById('mine-inv-slots');
  container.innerHTML = '';

  for (let i = 0; i < maxSlots; i++) {
    const slot = document.createElement('div');
    slot.className = 'mine-inv-slot';

    const item = items.find(it => it.slot_index === i || it.slot === i);
    if (item) {
      slot.classList.add('mine-inv-slot--filled', `mine-inv-slot--${item.resource}`);
      const img = document.createElement('img');
      img.src = `/img/mine/${item.resource}.png`;
      img.className = 'mine-inv-resource';
      slot.appendChild(img);
      const label = document.createElement('span');
      label.className = 'mine-inv-label';
      label.textContent = RESOURCE_NAMES[item.resource];
      slot.appendChild(label);
    } else {
      slot.classList.add('mine-inv-slot--empty');
      slot.innerHTML = '<span class="mine-inv-empty">—</span>';
    }

    container.appendChild(slot);
  }

  showInventoryWarning(items.length >= maxSlots);
}

function showInventoryWarning(show) {
  const warning = document.getElementById('mine-inv-warning');
  if (warning) warning.classList.toggle('hidden', !show);
}

// === HIDDEN RESOURCES ===
function renderHiddenResources(resources) {
  document.getElementById('hidden-charbon').textContent = resources.charbon;
  document.getElementById('hidden-fer').textContent = resources.fer;
  document.getElementById('hidden-or').textContent = resources.or;
  document.getElementById('hidden-diamant').textContent = resources.diamant;
}

// === SELLING ===
async function sellAll() {
  try {
    const res = await fetch('/api/mine/sell-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (data.success) {
      showNotification(`+${data.totalSold} CR (${data.itemsSold} minerais vendus) — Nouvelle mine !`, 'sell');
      currentCredits = data.credits;
      document.getElementById('nav-credits').textContent = currentCredits;
      mineState.inventory = [];
      renderInventory([], mineState.maxSlots);
      showInventoryWarning(false);

      // Auto-reset: nouvelle mine incluse dans la reponse
      if (data.grid) {
        mineState.grid = data.grid;
        mineState.hiddenResources = data.hiddenResources;
        renderMineGrid(data.grid);
        renderHiddenResources(data.hiddenResources);
      }

      updateButtons();

      // Update collecter tab if visible
      const collecterGrid = document.getElementById('collecter-grid');
      if (collecterGrid && !document.getElementById('tab-collecter').classList.contains('hidden')) {
        renderCollecterTab();
      }
    }
  } catch (e) {
    console.error('Erreur sell-all:', e);
  }
}

// === MINE RESET ===
async function resetMine() {
  try {
    const res = await fetch('/api/mine/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (data.success) {
      showNotification('Nouvelle mine generee !', 'reset');
      mineState.grid = data.grid;
      mineState.hiddenResources = data.hiddenResources;
      renderMineGrid(data.grid);
      renderHiddenResources(data.hiddenResources);
      updateButtons();
    } else if (res.status === 400) {
      showNotification('Videz votre inventaire d\'abord !', 'error');
    }
  } catch (e) {
    console.error('Erreur reset:', e);
  }
}

// === COLLECTER TAB ===
function renderCollecterTab() {
  const grid = document.getElementById('collecter-grid');
  grid.innerHTML = '';

  const items = mineState?.inventory || [];

  if (!items.length) {
    grid.innerHTML = '<p class="collecter-empty">Inventaire vide. Minez des ressources !</p>';
    return;
  }

  items.forEach((item, i) => {
    const resource = item.resource;
    const div = document.createElement('div');
    div.className = `collecter-item collecter-item--${resource}`;
    div.innerHTML = `
      <img src="/img/mine/${resource}.png" class="collecter-item-img">
      <div class="collecter-item-name">${RESOURCE_NAMES[resource]}</div>
      <div class="collecter-item-price">${RESOURCE_PRICES[resource]} CR</div>
      <button class="collecter-sell-btn" data-slot="${item.slot_index !== undefined ? item.slot_index : item.slot}">VENDRE</button>
    `;
    grid.appendChild(div);
  });

  grid.querySelectorAll('.collecter-sell-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const slot = parseInt(btn.dataset.slot);
      await sellSingle(slot);
    });
  });
}

async function sellSingle(slot) {
  try {
    const res = await fetch('/api/mine/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot })
    });
    const data = await res.json();

    if (data.success) {
      showNotification(`+${data.soldPrice} CR (${RESOURCE_NAMES[data.soldResource]})`, 'sell');
      currentCredits = data.credits;
      document.getElementById('nav-credits').textContent = currentCredits;
      mineState.inventory = data.inventory;
      renderInventory(data.inventory, mineState.maxSlots);
      renderCollecterTab();
      updateButtons();
    }
  } catch (e) {
    console.error('Erreur sell:', e);
  }
}

// === PIERRE SHOP ===
async function renderPierreShop() {
  try {
    const res = await fetch('/api/mine/upgrades');
    const data = await res.json();

    currentEssence = data.essence;
    document.getElementById('shop-essence').textContent = data.essence;
    document.getElementById('nav-essence').textContent = data.essence;

    const grid = document.getElementById('pierre-shop-grid');
    grid.innerHTML = '';

    for (const [key, upgrade] of Object.entries(data.upgrades)) {
      const card = document.createElement('div');
      card.className = `pierre-upgrade-card ${upgrade.maxed ? 'pierre-upgrade--maxed' : ''}`;

      const levelBar = Array.from({ length: upgrade.maxLevel }, (_, i) =>
        `<span class="pierre-level-pip ${i < upgrade.level ? 'pip--filled' : ''}"></span>`
      ).join('');

      card.innerHTML = `
        <div class="pierre-upgrade-emoji">${upgrade.emoji}</div>
        <h3 class="pierre-upgrade-name">${upgrade.name}</h3>
        <p class="pierre-upgrade-desc">${upgrade.desc}</p>
        <div class="pierre-level-bar">${levelBar}</div>
        <p class="pierre-upgrade-level">Niveau ${upgrade.level}/${upgrade.maxLevel}</p>
        ${upgrade.maxed
          ? '<div class="pierre-upgrade-maxed">MAX</div>'
          : `<button class="pierre-buy-btn" data-type="${key}" ${data.essence < upgrade.nextCost ? 'disabled' : ''}>
               &#9935; ${upgrade.nextCost} Essence
             </button>`
        }
      `;
      grid.appendChild(card);
    }

    grid.querySelectorAll('.pierre-buy-btn').forEach(btn => {
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
      currentEssence = data.essence;
      mineState.upgrades = data.upgrades;
      mineState.maxSlots = 5 + (data.upgrades.inventory_size || 0);
      document.getElementById('nav-essence').textContent = data.essence;
      renderInventory(mineState.inventory, mineState.maxSlots);
      renderPierreShop();
    } else {
      showNotification(data.error || 'Erreur', 'error');
    }
  } catch (e) {
    console.error('Erreur upgrade:', e);
  }
}

// === UI HELPERS ===
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

// === START ===
init();
