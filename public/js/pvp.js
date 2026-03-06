// pvp.js — PvP matchmaking + defense team

let myCards = [];
let editorTeam = [null, null, null];
let attackTeam = [null, null, null];
let currentOpponent = null;
let editorMode = 'defense';

async function loadCredits() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  const data = await res.json();
  document.getElementById('credits-count').textContent = data.credits;
}

async function loadMyCards() {
  const res = await fetch('/api/my-cards');
  if (!res.ok) return;
  myCards = await res.json();
}

async function loadDefenseTeam() {
  const res = await fetch('/api/pvp/team');
  if (!res.ok) return;
  const data = await res.json();

  const container = document.getElementById('defense-team');
  if (!data.team || data.team.length === 0) {
    container.innerHTML = '<p class="pvp-no-team">Aucune equipe definie</p>';
    return;
  }

  container.innerHTML = data.team.map(card => {
    const r = RARITY_COLORS[card.rarity];
    const elemIcon = ELEMENT_ICONS[card.element] || '?';
    const mult = card.is_fused ? 2 : 1;
    return `
      <div class="pvp-defense-card" style="border-color:${r.color}">
        <img src="/img/cards/${card.image}" alt="${card.name}" class="pvp-defense-img" onerror="this.style.display='none'">
        <div class="pvp-defense-name">${card.name}</div>
        <div style="color:${ELEMENT_COLORS[card.element]}">${elemIcon}</div>
        <div class="pvp-defense-stats">
          <span style="color:#ff4444">${card.attack * mult}</span>/
          <span style="color:#4488ff">${card.defense * mult}</span>/
          <span style="color:#44dd44">${card.hp * mult}</span>
        </div>
      </div>
    `;
  }).join('');
}

function showTeamEditor(mode) {
  editorMode = mode;
  editorTeam = [null, null, null];
  const overlay = document.getElementById('editor-overlay');
  overlay.classList.remove('hidden');
  renderEditorGrid();
  updateEditorSlots();
}

function closeEditor() {
  document.getElementById('editor-overlay').classList.add('hidden');
}

function renderEditorGrid() {
  const grid = document.getElementById('editor-grid');
  grid.innerHTML = myCards.map(card => {
    const r = RARITY_COLORS[card.rarity];
    const elemIcon = ELEMENT_ICONS[card.element] || '?';
    const mult = card.is_fused ? 2 : 1;
    return `
      <div class="team-card ${card.is_shiny ? 'team-card-shiny' : ''} ${card.is_fused ? 'team-card-fused' : ''}"
           data-uc-id="${card.user_card_id}"
           style="border-color:${r.color}"
           onclick="toggleEditorCard(${card.user_card_id})">
        <img src="/img/cards/${card.image}" alt="${card.name}" class="team-card-img" onerror="this.style.display='none'">
        <div class="team-card-name">${card.name}</div>
        <div class="team-card-elem" style="color:${ELEMENT_COLORS[card.element]}">${elemIcon}</div>
        <div class="team-card-stats">
          <span style="color:#ff4444">${card.attack * mult}</span>/
          <span style="color:#4488ff">${card.defense * mult}</span>/
          <span style="color:#44dd44">${card.hp * mult}</span>
        </div>
        ${card.is_shiny ? '<div class="team-badge-shiny">S</div>' : ''}
        ${card.is_fused ? '<div class="team-badge-fused">F+</div>' : ''}
      </div>
    `;
  }).join('');
}

function toggleEditorCard(ucId) {
  const idx = editorTeam.indexOf(ucId);
  if (idx >= 0) {
    editorTeam[idx] = null;
  } else {
    const emptySlot = editorTeam.indexOf(null);
    if (emptySlot >= 0) editorTeam[emptySlot] = ucId;
  }
  updateEditorSlots();
}

function updateEditorSlots() {
  for (let i = 0; i < 3; i++) {
    const slot = document.getElementById(`ed-slot-${i}`);
    if (editorTeam[i]) {
      const card = myCards.find(c => c.user_card_id === editorTeam[i]);
      if (card) { slot.textContent = card.name; slot.classList.add('slot-filled'); }
    } else {
      slot.textContent = `Slot ${i + 1}`;
      slot.classList.remove('slot-filled');
    }
  }

  document.querySelectorAll('#editor-grid .team-card').forEach(el => {
    const ucId = parseInt(el.dataset.ucId);
    el.classList.toggle('team-card-selected', editorTeam.includes(ucId));
  });
}

async function saveDefenseTeam() {
  if (editorTeam.some(s => s === null)) {
    alert('Selectionnez 3 cartes');
    return;
  }

  try {
    const res = await fetch('/api/pvp/set-team', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardIds: editorTeam })
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }

    closeEditor();
    loadDefenseTeam();
  } catch (err) {
    alert('Erreur reseau');
  }
}

async function findOpponent() {
  const btn = document.getElementById('find-btn');
  btn.disabled = true;
  btn.textContent = 'RECHERCHE...';

  try {
    const res = await fetch('/api/pvp/find-opponent', { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Aucun adversaire');
      btn.disabled = false;
      btn.textContent = 'RECHERCHER';
      return;
    }

    currentOpponent = data;
    attackTeam = [null, null, null];

    document.getElementById('opponent-section').classList.remove('hidden');
    document.getElementById('opponent-name').textContent = `Adversaire: ${data.opponentName}`;

    // Show opponent team
    const oppDiv = document.getElementById('opponent-team');
    oppDiv.innerHTML = data.opponentTeam.map(card => {
      const r = RARITY_COLORS[card.rarity];
      const elemIcon = ELEMENT_ICONS[card.element] || '?';
      const mult = card.is_fused ? 2 : 1;
      return `
        <div class="pvp-defense-card" style="border-color:${r.color}">
          <img src="/img/cards/${card.image}" alt="${card.name}" class="pvp-defense-img" onerror="this.style.display='none'">
          <div class="pvp-defense-name">${card.name}</div>
          <div style="color:${ELEMENT_COLORS[card.element]}">${elemIcon}</div>
          <div class="pvp-defense-stats">
            <span style="color:#ff4444">${card.attack * mult}</span>/
            <span style="color:#4488ff">${card.defense * mult}</span>/
            <span style="color:#44dd44">${card.hp * mult}</span>
          </div>
        </div>
      `;
    }).join('');

    renderAttackTeamGrid();
    updateAttackSlots();

  } catch (err) {
    alert('Erreur reseau');
  }

  btn.disabled = false;
  btn.textContent = 'RECHERCHER';
}

function renderAttackTeamGrid() {
  const grid = document.getElementById('attack-team-grid');
  grid.innerHTML = myCards.map(card => {
    const r = RARITY_COLORS[card.rarity];
    const elemIcon = ELEMENT_ICONS[card.element] || '?';
    const mult = card.is_fused ? 2 : 1;
    return `
      <div class="team-card ${card.is_shiny ? 'team-card-shiny' : ''} ${card.is_fused ? 'team-card-fused' : ''}"
           data-uc-id="${card.user_card_id}"
           style="border-color:${r.color}"
           onclick="toggleAttackCard(${card.user_card_id})">
        <img src="/img/cards/${card.image}" alt="${card.name}" class="team-card-img" onerror="this.style.display='none'">
        <div class="team-card-name">${card.name}</div>
        <div class="team-card-elem" style="color:${ELEMENT_COLORS[card.element]}">${elemIcon}</div>
        <div class="team-card-stats">
          <span style="color:#ff4444">${card.attack * mult}</span>/
          <span style="color:#4488ff">${card.defense * mult}</span>/
          <span style="color:#44dd44">${card.hp * mult}</span>
        </div>
        ${card.is_shiny ? '<div class="team-badge-shiny">S</div>' : ''}
        ${card.is_fused ? '<div class="team-badge-fused">F+</div>' : ''}
      </div>
    `;
  }).join('');
}

function toggleAttackCard(ucId) {
  const idx = attackTeam.indexOf(ucId);
  if (idx >= 0) { attackTeam[idx] = null; }
  else {
    const emptySlot = attackTeam.indexOf(null);
    if (emptySlot >= 0) attackTeam[emptySlot] = ucId;
  }
  updateAttackSlots();
}

function updateAttackSlots() {
  for (let i = 0; i < 3; i++) {
    const slot = document.getElementById(`atk-slot-${i}`);
    if (attackTeam[i]) {
      const card = myCards.find(c => c.user_card_id === attackTeam[i]);
      if (card) { slot.textContent = card.name; slot.classList.add('slot-filled'); }
    } else {
      slot.textContent = `Slot ${i + 1}`;
      slot.classList.remove('slot-filled');
    }
  }

  document.querySelectorAll('#attack-team-grid .team-card').forEach(el => {
    const ucId = parseInt(el.dataset.ucId);
    el.classList.toggle('team-card-selected', attackTeam.includes(ucId));
  });

  document.getElementById('pvp-attack-btn').disabled = attackTeam.some(s => s === null);
}

async function startPvpBattle() {
  if (!currentOpponent || attackTeam.some(s => s === null)) return;

  const btn = document.getElementById('pvp-attack-btn');
  btn.disabled = true;
  btn.textContent = 'CHARGEMENT...';

  try {
    const res = await fetch('/api/pvp/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        opponentUserId: currentOpponent.opponentUserId,
        team: attackTeam
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error);
      btn.disabled = false;
      btn.textContent = 'ATTAQUER';
      return;
    }

    sessionStorage.setItem('battleData', JSON.stringify(data));
    sessionStorage.setItem('battleType', 'pvp');
    window.location.href = '/battle';
  } catch (err) {
    alert('Erreur reseau');
    btn.disabled = false;
    btn.textContent = 'ATTAQUER';
  }
}

async function init() {
  await Promise.all([loadCredits(), loadMyCards()]);
  await loadDefenseTeam();
}

init();
