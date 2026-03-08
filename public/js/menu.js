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

// === QUETES ===
async function loadQuests() {
  try {
    const res = await fetch('/api/quests');
    if (!res.ok) return;
    const data = await res.json();
    renderQuests('daily-quests', data.daily);
    renderQuests('weekly-quests', data.weekly);
  } catch {}
}

function renderQuests(containerId, quests) {
  const container = document.getElementById(containerId);
  if (!quests || quests.length === 0) {
    container.innerHTML = '<div class="quest-empty">Aucune quete</div>';
    return;
  }

  container.innerHTML = quests.map(q => {
    const pct = Math.min(100, Math.floor((q.progress / q.goal) * 100));
    const done = q.progress >= q.goal;
    const claimed = q.claimed;

    return `
      <div class="quest-card ${claimed ? 'quest-claimed' : ''} ${done && !claimed ? 'quest-done' : ''}">
        <div class="quest-info">
          <div class="quest-label">${q.label}</div>
          <div class="quest-progress-text">${q.progress}/${q.goal}</div>
        </div>
        <div class="quest-bar-bg">
          <div class="quest-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="quest-reward">
          <span class="quest-reward-cr">+${q.reward_credits} CR</span>
          <span class="quest-reward-xp">+${q.reward_xp} XP</span>
          ${q.canClaim ? `<button class="quest-claim-btn" onclick="claimQuest(${q.id})">RECLAMER</button>` : ''}
          ${claimed ? '<span class="quest-check">&#10003;</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function claimQuest(questId) {
  try {
    const res = await fetch('/api/quests/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      document.getElementById('stat-credits').textContent = data.credits;
      document.getElementById('profile-credits').textContent = data.credits;
      loadQuests();
    }
  } catch {}
}

// === SUCCES ===
async function loadAchievements() {
  try {
    const res = await fetch('/api/achievements');
    if (!res.ok) return;
    const data = await res.json();
    renderAchievements(data.achievements);
  } catch {}
}

function renderAchievements(achievements) {
  const grid = document.getElementById('achievements-grid');
  grid.innerHTML = achievements.map(a => {
    let cls = 'achievement-badge';
    if (a.unlocked && a.claimed) cls += ' achievement--claimed';
    else if (a.unlocked) cls += ' achievement--unlocked';
    else cls += ' achievement--locked';

    return `
      <div class="${cls}">
        <div class="achievement-icon">${a.icon}</div>
        <div class="achievement-info">
          <div class="achievement-label">${a.label}</div>
          <div class="achievement-desc">${a.desc}</div>
          <div class="achievement-reward">+${a.credits} CR</div>
        </div>
        ${a.canClaim ? `<button class="achievement-claim-btn" onclick="claimAchievement('${a.key}')">RECLAMER</button>` : ''}
        ${a.claimed ? '<div class="achievement-check">&#10003;</div>' : ''}
      </div>
    `;
  }).join('');
}

async function claimAchievement(key) {
  try {
    const res = await fetch('/api/achievements/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ achievementKey: key })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      document.getElementById('stat-credits').textContent = data.credits;
      document.getElementById('profile-credits').textContent = data.credits;
      loadAchievements();
    }
  } catch {}
}

function openAchievements() {
  loadAchievements();
  document.getElementById('achievements-overlay').classList.add('active');
}

function closeAchievements() {
  document.getElementById('achievements-overlay').classList.remove('active');
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

// Achievements overlay
document.getElementById('achievements-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeAchievements();
});

// === THEME ===
function setTheme(theme) {
  if (theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('gacha-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem('gacha-theme');
  }
  updateThemeButtons();
}

function updateThemeButtons() {
  const current = localStorage.getItem('gacha-theme') || '';
  document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.remove('theme-active'));
  if (current === 'blue') document.getElementById('theme-blue')?.classList.add('theme-active');
  else if (current === 'rose') document.getElementById('theme-rose')?.classList.add('theme-active');
  else document.getElementById('theme-green')?.classList.add('theme-active');
}

// Init
initSettingsModal();
updateThemeButtons();
loadUser();
loadQuests();
