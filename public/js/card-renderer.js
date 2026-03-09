// === CONSTANTES PARTAGEES ===
const RARITY_COLORS = {
  commune:    { color: '#888888', glow: 'rgba(136,136,136,0.4)', label: 'COMMUNE' },
  rare:       { color: '#4488ff', glow: 'rgba(68,136,255,0.5)',  label: 'RARE' },
  epique:     { color: '#cc44ff', glow: 'rgba(204,68,255,0.5)',  label: 'EPIQUE' },
  legendaire: { color: '#ffaa00', glow: 'rgba(255,170,0,0.6)',   label: 'LEGENDAIRE' },
  chaos:      { color: '#ff0044', glow: 'rgba(255,0,68,0.7)',    label: 'CHAOS' },
  secret:     { color: '#111111', glow: 'rgba(255,255,255,0.6)', label: 'SECRET' }
};

const ELEMENT_ICONS  = { feu: '🔥', eau: '💧', terre: '🌿', lumiere: '✨', ombre: '🌑', neutre: '⚪' };
const ELEMENT_NAMES  = { feu: 'Feu', eau: 'Eau', terre: 'Terre', lumiere: 'Lumiere', ombre: 'Ombre', neutre: 'Neutre' };
const ELEMENT_COLORS = { feu: '#ff4422', eau: '#2299ff', terre: '#44aa33', lumiere: '#ffcc00', ombre: '#9944cc', neutre: '#aaaaaa' };

// Max stats pour les barres (fused = x2)
const MAX_ATK = 10;
const MAX_DEF = 10;
const MAX_HP  = 50;
const MAX_ATK_FUSED = 20;
const MAX_DEF_FUSED = 20;
const MAX_HP_FUSED  = 100;

// === RENDU VISUEL CARTE ===
function renderCardVisual(card) {
  const hasImage = card.image && card.image !== '';
  const imgPath = `/img/cards/${card.image}`;
  const elemIcon = ELEMENT_ICONS[card.element] || '?';
  const displayIcon = card.emoji || elemIcon;
  const watermark = `<div class="card-visual-watermark">${elemIcon}</div>`;

  if (hasImage) {
    return `
      <div class="card-visual">
        ${watermark}
        <img src="${imgPath}" alt="${card.name}"
          onerror="this.parentElement.innerHTML='<div class=\\'card-visual-fallback elem-${card.element}\\'>${displayIcon}</div>'">
      </div>
    `;
  }
  return `<div class="card-visual">${watermark}<div class="card-visual-fallback elem-${card.element}">${displayIcon}</div></div>`;
}

// === BARRES DE STATS ===
function renderStatBars(card) {
  const isFused = card.is_fused;
  const mult = isFused ? 2 : 1;
  const atk = card.attack * mult;
  const def = card.defense * mult;
  const hp = card.hp * mult;
  const maxA = isFused ? MAX_ATK_FUSED : MAX_ATK;
  const maxD = isFused ? MAX_DEF_FUSED : MAX_DEF;
  const maxH = isFused ? MAX_HP_FUSED : MAX_HP;
  const atkPct = Math.min(100, (atk / maxA) * 100);
  const defPct = Math.min(100, (def / maxD) * 100);
  const hpPct  = Math.min(100, (hp / maxH) * 100);

  return `
    <div class="card-stats-row">
      <div class="stat-bar stat-atk">
        <span class="stat-bar-label">ATK</span>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${atkPct}%"></div></div>
        <span class="stat-bar-val">${atk}</span>
      </div>
      <div class="stat-bar stat-def">
        <span class="stat-bar-label">DEF</span>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${defPct}%"></div></div>
        <span class="stat-bar-val">${def}</span>
      </div>
      <div class="stat-bar stat-hp">
        <span class="stat-bar-label">PV</span>
        <div class="stat-bar-track"><div class="stat-bar-fill" style="width:${hpPct}%"></div></div>
        <span class="stat-bar-val">${hp}</span>
      </div>
    </div>
  `;
}

// === HOLO OVERLAY ===
function renderHolo(rarity, isShiny, isTemp) {
  if (isTemp) return '<div class="card-holo holo-temp"></div>';
  if (isShiny) return '<div class="card-holo holo-shiny"></div>';
  if (rarity === 'chaos') return '<div class="card-holo holo-chaos"></div>';
  if (rarity === 'legendaire') return '<div class="card-holo holo-legendary"></div>';
  if (rarity === 'epique') return '<div class="card-holo holo-epic"></div>';
  return '';
}

// === BADGES SHINY / FUSED ===
function renderBadges(card) {
  let html = '';
  if (card.is_temp) html += '<div class="card-badge badge-temp">TEMP</div>';
  if (card.is_shiny) html += '<div class="card-badge badge-shiny">SHINY</div>';
  if (card.is_fused) html += '<div class="card-badge badge-fused">FUSION+</div>';
  return html;
}

// === RENDU COMPLET FACE AVANT ===
function renderCardFront(card) {
  const r = RARITY_COLORS[card.rarity];
  const elemColor = ELEMENT_COLORS[card.element] || '#00ff41';
  const elemIcon = ELEMENT_ICONS[card.element] || '?';
  const elemName = ELEMENT_NAMES[card.element] || card.element;

  return `
    ${renderHolo(card.rarity, card.is_shiny, card.is_temp)}
    ${renderBadges(card)}
    <div class="card-rarity" style="background:${r.color}">${r.label}</div>
    ${renderCardVisual(card)}
    <div class="card-name">${card.name}</div>
    <div class="card-element" style="color:${elemColor}; border:1px solid ${elemColor};">${elemIcon} ${elemName}</div>
    ${renderStatBars(card)}
    <div class="card-sep"></div>
    <div class="card-ability">
      <div class="ability-cost">&#9670; ${card.mana_cost} MANA</div>
      <div class="ability-name">${card.ability_name}</div>
      <div class="ability-desc">${card.ability_desc}</div>
    </div>
    ${card.passive_desc ? `<div class="card-passive"><span class="passive-label">PASSIF</span> ${card.passive_desc}</div>` : ''}
    <div class="card-type">${card.type}</div>
  `;
}

// === CARTE COMPACTE POUR COMBAT ===
function renderBattleCard(unit) {
  const elemIcon = ELEMENT_ICONS[unit.element] || '?';
  const elemColor = ELEMENT_COLORS[unit.element] || '#00ff41';
  const r = RARITY_COLORS[unit.rarity];
  const hpPct = Math.max(0, (unit.currentHp / unit.maxHp) * 100);
  let hpColor = '#44dd44';
  if (hpPct < 30) hpColor = '#ff4444';
  else if (hpPct < 60) hpColor = '#ffaa00';

  const shinyClass = unit.is_shiny ? 'battle-card-shiny' : '';
  const fusedClass = unit.is_fused ? 'battle-card-fused' : '';
  const tempClass = unit.is_temp ? 'battle-card-temp' : '';

  return `
    <div class="battle-card ${shinyClass} ${fusedClass} ${tempClass} ${!unit.alive ? 'battle-card-ko' : ''}" style="border-color:${r.color}">
      ${unit.is_shiny ? '<div class="card-holo holo-shiny battle-holo"></div>' : ''}
      <div class="battle-card-img">
        <img src="/img/cards/${unit.image}" alt="${unit.name}" onerror="this.style.display='none'">
      </div>
      <div class="battle-card-info">
        <div class="battle-card-name">${unit.name}</div>
        <div class="battle-card-elem" style="color:${elemColor}">${elemIcon}</div>
        <div class="battle-hp-bar">
          <div class="battle-hp-fill" style="width:${hpPct}%; background:${hpColor}"></div>
        </div>
        <div class="battle-hp-text" style="color:${hpColor}">${unit.currentHp}/${unit.maxHp}</div>
        <div class="battle-statuses">
          ${unit.poisonDotTurns > 0 ? '<span title="Poison (' + unit.poisonDotTurns + ' tours)" style="color:#aa44ff">☠' + unit.poisonDotTurns + '</span>' : ''}
          ${unit.shield > 0 ? '<span title="Bouclier" style="color:#44cccc">🛡' + unit.shield + '</span>' : ''}
          ${unit.marked > 0 ? '<span title="Marque" style="color:#ffaa00">🎯</span>' : ''}
          ${unit.counterDamage > 0 ? '<span title="Contre-attaque" style="color:#ff4444">⚔</span>' : ''}
        </div>
        <div class="battle-card-stats">
          <span style="color:#ff4444">ATK ${unit.effectiveStats.attack}</span>
          <span style="color:#4488ff">DEF ${unit.effectiveStats.defense}</span>
        </div>
      </div>
      ${!unit.alive ? '<div class="battle-ko-overlay">KO</div>' : ''}
      ${unit.is_fused ? '<div class="battle-fused-badge">FUSION+</div>' : ''}
    </div>
  `;
}

// === 3D TILT EFFECT ===
function initTiltEffect(container) {
  container.querySelectorAll('.collection-card, .reveal-card.revealed').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const rotateX = ((y - centerY) / centerY) * -12;
      const rotateY = ((x - centerX) / centerX) * 12;

      card.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.05)`;

      const holo = card.querySelector('.card-holo');
      if (holo) {
        const bgX = (x / rect.width) * 100;
        const bgY = (y / rect.height) * 100;
        holo.style.backgroundPosition = `${bgX}% ${bgY}%`;
        holo.style.opacity = '1';
      }
    });

    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
      const holo = card.querySelector('.card-holo');
      if (holo) {
        // Keep shiny holos always visible
        if (!holo.classList.contains('holo-shiny')) {
          holo.style.opacity = '0';
        }
      }
    });
  });
}

// === POPUP DETAIL ===
function showCardDetail(card) {
  const existing = document.querySelector('.card-modal-overlay');
  if (existing) existing.remove();

  const r = RARITY_COLORS[card.rarity];
  const elemColor = ELEMENT_COLORS[card.element] || '#00ff41';
  const elemIcon = ELEMENT_ICONS[card.element] || '?';
  const elemName = ELEMENT_NAMES[card.element] || card.element;

  const hasImage = card.image && card.image !== '';
  const imgPath = `/img/cards/${card.image}`;

  const isFused = card.is_fused;
  const mult = isFused ? 2 : 1;
  const atk = card.attack * mult;
  const def = card.defense * mult;
  const hp = card.hp * mult;
  const maxA = isFused ? MAX_ATK_FUSED : MAX_ATK;
  const maxD = isFused ? MAX_DEF_FUSED : MAX_DEF;
  const maxH = isFused ? MAX_HP_FUSED : MAX_HP;
  const atkPct = Math.min(100, (atk / maxA) * 100);
  const defPct = Math.min(100, (def / maxD) * 100);
  const hpPct  = Math.min(100, (hp / maxH) * 100);

  const artHTML = hasImage
    ? `<img src="${imgPath}" alt="${card.name}" onerror="this.parentElement.innerHTML='<div class=\\'card-visual-fallback elem-${card.element}\\'>${elemIcon}</div>'">`
    : `<div class="card-visual-fallback elem-${card.element}" style="font-size:80px">${elemIcon}</div>`;

  const tempBadge = card.is_temp ? '<span class="modal-badge modal-badge-temp">TEMP</span>' : '';
  const shinyBadge = card.is_shiny ? '<span class="modal-badge modal-badge-shiny">SHINY</span>' : '';
  const fusedBadge = card.is_fused ? '<span class="modal-badge modal-badge-fused">FUSION+</span>' : '';

  const overlay = document.createElement('div');
  overlay.className = 'card-modal-overlay';
  overlay.innerHTML = `
    <button class="modal-close">[ FERMER ]</button>
    <div class="card-modal ${card.is_shiny ? 'modal-shiny' : ''}">
      <div class="modal-card-art" style="border: 3px solid ${r.color}; box-shadow: 0 0 30px ${r.glow};">
        ${artHTML}
      </div>
      <div class="modal-card-info">
        ${tempBadge}${shinyBadge}${fusedBadge}
        <div class="modal-card-rarity" style="background:${r.color}">${r.label}</div>
        <div class="modal-card-name" style="color:${r.color}">${card.name}</div>
        <div class="modal-card-element">
          <span style="color:${elemColor}">${elemIcon} ${elemName}</span>
        </div>

        <div class="modal-stats">
          <div class="modal-stat-bar">
            <span class="modal-stat-label" style="color:#ff4444">ATK</span>
            <div class="modal-stat-track"><div class="modal-stat-fill" style="width:${atkPct}%; background:linear-gradient(90deg,#ff2222,#ff6644); box-shadow:0 0 8px rgba(255,68,68,0.5)"></div></div>
            <span class="modal-stat-val" style="color:#ff4444">${atk}</span>
          </div>
          <div class="modal-stat-bar">
            <span class="modal-stat-label" style="color:#4488ff">DEF</span>
            <div class="modal-stat-track"><div class="modal-stat-fill" style="width:${defPct}%; background:linear-gradient(90deg,#2266ff,#44aaff); box-shadow:0 0 8px rgba(68,136,255,0.5)"></div></div>
            <span class="modal-stat-val" style="color:#4488ff">${def}</span>
          </div>
          <div class="modal-stat-bar">
            <span class="modal-stat-label" style="color:#44dd44">PV</span>
            <div class="modal-stat-track"><div class="modal-stat-fill" style="width:${hpPct}%; background:linear-gradient(90deg,#22bb22,#66ff44); box-shadow:0 0 8px rgba(68,221,68,0.5)"></div></div>
            <span class="modal-stat-val" style="color:#44dd44">${hp}</span>
          </div>
        </div>

        <div class="modal-ability">
          <div class="modal-ability-header">
            <span class="modal-ability-cost">&#9670; ${card.mana_cost} MANA</span>
            <span class="modal-ability-name">${card.ability_name}</span>
          </div>
          <div class="modal-ability-desc">${card.ability_desc}</div>
        </div>

        ${card.passive_desc ? `
        <div class="modal-passive">
          <div class="modal-passive-label">PASSIF</div>
          <div class="modal-passive-desc">${card.passive_desc}</div>
        </div>` : ''}

        <div class="modal-type">${card.type}</div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}
