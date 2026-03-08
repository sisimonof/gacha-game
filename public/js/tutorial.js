// === TUTORIAL ===
const tutBody = document.getElementById('tut-body');
const tutFooter = document.getElementById('tut-footer');

const typingSound = new Audio('/audio/typing-sound.mp3');
typingSound.loop = true;
typingSound.volume = 0.6;

let aborted = false;
let tutCards = [];
let username = '';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function startSound() { if (!aborted) typingSound.play().catch(() => {}); }
function stopSound() { typingSound.pause(); }

// --- Typewriter ---
async function typeLine(container, text, delay = 30) {
  if (aborted) return;
  if (text === '') { container.innerHTML += '<br>'; stopSound(); await sleep(300); return; }
  startSound();
  const span = document.createElement('span');
  if (text.startsWith('>') || text.startsWith('===') || text.startsWith('[')) span.classList.add('intro-line-system');
  container.appendChild(span);
  for (let i = 0; i < text.length; i++) {
    if (aborted) return;
    span.textContent += text[i];
    container.scrollTop = container.scrollHeight;
    await sleep(delay);
  }
  container.innerHTML += '<br>';
  stopSound();
  await sleep(60);
}

// --- Wait for click on element ---
function waitClick(el) {
  return new Promise(r => el.addEventListener('click', r, { once: true }));
}

// --- Continue button ---
function showContinueBtn() {
  return new Promise(resolve => {
    const btn = document.createElement('button');
    btn.className = 'tut-btn tut-fade-in';
    btn.textContent = 'CONTINUER ▶';
    btn.onclick = () => { btn.remove(); resolve(); };
    tutBody.appendChild(btn);
    tutBody.scrollTop = tutBody.scrollHeight;
  });
}

// --- Fetch username ---
async function fetchUsername() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    username = data.username || 'Agent';
  } catch(e) { username = 'Agent'; }
}

// ===========================================
// ÉTAPE 0 : BOOT
// ===========================================
async function step0_boot() {
  if (aborted) return;
  tutBody.innerHTML = '<div class="tut-text" id="tut-text"></div><span class="intro-cursor">█</span>';
  const txt = document.getElementById('tut-text');

  const lines = [
    '> PROTOCOLE D\'ENTRAINEMENT... ACTIVE',
    '> Chargement des modules...',
    '> Module CARTES.............. OK',
    '> Module COMBAT.............. OK',
    '> Module INVOCATION.......... OK',
    '',
    `> Bienvenue, agent ${username}.`,
    '> Avant de partir au combat, vous devez',
    '> comprendre les bases.',
    ''
  ];

  for (const line of lines) {
    if (aborted) return;
    await typeLine(txt, line, 25);
  }
  stopSound();
  await sleep(800);
}

// ===========================================
// ÉTAPE 1 : PACK OPENING (vrai booster style shop)
// ===========================================
async function step1_pack() {
  if (aborted) return;
  tutBody.innerHTML = '<div class="tut-text" id="tut-text"></div>';
  const txt = document.getElementById('tut-text');

  await typeLine(txt, '> Un pack d\'entrainement vous a ete attribue.', 25);
  await typeLine(txt, '> Cliquez dessus pour l\'ouvrir.', 25);
  await sleep(300);

  // Show real booster pack (same style as shop)
  const packZone = document.createElement('div');
  packZone.className = 'tut-pack-zone';
  packZone.innerHTML = `
    <div class="tut-pack-label">PACK D'ENTRAINEMENT</div>
    <div class="tut-booster-card" id="tut-pack">
      <div class="booster-badge tut-badge-training">GRATUIT</div>
      <div class="booster-img-wrap">
        <img src="/img/booster-origines.png" alt="Pack Entrainement" class="booster-card-img" draggable="false">
      </div>
      <div class="booster-card-info">
        <span class="booster-card-name">Pack Origines</span>
        <span class="booster-card-count">5 cartes</span>
      </div>
    </div>
  `;
  tutBody.appendChild(packZone);
  tutBody.scrollTop = tutBody.scrollHeight;

  const pack = document.getElementById('tut-pack');
  await waitClick(pack);

  // Call API first so cards are ready
  try {
    const res = await fetch('/api/tutorial/open-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    if (data.cards) tutCards = data.cards;
  } catch(e) { console.error('Tutorial pack error:', e); }

  // Replace booster with tear animation (like shop)
  packZone.innerHTML = `
    <div class="tut-tear-container" id="tut-tear-container">
      <div class="tear-half tear-left" style="background-image:url(/img/booster-origines.png)"></div>
      <div class="tear-half tear-right" style="background-image:url(/img/booster-origines.png)"></div>
      <div class="tear-glow"></div>
    </div>
  `;
  const tearContainer = document.getElementById('tut-tear-container');

  // Phase 1: Shake
  tearContainer.classList.add('shaking');
  await sleep(1200);

  // Phase 2: Flash + Tear
  const flash = document.createElement('div');
  flash.className = 'tut-flash';
  document.body.appendChild(flash);
  tearContainer.classList.remove('shaking');
  tearContainer.classList.add('tearing');
  await sleep(800);
  flash.remove();

  // Remove tear, show cards
  packZone.remove();

  if (tutCards.length === 0) {
    await typeLine(txt, '> Erreur lors de l\'ouverture. Continuons...', 25);
    await sleep(1000);
    return;
  }

  // Real card reveal (same as shop: card-slam then click-to-flip)
  const revealZone = document.createElement('div');
  revealZone.className = 'tut-reveal-scene';
  revealZone.innerHTML = '<h2 class="reveal-title">OUVERTURE...</h2><div class="tut-cards-reveal" id="tut-cards-reveal"></div>';
  tutBody.appendChild(revealZone);

  const cardsContainer = document.getElementById('tut-cards-reveal');
  let revealed = 0;

  // Slam cards face-down one by one
  for (let i = 0; i < tutCards.length; i++) {
    if (aborted) return;
    const card = tutCards[i];
    const r = RARITY_COLORS[card.rarity];
    const cardEl = document.createElement('div');
    cardEl.className = 'reveal-card waiting';
    cardEl.dataset.index = i;
    cardEl.innerHTML = `
      <div class="card-inner">
        <div class="card-back">
          <div class="card-back-pattern"></div>
          <span>?</span>
        </div>
        <div class="card-front rarity-${card.rarity}" style="border-color:${r.color}; box-shadow:0 0 20px ${r.glow}">
          ${renderCardFront(card)}
        </div>
      </div>
    `;
    cardsContainer.appendChild(cardEl);

    // Slam animation
    await sleep(150);
    cardEl.classList.remove('waiting');
    cardEl.classList.add('card-slam');
  }

  await sleep(400);

  // Make cards clickable
  const allCards = cardsContainer.querySelectorAll('.reveal-card');
  allCards.forEach((cardEl, i) => {
    cardEl.classList.add('clickable');
    cardEl.addEventListener('click', () => {
      if (cardEl.classList.contains('revealed')) return;
      cardEl.classList.remove('clickable');
      cardEl.classList.add('revealed');
      revealed++;

      // Rarity glow flash
      const card = tutCards[i];
      const r = RARITY_COLORS[card.rarity];
      cardEl.style.filter = `drop-shadow(0 0 20px ${r.glow})`;
      setTimeout(() => { cardEl.style.filter = ''; }, 1000);

      if (revealed === tutCards.length) {
        setTimeout(() => {
          const contBtn = document.createElement('button');
          contBtn.className = 'tut-btn tut-fade-in';
          contBtn.textContent = 'CONTINUER ▶';
          contBtn.onclick = () => { contBtn.remove(); nextAfterPack(); };
          tutBody.appendChild(contBtn);
          tutBody.scrollTop = tutBody.scrollHeight;
        }, 600);
      }
    }, { once: true });
  });

  await typeLine(txt, '> Cliquez sur chaque carte pour la reveler !', 25);
  tutBody.scrollTop = tutBody.scrollHeight;
}

let packResolve;
function nextAfterPack() { if (packResolve) packResolve(); }

// ===========================================
// ÉTAPE 2 : ANATOMIE DE LA CARTE
// ===========================================
async function step2_cardAnatomy() {
  if (aborted) return;
  tutBody.innerHTML = '<div class="tut-text" id="tut-text"></div>';
  const txt = document.getElementById('tut-text');

  await typeLine(txt, '> Examinons une de vos nouvelles cartes.', 25);
  await sleep(300);

  // Pick first rare or any card
  const showCard = tutCards.find(c => c.rarity === 'rare') || tutCards[0];
  if (!showCard) { await showContinueBtn(); return; }

  const cardZone = document.createElement('div');
  cardZone.className = 'tut-anatomy-zone';

  cardZone.innerHTML = `
    <div class="tut-anatomy-wrapper">
      <div class="tut-annotations tut-annotations-left">
        <div class="tut-annot tut-annot-hidden" data-idx="0"><span class="tut-annot-line" style="color:${RARITY_COLORS[showCard.rarity].color}">◀ RARETE</span><span class="tut-annot-desc">Indique la puissance</span></div>
        <div class="tut-annot tut-annot-hidden" data-idx="1"><span class="tut-annot-line" style="color:#00ff41">◀ NOM</span><span class="tut-annot-desc">Identite de la carte</span></div>
        <div class="tut-annot tut-annot-hidden" data-idx="2"><span class="tut-annot-line" style="color:${ELEMENT_COLORS[showCard.element]}">◀ ELEMENT</span><span class="tut-annot-desc">${ELEMENT_ICONS[showCard.element]} ${ELEMENT_NAMES[showCard.element]}</span></div>
        <div class="tut-annot tut-annot-hidden" data-idx="6"><span class="tut-annot-line" style="color:#00cccc">◀ MANA</span><span class="tut-annot-desc">Cout pour deployer</span></div>
        <div class="tut-annot tut-annot-hidden" data-idx="7"><span class="tut-annot-line" style="color:#cc44ff">◀ POUVOIR</span><span class="tut-annot-desc">Capacite speciale</span></div>
        ${showCard.passive_desc ? '<div class="tut-annot tut-annot-hidden" data-idx="8"><span class="tut-annot-line" style="color:#ffcc00">◀ PASSIF</span><span class="tut-annot-desc">Effet permanent</span></div>' : ''}
      </div>
      <div class="tut-big-card collection-card rarity-${showCard.rarity}" id="tut-big-card">
        ${renderCardFront(showCard)}
      </div>
      <div class="tut-annotations tut-annotations-right">
        <div class="tut-annot tut-annot-hidden" data-idx="3"><span class="tut-annot-line" style="color:#ff4444">ATK ▶</span><span class="tut-annot-desc">Force d'attaque</span></div>
        <div class="tut-annot tut-annot-hidden" data-idx="4"><span class="tut-annot-line" style="color:#4488ff">DEF ▶</span><span class="tut-annot-desc">Resistance aux degats</span></div>
        <div class="tut-annot tut-annot-hidden" data-idx="5"><span class="tut-annot-line" style="color:#44dd44">PV ▶</span><span class="tut-annot-desc">Points de vie</span></div>
      </div>
    </div>
  `;

  tutBody.appendChild(cardZone);
  tutBody.scrollTop = tutBody.scrollHeight;

  // Reveal annotations one by one
  const annots = cardZone.querySelectorAll('.tut-annot');
  const sorted = Array.from(annots).sort((a, b) => +a.dataset.idx - +b.dataset.idx);
  for (const annot of sorted) {
    if (aborted) return;
    await sleep(500);
    annot.classList.remove('tut-annot-hidden');
    annot.classList.add('tut-fade-in');
    tutBody.scrollTop = tutBody.scrollHeight;
  }

  await sleep(400);
  await showContinueBtn();
}

// ===========================================
// ÉTAPE 3 : CHAMP DE BATAILLE
// ===========================================
async function step3_field() {
  if (aborted) return;
  tutBody.innerHTML = '<div class="tut-text" id="tut-text"></div>';
  const txt = document.getElementById('tut-text');

  await typeLine(txt, '> Voici le champ de bataille.', 25);
  await sleep(300);

  const fieldZone = document.createElement('div');
  fieldZone.className = 'tut-field-zone';
  fieldZone.innerHTML = `
    <div class="tut-field-label tut-field-label-enemy">ENNEMI</div>
    <div class="tut-field-row tut-field-enemy">
      <div class="tut-field-slot tut-slot-enemy" id="ts-e0"><span>FLANC G</span></div>
      <div class="tut-field-slot tut-slot-enemy" id="ts-e1"><span>CENTRE</span></div>
      <div class="tut-field-slot tut-slot-enemy" id="ts-e2"><span>FLANC D</span></div>
    </div>
    <div class="tut-field-vs">⚔ VS ⚔</div>
    <div class="tut-field-row tut-field-player">
      <div class="tut-field-slot tut-slot-player" id="ts-p0"><span>FLANC G</span></div>
      <div class="tut-field-slot tut-slot-player" id="ts-p1"><span>CENTRE</span></div>
      <div class="tut-field-slot tut-slot-player" id="ts-p2"><span>FLANC D</span></div>
    </div>
    <div class="tut-field-label tut-field-label-player">VOUS</div>
  `;

  tutBody.appendChild(fieldZone);
  tutBody.scrollTop = tutBody.scrollHeight;

  await sleep(600);

  // Animate a card sliding into a slot
  const demoCard = tutCards[0] || { name: 'Carte', emoji: '⚔' };
  const slot = document.getElementById('ts-p0');
  const cardEl = document.createElement('div');
  cardEl.className = 'tut-field-card tut-slide-up';
  cardEl.textContent = demoCard.emoji || ELEMENT_ICONS[demoCard.element] || '⚔';
  slot.appendChild(cardEl);

  await sleep(800);
  await typeLine(txt, '> Deployez vos cartes sur le terrain pour combattre.', 25);
  await sleep(500);

  // Highlight flanks
  document.getElementById('ts-p0').classList.add('tut-slot-highlight-atk');
  document.getElementById('ts-p2').classList.add('tut-slot-highlight-atk');
  await typeLine(txt, '> Les FLANCS donnent +1 ATK.', 25);
  await sleep(500);

  document.getElementById('ts-p0').classList.remove('tut-slot-highlight-atk');
  document.getElementById('ts-p2').classList.remove('tut-slot-highlight-atk');
  document.getElementById('ts-p1').classList.add('tut-slot-highlight-def');
  await typeLine(txt, '> Le CENTRE donne +1 DEF.', 25);
  await sleep(500);
  document.getElementById('ts-p1').classList.remove('tut-slot-highlight-def');

  await showContinueBtn();
}

// ===========================================
// ÉTAPE 4 : ÉNERGIE (MANA)
// ===========================================
async function step4_energy() {
  if (aborted) return;
  tutBody.innerHTML = '<div class="tut-text" id="tut-text"></div>';
  const txt = document.getElementById('tut-text');

  await typeLine(txt, '> Chaque action coute de l\'ENERGIE.', 25);
  await sleep(300);

  const energyZone = document.createElement('div');
  energyZone.className = 'tut-energy-zone';
  energyZone.innerHTML = `
    <div class="tut-energy-title">⚡ ENERGIE</div>
    <div class="tut-energy-bar" id="tut-energy-bar">
      <div class="tut-energy-segment" data-i="1">1</div>
      <div class="tut-energy-segment" data-i="2">2</div>
      <div class="tut-energy-segment" data-i="3">3</div>
      <div class="tut-energy-segment" data-i="4">4</div>
      <div class="tut-energy-segment" data-i="5">5</div>
      <div class="tut-energy-segment" data-i="6">6</div>
    </div>
    <div class="tut-energy-counter" id="tut-energy-counter">0 / 6</div>
  `;
  tutBody.appendChild(energyZone);
  tutBody.scrollTop = tutBody.scrollHeight;

  // Animate segments filling
  const segs = energyZone.querySelectorAll('.tut-energy-segment');
  const counter = document.getElementById('tut-energy-counter');
  for (let i = 0; i < segs.length; i++) {
    if (aborted) return;
    await sleep(400);
    segs[i].classList.add('tut-seg-active');
    counter.textContent = `${i + 1} / 6`;
  }

  await sleep(400);
  await typeLine(txt, '> Vous gagnez +1 ENERGIE max par tour.', 25);
  await typeLine(txt, '> Tour 1 = 1 NRJ, Tour 2 = 2 NRJ, Tour 3 = 3 NRJ...', 25);
  await typeLine(txt, '> Deployer une carte et attaquer coutent de l\'energie.', 25);

  await showContinueBtn();
}

// ===========================================
// ÉTAPE 5 : CRYSTAL
// ===========================================
async function step5_crystal() {
  if (aborted) return;
  tutBody.innerHTML = '<div class="tut-text" id="tut-text"></div>';
  const txt = document.getElementById('tut-text');

  await typeLine(txt, '> Le CRYSTAL active les POUVOIRS de vos cartes.', 25);
  await sleep(300);

  const crystalZone = document.createElement('div');
  crystalZone.className = 'tut-crystal-zone';
  crystalZone.innerHTML = `
    <div class="tut-crystal-icon">💎</div>
    <div class="tut-crystal-label">CRYSTAL</div>
    <div class="tut-crystal-bar">
      <div class="tut-crystal-fill" id="tut-crystal-fill"></div>
    </div>
    <div class="tut-crystal-counter" id="tut-crystal-counter">0.0 / 3.0</div>
  `;
  tutBody.appendChild(crystalZone);
  tutBody.scrollTop = tutBody.scrollHeight;

  // Animate crystal filling
  const fill = document.getElementById('tut-crystal-fill');
  const counter = document.getElementById('tut-crystal-counter');
  const steps = [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0];
  for (const val of steps) {
    if (aborted) return;
    await sleep(300);
    fill.style.width = `${(val / 3) * 100}%`;
    counter.textContent = `${val.toFixed(1)} / 3.0`;
  }

  await sleep(300);
  await typeLine(txt, '> Il se remplit lentement chaque tour (+0.3).', 25);
  await typeLine(txt, '> Utilisez-le pour declencher les capacites speciales !', 25);

  await showContinueBtn();
}

// ===========================================
// ÉTAPE 6 : ATTAQUE
// ===========================================
async function step6_attack() {
  if (aborted) return;
  tutBody.innerHTML = '<div class="tut-text" id="tut-text"></div>';
  const txt = document.getElementById('tut-text');

  await typeLine(txt, '> Voyons comment fonctionne le combat.', 25);
  await sleep(300);

  const vsZone = document.createElement('div');
  vsZone.className = 'tut-vs-zone';
  vsZone.innerHTML = `
    <div class="tut-vs-card tut-vs-player" id="tut-atk-card">
      <div class="tut-vs-card-title">VOTRE CARTE</div>
      <div class="tut-vs-card-emoji">⚔</div>
      <div class="tut-vs-stats">
        <span style="color:#ff4444">ATK 3</span>
        <span style="color:#4488ff">DEF 2</span>
      </div>
    </div>
    <div class="tut-vs-middle">
      <div class="tut-vs-icon">⚡</div>
    </div>
    <div class="tut-vs-card tut-vs-enemy" id="tut-def-card">
      <div class="tut-vs-card-title">CARTE ENNEMIE</div>
      <div class="tut-vs-card-emoji">👹</div>
      <div class="tut-vs-stats">
        <span style="color:#ff4444">ATK 2</span>
        <span style="color:#4488ff">DEF 1</span>
      </div>
      <div class="tut-vs-hp">
        <div class="tut-vs-hp-bar"><div class="tut-vs-hp-fill" id="tut-hp-fill" style="width:100%"></div></div>
        <span class="tut-vs-hp-text" id="tut-hp-text">PV 4/4</span>
      </div>
    </div>
  `;
  tutBody.appendChild(vsZone);
  tutBody.scrollTop = tutBody.scrollHeight;

  await sleep(800);

  // Attack animation
  const atkCard = document.getElementById('tut-atk-card');
  atkCard.classList.add('tut-attack-pulse');
  await sleep(600);

  // Show calculation
  const calcDiv = document.createElement('div');
  calcDiv.className = 'tut-calc tut-fade-in';
  calcDiv.innerHTML = `
    <div class="tut-calc-line tut-calc-title">ATTAQUE !</div>
    <div class="tut-calc-line">ATK <span style="color:#ff4444">3</span> - DEF <span style="color:#4488ff">1</span> = <span style="color:#ffaa00">2 DEGATS</span></div>
  `;
  vsZone.appendChild(calcDiv);

  await sleep(400);

  // Enemy HP drops
  const hpFill = document.getElementById('tut-hp-fill');
  const hpText = document.getElementById('tut-hp-text');
  hpFill.style.width = '50%';
  hpFill.style.background = '#ffaa00';
  hpText.textContent = 'PV 2/4';
  hpText.style.color = '#ffaa00';

  const defCard = document.getElementById('tut-def-card');
  defCard.classList.add('tut-hit-shake');

  atkCard.classList.remove('tut-attack-pulse');

  await sleep(600);
  await typeLine(txt, '> Degats = ATK attaquant - DEF defenseur (min 1)', 25);

  await showContinueBtn();
}

// ===========================================
// ÉTAPE 7 : VICTOIRE
// ===========================================
async function step7_victory() {
  if (aborted) return;
  tutBody.innerHTML = '<div class="tut-text" id="tut-text"></div>';
  const txt = document.getElementById('tut-text');

  await typeLine(txt, '> Comment gagner ?', 25);
  await sleep(300);

  const vicZone = document.createElement('div');
  vicZone.className = 'tut-victory-zone';
  vicZone.innerHTML = `
    <div class="tut-avatar-side tut-avatar-player">
      <div class="tut-avatar-icon">🛡</div>
      <div class="tut-avatar-label">VOUS</div>
      <div class="tut-avatar-hp-bar"><div class="tut-avatar-hp-fill tut-avatar-hp-green" id="tut-player-hp" style="width:100%"></div></div>
      <div class="tut-avatar-hp-text">20/20 PV</div>
    </div>
    <div class="tut-avatar-vs">VS</div>
    <div class="tut-avatar-side tut-avatar-enemy">
      <div class="tut-avatar-icon">💀</div>
      <div class="tut-avatar-label">ENNEMI</div>
      <div class="tut-avatar-hp-bar"><div class="tut-avatar-hp-fill tut-avatar-hp-red" id="tut-enemy-hp" style="width:100%"></div></div>
      <div class="tut-avatar-hp-text" id="tut-enemy-hp-text">20/20 PV</div>
    </div>
  `;
  tutBody.appendChild(vicZone);
  tutBody.scrollTop = tutBody.scrollHeight;

  await sleep(600);

  // Animate enemy HP dropping
  const enemyHp = document.getElementById('tut-enemy-hp');
  const enemyHpText = document.getElementById('tut-enemy-hp-text');
  const hpValues = [15, 10, 5, 0];
  for (const hp of hpValues) {
    if (aborted) return;
    await sleep(600);
    enemyHp.style.width = `${(hp / 20) * 100}%`;
    enemyHpText.textContent = `${hp}/20 PV`;
    if (hp <= 5) { enemyHp.style.background = '#ff4444'; }
    else if (hp <= 10) { enemyHp.style.background = '#ffaa00'; }
  }

  await sleep(300);
  await typeLine(txt, '> Si le terrain ennemi est VIDE, vos cartes', 25);
  await typeLine(txt, '> attaquent directement l\'AVATAR adverse.', 25);
  await typeLine(txt, '> Reduisez ses PV a 0 pour GAGNER !', 25);

  await showContinueBtn();
}

// ===========================================
// ÉTAPE 8 : FIN
// ===========================================
async function step8_end() {
  if (aborted) return;
  tutBody.innerHTML = '<div class="tut-text" id="tut-text"></div>';
  const txt = document.getElementById('tut-text');

  const endLines = [
    '> ENTRAINEMENT TERMINE.',
    '> Vos 5 cartes ont ete ajoutees a votre collection.',
    '',
    '> Conseil : ouvrez des BOOSTERS dans la BOUTIQUE',
    '> pour agrandir votre collection, puis construisez',
    '> un DECK de 20 cartes pour le COMBAT !',
    '',
    '> Bonne chance, Invocateur.'
  ];

  for (const line of endLines) {
    if (aborted) return;
    await typeLine(txt, line, 30);
  }
  stopSound();

  // Complete tutorial API
  try {
    await fetch('/api/tutorial/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  } catch(e) {}

  // Hide skip button
  document.getElementById('tut-skip').classList.add('hidden');

  await sleep(500);

  const btnZone = document.createElement('div');
  btnZone.className = 'tut-end-buttons tut-fade-in';
  btnZone.innerHTML = `
    <button class="tut-btn tut-btn-primary" onclick="window.location.href='/menu'">COMMENCER L'AVENTURE ▶</button>
    <button class="tut-btn tut-btn-secondary" onclick="window.location.href='/shop'">OUVRIR LA BOUTIQUE</button>
  `;
  tutBody.appendChild(btnZone);
  tutBody.scrollTop = tutBody.scrollHeight;
}

// ===========================================
// SKIP
// ===========================================
async function skipTutorial() {
  aborted = true;
  stopSound();
  try {
    // Still open the pack so they get cards
    await fetch('/api/tutorial/open-pack', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  } catch(e) {}
  try {
    await fetch('/api/tutorial/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  } catch(e) {}
  window.location.href = '/menu';
}

// ===========================================
// MAIN FLOW
// ===========================================
async function runTutorial() {
  await fetchUsername();

  await step0_boot();
  if (aborted) return;

  // Step 1 needs a promise for pack cards reveal
  const packDone = new Promise(r => { packResolve = r; });
  await step1_pack();
  if (aborted) return;
  await packDone;
  if (aborted) return;

  await step2_cardAnatomy();
  if (aborted) return;

  await step3_field();
  if (aborted) return;

  await step4_energy();
  if (aborted) return;

  await step5_crystal();
  if (aborted) return;

  await step6_attack();
  if (aborted) return;

  await step7_victory();
  if (aborted) return;

  await step8_end();
}

runTutorial();
