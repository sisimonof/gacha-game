async function loadUser() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const data = await res.json();
    document.getElementById('username-display').textContent = data.username;
    document.getElementById('stat-credits').textContent = data.credits;
    document.getElementById('stat-cards').textContent = data.cardCount;

    // Rang du joueur
    updateRank(data.cardCount);

    // Bonus quotidien
    if (!data.canClaimDaily) {
      const item = document.getElementById('daily-item');
      const btn = document.getElementById('daily-btn');
      const sub = document.getElementById('daily-sub');
      if (item) item.classList.add('daily-claimed');
      if (btn) btn.classList.add('daily-claimed');
      if (sub) sub.textContent = 'Demain';
    }

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

async function claimDaily() {
  const item = document.getElementById('daily-item');
  const btn = document.getElementById('daily-btn');
  const sub = document.getElementById('daily-sub');

  // Deja claimed
  if (item && item.classList.contains('daily-claimed')) return;

  try {
    const res = await fetch('/api/daily', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      if (item) item.classList.add('daily-claimed');
      if (btn) {
        btn.classList.add('daily-claimed');
        btn.classList.add('daily-flash');
      }
      if (sub) sub.textContent = 'Recu !';
      document.getElementById('stat-credits').textContent = data.credits;
    } else {
      if (item) item.classList.add('daily-claimed');
      if (btn) btn.classList.add('daily-claimed');
      if (sub) sub.textContent = 'Demain';
    }
  } catch {}
}

function updateRank(cardCount) {
  const rankLabel = document.querySelector('.rank-label');
  if (!rankLabel) return;

  if (cardCount >= 100) {
    rankLabel.textContent = 'MAITRE';
  } else if (cardCount >= 50) {
    rankLabel.textContent = 'VETERAN';
  } else if (cardCount >= 20) {
    rankLabel.textContent = 'SOLDAT';
  } else {
    rankLabel.textContent = 'RECRUE';
  }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// Patch Notes
document.getElementById('version-tag').addEventListener('click', () => {
  document.getElementById('patchnotes-overlay').classList.add('active');
});
document.getElementById('patchnotes-close').addEventListener('click', () => {
  document.getElementById('patchnotes-overlay').classList.remove('active');
});
document.getElementById('patchnotes-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.remove('active');
  }
});

loadUser();
