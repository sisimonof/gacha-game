// blackjack.js — Blackjack Casino Game

let bjState = null; // current game state
let bjHistory = [];

const SUIT_COLORS = { '♥': '#ff4444', '♦': '#ff4444', '♠': '#fff', '♣': '#fff' };

function renderCard(card, hidden) {
  if (hidden || card.value === '?') {
    return `<div class="bj-card bj-card-hidden"><div class="bj-card-inner">?</div></div>`;
  }
  const color = SUIT_COLORS[card.suit] || '#fff';
  return `<div class="bj-card bj-card-deal" style="color:${color}">
    <div class="bj-card-corner">${card.value}${card.suit}</div>
    <div class="bj-card-center">${card.suit}</div>
    <div class="bj-card-corner bj-card-corner-bottom">${card.value}${card.suit}</div>
  </div>`;
}

function renderHand(hand) {
  return hand.map(c => renderCard(c)).join('');
}

function updateUI() {
  if (!bjState) return;

  document.getElementById('bj-dealer-cards').innerHTML = renderHand(bjState.dealerHand);
  document.getElementById('bj-player-cards').innerHTML = renderHand(bjState.playerHand);
  document.getElementById('bj-dealer-score').textContent = bjState.dealerScore;
  document.getElementById('bj-player-score').textContent = bjState.playerScore;
  document.getElementById('bj-current-bet').textContent = bjState.bet;

  // Update credits
  if (bjState.credits !== undefined) {
    document.getElementById('casino-credits').textContent = bjState.credits;
    document.getElementById('nav-credits').textContent = bjState.credits;
  }

  const controls = document.getElementById('bj-game-controls');
  const betControls = document.getElementById('bj-bet-controls');
  const resultEl = document.getElementById('bj-result');

  if (bjState.status === 'playing') {
    controls.classList.remove('hidden');
    betControls.classList.add('hidden');
    resultEl.classList.add('hidden');

    // Double only on first 2 cards
    const doubleBtn = document.getElementById('bj-double-btn');
    if (bjState.playerHand.length !== 2) {
      doubleBtn.disabled = true;
      doubleBtn.classList.add('bj-btn-disabled');
    } else {
      doubleBtn.disabled = false;
      doubleBtn.classList.remove('bj-btn-disabled');
    }
  } else if (bjState.status === 'finished') {
    controls.classList.add('hidden');
    betControls.classList.remove('hidden');
    resultEl.classList.remove('hidden');

    const resultLabel = document.getElementById('bj-result-label');
    const resultDetail = document.getElementById('bj-result-detail');

    resultEl.className = 'bj-result';

    switch (bjState.result) {
      case 'blackjack':
        resultLabel.textContent = '🃏 BLACKJACK !';
        resultDetail.textContent = `+${bjState.winnings} CR`;
        resultEl.classList.add('bj-result--blackjack');
        if (typeof screenFlash === 'function') screenFlash();
        if (typeof screenShake === 'function') screenShake();
        break;
      case 'win':
      case 'dealer_bust':
        resultLabel.textContent = bjState.result === 'dealer_bust' ? 'DEALER BUST !' : 'VICTOIRE !';
        resultDetail.textContent = `+${bjState.winnings} CR`;
        resultEl.classList.add('bj-result--win');
        break;
      case 'push':
        resultLabel.textContent = 'EGALITE';
        resultDetail.textContent = `Mise remboursee: ${bjState.winnings} CR`;
        resultEl.classList.add('bj-result--push');
        break;
      case 'bust':
        resultLabel.textContent = 'BUST !';
        resultDetail.textContent = `-${bjState.bet} CR`;
        resultEl.classList.add('bj-result--lose');
        break;
      case 'lose':
        resultLabel.textContent = 'PERDU';
        resultDetail.textContent = `-${bjState.bet} CR`;
        resultEl.classList.add('bj-result--lose');
        break;
      case 'dealer_blackjack':
        resultLabel.textContent = 'DEALER BLACKJACK';
        resultDetail.textContent = `-${bjState.bet} CR`;
        resultEl.classList.add('bj-result--lose');
        break;
    }

    // Add to history
    bjAddHistory(bjState);
  }
}

async function bjDeal() {
  const betInput = document.getElementById('bj-bet-input');
  const bet = parseInt(betInput.value);
  if (!bet || bet < 50 || bet > 1000) {
    if (typeof screenShake === 'function') screenShake();
    return;
  }

  try {
    const res = await fetch('/api/casino/blackjack/deal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bet })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error);
      return;
    }
    bjState = data;
    updateUI();
  } catch {
    alert('Erreur serveur');
  }
}

async function bjHit() {
  try {
    const res = await fetch('/api/casino/blackjack/hit', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    bjState = data;
    updateUI();
  } catch { alert('Erreur serveur'); }
}

async function bjStand() {
  try {
    const res = await fetch('/api/casino/blackjack/stand', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    bjState = data;
    updateUI();
  } catch { alert('Erreur serveur'); }
}

async function bjDouble() {
  try {
    const res = await fetch('/api/casino/blackjack/double', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { alert(data.error); return; }
    bjState = data;
    updateUI();
  } catch { alert('Erreur serveur'); }
}

function bjAddHistory(state) {
  bjHistory.unshift(state);
  if (bjHistory.length > 10) bjHistory.pop();

  const list = document.getElementById('bj-history-list');
  if (!list) return;
  list.innerHTML = bjHistory.map(h => {
    let cls = 'casino-hist-item';
    let text = '';
    switch (h.result) {
      case 'blackjack':
        cls += ' hist-jackpot';
        text = `🃏 BLACKJACK +${h.winnings} CR`;
        break;
      case 'win':
      case 'dealer_bust':
        cls += ' hist-win';
        text = `VICTOIRE +${h.winnings} CR`;
        break;
      case 'push':
        cls += ' hist-xp';
        text = `EGALITE (${h.winnings} CR)`;
        break;
      case 'bust':
      case 'lose':
      case 'dealer_blackjack':
        cls += ' hist-lose';
        text = `PERDU -${h.bet} CR`;
        break;
    }
    return `<div class="${cls}">${text}</div>`;
  }).join('');
}

// Quick bet buttons
function bjSetBet(amount) {
  document.getElementById('bj-bet-input').value = amount;
}
