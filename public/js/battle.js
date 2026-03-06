// battle.js — Turn-based battle with animations

let battleData = null;
let battleType = 'campaign';
let selectedAttacker = null;
let selectedTarget = null;
let isAnimating = false;

function init() {
  const stored = sessionStorage.getItem('battleData');
  battleType = sessionStorage.getItem('battleType') || 'campaign';

  if (!stored) {
    window.location.href = '/combat';
    return;
  }

  battleData = JSON.parse(stored);
  renderBattle();
}

function renderBattle() {
  if (!battleData) return;

  document.getElementById('battle-turn').textContent = `Tour ${battleData.turn}`;

  // Render enemy team
  const enemyDiv = document.getElementById('enemy-team');
  enemyDiv.innerHTML = battleData.enemyTeam.map((unit, i) => `
    <div class="battle-card-wrapper ${!unit.alive ? 'wrapper-ko' : ''}" data-side="enemy" data-index="${i}" onclick="selectTarget(${i})">
      ${renderBattleCard(unit)}
    </div>
  `).join('');

  // Render player team
  const playerDiv = document.getElementById('player-team');
  playerDiv.innerHTML = battleData.playerTeam.map((unit, i) => `
    <div class="battle-card-wrapper ${!unit.alive ? 'wrapper-ko' : ''}" data-side="player" data-index="${i}" onclick="selectAttacker(${i})">
      ${renderBattleCard(unit)}
    </div>
  `).join('');

  updateSelection();

  // Check if battle is over
  if (battleData.result) {
    setTimeout(() => showResult(), 500);
  }
}

function selectAttacker(index) {
  if (isAnimating || battleData.result) return;
  const unit = battleData.playerTeam[index];
  if (!unit || !unit.alive) return;

  selectedAttacker = index;
  selectedTarget = null;
  updateSelection();
  document.getElementById('battle-instruction').textContent = 'Selectionnez une cible ennemie';
  document.getElementById('attack-btn').classList.add('hidden');
}

function selectTarget(index) {
  if (isAnimating || battleData.result || selectedAttacker === null) return;
  const unit = battleData.enemyTeam[index];
  if (!unit || !unit.alive) return;

  selectedTarget = index;
  updateSelection();
  document.getElementById('battle-instruction').textContent = `${battleData.playerTeam[selectedAttacker].name} → ${unit.name}`;
  document.getElementById('attack-btn').classList.remove('hidden');
}

function updateSelection() {
  // Player cards
  document.querySelectorAll('#player-team .battle-card-wrapper').forEach(el => {
    const idx = parseInt(el.dataset.index);
    el.classList.toggle('selected-attacker', idx === selectedAttacker);
  });

  // Enemy cards
  document.querySelectorAll('#enemy-team .battle-card-wrapper').forEach(el => {
    const idx = parseInt(el.dataset.index);
    el.classList.toggle('selected-target', idx === selectedTarget);
  });
}

async function doAttack() {
  if (isAnimating || selectedAttacker === null || selectedTarget === null) return;
  isAnimating = true;

  document.getElementById('attack-btn').classList.add('hidden');

  try {
    const res = await fetch('/api/battle/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        battleId: battleData.battleId,
        attackerIndex: selectedAttacker,
        targetIndex: selectedTarget
      })
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error);
      isAnimating = false;
      return;
    }

    // Animate events
    await animateEvents(data.events);

    // Update battle data
    battleData.playerTeam = data.playerTeam;
    battleData.enemyTeam = data.enemyTeam;
    battleData.turn = data.turn;
    battleData.result = data.result;

    // Store updated data
    sessionStorage.setItem('battleData', JSON.stringify(battleData));

    selectedAttacker = null;
    selectedTarget = null;

    renderBattle();

  } catch (err) {
    alert('Erreur reseau');
  }

  isAnimating = false;
}

async function animateEvents(events) {
  const log = document.getElementById('battle-log');

  for (const event of events) {
    let text = '';
    let cssClass = 'log-normal';

    switch (event.type) {
      case 'attack':
        text = `${event.attacker} attaque ${event.target} → -${event.damage} PV`;
        cssClass = event.side === 'player' ? 'log-player-attack' : 'log-enemy-attack';
        showDamageFloat(event.targetIndex, event.damage, event.side === 'player' ? 'enemy' : 'player');
        animateAttack(event.attackerIndex, event.side === 'player' ? 'player' : 'enemy');
        break;
      case 'ability':
        text = `✦ ${event.unit} : ${event.ability} (${event.desc})`;
        cssClass = 'log-ability';
        break;
      case 'ability_damage':
        text = `✦ ${event.unit} : ${event.ability} → -${event.damage} sur ${event.target}`;
        cssClass = 'log-ability';
        break;
      case 'ability_aoe':
        text = `✦ ${event.unit} : ${event.ability} → -${event.damage} sur ${event.target}`;
        cssClass = 'log-ability';
        break;
      case 'ability_drain':
        text = `✦ ${event.unit} : ${event.ability} → -${event.damage} sur ${event.target}, +${event.heal} PV`;
        cssClass = 'log-ability';
        break;
      case 'ability_stun':
        text = `✦ ${event.unit} : ${event.ability} → ${event.target} etourdi !${event.damage ? ` (-${event.damage})` : ''}`;
        cssClass = 'log-ability';
        break;
      case 'ability_debuff':
        text = `✦ ${event.unit} : ${event.ability} → ${event.desc} sur ${event.target}`;
        cssClass = 'log-ability';
        break;
      case 'stunned':
        text = `${event.unit} est etourdi et ne peut pas agir !`;
        cssClass = 'log-stun';
        break;
      case 'ko':
        text = `💀 ${event.unit} est KO !`;
        cssClass = 'log-ko';
        break;
      case 'revive':
        text = `✨ ${event.unit} revient avec ${event.hp} PV !`;
        cssClass = 'log-revive';
        break;
    }

    if (text) {
      const entry = document.createElement('div');
      entry.className = `battle-log-entry ${cssClass}`;
      entry.textContent = text;
      log.appendChild(entry);
      log.scrollTop = log.scrollHeight;
    }

    await sleep(400);
  }
}

function showDamageFloat(targetIndex, damage, side) {
  const team = side === 'enemy' ? '#enemy-team' : '#player-team';
  const wrapper = document.querySelector(`${team} .battle-card-wrapper[data-index="${targetIndex}"]`);
  if (!wrapper) return;

  const float = document.createElement('div');
  float.className = 'damage-float';
  float.textContent = `-${damage}`;
  wrapper.appendChild(float);

  setTimeout(() => float.remove(), 1200);
}

function animateAttack(index, side) {
  const team = side === 'player' ? '#player-team' : '#enemy-team';
  const wrapper = document.querySelector(`${team} .battle-card-wrapper[data-index="${index}"]`);
  if (!wrapper) return;

  wrapper.classList.add('attack-anim');
  setTimeout(() => wrapper.classList.remove('attack-anim'), 500);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function screenFlash() {
  const flash = document.getElementById('screen-flash');
  flash.classList.remove('hidden');
  flash.classList.add('flash-active');
  setTimeout(() => { flash.classList.remove('flash-active'); flash.classList.add('hidden'); }, 400);
}

async function showResult() {
  // End battle on server
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

      let rewardText = `+${data.reward} CR`;
      if (data.droppedCard) {
        rewardText += `<br><br>Carte obtenue: <span style="color:${RARITY_COLORS[data.droppedCard.rarity].color}">${data.droppedCard.name}</span>`;
      }
      rewards.innerHTML = rewardText;

      screenFlash();
    } else {
      title.textContent = 'DEFAITE...';
      title.style.color = '#cc2222';
      box.classList.add('result-defeat');

      if (data.reward > 0) {
        rewards.textContent = `+${data.reward} CR (consolation)`;
      } else {
        rewards.textContent = '';
      }
    }
  } catch (err) {
    // Fallback if server error
    const overlay = document.getElementById('battle-result');
    overlay.classList.remove('hidden');
    document.getElementById('result-title').textContent = battleData.result === 'victory' ? 'VICTOIRE !' : 'DEFAITE...';
  }
}

function leaveBattle() {
  sessionStorage.removeItem('battleData');
  sessionStorage.removeItem('battleType');
  if (battleType === 'campaign') {
    window.location.href = '/campaign';
  } else {
    window.location.href = '/pvp';
  }
}

init();
