// admin.js — Admin panel logic

async function checkAdmin() {
  const res = await fetch('/api/admin/check');
  if (!res.ok) { window.location.href = '/'; return; }
  const data = await res.json();
  if (!data.isAdmin) { window.location.href = '/menu'; return; }
  loadAll();
}

async function loadAll() {
  await Promise.all([loadStats(), loadUsers(), loadCards()]);
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

// === CARDS ===
async function loadCards() {
  const res = await fetch('/api/admin/cards');
  const cards = await res.json();
  const tbody = document.getElementById('cards-body');
  const elemIcons = { feu: '🔥', eau: '💧', terre: '🌿', lumiere: '✨', ombre: '🌑' };
  tbody.innerHTML = cards.map(c => `
    <tr>
      <td>${c.id}</td>
      <td style="color:${RARITY_COLORS[c.rarity]?.color || '#fff'}">${c.name}</td>
      <td>${c.rarity}</td>
      <td>${c.type}</td>
      <td>${elemIcons[c.element] || '?'} ${c.element}</td>
      <td style="color:#ff4444">${c.attack}</td>
      <td style="color:#4488ff">${c.defense}</td>
      <td style="color:#44dd44">${c.hp}</td>
      <td>${c.ability_name}</td>
      <td>
        <button class="admin-action-btn" onclick="deleteCard(${c.id}, '${c.name}')">Suppr</button>
      </td>
    </tr>
  `).join('');
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
