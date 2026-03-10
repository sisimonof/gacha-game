// === AUTH TERMINAL ===

const typingSound = new Audio('/audio/typing-sound.mp3');
typingSound.loop = true;
typingSound.volume = 0.6;

const titleScreen = document.getElementById('title-screen');
const terminal = document.getElementById('auth-terminal');
const textEl = document.getElementById('auth-text');
const cursorEl = document.getElementById('auth-cursor');
const bodyEl = document.getElementById('auth-body');

let aborted = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function startSound() {
  typingSound.play().catch(() => {});
}

function stopSound() {
  typingSound.pause();
}

function scrollToBottom() {
  bodyEl.scrollTop = bodyEl.scrollHeight;
}

// --- Typewriter : tape une ligne caractere par caractere ---
async function typeLine(text, delay = 30) {
  if (aborted) return;

  if (text === '') {
    textEl.innerHTML += '<br>';
    stopSound();
    await sleep(300);
    return;
  }

  startSound();

  const span = document.createElement('span');
  if (text.startsWith('>') || text.startsWith('===') || text.startsWith('[')) {
    span.classList.add('intro-line-system');
  }
  textEl.appendChild(span);

  for (let i = 0; i < text.length; i++) {
    if (aborted) return;
    span.textContent += text[i];
    scrollToBottom();
    await sleep(delay);
  }

  textEl.innerHTML += '<br>';
  stopSound();
  await sleep(60);
}

// --- Affiche un input dans le terminal, retourne la valeur saisie ---
function showInput(type = 'text', placeholder = '') {
  return new Promise(resolve => {
    // Cache le curseur pendant l'input
    cursorEl.classList.add('hidden');

    const wrapper = document.createElement('div');
    wrapper.classList.add('auth-input-line');

    const prompt = document.createElement('span');
    prompt.classList.add('intro-line-system');
    prompt.textContent = '> ';

    const input = document.createElement('input');
    input.type = type;
    input.className = 'auth-input';
    input.placeholder = placeholder;
    input.autocomplete = type === 'password' ? 'new-password' : 'username';

    wrapper.appendChild(prompt);
    wrapper.appendChild(input);
    textEl.appendChild(wrapper);

    scrollToBottom();
    input.focus();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = input.value.trim();
        if (!value) return;

        // Remplace l'input par le texte tape (masque si password)
        const display = type === 'password' ? '*'.repeat(value.length) : value;
        wrapper.innerHTML = '';
        const line = document.createElement('span');
        line.textContent = '> ' + display;
        wrapper.appendChild(line);
        textEl.innerHTML += '<br>';

        // Remontre le curseur
        cursorEl.classList.remove('hidden');
        scrollToBottom();

        resolve(value);
      }
    });
  });
}

// --- Affiche un message d'erreur en rouge ---
async function typeError(text) {
  const span = document.createElement('span');
  span.classList.add('auth-error-line');
  span.textContent = text;
  textEl.appendChild(span);
  textEl.innerHTML += '<br>';
  scrollToBottom();
  await sleep(500);
}

// --- API calls ---
async function checkUsername(username) {
  const res = await fetch('/api/check-username', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  return res.json();
}

async function doLogin(username, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return res.json();
}

async function doRegister(username, password) {
  const res = await fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return res.json();
}

// --- Affiche un choix 1/2 dans le terminal ---
function showChoice(option1, option2) {
  return new Promise(resolve => {
    cursorEl.classList.add('hidden');

    const wrapper = document.createElement('div');
    wrapper.classList.add('auth-input-line');

    const prompt = document.createElement('span');
    prompt.classList.add('intro-line-system');
    prompt.textContent = '> ';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'auth-input';
    input.placeholder = '1 ou 2...';
    input.maxLength = 1;

    wrapper.appendChild(prompt);
    wrapper.appendChild(input);
    textEl.appendChild(wrapper);

    scrollToBottom();
    input.focus();

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = input.value.trim();
        if (value !== '1' && value !== '2') return;

        wrapper.innerHTML = '';
        const line = document.createElement('span');
        line.textContent = '> ' + value + ' — ' + (value === '1' ? option1 : option2);
        wrapper.appendChild(line);
        textEl.innerHTML += '<br>';

        cursorEl.classList.remove('hidden');
        scrollToBottom();

        resolve(parseInt(value));
      }
    });
  });
}

// --- Flow principal ---
async function runAuthFlow() {
  await typeLine('> Connexion au serveur central...', 25);
  await typeLine('> Terminal d\'acces securise.', 25);
  await typeLine('', 0);
  await typeLine('Bienvenue, agent.', 35);
  await typeLine('', 0);

  // === CHOIX : NOUVEAU OU EXISTANT ===
  await typeLine('> Etes-vous un nouvel agent ?', 30);
  await typeLine('  [1] Oui, je suis nouveau', 20);
  await typeLine('  [2] Non, j\'ai deja un compte', 20);
  await typeLine('', 0);

  const choice = await showChoice('Nouvel agent', 'Agent existant');

  if (choice === 2) {
    // ========================
    //  CONNEXION (agent existant)
    // ========================
    await typeLine('', 0);
    await typeLine('> Identification requise.', 30);
    await typeLine('> Entrez votre identifiant :', 30);
    const username = await showInput('text', 'Votre pseudo...');

    if (username.length < 3 || username.length > 20) {
      await typeError('! ERREUR : L\'identifiant doit contenir 3 a 20 caracteres.');
      await sleep(1500);
      window.location.reload();
      return;
    }

    await typeLine('> Verification...', 25);
    await sleep(400);

    const { exists } = await checkUsername(username);

    if (!exists) {
      await typeError('! ERREUR : Identifiant inconnu.');
      await typeLine('> Aucun agent enregistre sous ce nom.', 25);
      await sleep(2000);
      window.location.reload();
      return;
    }

    await typeLine('> Identifiant reconnu.', 30);
    await typeLine('> Entrez votre code d\'acces :', 30);

    let loginOk = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const password = await showInput('password', 'Code d\'acces...');
      const result = await doLogin(username, password);

      if (result.success) {
        if (result.authToken) localStorage.setItem('authToken', result.authToken);
        loginOk = true;
        break;
      } else {
        const remaining = 2 - attempt;
        if (remaining > 0) {
          await typeError('! Code incorrect. ' + remaining + ' tentative(s) restante(s).');
        } else {
          await typeError('! Acces refuse. Trop de tentatives.');
          await sleep(2000);
          window.location.reload();
          return;
        }
      }
    }

    if (loginOk) {
      await typeLine('', 0);
      await typeLine('> Authentification reussie.', 25);
      await typeLine('> Connexion en cours...', 25);
      stopSound();
      await sleep(1000);
      window.location.href = '/menu';
    }

  } else {
    // ========================
    //  INSCRIPTION (nouvel agent)
    // ========================
    await typeLine('', 0);
    await typeLine('> Bienvenue dans le programme GACHA.', 30);
    await typeLine('> Enregistrement d\'un nouvel agent.', 30);
    await typeLine('', 0);

    // Pseudo
    await typeLine('> Choisissez votre identifiant :', 30);
    const username = await showInput('text', 'Votre pseudo...');

    if (username.length < 3 || username.length > 20) {
      await typeError('! ERREUR : L\'identifiant doit contenir 3 a 20 caracteres.');
      await sleep(1500);
      window.location.reload();
      return;
    }

    await typeLine('> Verification de disponibilite...', 25);
    await sleep(400);

    const { exists } = await checkUsername(username);

    if (exists) {
      await typeError('! ERREUR : Cet identifiant est deja pris.');
      await typeLine('> Choisissez un autre identifiant.', 25);
      await sleep(2000);
      window.location.reload();
      return;
    }

    await typeLine('> Identifiant disponible.', 25);
    await typeLine('', 0);

    // Mot de passe
    await typeLine('> Creez votre code d\'acces :', 30);
    await typeLine('  (6 caracteres minimum, 1 majuscule requise)', 20);
    await typeLine('  (Retenez-le bien, il sera votre cle d\'acces)', 20);

    let password = null;

    while (true) {
      const pwd = await showInput('password', 'Choisissez un code...');

      if (pwd.length < 6) {
        await typeError('! ERREUR : 6 caracteres minimum.');
        await typeLine('> Reessayez :', 25);
        continue;
      }
      if (!/[A-Z]/.test(pwd)) {
        await typeError('! ERREUR : Au moins 1 majuscule requise.');
        await typeLine('> Reessayez :', 25);
        continue;
      }

      // Confirmation
      await typeLine('> Confirmez votre code :', 30);
      const pwd2 = await showInput('password', 'Confirmez le code...');

      if (pwd !== pwd2) {
        await typeError('! ERREUR : Les codes ne correspondent pas.');
        await typeLine('> Recommencez :', 25);
        continue;
      }

      password = pwd;
      break;
    }

    await typeLine('> Creation du profil...', 25);
    await sleep(400);

    const result = await doRegister(username, password);

    if (result.success) {
      if (result.authToken) localStorage.setItem('authToken', result.authToken);
      await typeLine('> Profil cree avec succes.', 25);
      await typeLine('> Bienvenue, agent ' + username + '.', 30);
      await typeLine('> Initialisation du briefing...', 25);
      stopSound();
      await sleep(1200);
      window.location.href = '/tutorial';
    } else {
      await typeError('! ERREUR : ' + (result.error || 'Echec de la creation.'));
      await sleep(2000);
      window.location.reload();
    }
  }
}

// --- Bouton ENTRER ---
document.getElementById('enter-btn').addEventListener('click', () => {
  // Anime la disparition du titre
  titleScreen.classList.add('auth-fade-out');

  setTimeout(() => {
    titleScreen.classList.add('auth-hidden');
    terminal.classList.remove('auth-hidden');
    terminal.classList.add('auth-fade-in');

    // Lance le flow d'authentification
    runAuthFlow();
  }, 600);
});
