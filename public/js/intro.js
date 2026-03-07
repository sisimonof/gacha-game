// === INTRO TERMINAL ===

const typingSound = new Audio('/audio/typing-sound.mp3');
typingSound.loop = true;
typingSound.volume = 0.6;

const lines = [
  { text: '> CONNEXION AU SERVEUR CENTRAL...', delay: 30 },
  { text: '> AUTHENTIFICATION REUSSIE.', delay: 30 },
  { text: '', pause: 400 },
  { text: '=== DOSSIER CONFIDENTIEL : PROJET GACHA ===', delay: 25 },
  { text: '', pause: 300 },
  { text: 'Il y a longtemps, dans un monde oublie des hommes,', delay: 35 },
  { text: 'existaient des creatures aux pouvoirs inimaginables.', delay: 35 },
  { text: '', pause: 300 },
  { text: 'Guerriers, mages, betes ancestrales et divinites', delay: 35 },
  { text: 'se livraient une guerre eternelle pour le controle', delay: 35 },
  { text: 'des cristaux dimensionnels.', delay: 35 },
  { text: '', pause: 400 },
  { text: 'Un jour, une faille s\'ouvrit entre les dimensions.', delay: 35 },
  { text: 'Les creatures furent aspirees et emprisonnees', delay: 35 },
  { text: 'dans des cartes mystiques, scellees a jamais.', delay: 35 },
  { text: '', pause: 400 },
  { text: 'Aujourd\'hui, ces cartes refont surface.', delay: 40 },
  { text: 'Vous etes un Invocateur.', delay: 40 },
  { text: '', pause: 300 },
  { text: 'Votre mission : collecter ces cartes,', delay: 35 },
  { text: 'assembler un deck redoutable,', delay: 35 },
  { text: 'et affronter d\'autres Invocateurs', delay: 35 },
  { text: 'pour prouver votre suprematie.', delay: 35 },
  { text: '', pause: 500 },
  { text: '> INITIALISATION DU SYSTEME...', delay: 30 },
  { text: '> BOOSTERS DISPONIBLES DETECTES.', delay: 30 },
  { text: '> VOTRE AVENTURE COMMENCE MAINTENANT.', delay: 30 },
  { text: '', pause: 400 },
  { text: '[ Ouvrez vos premiers boosters dans la BOUTIQUE ]', delay: 25 },
];

const textEl = document.getElementById('intro-text');
const cursorEl = document.getElementById('intro-cursor');
const enterBtn = document.getElementById('intro-enter');
const skipBtn = document.getElementById('intro-skip');

let isTyping = false;
let aborted = false;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startSound() {
  if (aborted) return;
  typingSound.play().catch(() => {});
}

function stopSound() {
  typingSound.pause();
}

async function typeLine(line) {
  if (aborted) return;

  // Ligne vide = saut de ligne avec pause
  if (line.text === '') {
    textEl.innerHTML += '<br>';
    stopSound();
    await sleep(line.pause || 300);
    return;
  }

  // Commence le son de typing
  startSound();
  isTyping = true;

  const span = document.createElement('span');

  // Style pour les lignes systeme
  if (line.text.startsWith('>') || line.text.startsWith('===') || line.text.startsWith('[')) {
    span.classList.add('intro-line-system');
  }

  textEl.appendChild(span);

  for (let i = 0; i < line.text.length; i++) {
    if (aborted) return;
    span.textContent += line.text[i];
    // Auto-scroll
    const body = document.getElementById('intro-body');
    body.scrollTop = body.scrollHeight;
    await sleep(line.delay || 35);
  }

  textEl.innerHTML += '<br>';
  isTyping = false;

  // Pause le son entre les lignes
  stopSound();
  await sleep(80);
}

async function runIntro() {
  for (const line of lines) {
    if (aborted) return;
    await typeLine(line);
  }

  // Fin de l'intro
  stopSound();
  cursorEl.classList.add('hidden');
  enterBtn.classList.remove('hidden');
  enterBtn.classList.add('intro-fade-in');
  skipBtn.classList.add('hidden');
}

function enterGame() {
  localStorage.setItem('introSeen', 'true');
  window.location.href = '/shop';
}

function skipIntro() {
  aborted = true;
  stopSound();
  localStorage.setItem('introSeen', 'true');
  window.location.href = '/menu';
}

// Demarre l'intro
runIntro();
