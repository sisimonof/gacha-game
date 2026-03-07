// battle.js — Deck-based combat with hand/field/energy

let battleData = null;
let opponentName = '???';
let isAnimating = false;

// Action mode: null, 'select_deploy_slot', 'select_attack_target', 'select_ability_target', 'select_item_target'
let actionMode = null;
let selectedHandIndex = null;
let selectedFieldSlot = null;
let selectedItemIndex = null;
let actionPopupSlot = null;

function init() {
  const stored = sessionStorage.getItem('deckBattleData');
  opponentName = sessionStorage.getItem('opponentName') || '???';

  if (!stored) {
    window.location.href = '/combat';
    return;
  }

  battleData = JSON.parse(stored);
  document.getElementById('opponent-name').textContent = `VS ${opponentName}`;
  renderAll();
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

  // Disable end turn if battle over
  document.getElementById('end-turn-btn').disabled = !!battleData.result;
}

function renderFieldSlot(unit, slotIndex, side) {
  if (!unit || !unit.alive) {
    return `<div class="field-slot-empty">VIDE</div>`;
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
  if (unit.poisoned > 0) statusIcons += '<span class="status-icon status-poison">☠</span>';
  if (unit.stunned) statusIcons += '<span class="status-icon status-stun">💫</span>';
  if (unit.shield > 0) statusIcons += `<span class="status-icon status-shield">🛡${unit.shield}</span>`;
  if (unit.marked > 0) statusIcons += '<span class="status-icon status-mark">🎯</span>';

  const attackedClass = side === 'player' && battleData.attackedThisTurn?.includes(slotIndex) ? 'field-attacked' : '';

  const abilityHtml = unit.ability_name ? `
    <div class="field-unit-ability ${unit.usedAbility ? 'ability-used' : ''}">
      <span class="ability-label">✦ ${unit.ability_name}</span>
      ${unit.ability_desc ? `<span class="ability-desc">${unit.ability_desc}</span>` : ''}
    </div>` : '';

  return `
    <div class="field-unit ${isSelected ? 'field-selected' : ''} ${isTarget ? 'field-targetable' : ''} ${attackedClass}"
         style="border-color: ${r.color}" data-slot="${slotIndex}" data-side="${side}">
      <div class="field-unit-element" style="background:${elemColor}">${elemIcon}</div>
      <div class="field-unit-emoji">${emoji}</div>
      <div class="field-unit-name">${unit.name}</div>
      <div class="field-unit-hp-section">
        <span class="field-unit-hp-icon">❤️</span>
        <div class="field-unit-hpbar">
          <div class="field-unit-hpbar-fill" style="width:${hpPercent}%;background:${hpColor}"></div>
        </div>
        <span class="field-unit-hp-text" style="color:${hpColor}">${unit.currentHp}/${unit.maxHp}</span>
      </div>
      <div class="field-unit-stats">
        <span class="stat-atk">⚔️ ${totalAtk}</span>
        <span class="stat-def">🛡️ ${totalDef}</span>
      </div>
      ${statusIcons ? `<div class="field-unit-status">${statusIcons}</div>` : ''}
      ${abilityHtml}
    </div>
  `;
}

function renderEnemyField() {
  for (let i = 0; i < 3; i++) {
    const slotEl = document.querySelector(`#enemy-field .field-slot[data-slot="${i}"]`);
    slotEl.innerHTML = renderFieldSlot(battleData.enemyField[i], i, 'enemy');
  }
}

function renderPlayerField() {
  for (let i = 0; i < 3; i++) {
    const slotEl = document.querySelector(`#player-field .field-slot[data-slot="${i}"]`);
    slotEl.innerHTML = renderFieldSlot(battleData.playerField[i], i, 'player');
  }
}

function renderHand() {
  const hand = document.getElementById('player-hand');
  if (!battleData.playerHand || battleData.playerHand.length === 0) {
    hand.innerHTML = '<div class="hand-empty">Main vide</div>';
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

    return `
      <div class="hand-card ${isObj ? 'hand-card-objet' : ''} ${canAfford ? '' : 'hand-card-expensive'} ${isSelected ? 'hand-card-selected' : ''}"
           style="border-color: ${r.color}"
           onclick="clickHandCard(${i})"
           title="${card.name}${isObj ? ' (Objet: ' + card.ability_desc + ')' : ''}">
        <div class="hand-card-element" style="color:${elemColor}">${elemIcon}</div>
        <div class="hand-card-cost">⚡${card.mana_cost}</div>
        <div class="hand-card-emoji">${emoji}</div>
        <div class="hand-card-name">${card.name}</div>
        ${isObj ? `<div class="hand-card-type">OBJET</div>
          <div class="hand-card-obj-desc">${card.ability_desc || ''}</div>` : `
          <div class="hand-card-stats">
            <span class="hand-stat-atk">⚔️ ${card.effectiveStats.attack}</span>
            <span class="hand-stat-def">🛡️ ${card.effectiveStats.defense}</span>
            <span class="hand-stat-hp">❤️ ${card.effectiveStats.hp}</span>
          </div>
          ${card.ability_name ? `<div class="hand-card-ability">✦ ${card.ability_name}</div>` : ''}
        `}
      </div>
    `;
  }).join('');
}

function renderInstruction() {
  const el = document.getElementById('battle-instruction');
  if (battleData.result || actionMode === null) {
    el.textContent = '';
    return;
  }

  switch (actionMode) {
    case 'select_deploy_slot':
      el.textContent = '▼ Cliquez un slot vide pour deployer';
      break;
    case 'select_attack_target':
      el.textContent = '⚔️ Cliquez une cible ennemie';
      break;
    case 'select_ability_target':
      el.textContent = '✦ Cliquez une cible pour le pouvoir';
      break;
    case 'select_item_target':
      const item = battleData.playerHand[selectedItemIndex];
      const effect = getItemTarget(item);
      if (effect === 'ally') el.textContent = '🧪 Cliquez un allie';
      else if (effect === 'enemy') el.textContent = '🧪 Cliquez un ennemi';
      else el.textContent = '🧪 Effet applique a tous';
      break;
    default:
      el.textContent = '';
  }
}

function getItemTarget(item) {
  if (!item) return null;
  // Map ability names to target type
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
  closeActionPopup();
  actionMode = null;
  selectedHandIndex = null;
  selectedFieldSlot = null;
  selectedItemIndex = null;
  renderAll();
}

function showActionPopup(slotIndex, unit, abilityCost, canAttack, canAbility) {
  closeActionPopup();
  actionPopupSlot = slotIndex;
  selectedFieldSlot = slotIndex;

  // Render first so the field slot DOM is up to date, THEN append popup
  renderAll();

  const slotEl = document.querySelector(`#player-field .field-slot[data-slot="${slotIndex}"]`);
  if (!slotEl) return;

  const popup = document.createElement('div');
  popup.className = 'action-popup';
  popup.id = 'action-popup';

  // Attack button
  const attackBtn = document.createElement('button');
  attackBtn.className = 'action-popup-btn action-popup-attack';
  attackBtn.innerHTML = `<span class="action-popup-label">⚔️ ATTAQUER</span><span class="action-popup-sub">gratuit, 1x/tour</span>`;
  attackBtn.disabled = !canAttack;
  attackBtn.onclick = (e) => {
    e.stopPropagation();
    closeActionPopup();
    actionMode = 'select_attack_target';
    renderAll();
    showInstruction('Cliquez une cible ennemie pour attaquer');
  };

  // Ability button
  const abilityBtn = document.createElement('button');
  abilityBtn.className = 'action-popup-btn action-popup-ability';
  abilityBtn.innerHTML = `<span class="action-popup-label">✦ POUVOIR</span><span class="action-popup-sub">⚡${abilityCost} energie, 1x/combat</span>`;
  abilityBtn.disabled = !canAbility;
  abilityBtn.onclick = (e) => {
    e.stopPropagation();
    closeActionPopup();
    actionMode = 'select_ability_target';
    renderAll();
    showInstruction("Cliquez une cible ennemie pour l'ability");
  };

  // Ability name label
  const abilityLabel = document.createElement('div');
  abilityLabel.className = 'action-popup-ability-name';
  abilityLabel.textContent = unit.ability_name;
  abilityLabel.title = unit.ability_desc || '';

  popup.appendChild(attackBtn);
  popup.appendChild(abilityBtn);
  popup.appendChild(abilityLabel);
  slotEl.style.position = 'relative';
  slotEl.appendChild(popup);
}

function closeActionPopup() {
  const existing = document.getElementById('action-popup');
  if (existing) existing.remove();
  actionPopupSlot = null;
}

function clickHandCard(index) {
  if (isAnimating || battleData.result) return;

  const card = battleData.playerHand[index];
  if (!card) return;

  if (card.mana_cost > battleData.playerEnergy) {
    showInstruction('Pas assez d\'energie !');
    return;
  }

  if (card.type === 'objet') {
    // Item card
    const targetType = getItemTarget(card);
    if (targetType === 'team') {
      // No target needed, use immediately
      useItem(index, null, null);
      return;
    }
    selectedItemIndex = index;
    selectedHandIndex = index;
    actionMode = 'select_item_target';
  } else {
    // Creature card - enter deploy mode
    selectedHandIndex = index;
    actionMode = 'select_deploy_slot';
  }

  renderAll();
}

function clickFieldSlot(side, slotIndex) {
  if (isAnimating || battleData.result) return;

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

  // Click on own field unit: show action choice popup
  if (side === 'player') {
    const unit = battleData.playerField[slotIndex];
    if (!unit || !unit.alive) return;

    // If popup is open on this unit, close it
    if (actionPopupSlot === slotIndex) {
      closeActionPopup();
      cancelAction();
      return;
    }

    // If already in a targeting mode, deselect
    if (selectedFieldSlot === slotIndex && actionMode) {
      cancelAction();
      return;
    }

    // Close any open popup first
    closeActionPopup();

    if (unit.stunned) {
      showInstruction('Carte etourdie !');
      return;
    }

    const enemyAlive = battleData.enemyField.some(u => u && u.alive);
    const canAttack = !battleData.attackedThisTurn?.includes(slotIndex) && enemyAlive;
    const abilityCost = Math.ceil(unit.mana_cost / 2);
    const canAbility = !unit.usedAbility && battleData.playerEnergy >= abilityCost && enemyAlive;

    if (!canAttack && !canAbility) {
      showInstruction('Aucune action disponible');
      return;
    }

    // If only attack available, go directly to attack mode
    if (canAttack && !canAbility) {
      selectedFieldSlot = slotIndex;
      actionMode = 'select_attack_target';
      renderAll();
      showInstruction('Cliquez une cible ennemie pour attaquer');
      return;
    }

    // If only ability available, go directly to ability mode
    if (!canAttack && canAbility) {
      selectedFieldSlot = slotIndex;
      actionMode = 'select_ability_target';
      renderAll();
      showInstruction("Cliquez une cible ennemie pour l'ability");
      return;
    }

    // Both available: show choice popup
    showActionPopup(slotIndex, unit, abilityCost, canAttack, canAbility);
  }
}

function showInstruction(text) {
  const el = document.getElementById('battle-instruction');
  el.textContent = text;
  el.classList.add('instruction-flash');
  setTimeout(() => {
    el.classList.remove('instruction-flash');
    if (!actionMode) el.textContent = '';
  }, 2000);
}

// ========================
// API ACTIONS
// ========================

async function deployCard(handIndex, fieldSlot) {
  if (isAnimating) return;
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
  battleData.playerDeckCount = data.playerDeckCount;
  battleData.enemyField = data.enemyField;
  battleData.enemyHandCount = data.enemyHandCount;
  battleData.enemyEnergy = data.enemyEnergy;
  battleData.enemyMaxEnergy = data.enemyMaxEnergy;
  battleData.enemyDeckCount = data.enemyDeckCount;
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
  const log = document.getElementById('battle-log');

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
      case 'type_passive': {
        text = `${event.desc}`;
        cssClass = 'log-passive';
        break;
      }
    }

    if (text) {
      const entry = document.createElement('div');
      entry.className = `battle-log-entry ${cssClass}`;
      entry.textContent = text;
      log.appendChild(entry);
      log.scrollTop = log.scrollHeight;
    }

    await sleep(animDuration);
  }
}

function showDamageFloat(side, slotIndex, damage) {
  const field = side === 'enemy' ? '#enemy-field' : '#player-field';
  const slot = document.querySelector(`${field} .field-slot[data-slot="${slotIndex}"]`);
  if (!slot) return;

  const float = document.createElement('div');
  float.className = 'damage-float';
  float.textContent = `-${damage}`;
  slot.appendChild(float);
  setTimeout(() => float.remove(), 1200);
}

function animateSlot(side, slotIndex, animClass) {
  const field = side === 'player' ? '#player-field' : '#enemy-field';
  const slot = document.querySelector(`${field} .field-slot[data-slot="${slotIndex}"]`);
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
  return document.querySelector(`${field} .field-slot[data-slot="${slotIndex}"]`);
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

  const unitEl = attackerEl.querySelector('.field-unit');
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
  const unit = el.querySelector('.field-unit');
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
  const unit = el.querySelector('.field-unit');
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
  const unit = el.querySelector('.field-unit');
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
  const unit = el.querySelector('.field-unit');
  if (!unit) return;
  unit.classList.add('deploy-anim');
  setTimeout(() => unit.classList.remove('deploy-anim'), 500);
}

function animateKO(side, slotIndex) {
  const el = getSlotElement(side, slotIndex);
  if (!el) return;
  const unit = el.querySelector('.field-unit');
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
// ABILITY BUTTON (double-click on own unit)
// ========================

// Right-click on player field unit = use ability
document.getElementById('player-field').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const slot = e.target.closest('.field-slot');
  if (!slot) return;
  const slotIndex = parseInt(slot.dataset.slot);
  const unit = battleData.playerField[slotIndex];
  if (!unit || !unit.alive || unit.usedAbility || unit.stunned) return;

  const abilityCost = Math.ceil(unit.mana_cost / 2);
  if (battleData.playerEnergy < abilityCost) {
    showInstruction(`Pas assez d'energie pour l'ability (${abilityCost})`);
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
  sessionStorage.removeItem('deckBattleData');
  sessionStorage.removeItem('opponentName');
  window.location.href = '/combat';
}

// ESC to cancel action
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cancelAction();
});

// Click outside popup to close
document.addEventListener('click', (e) => {
  if (actionPopupSlot !== null && !e.target.closest('.action-popup') && !e.target.closest('.field-slot')) {
    closeActionPopup();
    cancelAction();
  }
});

init();
