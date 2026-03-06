// === Gestion des onglets ===
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.form-panel').forEach(f => f.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab + '-form').classList.add('active');
  });
});

// === Connexion ===
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('login-msg');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    msg.textContent = 'Remplissez tous les champs.';
    msg.className = 'message error';
    return;
  }

  msg.textContent = 'Connexion en cours...';
  msg.className = 'message';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.success) {
      msg.textContent = 'Accès autorisé. Redirection...';
      msg.className = 'message success';
      setTimeout(() => window.location.href = '/menu', 800);
    } else {
      msg.textContent = data.error;
      msg.className = 'message error';
    }
  } catch {
    msg.textContent = 'Erreur de connexion au serveur.';
    msg.className = 'message error';
  }
});

// === Inscription ===
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('reg-msg');
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const password2 = document.getElementById('reg-password2').value;

  if (!username || !password || !password2) {
    msg.textContent = 'Remplissez tous les champs.';
    msg.className = 'message error';
    return;
  }

  if (password !== password2) {
    msg.textContent = 'Les mots de passe ne correspondent pas.';
    msg.className = 'message error';
    return;
  }

  msg.textContent = 'Création du compte...';
  msg.className = 'message';

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.success) {
      msg.textContent = 'Compte créé ! Redirection...';
      msg.className = 'message success';
      setTimeout(() => window.location.href = '/menu', 800);
    } else {
      msg.textContent = data.error;
      msg.className = 'message error';
    }
  } catch {
    msg.textContent = 'Erreur de connexion au serveur.';
    msg.className = 'message error';
  }
});
