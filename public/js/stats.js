// stats.js — Player Statistics Page

async function loadNav() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const data = await res.json();
    document.getElementById('nav-credits').textContent = data.credits;
    const navUser = document.getElementById('nav-username');
    navUser.textContent = data.displayName || data.username;
    if (data.usernameEffect) navUser.className = 'dash-nav-username ' + data.usernameEffect;
  } catch { window.location.href = '/'; }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) { window.location.href = '/'; return; }
    const s = await res.json();
    renderStats(s);
  } catch { window.location.href = '/'; }
}

const RARITY_COLORS_STAT = {
  commune: '#888888', rare: '#4488ff', epique: '#cc44ff',
  legendaire: '#ffaa00', chaos: '#ff0044', secret: '#ffffff'
};

function renderStats(s) {
  // Combat
  document.getElementById('combat-wins').textContent = s.combat.wins;
  document.getElementById('combat-losses').textContent = s.combat.losses;
  document.getElementById('combat-rate').textContent = s.combat.winRate + '%';
  const totalCombat = s.combat.wins + s.combat.losses;
  if (totalCombat > 0) {
    renderBarChart('combat-chart', [
      { label: 'Victoires', value: s.combat.wins, pct: (s.combat.wins / totalCombat) * 100, color: '#00ff41' },
      { label: 'Defaites', value: s.combat.losses, pct: (s.combat.losses / totalCombat) * 100, color: '#ff4444' }
    ]);
  }

  // Casino
  document.getElementById('casino-spins').textContent = s.casino.spins;
  document.getElementById('casino-spent').textContent = s.casino.spent + ' CR';
  document.getElementById('casino-won').textContent = s.casino.won + ' CR';
  const netEl = document.getElementById('casino-net');
  netEl.textContent = (s.casino.net >= 0 ? '+' : '') + s.casino.net + ' CR';
  netEl.className = 'stat-val ' + (s.casino.net >= 0 ? 'stat-val--green' : 'stat-val--red');

  // Fusion
  document.getElementById('fusion-total').textContent = s.fusion.total;
  document.getElementById('fusion-success').textContent = s.fusion.success;
  document.getElementById('fusion-fail').textContent = s.fusion.fail;
  document.getElementById('fusion-rate').textContent = s.fusion.rate + '%';
  if (s.fusion.total > 0) {
    renderBarChart('fusion-chart', [
      { label: 'Reussies', value: s.fusion.success, pct: (s.fusion.success / s.fusion.total) * 100, color: '#00ff41' },
      { label: 'Echouees', value: s.fusion.fail, pct: (s.fusion.fail / s.fusion.total) * 100, color: '#ff4444' }
    ]);
  }

  // Boosters
  document.getElementById('boosters-total').textContent = s.boosters.total;
  if (s.boosters.total > 0) {
    renderBarChart('boosters-chart', [
      { label: 'Origines', value: s.boosters.origines, pct: (s.boosters.origines / s.boosters.total) * 100, color: '#00ff41' },
      { label: 'Rift', value: s.boosters.rift, pct: (s.boosters.rift / s.boosters.total) * 100, color: '#cc44ff' },
      { label: 'Avance', value: s.boosters.avance, pct: (s.boosters.avance / s.boosters.total) * 100, color: '#ffaa00' }
    ]);
  }

  // Cards
  document.getElementById('cards-total').textContent = s.cards.total;
  const rarities = ['commune', 'rare', 'epique', 'legendaire', 'chaos', 'secret'];
  const cardBars = rarities.filter(r => s.cards.byRarity[r]).map(r => ({
    label: r.charAt(0).toUpperCase() + r.slice(1),
    value: s.cards.byRarity[r],
    pct: s.cards.total > 0 ? (s.cards.byRarity[r] / s.cards.total) * 100 : 0,
    color: RARITY_COLORS_STAT[r]
  }));
  if (cardBars.length > 0) renderBarChart('cards-chart', cardBars);

  // Credits
  document.getElementById('credits-current').textContent = s.credits.current;
  document.getElementById('credits-spent').textContent = s.credits.totalSpent;
  document.getElementById('credits-earned').textContent = s.credits.totalEarned;
  document.getElementById('diamonds-mined').textContent = s.mine.diamondsMined;

  // Member since
  if (s.memberSince) {
    const d = new Date(s.memberSince);
    document.getElementById('member-since').textContent = 'Membre depuis le ' + d.toLocaleDateString('fr-FR');
  }
}

function renderBarChart(containerId, bars) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = bars.map(b => {
    const pct = Math.max(2, Math.min(100, b.pct));
    return '<div class="chart-bar-row">' +
      '<span class="chart-bar-label">' + b.label + '</span>' +
      '<div class="chart-bar-track">' +
        '<div class="chart-bar-fill" style="width:' + pct + '%;background:' + b.color + '"></div>' +
      '</div>' +
      '<span class="chart-bar-val">' + b.value + '</span>' +
    '</div>';
  }).join('');
}

loadNav();
loadStats();
