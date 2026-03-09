// pvp.js — PvP combat via socket.io (reuses battle.js UI patterns)

let battleData = null;
let opponentName = '???';
let isAnimating = false;
let pvpSocket = null;
let pvpResult = null; // { result, reward } from server

let actionMode = null;
let selectedHandIndex = null;
let selectedFieldSlot = null;
let selectedItemIndex = null;
let actionPanelSlot = null;
let slotClickedThisFrame = false;
let draggedHandIndex = null;

function init() {
  const stored = sessionStorage.getItem('pvpBattleData');
  opponentName = sessionStorage.getItem('opponentName') || '???';
  if (!stored) { window.location.href = '/combat'; return; }

  battleData = JSON.parse(stored);
  document.getElementById('opponent-name').textContent = `VS ${opponentName}`;

  // Connect socket
  pvpSocket = io();

  pvpSocket.on('pvp:update', async (data) => {
    if (data.events && data.events.length > 0) {
      isAnimating = true;
      await animateEvents(data.events);
      isAnimating = false;
    }
    updateBattleData(data);
  });

  pvpSocket.on('pvp:result', (data) => {
    pvpResult = data;
  });

  renderAll();
  initDragDrop();
}

function isMyTurn() {
  return battleData && battleData.currentTurnPlayer === undefined
    ? battleData.phase === 'player_turn'
    : true; // The server only sends actions that are valid for us
}

// ========================
// RENDERING (same as battle.js)
// ========================

function renderAll() {
  if (!battleData) return;
  renderTurnInfo();
  renderEnemyHand();
  renderEnemyField();
  renderPlayerField();
  renderHand();

  // Update turn indicator
  const indicator = document.getElementById('pvp-turn-indicator');
  if (indicator) {
    // Disable end-turn when not my turn
    const endBtn = document.getElementById('end-turn-btn');
    if (endBtn) endBtn.disabled = !!battleData.result;
    indicator.textContent = battleData.result ? '' : 'PVP';
    indicator.style.color = '#cc44ff';
  }

  if (battleData.result) {
    setTimeout(() => showResult(), 600);
  }
}

function renderEnemyHand() {
  const container = document.getElementById('enemy-hand-row');
  if (!container) return;
  const count = battleData.enemyHandCount || 0;
  container.innerHTML = Array.from({ length: Math.min(count, 10) }, () =>
    '<div class="bt-enemy-card"></div>'
  ).join('');
}

function renderTurnInfo() {
  document.getElementById('battle-turn').textContent = `TOUR ${battleData.turn}`;
  document.getElementById('player-deck-count').textContent = battleData.playerDeckCount;
  document.getElementById('enemy-deck-count').textContent = battleData.enemyDeckCount;

  renderBattery('player-energy-body', battleData.playerEnergy, battleData.playerMaxEnergy, 'energy');
  renderBattery('enemy-energy-body', battleData.enemyEnergy, battleData.enemyMaxEnergy, 'energy');
  document.getElementById('player-energy-value').textContent = `${battleData.playerEnergy}/${battleData.playerMaxEnergy}`;
  document.getElementById('enemy-energy-value').textContent = `${battleData.enemyEnergy}/${battleData.enemyMaxEnergy}`;

  const pCrystal = battleData.playerCrystal || 0;
  const pMaxCrystal = battleData.playerMaxCrystal || 2;
  const eCrystal = battleData.enemyCrystal || 0;
  const eMaxCrystal = battleData.enemyMaxCrystal || 2;
  renderBattery('player-crystal-body', pCrystal, pMaxCrystal, 'crystal');
  renderBattery('enemy-crystal-body', eCrystal, eMaxCrystal, 'crystal');
  document.getElementById('player-crystal-value').textContent = pCrystal.toFixed(1);
  document.getElementById('enemy-crystal-value').textContent = eCrystal.toFixed(1);

  // Avatar HP
  const enemyHp = battleData.enemyHp || 0;
  const enemyMaxHp = battleData.enemyMaxHp || 20;
  const playerHp = battleData.playerHp || 0;
  const playerMaxHp = battleData.playerMaxHp || 20;

  const enemyAvatarEl = document.getElementById('enemy-avatar-hp');
  const playerAvatarEl = document.getElementById('player-avatar-hp');

  if (enemyAvatarEl) {
    const eHpPct = Math.round((enemyHp / enemyMaxHp) * 100);
    const eHpColor = eHpPct > 50 ? '#cc2222' : eHpPct > 25 ? '#cc6622' : '#cc2222';
    enemyAvatarEl.innerHTML = `
      <div class="bt-avatar-circle bt-avatar-enemy" onclick="clickEnemyAvatar()">
        <div class="bt-avatar-icon">\uD83D\uDC64</div>
        <div class="bt-avatar-hpbar"><div class="bt-avatar-hpbar-fill" style="width:${eHpPct}%;background:${eHpColor}"></div></div>
        <div class="bt-avatar-hp-text">\u2764\uFE0F ${enemyHp}/${enemyMaxHp}</div>
      </div>`;
  }
  if (playerAvatarEl) {
    const pHpPct = Math.round((playerHp / playerMaxHp) * 100);
    const pHpColor = pHpPct > 50 ? '#22cc44' : pHpPct > 25 ? '#ccaa22' : '#cc2222';
    playerAvatarEl.innerHTML = `
      <div class="bt-avatar-circle bt-avatar-player">
        <div class="bt-avatar-icon">\uD83D\uDC64</div>
        <div class="bt-avatar-hpbar"><div class="bt-avatar-hpbar-fill" style="width:${pHpPct}%;background:${pHpColor}"></div></div>
        <div class="bt-avatar-hp-text">\u2764\uFE0F ${playerHp}/${playerMaxHp}</div>
      </div>`;
  }

  document.getElementById('end-turn-btn').disabled = !!battleData.result;
}

function renderBattery(bodyId, current, max, type) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  const segments = Math.ceil(max);
  let html = '';
  for (let i = 0; i < segments; i++) {
    const filled = i < Math.floor(current);
    const partial = !filled && i < current;
    const cls = filled ? 'bt-seg-filled' : partial ? 'bt-seg-partial' : 'bt-seg-empty';
    const color = type === 'crystal' ? '#cc44ff' : '#00cc66';
    html += `<div class="bt-battery-seg ${cls}" style="--seg-color:${color}"></div>`;
  }
  body.innerHTML = html;
}

function renderFieldSlot(unit, slotIndex, side) {
  if (!unit || !unit.alive) return '<div class="bt-slot-empty">VIDE</div>';

  const r = RARITY_COLORS[unit.rarity] || { color: '#888' };
  const hpPercent = Math.round((unit.currentHp / unit.maxHp) * 100);
  const hpColor = hpPercent > 50 ? '#22cc44' : hpPercent > 25 ? '#ccaa22' : '#cc2222';
  const emoji = unit.emoji || ELEMENT_ICONS[unit.element] || '?';
  const isSelected = (side === 'player' && selectedFieldSlot === slotIndex && actionMode !== 'select_deploy_slot');
  const isTarget = (side === 'enemy' && actionMode === 'select_attack_target') || (side === 'enemy' && actionMode === 'select_ability_target') || (actionMode === 'select_item_target');
  const totalAtk = (unit.effectiveStats?.attack || unit.attack || 0) + (unit.buffAtk || 0) + (unit.permanentBonusAtk || 0);
  const totalDef = (unit.effectiveStats?.defense || unit.defense || 0) + (unit.buffDef || 0) + (unit.permanentBonusDef || 0);

  let statusIcons = '';
  if (unit.poisonDotTurns > 0) statusIcons += `<span class="bt-status-icon bt-status-poison" title="Poison (${unit.poisonDotTurns} tours)">☠${unit.poisonDotTurns}</span>`;
  if (unit.stunned) statusIcons += '<span class="bt-status-icon bt-status-stun">\uD83D\uDCAB</span>';
  if (unit.shield > 0) statusIcons += `<span class="bt-status-icon bt-status-shield">\uD83D\uDEE1${unit.shield}</span>`;
  if (unit.burnAoe) statusIcons += `<span class="bt-status-icon bt-status-poison">\uD83D\uDD25${unit.burnAoe.turnsLeft}</span>`;

  let rankBadge = '';
  if (unit.rankBonus) {
    rankBadge = unit.rankBonus === 'center'
      ? '<span class="bt-rank-badge bt-rank-badge--def">\uD83D\uDEE1+1</span>'
      : '<span class="bt-rank-badge bt-rank-badge--atk">\u2694\uFE0F+1</span>';
  }

  const attackedClass = side === 'player' && battleData.attackedThisTurn?.includes(slotIndex) ? 'bt-attacked' : '';
  const sicknessClass = unit.justDeployed ? 'bt-sickness' : '';
  const manaCost = unit.mana_cost || unit.manaCost || '?';

  const abilityHtml = unit.ability_name ? `
    <div class="bt-unit-ability ${unit.usedAbility ? 'bt-ability-used' : ''}">
      <span class="bt-ability-label">\u2726 ${unit.ability_name}</span>
      ${unit.ability_desc ? `<span class="bt-ability-desc">${unit.ability_desc}</span>` : ''}
    </div>` : '';

  const passiveHtml = unit.passive_desc ? `
    <div class="bt-unit-passive"><span class="bt-passive-label">\uD83D\uDD38 ${unit.passive_desc}</span></div>` : '';

  return `
    <div class="bt-unit ${isSelected ? 'bt-selected' : ''} ${isTarget ? 'bt-targetable' : ''} ${attackedClass} ${sicknessClass}"
         style="border-color: ${r.color}" data-slot="${slotIndex}" data-side="${side}">
      <div class="bt-unit-type">${unit.type || ''}</div>
      <div class="bt-unit-mana">\u26A1${manaCost}</div>
      ${unit.justDeployed ? '<div class="bt-sickness-badge">\uD83D\uDCA4</div>' : ''}
      ${rankBadge}
      <div class="bt-unit-emoji">${emoji}</div>
      <div class="bt-unit-name">${unit.name}</div>
      <div class="bt-unit-hp">
        <div class="bt-unit-hpbar"><div class="bt-unit-hpbar-fill" style="width:${hpPercent}%;background:${hpColor}"></div></div>
        <span class="bt-unit-hp-text" style="color:${hpColor}">${unit.currentHp}/${unit.maxHp}</span>
      </div>
      <div class="bt-unit-stats">
        <span class="bt-stat-atk">\u2694\uFE0F ${totalAtk}</span>
        <span class="bt-stat-def">\uD83D\uDEE1\uFE0F ${totalDef}</span>
        <span class="bt-stat-hp">\u2764\uFE0F ${unit.currentHp}</span>
      </div>
      ${statusIcons ? `<div class="bt-unit-status">${statusIcons}</div>` : ''}
      ${abilityHtml}
      ${passiveHtml}
    </div>`;
}

function renderEnemyField() {
  for (let i = 0; i < 3; i++) {
    const slotEl = document.querySelector(`#enemy-field .bt-slot[data-slot="${i}"]`);
    slotEl.innerHTML = renderFieldSlot(battleData.enemyField[i], i, 'enemy');
  }
  const avatarEl = document.getElementById('enemy-avatar-hp');
  if (avatarEl) {
    const circle = avatarEl.querySelector('.bt-avatar-circle');
    if (circle) {
      const enemyAlive = battleData.enemyField.some(u => u && u.alive);
      const isTargeting = actionMode === 'select_attack_target' || actionMode === 'select_ability_target';
      circle.classList.toggle('bt-avatar-targetable', isTargeting && !enemyAlive);
    }
  }
}

function renderPlayerField() {
  for (let i = 0; i < 3; i++) {
    const slotEl = document.querySelector(`#player-field .bt-slot[data-slot="${i}"]`);
    slotEl.innerHTML = renderFieldSlot(battleData.playerField[i], i, 'player');
  }
}

function renderHand() {
  const hand = document.getElementById('player-hand');
  if (!battleData.playerHand || battleData.playerHand.length === 0) {
    hand.innerHTML = '<div class="bt-hand-empty">Main vide</div>';
    return;
  }
  hand.innerHTML = battleData.playerHand.map((card, i) => {
    const r = RARITY_COLORS[card.rarity] || { color: '#888' };
    const emoji = card.emoji || ELEMENT_ICONS[card.element] || '?';
    const canAfford = card.mana_cost <= battleData.playerEnergy;
    const isSelected = selectedHandIndex === i;
    return `
      <div class="bt-card ${canAfford ? '' : 'bt-card--expensive'} ${isSelected ? 'bt-card--selected' : ''}"
           style="border-color: ${r.color}" onclick="clickHandCard(${i})"
           draggable="${canAfford}" ondragstart="onCardDragStart(event, ${i})" ondragend="onCardDragEnd(event)">
        <div class="bt-card-cost">\u26A1${card.mana_cost}</div>
        <div class="bt-card-emoji">${emoji}</div>
        <div class="bt-card-name">${card.name}</div>
        <div class="bt-card-stats">
          <span class="bt-card-stat-atk">\u2694\uFE0F ${card.effectiveStats?.attack ?? card.attack}</span>
          <span class="bt-card-stat-def">\uD83D\uDEE1\uFE0F ${card.effectiveStats?.defense ?? card.defense}</span>
          <span class="bt-card-stat-hp">\u2764\uFE0F ${card.effectiveStats?.hp ?? card.hp}</span>
        </div>
        ${card.ability_name && card.ability_name !== 'Aucun' ? `<div class="bt-card-ability">\u2726 ${card.ability_desc || card.ability_name}</div>` : ''}
      </div>`;
  }).join('');
}

// ========================
// CLICK HANDLERS
// ========================

function cancelAction() {
  hideActionPanel();
  actionMode = null; selectedHandIndex = null; selectedFieldSlot = null; selectedItemIndex = null;
  renderAll();
}

function showActionPanel(slotIndex, unit, crystalCost, canAttack, canAbility, hasSickness, hasEnergy) {
  actionPanelSlot = slotIndex; selectedFieldSlot = slotIndex; renderAll();
  const panel = document.getElementById('bt-actions');
  const unitInfo = document.getElementById('bt-actions-unit');
  const buttons = document.getElementById('bt-actions-buttons');
  const emoji = unit.emoji || ELEMENT_ICONS[unit.element] || '?';
  unitInfo.innerHTML = `<div class="bt-actions-header"><span class="bt-actions-unit-emoji">${emoji}</span><div class="bt-actions-header-info"><div class="bt-actions-unit-name">${unit.name}</div><div class="bt-actions-unit-stats">\u2694\uFE0F${unit.attack} \uD83D\uDEE1\uFE0F${unit.defense} \u2764\uFE0F${unit.currentHp}/${unit.maxHp}</div></div></div>`;
  let atkStatus = '';
  if (hasSickness) atkStatus = '\uD83D\uDCA4 Vient d\'etre posee';
  else if (!hasEnergy) atkStatus = '\u26A1 Pas assez d\'energie';
  else if (battleData.attackedThisTurn?.includes(slotIndex)) atkStatus = '\u2713 Deja attaque';
  let abilityStatus = '';
  if (unit.usedAbility) abilityStatus = '\u2713 Deja utilisee';
  else if ((battleData.playerCrystal || 0) < crystalCost) abilityStatus = 'Pas assez de crystal';
  buttons.innerHTML = `
    <button class="bt-action-btn bt-action-btn--attack ${!canAttack ? 'disabled' : ''}" onclick="actionAttack(event)" ${!canAttack ? 'disabled' : ''}>
      <span class="bt-action-icon">\u2694\uFE0F</span><div class="bt-action-info"><span class="bt-action-label">ATTAQUER</span><span class="bt-action-cost">\u26A1 1 energie</span>${atkStatus ? `<span class="bt-action-status">${atkStatus}</span>` : ''}</div>
    </button>
    <button class="bt-action-btn bt-action-btn--ability ${!canAbility ? 'disabled' : ''}" onclick="actionAbility(event)" ${!canAbility ? 'disabled' : ''}>
      <span class="bt-action-icon">\u2726</span><div class="bt-action-info"><span class="bt-action-label">${unit.ability_name || 'POUVOIR'}</span><span class="bt-action-cost">\uD83D\uDC8E ${crystalCost} crystal</span>${unit.ability_desc ? `<span class="bt-action-desc">${unit.ability_desc}</span>` : ''}${abilityStatus ? `<span class="bt-action-status">${abilityStatus}</span>` : ''}</div>
    </button>
    ${unit.passive_desc ? `<div class="bt-actions-passive">\uD83D\uDD38 Passif : ${unit.passive_desc}</div>` : ''}`;
  panel.classList.remove('hidden');
}

function hideActionPanel() { document.getElementById('bt-actions').classList.add('hidden'); actionPanelSlot = null; }
function actionAttack(e) { e.stopPropagation(); hideActionPanel(); actionMode = 'select_attack_target'; renderAll(); }
function actionAbility(e) { e.stopPropagation(); hideActionPanel(); actionMode = 'select_ability_target'; renderAll(); }

function clickHandCard(index) {
  if (isAnimating || battleData.result) return;
  const card = battleData.playerHand[index];
  if (!card || card.mana_cost > battleData.playerEnergy) return;
  selectedHandIndex = index;
  actionMode = 'select_deploy_slot';
  renderAll();
}

function clickFieldSlot(side, slotIndex) {
  if (isAnimating || battleData.result) return;
  if (actionMode === 'select_deploy_slot' && side === 'player') {
    const slot = battleData.playerField[slotIndex];
    if (slot && slot.alive) return;
    deployCard(selectedHandIndex, slotIndex);
    return;
  }
  if (actionMode === 'select_attack_target' && side === 'enemy') {
    const target = battleData.enemyField[slotIndex];
    if (!target || !target.alive) return;
    attackCard(selectedFieldSlot, slotIndex);
    return;
  }
  if (actionMode === 'select_ability_target' && side === 'enemy') {
    useAbility(selectedFieldSlot);
    return;
  }
  if (side === 'player') {
    const unit = battleData.playerField[slotIndex];
    if (!unit || !unit.alive) return;
    if (actionPanelSlot === slotIndex) { hideActionPanel(); cancelAction(); return; }
    hideActionPanel();
    if (unit.stunned) return;
    const hasSickness = unit.justDeployed;
    const enemyAlive = battleData.enemyField.some(u => u && u.alive);
    const hasEnergy = battleData.playerEnergy >= 1;
    const canAttack = !battleData.attackedThisTurn?.includes(slotIndex) && !hasSickness && hasEnergy && enemyAlive;
    const crystalCost = unit.crystal_cost || 1;
    const canAbility = !unit.usedAbility && (battleData.playerCrystal || 0) >= crystalCost && enemyAlive;
    showActionPanel(slotIndex, unit, crystalCost, canAttack, canAbility, hasSickness, hasEnergy);
  }
}

function clickEnemyAvatar() {
  if (isAnimating || battleData.result) return;
  if (actionMode === 'select_attack_target') {
    if (battleData.enemyField.some(u => u && u.alive)) return;
    attackAvatar(selectedFieldSlot);
  }
}

// ========================
// SOCKET ACTIONS (replace fetch)
// ========================

function deployCard(handIndex, fieldSlot) {
  if (isAnimating) return;
  pvpSocket.emit('pvp:deploy', { handIndex, fieldSlot });
  cancelAction();
}

function attackCard(fieldSlot, targetSlot) {
  if (isAnimating) return;
  pvpSocket.emit('pvp:attack', { attackerSlot: fieldSlot, targetSlot });
  cancelAction();
}

function attackAvatar(fieldSlot) {
  if (isAnimating) return;
  pvpSocket.emit('pvp:attack-avatar', { attackerSlot: fieldSlot });
  cancelAction();
}

function useAbility(fieldSlot) {
  if (isAnimating) return;
  pvpSocket.emit('pvp:use-ability', { fieldSlot });
  cancelAction();
}

function endTurn() {
  if (isAnimating || battleData.result) return;
  document.getElementById('end-turn-btn').disabled = true;
  cancelAction();
  pvpSocket.emit('pvp:end-turn');
}

function updateBattleData(data) {
  battleData.playerHand = data.playerHand;
  battleData.playerField = data.playerField;
  battleData.playerEnergy = data.playerEnergy;
  battleData.playerMaxEnergy = data.playerMaxEnergy;
  battleData.playerCrystal = data.playerCrystal;
  battleData.playerMaxCrystal = data.playerMaxCrystal;
  battleData.playerDeckCount = data.playerDeckCount;
  battleData.playerHp = data.playerHp;
  battleData.playerMaxHp = data.playerMaxHp;
  battleData.enemyField = data.enemyField;
  battleData.enemyHandCount = data.enemyHandCount;
  battleData.enemyEnergy = data.enemyEnergy;
  battleData.enemyMaxEnergy = data.enemyMaxEnergy;
  battleData.enemyCrystal = data.enemyCrystal;
  battleData.enemyMaxCrystal = data.enemyMaxCrystal;
  battleData.enemyDeckCount = data.enemyDeckCount;
  battleData.enemyHp = data.enemyHp;
  battleData.enemyMaxHp = data.enemyMaxHp;
  battleData.turn = data.turn;
  battleData.result = data.result;
  battleData.attackedThisTurn = data.attackedThisTurn || [];
  renderAll();
}

// ========================
// DRAG & DROP
// ========================

function onCardDragStart(event, handIndex) {
  if (isAnimating || battleData.result) { event.preventDefault(); return; }
  draggedHandIndex = handIndex;
  event.dataTransfer.setData('text/plain', handIndex.toString());
  event.dataTransfer.effectAllowed = 'move';
  requestAnimationFrame(() => event.target.classList.add('bt-card--dragging'));
  highlightDropZones(true);
  cancelAction();
}
function onCardDragEnd(event) { event.target.classList.remove('bt-card--dragging'); draggedHandIndex = null; highlightDropZones(false); }
function highlightDropZones(show) {
  document.querySelectorAll('#player-field .bt-slot').forEach((slot, i) => {
    if (show) {
      const isEmpty = !battleData.playerField[i] || !battleData.playerField[i].alive;
      slot.classList.toggle('bt-slot--drop-target', isEmpty);
    } else {
      slot.classList.remove('bt-slot--drop-target', 'bt-slot--drop-invalid', 'bt-slot--drop-hover');
    }
  });
}
function initDragDrop() {
  document.querySelectorAll('#player-field .bt-slot').forEach((slot, i) => {
    slot.addEventListener('dragover', (e) => { e.preventDefault(); });
    slot.addEventListener('dragenter', (e) => { e.preventDefault(); if (!battleData.playerField[i] || !battleData.playerField[i].alive) slot.classList.add('bt-slot--drop-hover'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('bt-slot--drop-hover'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault(); slot.classList.remove('bt-slot--drop-hover'); highlightDropZones(false);
      if (draggedHandIndex === null) return;
      if (battleData.playerField[i] && battleData.playerField[i].alive) { draggedHandIndex = null; return; }
      deployCard(draggedHandIndex, i);
      draggedHandIndex = null;
    });
  });
}

// ========================
// ANIMATIONS (same as battle.js)
// ========================

async function animateEvents(events) {
  for (const event of events) {
    let animDuration = 300;
    switch (event.type) {
      case 'deploy': animateDeploy('player', event.slot); animDuration = 500; break;
      case 'enemy_deploy': animateDeploy('enemy', event.slot); animDuration = 500; break;
      case 'attack': {
        const aSlot = event.attackerSlot ?? event.attackerIndex;
        const tSlot = event.targetSlot ?? event.targetIndex;
        if (event.side === 'player') { await animateAttackMovement('player', aSlot, 'enemy', tSlot); showDamageFloat('enemy', tSlot, event.damage); }
        else { await animateAttackMovement('enemy', aSlot, 'player', tSlot); showDamageFloat('player', tSlot, event.damage); }
        animDuration = 200; break;
      }
      case 'ability': case 'ability_damage': case 'ability_aoe': case 'ability_drain': case 'ability_stun': case 'ability_debuff': {
        let abilityColor = 'rgba(204,68,255,0.5)';
        if (event.type === 'ability_damage' || event.type === 'ability_aoe') abilityColor = 'rgba(255,68,68,0.5)';
        const caster = findSlotByName(event.unit);
        if (caster) animateAbilityCast(caster.side, caster.slot, abilityColor);
        animDuration = 600; break;
      }
      case 'avatar_damage': {
        const avatarId = event.side === 'player' ? 'enemy-avatar-hp' : 'player-avatar-hp';
        const c = document.querySelector(`#${avatarId} .bt-avatar-circle`);
        if (c) { c.classList.add('bt-avatar-hit'); setTimeout(() => c.classList.remove('bt-avatar-hit'), 500); }
        animDuration = 400; break;
      }
      case 'ko': { const info = findSlotByName(event.unit); if (info) animateKO(info.side, info.slot); animDuration = 500; break; }
    }
    await sleep(animDuration);
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function getSlotElement(side, slotIndex) { return document.querySelector(`${side === 'player' ? '#player-field' : '#enemy-field'} .bt-slot[data-slot="${slotIndex}"]`); }
function findSlotByName(name) {
  if (!name || !battleData) return null;
  for (let i = 0; i < 3; i++) {
    const pu = battleData.playerField[i]; if (pu && pu.alive && pu.name === name) return { side: 'player', slot: i };
    const eu = battleData.enemyField[i]; if (eu && eu.alive && eu.name === name) return { side: 'enemy', slot: i };
  }
  for (let i = 0; i < 3; i++) {
    const pu = battleData.playerField[i]; if (pu && pu.name === name) return { side: 'player', slot: i };
    const eu = battleData.enemyField[i]; if (eu && eu.name === name) return { side: 'enemy', slot: i };
  }
  return null;
}
function showDamageFloat(side, slotIndex, damage) { const slot = getSlotElement(side, slotIndex); if (!slot) return; const f = document.createElement('div'); f.className = 'damage-float'; f.textContent = `-${damage}`; slot.appendChild(f); setTimeout(() => f.remove(), 1200); }
function showHealFloat(side, slotIndex, amount) { const slot = getSlotElement(side, slotIndex); if (!slot) return; const f = document.createElement('div'); f.className = 'heal-float'; f.textContent = `+${amount}`; slot.appendChild(f); setTimeout(() => f.remove(), 1200); }

async function animateAttackMovement(aSide, aSlot, tSide, tSlot) {
  const aEl = getSlotElement(aSide, aSlot); const tEl = getSlotElement(tSide, tSlot);
  if (!aEl || !tEl) return;
  const unitEl = aEl.querySelector('.bt-unit'); if (!unitEl) return;
  const aR = aEl.getBoundingClientRect(); const tR = tEl.getBoundingClientRect();
  const mx = ((tR.left + tR.width / 2) - (aR.left + aR.width / 2)) * 0.55;
  const my = ((tR.top + tR.height / 2) - (aR.top + aR.height / 2)) * 0.55;
  unitEl.style.transition = 'transform 0.2s ease-in'; unitEl.style.zIndex = '50'; unitEl.style.transform = `translate(${mx}px, ${my}px) scale(1.1)`;
  await sleep(200);
  unitEl.style.transition = 'transform 0.25s ease-out'; unitEl.style.transform = 'translate(0, 0) scale(1)';
  await sleep(250);
  unitEl.style.transition = ''; unitEl.style.zIndex = ''; unitEl.style.transform = '';
}

function animateAbilityCast(side, slotIndex, color) { const el = getSlotElement(side, slotIndex); if (!el) return; const unit = el.querySelector('.bt-unit'); if (!unit) return; unit.style.boxShadow = `0 0 25px ${color}, 0 0 50px ${color}`; unit.classList.add('ability-casting'); setTimeout(() => { unit.style.boxShadow = ''; unit.classList.remove('ability-casting'); }, 800); }
function animateDeploy(side, slotIndex) { const el = getSlotElement(side, slotIndex); if (!el) return; const unit = el.querySelector('.bt-unit'); if (!unit) return; unit.classList.add('deploy-anim'); setTimeout(() => unit.classList.remove('deploy-anim'), 500); }
function animateKO(side, slotIndex) { const el = getSlotElement(side, slotIndex); if (!el) return; const unit = el.querySelector('.bt-unit'); if (!unit) return; unit.classList.add('ko-anim'); }
function screenFlash() { const flash = document.getElementById('screen-flash'); if (!flash) return; flash.classList.remove('hidden'); flash.classList.add('flash-active'); setTimeout(() => { flash.classList.remove('flash-active'); flash.classList.add('hidden'); }, 400); }

// ========================
// RESULT
// ========================

async function showResult() {
  const overlay = document.getElementById('battle-result');
  const title = document.getElementById('result-title');
  const rewards = document.getElementById('result-rewards');
  overlay.classList.remove('hidden');

  // Use pvpResult from server if available
  const result = pvpResult?.result || battleData.result;
  const reward = pvpResult?.reward || 0;

  if (result === 'victory') { title.textContent = 'VICTOIRE !'; title.style.color = '#22cc44'; rewards.innerHTML = `+${reward} CR`; screenFlash(); }
  else if (result === 'draw') { title.textContent = 'EGALITE'; title.style.color = '#ccaa22'; rewards.textContent = 'Pas de recompense'; }
  else { title.textContent = 'DEFAITE...'; title.style.color = '#cc2222'; rewards.textContent = reward > 0 ? `+${reward} CR` : ''; }
}

function leaveBattle() {
  sessionStorage.removeItem('pvpBattleData');
  sessionStorage.removeItem('opponentName');
  sessionStorage.removeItem('battleMode');
  window.location.href = '/combat';
}

// Right-click ability
document.getElementById('player-field').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const slot = e.target.closest('.bt-slot'); if (!slot) return;
  const slotIndex = parseInt(slot.dataset.slot);
  const unit = battleData.playerField[slotIndex];
  if (!unit || !unit.alive || unit.usedAbility || unit.stunned) return;
  const crystalCost = unit.crystal_cost || 1;
  if ((battleData.playerCrystal || 0) < crystalCost) return;
  selectedFieldSlot = slotIndex;
  actionMode = 'select_ability_target';
  renderAll();
});

init();
