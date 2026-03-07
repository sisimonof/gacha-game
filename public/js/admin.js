// admin.js — Admin panel logic

let allCards = [];

async function checkAdmin() {
  const res = await fetch('/api/admin/check');
  if (!res.ok) { window.location.href = '/'; return; }
  const data = await res.json();
  if (!data.isAdmin) { window.location.href = '/menu'; return; }
  loadAll();
}

async function loadAll() {
  await Promise.all([loadStats(), loadUsers(), loadCards(), loadBoostersConfig()]);
}

// === STATS ===
async function loadStats() {
  const res = await fetch('/api/admin/stats');
  const data = await res.json();
  document.getElementById('admin-stats').innerHTML = `
    <div class="stat-box"><span class="stat-num">${data.totalUsers}</span><span class="stat-label">Joueurs</span></div>
    <div class="stat-box"><span class="stat-num">${data.totalCardTypes}</span><span class="stat-label">Types de cartes</span></div>
    <div class="stat-box"><span class="stat-num">${data.totalCards}</span><span class="stat-label">Cartes en jeu</span></div>
    <div class="stat-box"><span class="stat-num">${data.totalBattles}</span><span class="stat-label">Combats joues</span></div>
    <div class="stat-box"><span class="stat-num">${data.totalPvpTeams}</span><span class="stat-label">Equipes PvP</span></div>
  `;
}

// === USERS ===
async function loadUsers() {
  const res = await fetch('/api/admin/users');
  const users = await res.json();
  const tbody = document.getElementById('users-body');
  tbody.innerHTML = users.map(u => `
    <tr>
      <td>${u.id}</td>
      <td>${u.username} ${u.is_admin ? '<span class="admin-badge">ADMIN</span>' : ''}</td>
      <td>${u.credits}</td>
      <td>${u.card_count}</td>
      <td>${u.is_admin ? 'Oui' : 'Non'}</td>
      <td>
        <button class="admin-action-btn" onclick="resetUser(${u.id}, '${u.username}')">Reset</button>
      </td>
    </tr>
  `).join('');
}

// === BOOSTERS CONFIG ===
async function loadBoostersConfig() {
  const res = await fetch('/api/admin/boosters');
  const boosters = await res.json();
  const container = document.getElementById('boosters-config');

  container.innerHTML = boosters.map(b => {
    const total = Object.values(b.weights).reduce((a, v) => a + v, 0);
    return `
    <div class="admin-booster-box" data-booster="${b.id}">
      <div class="admin-booster-header">
        <span class="admin-booster-name">${b.name}</span>
        <span class="admin-booster-info">${b.cardsPerPack} cartes</span>
      </div>
      <div class="admin-booster-fields">
        <div class="admin-booster-row">
          <label>Prix:</label>
          <input type="number" class="admin-input-sm" id="booster-${b.id}-price" value="${b.price}" min="0">
          <label>CR</label>
        </div>
        <div class="admin-booster-row">
          <label style="color:#888">Commune:</label>
          <input type="number" class="admin-input-sm" id="booster-${b.id}-commune" value="${b.weights.commune}" min="0">
          <span class="admin-pct">${(b.weights.commune/total*100).toFixed(1)}%</span>
        </div>
        <div class="admin-booster-row">
          <label style="color:#4488ff">Rare:</label>
          <input type="number" class="admin-input-sm" id="booster-${b.id}-rare" value="${b.weights.rare}" min="0">
          <span class="admin-pct">${(b.weights.rare/total*100).toFixed(1)}%</span>
        </div>
        <div class="admin-booster-row">
          <label style="color:#cc44ff">Epique:</label>
          <input type="number" class="admin-input-sm" id="booster-${b.id}-epique" value="${b.weights.epique}" min="0">
          <span class="admin-pct">${(b.weights.epique/total*100).toFixed(1)}%</span>
        </div>
        <div class="admin-booster-row">
          <label style="color:#ffaa00">Legend.:</label>
          <input type="number" class="admin-input-sm" id="booster-${b.id}-legendaire" value="${b.weights.legendaire}" min="0">
          <span class="admin-pct">${(b.weights.legendaire/total*100).toFixed(1)}%</span>
        </div>
        <div class="admin-booster-row">
          <label style="color:#ff66ff">Shiny %:</label>
          <input type="number" class="admin-input-sm" id="booster-${b.id}-shiny" value="${(b.shinyRate * 100).toFixed(1)}" min="0" max="100" step="0.1">
          <span class="admin-pct">%</span>
        </div>
      </div>
      <button class="submit-btn admin-small-btn" onclick="saveBooster('${b.id}')">SAUVEGARDER</button>
    </div>`;
  }).join('');
}

async function saveBooster(boosterId) {
  const get = (field) => parseFloat(document.getElementById(`booster-${boosterId}-${field}`).value) || 0;
  const body = {
    boosterId,
    price: get('price'),
    weights: {
      commune: get('commune'),
      rare: get('rare'),
      epique: get('epique'),
      legendaire: get('legendaire')
    },
    shinyRate: get('shiny') / 100
  };

  const res = await fetch('/api/admin/update-booster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.ok) {
    showFeedback(`Booster "${data.booster.name}" mis a jour`);
    loadBoostersConfig();
  } else {
    showFeedback(data.error, true);
  }
}

// === CARDS ===
async function loadCards() {
  const res = await fetch('/api/admin/cards');
  allCards = await res.json();
  renderCardsTable();
}

function renderCardsTable() {
  const tbody = document.getElementById('cards-body');
  const elemIcons = { feu: '🔥', eau: '💧', terre: '🌿', lumiere: '✨', ombre: '🌑' };
  tbody.innerHTML = allCards.map(c => `
    <tr id="card-row-${c.id}">
      <td class="admin-emoji-cell">${c.emoji || '?'}</td>
      <td style="color:${RARITY_COLORS[c.rarity]?.color || '#fff'}">${c.name}</td>
      <td>${c.rarity}</td>
      <td>${elemIcons[c.element] || '?'} ${c.element}</td>
      <td style="color:#ff4444">${c.attack}</td>
      <td style="color:#4488ff">${c.defense}</td>
      <td style="color:#44dd44">${c.hp}</td>
      <td>${c.mana_cost}</td>
      <td>${c.crystal_cost || 1}</td>
      <td class="admin-passive-cell">${c.passive_desc || '-'}</td>
      <td>
        <button class="admin-action-btn" onclick="editCard(${c.id})">Editer</button>
        <button class="admin-action-btn" onclick="deleteCard(${c.id}, '${c.name.replace(/'/g, "\\'")}')">Suppr</button>
      </td>
    </tr>
    <tr class="admin-edit-row hidden" id="edit-row-${c.id}">
      <td colspan="11">
        <div class="admin-edit-form">
          <div class="admin-edit-group">
            <label>Emoji:</label>
            <input type="text" class="admin-input-emoji" id="edit-${c.id}-emoji" value="${c.emoji || ''}">
          </div>
          <div class="admin-edit-group">
            <label>ATK:</label>
            <input type="number" class="admin-input-sm" id="edit-${c.id}-atk" value="${c.attack}">
            <label>DEF:</label>
            <input type="number" class="admin-input-sm" id="edit-${c.id}-def" value="${c.defense}">
            <label>PV:</label>
            <input type="number" class="admin-input-sm" id="edit-${c.id}-hp" value="${c.hp}">
          </div>
          <div class="admin-edit-group">
            <label>Mana:</label>
            <input type="number" class="admin-input-sm" id="edit-${c.id}-mana" value="${c.mana_cost}">
            <label>Crystal:</label>
            <input type="number" class="admin-input-sm" id="edit-${c.id}-crystal" value="${c.crystal_cost || 1}" step="0.5">
          </div>
          <div class="admin-edit-group admin-edit-wide">
            <label>Passif:</label>
            <input type="text" class="admin-input-text" id="edit-${c.id}-passive" value="${(c.passive_desc || '').replace(/"/g, '&quot;')}">
          </div>
          <div class="admin-edit-actions">
            <button class="submit-btn admin-small-btn" onclick="saveCard(${c.id})">SAUVEGARDER</button>
            <button class="admin-action-btn" onclick="cancelEdit(${c.id})">Annuler</button>
          </div>
        </div>
      </td>
    </tr>
  `).join('');
}

function editCard(cardId) {
  // Close any other open edit rows
  document.querySelectorAll('.admin-edit-row').forEach(r => r.classList.add('hidden'));
  document.getElementById(`edit-row-${cardId}`).classList.remove('hidden');
}

function cancelEdit(cardId) {
  document.getElementById(`edit-row-${cardId}`).classList.add('hidden');
}

async function saveCard(cardId) {
  const get = (field) => document.getElementById(`edit-${cardId}-${field}`).value;
  const body = {
    cardId,
    emoji: get('emoji'),
    attack: parseInt(get('atk')),
    defense: parseInt(get('def')),
    hp: parseInt(get('hp')),
    mana_cost: parseInt(get('mana')),
    crystal_cost: parseFloat(get('crystal')),
    passive_desc: get('passive')
  };

  const res = await fetch('/api/admin/modify-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.ok) {
    showFeedback(`Carte "${data.card.name}" mise a jour`);
    loadCards();
  } else {
    showFeedback(data.error, true);
  }
}

// === TABS ===
function showTab(tabName) {
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.remove('hidden');
  event.target.classList.add('active');
}

// === ACTIONS ===
function showFeedback(msg, isError) {
  const el = document.getElementById('admin-feedback');
  el.textContent = msg;
  el.className = `admin-feedback ${isError ? 'feedback-error' : 'feedback-success'}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

async function giveCredits() {
  const userId = document.getElementById('give-credits-user').value;
  const amount = document.getElementById('give-credits-amount').value;
  if (!userId || !amount) { showFeedback('Remplissez tous les champs', true); return; }

  const res = await fetch('/api/admin/give-credits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: parseInt(userId), amount: parseInt(amount) })
  });
  const data = await res.json();
  if (res.ok) {
    showFeedback(`+${amount} CR donnes a ${data.username} (total: ${data.newCredits})`);
    loadUsers();
  } else {
    showFeedback(data.error, true);
  }
}

async function giveCard() {
  const userId = document.getElementById('give-card-user').value;
  const cardId = document.getElementById('give-card-id').value;
  const isShiny = document.getElementById('give-card-shiny').checked;
  const isFused = document.getElementById('give-card-fused').checked;
  if (!userId || !cardId) { showFeedback('Remplissez tous les champs', true); return; }

  const res = await fetch('/api/admin/give-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: parseInt(userId), cardId: parseInt(cardId), isShiny, isFused })
  });
  const data = await res.json();
  if (res.ok) {
    showFeedback(`Carte "${data.card}" donnee a ${data.username}${isShiny ? ' (SHINY)' : ''}${isFused ? ' (FUSED)' : ''}`);
    loadUsers();
  } else {
    showFeedback(data.error, true);
  }
}

async function setCredits() {
  const userId = document.getElementById('set-credits-user').value;
  const credits = document.getElementById('set-credits-amount').value;
  if (!userId || credits === '') { showFeedback('Remplissez tous les champs', true); return; }

  const res = await fetch('/api/admin/set-credits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: parseInt(userId), credits: parseInt(credits) })
  });
  const data = await res.json();
  if (res.ok) {
    showFeedback(`Credits du joueur #${userId} definis a ${credits}`);
    loadUsers();
  } else {
    showFeedback(data.error, true);
  }
}

async function createCard() {
  const body = {
    name: document.getElementById('new-card-name').value,
    rarity: document.getElementById('new-card-rarity').value,
    type: document.getElementById('new-card-type').value,
    element: document.getElementById('new-card-element').value,
    attack: parseInt(document.getElementById('new-card-atk').value),
    defense: parseInt(document.getElementById('new-card-def').value),
    hp: parseInt(document.getElementById('new-card-hp').value),
    mana_cost: parseInt(document.getElementById('new-card-mana').value),
    ability_name: document.getElementById('new-card-ability').value || 'Aucun',
    ability_desc: document.getElementById('new-card-ability-desc').value || '-',
    image: document.getElementById('new-card-image').value || '',
  };

  if (!body.name) { showFeedback('Nom requis', true); return; }

  const res = await fetch('/api/admin/create-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (res.ok) {
    showFeedback(`Carte "${data.card.name}" creee (ID: ${data.card.id})`);
    loadCards();
    loadStats();
  } else {
    showFeedback(data.error, true);
  }
}

async function deleteCard(cardId, name) {
  if (!confirm(`Supprimer la carte "${name}" et toutes ses copies chez les joueurs ?`)) return;

  const res = await fetch('/api/admin/delete-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cardId })
  });
  const data = await res.json();
  if (res.ok) {
    showFeedback(`Carte "${data.deletedCard}" supprimee`);
    loadCards();
    loadStats();
  } else {
    showFeedback(data.error, true);
  }
}

async function resetUser(userId, username) {
  if (!confirm(`Reinitialiser le joueur "${username}" ? (cartes, credits, progression)`)) return;

  const res = await fetch('/api/admin/reset-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  const data = await res.json();
  if (res.ok) {
    showFeedback(`Joueur "${data.username}" reinitialise`);
    loadUsers();
  } else {
    showFeedback(data.error, true);
  }
}

checkAdmin();
