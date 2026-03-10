// fusion.js — Fusion system with spinning wheel

let selectedCardId = null;
let selectedCard = null;
let fusionResult = null;

async function loadCredits() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  const data = await res.json();
  document.getElementById('credits-count').textContent = data.credits;
}

async function loadFusionCards() {
  const res = await fetch('/api/fusion/available');
  if (!res.ok) { window.location.href = '/'; return; }
  const cards = await res.json();

  const grid = document.getElementById('fusion-grid');
  const emptyMsg = document.getElementById('empty-msg');

  if (cards.length === 0) {
    grid.innerHTML = '';
    emptyMsg.classList.remove('hidden');
    return;
  }

  emptyMsg.classList.add('hidden');
  grid.innerHTML = cards.map(card => {
    const r = RARITY_COLORS[card.rarity];
    return `
      <div class="fusion-card rarity-${card.rarity}" data-card-id="${card.id}"
           style="border-color:${r.color}; box-shadow:0 0 12px ${r.glow}"
           onclick="selectFusionCard(${card.id}, this)">
        ${renderHolo(card.rarity)}
        <div class="card-count">x${card.count}</div>
        <div class="card-rarity" style="background:${r.color}">${r.label}</div>
        ${renderCardVisual(card)}
        <div class="card-name">${card.name}</div>
        ${renderStatBars(card)}
      </div>
    `;
  }).join('');

  // Store cards data
  grid._cards = cards;
}

function selectFusionCard(cardId, el) {
  const grid = document.getElementById('fusion-grid');
  const cards = grid._cards;
  const card = cards.find(c => c.id === cardId);
  if (!card) return;

  selectedCardId = cardId;
  selectedCard = card;

  // Highlight
  grid.querySelectorAll('.fusion-card').forEach(c => c.classList.remove('fusion-selected'));
  el.classList.add('fusion-selected');

  // Show panel
  const panel = document.getElementById('fusion-panel');
  panel.classList.remove('hidden');
  document.getElementById('fusion-card-name').textContent = card.name;

  // Fill 5 slots
  const slots = document.getElementById('fusion-slots');
  const r = RARITY_COLORS[card.rarity];
  slots.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    slots.innerHTML += `
      <div class="fusion-slot" style="border-color:${r.color}">
        <img src="/img/cards/${card.image}" alt="${card.name}" onerror="this.style.display='none'">
        <div class="fusion-slot-label">${card.name}</div>
      </div>
    `;
  }
}

async function startFusion() {
  if (!selectedCardId) return;

  const btn = document.getElementById('fusion-btn');
  btn.disabled = true;

  // Call API first to get result
  try {
    const res = await fetch('/api/fusion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: selectedCardId })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error);
      btn.disabled = false;
      return;
    }

    fusionResult = data;

    // Show wheel and animate
    const overlay = document.getElementById('fusion-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('fusion-result').classList.add('hidden');

    spinWheel(data.fused);
  } catch (err) {
    alert('Erreur reseau');
    btn.disabled = false;
  }
}

function spinWheel(isSuccess) {
  const canvas = document.getElementById('fusion-wheel');
  const ctx = canvas.getContext('2d');
  const centerX = 200;
  const centerY = 200;
  const radius = 180;

  // 10 segments: 4 green (success), 6 red (fail) — roughly 35% / 65%
  // Positions: mixed for visual variety
  const segments = [
    { label: 'SUCCES', color: '#22cc44', isSuccess: true },
    { label: 'ECHEC', color: '#cc2222', isSuccess: false },
    { label: 'ECHEC', color: '#aa1111', isSuccess: false },
    { label: 'SUCCES', color: '#22cc44', isSuccess: true },
    { label: 'ECHEC', color: '#cc2222', isSuccess: false },
    { label: 'ECHEC', color: '#aa1111', isSuccess: false },
    { label: 'SUCCES', color: '#22cc44', isSuccess: true },
    { label: 'ECHEC', color: '#cc2222', isSuccess: false },
    { label: 'ECHEC', color: '#aa1111', isSuccess: false },
    { label: 'SUCCES', color: '#33dd55', isSuccess: true },
  ];

  const segAngle = (Math.PI * 2) / segments.length;

  // Find a target segment that matches our result
  let targetIdx;
  if (isSuccess) {
    const successIdxs = segments.map((s, i) => s.isSuccess ? i : -1).filter(i => i >= 0);
    targetIdx = successIdxs[Math.floor(Math.random() * successIdxs.length)];
  } else {
    const failIdxs = segments.map((s, i) => !s.isSuccess ? i : -1).filter(i => i >= 0);
    targetIdx = failIdxs[Math.floor(Math.random() * failIdxs.length)];
  }

  // Calculate final angle so pointer (top) lands on target segment
  // Pointer is at top (270deg / -PI/2)
  // Segment center = targetIdx * segAngle + segAngle/2
  // We want that to be at the top after rotation
  const targetCenter = targetIdx * segAngle + segAngle / 2;
  const finalAngle = (Math.PI * 2 - targetCenter - Math.PI / 2) + Math.PI * 2 * (5 + Math.random() * 3);

  const duration = 3000;
  const startTime = performance.now();
  let currentAngle = 0;

  function draw(angle) {
    ctx.clearRect(0, 0, 400, 400);

    for (let i = 0; i < segments.length; i++) {
      const startA = angle + i * segAngle;
      const endA = startA + segAngle;

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startA, endA);
      ctx.closePath();
      ctx.fillStyle = segments[i].color;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(startA + segAngle / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px "Press Start 2P", monospace';
      ctx.fillText(segments[i].label, radius * 0.6, 5);
      ctx.restore();
    }

    // Center circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, 20, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.strokeStyle = '#00ff41';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function animate(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Cubic ease-out
    const eased = 1 - Math.pow(1 - progress, 3);
    currentAngle = eased * finalAngle;

    draw(currentAngle);

    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      // Show result after a short pause
      setTimeout(() => showFusionResult(isSuccess), 500);
    }
  }

  requestAnimationFrame(animate);
}

function showFusionResult(isSuccess) {
  const resultDiv = document.getElementById('fusion-result');
  const resultText = document.getElementById('fusion-result-text');
  const resultCard = document.getElementById('fusion-result-card');

  resultDiv.classList.remove('hidden');

  if (isSuccess) {
    resultText.textContent = 'FUSION REUSSIE !';
    resultText.style.color = '#22cc44';
    resultText.className = 'fusion-result-success';

    // Show fused card
    const card = fusionResult.card;
    card.is_fused = 1;
    const r = RARITY_COLORS[card.rarity];
    resultCard.innerHTML = `
      <div class="collection-card rarity-${card.rarity} collection-card-fused"
           style="border-color:${r.color}; box-shadow:0 0 20px ${r.glow}; min-height:300px">
        ${renderCardFront(card)}
      </div>
    `;

    screenFlash();
  } else {
    resultText.textContent = 'ECHEC...';
    resultText.style.color = '#cc2222';
    resultText.className = 'fusion-result-fail';
    resultCard.innerHTML = '<div class="fusion-fail-text">Les 5 cartes ont ete perdues</div>';
  }
}

function closeFusionResult() {
  document.getElementById('fusion-overlay').classList.add('hidden');
  document.getElementById('fusion-panel').classList.add('hidden');
  document.getElementById('fusion-btn').disabled = false;
  selectedCardId = null;
  selectedCard = null;
  fusionResult = null;
  loadFusionCards();
  loadCredits();
}

function screenFlash() {
  const flash = document.getElementById('screen-flash');
  flash.classList.remove('hidden');
  flash.classList.add('flash-active');
  setTimeout(() => { flash.classList.remove('flash-active'); flash.classList.add('hidden'); }, 400);
}

// ============================================
// EVEIL (AWAKENING) TAB
// ============================================
let currentForgeTab = 'fusion';

function switchForgeTab(tab) {
  currentForgeTab = tab;
  document.querySelectorAll('.fusion-tab').forEach(t => t.classList.remove('fusion-tab--active'));
  document.querySelector(`.fusion-tab[data-tab="${tab}"]`).classList.add('fusion-tab--active');

  document.getElementById('tab-fusion').classList.toggle('hidden', tab !== 'fusion');
  document.getElementById('tab-eveil').classList.toggle('hidden', tab !== 'eveil');

  // Hide fusion panel when switching tabs
  document.getElementById('fusion-panel').classList.add('hidden');

  if (tab === 'eveil') loadAwakeningCards();
}

async function loadAwakeningCards() {
  try {
    const res = await fetch('/api/awakening/available');
    if (!res.ok) return;
    const cards = await res.json();

    const grid = document.getElementById('eveil-grid');
    const emptyMsg = document.getElementById('eveil-empty-msg');
    const resourcesDiv = document.getElementById('eveil-resources');

    // Show resources
    const itemsRes = await fetch('/api/items');
    const items = await itemsRes.json();
    const meRes = await fetch('/api/me');
    const me = await meRes.json();
    const pierreCount = items.find(i => i.item_key === 'pierre_eveil')?.quantity || 0;

    resourcesDiv.innerHTML = `
      <div class="eveil-resource-bar">
        <span>💰 ${me.credits} CR</span>
        <span>⛏ ${me.essence} Essence</span>
        <span>🌟 ${pierreCount} Pierre(s) d'Eveil</span>
      </div>
    `;

    if (cards.length === 0) {
      grid.innerHTML = '';
      emptyMsg.classList.remove('hidden');
      return;
    }

    emptyMsg.classList.add('hidden');
    grid.innerHTML = cards.map(card => {
      const r = RARITY_COLORS[card.rarity];
      const conf = card.config;
      const stars = '★'.repeat(card.nextLevel);
      return `
        <div class="fusion-card rarity-${card.rarity} ${card.canAfford ? 'eveil-affordable' : 'eveil-locked'}"
             style="border-color:${r.color}; box-shadow:0 0 12px ${r.glow}">
          ${renderHolo(card.rarity)}
          <div class="card-rarity" style="background:gold;color:#000">${stars} EVEIL ${card.nextLevel}</div>
          ${renderCardVisual(card)}
          <div class="card-name">${card.name}</div>
          ${renderStatBars(card)}
          <div class="eveil-cost">
            <div>💰 ${conf.cost.credits} CR</div>
            <div>⛏ ${conf.cost.essence} Essence</div>
            <div>🌟 ${conf.cost.pierre_eveil} Pierre(s)</div>
          </div>
          <div class="eveil-bonus">+${conf.bonuses.attack} ATK / +${conf.bonuses.defense} DEF / +${conf.bonuses.hp} HP</div>
          <button class="submit-btn eveil-btn" ${!card.canAfford ? 'disabled' : ''}
                  onclick="doAwakening(${card.user_card_id})">
            ${card.canAfford ? 'EVEILLER ⭐' : 'RESSOURCES MANQUANTES'}
          </button>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Erreur chargement eveil:', e);
  }
}

async function doAwakening(userCardId) {
  try {
    const res = await fetch('/api/awakening', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userCardId })
    });
    const data = await res.json();
    if (!res.ok) {
      if (window.showToast) showToast(data.error, 'error');
      else alert(data.error);
      return;
    }

    // Success animation
    screenFlash();
    if (window.showToast) showToast(`${data.label} reussi ! +${data.bonuses.attack} ATK / +${data.bonuses.defense} DEF / +${data.bonuses.hp} HP`, 'success', 5000);

    // Reload
    loadCredits();
    loadAwakeningCards();
  } catch (e) {
    if (window.showToast) showToast('Erreur reseau', 'error');
  }
}

// Init
loadCredits();
loadFusionCards();
