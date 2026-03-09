// battle.js — Deck-based combat with hand/field/energy + 3 mechanics

let battleData = null;
let opponentName = '???';
let isAnimating = false;

// Action mode: null, 'select_deploy_slot', 'select_attack_target', 'select_ability_target', 'select_item_target'
let actionMode = null;
let selectedHandIndex = null;
let selectedFieldSlot = null;
let selectedItemIndex = null;
let actionPanelSlot = null;
let slotClickedThisFrame = false;
let draggedHandIndex = null;

function init() {
  // Check for test battle from admin panel
  const testStored = sessionStorage.getItem('testBattle');
  if (testStored) {
    battleData = JSON.parse(testStored);
    opponentName = 'MODE TEST';
    sessionStorage.removeItem('testBattle');
    // Store as regular battle data so reconnect works
    sessionStorage.setItem('deckBattleData', JSON.stringify(battleData));
    sessionStorage.setItem('opponentName', opponentName);
  } else {
    const stored = sessionStorage.getItem('deckBattleData');
    opponentName = sessionStorage.getItem('opponentName') || '???';
    if (!stored) {
      window.location.href = '/combat';
      return;
    }
    battleData = JSON.parse(stored);
  }

  document.getElementById('opponent-name').textContent = `VS ${opponentName}`;

  // Show test mode badge
  if (battleData.testMode) {
    const topbar = document.querySelector('.bt-topbar-center');
    if (topbar) {
      const badge = document.createElement('span');
      badge.className = 'bt-test-badge';
      badge.textContent = 'TEST';
      topbar.appendChild(badge);
    }
  }

  renderAll();
  initDragDrop();
}

// ========================
// RENDERING
// ========================

function renderAll() {
  if (!battleData) return;

  renderTurnInfo();
  renderEnemyHand();
  renderEnemyField();
  renderPlayerField();
  renderHand();

  if (battleData.result) {
    setTimeout(() => showResult(), 600);
  }
}

function renderEnemyHand() {
  const container = document.getElementById('enemy-hand-row');
  if (!container) return;
  const count = battleData.enemyHandCount || 0;
  if (count === 0) { container.innerHTML = ''; return; }
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<div class="bt-enemy-card-back" style="animation-delay:${i * 0.05}s"></div>`;
  }
  container.innerHTML = html;
}

function renderBattery(bodyId, current, max, type) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  const maxSegs = type === 'energy' ? 10 : Math.ceil(max);
  const filled = Math.min(Math.floor(current), maxSegs);
  const partial = type === 'crystal' ? (current - filled) : 0;

  let html = '';
  for (let i = maxSegs - 1; i >= 0; i--) {
    const isFilled = i < filled;
    const isPartial = (type === 'crystal' && i === filled && partial > 0);
    const isOverMax = (type === 'energy' && i >= max);
    let cls = 'bt-battery-seg';
    if (isFilled) cls += ' bt-battery-seg--filled';
    if (isPartial) cls += ' bt-battery-seg--partial';
    if (isOverMax) cls += ' bt-battery-seg--locked';
    const pStyle = isPartial ? ` style="--partial:${Math.round(partial * 100)}%"` : '';
    html += `<div class="${cls}"${pStyle}></div>`;
  }
  body.innerHTML = html;
}

function renderTurnInfo() {
  document.getElementById('battle-turn').textContent = `TOUR ${battleData.turn}`;
  document.getElementById('player-deck-count').textContent = battleData.playerDeckCount;
  document.getElementById('enemy-deck-count').textContent = battleData.enemyDeckCount;

  // Battery gauges
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

  // Mana carry-over indicator
  const manaCarry = battleData.playerBonusMana || 0;
  const manaCarryEl = document.getElementById('mana-carry-indicator');
  const manaCarryCount = document.getElementById('mana-carry-count');
  if (manaCarryEl) {
    if (manaCarry > 0) {
      manaCarryEl.classList.remove('hidden');
      manaCarryCount.textContent = manaCarry;
    } else {
      manaCarryEl.classList.add('hidden');
    }
  }

  // Opponent HP avatar
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
        <div class="bt-avatar-hpbar">
          <div class="bt-avatar-hpbar-fill" style="width:${eHpPct}%;background:${eHpColor}"></div>
        </div>
        <div class="bt-avatar-hp-text">\u2764\uFE0F ${enemyHp}/${enemyMaxHp}</div>
      </div>
    `;
  }

  if (playerAvatarEl) {
    const pHpPct = Math.round((playerHp / playerMaxHp) * 100);
    const pHpColor = pHpPct > 50 ? '#22cc44' : pHpPct > 25 ? '#ccaa22' : '#cc2222';
    playerAvatarEl.innerHTML = `
      <div class="bt-avatar-circle bt-avatar-player">
        <div class="bt-avatar-icon">\uD83D\uDC64</div>
        <div class="bt-avatar-hpbar">
          <div class="bt-avatar-hpbar-fill" style="width:${pHpPct}%;background:${pHpColor}"></div>
        </div>
        <div class="bt-avatar-hp-text">\u2764\uFE0F ${playerHp}/${playerMaxHp}</div>
      </div>
    `;
  }

  document.getElementById('end-turn-btn').disabled = !!battleData.result;
}

function renderFieldSlot(unit, slotIndex, side) {
  if (!unit || !unit.alive) {
    return `<div class="bt-slot-empty">VIDE</div>`;
  }

  const r = RARITY_COLORS[unit.rarity] || { color: '#888' };
  const hpPercent = Math.round((unit.currentHp / unit.maxHp) * 100);
  const hpColor = hpPercent > 50 ? '#22cc44' : hpPercent > 25 ? '#ccaa22' : '#cc2222';
  const emoji = unit.emoji || ELEMENT_ICONS[unit.element] || '?';
  const isSelected = (side === 'player' && selectedFieldSlot === slotIndex && actionMode !== 'select_deploy_slot');
  const isTarget = (side === 'enemy' && actionMode === 'select_attack_target') ||
                   (side === 'enemy' && actionMode === 'select_ability_target') ||
                   (actionMode === 'select_item_target');

  const totalAtk = unit.effectiveStats.attack + (unit.buffAtk || 0) + (unit.permanentBonusAtk || 0);
  const totalDef = unit.effectiveStats.defense + (unit.buffDef || 0) + (unit.permanentBonusDef || 0);

  let statusIcons = '';
  if (unit.poisonDotTurns > 0) statusIcons += `<span class="bt-status-icon bt-status-poison" title="Poison (${unit.poisonDotTurns} tours)"><img src="/img/poison-badge.png" class="bt-poison-img" alt="poison">${unit.poisonDotTurns}</span>`;
  if (unit.stunned) statusIcons += '<span class="bt-status-icon bt-status-stun">\uD83D\uDCAB</span>';
  if (unit.shield > 0) statusIcons += `<span class="bt-status-icon bt-status-shield">\uD83D\uDEE1${unit.shield}</span>`;
  if (unit.marked > 0) statusIcons += '<span class="bt-status-icon bt-status-mark">\uD83C\uDFAF</span>';
  if (unit.reactiveArmor > 0) statusIcons += '<span class="bt-status-icon bt-status-reactive">\uD83E\uDD80</span>';
  if (unit.ralliement) statusIcons += '<span class="bt-status-icon bt-status-rally">\u2694</span>';

  // Rank synergy indicator
  let rankBadge = '';
  if (unit.rankBonus) {
    if (unit.rankBonus === 'center') {
      rankBadge = '<span class="bt-rank-badge bt-rank-badge--def">\uD83D\uDEE1+1</span>';
    } else {
      rankBadge = '<span class="bt-rank-badge bt-rank-badge--atk">\u2694\uFE0F+1</span>';
    }
  }

  // Combo kill indicator
  let comboBadge = '';
  if (unit.comboKillBonusAtk > 0) {
    comboBadge = '<span class="bt-combo-badge">\uD83D\uDD25+1</span>';
  }

  const attackedClass = side === 'player' && battleData.attackedThisTurn?.includes(slotIndex) ? 'bt-attacked' : '';
  const sicknessClass = unit.justDeployed ? 'bt-sickness' : '';

  const abilityHtml = unit.ability_name ? `
    <div class="bt-unit-ability ${unit.usedAbility ? 'bt-ability-used' : ''}">
      <span class="bt-ability-label">\u2726 ${unit.ability_name}</span>
      ${unit.ability_desc ? `<span class="bt-ability-desc">${unit.ability_desc}</span>` : ''}
    </div>` : '';

  const passiveHtml = unit.passive_desc ? `
    <div class="bt-unit-passive">
      <span class="bt-passive-label">\uD83D\uDD38 ${unit.passive_desc}</span>
    </div>` : '';

  const manaCost = unit.mana_cost || unit.manaCost || '?';

  return `
    <div class="bt-unit ${isSelected ? 'bt-selected' : ''} ${isTarget ? 'bt-targetable' : ''} ${attackedClass} ${sicknessClass}"
         style="border-color: ${r.color}" data-slot="${slotIndex}" data-side="${side}">
      <div class="bt-unit-type">${unit.type || ''}</div>
      <div class="bt-unit-mana">\u26A1${manaCost}</div>
      ${unit.justDeployed ? '<div class="bt-sickness-badge">\uD83D\uDCA4</div>' : ''}
      ${rankBadge}
      ${comboBadge}
      <div class="bt-unit-emoji">${emoji}</div>
      <div class="bt-unit-name">${unit.name}</div>
      <div class="bt-unit-hp">
        <div class="bt-unit-hpbar">
          <div class="bt-unit-hpbar-fill" style="width:${hpPercent}%;background:${hpColor}"></div>
        </div>
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
    </div>
  `;
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
    const isObj = card.type === 'objet';
    const canAfford = card.mana_cost <= battleData.playerEnergy;
    const isSelected = selectedHandIndex === i;
    const isForced = battleData.forcedPlayerCardHandId && card.handId === battleData.forcedPlayerCardHandId;
    const isForcedLocked = battleData.forcedPlayerCardHandId && !isForced && !isObj;
    const isDraggable = !isObj && canAfford && !isForcedLocked;

    return `
      <div class="bt-card ${isObj ? 'bt-card--objet' : ''} ${canAfford && !isForcedLocked ? '' : 'bt-card--expensive'} ${isSelected ? 'bt-card--selected' : ''} ${isForced ? 'bt-card--forced' : ''}"
           style="border-color: ${r.color}"
           onclick="clickHandCard(${i})"
           ${isDraggable ? `draggable="true" ondragstart="onCardDragStart(event, ${i})" ondragend="onCardDragEnd(event)"` : ''}
           title="${card.name}${isObj ? ' (Objet: ' + card.ability_desc + ')' : ''}">
        <div class="bt-card-type-badge">${card.type || ''}</div>
        <div class="bt-card-cost">\u26A1${card.mana_cost}</div>
        <div class="bt-card-emoji">${emoji}</div>
        <div class="bt-card-name">${card.name}</div>
        ${isObj ? `<div class="bt-card-obj-desc">${card.ability_desc || ''}</div>` : `
          <div class="bt-card-stats">
            <span class="bt-card-stat-atk">\u2694\uFE0F ${card.effectiveStats.attack}</span>
            <span class="bt-card-stat-def">\uD83D\uDEE1\uFE0F ${card.effectiveStats.defense}</span>
            <span class="bt-card-stat-hp">\u2764\uFE0F ${card.effectiveStats.hp}</span>
          </div>
          ${card.ability_name && card.ability_name !== 'Aucun' ? `<div class="bt-card-ability">\u2726 ${card.ability_desc || card.ability_name}</div>` : ''}
          ${card.passive_desc ? `<div class="bt-card-passive">\uD83D\uDD38 ${card.passive_desc}</div>` : ''}
        `}
      </div>
    `;
  }).join('');
}

function getItemTarget(item) {
  if (!item) return null;
  const healItems = ['Soin mineur', 'Herboristerie', 'Premiers soins', 'Miracle'];
  const buffAllyItems = ['Rage chimique', 'Protection', 'Enchantement'];
  const enemyItems = ['Lancer', 'Lancer precis', 'Aveuglement', 'Empoisonnement', 'Foudroiement'];
  const teamItems = ['Soin de groupe', 'Cri de guerre'];
  const aoeItems = ['Destruction'];

  if (healItems.includes(item.ability_name) || buffAllyItems.includes(item.ability_name)) return 'ally';
  if (enemyItems.includes(item.ability_name)) return 'enemy';
  if (teamItems.includes(item.ability_name) || aoeItems.includes(item.ability_name)) return 'team';
  return 'enemy';
}

// ========================
// CLICK HANDLERS
// ========================

function cancelAction() {
  hideActionPanel();
  actionMode = null;
  selectedHandIndex = null;
  selectedFieldSlot = null;
  selectedItemIndex = null;
  renderAll();
}

function showActionPanel(slotIndex, unit, crystalCost, canAttack, canAbility, hasSickness, hasEnergy) {
  actionPanelSlot = slotIndex;
  selectedFieldSlot = slotIndex;
  renderAll();

  const panel = document.getElementById('bt-actions');
  const unitInfo = document.getElementById('bt-actions-unit');
  const buttons = document.getElementById('bt-actions-buttons');

  const emoji = unit.emoji || ELEMENT_ICONS[unit.element] || '?';
  const hpPercent = Math.round((unit.currentHp / unit.maxHp) * 100);
  const hpColor = hpPercent > 50 ? '#22cc44' : hpPercent > 25 ? '#ccaa22' : '#cc2222';

  unitInfo.innerHTML = `
    <div class="bt-actions-header">
      <span class="bt-actions-unit-emoji">${emoji}</span>
      <div class="bt-actions-header-info">
        <div class="bt-actions-unit-name">${unit.name}</div>
        <div class="bt-actions-unit-stats">\u2694\uFE0F${unit.attack} \uD83D\uDEE1\uFE0F${unit.defense} \u2764\uFE0F${unit.currentHp}/${unit.maxHp}</div>
      </div>
    </div>
  `;

  let atkStatus = '';
  if (hasSickness) atkStatus = '\uD83D\uDCA4 Vient d\'etre posee';
  else if (!hasEnergy) atkStatus = '\u26A1 Pas assez d\'energie';
  else if (battleData.attackedThisTurn?.includes(slotIndex)) atkStatus = '\u2713 Deja attaque';

  let abilityStatus = '';
  if (unit.usedAbility) abilityStatus = '\u2713 Deja utilisee';
  else if ((battleData.playerCrystal || 0) < crystalCost) abilityStatus = 'Pas assez de crystal';

  buttons.innerHTML = `
    <button class="bt-action-btn bt-action-btn--attack ${!canAttack ? 'disabled' : ''}"
            onclick="actionAttack(event)" ${!canAttack ? 'disabled' : ''}>
      <span class="bt-action-icon">\u2694\uFE0F</span>
      <div class="bt-action-info">
        <span class="bt-action-label">ATTAQUER</span>
        <span class="bt-action-cost">\u26A1 1 energie</span>
        ${atkStatus ? `<span class="bt-action-status">${atkStatus}</span>` : ''}
      </div>
    </button>
    <button class="bt-action-btn bt-action-btn--ability ${!canAbility ? 'disabled' : ''}"
            onclick="actionAbility(event)" ${!canAbility ? 'disabled' : ''}>
      <span class="bt-action-icon">\u2726</span>
      <div class="bt-action-info">
        <span class="bt-action-label">${unit.ability_name || 'POUVOIR'}</span>
        <span class="bt-action-cost">\uD83D\uDC8E ${crystalCost} crystal</span>
        ${unit.ability_desc ? `<span class="bt-action-desc">${unit.ability_desc}</span>` : ''}
        ${abilityStatus ? `<span class="bt-action-status">${abilityStatus}</span>` : ''}
      </div>
    </button>
    ${unit.passive_desc ? `<div class="bt-actions-passive">\uD83D\uDD38 Passif : ${unit.passive_desc}</div>` : ''}
  `;

  panel.classList.remove('hidden');
}

function hideActionPanel() {
  document.getElementById('bt-actions').classList.add('hidden');
  actionPanelSlot = null;
}

function actionAttack(e) {
  e.stopPropagation();
  hideActionPanel();
  actionMode = 'select_attack_target';
  renderAll();
}

function actionAbility(e) {
  e.stopPropagation();
  hideActionPanel();
  // Pines Controle Mental : pas besoin de cible sur le terrain, activation directe
  const unit = battleData.playerField[actionPanelSlot || selectedFieldSlot];
  if (unit && unit.ability_name === 'Controle Mental') {
    useAbility(selectedFieldSlot, null);
    return;
  }
  actionMode = 'select_ability_target';
  renderAll();
}

function clickHandCard(index) {
  if (isAnimating || battleData.result) return;
  const card = battleData.playerHand[index];
  if (!card || card.mana_cost > battleData.playerEnergy) return;

  // Controle Mental ennemi : seule la carte forcee peut etre posee
  if (battleData.forcedPlayerCardHandId && card.type !== 'objet' && card.handId !== battleData.forcedPlayerCardHandId) return;

  if (card.type === 'objet') {
    const targetType = getItemTarget(card);
    if (targetType === 'team') { useItem(index, null, null); return; }
    selectedItemIndex = index;
    selectedHandIndex = index;
    actionMode = 'select_item_target';
  } else {
    selectedHandIndex = index;
    actionMode = 'select_deploy_slot';
  }
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

function onCardDragEnd(event) {
  event.target.classList.remove('bt-card--dragging');
  draggedHandIndex = null;
  highlightDropZones(false);
}

function highlightDropZones(show) {
  const playerSlots = document.querySelectorAll('#player-field .bt-slot');
  playerSlots.forEach((slot, i) => {
    if (show) {
      const fieldUnit = battleData.playerField[i];
      const isEmpty = !fieldUnit || !fieldUnit.alive;
      slot.classList.toggle('bt-slot--drop-target', isEmpty);
      slot.classList.toggle('bt-slot--drop-invalid', !isEmpty);
    } else {
      slot.classList.remove('bt-slot--drop-target', 'bt-slot--drop-invalid', 'bt-slot--drop-hover');
    }
  });
}

function initDragDrop() {
  const playerSlots = document.querySelectorAll('#player-field .bt-slot');
  playerSlots.forEach((slot, i) => {
    slot.addEventListener('dragover', (e) => {
      e.preventDefault();
      const fieldUnit = battleData.playerField[i];
      const isEmpty = !fieldUnit || !fieldUnit.alive;
      e.dataTransfer.dropEffect = (isEmpty && draggedHandIndex !== null) ? 'move' : 'none';
    });
    slot.addEventListener('dragenter', (e) => {
      e.preventDefault();
      const fieldUnit = battleData.playerField[i];
      if (!fieldUnit || !fieldUnit.alive) slot.classList.add('bt-slot--drop-hover');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('bt-slot--drop-hover'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('bt-slot--drop-hover');
      highlightDropZones(false);
      if (draggedHandIndex === null) return;
      const fieldUnit = battleData.playerField[i];
      if (fieldUnit && fieldUnit.alive) { draggedHandIndex = null; return; }
      const handIndex = draggedHandIndex;
      draggedHandIndex = null;
      deployCard(handIndex, i);
    });
  });
}

function clickFieldSlot(side, slotIndex) {
  if (isAnimating || battleData.result) return;
  slotClickedThisFrame = true;

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
    const target = battleData.enemyField[slotIndex];
    if (!target || !target.alive) return;
    useAbility(selectedFieldSlot, slotIndex);
    return;
  }
  if (actionMode === 'select_item_target') {
    const item = battleData.playerHand[selectedItemIndex];
    const targetType = getItemTarget(item);
    if (targetType === 'ally' && side === 'player') {
      const target = battleData.playerField[slotIndex];
      if (!target || !target.alive) return;
      useItem(selectedItemIndex, slotIndex, 'player');
      return;
    }
    if (targetType === 'enemy' && side === 'enemy') {
      const target = battleData.enemyField[slotIndex];
      if (!target || !target.alive) return;
      useItem(selectedItemIndex, slotIndex, 'enemy');
      return;
    }
    return;
  }

  if (side === 'player') {
    const unit = battleData.playerField[slotIndex];
    if (!unit || !unit.alive) return;
    if (actionPanelSlot === slotIndex) { hideActionPanel(); cancelAction(); return; }
    if (selectedFieldSlot === slotIndex && actionMode) { cancelAction(); return; }
    hideActionPanel();
    if (unit.stunned) return;

    const hasSickness = unit.justDeployed;
    const enemyAlive = battleData.enemyField.some(u => u && u.alive);
    const hasEnergy = battleData.playerEnergy >= 1;
    const canAttack = !battleData.attackedThisTurn?.includes(slotIndex) && !hasSickness && hasEnergy && enemyAlive;
    const crystalCost = unit.crystal_cost || 1;
    const needsEnemyTarget = unit.ability_name !== 'Controle Mental';
    const canAbility = !unit.usedAbility && (battleData.playerCrystal || 0) >= crystalCost && (enemyAlive || !needsEnemyTarget);
    showActionPanel(slotIndex, unit, crystalCost, canAttack, canAbility, hasSickness, hasEnergy);
  }
}

function clickEnemyAvatar() {
  if (isAnimating || battleData.result) return;
  if (actionMode === 'select_attack_target') {
    if (battleData.enemyField.some(u => u && u.alive)) return;
    attackAvatar(selectedFieldSlot);
    return;
  }
  if (actionMode === 'select_ability_target') {
    if (battleData.enemyField.some(u => u && u.alive)) return;
    useAbilityOnAvatar(selectedFieldSlot);
  }
}

// ========================
// API ACTIONS
// ========================

async function attackAvatar(fieldSlot) {
  if (isAnimating) return;
  isAnimating = true;
  try {
    const res = await fetch('/api/battle/attack-avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ battleId: battleData.battleId, fieldSlot }) });
    const data = await res.json();
    if (!res.ok) { isAnimating = false; return; }
    await animateEvents(data.events);
    updateBattleData(data);
  } catch { /* */ }
  cancelAction();
  isAnimating = false;
}

async function useAbilityOnAvatar(fieldSlot) {
  if (isAnimating) return;
  isAnimating = true;
  try {
    const res = await fetch('/api/battle/use-ability-avatar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ battleId: battleData.battleId, fieldSlot }) });
    const data = await res.json();
    if (!res.ok) { isAnimating = false; return; }
    await animateEvents(data.events);
    updateBattleData(data);
  } catch { /* */ }
  cancelAction();
  isAnimating = false;
}

async function deployCard(handIndex, fieldSlot) {
  if (isAnimating) return;
  isAnimating = true;
  try {
    const res = await fetch('/api/battle/deploy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ battleId: battleData.battleId, handIndex, fieldSlot }) });
    const data = await res.json();
    if (!res.ok) { isAnimating = false; return; }
    await animateEvents(data.events);
    updateBattleData(data);
  } catch { /* */ }
  cancelAction();
  isAnimating = false;
}

async function attackCard(fieldSlot, targetSlot) {
  if (isAnimating) return;
  isAnimating = true;
  try {
    const res = await fetch('/api/battle/attack-card', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ battleId: battleData.battleId, fieldSlot, targetSlot }) });
    const data = await res.json();
    if (!res.ok) { isAnimating = false; return; }
    await animateEvents(data.events);
    updateBattleData(data);
  } catch { /* */ }
  cancelAction();
  isAnimating = false;
}

async function useAbility(fieldSlot, targetSlot) {
  if (isAnimating) return;
  isAnimating = true;
  try {
    const res = await fetch('/api/battle/use-ability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ battleId: battleData.battleId, fieldSlot, targetSlot }) });
    const data = await res.json();
    if (!res.ok) { isAnimating = false; return; }
    await animateEvents(data.events);
    updateBattleData(data);
    // Pines Controle Mental : check if we need to show the card selection modal
    const pinesEvent = data.events?.find(e => e.pinesReveal);
    if (pinesEvent) {
      await showPinesChoiceModal(pinesEvent.pinesReveal);
    }
  } catch { /* */ }
  cancelAction();
  isAnimating = false;
}

// Pines: Controle Mental — modal to choose which enemy card to force
function showPinesChoiceModal(cards) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('pines-modal-overlay');
    const container = document.getElementById('pines-cards-container');
    container.innerHTML = '';

    cards.forEach(card => {
      const div = document.createElement('div');
      div.className = `pines-card rarity-${card.rarity}`;
      div.innerHTML = `
        <div class="pines-card-emoji">${card.emoji}</div>
        <div class="pines-card-name">${card.name}</div>
        <div class="pines-card-stats">\u2694\uFE0F${card.attack} \uD83D\uDEE1\uFE0F${card.defense} \u2764\uFE0F${card.hp}</div>
        ${card.ability_name && card.ability_name !== 'Aucun' ? `<div class="pines-card-ability">\u2726 ${card.ability_name}</div>` : ''}
        <div class="pines-card-mana">\u26A1 ${card.mana_cost} mana</div>
      `;
      div.onclick = async () => {
        overlay.classList.add('hidden');
        try {
          const res = await fetch('/api/battle/pines-choose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ battleId: battleData.battleId, chosenHandId: card.handId })
          });
          const data = await res.json();
          if (res.ok) {
            await animateEvents(data.events);
            updateBattleData(data);
          }
        } catch { /* */ }
        resolve();
      };
      container.appendChild(div);
    });

    overlay.classList.remove('hidden');
  });
}

async function useItem(handIndex, targetSlot, targetSide) {
  if (isAnimating) return;
  isAnimating = true;
  try {
    const res = await fetch('/api/battle/use-item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ battleId: battleData.battleId, handIndex, targetSlot, targetSide }) });
    const data = await res.json();
    if (!res.ok) { isAnimating = false; return; }
    await animateEvents(data.events);
    updateBattleData(data);
  } catch { /* */ }
  cancelAction();
  isAnimating = false;
}

async function endTurn() {
  if (isAnimating || battleData.result) return;
  isAnimating = true;
  document.getElementById('end-turn-btn').disabled = true;
  cancelAction();
  try {
    const res = await fetch('/api/battle/end-turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ battleId: battleData.battleId }) });
    const data = await res.json();
    if (!res.ok) { isAnimating = false; return; }
    await animateEvents(data.events);
    updateBattleData(data);
  } catch { /* */ }
  document.getElementById('end-turn-btn').disabled = !!battleData.result;
  isAnimating = false;
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
  battleData.playerBonusMana = data.playerBonusMana || 0;
  battleData.playerKillsThisTurn = data.playerKillsThisTurn || 0;
  battleData.comboKillActive = data.comboKillActive || false;
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
  sessionStorage.setItem('deckBattleData', JSON.stringify(battleData));
  renderAll();
}

// ========================
// ANIMATIONS
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
        animDuration = 200;
        break;
      }
      case 'ability': case 'ability_damage': case 'ability_aoe': case 'ability_drain': case 'ability_stun': case 'ability_debuff': {
        let abilityColor = 'rgba(204,68,255,0.5)';
        if (event.type === 'ability_damage' || event.type === 'ability_aoe') abilityColor = 'rgba(255,68,68,0.5)';
        if (event.type === 'ability_stun') abilityColor = 'rgba(255,204,0,0.5)';
        if (event.type === 'ability_drain') abilityColor = 'rgba(170,68,255,0.5)';
        const caster = findSlotByName(event.unit);
        if (caster) animateAbilityCast(caster.side, caster.slot, abilityColor);
        if (event.target) { const tgt = findSlotByName(event.target); if (tgt) { setTimeout(() => animateAbilityHit(tgt.side, tgt.slot, abilityColor), 300); if (event.damage) setTimeout(() => showDamageFloat(tgt.side, tgt.slot, event.damage), 400); } }
        animDuration = 600; break;
      }
      case 'ability_heal': case 'ability_team_heal': {
        const healColor = 'rgba(68,255,68,0.5)';
        const healer = findSlotByName(event.unit);
        if (healer) animateAbilityCast(healer.side, healer.slot, healColor);
        if (event.type === 'ability_heal' && event.target) { const tgt = findSlotByName(event.target); if (tgt) { animateAbilityHit(tgt.side, tgt.slot, healColor); showHealFloat(tgt.side, tgt.slot, event.heal); } }
        else if (event.type === 'ability_team_heal' && healer) { const field = healer.side === 'player' ? battleData.playerField : battleData.enemyField; for (let i = 0; i < 3; i++) { if (field[i] && field[i].alive) { animateAbilityHit(healer.side, i, healColor); showHealFloat(healer.side, i, event.heal); } } }
        animDuration = 500; break;
      }
      case 'ability_poison': { const c = findSlotByName(event.unit); const t = findSlotByName(event.target); if (c) animateAbilityCast(c.side, c.slot, 'rgba(170,68,255,0.5)'); if (t) { animateAbilityHit(t.side, t.slot, 'rgba(170,68,255,0.5)'); showStatusFloat(t.side, t.slot, '\u2620', '#aa44ff'); } animDuration = 500; break; }
      case 'ability_mark': { const t = findSlotByName(event.target); if (t) { animateAbilityHit(t.side, t.slot, 'rgba(255,170,0,0.5)'); showStatusFloat(t.side, t.slot, '\uD83C\uDFAF', '#ffaa00'); } animDuration = 500; break; }
      case 'ability_sacrifice': { const c = findSlotByName(event.unit); const t = findSlotByName(event.target); if (c) { showDamageFloat(c.side, c.slot, event.selfDamage); animateAbilityCast(c.side, c.slot, 'rgba(204,51,51,0.5)'); } if (t) showDamageFloat(t.side, t.slot, event.targetDamage); animDuration = 500; break; }
      case 'stunned': { const info = findSlotByName(event.unit); if (info) showStatusFloat(info.side, info.slot, '\uD83D\uDCAB', '#ffcc00'); break; }
      case 'ko': { const info = findSlotByName(event.unit); if (info) animateKO(info.side, info.slot); animDuration = 500; break; }
      case 'revive': { const info = findSlotByName(event.unit); if (info) animateAbilityHit(info.side, info.slot, 'rgba(255,255,100,0.6)'); break; }
      case 'poison_tick': { const info = findSlotByName(event.unit); if (info) { showDamageFloat(info.side, info.slot, event.damage); showStatusFloat(info.side, info.slot, '\u2620', '#aa44ff'); } break; }
      case 'grace_survive': { const info = findSlotByName(event.unit); if (info) animateAbilityHit(info.side, info.slot, 'rgba(255,255,100,0.6)'); break; }
      case 'item_heal': { const t = findSlotByName(event.target); if (t) { animateAbilityHit(t.side, t.slot, 'rgba(68,255,68,0.5)'); showHealFloat(t.side, t.slot, event.heal); } break; }
      case 'item_damage': case 'item_aoe': { const t = findSlotByName(event.target); if (t) { animateAbilityHit(t.side, t.slot, 'rgba(255,68,68,0.5)'); showDamageFloat(t.side, t.slot, event.damage); } break; }
      case 'avatar_damage': { const avatarId = event.side === 'player' ? 'enemy-avatar-hp' : 'player-avatar-hp'; const c = document.querySelector(`#${avatarId} .bt-avatar-circle`); if (c) { c.classList.add('bt-avatar-hit'); setTimeout(() => c.classList.remove('bt-avatar-hit'), 500); } animDuration = 400; break; }
      case 'combo_kill': { showComboKillBanner(); animDuration = 800; break; }
      case 'mana_carry': { showManaCarryEffect(); animDuration = 400; break; }
    }
    await sleep(animDuration);
  }
}

// ========================
// NEW MECHANIC ANIMATIONS
// ========================

function showComboKillBanner() {
  const banner = document.getElementById('combo-kill-banner');
  if (!banner) return;
  banner.classList.remove('hidden');
  banner.classList.add('combo-kill-active');
  screenFlash();
  setTimeout(() => { banner.classList.remove('combo-kill-active'); banner.classList.add('hidden'); }, 1500);
}

function showManaCarryEffect() {
  const indicator = document.getElementById('mana-carry-indicator');
  if (!indicator) return;
  indicator.classList.add('mana-carry-pulse');
  setTimeout(() => indicator.classList.remove('mana-carry-pulse'), 600);
}

// ========================
// VISUAL HELPERS
// ========================

function showDamageFloat(side, slotIndex, damage) {
  const slot = getSlotElement(side, slotIndex);
  if (!slot) return;
  const float = document.createElement('div');
  float.className = 'damage-float';
  float.textContent = `-${damage}`;
  slot.appendChild(float);
  setTimeout(() => float.remove(), 1200);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function getSlotElement(side, slotIndex) {
  const field = side === 'player' ? '#player-field' : '#enemy-field';
  return document.querySelector(`${field} .bt-slot[data-slot="${slotIndex}"]`);
}

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

async function animateAttackMovement(aSide, aSlot, tSide, tSlot) {
  const aEl = getSlotElement(aSide, aSlot); const tEl = getSlotElement(tSide, tSlot);
  if (!aEl || !tEl) return;
  const unitEl = aEl.querySelector('.bt-unit'); if (!unitEl) return;
  const aR = aEl.getBoundingClientRect(); const tR = tEl.getBoundingClientRect();
  const mx = ((tR.left + tR.width / 2) - (aR.left + aR.width / 2)) * 0.55;
  const my = ((tR.top + tR.height / 2) - (aR.top + aR.height / 2)) * 0.55;
  unitEl.style.transition = 'transform 0.2s ease-in'; unitEl.style.zIndex = '50'; unitEl.style.transform = `translate(${mx}px, ${my}px) scale(1.1)`;
  await sleep(200);
  animateImpact(tSide, tSlot);
  unitEl.style.transition = 'transform 0.25s ease-out'; unitEl.style.transform = 'translate(0, 0) scale(1)';
  await sleep(250);
  unitEl.style.transition = ''; unitEl.style.zIndex = ''; unitEl.style.transform = '';
}

function animateImpact(side, slotIndex) { const el = getSlotElement(side, slotIndex); if (!el) return; const unit = el.querySelector('.bt-unit'); if (!unit) return; unit.classList.add('impact-shake'); const flash = document.createElement('div'); flash.className = 'impact-flash'; unit.appendChild(flash); setTimeout(() => { unit.classList.remove('impact-shake'); flash.remove(); }, 400); }
function animateAbilityCast(side, slotIndex, color) { const el = getSlotElement(side, slotIndex); if (!el) return; const unit = el.querySelector('.bt-unit'); if (!unit) return; unit.style.boxShadow = `0 0 25px ${color}, 0 0 50px ${color}`; unit.classList.add('ability-casting'); setTimeout(() => { unit.style.boxShadow = ''; unit.classList.remove('ability-casting'); }, 800); }
function animateAbilityHit(side, slotIndex, color) { const el = getSlotElement(side, slotIndex); if (!el) return; const unit = el.querySelector('.bt-unit'); if (!unit) return; const flash = document.createElement('div'); flash.className = 'ability-hit-flash'; flash.style.background = color; unit.appendChild(flash); setTimeout(() => flash.remove(), 600); }
function showHealFloat(side, slotIndex, amount) { const slot = getSlotElement(side, slotIndex); if (!slot) return; const float = document.createElement('div'); float.className = 'heal-float'; float.textContent = `+${amount}`; slot.appendChild(float); setTimeout(() => float.remove(), 1200); }
function showStatusFloat(side, slotIndex, icon, color) { const slot = getSlotElement(side, slotIndex); if (!slot) return; const float = document.createElement('div'); float.className = 'status-float'; float.textContent = icon; float.style.color = color || '#fff'; slot.appendChild(float); setTimeout(() => float.remove(), 1200); }
function animateDeploy(side, slotIndex) { const el = getSlotElement(side, slotIndex); if (!el) return; const unit = el.querySelector('.bt-unit'); if (!unit) return; unit.classList.add('deploy-anim'); setTimeout(() => unit.classList.remove('deploy-anim'), 500); }
function animateKO(side, slotIndex) { const el = getSlotElement(side, slotIndex); if (!el) return; const unit = el.querySelector('.bt-unit'); if (!unit) return; unit.classList.add('ko-anim'); }
function screenFlash() { const flash = document.getElementById('screen-flash'); flash.classList.remove('hidden'); flash.classList.add('flash-active'); setTimeout(() => { flash.classList.remove('flash-active'); flash.classList.add('hidden'); }, 400); }

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

// Result
async function showResult() {
  if (battleData.testMode) {
    // Test mode: no rewards, just show result
    const overlay = document.getElementById('battle-result');
    const title = document.getElementById('result-title');
    const rewards = document.getElementById('result-rewards');
    overlay.classList.remove('hidden');
    title.textContent = battleData.result === 'victory' ? 'VICTOIRE !' : battleData.result === 'draw' ? 'EGALITE' : 'DEFAITE...';
    title.style.color = battleData.result === 'victory' ? '#22cc44' : battleData.result === 'draw' ? '#ccaa22' : '#cc2222';
    rewards.innerHTML = '<span style="color:#cc44ff">MODE TEST — Pas de recompense</span>';
    document.getElementById('result-btn').textContent = 'RETOUR ADMIN';
    return;
  }
  try {
    const res = await fetch('/api/battle/end', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ battleId: battleData.battleId }) });
    const data = await res.json();
    const overlay = document.getElementById('battle-result'); const box = document.getElementById('battle-result-box');
    const title = document.getElementById('result-title'); const rewards = document.getElementById('result-rewards');
    overlay.classList.remove('hidden');
    if (battleData.result === 'victory') { title.textContent = 'VICTOIRE !'; title.style.color = '#22cc44'; box.classList.add('result-victory'); rewards.innerHTML = `+${data.reward} CR`; screenFlash(); }
    else if (battleData.result === 'draw') { title.textContent = 'EGALITE'; title.style.color = '#ccaa22'; rewards.textContent = 'Pas de recompense'; }
    else { title.textContent = 'DEFAITE...'; title.style.color = '#cc2222'; box.classList.add('result-defeat'); rewards.textContent = data.reward > 0 ? `+${data.reward} CR` : ''; }
  } catch {
    document.getElementById('battle-result').classList.remove('hidden');
    document.getElementById('result-title').textContent = battleData.result === 'victory' ? 'VICTOIRE !' : battleData.result === 'draw' ? 'EGALITE' : 'DEFAITE...';
  }
}

function leaveBattle() {
  sessionStorage.removeItem('deckBattleData');
  sessionStorage.removeItem('opponentName');
  sessionStorage.removeItem('battleMode');
  if (battleData && battleData.testMode) {
    window.location.href = '/admin';
  } else {
    window.location.href = '/combat';
  }
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { cancelAction(); if (draggedHandIndex !== null) { draggedHandIndex = null; highlightDropZones(false); } } });
document.addEventListener('click', (e) => { if (slotClickedThisFrame) { slotClickedThisFrame = false; return; } if (actionPanelSlot !== null && !e.target.closest('#bt-actions') && !e.target.closest('.bt-slot')) { hideActionPanel(); cancelAction(); } });

init();
