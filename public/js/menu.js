// === USER DATA ===
async function loadUser() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const data = await res.json();

    const displayName = data.displayName || data.username;

    // Profile sidebar
    const profileUser = document.getElementById('profile-username');
    if (profileUser) profileUser.textContent = displayName;
    const profileAvatar = document.getElementById('profile-avatar');
    if (profileAvatar) profileAvatar.textContent = data.avatar || '⚔';

    // Sidebar resources
    document.getElementById('stat-credits').textContent = data.credits;
    document.getElementById('stat-cards').textContent = data.cardCount;
    const essenceEl = document.getElementById('stat-essence');
    if (essenceEl) essenceEl.textContent = data.essence || 0;

    // XP Progress bar
    const bpTier = data.battlePassTier || 0;
    const tierXP = data.currentTierXP || 0;
    const tierReq = data.currentTierRequired || 100;
    document.getElementById('sidebar-bp-tier').textContent = bpTier;
    document.getElementById('sidebar-bp-xp').textContent = tierXP;
    document.getElementById('sidebar-bp-req').textContent = tierReq;
    const xpPct = bpTier >= 30 ? 100 : Math.min(100, Math.floor((tierXP / tierReq) * 100));
    document.getElementById('sidebar-xp-bar').style.width = xpPct + '%';

    // Apply profile frame on avatar
    const frameClass = data.profileFrame && data.profileFrame !== 'none' ? 'frame-' + data.profileFrame : '';
    const avatarEl = document.querySelector('.dash-profile-card .dash-avatar');
    if (avatarEl) {
      avatarEl.className = 'dash-avatar';
      if (frameClass) avatarEl.classList.add(frameClass);
    }

    // Store for settings modal
    window._currentAvatar = data.avatar || '⚔';
    window._currentDisplayName = displayName;
    window._unlockedAvatars = data.unlockedAvatars || ['⚔'];
    window._currentFrame = data.profileFrame || 'none';
    window._unlockedFrames = data.unlockedFrames || ['none'];

    // Apply username effect
    if (data.usernameEffect) {
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
  let rank = 'RECRUE';

  if (cardCount >= 100) rank = 'MAITRE';
  else if (cardCount >= 50) rank = 'VETERAN';
  else if (cardCount >= 20) rank = 'SOLDAT';

  rankLabels.forEach(el => el.textContent = rank);
}

// === COMBAT STATS ===
async function loadCombatStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('combat-wins').textContent = data.combat.wins;
    document.getElementById('combat-losses').textContent = data.combat.losses;
    document.getElementById('combat-winrate').textContent = data.combat.winRate + '%';
  } catch {}
}

// === DECKS PREVIEW ===
async function loadDecksPreview() {
  try {
    const res = await fetch('/api/decks');
    if (!res.ok) return;
    const decks = await res.json();
    const container = document.getElementById('decks-preview-list');

    if (decks.length === 0) {
      container.innerHTML = '<div class="dash-deck-empty" onclick="window.location.href=\'/decks\'">+ CREER UN DECK</div>';
      return;
    }

    container.innerHTML = decks.map(deck => {
      const preview = deck.cards.slice(0, 3).map(c => c.emoji || '🃏').join(' ');
      const cardCount = deck.cards.length;
      return `
        <div class="dash-deck-card" onclick="window.location.href='/decks'">
          <div class="dash-deck-name">${deck.name}</div>
          <div class="dash-deck-preview">${preview} <span class="dash-deck-count">(${cardCount})</span></div>
        </div>
      `;
    }).join('');
  } catch {}
}

// === QUETES ===
let questData = { daily: [], weekly: [], special: [] };
let activeQuestTab = 'daily';

async function loadQuests() {
  try {
    const res = await fetch('/api/quests');
    if (!res.ok) return;
    questData = await res.json();
    renderActiveQuests();
  } catch {}
}

function switchQuestTab(tab) {
  activeQuestTab = tab;
  document.getElementById('tab-daily').classList.toggle('quests-tab--active', tab === 'daily');
  document.getElementById('tab-weekly').classList.toggle('quests-tab--active', tab === 'weekly');
  const tabSpecial = document.getElementById('tab-special');
  if (tabSpecial) tabSpecial.classList.toggle('quests-tab--active', tab === 'special');
  renderActiveQuests();
}

function renderActiveQuests() {
  const quests = activeQuestTab === 'daily' ? questData.daily : (activeQuestTab === 'special' ? (questData.special || []) : questData.weekly);
  const container = document.getElementById('quests-grid');

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

// === SETTINGS MODAL ===
const AVATAR_LIST = [
  '⚔','🗡','🛡','🏹','🔮','💀','🐉','👑','🦅','🐺',
  '🦁','🔥','❄','⚡','🌙','☀','💎','🎭','👹','🧙',
  '🤖','👻','🦇','🐍','🦂','🌋','🌊','🌿','⭐','💫',
  '🏰','🗿','🎲','🃏','🪄','🧿','⛏','🦴','🕷','🎯'
];

let selectedAvatar = null;

const BP_AVATARS = ['🎖','🐲','👁‍🗨','🐦‍🔥','🏴‍☠️','🔱','👾'];

const PROFILE_FRAMES = {
  none:    { label: 'Aucun',       emoji: '⬜' },
  flames:  { label: 'Flammes',     emoji: '🔥' },
  glitch:  { label: 'Glitch',      emoji: '📺' },
  rainbow: { label: 'Arc-en-ciel', emoji: '🌈' },
  neon:    { label: 'Neon',        emoji: '💡' },
  frost:   { label: 'Givre',       emoji: '❄' },
  skull:   { label: 'Crane',       emoji: '💀' },
  diamond: { label: 'Diamant',     emoji: '💎' },
};

let selectedFrame = null;

function initFrameGrid() {
  const grid = document.getElementById('frame-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const unlockedFrames = window._unlockedFrames || ['none'];
  const currentFrame = window._currentFrame || 'none';

  Object.entries(PROFILE_FRAMES).forEach(([key, frame]) => {
    const unlocked = unlockedFrames.includes(key);
    const btn = document.createElement('button');
    btn.className = 'frame-option' + (unlocked ? '' : ' frame-option--locked') + (key === currentFrame ? ' frame-selected' : '');
    btn.dataset.frame = key;
    btn.innerHTML = '<span class="frame-option-emoji">' + frame.emoji + '</span><span class="frame-option-label">' + frame.label + '</span>';

    if (unlocked) {
      btn.addEventListener('click', () => selectFrame(key));
    } else {
      btn.title = 'Non debloque';
    }
    grid.appendChild(btn);
  });
}

function selectFrame(key) {
  selectedFrame = key;
  const previewAvatar = document.getElementById('settings-frame-preview-avatar');
  if (previewAvatar) {
    previewAvatar.className = 'dash-avatar settings-frame-avatar';
    if (key !== 'none') previewAvatar.classList.add('frame-' + key);
  }
  document.querySelectorAll('.frame-option').forEach(btn => {
    btn.classList.toggle('frame-selected', btn.dataset.frame === key);
  });
}

function initSettingsModal() {
  const grid = document.getElementById('avatar-grid');
  if (!grid) return;

  grid.innerHTML = '';
  const unlockedAvatars = window._unlockedAvatars || ['⚔'];

  AVATAR_LIST.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'avatar-option';
    btn.textContent = emoji;
    btn.addEventListener('click', () => selectAvatar(emoji));
    grid.appendChild(btn);
  });

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
  const previewIcon = document.getElementById('settings-frame-preview-icon');
  if (previewIcon) previewIcon.textContent = emoji;
  document.querySelectorAll('.avatar-option').forEach(btn => {
    btn.classList.toggle('avatar-selected', btn.textContent === emoji);
  });
}

function openSettings() {
  selectedAvatar = window._currentAvatar;
  selectedFrame = window._currentFrame || 'none';
  document.getElementById('settings-current-avatar').textContent = selectedAvatar;
  document.getElementById('settings-displayname').value = window._currentDisplayName;
  document.querySelectorAll('.avatar-option').forEach(btn => {
    btn.classList.toggle('avatar-selected', btn.textContent === selectedAvatar);
  });

  const previewIcon = document.getElementById('settings-frame-preview-icon');
  if (previewIcon) previewIcon.textContent = selectedAvatar;
  const previewAvatar = document.getElementById('settings-frame-preview-avatar');
  if (previewAvatar) {
    previewAvatar.className = 'dash-avatar settings-frame-avatar';
    if (selectedFrame !== 'none') previewAvatar.classList.add('frame-' + selectedFrame);
  }
  initFrameGrid();

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
  if (selectedFrame && selectedFrame !== window._currentFrame) {
    body.profileFrame = selectedFrame;
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
    if (data.profileFrame !== undefined) window._currentFrame = data.profileFrame;

    document.getElementById('profile-avatar').textContent = data.avatar;
    document.getElementById('profile-username').textContent = data.displayName;

    const mainAvatar = document.querySelector('.dash-profile-card .dash-avatar');
    if (mainAvatar) {
      mainAvatar.className = 'dash-avatar';
      if (window._currentFrame && window._currentFrame !== 'none') {
        mainAvatar.classList.add('frame-' + window._currentFrame);
      }
    }

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
loadCombatStats();
loadDecksPreview();
