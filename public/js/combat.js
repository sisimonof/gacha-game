// combat.js — Combat hub with deck selection + PvP launch

let myDecks = [];

async function init() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }

  // Preload decks
  const deckRes = await fetch('/api/decks');
  if (deckRes.ok) myDecks = await deckRes.json();
}

function showDeckSelect() {
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
  showLoading();

  try {
    const res = await fetch('/api/battle/start-deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deckId })
    });
    const data = await res.json();
    if (!res.ok) {
      hideLoading();
      alert(data.error);
      return;
    }

    // Store battle data and go to battle page
    sessionStorage.setItem('deckBattleData', JSON.stringify(data));
    sessionStorage.setItem('opponentName', data.opponentName || '???');
    window.location.href = '/battle';
  } catch {
    hideLoading();
    alert('Erreur reseau');
  }
}

async function startBattleStarter() {
  await startBattle('starter');
}

function showLoading() {
  document.getElementById('combat-loading').classList.remove('hidden');
}
function hideLoading() {
  document.getElementById('combat-loading').classList.add('hidden');
}

init();
