// shop.js — Booster opening with click-to-reveal system

const legendarySound = new Audio('/audio/legendary-hit.mp3');
const secretSound = new Audio('/audio/secret-reveal.mp3');

const BOOSTER_IMAGES = {
  origines: '/img/booster-origines.png',
  rift: '/img/booster-rift.jpg',
  avance: '/img/booster-avance.png'
};

let currentCredits = 0;
let cachedStreakRewards = null;

async function loadCredits() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  const data = await res.json();
  currentCredits = data.credits;
  document.getElementById('credits-count').textContent = data.credits;
  cachedStreakRewards = data.streakRewards;

  // Streak UI
  renderStreakProgress(data.loginStreak, data.streakRewards, data.canClaimDaily);
  if (!data.canClaimDaily) markDailyClaimed();
}

function renderStreakProgress(currentDay, rewards, canClaim) {
  const container = document.getElementById('streak-progress');
  const desc = document.getElementById('streak-desc');
  if (!container || !desc) return;
  desc.textContent = 'Jour ' + currentDay + ' / 7';

  container.innerHTML = (rewards || []).map(function(r, i) {
    const dayNum = i + 1;
    const claimed = dayNum <= currentDay;
    const isNext = canClaim && (dayNum === currentDay + 1 || (currentDay === 0 && dayNum === 1) || (currentDay >= 7 && dayNum === 1));
    const classes = ['streak-day'];
    if (claimed) classes.push('streak-claimed');
    if (isNext) classes.push('streak-next');
    return '<div class="' + classes.join(' ') + '">' +
      '<span class="streak-day-num">J' + dayNum + '</span>' +
      '<span class="streak-day-reward">' + r.credits + ' CR' + (r.card ? ' + 🃏' : '') + '</span>' +
    '</div>';
  }).join('');
}

function markDailyClaimed() {
  const btn = document.getElementById('daily-btn');
  if (btn) { btn.classList.add('daily-claimed'); btn.textContent = 'RECUPERE'; btn.disabled = true; }
}

async function claimDaily() {
  const btn = document.getElementById('daily-btn');
  if (btn && btn.disabled) return;

  try {
    const res = await fetch('/api/daily', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      currentCredits = data.credits;
      document.getElementById('credits-count').textContent = data.credits;
      renderStreakProgress(data.streakDay, cachedStreakRewards, false);
      markDailyClaimed();
      screenFlash();
      if (window.showToast) showToast('+' + data.amount + ' CR (Jour ' + data.streakDay + ')', 'success');
      if (data.cardGiven) {
        if (window.showToast) showToast('Carte bonus: ' + (data.cardGiven.emoji || '') + ' ' + data.cardGiven.name, 'achievement', 6000);
      }
    } else {
      markDailyClaimed();
    }
  } catch {}
}

// === BOUTIQUE DU JOUR ===
async function loadDailyShop() {
  try {
    const res = await fetch('/api/shop/daily-cards');
    const data = await res.json();
    const container = document.getElementById('daily-shop-cards');
    if (!container || !data.cards) return;

    container.innerHTML = data.cards.map(function(card) {
      const r = RARITY_COLORS[card.rarity] || RARITY_COLORS['rare'];
      return '<div class="daily-shop-card rarity-' + card.rarity + '" style="border-color:' + r.color + '">' +
        '<div class="daily-shop-card-visual">' + (card.emoji || '?') + '</div>' +
        '<div class="daily-shop-card-name">' + card.name + '</div>' +
        '<div class="daily-shop-card-rarity" style="color:' + r.color + '">' + card.rarity.toUpperCase() + '</div>' +
        '<div class="daily-shop-card-stats">' + card.attack + '/' + card.defense + '/' + card.hp + '</div>' +
        '<button class="daily-shop-buy-btn" onclick="buyDailyCard(' + card.id + ',' + card.shopPrice + ')">' + card.shopPrice + ' CR</button>' +
      '</div>';
    }).join('');

    if (data.resetIn > 0) startDailyShopTimer(data.resetIn);
  } catch(e) {}
}

async function buyDailyCard(cardId, price) {
  if (currentCredits < price) { screenShake(); return; }
  try {
    const res = await fetch('/api/shop/buy-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardId: cardId })
    });
    const data = await res.json();
    if (data.success) {
      currentCredits = data.credits;
      document.getElementById('credits-count').textContent = data.credits;
      screenFlash();
      if (window.showToast) showToast('Carte achetee: ' + (data.card.emoji || '') + ' ' + data.card.name, 'success');
    } else {
      if (window.showToast) showToast(data.error, 'error');
    }
  } catch { if (window.showToast) showToast('Erreur serveur', 'error'); }
}

function startDailyShopTimer(seconds) {
  let remaining = seconds;
  const timerEl = document.getElementById('daily-shop-timer');
  if (!timerEl) return;
  const interval = setInterval(function() {
    if (remaining <= 0) { clearInterval(interval); location.reload(); return; }
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60);
    const s = remaining % 60;
    timerEl.textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    remaining--;
  }, 1000);
}

const BOOSTER_BADGES = {
  rift: { label: '★ BEST SELLER', cls: 'badge-best' },
  avance: { label: 'PREMIUM', cls: 'badge-premium' }
};

const BOOSTER_CARD_COUNT = { origines: 5, rift: 7, avance: 8 };

async function loadBoosters() {
  const res = await fetch('/api/boosters');
  const boosters = await res.json();
  const shelf = document.getElementById('boosters-shelf');

  shelf.innerHTML = boosters.map(b => {
    const badge = BOOSTER_BADGES[b.id];
    const cardCount = BOOSTER_CARD_COUNT[b.id] || '?';
    return `
      <div class="booster-card" data-id="${b.id}" data-price="${b.price}" onclick="buyBooster('${b.id}', ${b.price})">
        ${badge ? `<div class="booster-badge ${badge.cls}">${badge.label}</div>` : ''}
        <div class="booster-img-wrap">
          <img src="${BOOSTER_IMAGES[b.id] || '/img/booster-origines.png'}" alt="${b.name}" class="booster-card-img" draggable="false">
        </div>
        <div class="booster-card-info">
          <span class="booster-card-name">${b.name}</span>
          <span class="booster-card-count">${cardCount} cartes</span>
        </div>
        <div class="booster-card-price">${b.price} CR</div>
      </div>
    `;
  }).join('');
}

async function buyBooster(id, price) {
  if (currentCredits < price) { screenShake(); return; }

  document.querySelectorAll('.booster-card').forEach(b => b.style.pointerEvents = 'none');

  try {
    const res = await fetch(`/api/boosters/${id}/open`, { method: 'POST' });
    const data = await res.json();

    if (!data.success) {
      alert(data.error);
      document.querySelectorAll('.booster-card').forEach(b => b.style.pointerEvents = '');
      return;
    }

    currentCredits = data.credits;
    document.getElementById('credits-count').textContent = data.credits;
    startTearAnimation(id, data.cards);
  } catch {
    alert('Erreur serveur');
    document.querySelectorAll('.booster-card').forEach(b => b.style.pointerEvents = '');
  }
}

function startTearAnimation(boosterId, cards) {
  const imgSrc = BOOSTER_IMAGES[boosterId] || '/img/booster-origines.png';

  document.getElementById('shop-view').classList.add('hidden');
  const openingView = document.getElementById('opening-view');
  openingView.classList.remove('hidden');

  const tearContainer = document.getElementById('tear-container');
  const tearLeft = document.getElementById('tear-left');
  const tearRight = document.getElementById('tear-right');

  tearLeft.style.backgroundImage = `url(${imgSrc})`;
  tearRight.style.backgroundImage = `url(${imgSrc})`;
  tearContainer.classList.remove('hidden');
  tearContainer.classList.add('shaking');

  setTimeout(() => {
    screenFlash();
    tearContainer.classList.remove('shaking');
    tearContainer.classList.add('tearing');

    setTimeout(() => {
      tearContainer.classList.add('hidden');
      tearContainer.classList.remove('tearing');
      showCardsReveal(cards);
    }, 800);
  }, 1200);
}

function screenFlash() {
  const flash = document.getElementById('screen-flash');
  flash.classList.remove('hidden');
  flash.classList.add('flash-active');
  setTimeout(() => { flash.classList.remove('flash-active'); flash.classList.add('hidden'); }, 400);
}

function screenShake() {
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 500);
}

// ==========================================
//  NOUVEAU SYSTEME DE REVEAL CLICK-TO-FLIP
// ==========================================

function showCardsReveal(cards) {
  const scene = document.getElementById('reveal-scene');
  const title = document.getElementById('reveal-title');
  const reveal = document.getElementById('cards-reveal');
  const doneBtn = document.getElementById('done-btn');
  const revealAllBtn = document.getElementById('reveal-all-btn');

  scene.classList.remove('hidden');
  reveal.innerHTML = '';
  doneBtn.classList.add('hidden');
  revealAllBtn.classList.add('hidden');
  title.textContent = 'OUVERTURE...';
  title.style.color = '#00ff41';

  let revealedCount = 0;
  const totalCards = cards.length;

  // Melange aleatoire pour le suspense
  const sorted = [...cards];
  for (let i = sorted.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  }

  // Creer toutes les cartes
  sorted.forEach((card, idx) => {
    const r = RARITY_COLORS[card.rarity] || RARITY_COLORS['epique'];
    const el = document.createElement('div');
    el.className = 'reveal-card waiting card-slam';
    el.dataset.index = idx;

    // Essence d'Excavation special card
    if (card._isEssence) {
      el.dataset.isEssence = '1';
      el.innerHTML = `
        <div class="card-inner">
          <div class="card-back">
            <div class="card-back-pattern"></div>
            <span>?</span>
          </div>
          <div class="card-front rarity-epique" style="border-color:#ffaa00; box-shadow:0 0 20px rgba(255,170,0,0.5)">
            <div class="card-rarity" style="background:#ffaa00">ESSENCE</div>
            <div class="card-emoji" style="font-size:64px; margin:20px 0;">⛏</div>
            <div class="card-name" style="color:#ffaa00">Essence d'Excavation</div>
            <div class="card-ability">
              <div class="ability-desc" style="color:#ffcc44">+1 Essence pour la Mine</div>
            </div>
          </div>
        </div>
      `;
    } else {
      const shinyClass = card.is_shiny ? 'reveal-card-shiny' : '';
      const tempClass = card.is_temp ? 'reveal-card-temp' : '';

      el.innerHTML = `
        <div class="card-inner ${shinyClass} ${tempClass}">
          <div class="card-back">
            <div class="card-back-pattern"></div>
            <span>?</span>
          </div>
          <div class="card-front rarity-${card.rarity}" style="border-color:${r.color}; box-shadow:0 0 20px ${r.glow}">
            ${renderCardFront(card)}
          </div>
        </div>
      `;
    }

    reveal.appendChild(el);
  });

  // === PHASE 1 : Toutes les cartes slam face cachee (stagger 100ms) ===
  sorted.forEach((card, i) => {
    setTimeout(() => {
      const el = reveal.children[i];
      el.classList.remove('waiting');
      el.classList.add('card-slam');

      // Apres le dernier slam, rendre les cartes cliquables
      if (i === sorted.length - 1) {
        setTimeout(() => {
          Array.from(reveal.children).forEach(c => c.classList.add('clickable'));
          title.textContent = 'CLIQUEZ POUR REVELER';
          revealAllBtn.classList.remove('hidden');
        }, 500);
      }
    }, i * 100);
  });

  // === PHASE 2 : Click pour reveler ===
  function revealCard(el, card) {
    if (el.classList.contains('revealed') || !el.classList.contains('clickable')) return;

    el.classList.remove('clickable');
    el.classList.remove('card-slam');
    el.classList.add('revealed');

    // Apres le flip (0.7s), appliquer les effets rarete
    setTimeout(() => {
      if (card.is_temp) {
        el.classList.add('temp-reveal');
        title.textContent = '⚠ TEMPORAIRE';
        title.style.color = '#ff3333';
      }
      if (card.is_shiny) {
        el.classList.add('shiny-reveal');
        title.textContent = '✦ SHINY !';
        title.style.color = '#ff66ff';
        screenFlash();
        screenShake();
      } else if (card.rarity === 'secret') {
        el.classList.add('secret-reveal');
        title.textContent = '🔒 SECRET 🔒';
        title.style.color = '#ffffff';
        secretSound.currentTime = 0; secretSound.play();
        screenFlash();
        screenShake();
        screenShake();
        screenShake();
      } else if (card.rarity === 'chaos') {
        el.classList.add('chaos-reveal');
        title.textContent = '☠ CHAOS ☠';
        title.style.color = RARITY_COLORS.chaos.color;
        secretSound.currentTime = 0; secretSound.play();
        screenFlash();
        screenShake();
        screenShake();
      } else if (card.rarity === 'legendaire') {
        el.classList.add('legendary-reveal');
        title.textContent = '★ LEGENDAIRE ★';
        title.style.color = RARITY_COLORS.legendaire.color;
        legendarySound.currentTime = 0; legendarySound.play();
        screenFlash();
        screenShake();
      } else if (card.rarity === 'epique') {
        el.classList.add('epic-reveal');
        title.textContent = '♦ EPIQUE ♦';
        title.style.color = RARITY_COLORS.epique.color;
      } else if (card.rarity === 'rare') {
        title.textContent = '◆ RARE ◆';
        title.style.color = RARITY_COLORS.rare.color;
      } else {
        title.textContent = '— COMMUNE —';
        title.style.color = '#888888';
      }

      initTiltEffect(reveal);
    }, 700);

    revealedCount++;

    // Toutes revelees ?
    if (revealedCount === totalCards) {
      setTimeout(() => {
        doneBtn.classList.remove('hidden');
        revealAllBtn.classList.add('hidden');
        title.textContent = 'BOOSTER OUVERT !';
        title.style.color = '#00ff41';
      }, 800);
    }
  }

  // Attacher les handlers de click
  sorted.forEach((card, idx) => {
    const el = reveal.children[idx];
    el.addEventListener('click', () => {
      if (el.classList.contains('revealed')) {
        showCardDetail(card);
        return;
      }
      revealCard(el, card);
    });
  });

  // Bouton "REVELER TOUT"
  revealAllBtn.onclick = () => {
    const unrevealed = Array.from(reveal.children).filter(c => !c.classList.contains('revealed'));
    unrevealed.forEach((el, i) => {
      const idx = parseInt(el.dataset.index);
      setTimeout(() => {
        revealCard(el, sorted[idx]);
      }, i * 300);
    });
  };
}

document.getElementById('done-btn').addEventListener('click', () => {
  document.getElementById('opening-view').classList.add('hidden');
  document.getElementById('reveal-scene').classList.add('hidden');
  document.getElementById('tear-container').classList.add('hidden');
  document.getElementById('shop-view').classList.remove('hidden');
  document.querySelectorAll('.booster-card').forEach(b => b.style.pointerEvents = '');
});

// ==========================================
//  CODE CADEAU
// ==========================================

async function redeemGiftCode() {
  const input = document.getElementById('giftcode-input');
  const btn = document.getElementById('giftcode-btn');
  const msg = document.getElementById('giftcode-msg');
  const code = input.value.trim().toUpperCase();

  if (!code) { showGiftMsg('Entre un code !', false); return; }

  btn.disabled = true;
  btn.textContent = '...';

  try {
    const res = await fetch('/api/redeem-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const data = await res.json();

    if (res.ok) {
      let rewardText = '';
      if (data.creditsGiven > 0) rewardText += `+${data.creditsGiven} CR`;
      if (data.cardsGiven > 0) {
        if (rewardText) rewardText += ' + ';
        rewardText += `${data.cardsGiven} carte(s)`;
      }
      showGiftMsg(`✓ ${rewardText}`, true);
      input.value = '';
      currentCredits = data.newCredits;
      document.getElementById('credits-count').textContent = data.newCredits;
      screenFlash();
    } else {
      showGiftMsg(data.error, false);
    }
  } catch {
    showGiftMsg('Erreur serveur', false);
  }

  btn.disabled = false;
  btn.textContent = 'UTILISER';
}

function showGiftMsg(text, success) {
  const msg = document.getElementById('giftcode-msg');
  msg.textContent = text;
  msg.className = 'shop-giftcode-msg ' + (success ? 'gift-success' : 'gift-error');
  setTimeout(() => msg.classList.add('hidden'), 4000);
}

// Enter key to submit gift code
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('giftcode-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') redeemGiftCode();
    });
  }
});

loadCredits();
loadBoosters();
loadDailyShop();
