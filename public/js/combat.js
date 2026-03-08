// combat.js — Combat hub: IA + PvP mode

let myDecks = [];
let combatMode = 'ia'; // 'ia' ou 'pvp'
let pvpSocket = null;

async function init() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }

  const deckRes = await fetch('/api/decks');
  if (deckRes.ok) myDecks = await deckRes.json();
}

function showDeckSelect(mode) {
  combatMode = mode || 'ia';
  const overlay = document.getElementById('deck-select-overlay');
  const list = document.getElementById('deck-select-list');
  const title = document.querySelector('.deck-select-title');
  if (title) title.textContent = combatMode === 'pvp' ? 'CHOISIR UN DECK (PVP)' : 'CHOISIR UN DECK';

  if (myDecks.length === 0) {
    list.innerHTML = '<div class="deck-select-empty">Aucun deck — utilisez le deck starter ou creez un deck !</div>';
  } else {
    list.innerHTML = myDecks.map(deck => {
      return `
        <button class="deck-select-item" onclick="startBattle(${deck.id})">
          <div class="deck-select-name">${deck.name}</div>
          <div class="deck-select-info">${deck.cards.length}/20 cartes</div>
          <div class="deck-select-preview">
            ${deck.cards.slice(0, 10).map(c => `<span title="${c.name}">${c.emoji || '?'}</span>`).join('')}
            ${deck.cards.length > 10 ? '...' : ''}
          </div>
        </button>
      `;
    }).join('');
  }

  overlay.classList.remove('hidden');
}

function hideDeckSelect() {
  document.getElementById('deck-select-overlay').classList.add('hidden');
}

async function startBattle(deckId) {
  hideDeckSelect();

  if (combatMode === 'pvp') {
    startPvpMatchmaking(deckId);
    return;
  }

  // Mode IA classique
  showLoading();
  try {
    const res = await fetch('/api/battle/start-deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deckId })
    });
    const data = await res.json();
    if (!res.ok) { hideLoading(); alert(data.error); return; }

    sessionStorage.setItem('deckBattleData', JSON.stringify(data));
    sessionStorage.setItem('opponentName', data.opponentName || '???');
    sessionStorage.setItem('battleMode', 'ia');
    window.location.href = '/battle';
  } catch {
    hideLoading();
    alert('Erreur reseau');
  }
}

// --- PvP Matchmaking ---
function startPvpMatchmaking(deckId) {
  const loadingEl = document.getElementById('combat-loading');
  const loadingText = loadingEl.querySelector('.loading-text');
  loadingEl.classList.remove('hidden');
  loadingText.textContent = 'Recherche d\'un adversaire...';

  // Ajouter bouton annuler
  let cancelBtn = document.getElementById('pvp-cancel-btn');
  if (!cancelBtn) {
    cancelBtn = document.createElement('button');
    cancelBtn.id = 'pvp-cancel-btn';
    cancelBtn.className = 'deck-select-cancel';
    cancelBtn.style.marginTop = '16px';
    cancelBtn.textContent = 'ANNULER';
    cancelBtn.onclick = cancelPvpQueue;
    loadingEl.appendChild(cancelBtn);
  }
  cancelBtn.style.display = 'block';

  // Connecter socket.io
  if (!pvpSocket) {
    pvpSocket = io();
  }

  pvpSocket.emit('pvp:queue', { deckId });

  pvpSocket.off('pvp:waiting');
  pvpSocket.off('pvp:matched');
  pvpSocket.off('pvp:error');

  pvpSocket.on('pvp:waiting', (data) => {
    loadingText.textContent = 'Recherche d\'un adversaire...';
  });

  pvpSocket.on('pvp:matched', (data) => {
    loadingText.textContent = 'Adversaire trouve ! ' + data.opponentName;
    sessionStorage.setItem('pvpBattleData', JSON.stringify(data));
    sessionStorage.setItem('opponentName', data.opponentName);
    sessionStorage.setItem('battleMode', 'pvp');
    setTimeout(() => {
      window.location.href = '/pvp-battle';
    }, 800);
  });

  pvpSocket.on('pvp:error', (data) => {
    hideLoading();
    alert(data.error);
  });
}

function cancelPvpQueue() {
  if (pvpSocket) pvpSocket.emit('pvp:cancel');
  hideLoading();
  const cancelBtn = document.getElementById('pvp-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function showLoading() { document.getElementById('combat-loading').classList.remove('hidden'); }
function hideLoading() { document.getElementById('combat-loading').classList.add('hidden'); }

init();
