// guilds.js — Guild system frontend logic

let currentUser = null;
let myGuild = null;
let activeTab = 'members';

// === HELPERS ===
function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function apiFetch(url, options) {
  try {
    const res = await fetch(url, options);
    if (res.status === 401) { window.location.href = '/'; return null; }
    const data = await res.json();
    return data;
  } catch (e) {
    console.error('Erreur reseau:', e);
    if (window.showToast) showToast('Erreur reseau', 'error');
    return null;
  }
}

// === INIT ===
async function init() {
  const data = await apiFetch('/api/me');
  if (!data) return;
  currentUser = data;
  updateNav(data);

  if (data.guildId) {
    await loadMyGuild();
  } else {
    await loadGuilds();
  }
  initGuildSocket();
}

function updateNav(data) {
  var el;
  el = document.getElementById('nav-credits');
  if (el) el.textContent = data.credits;
  el = document.getElementById('nav-energy');
  if (el) el.textContent = data.energy || 0;
  el = document.getElementById('nav-username');
  if (el) {
    el.textContent = data.displayName || data.username;
    if (data.usernameEffect) el.className = 'dash-nav-username ' + data.usernameEffect;
  }
}

// === BROWSE GUILDS (no guild) ===
async function loadGuilds() {
  const guilds = await apiFetch('/api/guilds');
  if (!guilds) return;
  renderBrowseView(guilds);
}

function renderBrowseView(guilds) {
  var main = document.getElementById('guild-content');
  var html = '';

  // Create guild form
  html += '<div class="guild-create-section">';
  html += '<h2 class="guild-section-title">CREER UNE GUILDE</h2>';
  html += '<div class="guild-create-form">';
  html += '<input type="text" id="guild-create-name" placeholder="Nom de la guilde..." maxlength="24" class="guild-input">';
  html += '<input type="text" id="guild-create-emoji" placeholder="Emoji" maxlength="2" class="guild-input guild-input--emoji">';
  html += '<button class="guild-btn guild-btn--create" onclick="createGuild()">CREER</button>';
  html += '</div>';
  html += '</div>';

  // Browse list
  html += '<div class="guild-browse-section">';
  html += '<h2 class="guild-section-title">GUILDES DISPONIBLES</h2>';

  if (!guilds || guilds.length === 0) {
    html += '<div class="guild-empty">Aucune guilde trouvee. Soyez le premier a en creer une !</div>';
  } else {
    html += '<div class="guild-list">';
    guilds.forEach(function(g) {
      html += '<div class="guild-list-item">';
      html += '<span class="guild-list-emoji">' + escapeHtml(g.emoji || '🏰') + '</span>';
      html += '<div class="guild-list-info">';
      html += '<span class="guild-list-name">' + escapeHtml(g.name) + '</span>';
      html += '<span class="guild-list-members">' + g.memberCount + ' membres</span>';
      html += '</div>';
      html += '<button class="guild-btn guild-btn--join" onclick="joinGuild(' + g.id + ')">REJOINDRE</button>';
      html += '</div>';
    });
    html += '</div>';
  }

  html += '</div>';
  main.innerHTML = html;
}

// === MY GUILD VIEW ===
async function loadMyGuild() {
  const data = await apiFetch('/api/guilds/my');
  if (!data) return;
  myGuild = data;
  renderGuildView(data);
}

function renderGuildView(data) {
  var main = document.getElementById('guild-content');
  var myRole = data.myRole || 'member';

  var html = '';

  // Guild header
  html += '<div class="guild-header">';
  html += '<span class="guild-header-emoji">' + escapeHtml(data.emoji || '🏰') + '</span>';
  html += '<h1 class="guild-header-name">' + escapeHtml(data.name) + '</h1>';
  html += '<span class="guild-header-members">' + (data.members ? data.members.length : 0) + ' membres</span>';
  html += '<div class="guild-header-actions">';
  html += '<button class="guild-btn guild-btn--donate" onclick="donate()">DONNER CR</button>';
  html += '<button class="guild-btn guild-btn--leave" onclick="leaveGuild()">QUITTER</button>';
  html += '</div>';
  html += '</div>';

  // Tabs
  html += '<div class="guild-tabs">';
  html += '<button class="guild-tab' + (activeTab === 'members' ? ' active' : '') + '" onclick="switchTab(\'members\')">MEMBRES</button>';
  html += '<button class="guild-tab' + (activeTab === 'chat' ? ' active' : '') + '" onclick="switchTab(\'chat\')">CHAT</button>';
  html += '<button class="guild-tab' + (activeTab === 'boss' ? ' active' : '') + '" onclick="switchTab(\'boss\')">BOSS</button>';
  html += '</div>';

  // Tab contents
  html += '<div class="guild-tab-content" id="guild-tab-members"' + (activeTab !== 'members' ? ' style="display:none"' : '') + '></div>';
  html += '<div class="guild-tab-content" id="guild-tab-chat"' + (activeTab !== 'chat' ? ' style="display:none"' : '') + '></div>';
  html += '<div class="guild-tab-content" id="guild-tab-boss"' + (activeTab !== 'boss' ? ' style="display:none"' : '') + '></div>';

  main.innerHTML = html;

  // Render each tab content
  renderMembers(data.members || [], myRole);
  renderChat(data.chatMessages || []);
  renderBoss(data.boss || null, data.canAttack !== false);
}

// === TAB SWITCHING ===
window.switchTab = function(tab) {
  activeTab = tab;
  var tabs = ['members', 'chat', 'boss'];
  tabs.forEach(function(t) {
    var el = document.getElementById('guild-tab-' + t);
    if (el) el.style.display = (t === tab) ? '' : 'none';
  });
  document.querySelectorAll('.guild-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.textContent.trim() === tab.toUpperCase() ||
      (tab === 'members' && btn.textContent.trim() === 'MEMBRES'));
  });
  if (tab === 'chat') {
    scrollGuildChatBottom();
  }
};

// === MEMBERS ===
function renderMembers(members, myRole) {
  var container = document.getElementById('guild-tab-members');
  if (!container) return;

  var ROLE_LABELS = {
    leader: 'CHEF',
    officer: 'OFFICIER',
    member: 'MEMBRE'
  };

  var ROLE_ORDER = { leader: 0, officer: 1, member: 2 };

  var sorted = members.slice().sort(function(a, b) {
    return (ROLE_ORDER[a.role] || 2) - (ROLE_ORDER[b.role] || 2);
  });

  var html = '<div class="guild-members-list">';
  sorted.forEach(function(m) {
    var roleLabel = ROLE_LABELS[m.role] || 'MEMBRE';
    var roleCls = 'guild-role-badge guild-role--' + (m.role || 'member');

    html += '<div class="guild-member-item">';
    html += '<span class="guild-member-avatar">' + escapeHtml(m.avatar || '⚔') + '</span>';
    html += '<span class="guild-member-name">' + escapeHtml(m.displayName || m.username) + '</span>';
    html += '<span class="' + roleCls + '">' + roleLabel + '</span>';

    // Leader actions
    if (myRole === 'leader' && m.role !== 'leader') {
      html += '<div class="guild-member-actions">';
      if (m.role === 'member') {
        html += '<button class="guild-btn guild-btn--sm guild-btn--promote" onclick="promoteMember(' + m.userId + ', \'officer\')">PROMOUVOIR</button>';
      } else if (m.role === 'officer') {
        html += '<button class="guild-btn guild-btn--sm guild-btn--demote" onclick="promoteMember(' + m.userId + ', \'member\')">RETROGRADER</button>';
      }
      html += '<button class="guild-btn guild-btn--sm guild-btn--kick" onclick="kickMember(' + m.userId + ')">EXCLURE</button>';
      html += '</div>';
    }

    html += '</div>';
  });
  html += '</div>';

  container.innerHTML = html;
}

// === CHAT ===
function renderChat(messages) {
  var container = document.getElementById('guild-tab-chat');
  if (!container) return;

  var html = '<div class="guild-chat-messages" id="guild-chat-messages">';
  if (messages && messages.length > 0) {
    messages.forEach(function(msg) {
      html += formatChatMessage(msg);
    });
  } else {
    html += '<div class="guild-chat-empty">Aucun message. Lancez la conversation !</div>';
  }
  html += '</div>';

  html += '<div class="guild-chat-input-bar">';
  html += '<span class="guild-chat-prompt">&gt;</span>';
  html += '<input type="text" id="guild-chat-input" placeholder="Message..." maxlength="500" onkeydown="if(event.key===\'Enter\')sendChatMessage()">';
  html += '<button class="guild-btn guild-btn--send" onclick="sendChatMessage()">ENVOYER</button>';
  html += '</div>';

  container.innerHTML = html;
}

function formatChatMessage(msg) {
  var time = new Date(msg.created_at || msg.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  var senderName = escapeHtml(msg.displayName || msg.username || 'Inconnu');
  var text = escapeHtml(msg.message);
  return '<div class="guild-chat-msg">' +
    '<span class="guild-chat-time">[' + time + ']</span> ' +
    '<span class="guild-chat-sender">' + senderName + '</span>: ' +
    '<span class="guild-chat-text">' + text + '</span>' +
  '</div>';
}

function appendChatMessage(msg) {
  var container = document.getElementById('guild-chat-messages');
  if (!container) return;

  // Remove empty message placeholder
  var empty = container.querySelector('.guild-chat-empty');
  if (empty) empty.remove();

  var div = document.createElement('div');
  div.className = 'guild-chat-msg';
  var time = new Date(msg.created_at || msg.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = '<span class="guild-chat-time">[' + time + ']</span> ' +
    '<span class="guild-chat-sender">' + escapeHtml(msg.displayName || msg.username || 'Inconnu') + '</span>: ' +
    '<span class="guild-chat-text">' + escapeHtml(msg.message) + '</span>';
  container.appendChild(div);
  scrollGuildChatBottom();
}

function scrollGuildChatBottom() {
  var container = document.getElementById('guild-chat-messages');
  if (container) container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  var input = document.getElementById('guild-chat-input');
  if (!input) return;
  var message = input.value.trim();
  if (!message) return;
  input.value = '';

  var data = await apiFetch('/api/guilds/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: message })
  });

  if (data && data.success) {
    appendChatMessage(data.message || { message: message, username: currentUser.username, displayName: currentUser.displayName, created_at: new Date().toISOString() });
    // Also emit via socket for real-time
    var socket = window._toastSocket;
    if (socket) {
      socket.emit('guild:message', { message: message });
    }
  } else if (data && data.error) {
    if (window.showToast) showToast(data.error, 'error');
  }
}

// === BOSS ===
function renderBoss(boss, canAttack) {
  var container = document.getElementById('guild-tab-boss');
  if (!container) return;

  if (!boss) {
    container.innerHTML = '<div class="guild-boss-empty">Aucun boss de guilde disponible pour le moment.</div>';
    return;
  }

  var hpPercent = boss.maxHp > 0 ? Math.max(0, (boss.hp / boss.maxHp) * 100) : 0;
  var hpColor = hpPercent > 50 ? '#0f0' : (hpPercent > 25 ? '#f80' : '#f00');

  var html = '<div class="guild-boss-panel">';

  // Boss info
  html += '<div class="guild-boss-info">';
  html += '<span class="guild-boss-emoji">' + escapeHtml(boss.emoji || '👹') + '</span>';
  html += '<h2 class="guild-boss-name">' + escapeHtml(boss.name || 'Boss inconnu') + '</h2>';
  html += '<span class="guild-boss-level">Niv. ' + (boss.level || 1) + '</span>';
  html += '</div>';

  // HP bar
  html += '<div class="guild-boss-hp-section">';
  html += '<div class="guild-boss-hp-bar">';
  html += '<div class="guild-boss-hp-fill" id="boss-hp-fill" style="width:' + hpPercent + '%;background:' + hpColor + '"></div>';
  html += '</div>';
  html += '<span class="guild-boss-hp-text" id="boss-hp-text">' + boss.hp + ' / ' + boss.maxHp + ' PV</span>';
  html += '</div>';

  // Attack button
  if (boss.hp > 0) {
    html += '<button class="guild-btn guild-btn--attack' + (canAttack ? '' : ' disabled') + '" id="boss-attack-btn" onclick="attackBoss()"' + (canAttack ? '' : ' disabled') + '>';
    html += '⚔ ATTAQUER';
    html += '</button>';
    if (!canAttack) {
      html += '<div class="guild-boss-cooldown">Vous avez deja attaque. Revenez plus tard !</div>';
    }
  } else {
    html += '<div class="guild-boss-defeated">BOSS VAINCU !</div>';
  }

  // Rewards info
  if (boss.rewards) {
    html += '<div class="guild-boss-rewards">';
    html += '<h3>Recompenses</h3>';
    html += '<span>' + escapeHtml(boss.rewards) + '</span>';
    html += '</div>';
  }

  html += '</div>';

  container.innerHTML = html;
}

async function attackBoss() {
  var btn = document.getElementById('boss-attack-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⚔ ATTAQUE...';
  }

  var data = await apiFetch('/api/guilds/boss/attack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (data && data.success) {
    // Show damage animation
    showDamageAnimation(data.damage || 0);

    if (window.showToast) showToast('Vous infligez ' + (data.damage || 0) + ' degats !', 'success');

    // Update boss HP bar
    var hpFill = document.getElementById('boss-hp-fill');
    var hpText = document.getElementById('boss-hp-text');
    if (hpFill && data.bossHp !== undefined && data.bossMaxHp !== undefined) {
      var pct = Math.max(0, (data.bossHp / data.bossMaxHp) * 100);
      var color = pct > 50 ? '#0f0' : (pct > 25 ? '#f80' : '#f00');
      hpFill.style.width = pct + '%';
      hpFill.style.background = color;
      if (hpText) hpText.textContent = data.bossHp + ' / ' + data.bossMaxHp + ' PV';
    }

    // Update local state
    if (myGuild && myGuild.boss) {
      myGuild.boss.hp = data.bossHp;
    }

    // Boss defeated check
    if (data.bossHp <= 0) {
      if (window.showToast) showToast('Le boss est vaincu ! Recompenses distribuees !', 'success');
      setTimeout(function() { loadMyGuild(); }, 1500);
    }

    if (btn) {
      btn.disabled = true;
      btn.textContent = '⚔ ATTAQUE EFFECTUEE';
    }
  } else if (data && data.error) {
    if (window.showToast) showToast(data.error, 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚔ ATTAQUER';
    }
  }
}

function showDamageAnimation(damage) {
  var bossPanel = document.querySelector('.guild-boss-panel');
  if (!bossPanel) return;

  // Screen shake
  bossPanel.classList.add('guild-boss--shake');
  setTimeout(function() { bossPanel.classList.remove('guild-boss--shake'); }, 500);

  // Floating damage number
  var dmgEl = document.createElement('div');
  dmgEl.className = 'guild-boss-damage';
  dmgEl.textContent = '-' + damage;
  bossPanel.appendChild(dmgEl);
  requestAnimationFrame(function() { dmgEl.classList.add('guild-boss-damage--animate'); });
  setTimeout(function() { dmgEl.remove(); }, 1200);
}

// === CREATE GUILD ===
async function createGuild() {
  var nameInput = document.getElementById('guild-create-name');
  var emojiInput = document.getElementById('guild-create-emoji');
  if (!nameInput) return;

  var name = nameInput.value.trim();
  var emoji = emojiInput ? emojiInput.value.trim() : '';

  if (!name) {
    if (window.showToast) showToast('Entrez un nom de guilde', 'error');
    return;
  }

  var data = await apiFetch('/api/guilds/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, emoji: emoji || '🏰' })
  });

  if (data && data.success) {
    if (window.showToast) showToast('Guilde creee !', 'success');
    if (currentUser) currentUser.guildId = data.guildId;
    await loadMyGuild();
  } else if (data && data.error) {
    if (window.showToast) showToast(data.error, 'error');
  }
}

// === JOIN GUILD ===
async function joinGuild(guildId) {
  var data = await apiFetch('/api/guilds/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guildId: guildId })
  });

  if (data && data.success) {
    if (window.showToast) showToast('Vous avez rejoint la guilde !', 'success');
    if (currentUser) currentUser.guildId = data.guildId || guildId;
    await loadMyGuild();
  } else if (data && data.error) {
    if (window.showToast) showToast(data.error, 'error');
  }
}

// === LEAVE GUILD ===
async function leaveGuild() {
  if (!confirm('Voulez-vous vraiment quitter la guilde ?')) return;

  var data = await apiFetch('/api/guilds/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });

  if (data && data.success) {
    if (window.showToast) showToast('Vous avez quitte la guilde', 'success');
    myGuild = null;
    if (currentUser) currentUser.guildId = null;
    activeTab = 'members';
    await loadGuilds();
  } else if (data && data.error) {
    if (window.showToast) showToast(data.error, 'error');
  }
}

// === KICK MEMBER ===
async function kickMember(userId) {
  if (!confirm('Exclure ce membre de la guilde ?')) return;

  var data = await apiFetch('/api/guilds/kick', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: userId })
  });

  if (data && data.success) {
    if (window.showToast) showToast('Membre exclu', 'success');
    await loadMyGuild();
  } else if (data && data.error) {
    if (window.showToast) showToast(data.error, 'error');
  }
}

// === PROMOTE / DEMOTE MEMBER ===
async function promoteMember(userId, role) {
  var data = await apiFetch('/api/guilds/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: userId, role: role })
  });

  if (data && data.success) {
    var msg = role === 'officer' ? 'Membre promu officier !' : 'Membre retrogade';
    if (window.showToast) showToast(msg, 'success');
    await loadMyGuild();
  } else if (data && data.error) {
    if (window.showToast) showToast(data.error, 'error');
  }
}

// === DONATE ===
async function donate() {
  var amountStr = prompt('Combien de credits voulez-vous donner a la guilde ?');
  if (!amountStr) return;
  var amount = parseInt(amountStr, 10);
  if (isNaN(amount) || amount <= 0) {
    if (window.showToast) showToast('Montant invalide', 'error');
    return;
  }

  var data = await apiFetch('/api/guilds/donate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amount })
  });

  if (data && data.success) {
    if (window.showToast) showToast('Don de ' + amount + ' CR effectue !', 'success');
    // Update nav credits
    if (data.credits !== undefined) {
      if (currentUser) currentUser.credits = data.credits;
      var el = document.getElementById('nav-credits');
      if (el) el.textContent = data.credits;
    }
  } else if (data && data.error) {
    if (window.showToast) showToast(data.error, 'error');
  }
}

// === SOCKET.IO ===
function initGuildSocket() {
  setTimeout(function() {
    var socket = window._toastSocket || (typeof io !== 'undefined' ? io() : null);
    if (!socket) return;
    if (!window._toastSocket) window._toastSocket = socket;

    socket.on('guild:message', function(msg) {
      // Only append if we are viewing our guild chat
      if (myGuild) {
        appendChatMessage(msg);
      }
    });

    socket.on('guild:bossUpdate', function(data) {
      // Update boss HP in real-time when another member attacks
      if (myGuild && myGuild.boss) {
        myGuild.boss.hp = data.bossHp;
        var hpFill = document.getElementById('boss-hp-fill');
        var hpText = document.getElementById('boss-hp-text');
        if (hpFill && data.bossMaxHp) {
          var pct = Math.max(0, (data.bossHp / data.bossMaxHp) * 100);
          var color = pct > 50 ? '#0f0' : (pct > 25 ? '#f80' : '#f00');
          hpFill.style.width = pct + '%';
          hpFill.style.background = color;
        }
        if (hpText && data.bossMaxHp) {
          hpText.textContent = data.bossHp + ' / ' + data.bossMaxHp + ' PV';
        }
        if (data.bossHp <= 0) {
          if (window.showToast) showToast('Le boss est vaincu !', 'success');
          setTimeout(function() { loadMyGuild(); }, 1500);
        }
      }
    });

    socket.on('guild:memberJoin', function(data) {
      if (window.showToast) showToast((data.username || 'Un joueur') + ' a rejoint la guilde !', 'info');
      if (myGuild) loadMyGuild();
    });

    socket.on('guild:memberLeave', function(data) {
      if (window.showToast) showToast((data.username || 'Un joueur') + ' a quitte la guilde', 'info');
      if (myGuild) loadMyGuild();
    });
  }, 800);
}

// === START ===
init();
