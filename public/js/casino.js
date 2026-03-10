// casino.js — Roulette Casino

let segments = [];
let spinning = false;
let spinHistory = [];

async function loadNav() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const data = await res.json();
    document.getElementById('nav-credits').textContent = data.credits;
    document.getElementById('casino-credits').textContent = data.credits;
    const eEl = document.getElementById('nav-energy');
    if (eEl) eEl.textContent = data.energy != null ? data.energy : '--';
    const navUser = document.getElementById('nav-username');
    navUser.textContent = data.displayName || data.username;
    if (data.usernameEffect) navUser.className = 'dash-nav-username ' + data.usernameEffect;
  } catch { window.location.href = '/'; }
}

async function loadCasino() {
  try {
    const res = await fetch('/api/casino/info');
    if (!res.ok) { window.location.href = '/'; return; }
    const data = await res.json();
    segments = data.segments;
    document.getElementById('casino-credits').textContent = data.credits;
    updateJackpotDisplay(data.jackpot || 5000);
    drawWheel();
  } catch { window.location.href = '/'; }
}

function updateJackpotDisplay(amount) {
  var el = document.getElementById('jackpot-amount');
  if (el) el.textContent = amount.toLocaleString('fr-FR');
}

function drawWheel() {
  const canvas = document.getElementById('casino-wheel');
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const r = cx - 10;
  const total = segments.length;
  const arc = (2 * Math.PI) / total;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  segments.forEach((seg, i) => {
    const startAngle = i * arc;
    const endAngle = startAngle + arc;

    // Draw segment
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = seg.color;
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw text
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(startAngle + arc / 2);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px monospace';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 3;

    const label = seg.label;
    ctx.fillText(label, r - 15, 4);
    ctx.restore();
  });

  // Center circle
  ctx.beginPath();
  ctx.arc(cx, cy, 25, 0, 2 * Math.PI);
  ctx.fillStyle = '#111';
  ctx.fill();
  ctx.strokeStyle = '#00ff41';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = '#00ff41';
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('GO', cx, cy);
}

async function spin() {
  if (spinning) return;

  const creditsEl = document.getElementById('casino-credits');
  const credits = parseInt(creditsEl.textContent);
  if (credits < 200) {
    screenShake();
    return;
  }

  spinning = true;
  const btn = document.getElementById('spin-btn');
  btn.disabled = true;
  btn.textContent = '...';

  // Hide result
  document.getElementById('casino-result').classList.add('hidden');

  try {
    const res = await fetch('/api/casino/spin', { method: 'POST' });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error);
      btn.disabled = false;
      btn.textContent = '🎲 TOURNER';
      spinning = false;
      return;
    }

    // Animate wheel spin
    const targetIndex = data.segmentIndex;
    await animateWheel(targetIndex);

    // Show result
    showResult(data);

    // Update credits + jackpot
    document.getElementById('casino-credits').textContent = data.credits;
    document.getElementById('nav-credits').textContent = data.credits;
    if (data.jackpot != null) updateJackpotDisplay(data.jackpot);

    // Floating reward for wins
    if (data.jackpotWon > 0 && typeof showCreditsReward === 'function') showCreditsReward(data.jackpotWon);
    else if (data.reward.type === 'credits' && data.reward.amount > 0 && typeof showCreditsReward === 'function') showCreditsReward(data.reward.amount);

    // Add to history
    addToHistory(data);

  } catch {
    alert('Erreur serveur');
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="casino-spin-icon">&#127922;</span> TOURNER';
  spinning = false;
}

function animateWheel(targetIndex) {
  return new Promise(resolve => {
    const wrap = document.getElementById('casino-wheel-wrap');
    const total = segments.length;
    const segAngle = 360 / total;

    // Canvas draws segment 0 starting at 3 o'clock (0°).
    // Pointer is at top (12 o'clock = 270°).
    // After rotating wheel by R degrees clockwise, the segment at the pointer
    // was originally at angle (270 - R) mod 360.
    // We want segment targetIndex center = targetIndex * segAngle + segAngle/2
    // to land under the pointer, so R = 270 - (center) mod 360.
    const segCenter = targetIndex * segAngle + segAngle / 2;
    const targetAngle = ((270 - segCenter) % 360 + 360) % 360;
    const totalRotation = 360 * (4 + Math.floor(Math.random() * 3)) + targetAngle;

    wrap.style.transition = 'none';
    wrap.style.transform = 'rotate(0deg)';

    // Force reflow
    wrap.offsetHeight;

    wrap.style.transition = 'transform 4s cubic-bezier(0.17, 0.67, 0.12, 0.99)';
    wrap.style.transform = `rotate(${totalRotation}deg)`;

    setTimeout(() => {
      // Reset rotation to final position without animation
      wrap.style.transition = 'none';
      wrap.style.transform = `rotate(${totalRotation % 360}deg)`;
      resolve();
    }, 4200);
  });
}

function showResult(data) {
  const resultEl = document.getElementById('casino-result');
  const labelEl = document.getElementById('result-label');
  const detailEl = document.getElementById('result-detail');

  resultEl.classList.remove('hidden');
  resultEl.className = 'casino-result';

  if (data.reward.type === 'nothing') {
    labelEl.textContent = 'PERDU !';
    detailEl.textContent = '-200 CR';
    resultEl.classList.add('casino-result--lose');
  } else if (data.reward.type === 'credits') {
    const net = data.reward.amount - 200;
    labelEl.textContent = `+${data.reward.amount} CR`;
    detailEl.textContent = net >= 0 ? `Net: +${net} CR` : `Net: ${net} CR`;
    resultEl.classList.add(net >= 0 ? 'casino-result--win' : 'casino-result--lose');
    if (data.reward.amount >= 500) screenFlash();
  } else if (data.reward.type === 'xp') {
    labelEl.textContent = `+${data.reward.amount} XP`;
    detailEl.textContent = 'Experience Passe de Combat';
    resultEl.classList.add('casino-result--xp');
  } else if (data.reward.type === 'jackpot') {
    labelEl.textContent = `🏆 JACKPOT !`;
    detailEl.textContent = `+${data.jackpotWon.toLocaleString('fr-FR')} CR !!!`;
    resultEl.classList.add('casino-result--jackpot');
    screenFlash();
    screenShake();
  } else if (data.reward.type === 'card') {
    labelEl.textContent = `CARTE ${data.cardGiven.rarity.toUpperCase()} !`;
    detailEl.textContent = `${data.cardGiven.emoji || ''} ${data.cardGiven.name}`;
    resultEl.classList.add('casino-result--card');
    screenFlash();
    screenShake();
  }
}

function addToHistory(data) {
  spinHistory.unshift(data);
  if (spinHistory.length > 10) spinHistory.pop();

  const list = document.getElementById('history-list');
  list.innerHTML = spinHistory.map(h => {
    let cls = 'casino-hist-item';
    let text = '';
    if (h.reward.type === 'nothing') {
      cls += ' hist-lose';
      text = 'PERDU (-200 CR)';
    } else if (h.reward.type === 'credits') {
      const net = h.reward.amount - 200;
      cls += net >= 0 ? ' hist-win' : ' hist-lose';
      text = `+${h.reward.amount} CR (net: ${net >= 0 ? '+' : ''}${net})`;
    } else if (h.reward.type === 'xp') {
      cls += ' hist-xp';
      text = `+${h.reward.amount} XP`;
    } else if (h.reward.type === 'jackpot') {
      cls += ' hist-jackpot';
      text = `🏆 JACKPOT +${(h.jackpotWon || 0).toLocaleString('fr-FR')} CR`;
    } else if (h.reward.type === 'card') {
      cls += ' hist-card';
      text = `${h.cardGiven.emoji} ${h.cardGiven.name} (${h.cardGiven.rarity})`;
    }
    return `<div class="${cls}">${text}</div>`;
  }).join('');
}

function screenFlash() {
  const flash = document.getElementById('screen-flash');
  flash.classList.remove('hidden');
  flash.classList.add('flash-active');
  setTimeout(() => { flash.classList.remove('flash-active'); flash.classList.add('hidden'); }, 400);
}

function screenShake() {
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 500);
}

// Listen for jackpot wins from other players
if (typeof io !== 'undefined') {
  setTimeout(function() {
    var sock = window._toastSocket || io();
    sock.on('casino:jackpot', function(data) {
      showToast('🏆 ' + data.winner + ' a remporte le JACKPOT de ' + data.amount.toLocaleString('fr-FR') + ' CR !', 'achievement', 8000);
      // Refresh jackpot display
      loadCasino();
    });
  }, 600);
}

loadNav();
loadCasino();
