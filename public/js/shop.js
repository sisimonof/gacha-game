// shop.js — Booster opening with shiny support

const BOOSTER_IMAGES = { origines: '/img/booster-origines.png' };

let currentCredits = 0;

async function loadCredits() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  const data = await res.json();
  currentCredits = data.credits;
  document.getElementById('credits-count').textContent = data.credits;
}

async function loadBoosters() {
  const res = await fetch('/api/boosters');
  const boosters = await res.json();
  const shelf = document.getElementById('boosters-shelf');

  shelf.innerHTML = boosters.map(b => `
    <div class="booster-full" data-id="${b.id}" data-price="${b.price}" onclick="buyBooster('${b.id}', ${b.price})">
      <img src="${BOOSTER_IMAGES[b.id] || '/img/booster-origines.png'}" alt="${b.name}" class="booster-full-img" draggable="false">
      <div class="booster-price-tag">${b.price} CR</div>
    </div>
  `).join('');
}

async function buyBooster(id, price) {
  if (currentCredits < price) { screenShake(); return; }

  document.querySelectorAll('.booster-full').forEach(b => b.style.pointerEvents = 'none');

  try {
    const res = await fetch(`/api/boosters/${id}/open`, { method: 'POST' });
    const data = await res.json();

    if (!data.success) {
      alert(data.error);
      document.querySelectorAll('.booster-full').forEach(b => b.style.pointerEvents = '');
      return;
    }

    currentCredits = data.credits;
    document.getElementById('credits-count').textContent = data.credits;
    startTearAnimation(id, data.cards);
  } catch {
    alert('Erreur serveur');
    document.querySelectorAll('.booster-full').forEach(b => b.style.pointerEvents = '');
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

function showCardsReveal(cards) {
  const scene = document.getElementById('reveal-scene');
  const title = document.getElementById('reveal-title');
  const reveal = document.getElementById('cards-reveal');
  const doneBtn = document.getElementById('done-btn');

  scene.classList.remove('hidden');
  reveal.innerHTML = '';
  doneBtn.classList.add('hidden');
  title.textContent = 'OUVERTURE...';
  title.style.color = '#00ff41';

  const rarityOrder = { commune: 0, rare: 1, epique: 2, legendaire: 3 };
  const sorted = [...cards].sort((a, b) => {
    const rd = rarityOrder[a.rarity] - rarityOrder[b.rarity];
    if (rd !== 0) return rd;
    return (a.is_shiny || 0) - (b.is_shiny || 0);
  });

  sorted.forEach((card, idx) => {
    const r = RARITY_COLORS[card.rarity];
    const el = document.createElement('div');
    el.className = 'reveal-card waiting';

    const shinyClass = card.is_shiny ? 'reveal-card-shiny' : '';

    el.innerHTML = `
      <div class="card-inner ${shinyClass}">
        <div class="card-back">
          <div class="card-back-pattern"></div>
          <span>?</span>
        </div>
        <div class="card-front rarity-${card.rarity}" style="border-color:${r.color}; box-shadow:0 0 20px ${r.glow}">
          ${renderCardFront(card)}
        </div>
      </div>
    `;

    el.addEventListener('click', () => {
      if (el.classList.contains('revealed')) {
        showCardDetail(card);
      }
    });

    reveal.appendChild(el);
  });

  sorted.forEach((card, i) => {
    setTimeout(() => {
      const el = reveal.children[i];
      el.classList.remove('waiting');
      el.classList.add('card-slam');

      setTimeout(() => {
        el.classList.add('revealed');

        if (card.is_shiny) {
          el.classList.add('shiny-reveal');
          title.textContent = '✦ SHINY !';
          title.style.color = '#ff66ff';
          screenFlash();
          screenShake();
        } else if (card.rarity === 'legendaire') {
          el.classList.add('legendary-reveal');
          title.textContent = '★ LEGENDAIRE ★';
          title.style.color = RARITY_COLORS.legendaire.color;
          screenFlash();
          screenShake();
        } else if (card.rarity === 'epique') {
          el.classList.add('epic-reveal');
          title.textContent = '♦ EPIQUE ♦';
          title.style.color = RARITY_COLORS.epique.color;
        } else if (card.rarity === 'rare') {
          title.textContent = '◆ RARE ◆';
          title.style.color = RARITY_COLORS.rare.color;
        }

        initTiltEffect(reveal);
      }, 400);

      if (i === sorted.length - 1) {
        setTimeout(() => {
          doneBtn.classList.remove('hidden');
          title.textContent = 'BOOSTER OUVERT !';
          title.style.color = '#00ff41';
        }, 1200);
      }
    }, 600 + i * 900);
  });
}

document.getElementById('done-btn').addEventListener('click', () => {
  document.getElementById('opening-view').classList.add('hidden');
  document.getElementById('reveal-scene').classList.add('hidden');
  document.getElementById('tear-container').classList.add('hidden');
  document.getElementById('shop-view').classList.remove('hidden');
  document.querySelectorAll('.booster-full').forEach(b => b.style.pointerEvents = '');
});

loadCredits();
loadBoosters();
