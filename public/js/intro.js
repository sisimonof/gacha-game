// === INTRO TERMINAL ===

const typingSound = new Audio('/audio/typing-sound.mp3');
typingSound.loop = true;
typingSound.volume = 0.6;

const lines = [
  { text: '> CONNEXION AU SERVEUR CENTRAL...', delay: 30 },
  { text: '> AUTHENTIFICATION REUSSIE.', delay: 30 },
  { text: '> DECHIFFREMENT DES ARCHIVES EN COURS...', delay: 30 },
  { text: '', pause: 500 },
  { text: '=== DOSSIER CONFIDENTIEL : PROJET GACHA ===', delay: 25 },
  { text: '=== NIVEAU D\'HABILITATION : MAXIMUM ===', delay: 25 },
  { text: '', pause: 400 },
  { text: 'Avant les civilisations, avant les royaumes,', delay: 35 },
  { text: 'il existait un monde primitif nomme l\'ARCANAE.', delay: 35 },
  { text: '', pause: 300 },
  { text: 'Des creatures aux pouvoirs inimaginables y regnaient :', delay: 35 },
  { text: 'Guerriers de flammes, Mages d\'ombre,', delay: 35 },
  { text: 'Betes ancestrales et Divinites oubliees.', delay: 35 },
  { text: '', pause: 300 },
  { text: 'Pendant des millenaires, elles se livraient', delay: 35 },
  { text: 'une guerre eternelle pour le controle', delay: 35 },
  { text: 'des CRISTAUX DIMENSIONNELS — la source', delay: 35 },
  { text: 'de toute magie connue.', delay: 35 },
  { text: '', pause: 500 },
  { text: '> ARCHIVES CHRONOLOGIQUES :', delay: 25 },
  { text: '', pause: 200 },
  { text: 'An 0 — L\'EVENEMENT.', delay: 40 },
  { text: 'Une faille colossale s\'ouvrit entre les dimensions.', delay: 35 },
  { text: 'L\'Arcanae entier fut aspire dans le vide.', delay: 35 },
  { text: 'Les creatures furent emprisonnees', delay: 35 },
  { text: 'dans des cartes mystiques, scellees a jamais.', delay: 35 },
  { text: '', pause: 400 },
  { text: 'An 1024 — LA REDECOUVERTE.', delay: 40 },
  { text: 'Un groupe d\'archeologues decouvre les premieres', delay: 35 },
  { text: 'cartes dans les ruines d\'un temple sous-marin.', delay: 35 },
  { text: 'Les creatures a l\'interieur sont... vivantes.', delay: 40 },
  { text: '', pause: 400 },
  { text: 'An 1031 — LE PROGRAMME INVOCATEUR.', delay: 40 },
  { text: 'Les gouvernements creent un protocole secret.', delay: 35 },
  { text: 'Des agents specieux, les INVOCATEURS, sont recrutes', delay: 35 },
  { text: 'pour collecter, maitriser et deployer ces cartes.', delay: 35 },
  { text: '', pause: 500 },
  { text: 'An 1031, Jour 1 — AUJOURD\'HUI.', delay: 40 },
  { text: '', pause: 300 },
  { text: 'Vous avez ete selectionne.', delay: 45 },
  { text: 'Vous etes un Invocateur.', delay: 45 },
  { text: '', pause: 400 },
  { text: 'Votre mission :', delay: 40 },
  { text: '  > Collecter les cartes les plus puissantes', delay: 30 },
  { text: '  > Forger un deck redoutable a la FORGE', delay: 30 },
  { text: '  > Explorer les MINES pour extraire des ressources', delay: 30 },
  { text: '  > Affronter d\'autres Invocateurs en DUEL', delay: 30 },
  { text: '  > Rejoindre une GUILDE pour dominer ensemble', delay: 30 },
  { text: '  > Prouver votre suprematie au CLASSEMENT', delay: 30 },
  { text: '', pause: 500 },
  { text: '> SYSTEME D\'INVOCATION INITIALISE.', delay: 30 },
  { text: '> BOOSTERS DISPONIBLES DETECTES.', delay: 30 },
  { text: '> CASINO OPERATIONNEL.', delay: 30 },
  { text: '> MINE D\'EXTRACTION EN LIGNE.', delay: 30 },
  { text: '> MARCHE NOIR ACCESSIBLE.', delay: 30 },
  { text: '', pause: 400 },
  { text: '> ATTENTION : D\'autres Invocateurs sont deja actifs.', delay: 30 },
  { text: '> La competition sera rude.', delay: 30 },
  { text: '', pause: 300 },
  { text: '> VOTRE AVENTURE COMMENCE MAINTENANT.', delay: 30 },
  { text: '', pause: 300 },
  { text: '[ Passez a l\'entrainement pour maitriser les bases ]', delay: 25 },
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
  window.location.href = '/tutorial';
}

function skipIntro() {
  aborted = true;
  stopSound();
  localStorage.setItem('introSeen', 'true');
  window.location.href = '/tutorial';
}

// Demarre l'intro
runIntro();
