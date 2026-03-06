// collection.js — Filtres, Tri, Recherche + Drag & Drop Vente

let currentCredits = 0;
let sellPrices = {};
let cardsData = [];
let filteredCards = [];
let isSelling = false;

// Etat des filtres
const filterState = {
  search: '',
  rarity: 'all',
  element: 'all',
  type: 'all',
  shiny: false,
  fused: false,
  sort: 'rarity'
};

// Ordre de rarete pour le tri
const RARITY_ORDER = { commune: 0, rare: 1, epique: 2, legendaire: 3 };

// ==========================================
//  CHARGEMENT INITIAL
// ==========================================

async function loadCredits() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  const data = await res.json();
  currentCredits = data.credits;
  document.getElementById('credits-count').textContent = currentCredits;
}

async function loadSellPrices() {
  const res = await fetch('/api/sell-prices');
  if (res.ok) sellPrices = await res.json();
}

// ==========================================
//  STATS D'INVENTAIRE
// ==========================================

function updateStats(cards) {
  const total = cards.length;
  let commune = 0, rare = 0, epique = 0, legendaire = 0, shiny = 0;

  cards.forEach(c => {
    if (c.rarity === 'commune') commune++;
    else if (c.rarity === 'rare') rare++;
    else if (c.rarity === 'epique') epique++;
    else if (c.rarity === 'legendaire') legendaire++;
    if (c.is_shiny) shiny++;
  });

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-commune').textContent = commune;
  document.getElementById('stat-rare').textContent = rare;
  document.getElementById('stat-epique').textContent = epique;
  document.getElementById('stat-legendaire').textContent = legendaire;
  document.getElementById('stat-shiny').textContent = shiny;
}

// ==========================================
//  FILTRAGE & TRI
// ==========================================

function getCardPrice(card) {
  let price = sellPrices[card.rarity] || 0;
  if (card.is_shiny) price *= 3;
  if (card.is_fused) price *= 2;
  return price;
}

function getEffectiveStat(card, stat) {
  const mult = card.is_fused ? 2 : 1;
  return card[stat] * mult;
}

function applyFilters() {
  let cards = [...cardsData];

  // Filtre recherche
  if (filterState.search) {
    const q = filterState.search.toLowerCase();
    cards = cards.filter(c => c.name.toLowerCase().includes(q));
  }

  // Filtre rarete
  if (filterState.rarity !== 'all') {
    cards = cards.filter(c => c.rarity === filterState.rarity);
  }

  // Filtre element
  if (filterState.element !== 'all') {
    cards = cards.filter(c => c.element === filterState.element);
  }

  // Filtre type
  if (filterState.type !== 'all') {
    cards = cards.filter(c => c.type === filterState.type);
  }

  // Filtre shiny
  if (filterState.shiny) {
    cards = cards.filter(c => c.is_shiny);
  }

  // Filtre fused
  if (filterState.fused) {
    cards = cards.filter(c => c.is_fused);
  }

  // Tri
  cards.sort((a, b) => {
    switch (filterState.sort) {
      case 'rarity':
        return (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0);
      case 'atk':
        return getEffectiveStat(b, 'attack') - getEffectiveStat(a, 'attack');
      case 'def':
        return getEffectiveStat(b, 'defense') - getEffectiveStat(a, 'defense');
      case 'hp':
        return getEffectiveStat(b, 'hp') - getEffectiveStat(a, 'hp');
      case 'name_asc':
        return a.name.localeCompare(b.name, 'fr');
      case 'name_desc':
        return b.name.localeCompare(a.name, 'fr');
      case 'price':
        return getCardPrice(b) - getCardPrice(a);
      default:
        return 0;
    }
  });

  filteredCards = cards;

  // Mise a jour compteur resultats
  const countEl = document.getElementById('filter-result-count');
  if (filterState.search || filterState.rarity !== 'all' || filterState.element !== 'all' ||
      filterState.type !== 'all' || filterState.shiny || filterState.fused) {
    countEl.textContent = `${cards.length} carte${cards.length !== 1 ? 's' : ''} trouvee${cards.length !== 1 ? 's' : ''}`;
    countEl.classList.add('visible');
  } else {
    countEl.textContent = '';
    countEl.classList.remove('visible');
  }

  renderFilteredCards(cards);
}

// ==========================================
//  RENDU DES CARTES
// ==========================================

function renderFilteredCards(cards) {
  const grid = document.getElementById('collection-grid');
  const emptyMsg = document.getElementById('empty-msg');
  const noResultsMsg = document.getElementById('no-results-msg');

  // Si pas de cartes du tout
  if (cardsData.length === 0) {
    grid.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    noResultsMsg.classList.add('hidden');
    return;
  }

  emptyMsg.classList.add('hidden');

  // Si filtres actifs mais aucun resultat
  if (cards.length === 0) {
    grid.innerHTML = '';
    noResultsMsg.classList.remove('hidden');
    return;
  }

  noResultsMsg.classList.add('hidden');

  grid.innerHTML = cards.map((card, idx) => {
    const r = RARITY_COLORS[card.rarity];
    const price = getCardPrice(card);
    const shinyClass = card.is_shiny ? 'collection-card-shiny' : '';
    const fusedClass = card.is_fused ? 'collection-card-fused' : '';

    return `
      <div class="collection-card rarity-${card.rarity} ${shinyClass} ${fusedClass} card-appear"
           draggable="true"
           data-card-idx="${idx}"
           data-user-card-id="${card.user_card_id}"
           data-card-id="${card.id}"
           style="border-color:${r.color}; box-shadow:0 0 12px ${r.glow}; animation-delay:${Math.min(idx * 30, 600)}ms">
        ${renderHolo(card.rarity, card.is_shiny)}
        ${renderBadges(card)}
        <div class="card-count">x${card.count}</div>
        <div class="card-rarity" style="background:${r.color}">${r.label}</div>
        ${renderCardVisual(card)}
        <div class="card-name">${card.name}</div>
        <div class="card-element" style="color:${ELEMENT_COLORS[card.element] || '#00ff41'}; border:1px solid ${ELEMENT_COLORS[card.element] || '#00ff41'};">${ELEMENT_ICONS[card.element] || '?'} ${ELEMENT_NAMES[card.element] || card.element}</div>
        ${renderStatBars(card)}
        <div class="card-sep"></div>
        <div class="card-ability">
          <div class="ability-cost">&#9670; ${card.mana_cost} MANA</div>
          <div class="ability-name">${card.ability_name}</div>
          <div class="ability-desc">${card.ability_desc}</div>
        </div>
        <div class="card-type">${card.type}</div>
        <div class="card-sell-badge">${price} CR</div>
      </div>
    `;
  }).join('');

  // Click pour detail
  grid.querySelectorAll('.collection-card').forEach((el) => {
    const idx = parseInt(el.dataset.cardIdx);
    el.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      showCardDetail(cards[idx]);
    });
  });

  setupDragOnCards();
  initTiltEffect(grid);
}

function renderCollection(cards) {
  cardsData = cards;
  updateStats(cards);
  applyFilters();
}

// ==========================================
//  EVENT LISTENERS FILTRES
// ==========================================

function setupFilterListeners() {
  // Recherche
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    filterState.search = searchInput.value.trim();
    applyFilters();
  });

  // Boutons de filtre (rarete, element, type)
  document.querySelectorAll('.filter-btn[data-filter][data-value]').forEach(btn => {
    btn.addEventListener('click', () => {
      const filterType = btn.dataset.filter;
      const value = btn.dataset.value;

      // Desactiver les autres boutons du meme groupe
      document.querySelectorAll(`.filter-btn[data-filter="${filterType}"]`).forEach(b => {
        b.classList.remove('active');
      });
      btn.classList.add('active');

      filterState[filterType] = value;
      applyFilters();
    });
  });

  // Toggle shiny
  document.getElementById('filter-shiny').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    filterState.shiny = !filterState.shiny;
    btn.classList.toggle('active', filterState.shiny);
    applyFilters();
  });

  // Toggle fused
  document.getElementById('filter-fused').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    filterState.fused = !filterState.fused;
    btn.classList.toggle('active', filterState.fused);
    applyFilters();
  });

  // Tri
  document.getElementById('sort-select').addEventListener('change', (e) => {
    filterState.sort = e.target.value;
    applyFilters();
  });
}

// ==========================================
//  ANIMATION CREDITS
// ==========================================

function animateCredits(from, to) {
  const el = document.getElementById('credits-count');
  const display = document.querySelector('.credits-display');
  const duration = 600;
  const start = performance.now();

  display.classList.remove('credits-flash');
  void display.offsetWidth;
  display.classList.add('credits-flash');

  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(from + (to - from) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ==========================================
//  DRAG & DROP VENTE
// ==========================================

function setupDragOnCards() {
  const grid = document.getElementById('collection-grid');
  const sellZone = document.getElementById('sell-zone');

  grid.querySelectorAll('.collection-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      if (isSelling) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', card.dataset.userCardId || card.dataset.cardId);
      e.dataTransfer.setData('application/x-user-card-id', card.dataset.userCardId || '');
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => card.classList.add('dragging'));
      sellZone.classList.add('drag-active');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      sellZone.classList.remove('drag-active');
      sellZone.classList.remove('drag-hover');
    });
  });

  sellZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  sellZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    sellZone.classList.add('drag-hover');
  });

  sellZone.addEventListener('dragleave', (e) => {
    if (!sellZone.contains(e.relatedTarget)) {
      sellZone.classList.remove('drag-hover');
    }
  });

  sellZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    sellZone.classList.remove('drag-active');
    sellZone.classList.remove('drag-hover');

    const userCardId = e.dataTransfer.getData('application/x-user-card-id');
    const cardId = e.dataTransfer.getData('text/plain');
    if ((!cardId && !userCardId) || isSelling) return;

    await sellCard(userCardId ? parseInt(userCardId) : null, cardId ? parseInt(cardId) : null);
  });
}

async function sellCard(userCardId, cardId) {
  isSelling = true;
  const grid = document.getElementById('collection-grid');
  const sellZone = document.getElementById('sell-zone');

  grid.classList.add('selling-locked');
  sellZone.classList.add('selling-locked');

  const card = cardsData.find(c => (userCardId && c.user_card_id === userCardId) || (!userCardId && c.id === cardId));
  if (!card) { unlock(); return; }

  playSellAnimation(card);

  try {
    const body = userCardId ? { user_card_id: userCardId } : { card_id: cardId };
    const res = await fetch('/api/collection/sell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erreur lors de la vente');
      hideSellOverlay();
      unlock();
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 1800));

    animateCredits(currentCredits, data.credits);
    currentCredits = data.credits;

    screenFlash();
    hideSellOverlay();
    renderCollection(data.collection);

  } catch (err) {
    alert('Erreur reseau');
    hideSellOverlay();
  }

  unlock();
}

function unlock() {
  isSelling = false;
  const grid = document.getElementById('collection-grid');
  const sellZone = document.getElementById('sell-zone');
  grid.classList.remove('selling-locked');
  sellZone.classList.remove('selling-locked');
}

function playSellAnimation(card) {
  const overlay = document.getElementById('sell-overlay');
  const container = document.getElementById('sell-card-container');
  const pricePopup = document.getElementById('sell-price-popup');

  const r = RARITY_COLORS[card.rarity];
  const price = getCardPrice(card);

  container.innerHTML = `
    <div class="collection-card rarity-${card.rarity}" style="border-color:${r.color}; box-shadow:0 0 12px ${r.glow}; min-height:300px;">
      ${renderHolo(card.rarity, card.is_shiny)}
      ${renderBadges(card)}
      <div class="card-rarity" style="background:${r.color}">${r.label}</div>
      ${renderCardVisual(card)}
      <div class="card-name">${card.name}</div>
      <div class="card-element" style="color:${ELEMENT_COLORS[card.element] || '#00ff41'}; border:1px solid ${ELEMENT_COLORS[card.element] || '#00ff41'};">${ELEMENT_ICONS[card.element] || '?'} ${ELEMENT_NAMES[card.element] || card.element}</div>
      ${renderStatBars(card)}
    </div>
  `;

  pricePopup.textContent = `+${price} CR`;

  container.style.animation = 'none';
  pricePopup.style.animation = 'none';
  void container.offsetWidth;
  container.style.animation = '';
  pricePopup.style.animation = '';

  overlay.classList.remove('hidden');
}

function hideSellOverlay() {
  document.getElementById('sell-overlay').classList.add('hidden');
}

function screenFlash() {
  const flash = document.getElementById('screen-flash');
  flash.classList.remove('hidden');
  flash.classList.add('flash-active');
  setTimeout(() => {
    flash.classList.remove('flash-active');
    flash.classList.add('hidden');
  }, 400);
}

// ==========================================
//  CHARGEMENT COLLECTION
// ==========================================

async function loadCollection() {
  const res = await fetch('/api/collection');
  if (!res.ok) { window.location.href = '/'; return; }
  const cards = await res.json();
  renderCollection(cards);
}

async function init() {
  setupFilterListeners();
  await Promise.all([loadCredits(), loadSellPrices()]);
  await loadCollection();
}

init();
