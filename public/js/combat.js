// combat.js — Combat hub: IA mode

let myDecks = [];

async function init() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }

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

function showLoading() { document.getElementById('combat-loading').classList.remove('hidden'); }
function hideLoading() { document.getElementById('combat-loading').classList.add('hidden'); }

init();
