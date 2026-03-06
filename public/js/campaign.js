// campaign.js — Campaign map + team selection

let campaignData = null;
let myCards = [];
let selectedNode = null;
let selectedTeam = [null, null, null];

async function loadCredits() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  const data = await res.json();
  document.getElementById('credits-count').textContent = data.credits;
}

async function loadCampaign() {
  const res = await fetch('/api/campaign/progress');
  if (!res.ok) { window.location.href = '/'; return; }
  campaignData = await res.json();
  renderMap();
}

async function loadMyCards() {
  const res = await fetch('/api/my-cards');
  if (!res.ok) return;
  myCards = await res.json();
}

function renderMap() {
  const map = document.getElementById('campaign-map');
  map.innerHTML = '';

  campaignData.nodes.forEach((node, i) => {
    const nodeEl = document.createElement('div');
    let stateClass = 'node-locked';
    if (node.completed) stateClass = 'node-completed';
    else if (!node.locked) stateClass = 'node-available';

    nodeEl.className = `campaign-node ${stateClass}`;
    nodeEl.innerHTML = `
      <div class="campaign-node-marker">${i}</div>
      <div class="campaign-node-label">${node.name}</div>
    `;

    if (!node.locked) {
      nodeEl.addEventListener('click', () => selectNode(node));
    }

    // Connection line (except first)
    if (i > 0) {
      const line = document.createElement('div');
      line.className = `campaign-line ${node.locked ? '' : 'line-active'}`;
      map.appendChild(line);
    }

    map.appendChild(nodeEl);
  });
}

function selectNode(node) {
  selectedNode = node;
  selectedTeam = [null, null, null];

  const detail = document.getElementById('campaign-detail');
  detail.classList.remove('hidden');

  document.getElementById('node-name').textContent = node.name;

  const enemyDesc = node.enemies.map(e => `${e.count}x ${e.rarity}`).join(', ');
  document.getElementById('node-info').textContent = `Ennemis: ${enemyDesc}`;
  document.getElementById('node-reward').textContent = `Recompense: ${node.reward} CR`;

  renderTeamGrid();
  updateSlots();
  document.getElementById('fight-btn').disabled = true;
}

function renderTeamGrid() {
  const grid = document.getElementById('team-grid');
  grid.innerHTML = myCards.map(card => {
    const r = RARITY_COLORS[card.rarity];
    const elemIcon = ELEMENT_ICONS[card.element] || '?';
    const isFused = card.is_fused;
    const isShiny = card.is_shiny;
    const mult = isFused ? 2 : 1;

    return `
      <div class="team-card ${isShiny ? 'team-card-shiny' : ''} ${isFused ? 'team-card-fused' : ''}"
           data-uc-id="${card.user_card_id}"
           style="border-color:${r.color}"
           onclick="toggleTeamCard(${card.user_card_id})">
        <img src="/img/cards/${card.image}" alt="${card.name}" class="team-card-img" onerror="this.style.display='none'">
        <div class="team-card-name">${card.name}</div>
        <div class="team-card-elem" style="color:${ELEMENT_COLORS[card.element]}">${elemIcon}</div>
        <div class="team-card-stats">
          <span style="color:#ff4444">${card.attack * mult}</span>/
          <span style="color:#4488ff">${card.defense * mult}</span>/
          <span style="color:#44dd44">${card.hp * mult}</span>
        </div>
        ${isShiny ? '<div class="team-badge-shiny">S</div>' : ''}
        ${isFused ? '<div class="team-badge-fused">F+</div>' : ''}
      </div>
    `;
  }).join('');
}

function toggleTeamCard(ucId) {
  const idx = selectedTeam.indexOf(ucId);
  if (idx >= 0) {
    selectedTeam[idx] = null;
  } else {
    const emptySlot = selectedTeam.indexOf(null);
    if (emptySlot >= 0) {
      selectedTeam[emptySlot] = ucId;
    }
  }
  updateSlots();
}

function updateSlots() {
  for (let i = 0; i < 3; i++) {
    const slot = document.getElementById(`slot-${i}`);
    if (selectedTeam[i]) {
      const card = myCards.find(c => c.user_card_id === selectedTeam[i]);
      if (card) {
        slot.textContent = card.name;
        slot.classList.add('slot-filled');
      }
    } else {
      slot.textContent = `Slot ${i + 1}`;
      slot.classList.remove('slot-filled');
    }
  }

  // Highlight selected in grid
  document.querySelectorAll('.team-card').forEach(el => {
    const ucId = parseInt(el.dataset.ucId);
    el.classList.toggle('team-card-selected', selectedTeam.includes(ucId));
  });

  const allFilled = selectedTeam.every(s => s !== null);
  document.getElementById('fight-btn').disabled = !allFilled;
}

async function startCampaignBattle() {
  if (!selectedNode || selectedTeam.some(s => s === null)) return;

  const btn = document.getElementById('fight-btn');
  btn.disabled = true;
  btn.textContent = 'CHARGEMENT...';

  try {
    const res = await fetch('/api/campaign/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: selectedNode.id, team: selectedTeam })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error);
      btn.disabled = false;
      btn.textContent = 'COMBATTRE';
      return;
    }

    // Store battle data and redirect to battle page
    sessionStorage.setItem('battleData', JSON.stringify(data));
    sessionStorage.setItem('battleType', 'campaign');
    window.location.href = '/battle';
  } catch (err) {
    alert('Erreur reseau');
    btn.disabled = false;
    btn.textContent = 'COMBATTRE';
  }
}

async function init() {
  await Promise.all([loadCredits(), loadMyCards()]);
  await loadCampaign();
}

init();
