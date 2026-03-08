// decks.js — Deck builder & manager

let allDecks = [];
let myCards = [];
let currentDeckId = null;
let selectedCards = []; // array of user_card_ids in deck
let filterType = 'all';
let filterRarity = 'all';
let searchQuery = '';

async function loadDecks() {
  const res = await fetch('/api/decks');
  if (!res.ok) return;
  allDecks = await res.json();
  renderDeckList();
}

async function loadMyCards() {
  const res = await fetch('/api/my-cards');
  if (!res.ok) return;
  myCards = await res.json();
}

function renderDeckList() {
  const list = document.getElementById('deck-list');
  if (allDecks.length === 0) {
    list.innerHTML = '<div class="deck-empty">Aucun deck — creez-en un !</div>';
    return;
  }

  list.innerHTML = allDecks.map(deck => {
    return `
      <div class="deck-item" onclick="editDeck(${deck.id})">
        <div class="deck-item-name">${deck.name}</div>
        <div class="deck-item-count">${deck.cards.length}/20 cartes</div>
        <div class="deck-item-preview">
          ${deck.cards.slice(0, 8).map(c => `<span class="deck-preview-emoji" title="${c.name}">${c.emoji || ELEMENT_ICONS[c.element] || '?'}</span>`).join('')}
          ${deck.cards.length > 8 ? '...' : ''}
        </div>
      </div>
    `;
  }).join('');

  // Show/hide new button
  document.getElementById('new-deck-btn').style.display = allDecks.length >= 3 ? 'none' : '';
}

function createNewDeck() {
  currentDeckId = null;
  selectedCards = [];
  document.getElementById('deck-name').value = `Deck ${allDecks.length + 1}`;
  document.getElementById('delete-deck-btn').classList.add('hidden');
  openEditor();
}

function editDeck(deckId) {
  const deck = allDecks.find(d => d.id === deckId);
  if (!deck) return;
  currentDeckId = deckId;
  selectedCards = deck.cards.map(c => c.user_card_id);
  document.getElementById('deck-name').value = deck.name;
  document.getElementById('delete-deck-btn').classList.remove('hidden');
  openEditor();
}

function openEditor() {
  document.getElementById('deck-list').classList.add('hidden');
  document.getElementById('new-deck-btn').classList.add('hidden');
  document.getElementById('deck-editor').classList.remove('hidden');
  renderSlots();
  renderCardGrid();
  updateCounters();
}

function closeEditor() {
  document.getElementById('deck-editor').classList.add('hidden');
  document.getElementById('deck-list').classList.remove('hidden');
  document.getElementById('new-deck-btn').classList.remove('hidden');
  currentDeckId = null;
  selectedCards = [];
  filterType = 'all';
  filterRarity = 'all';
  searchQuery = '';
}

function renderSlots() {
  const slots = document.getElementById('deck-slots');
  const html = [];
  for (let i = 0; i < 20; i++) {
    if (selectedCards[i]) {
      const card = myCards.find(c => c.user_card_id === selectedCards[i]);
      if (card) {
        const r = RARITY_COLORS[card.rarity];
        const emoji = card.emoji || ELEMENT_ICONS[card.element] || '?';
        const isObj = card.type === 'objet';
        html.push(`
          <div class="deck-slot filled ${isObj ? 'deck-slot-objet' : ''}" style="border-color:${r.color}" onclick="removeFromDeck(${i})" title="${card.name}">
            <span class="deck-slot-emoji">${emoji}</span>
            <span class="deck-slot-mana">${card.mana_cost}</span>
          </div>
        `);
      } else {
        html.push(`<div class="deck-slot empty" onclick="removeFromDeck(${i})">+</div>`);
      }
    } else {
      html.push(`<div class="deck-slot empty">+</div>`);
    }
  }
  slots.innerHTML = html.join('');
}

function renderCardGrid() {
  const grid = document.getElementById('card-grid');
  let filtered = myCards.filter(card => {
    if (filterType !== 'all' && card.type !== filterType) return false;
    if (filterRarity !== 'all' && card.rarity !== filterRarity) return false;
    if (searchQuery && !card.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  grid.innerHTML = filtered.map(card => {
    const r = RARITY_COLORS[card.rarity];
    const emoji = card.emoji || ELEMENT_ICONS[card.element] || '?';
    const elemColor = ELEMENT_COLORS[card.element] || '#888';
    const inDeck = selectedCards.includes(card.user_card_id);
    const isFused = card.is_fused;
    const isShiny = card.is_shiny;
    const mult = isFused ? 2 : 1;
    const isObj = card.type === 'objet';

    return `
      <div class="deck-card ${inDeck ? 'deck-card-selected' : ''} ${isObj ? 'deck-card-objet' : ''}"
           data-uc-id="${card.user_card_id}"
           style="border-color:${r.color}"
           onclick="toggleCard(${card.user_card_id})">
        <div class="deck-card-emoji">${emoji}</div>
        <div class="deck-card-name">${card.name}</div>
        <div class="deck-card-mana">⚡${card.mana_cost}</div>
        ${isObj ? `<div class="deck-card-desc">${card.ability_desc}</div>` : `
          <div class="deck-card-stats">
            <span style="color:#ff4444">${card.attack * mult}</span>/
            <span style="color:#4488ff">${card.defense * mult}</span>/
            <span style="color:#44dd44">${card.hp * mult}</span>
          </div>
        `}
        ${isShiny ? '<div class="deck-card-badge shiny">S</div>' : ''}
        ${isFused ? '<div class="deck-card-badge fused">F+</div>' : ''}
        ${inDeck ? '<div class="deck-card-check">✓</div>' : ''}
      </div>
    `;
  }).join('');
}

function toggleCard(ucId) {
  const idx = selectedCards.indexOf(ucId);
  if (idx >= 0) {
    selectedCards.splice(idx, 1);
  } else {
    if (selectedCards.length >= 20) return;
    // Check objet limit
    const card = myCards.find(c => c.user_card_id === ucId);
    if (card && card.type === 'objet') {
      const objCount = selectedCards.filter(id => {
        const c = myCards.find(x => x.user_card_id === id);
        return c && c.type === 'objet';
      }).length;
      if (objCount >= 8) return;
    }
    selectedCards.push(ucId);
  }
  renderSlots();
  renderCardGrid();
  updateCounters();
}

function removeFromDeck(index) {
  if (selectedCards[index]) {
    selectedCards.splice(index, 1);
    renderSlots();
    renderCardGrid();
    updateCounters();
  }
}

function updateCounters() {
  const total = selectedCards.length;
  let creatures = 0, objets = 0;
  selectedCards.forEach(id => {
    const c = myCards.find(x => x.user_card_id === id);
    if (c && c.type === 'objet') objets++;
    else creatures++;
  });

  document.getElementById('deck-count').textContent = total;
  document.getElementById('creature-count').textContent = creatures;
  document.getElementById('objet-count').textContent = objets;
  document.getElementById('save-deck-btn').disabled = total !== 20;
}

function setFilter(type, value) {
  if (type === 'type') {
    filterType = value;
    document.querySelectorAll('.deck-filter-row:first-of-type .filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === value || (value === 'all' && b.dataset.filter === 'all'));
    });
  } else {
    filterRarity = value;
    document.querySelectorAll('.deck-filter-row:last-of-type .filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === value || (value === 'all' && b.dataset.filter === 'all-rarity'));
    });
  }
  renderCardGrid();
}

async function saveDeck() {
  if (selectedCards.length !== 20) return;

  const name = document.getElementById('deck-name').value.trim() || 'Deck';
  const method = currentDeckId ? 'PUT' : 'POST';
  const url = currentDeckId ? `/api/decks/${currentDeckId}` : '/api/decks';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, cardIds: selectedCards })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }

    closeEditor();
    await loadDecks();
  } catch {
    alert('Erreur reseau');
  }
}

async function deleteDeck() {
  if (!currentDeckId) return;
  if (!confirm('Supprimer ce deck ?')) return;

  try {
    const res = await fetch(`/api/decks/${currentDeckId}`, { method: 'DELETE' });
    if (!res.ok) { alert('Erreur'); return; }
    closeEditor();
    await loadDecks();
  } catch {
    alert('Erreur reseau');
  }
}

// Search listener
document.getElementById('deck-search').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderCardGrid();
});

// Init
async function init() {
  await loadMyCards();
  await loadDecks();
}
init();
