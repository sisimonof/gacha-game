async function loadUser() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const data = await res.json();

    // Navbar stats
    document.getElementById('username-display').textContent = data.username;
    document.getElementById('stat-credits').textContent = data.credits;
    document.getElementById('stat-cards').textContent = data.cardCount;

    // Profile sidebar
    const profileUser = document.getElementById('profile-username');
    if (profileUser) profileUser.textContent = data.username;
    const profileCards = document.getElementById('profile-cards');
    if (profileCards) profileCards.textContent = data.cardCount;
    const profileCredits = document.getElementById('profile-credits');
    if (profileCredits) profileCredits.textContent = data.credits;
    const collDesc = document.getElementById('collection-desc');
    if (collDesc) collDesc.textContent = data.cardCount + ' cartes collectees';

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

// Event listeners
document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/';
});

// Patch Notes — triggered by the card now
document.getElementById('patchnotes-trigger').addEventListener('click', () => {
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
