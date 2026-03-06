// collection.js — Drag & Drop + Systeme de vente (updated with shiny/fused)

let currentCredits = 0;
let sellPrices = {};
let cardsData = [];
let isSelling = false;

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

function renderCollection(cards) {
  cardsData = cards;
  const grid = document.getElementById('collection-grid');
  const emptyMsg = document.getElementById('empty-msg');

  if (cards.length === 0) {
    grid.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    return;
  }

  emptyMsg.classList.add('hidden');

  grid.innerHTML = cards.map((card, idx) => {
    const r = RARITY_COLORS[card.rarity];
    let price = sellPrices[card.rarity] || 0;
    if (card.is_shiny) price *= 3;
    if (card.is_fused) price *= 2;

    const shinyClass = card.is_shiny ? 'collection-card-shiny' : '';
    const fusedClass = card.is_fused ? 'collection-card-fused' : '';

    return `
      <div class="collection-card rarity-${card.rarity} ${shinyClass} ${fusedClass}"
           draggable="true"
           data-card-idx="${idx}"
           data-user-card-id="${card.user_card_id}"
           data-card-id="${card.id}"
           style="border-color:${r.color}; box-shadow:0 0 12px ${r.glow}">
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
  let price = sellPrices[card.rarity] || 0;
  if (card.is_shiny) price *= 3;
  if (card.is_fused) price *= 2;

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

async function loadCollection() {
  const res = await fetch('/api/collection');
  if (!res.ok) { window.location.href = '/'; return; }
  const cards = await res.json();
  renderCollection(cards);
}

async function init() {
  await Promise.all([loadCredits(), loadSellPrices()]);
  await loadCollection();
}

init();
