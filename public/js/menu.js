// === USER DATA ===
async function loadUser() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const data = await res.json();

    const displayName = data.displayName || data.username;

    // Navbar stats
    document.getElementById('username-display').textContent = displayName;
    document.getElementById('stat-credits').textContent = data.credits;
    document.getElementById('stat-cards').textContent = data.cardCount;

    // Profile sidebar
    const profileUser = document.getElementById('profile-username');
    if (profileUser) profileUser.textContent = displayName;
    const profileAvatar = document.getElementById('profile-avatar');
    if (profileAvatar) profileAvatar.textContent = data.avatar || '⚔';
    const profileCards = document.getElementById('profile-cards');
    if (profileCards) profileCards.textContent = data.cardCount;
    const profileCredits = document.getElementById('profile-credits');
    if (profileCredits) profileCredits.textContent = data.credits;
    const collDesc = document.getElementById('collection-desc');
    if (collDesc) collDesc.textContent = data.cardCount + ' cartes collectees';

    // Store for settings modal
    window._currentAvatar = data.avatar || '⚔';
    window._currentDisplayName = displayName;
    window._unlockedAvatars = data.unlockedAvatars || ['⚔'];

    // Apply username effect
    if (data.usernameEffect) {
      const usernameEl = document.getElementById('username-display');
      if (usernameEl) usernameEl.classList.add(data.usernameEffect);
      if (profileUser) profileUser.classList.add(data.usernameEffect);
    }

    // Rang
    updateRank(data.cardCount);

    // Check admin
    checkAdminAccess();
  } catch {
    window.location.href = '/';
  }
}

async function checkAdminAccess() {
  try {
    const res = await fetch('/api/admin/check');
    if (!res.ok) return;
    const data = await res.json();
    if (data.isAdmin) {
      const adminBtn = document.getElementById('admin-btn');
      if (adminBtn) adminBtn.classList.remove('hidden');
    }
  } catch {}
}

function updateRank(cardCount) {
  const rankLabels = document.querySelectorAll('.rank-label');
  const profileRank = document.getElementById('profile-rank');
  let rank = 'RECRUE';

  if (cardCount >= 100) rank = 'MAITRE';
  else if (cardCount >= 50) rank = 'VETERAN';
  else if (cardCount >= 20) rank = 'SOLDAT';

  rankLabels.forEach(el => el.textContent = rank);
  if (profileRank) profileRank.textContent = rank;
}

// === SETTINGS MODAL ===
const AVATAR_LIST = [
  '⚔','🗡','🛡','🏹','🔮','💀','🐉','👑','🦅','🐺',
  '🦁','🔥','❄','⚡','🌙','☀','💎','🎭','👹','🧙',
  '🤖','👻','🦇','🐍','🦂','🌋','🌊','🌿','⭐','💫',
  '🏰','🗿','🎲','🃏','🪄','🧿','⛏','🦴','🕷','🎯'
];

let selectedAvatar = null;

const BP_AVATARS = ['🎖','🐲','👁‍🗨','🐦‍🔥','🏴‍☠️','🔱','👾'];

function initSettingsModal() {
  const grid = document.getElementById('avatar-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const unlockedAvatars = window._unlockedAvatars || ['⚔'];

  // Free avatars
  AVATAR_LIST.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'avatar-option';
    btn.textContent = emoji;
    btn.addEventListener('click', () => selectAvatar(emoji));
    grid.appendChild(btn);
  });

  // BP exclusive avatars
  BP_AVATARS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'avatar-option avatar-option--bp';
    btn.textContent = emoji;
    if (unlockedAvatars.includes(emoji)) {
      btn.addEventListener('click', () => selectAvatar(emoji));
    } else {
      btn.classList.add('avatar-option--locked');
      btn.title = 'Passe de Combat';
    }
    grid.appendChild(btn);
  });
}

function selectAvatar(emoji) {
  selectedAvatar = emoji;
  document.getElementById('settings-current-avatar').textContent = emoji;
  document.querySelectorAll('.avatar-option').forEach(btn => {
    btn.classList.toggle('avatar-selected', btn.textContent === emoji);
  });
}

function openSettings() {
  selectedAvatar = window._currentAvatar;
  document.getElementById('settings-current-avatar').textContent = selectedAvatar;
  document.getElementById('settings-displayname').value = window._currentDisplayName;
  document.querySelectorAll('.avatar-option').forEach(btn => {
    btn.classList.toggle('avatar-selected', btn.textContent === selectedAvatar);
  });
  document.getElementById('settings-msg').textContent = '';
  document.getElementById('settings-overlay').classList.add('active');
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('active');
}

async function saveSettings() {
  const displayName = document.getElementById('settings-displayname').value.trim();
  const msgEl = document.getElementById('settings-msg');
  const saveBtn = document.getElementById('settings-save');
  msgEl.textContent = '';
  msgEl.className = 'settings-msg';

  const body = {};
  if (selectedAvatar && selectedAvatar !== window._currentAvatar) {
    body.avatar = selectedAvatar;
  }
  if (displayName && displayName !== window._currentDisplayName) {
    body.displayName = displayName;
  }

  if (Object.keys(body).length === 0) {
    msgEl.textContent = 'Aucun changement';
    msgEl.classList.add('info');
    return;
  }

  saveBtn.disabled = true;
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (!res.ok) {
      msgEl.textContent = data.error || 'Erreur';
      msgEl.classList.add('error');
      return;
    }

    window._currentAvatar = data.avatar;
    window._currentDisplayName = data.displayName;

    document.getElementById('profile-avatar').textContent = data.avatar;
    document.getElementById('profile-username').textContent = data.displayName;
    document.getElementById('username-display').textContent = data.displayName;

    msgEl.textContent = 'Sauvegarde !';
    msgEl.classList.add('success');
    setTimeout(() => closeSettings(), 1200);
  } catch {
    msgEl.textContent = 'Erreur reseau';
    msgEl.classList.add('error');
  } finally {
    saveBtn.disabled = false;
  }
}

// === EVENT LISTENERS ===

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// Patch Notes
document.getElementById('patchnotes-trigger').addEventListener('click', () => {
  document.getElementById('patchnotes-overlay').classList.add('active');
});
document.getElementById('patchnotes-close').addEventListener('click', () => {
  document.getElementById('patchnotes-overlay').classList.remove('active');
});
document.getElementById('patchnotes-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove('active');
});

// Settings
document.getElementById('settings-trigger').addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('settings-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeSettings();
});
document.getElementById('settings-save').addEventListener('click', saveSettings);

// Init
initSettingsModal();
loadUser();
