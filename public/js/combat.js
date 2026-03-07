// combat.js — Combat hub: IA vs PVP mode selection

let myDecks = [];
let searchMode = null; // 'ia' or 'pvp'
let pvpSocket = null;
let searchTimer = null;
let searchStartTime = null;

async function init() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }

  const deckRes = await fetch('/api/decks');
  if (deckRes.ok) myDecks = await deckRes.json();
}

function showDeckSelect(mode) {
  searchMode = mode;
  const overlay = document.getElementById('deck-select-overlay');
  const list = document.getElementById('deck-select-list');

  if (myDecks.length === 0) {
    list.innerHTML = '<div class="deck-select-empty">Aucun deck — utilisez le deck starter ou creez un deck !</div>';
  } else {
    list.innerHTML = myDecks.map(deck => {
      const pvpBadge = deck.is_pvp_deck ? ' <span class="deck-pvp-tag">PVP</span>' : '';
      return `
        <button class="deck-select-item" onclick="startBattle(${deck.id})">
          <div class="deck-select-name">${deck.name}${pvpBadge}</div>
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

  if (searchMode === 'ia') {
    // Existing AI battle flow
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
  } else if (searchMode === 'pvp') {
    startPvpSearch(deckId);
  }
}

function startPvpSearch(deckId) {
  document.getElementById('pvp-searching').classList.remove('hidden');
  searchStartTime = Date.now();

  searchTimer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - searchStartTime) / 1000);
    const min = Math.floor(elapsed / 60);
    const sec = elapsed % 60;
    document.getElementById('pvp-timer').textContent = `${min}:${sec.toString().padStart(2, '0')}`;
  }, 1000);

  pvpSocket = io();

  pvpSocket.on('connect', () => {
    pvpSocket.emit('pvp:join-queue', { deckId });
  });

  pvpSocket.on('pvp:queued', () => {
    // Searching...
  });

  pvpSocket.on('pvp:battle-start', (data) => {
    clearInterval(searchTimer);
    sessionStorage.setItem('deckBattleData', JSON.stringify(data));
    sessionStorage.setItem('opponentName', data.opponentName || '???');
    sessionStorage.setItem('battleMode', 'pvp');
    window.location.href = '/battle';
  });

  pvpSocket.on('pvp:error', ({ message }) => {
    alert(message);
    cancelPvpSearch();
  });
}

function cancelPvpSearch() {
  if (searchTimer) { clearInterval(searchTimer); searchTimer = null; }
  if (pvpSocket) {
    pvpSocket.emit('pvp:leave-queue');
    pvpSocket.disconnect();
    pvpSocket = null;
  }
  document.getElementById('pvp-searching').classList.add('hidden');
}

function showLoading() { document.getElementById('combat-loading').classList.remove('hidden'); }
function hideLoading() { document.getElementById('combat-loading').classList.add('hidden'); }

init();
