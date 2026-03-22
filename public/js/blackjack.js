// blackjack.js — Blackjack Casino Game

let bjState = null; // current game state
let bjHistory = [];

const SUIT_COLORS = { '♥': '#ff4444', '♦': '#ff4444', '♠': '#222', '♣': '#222' };

function renderCard(card) {
  if (card.value === '?') {
    return `<div class="bj-card bj-card-hidden"><div class="bj-card-inner">?</div></div>`;
  }
  const color = SUIT_COLORS[card.suit] || '#222';
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

  // Update credits
  if (bjState.credits !== undefined) {
    document.getElementById('casino-credits').textContent = bjState.credits;
    document.getElementById('nav-credits').textContent = bjState.credits;
  }

  const controls = document.getElementById('bj-game-controls');
  const betControls = document.getElementById('bj-bet-controls');
  const resultEl = document.getElementById('bj-result');
  const splitSection = document.getElementById('bj-split-section');

  // Check if we have split hands
  const hasSplit = bjState.splitHand && bjState.splitHand.length > 0;

  if (hasSplit) {
    splitSection.classList.remove('hidden');
    document.getElementById('bj-split-cards').innerHTML = renderHand(bjState.splitHand);
    document.getElementById('bj-split-score').textContent = bjState.splitScore || 0;

    // Highlight active hand
    const mainSection = document.querySelector('.bj-section-player');
    if (bjState.activeHand === 'main') {
      mainSection.classList.add('bj-hand-active');
      splitSection.classList.remove('bj-hand-active');
    } else if (bjState.activeHand === 'split') {
      mainSection.classList.remove('bj-hand-active');
      splitSection.classList.add('bj-hand-active');
    } else {
      mainSection.classList.remove('bj-hand-active');
      splitSection.classList.remove('bj-hand-active');
    }
  } else {
    splitSection.classList.add('hidden');
    document.querySelector('.bj-section-player').classList.remove('bj-hand-active');
  }

  document.getElementById('bj-dealer-cards').innerHTML = renderHand(bjState.dealerHand);
  document.getElementById('bj-player-cards').innerHTML = renderHand(bjState.playerHand);
  document.getElementById('bj-dealer-score').textContent = bjState.dealerScore;
  document.getElementById('bj-player-score').textContent = bjState.playerScore;
  document.getElementById('bj-current-bet').textContent = bjState.bet;

  if (bjState.status === 'playing') {
    controls.classList.remove('hidden');
    betControls.classList.add('hidden');
    resultEl.classList.add('hidden');

    // Double only on first 2 cards of active hand
    const doubleBtn = document.getElementById('bj-double-btn');
    const activeHandLen = bjState.activeHand === 'split' ? (bjState.splitHand || []).length : bjState.playerHand.length;
    if (activeHandLen !== 2) {
      doubleBtn.disabled = true;
      doubleBtn.classList.add('bj-btn-disabled');
    } else {
      doubleBtn.disabled = false;
      doubleBtn.classList.remove('bj-btn-disabled');
    }

    // Split only on first 2 cards with same value, no existing split
    const splitBtn = document.getElementById('bj-split-btn');
    if (bjState.canSplit) {
      splitBtn.disabled = false;
      splitBtn.classList.remove('bj-btn-disabled');
      splitBtn.classList.remove('hidden');
    } else {
      splitBtn.disabled = true;
      splitBtn.classList.add('bj-btn-disabled');
      splitBtn.classList.add('hidden');
    }
  } else if (bjState.status === 'finished') {
    controls.classList.add('hidden');
    betControls.classList.remove('hidden');
    resultEl.classList.remove('hidden');

    const resultLabel = document.getElementById('bj-result-label');
    const resultDetail = document.getElementById('bj-result-detail');

    resultEl.className = 'bj-result';

    // Build result text
    let label = '';
    let detail = '';
    let resultClass = '';

    if (hasSplit && bjState.splitResult) {
      // Show both results
      const mainRes = formatResult(bjState.result, bjState.winnings, bjState.bet);
      const splitRes = formatResult(bjState.splitResult, bjState.splitWinnings || 0, bjState.splitBet || bjState.bet);
      const totalWin = (bjState.winnings || 0) + (bjState.splitWinnings || 0);
      const totalBet = bjState.bet + (bjState.splitBet || bjState.bet);

      label = `Main: ${mainRes.label} | Split: ${splitRes.label}`;
      const net = totalWin - totalBet;
      detail = net >= 0 ? `Net: +${net} CR` : `Net: ${net} CR`;
      resultClass = net > 0 ? 'bj-result--win' : net === 0 ? 'bj-result--push' : 'bj-result--lose';
    } else {
      const res = formatResult(bjState.result, bjState.winnings, bjState.bet);
      label = res.label;
      detail = res.detail;
      resultClass = res.cls;
    }

    resultLabel.textContent = label;
    resultDetail.textContent = detail;
    resultEl.classList.add(resultClass);

    if (bjState.result === 'blackjack') {
      if (typeof screenFlash === 'function') screenFlash();
      if (typeof screenShake === 'function') screenShake();
    }

    bjAddHistory(bjState);
  }
}

function formatResult(result, winnings, bet) {
  switch (result) {
    case 'blackjack':
      return { label: '🃏 BLACKJACK !', detail: `+${winnings} CR`, cls: 'bj-result--blackjack' };
    case 'win':
    case 'dealer_bust':
      return { label: result === 'dealer_bust' ? 'DEALER BUST !' : 'VICTOIRE !', detail: `+${winnings} CR`, cls: 'bj-result--win' };
    case 'push':
      return { label: 'EGALITE', detail: `Mise remboursee: ${winnings} CR`, cls: 'bj-result--push' };
    case 'bust':
      return { label: 'BUST !', detail: `-${bet} CR`, cls: 'bj-result--lose' };
    case 'lose':
      return { label: 'PERDU', detail: `-${bet} CR`, cls: 'bj-result--lose' };
    case 'dealer_blackjack':
      return { label: 'DEALER BLACKJACK', detail: `-${bet} CR`, cls: 'bj-result--lose' };
    default:
      return { label: result || '?', detail: '', cls: 'bj-result--lose' };
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

async function bjSplit() {
  try {
    const res = await fetch('/api/casino/blackjack/split', { method: 'POST' });
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
    const totalWin = (h.winnings || 0) + (h.splitWinnings || 0);
    const totalBet = (h.bet || 0) + (h.splitBet || 0);

    if (h.result === 'blackjack') {
      cls += ' hist-jackpot';
      text = `🃏 BLACKJACK +${totalWin} CR`;
    } else if (['win', 'dealer_bust'].includes(h.result) && totalWin > totalBet) {
      cls += ' hist-win';
      text = `VICTOIRE +${totalWin - totalBet} CR`;
    } else if (h.result === 'push' || totalWin === totalBet) {
      cls += ' hist-xp';
      text = `EGALITE (${totalWin} CR)`;
    } else {
      cls += ' hist-lose';
      text = `PERDU -${totalBet - totalWin} CR`;
    }
    return `<div class="${cls}">${text}</div>`;
  }).join('');
}

// Quick bet buttons
function bjSetBet(amount) {
  document.getElementById('bj-bet-input').value = amount;
}
