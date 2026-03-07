// battle.js — Deck-based combat with hand/field/energy

let battleData = null;
let opponentName = '???';
let isAnimating = false;

// PVP mode
let isPvpMode = false;
let pvpSocket = null;
let isMyTurn = true;

// Action mode: null, 'select_deploy_slot', 'select_attack_target', 'select_ability_target', 'select_item_target'
let actionMode = null;
let selectedHandIndex = null;
let selectedFieldSlot = null;
let selectedItemIndex = null;
let actionPanelSlot = null;
let slotClickedThisFrame = false;
let draggedHandIndex = null;

function init() {
  const stored = sessionStorage.getItem('deckBattleData');
  opponentName = sessionStorage.getItem('opponentName') || '???';

  if (!stored) {
    window.location.href = '/combat';
    return;
  }

  battleData = JSON.parse(stored);
  document.getElementById('opponent-name').textContent = `VS ${opponentName}`;

  // Detect PVP mode
  const battleMode = sessionStorage.getItem('battleMode');
  if (battleMode === 'pvp') {
    isPvpMode = true;
    isMyTurn = battleData.myTurn !== false;
    initPvpSocket();
    document.getElementById('surrender-btn').classList.remove('hidden');
  }

  renderAll();
  initDragDrop();
  setTurnEnabled(isMyTurn);
}

// ========================
// PVP SOCKET
// ========================

function initPvpSocket() {
  pvpSocket = io();

  pvpSocket.on('pvp:reconnect', (data) => {
    // Server auto-reconnects on connect — update state
    updateBattleData(data);
    isMyTurn = data.myTurn;
    setTurnEnabled(isMyTurn);
    if (data.opponentName) {
      opponentName = data.opponentName;
      document.getElementById('opponent-name').textContent = `VS ${opponentName}`;
    }
  });

  pvpSocket.on('pvp:update', async (data) => {
    if (data.events && data.events.length > 0) {
      isAnimating = true;
      await animateEvents(data.events);
      isAnimating = false;
    }
    updateBattleData(data);
  });

  pvpSocket.on('pvp:your-turn', () => {
    // Signal only — data already received via pvp:update
    isMyTurn = true;
    setTurnEnabled(true);
    showTurnBanner('VOTRE TOUR');
  });

  pvpSocket.on('pvp:battle-end', (data) => {
    // Result and reward — events already received via pvp:update
    battleData.result = data.result;
    battleData.pvpReward = data.reward;
    isMyTurn = false;
    setTurnEnabled(false);
    renderAll();
    setTimeout(() => showPvpResult(data.result, data.reward), 600);
  });

  pvpSocket.on('pvp:opponent-disconnected', () => {
    showTurnBanner('ADVERSAIRE DECONNECTE...');
  });

  pvpSocket.on('pvp:opponent-reconnected', () => {
    showTurnBanner(isMyTurn ? 'VOTRE TOUR' : 'TOUR ADVERSE');
  });

  pvpSocket.on('pvp:error', (data) => {
    isAnimating = false;
    showInstruction(data.message || 'Erreur PVP');
  });
}

function setTurnEnabled(enabled) {
  if (!isPvpMode) return; // In IA mode, always enabled

  const handBar = document.getElementById('player-hand');
  const endBtn = document.getElementById('end-turn-btn');
  const playerField = document.getElementById('player-field');

  if (enabled) {
    handBar.classList.remove('pvp-disabled');
    playerField.classList.remove('pvp-disabled');
    endBtn.disabled = false;
    endBtn.classList.remove('pvp-disabled');
  } else {
    handBar.classList.add('pvp-disabled');
    playerField.classList.add('pvp-disabled');
    endBtn.disabled = true;
    endBtn.classList.add('pvp-disabled');
    // Cancel any ongoing action
    cancelAction();
  }
}

function showTurnBanner(text) {
  const banner = document.getElementById('pvp-turn-banner');
  if (!banner) return;
  banner.textContent = text;
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), 2000);
}

function showPvpResult(result, reward) {
  const overlay = document.getElementById('battle-result');
  const box = document.getElementById('battle-result-box');
  const title = document.getElementById('result-title');
  const rewards = document.getElementById('result-rewards');

  overlay.classList.remove('hidden');

  if (result === 'victory') {
    title.textContent = 'VICTOIRE !';
    title.style.color = '#22cc44';
    box.classList.add('result-victory');
    rewards.innerHTML = `+${reward} CR`;
    screenFlash();
  } else if (result === 'draw') {
    title.textContent = 'EGALITE';
    title.style.color = '#ccaa22';
    rewards.innerHTML = `+${reward} CR`;
  } else {
    title.textContent = 'DEFAITE...';
    title.style.color = '#cc2222';
    box.classList.add('result-defeat');
    rewards.innerHTML = reward > 0 ? `+${reward} CR` : '';
  }
}

function surrender() {
  if (!isPvpMode || !pvpSocket) return;
  if (confirm('Voulez-vous vraiment abandonner ?')) {
    pvpSocket.emit('pvp:surrender', { battleId: battleData.battleId });
  }
}

// ========================
// RENDERING
// ========================

function renderAll() {
  if (!battleData) return;

  renderTurnInfo();
  renderEnemyField();
  renderPlayerField();
  renderHand();
  renderInstruction();

  if (battleData.result) {
    setTimeout(() => showResult(), 600);
  }
}

function renderTurnInfo() {
  document.getElementById('battle-turn').textContent = `TOUR ${battleData.turn}`;
  document.getElementById('player-energy').textContent = battleData.playerEnergy;
  document.getElementById('player-max-energy').textContent = battleData.playerMaxEnergy;
  document.getElementById('player-deck-count').textContent = battleData.playerDeckCount;
  document.getElementById('enemy-energy').textContent = battleData.enemyEnergy;
  document.getElementById('enemy-max-energy').textContent = battleData.enemyMaxEnergy;
  document.getElementById('enemy-deck-count').textContent = battleData.enemyDeckCount;
  document.getElementById('enemy-hand-count').textContent = battleData.enemyHandCount;

  // Crystal gauges
  const pCrystal = battleData.playerCrystal || 0;
  const pMaxCrystal = battleData.playerMaxCrystal || 2;
  const eCrystal = battleData.enemyCrystal || 0;
  const eMaxCrystal = battleData.enemyMaxCrystal || 2;

  const pCrystalEl = document.getElementById('player-crystal-fill');
  const eCrystalEl = document.getElementById('enemy-crystal-fill');
  const pCrystalText = document.getElementById('player-crystal-text');
  const eCrystalText = document.getElementById('enemy-crystal-text');

  if (pCrystalEl) pCrystalEl.style.width = `${(pCrystal / pMaxCrystal) * 100}%`;
  if (eCrystalEl) eCrystalEl.style.width = `${(eCrystal / eMaxCrystal) * 100}%`;
  if (pCrystalText) pCrystalText.textContent = `${pCrystal.toFixed(1)}`;
  if (eCrystalText) eCrystalText.textContent = `${eCrystal.toFixed(1)}`;

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
        <div class="bt-avatar-icon">👤</div>
        <div class="bt-avatar-hpbar">
          <div class="bt-avatar-hpbar-fill" style="width:${eHpPct}%;background:${eHpColor}"></div>
        </div>
        <div class="bt-avatar-hp-text">❤️ ${enemyHp}/${enemyMaxHp}</div>
      </div>
    `;
  }

  if (playerAvatarEl) {
    const pHpPct = Math.round((playerHp / playerMaxHp) * 100);
    const pHpColor = pHpPct > 50 ? '#22cc44' : pHpPct > 25 ? '#ccaa22' : '#cc2222';
    playerAvatarEl.innerHTML = `
      <div class="bt-avatar-circle bt-avatar-player">
        <div class="bt-avatar-icon">👤</div>
        <div class="bt-avatar-hpbar">
          <div class="bt-avatar-hpbar-fill" style="width:${pHpPct}%;background:${pHpColor}"></div>
        </div>
        <div class="bt-avatar-hp-text">❤️ ${playerHp}/${playerMaxHp}</div>
      </div>
    `;
  }

  // Disable end turn if battle over
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
  const elemColor = ELEMENT_COLORS[unit.element] || '#00ff41';
  const elemIcon = ELEMENT_ICONS[unit.element] || '';
  const isSelected = (side === 'player' && selectedFieldSlot === slotIndex && actionMode !== 'select_deploy_slot');
  const isTarget = (side === 'enemy' && actionMode === 'select_attack_target') ||
                   (side === 'enemy' && actionMode === 'select_ability_target') ||
                   (actionMode === 'select_item_target');

  const totalAtk = unit.effectiveStats.attack + (unit.buffAtk || 0) + (unit.permanentBonusAtk || 0);
  const totalDef = unit.effectiveStats.defense + (unit.buffDef || 0) + (unit.permanentBonusDef || 0);

  let statusIcons = '';
  if (unit.poisoned > 0) statusIcons += '<span class="bt-status-icon bt-status-poison">☠</span>';
  if (unit.stunned) statusIcons += '<span class="bt-status-icon bt-status-stun">💫</span>';
  if (unit.shield > 0) statusIcons += `<span class="bt-status-icon bt-status-shield">🛡${unit.shield}</span>`;
  if (unit.marked > 0) statusIcons += '<span class="bt-status-icon bt-status-mark">🎯</span>';
  if (unit.reactiveArmor > 0) statusIcons += '<span class="bt-status-icon bt-status-reactive">🦀</span>';
  if (unit.poisonDotTurns > 0) statusIcons += `<span class="bt-status-icon bt-status-poison">☠${unit.poisonDotTurns}</span>`;
  if (unit.ralliement) statusIcons += '<span class="bt-status-icon bt-status-rally">⚔</span>';

  const attackedClass = side === 'player' && battleData.attackedThisTurn?.includes(slotIndex) ? 'bt-attacked' : '';
  const sicknessClass = unit.justDeployed ? 'bt-sickness' : '';

  const abilityHtml = unit.ability_name ? `
    <div class="bt-unit-ability ${unit.usedAbility ? 'bt-ability-used' : ''}">
      <span class="bt-ability-label">✦ ${unit.ability_name}</span>
      ${unit.ability_desc ? `<span class="bt-ability-desc">${unit.ability_desc}</span>` : ''}
    </div>` : '';

  const passiveHtml = unit.passive_desc ? `
    <div class="bt-unit-passive">
      <span class="bt-passive-label">🔸 ${unit.passive_desc}</span>
    </div>` : '';

  const manaCost = unit.mana_cost || unit.manaCost || '?';

  return `
    <div class="bt-unit ${isSelected ? 'bt-selected' : ''} ${isTarget ? 'bt-targetable' : ''} ${attackedClass} ${sicknessClass}"
         style="border-color: ${r.color}" data-slot="${slotIndex}" data-side="${side}">
      <div class="bt-unit-type">${unit.type || ''}</div>
      <div class="bt-unit-mana">⚡${manaCost}</div>
      ${unit.justDeployed ? '<div class="bt-sickness-badge">💤</div>' : ''}
      <div class="bt-unit-emoji">${emoji}</div>
      <div class="bt-unit-name">${unit.name}</div>
      <div class="bt-unit-hp">
        <div class="bt-unit-hpbar">
          <div class="bt-unit-hpbar-fill" style="width:${hpPercent}%;background:${hpColor}"></div>
        </div>
        <span class="bt-unit-hp-text" style="color:${hpColor}">${unit.currentHp}/${unit.maxHp}</span>
      </div>
      <div class="bt-unit-stats">
        <span class="bt-stat-atk">⚔️ ${totalAtk}</span>
        <span class="bt-stat-def">🛡️ ${totalDef}</span>
        <span class="bt-stat-hp">❤️ ${unit.currentHp}</span>
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
  // Update avatar targetable state
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
    const elemIcon = ELEMENT_ICONS[card.element] || '';
    const elemColor = ELEMENT_COLORS[card.element] || '#00ff41';

    const isDraggable = !isObj && canAfford;

    return `
      <div class="bt-card ${isObj ? 'bt-card--objet' : ''} ${canAfford ? '' : 'bt-card--expensive'} ${isSelected ? 'bt-card--selected' : ''}"
           style="border-color: ${r.color}"
           onclick="clickHandCard(${i})"
           ${isDraggable ? `draggable="true" ondragstart="onCardDragStart(event, ${i})" ondragend="onCardDragEnd(event)"` : ''}
           title="${card.name}${isObj ? ' (Objet: ' + card.ability_desc + ')' : ''}">
        <div class="bt-card-type-badge">${card.type || ''}</div>
        <div class="bt-card-cost">⚡${card.mana_cost}</div>
        <div class="bt-card-emoji">${emoji}</div>
        <div class="bt-card-name">${card.name}</div>
        ${isObj ? `<div class="bt-card-obj-desc">${card.ability_desc || ''}</div>` : `
          <div class="bt-card-stats">
            <span class="bt-card-stat-atk">⚔️ ${card.effectiveStats.attack}</span>
            <span class="bt-card-stat-def">🛡️ ${card.effectiveStats.defense}</span>
            <span class="bt-card-stat-hp">❤️ ${card.effectiveStats.hp}</span>
          </div>
          ${card.ability_name && card.ability_name !== 'Aucun' ? `<div class="bt-card-ability">✦ ${card.ability_desc || card.ability_name}</div>` : ''}
          ${card.passive_desc ? `<div class="bt-card-passive">🔸 ${card.passive_desc}</div>` : ''}
        `}
      </div>
    `;
  }).join('');
}

function renderInstruction() {
  // Instruction supprimee
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

  // Render first so the field slot DOM is up to date
  renderAll();

  const panel = document.getElementById('bt-actions');
  const unitInfo = document.getElementById('bt-actions-unit');
  const buttons = document.getElementById('bt-actions-buttons');

  // Unit info
  const emoji = unit.emoji || ELEMENT_ICONS[unit.element] || '?';
  const hpPercent = Math.round((unit.currentHp / unit.maxHp) * 100);
  const hpColor = hpPercent > 50 ? '#22cc44' : hpPercent > 25 ? '#ccaa22' : '#cc2222';

  unitInfo.innerHTML = `
    <div class="bt-actions-unit-emoji">${emoji}</div>
    <div class="bt-actions-unit-name">${unit.name}</div>
    <div class="bt-actions-unit-hp">
      <div class="bt-unit-hpbar">
        <div class="bt-unit-hpbar-fill" style="width:${hpPercent}%;background:${hpColor}"></div>
      </div>
      <span class="bt-unit-hp-text">${unit.currentHp}/${unit.maxHp}</span>
    </div>
    ${unit.passive_desc ? `<div class="bt-actions-passive">🔸 ${unit.passive_desc}</div>` : ''}
  `;

  // Attack sub label
  let atkSub = '⚡1 energie, 1x/tour';
  if (hasSickness) atkSub = '💤 Vient d\'etre posee';
  else if (!hasEnergy) atkSub = '⚡ Pas assez d\'energie';
  else if (battleData.attackedThisTurn?.includes(slotIndex)) atkSub = '✓ Deja attaque';

  // Ability sub label
  let abilitySub = `💎${crystalCost} crystal, 1x/combat`;
  if (unit.usedAbility) abilitySub = '✓ Deja utilisee';
  else if ((battleData.playerCrystal || 0) < crystalCost) abilitySub = `💎 Pas assez (${crystalCost} requis)`;

  // Buttons
  buttons.innerHTML = `
    <button class="bt-action-btn bt-action-btn--attack ${!canAttack ? 'disabled' : ''}"
            onclick="actionAttack(event)" ${!canAttack ? 'disabled' : ''}>
      <span class="bt-action-label">⚔️ ATTAQUER</span>
      <span class="bt-action-sub">${atkSub}</span>
    </button>
    <button class="bt-action-btn bt-action-btn--ability ${!canAbility ? 'disabled' : ''}"
            onclick="actionAbility(event)" ${!canAbility ? 'disabled' : ''}>
      <span class="bt-action-label">✦ POUVOIR</span>
      <span class="bt-action-sub">${abilitySub}</span>
    </button>
    ${unit.ability_name ? `<div class="bt-actions-ability-name" title="${unit.ability_desc || ''}">${unit.ability_name}</div>` : ''}
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
  showInstruction('Cliquez une cible ennemie pour attaquer');
}

function actionAbility(e) {
  e.stopPropagation();
  hideActionPanel();
  actionMode = 'select_ability_target';
  renderAll();
  showInstruction("Cliquez une cible ennemie pour l'ability");
}

function clickHandCard(index) {
  if (isAnimating || battleData.result) return;
  if (isPvpMode && !isMyTurn) return;

  const card = battleData.playerHand[index];
  if (!card) return;

  if (card.mana_cost > battleData.playerEnergy) {
    showInstruction('Pas assez d\'energie !');
    return;
  }

  if (card.type === 'objet') {
    const targetType = getItemTarget(card);
    if (targetType === 'team') {
      useItem(index, null, null);
      return;
    }
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
  if (isAnimating || battleData.result || (isPvpMode && !isMyTurn)) {
    event.preventDefault();
    return;
  }

  draggedHandIndex = handIndex;
  event.dataTransfer.setData('text/plain', handIndex.toString());
  event.dataTransfer.effectAllowed = 'move';

  // Add dragging class after a frame (drag ghost is captured before this)
  requestAnimationFrame(() => {
    event.target.classList.add('bt-card--dragging');
  });

  // Highlight valid drop zones
  highlightDropZones(true);

  // Cancel any click-based selection
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
      const isEmpty = !fieldUnit || !fieldUnit.alive;
      if (isEmpty) {
        slot.classList.add('bt-slot--drop-hover');
      }
    });

    slot.addEventListener('dragleave', () => {
      slot.classList.remove('bt-slot--drop-hover');
    });

    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('bt-slot--drop-hover');
      highlightDropZones(false);

      if (draggedHandIndex === null) return;

      const fieldUnit = battleData.playerField[i];
      const isEmpty = !fieldUnit || !fieldUnit.alive;

      if (!isEmpty) {
        showInstruction('Slot occupe !');
        draggedHandIndex = null;
        return;
      }

      const handIndex = draggedHandIndex;
      draggedHandIndex = null;
      deployCard(handIndex, i);
    });
  });
}

function clickFieldSlot(side, slotIndex) {
  if (isAnimating || battleData.result) return;
  if (isPvpMode && !isMyTurn) return;
  slotClickedThisFrame = true;

  // Deploy mode: click empty player slot
  if (actionMode === 'select_deploy_slot' && side === 'player') {
    const slot = battleData.playerField[slotIndex];
    if (slot && slot.alive) {
      showInstruction('Slot occupe !');
      return;
    }
    deployCard(selectedHandIndex, slotIndex);
    return;
  }

  // Attack target: click enemy
  if (actionMode === 'select_attack_target' && side === 'enemy') {
    const target = battleData.enemyField[slotIndex];
    if (!target || !target.alive) {
      showInstruction('Pas de cible !');
      return;
    }
    attackCard(selectedFieldSlot, slotIndex);
    return;
  }

  // Ability target: click enemy
  if (actionMode === 'select_ability_target' && side === 'enemy') {
    const target = battleData.enemyField[slotIndex];
    if (!target || !target.alive) {
      showInstruction('Pas de cible !');
      return;
    }
    useAbility(selectedFieldSlot, slotIndex);
    return;
  }

  // Item target
  if (actionMode === 'select_item_target') {
    const item = battleData.playerHand[selectedItemIndex];
    const targetType = getItemTarget(item);
    if (targetType === 'ally' && side === 'player') {
      const target = battleData.playerField[slotIndex];
      if (!target || !target.alive) { showInstruction('Pas de cible alliee !'); return; }
      useItem(selectedItemIndex, slotIndex, 'player');
      return;
    }
    if (targetType === 'enemy' && side === 'enemy') {
      const target = battleData.enemyField[slotIndex];
      if (!target || !target.alive) { showInstruction('Pas de cible ennemie !'); return; }
      useItem(selectedItemIndex, slotIndex, 'enemy');
      return;
    }
    return;
  }

  // Click on own field unit: show action panel
  if (side === 'player') {
    const unit = battleData.playerField[slotIndex];
    if (!unit || !unit.alive) return;

    // If panel is open on this unit, close it
    if (actionPanelSlot === slotIndex) {
      hideActionPanel();
      cancelAction();
      return;
    }

    // If already in a targeting mode, deselect
    if (selectedFieldSlot === slotIndex && actionMode) {
      cancelAction();
      return;
    }

    // Close any open panel first
    hideActionPanel();

    if (unit.stunned) {
      showInstruction('Carte etourdie !');
      return;
    }

    // Check summoning sickness
    const hasSickness = unit.justDeployed;

    const enemyAlive = battleData.enemyField.some(u => u && u.alive);
    const hasEnergy = battleData.playerEnergy >= 1;
    const canAttack = !battleData.attackedThisTurn?.includes(slotIndex) && !hasSickness && hasEnergy && enemyAlive;
    const crystalCost = unit.crystal_cost || 1;
    const canAbility = !unit.usedAbility && (battleData.playerCrystal || 0) >= crystalCost && enemyAlive;

    // Always show action panel (even if some actions are disabled)
    showActionPanel(slotIndex, unit, crystalCost, canAttack, canAbility, hasSickness, hasEnergy);
  }
}

function clickEnemyAvatar() {
  if (isAnimating || battleData.result) return;
  if (isPvpMode && !isMyTurn) return;

  // Can only attack avatar when in attack mode
  if (actionMode === 'select_attack_target') {
    const enemyAlive = battleData.enemyField.some(u => u && u.alive);
    if (enemyAlive) {
      showInstruction('Il reste des cartes a eliminer !');
      return;
    }
    attackAvatar(selectedFieldSlot);
    return;
  }

  // Ability on avatar
  if (actionMode === 'select_ability_target') {
    const enemyAlive = battleData.enemyField.some(u => u && u.alive);
    if (enemyAlive) {
      showInstruction('Il reste des cartes a eliminer !');
      return;
    }
    useAbilityOnAvatar(selectedFieldSlot);
    return;
  }
}

async function attackAvatar(fieldSlot) {
  if (isAnimating) return;

  if (isPvpMode) {
    pvpSocket.emit('pvp:attack-avatar', { battleId: battleData.battleId, fieldSlot });
    cancelAction();
    return;
  }

  isAnimating = true;

  try {
    const res = await fetch('/api/battle/attack-avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battleId: battleData.battleId, fieldSlot })
    });
    const data = await res.json();
    if (!res.ok) { showInstruction(data.error); isAnimating = false; return; }

    await animateEvents(data.events);
    updateBattleData(data);
  } catch { showInstruction('Erreur reseau'); }

  cancelAction();
  isAnimating = false;
}

async function useAbilityOnAvatar(fieldSlot) {
  if (isAnimating) return;

  if (isPvpMode) {
    pvpSocket.emit('pvp:use-ability-avatar', { battleId: battleData.battleId, fieldSlot });
    cancelAction();
    return;
  }

  isAnimating = true;

  try {
    const res = await fetch('/api/battle/use-ability-avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battleId: battleData.battleId, fieldSlot })
    });
    const data = await res.json();
    if (!res.ok) { showInstruction(data.error); isAnimating = false; return; }

    await animateEvents(data.events);
    updateBattleData(data);
  } catch { showInstruction('Erreur reseau'); }

  cancelAction();
  isAnimating = false;
}

function showInstruction(text) {
  // Instruction supprimee
}

// ========================
// API ACTIONS
// ========================

async function deployCard(handIndex, fieldSlot) {
  if (isAnimating) return;

  if (isPvpMode) {
    pvpSocket.emit('pvp:deploy', { battleId: battleData.battleId, handIndex, fieldSlot });
    cancelAction();
    return;
  }

  isAnimating = true;

  try {
    const res = await fetch('/api/battle/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battleId: battleData.battleId, handIndex, fieldSlot })
    });
    const data = await res.json();
    if (!res.ok) { showInstruction(data.error); isAnimating = false; return; }

    await animateEvents(data.events);
    updateBattleData(data);
  } catch { showInstruction('Erreur reseau'); }

  cancelAction();
  isAnimating = false;
}

async function attackCard(fieldSlot, targetSlot) {
  if (isAnimating) return;

  if (isPvpMode) {
    pvpSocket.emit('pvp:attack-card', { battleId: battleData.battleId, fieldSlot, targetSlot });
    cancelAction();
    return;
  }

  isAnimating = true;

  try {
    const res = await fetch('/api/battle/attack-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battleId: battleData.battleId, fieldSlot, targetSlot })
    });
    const data = await res.json();
    if (!res.ok) { showInstruction(data.error); isAnimating = false; return; }

    await animateEvents(data.events);
    updateBattleData(data);
  } catch { showInstruction('Erreur reseau'); }

  cancelAction();
  isAnimating = false;
}

async function useAbility(fieldSlot, targetSlot) {
  if (isAnimating) return;

  if (isPvpMode) {
    pvpSocket.emit('pvp:use-ability', { battleId: battleData.battleId, fieldSlot, targetSlot });
    cancelAction();
    return;
  }

  isAnimating = true;

  try {
    const res = await fetch('/api/battle/use-ability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battleId: battleData.battleId, fieldSlot, targetSlot })
    });
    const data = await res.json();
    if (!res.ok) { showInstruction(data.error); isAnimating = false; return; }

    await animateEvents(data.events);
    updateBattleData(data);
  } catch { showInstruction('Erreur reseau'); }

  cancelAction();
  isAnimating = false;
}

async function useItem(handIndex, targetSlot, targetSide) {
  if (isAnimating) return;

  if (isPvpMode) {
    pvpSocket.emit('pvp:use-item', { battleId: battleData.battleId, handIndex, targetSlot, targetSide });
    cancelAction();
    return;
  }

  isAnimating = true;

  try {
    const res = await fetch('/api/battle/use-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battleId: battleData.battleId, handIndex, targetSlot, targetSide })
    });
    const data = await res.json();
    if (!res.ok) { showInstruction(data.error); isAnimating = false; return; }

    await animateEvents(data.events);
    updateBattleData(data);
  } catch { showInstruction('Erreur reseau'); }

  cancelAction();
  isAnimating = false;
}

async function endTurn() {
  if (isAnimating || battleData.result) return;
  if (isPvpMode && !isMyTurn) return;

  if (isPvpMode) {
    isMyTurn = false;
    setTurnEnabled(false);
    cancelAction();
    pvpSocket.emit('pvp:end-turn', { battleId: battleData.battleId });
    return;
  }

  isAnimating = true;

  document.getElementById('end-turn-btn').disabled = true;
  cancelAction();

  try {
    const res = await fetch('/api/battle/end-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battleId: battleData.battleId })
    });
    const data = await res.json();
    if (!res.ok) { showInstruction(data.error); isAnimating = false; return; }

    await animateEvents(data.events);
    updateBattleData(data);
  } catch { showInstruction('Erreur reseau'); }

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
    let text = '';
    let cssClass = 'log-normal';
    let animDuration = 300;

    switch (event.type) {
      case 'deploy': {
        text = `${event.emoji} ${event.name} deploye (⚡${event.mana_cost})`;
        cssClass = 'log-deploy';
        animateDeploy('player', event.slot);
        animDuration = 500;
        break;
      }
      case 'enemy_deploy': {
        text = `${event.emoji} ${event.name} deploye par l'ennemi (⚡${event.mana_cost})`;
        cssClass = 'log-enemy-deploy';
        animateDeploy('enemy', event.slot);
        animDuration = 500;
        break;
      }
      case 'attack': {
        const aSlot = event.attackerSlot ?? event.attackerIndex;
        const tSlot = event.targetSlot ?? event.targetIndex;
        text = `${event.attacker} → ${event.target} : -${event.damage} PV`;
        cssClass = event.side === 'player' ? 'log-player-attack' : 'log-enemy-attack';
        if (event.side === 'player') {
          await animateAttackMovement('player', aSlot, 'enemy', tSlot);
          showDamageFloat('enemy', tSlot, event.damage);
        } else {
          await animateAttackMovement('enemy', aSlot, 'player', tSlot);
          showDamageFloat('player', tSlot, event.damage);
        }
        animDuration = 200;
        break;
      }
      case 'ability':
      case 'ability_damage':
      case 'ability_aoe':
      case 'ability_drain':
      case 'ability_stun':
      case 'ability_debuff': {
        let abilityColor = 'rgba(204,68,255,0.5)';
        if (event.type === 'ability_damage' || event.type === 'ability_aoe') abilityColor = 'rgba(255,68,68,0.5)';
        if (event.type === 'ability_stun') abilityColor = 'rgba(255,204,0,0.5)';
        if (event.type === 'ability_drain') abilityColor = 'rgba(170,68,255,0.5)';

        const caster = findSlotByName(event.unit);
        if (caster) animateAbilityCast(caster.side, caster.slot, abilityColor);

        if (event.target) {
          const tgt = findSlotByName(event.target);
          if (tgt) {
            setTimeout(() => animateAbilityHit(tgt.side, tgt.slot, abilityColor), 300);
            if (event.damage) setTimeout(() => showDamageFloat(tgt.side, tgt.slot, event.damage), 400);
          }
        }

        if (event.type === 'ability') text = `✦ ${event.unit} : ${event.ability} (${event.desc})`;
        else if (event.type === 'ability_damage') text = `✦ ${event.unit} : ${event.ability} → -${event.damage} sur ${event.target}`;
        else if (event.type === 'ability_aoe') text = `✦ ${event.unit} : ${event.ability} → -${event.damage} sur ${event.target}`;
        else if (event.type === 'ability_drain') text = `✦ ${event.unit} : ${event.ability} → -${event.damage} ${event.target}, +${event.heal} PV`;
        else if (event.type === 'ability_stun') text = `✦ ${event.unit} : ${event.ability} → ${event.target} etourdi !`;
        else if (event.type === 'ability_debuff') text = `✦ ${event.unit} : ${event.ability} → ${event.desc} sur ${event.target}`;
        cssClass = 'log-ability';
        animDuration = 600;
        break;
      }
      case 'ability_heal':
      case 'ability_team_heal': {
        const healColor = 'rgba(68,255,68,0.5)';
        const healer = findSlotByName(event.unit);
        if (healer) animateAbilityCast(healer.side, healer.slot, healColor);

        if (event.type === 'ability_heal' && event.target) {
          const tgt = findSlotByName(event.target);
          if (tgt) {
            animateAbilityHit(tgt.side, tgt.slot, healColor);
            showHealFloat(tgt.side, tgt.slot, event.heal);
          }
        } else if (event.type === 'ability_team_heal' && healer) {
          const field = healer.side === 'player' ? battleData.playerField : battleData.enemyField;
          for (let i = 0; i < 3; i++) {
            if (field[i] && field[i].alive) {
              animateAbilityHit(healer.side, i, healColor);
              showHealFloat(healer.side, i, event.heal);
            }
          }
        }

        text = event.type === 'ability_heal'
          ? `💚 ${event.unit} : +${event.heal} PV sur ${event.target}`
          : `💚 ${event.unit} : +${event.heal} PV a l'equipe`;
        cssClass = 'log-heal';
        animDuration = 500;
        break;
      }
      case 'ability_poison': {
        const caster = findSlotByName(event.unit);
        const tgt = findSlotByName(event.target);
        if (caster) animateAbilityCast(caster.side, caster.slot, 'rgba(170,68,255,0.5)');
        if (tgt) {
          animateAbilityHit(tgt.side, tgt.slot, 'rgba(170,68,255,0.5)');
          showStatusFloat(tgt.side, tgt.slot, '☠', '#aa44ff');
        }
        text = `☠ ${event.unit} → ${event.target} empoisonne (${event.damage}/tour)`;
        cssClass = 'log-poison';
        animDuration = 500;
        break;
      }
      case 'ability_mark': {
        const tgt = findSlotByName(event.target);
        if (tgt) {
          animateAbilityHit(tgt.side, tgt.slot, 'rgba(255,170,0,0.5)');
          showStatusFloat(tgt.side, tgt.slot, '🎯', '#ffaa00');
        }
        text = `🎯 ${event.unit} → ${event.target} marque (+${event.bonus} degats)`;
        cssClass = 'log-mark';
        animDuration = 500;
        break;
      }
      case 'ability_sacrifice': {
        const caster = findSlotByName(event.unit);
        const tgt = findSlotByName(event.target);
        if (caster) {
          showDamageFloat(caster.side, caster.slot, event.selfDamage);
          animateAbilityCast(caster.side, caster.slot, 'rgba(204,51,51,0.5)');
        }
        if (tgt) showDamageFloat(tgt.side, tgt.slot, event.targetDamage);
        text = `💀 ${event.unit} : sacrifie ${event.selfDamage} PV, inflige ${event.targetDamage} a ${event.target}`;
        cssClass = 'log-sacrifice';
        animDuration = 500;
        break;
      }
      case 'stunned': {
        const info = findSlotByName(event.unit);
        if (info) showStatusFloat(info.side, info.slot, '💫', '#ffcc00');
        text = `💫 ${event.unit} est etourdi !`;
        cssClass = 'log-stun';
        break;
      }
      case 'ko': {
        const info = findSlotByName(event.unit);
        if (info) animateKO(info.side, info.slot);
        text = `💀 ${event.unit} KO !`;
        cssClass = 'log-ko';
        animDuration = 500;
        break;
      }
      case 'revive': {
        const info = findSlotByName(event.unit);
        if (info) animateAbilityHit(info.side, info.slot, 'rgba(255,255,100,0.6)');
        text = `✨ ${event.unit} revient avec ${event.hp} PV !`;
        cssClass = 'log-revive';
        break;
      }
      case 'poison_tick': {
        const info = findSlotByName(event.unit);
        if (info) {
          showDamageFloat(info.side, info.slot, event.damage);
          showStatusFloat(info.side, info.slot, '☠', '#aa44ff');
        }
        text = `☠ ${event.unit} : -${event.damage} (poison)`;
        cssClass = 'log-poison';
        break;
      }
      case 'grace_survive': {
        const info = findSlotByName(event.unit);
        if (info) animateAbilityHit(info.side, info.slot, 'rgba(255,255,100,0.6)');
        text = `✨ ${event.unit} survit par Grace ! (1 PV)`;
        cssClass = 'log-revive';
        break;
      }
      case 'counter_damage': {
        text = `↩ ${event.unit} reflete ${event.damage} a ${event.target}`;
        cssClass = 'log-enemy-attack';
        break;
      }
      case 'shield_absorb': {
        text = `🛡 ${event.unit} absorbe ${event.absorbed}`;
        cssClass = 'log-shield';
        break;
      }
      // Item events
      case 'item_heal': {
        const tgt = findSlotByName(event.target);
        if (tgt) {
          animateAbilityHit(tgt.side, tgt.slot, 'rgba(68,255,68,0.5)');
          showHealFloat(tgt.side, tgt.slot, event.heal);
        }
        text = `${event.emoji} ${event.item} → +${event.heal} PV sur ${event.target}`;
        cssClass = 'log-heal';
        break;
      }
      case 'item_damage':
      case 'item_aoe': {
        const tgt = findSlotByName(event.target);
        if (tgt) {
          animateAbilityHit(tgt.side, tgt.slot, 'rgba(255,68,68,0.5)');
          showDamageFloat(tgt.side, tgt.slot, event.damage);
        }
        text = `${event.emoji} ${event.item} → -${event.damage} sur ${event.target}`;
        cssClass = 'log-ability';
        break;
      }
      case 'item_buff': {
        text = `${event.emoji} ${event.item} → ${event.desc}${event.target ? ' sur ' + event.target : ''}`;
        cssClass = 'log-ability';
        break;
      }
      case 'item_stun': {
        const tgt = findSlotByName(event.target);
        if (tgt) showStatusFloat(tgt.side, tgt.slot, '💫', '#ffcc00');
        text = `${event.emoji} ${event.item} → ${event.target} etourdi !`;
        cssClass = 'log-ability';
        break;
      }
      case 'item_poison': {
        const tgt = findSlotByName(event.target);
        if (tgt) showStatusFloat(tgt.side, tgt.slot, '☠', '#aa44ff');
        text = `${event.emoji} ${event.item} → ${event.target} empoisonne (${event.damage}/tour)`;
        cssClass = 'log-poison';
        break;
      }
      case 'item_team_heal': {
        text = `${event.emoji} ${event.item} → +${event.heal} PV equipe`;
        cssClass = 'log-heal';
        break;
      }
      case 'player_draw': {
        text = `📥 Carte piochee : ${event.card?.emoji || ''} ${event.card?.name || '???'}`;
        cssClass = 'log-draw';
        break;
      }
      case 'enemy_draw': {
        text = `📥 L'ennemi pioche une carte`;
        cssClass = 'log-draw';
        break;
      }
      case 'avatar_damage': {
        text = `${event.attacker} → Adversaire : -${event.damage} PV (${event.targetHp} restants)`;
        cssClass = event.side === 'player' ? 'log-player-attack' : 'log-enemy-attack';
        // Flash avatar
        const avatarId = event.side === 'player' ? 'enemy-avatar-hp' : 'player-avatar-hp';
        const avatarCircle = document.querySelector(`#${avatarId} .bt-avatar-circle`);
        if (avatarCircle) {
          avatarCircle.classList.add('bt-avatar-hit');
          setTimeout(() => avatarCircle.classList.remove('bt-avatar-hit'), 500);
        }
        animDuration = 400;
        break;
      }
      case 'type_passive': {
        text = `${event.desc}`;
        cssClass = 'log-passive';
        break;
      }
      case 'surrender': {
        text = `🏳 Abandon !`;
        cssClass = 'log-ko';
        animDuration = 500;
        break;
      }
    }

    // Log supprime

    await sleep(animDuration);
  }
}

function showDamageFloat(side, slotIndex, damage) {
  const slot = getSlotElement(side, slotIndex);
  if (!slot) return;

  const float = document.createElement('div');
  float.className = 'damage-float';
  float.textContent = `-${damage}`;
  slot.appendChild(float);
  setTimeout(() => float.remove(), 1200);
}

function animateSlot(side, slotIndex, animClass) {
  const slot = getSlotElement(side, slotIndex);
  if (!slot) return;
  slot.classList.add(animClass);
  setTimeout(() => slot.classList.remove(animClass), 500);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================
// VISUAL ANIMATIONS
// ========================

function getSlotElement(side, slotIndex) {
  const field = side === 'player' ? '#player-field' : '#enemy-field';
  return document.querySelector(`${field} .bt-slot[data-slot="${slotIndex}"]`);
}

function findSlotByName(name) {
  if (!name || !battleData) return null;
  for (let i = 0; i < 3; i++) {
    const pu = battleData.playerField[i];
    if (pu && pu.alive && pu.name === name) return { side: 'player', slot: i };
    const eu = battleData.enemyField[i];
    if (eu && eu.alive && eu.name === name) return { side: 'enemy', slot: i };
  }
  // Also check dead units for KO events
  for (let i = 0; i < 3; i++) {
    const pu = battleData.playerField[i];
    if (pu && pu.name === name) return { side: 'player', slot: i };
    const eu = battleData.enemyField[i];
    if (eu && eu.name === name) return { side: 'enemy', slot: i };
  }
  return null;
}

async function animateAttackMovement(attackerSide, attackerSlot, targetSide, targetSlot) {
  const attackerEl = getSlotElement(attackerSide, attackerSlot);
  const targetEl = getSlotElement(targetSide, targetSlot);
  if (!attackerEl || !targetEl) return;

  const unitEl = attackerEl.querySelector('.bt-unit');
  if (!unitEl) return;

  const attackerRect = attackerEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();

  const dx = (targetRect.left + targetRect.width / 2) - (attackerRect.left + attackerRect.width / 2);
  const dy = (targetRect.top + targetRect.height / 2) - (attackerRect.top + attackerRect.height / 2);

  const moveX = dx * 0.55;
  const moveY = dy * 0.55;

  unitEl.style.transition = 'transform 0.2s ease-in';
  unitEl.style.zIndex = '50';
  unitEl.style.transform = `translate(${moveX}px, ${moveY}px) scale(1.1)`;

  await sleep(200);

  animateImpact(targetSide, targetSlot);

  unitEl.style.transition = 'transform 0.25s ease-out';
  unitEl.style.transform = 'translate(0, 0) scale(1)';

  await sleep(250);

  unitEl.style.transition = '';
  unitEl.style.zIndex = '';
  unitEl.style.transform = '';
}

function animateImpact(side, slotIndex) {
  const el = getSlotElement(side, slotIndex);
  if (!el) return;
  const unit = el.querySelector('.bt-unit');
  if (!unit) return;
  unit.classList.add('impact-shake');
  const flash = document.createElement('div');
  flash.className = 'impact-flash';
  unit.appendChild(flash);
  setTimeout(() => {
    unit.classList.remove('impact-shake');
    flash.remove();
  }, 400);
}

function animateAbilityCast(side, slotIndex, color) {
  const el = getSlotElement(side, slotIndex);
  if (!el) return;
  const unit = el.querySelector('.bt-unit');
  if (!unit) return;
  unit.style.boxShadow = `0 0 25px ${color}, 0 0 50px ${color}`;
  unit.classList.add('ability-casting');
  setTimeout(() => {
    unit.style.boxShadow = '';
    unit.classList.remove('ability-casting');
  }, 800);
}

function animateAbilityHit(side, slotIndex, color) {
  const el = getSlotElement(side, slotIndex);
  if (!el) return;
  const unit = el.querySelector('.bt-unit');
  if (!unit) return;
  const flash = document.createElement('div');
  flash.className = 'ability-hit-flash';
  flash.style.background = color;
  unit.appendChild(flash);
  setTimeout(() => flash.remove(), 600);
}

function showHealFloat(side, slotIndex, amount) {
  const slot = getSlotElement(side, slotIndex);
  if (!slot) return;
  const float = document.createElement('div');
  float.className = 'heal-float';
  float.textContent = `+${amount}`;
  slot.appendChild(float);
  setTimeout(() => float.remove(), 1200);
}

function showStatusFloat(side, slotIndex, icon, color) {
  const slot = getSlotElement(side, slotIndex);
  if (!slot) return;
  const float = document.createElement('div');
  float.className = 'status-float';
  float.textContent = icon;
  float.style.color = color || '#fff';
  slot.appendChild(float);
  setTimeout(() => float.remove(), 1200);
}

function animateDeploy(side, slotIndex) {
  const el = getSlotElement(side, slotIndex);
  if (!el) return;
  const unit = el.querySelector('.bt-unit');
  if (!unit) return;
  unit.classList.add('deploy-anim');
  setTimeout(() => unit.classList.remove('deploy-anim'), 500);
}

function animateKO(side, slotIndex) {
  const el = getSlotElement(side, slotIndex);
  if (!el) return;
  const unit = el.querySelector('.bt-unit');
  if (!unit) return;
  unit.classList.add('ko-anim');
}

function screenFlash() {
  const flash = document.getElementById('screen-flash');
  flash.classList.remove('hidden');
  flash.classList.add('flash-active');
  setTimeout(() => { flash.classList.remove('flash-active'); flash.classList.add('hidden'); }, 400);
}

// ========================
// RIGHT-CLICK ABILITY
// ========================

document.getElementById('player-field').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const slot = e.target.closest('.bt-slot');
  if (!slot) return;
  const slotIndex = parseInt(slot.dataset.slot);
  const unit = battleData.playerField[slotIndex];
  if (!unit || !unit.alive || unit.usedAbility || unit.stunned) return;

  const crystalCost = unit.crystal_cost || 1;
  if ((battleData.playerCrystal || 0) < crystalCost) {
    showInstruction(`Pas assez de crystal (${crystalCost} requis)`);
    return;
  }

  selectedFieldSlot = slotIndex;
  actionMode = 'select_ability_target';
  renderAll();
});

// ========================
// RESULT
// ========================

async function showResult() {
  // PVP result is handled by showPvpResult via socket event
  if (isPvpMode) return;

  try {
    const res = await fetch('/api/battle/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battleId: battleData.battleId })
    });
    const data = await res.json();

    const overlay = document.getElementById('battle-result');
    const box = document.getElementById('battle-result-box');
    const title = document.getElementById('result-title');
    const rewards = document.getElementById('result-rewards');

    overlay.classList.remove('hidden');

    if (battleData.result === 'victory') {
      title.textContent = 'VICTOIRE !';
      title.style.color = '#22cc44';
      box.classList.add('result-victory');
      rewards.innerHTML = `+${data.reward} CR`;
      screenFlash();
    } else if (battleData.result === 'draw') {
      title.textContent = 'EGALITE';
      title.style.color = '#ccaa22';
      rewards.textContent = 'Pas de recompense';
    } else {
      title.textContent = 'DEFAITE...';
      title.style.color = '#cc2222';
      box.classList.add('result-defeat');
      rewards.textContent = data.reward > 0 ? `+${data.reward} CR` : '';
    }
  } catch {
    const overlay = document.getElementById('battle-result');
    overlay.classList.remove('hidden');
    document.getElementById('result-title').textContent =
      battleData.result === 'victory' ? 'VICTOIRE !' : battleData.result === 'draw' ? 'EGALITE' : 'DEFAITE...';
  }
}

function leaveBattle() {
  if (pvpSocket) {
    pvpSocket.disconnect();
    pvpSocket = null;
  }
  sessionStorage.removeItem('deckBattleData');
  sessionStorage.removeItem('opponentName');
  sessionStorage.removeItem('battleMode');
  window.location.href = '/combat';
}

// ESC to cancel action
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    cancelAction();
    if (draggedHandIndex !== null) {
      draggedHandIndex = null;
      highlightDropZones(false);
    }
  }
});

// Click outside panel to close
document.addEventListener('click', (e) => {
  if (slotClickedThisFrame) {
    slotClickedThisFrame = false;
    return;
  }
  if (actionPanelSlot !== null && !e.target.closest('#bt-actions') && !e.target.closest('.bt-slot')) {
    hideActionPanel();
    cancelAction();
  }
});

init();
