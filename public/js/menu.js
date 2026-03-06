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
    const dailyBtn = document.getElementById('daily-btn');
    if (!data.canClaimDaily) {
      dailyBtn.classList.add('daily-claimed');
      dailyBtn.disabled = true;
      dailyBtn.querySelector('.daily-text').innerHTML = 'DEJA RECUPERE<br><small>Revenez demain</small>';
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
  const btn = document.getElementById('daily-btn');
  btn.disabled = true;

  try {
    const res = await fetch('/api/daily', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      btn.classList.add('daily-claimed');
      btn.querySelector('.daily-text').innerHTML = 'RECUPERE !<br><small>+200 CR</small>';
      document.getElementById('stat-credits').textContent = data.credits;

      // Petit effet
      btn.classList.add('daily-flash');
    } else {
      btn.classList.add('daily-claimed');
      btn.querySelector('.daily-text').innerHTML = 'DEJA RECUPERE<br><small>Revenez demain</small>';
    }
  } catch {
    btn.disabled = false;
  }
}

function updateRank(cardCount) {
  const rankLabel = document.querySelector('.rank-label');
  const rankIcon = document.querySelector('.rank-icon');
  if (!rankLabel || !rankIcon) return;

  if (cardCount >= 100) {
    rankLabel.textContent = 'MAITRE';
    rankIcon.innerHTML = '&#9733;&#9733;&#9733;';
  } else if (cardCount >= 50) {
    rankLabel.textContent = 'VETERAN';
    rankIcon.innerHTML = '&#9733;&#9733;';
  } else if (cardCount >= 20) {
    rankLabel.textContent = 'SOLDAT';
    rankIcon.innerHTML = '&#9733;';
  } else {
    rankLabel.textContent = 'RECRUE';
    rankIcon.innerHTML = '&#9733;';
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
