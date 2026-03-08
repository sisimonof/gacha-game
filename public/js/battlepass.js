// battlepass.js — Passe de Combat

let bpData = null;

async function loadNav() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const data = await res.json();
    document.getElementById('nav-credits').textContent = data.credits;
    const navUser = document.getElementById('nav-username');
    navUser.textContent = data.displayName || data.username;
    if (data.usernameEffect) navUser.className = 'dash-nav-username ' + data.usernameEffect;
  } catch { window.location.href = '/'; }
}

async function loadBattlePass() {
  try {
    const res = await fetch('/api/battlepass');
    if (!res.ok) { window.location.href = '/'; return; }
    bpData = await res.json();
    renderBattlePass();
    renderEffectBar();
  } catch { window.location.href = '/'; }
}

function renderBattlePass() {
  const { xp, currentTier, claimedTiers, currentTierXP, currentTierRequired, tiers } = bpData;

  document.getElementById('bp-current-tier').textContent = currentTier;
  document.getElementById('bp-xp-current').textContent = currentTierXP;
  document.getElementById('bp-xp-needed').textContent = currentTierRequired;
  document.getElementById('bp-total-xp').textContent = xp + ' XP total';

  const pct = currentTier >= 30 ? 100 : Math.min(100, Math.floor((currentTierXP / currentTierRequired) * 100));
  document.getElementById('bp-xp-bar').style.width = pct + '%';

  const track = document.getElementById('bp-track');
  track.innerHTML = '';

  tiers.forEach(tier => {
    const isClaimed = claimedTiers.includes(tier.tier);
    const isUnlocked = currentTier >= tier.tier;
    const canClaim = isUnlocked && !isClaimed;

    const el = document.createElement('div');
    el.className = 'bp-tier';
    if (isClaimed) el.classList.add('bp-tier--claimed');
    else if (isUnlocked) el.classList.add('bp-tier--unlocked');
    else el.classList.add('bp-tier--locked');

    // Reward type color
    let typeClass = '';
    if (tier.reward_type === 'credits') typeClass = 'bp-type-credits';
    else if (tier.reward_type === 'avatar') typeClass = 'bp-type-avatar';
    else if (tier.reward_type === 'effect') typeClass = 'bp-type-effect';
    else if (tier.reward_type === 'essence') typeClass = 'bp-type-essence';
    else if (tier.reward_type === 'card') typeClass = 'bp-type-card';
    else if (tier.reward_type === 'multi') typeClass = 'bp-type-multi';

    el.innerHTML = `
      <div class="bp-tier-num-badge">${tier.tier}</div>
      <div class="bp-tier-icon ${typeClass}">${tier.emoji}</div>
      <div class="bp-tier-label">${tier.label}</div>
      ${canClaim ? `<button class="bp-claim-btn" onclick="claimTier(${tier.tier})">RECLAMER</button>` : ''}
      ${isClaimed ? '<div class="bp-tier-check">✓</div>' : ''}
      ${!isUnlocked ? '<div class="bp-tier-lock">🔒</div>' : ''}
    `;

    track.appendChild(el);

    // Connector line between tiers
    if (tier.tier < 30) {
      const connector = document.createElement('div');
      connector.className = 'bp-connector';
      if (currentTier >= tier.tier) connector.classList.add('bp-connector--active');
      track.appendChild(connector);
    }
  });

  // Scroll to current tier position
  setTimeout(() => {
    const targetIdx = Math.max(0, currentTier - 1);
    const tierEls = track.querySelectorAll('.bp-tier');
    if (tierEls[targetIdx]) {
      tierEls[targetIdx].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, 100);
}

function renderEffectBar() {
  const { claimedTiers, tiers, effects } = bpData;
  const container = document.getElementById('bp-effect-options');
  container.innerHTML = '<button class="bp-effect-opt" data-effect="" onclick="setEffect(\'\')">Aucun</button>';

  // Find unlocked effects
  for (const t of tiers) {
    let effectKey = null;
    if (t.reward_type === 'effect' && claimedTiers.includes(t.tier)) effectKey = t.reward_value;
    if (t.reward_type === 'multi' && claimedTiers.includes(t.tier) && t.reward_value.effect) effectKey = t.reward_value.effect;

    if (effectKey && effects[effectKey]) {
      const eff = effects[effectKey];
      const btn = document.createElement('button');
      btn.className = 'bp-effect-opt';
      btn.dataset.effect = effectKey;
      btn.innerHTML = `<span class="${eff.css}">${eff.name}</span>`;
      btn.onclick = () => setEffect(effectKey);
      container.appendChild(btn);
    }
  }

  // Highlight active effect
  highlightActiveEffect();
}

async function highlightActiveEffect() {
  const res = await fetch('/api/me');
  if (!res.ok) return;
  const data = await res.json();
  const active = data.usernameEffect || '';

  document.querySelectorAll('.bp-effect-opt').forEach(btn => {
    btn.classList.toggle('bp-effect-opt--active', btn.dataset.effect === active);
  });
}

async function setEffect(effectKey) {
  const res = await fetch('/api/battlepass/set-effect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ effect: effectKey })
  });
  if (res.ok) {
    document.querySelectorAll('.bp-effect-opt').forEach(btn => {
      btn.classList.toggle('bp-effect-opt--active', btn.dataset.effect === effectKey);
    });
    // Update navbar username effect
    const navUser = document.getElementById('nav-username');
    navUser.className = 'dash-nav-username';
    if (effectKey) {
      const eff = bpData.effects[effectKey];
      if (eff) navUser.classList.add(eff.css);
    }
  }
}

async function claimTier(tier) {
  const btn = document.querySelector(`.bp-tier:nth-child(${tier * 2 - 1}) .bp-claim-btn`);
  if (btn) { btn.disabled = true; btn.textContent = '...'; }

  const res = await fetch('/api/battlepass/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier })
  });
  const data = await res.json();

  if (res.ok && data.success) {
    showRewardPopup(data.reward, data.cardGiven);
    document.getElementById('nav-credits').textContent = data.credits;
    loadBattlePass();
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'RECLAMER'; }
  }
}

function showRewardPopup(reward, cardGiven) {
  const popup = document.getElementById('bp-reward-popup');
  document.getElementById('bp-reward-emoji').textContent = reward.emoji;
  document.getElementById('bp-reward-text').textContent = reward.label;

  let detail = '';
  if (cardGiven) {
    detail = `${cardGiven.emoji || ''} ${cardGiven.name} (${cardGiven.rarity})`;
  }
  document.getElementById('bp-reward-detail').textContent = detail;

  popup.classList.remove('hidden');
  popup.classList.add('bp-popup-anim');
}

function closeRewardPopup() {
  const popup = document.getElementById('bp-reward-popup');
  popup.classList.add('hidden');
  popup.classList.remove('bp-popup-anim');
}

loadNav();
loadBattlePass();
