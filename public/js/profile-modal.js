// profile-modal.js — Public profile modal with showcase
(function() {

const RARITY_LABELS = { commune: 'C', rare: 'R', epique: 'EP', legendaire: 'LEG', chaos: 'CHAOS', secret: 'SEC' };
const RARITY_COLORS = {
  commune: '#888', rare: '#4488ff', epique: '#aa44ff',
  legendaire: '#ffaa00', chaos: '#ff2222', secret: '#ff66cc'
};
const ELEMENT_ICONS = { feu: '🔥', eau: '💧', terre: '🌿', air: '💨', lumiere: '✨', ombre: '🌑', foudre: '⚡', glace: '❄️' };

function createModalHTML() {
  if (document.getElementById('profile-modal-overlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'profile-modal-overlay';
  overlay.className = 'profile-modal-overlay hidden';
  overlay.innerHTML = `
    <div class="profile-modal">
      <button class="profile-modal-close" id="profile-modal-close">&times;</button>
      <div class="profile-modal-header">
        <div class="profile-modal-avatar-wrap">
          <span class="profile-modal-avatar" id="pm-avatar">⚔</span>
        </div>
        <div class="profile-modal-info">
          <div class="profile-modal-name" id="pm-name">???</div>
          <div class="profile-modal-bio" id="pm-bio"></div>
          <div class="profile-modal-badges">
            <span class="pm-badge pm-badge-rating" id="pm-rating">1000 ELO</span>
            <span class="pm-badge pm-badge-cards" id="pm-cards">0 cartes</span>
            <span class="pm-badge pm-badge-online" id="pm-online">HORS LIGNE</span>
          </div>
        </div>
      </div>
      <div class="profile-modal-showcase" id="pm-showcase">
        <h4 class="pm-showcase-title">VITRINE</h4>
        <div class="pm-showcase-cards" id="pm-showcase-cards">
          <div class="pm-showcase-empty">Aucune carte en vitrine</div>
        </div>
      </div>
      <div class="profile-modal-stats" id="pm-stats">
        <div class="pm-stat"><span class="pm-stat-val" id="pm-wins">0</span><span class="pm-stat-lbl">VICTOIRES</span></div>
        <div class="pm-stat"><span class="pm-stat-val" id="pm-losses">0</span><span class="pm-stat-lbl">DEFAITES</span></div>
        <div class="pm-stat"><span class="pm-stat-val" id="pm-winrate">0%</span><span class="pm-stat-lbl">WINRATE</span></div>
        <div class="pm-stat"><span class="pm-stat-val" id="pm-fusions">0</span><span class="pm-stat-lbl">FUSIONS</span></div>
      </div>
      <div class="profile-modal-actions" id="pm-actions"></div>
      <div class="profile-modal-member" id="pm-member"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeProfileModal();
  });
  document.getElementById('profile-modal-close').addEventListener('click', closeProfileModal);
}

function closeProfileModal() {
  var el = document.getElementById('profile-modal-overlay');
  if (el) el.classList.add('hidden');
}

window.openProfileModal = async function(userId) {
  createModalHTML();
  var overlay = document.getElementById('profile-modal-overlay');
  overlay.classList.remove('hidden');

  // Show loading state
  document.getElementById('pm-name').textContent = 'Chargement...';
  document.getElementById('pm-actions').innerHTML = '';
  document.getElementById('pm-showcase-cards').innerHTML = '<div class="pm-showcase-empty">Chargement...</div>';

  try {
    var res = await fetch('/api/profile/' + userId);
    if (!res.ok) { closeProfileModal(); showToast('Profil introuvable', 'error'); return; }
    var data = await res.json();
    renderProfile(data);
  } catch (e) {
    closeProfileModal();
    showToast('Erreur de chargement', 'error');
  }
};

function renderProfile(data) {
  document.getElementById('pm-avatar').textContent = data.avatar;
  var avatarWrap = document.querySelector('.profile-modal-avatar-wrap');
  avatarWrap.className = 'profile-modal-avatar-wrap';
  if (data.profileFrame && data.profileFrame !== 'none') avatarWrap.classList.add('frame-' + data.profileFrame);

  var nameEl = document.getElementById('pm-name');
  nameEl.textContent = data.displayName;
  nameEl.className = 'profile-modal-name';
  if (data.usernameEffect) nameEl.classList.add(data.usernameEffect);

  document.getElementById('pm-bio').textContent = data.bio || '';
  document.getElementById('pm-rating').textContent = data.pvpRating + ' ELO';
  document.getElementById('pm-cards').textContent = data.cardCount + ' cartes';

  var onlineEl = document.getElementById('pm-online');
  onlineEl.textContent = data.online ? 'EN LIGNE' : 'HORS LIGNE';
  onlineEl.className = 'pm-badge pm-badge-online' + (data.online ? ' pm-online' : '');

  // Stats
  document.getElementById('pm-wins').textContent = data.stats.wins;
  document.getElementById('pm-losses').textContent = data.stats.losses;
  document.getElementById('pm-winrate').textContent = data.stats.winRate + '%';
  document.getElementById('pm-fusions').textContent = data.stats.fusions;

  // Showcase
  var showcaseContainer = document.getElementById('pm-showcase-cards');
  if (data.showcaseCards && data.showcaseCards.length > 0) {
    showcaseContainer.innerHTML = data.showcaseCards.map(function(card) {
      var color = RARITY_COLORS[card.rarity] || '#888';
      var elemIcon = ELEMENT_ICONS[card.element] || '?';
      return '<div class="pm-showcase-card" style="border-color:' + color + '; box-shadow: 0 0 12px ' + color + '40;">' +
        '<div class="pm-sc-rarity" style="background:' + color + '">' + (RARITY_LABELS[card.rarity] || '?') + '</div>' +
        '<div class="pm-sc-emoji">' + (card.emoji || '?') + '</div>' +
        '<div class="pm-sc-name">' + card.name + '</div>' +
        '<div class="pm-sc-element">' + elemIcon + '</div>' +
        '<div class="pm-sc-stats">' + card.attack + '⚔ ' + card.defense + '🛡 ' + card.hp + '❤' + '</div>' +
        (card.is_shiny ? '<div class="pm-sc-shiny">✦ SHINY</div>' : '') +
        (card.is_fused ? '<div class="pm-sc-fused">◆ FUSED</div>' : '') +
        '</div>';
    }).join('');
  } else {
    showcaseContainer.innerHTML = '<div class="pm-showcase-empty">Aucune carte en vitrine</div>';
  }

  // Actions
  var actionsEl = document.getElementById('pm-actions');
  if (data.isSelf) {
    actionsEl.innerHTML = '<button class="pm-btn pm-btn-edit" onclick="openShowcaseEditor()">✏ MODIFIER VITRINE</button>';
  } else {
    var html = '';
    if (data.isFriend) {
      html += '<button class="pm-btn pm-btn-duel" onclick="challengeFriend(' + data.id + ')">⚔ DEFIER EN DUEL</button>';
      html += '<button class="pm-btn pm-btn-remove" onclick="removeFriendFromProfile(' + data.id + ')">✕ RETIRER AMI</button>';
    } else if (data.pendingRequest) {
      if (data.pendingRequest.sentByMe) {
        html += '<button class="pm-btn pm-btn-pending" disabled>DEMANDE ENVOYEE</button>';
      } else {
        html += '<button class="pm-btn pm-btn-accept" onclick="acceptFriendFromProfile(' + data.pendingRequest.id + ',' + data.id + ')">✓ ACCEPTER</button>';
      }
    } else {
      html += '<button class="pm-btn pm-btn-add" onclick="addFriendFromProfile(' + data.id + ',\'' + data.username + '\')">+ AJOUTER EN AMI</button>';
    }
    actionsEl.innerHTML = html;
  }

  // Member since
  var memberEl = document.getElementById('pm-member');
  if (data.memberSince) {
    var d = new Date(data.memberSince);
    memberEl.textContent = 'Membre depuis ' + d.toLocaleDateString('fr-FR');
  }
}

// === SHOWCASE EDITOR ===
window.openShowcaseEditor = async function() {
  var overlay = document.getElementById('profile-modal-overlay');
  var modal = overlay.querySelector('.profile-modal');

  try {
    var res = await fetch('/api/collection');
    if (!res.ok) return;
    var cards = await res.json();
    if (!Array.isArray(cards)) cards = [];

    var selected = window._showcaseCards ? [...window._showcaseCards] : [];

    modal.innerHTML = `
      <button class="profile-modal-close" onclick="closeShowcaseEditor()">&times;</button>
      <h3 class="pm-editor-title">MODIFIER MA VITRINE</h3>
      <div class="pm-bio-section">
        <label class="pm-bio-label">BIO</label>
        <input type="text" class="pm-bio-input" id="pm-bio-edit" maxlength="100" placeholder="Votre bio (100 car. max)" value="${(window._profileBio || '').replace(/"/g, '&quot;')}">
      </div>
      <div class="pm-editor-hint">Selectionnez jusqu'a 3 cartes (cliquez pour ajouter/retirer)</div>
      <div class="pm-editor-selected" id="pm-editor-selected"></div>
      <div class="pm-editor-grid" id="pm-editor-grid"></div>
      <div class="pm-editor-actions">
        <button class="pm-btn pm-btn-save" id="pm-editor-save">SAUVEGARDER</button>
        <button class="pm-btn pm-btn-cancel" onclick="closeShowcaseEditor()">ANNULER</button>
      </div>
    `;

    function renderEditorGrid() {
      var grid = document.getElementById('pm-editor-grid');
      grid.innerHTML = cards.map(function(c) {
        var color = RARITY_COLORS[c.rarity] || '#888';
        var isSelected = selected.includes(c.user_card_id);
        return '<div class="pm-editor-card' + (isSelected ? ' pm-editor-card--selected' : '') +
          '" data-ucid="' + c.user_card_id + '" style="border-color:' + color + '">' +
          '<span class="pm-ec-emoji">' + (c.emoji || '?') + '</span>' +
          '<span class="pm-ec-name">' + c.name + '</span>' +
          '</div>';
      }).join('');

      grid.querySelectorAll('.pm-editor-card').forEach(function(el) {
        el.addEventListener('click', function() {
          var ucid = parseInt(this.dataset.ucid);
          var idx = selected.indexOf(ucid);
          if (idx >= 0) { selected.splice(idx, 1); }
          else if (selected.length < 3) { selected.push(ucid); }
          else { showToast('Max 3 cartes', 'warning'); return; }
          renderEditorGrid();
          renderSelectedPreview();
        });
      });
    }

    function renderSelectedPreview() {
      var container = document.getElementById('pm-editor-selected');
      if (selected.length === 0) { container.innerHTML = '<span class="pm-editor-hint">Aucune carte selectionnee</span>'; return; }
      container.innerHTML = selected.map(function(ucid) {
        var c = cards.find(function(x) { return x.user_card_id === ucid; });
        if (!c) return '';
        return '<div class="pm-editor-sel-card" style="border-color:' + (RARITY_COLORS[c.rarity] || '#888') + '">' +
          (c.emoji || '?') + ' ' + c.name + '</div>';
      }).join('');
    }

    renderEditorGrid();
    renderSelectedPreview();

    document.getElementById('pm-editor-save').addEventListener('click', async function() {
      var bio = document.getElementById('pm-bio-edit').value.trim();
      try {
        var r = await fetch('/api/profile/showcase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardIds: selected, bio: bio })
        });
        if (r.ok) {
          window._showcaseCards = selected;
          window._profileBio = bio;
          showToast('Vitrine mise a jour !', 'success');
          closeShowcaseEditor();
          if (window._myUserId) openProfileModal(window._myUserId);
        } else {
          var err = await r.json();
          showToast(err.error || 'Erreur', 'error');
        }
      } catch (e) { showToast('Erreur reseau', 'error'); }
    });
  } catch (e) { showToast('Erreur', 'error'); }
};

window.closeShowcaseEditor = function() {
  if (window._myUserId) openProfileModal(window._myUserId);
  else closeProfileModal();
};

// Friend actions from profile
window.addFriendFromProfile = async function(userId, username) {
  try {
    var r = await fetch('/api/friends/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username }) });
    if (r.ok) { showToast('Demande envoyee !', 'success'); openProfileModal(userId); }
    else { var d = await r.json(); showToast(d.error || 'Erreur', 'error'); }
  } catch(e) { showToast('Erreur', 'error'); }
};

window.acceptFriendFromProfile = async function(requestId, userId) {
  try {
    var r = await fetch('/api/friends/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ friendshipId: requestId }) });
    if (r.ok) { showToast('Ami accepte !', 'success'); openProfileModal(userId); }
  } catch(e) { showToast('Erreur', 'error'); }
};

window.removeFriendFromProfile = async function(userId) {
  if (!confirm('Retirer cet ami ?')) return;
  try {
    var r = await fetch('/api/friends/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ friendId: userId }) });
    if (r.ok) { showToast('Ami retire', 'success'); openProfileModal(userId); }
  } catch(e) { showToast('Erreur', 'error'); }
};

// Challenge friend to duel — open deck selector
window.challengeFriend = async function(friendId) {
  var overlay = document.getElementById('profile-modal-overlay');
  var modal = overlay.querySelector('.profile-modal');

  try {
    var res = await fetch('/api/decks');
    if (!res.ok) { showToast('Erreur chargement decks', 'error'); return; }
    var decks = await res.json();
    if (!Array.isArray(decks)) decks = decks.decks || [];
    decks = decks.map(function(d) { return { id: d.id, name: d.name, cardCount: d.cards ? d.cards.length : 0 }; });

    modal.innerHTML =
      '<button class="profile-modal-close" onclick="closeProfileModal()">&times;</button>' +
      '<h3 class="pm-editor-title">⚔ CHOISIR UN DECK</h3>' +
      '<div class="pm-editor-hint">Selectionnez votre deck pour le duel</div>' +
      '<div class="pm-duel-decks" id="pm-duel-decks"></div>';

    var container = document.getElementById('pm-duel-decks');
    if (decks.length === 0) {
      container.innerHTML = '<div class="pm-showcase-empty">Aucun deck disponible. Creez un deck de 20 cartes d\'abord.</div>' +
        '<a href="/decks" class="pm-btn pm-btn-edit" style="display:inline-block;margin-top:12px;text-decoration:none;text-align:center">CREER UN DECK</a>';
      return;
    }

    container.innerHTML = decks.map(function(d) {
      var valid = d.cardCount === 20;
      return '<div class="pm-duel-deck' + (valid ? '' : ' pm-duel-deck--invalid') + '" data-did="' + d.id + '">' +
        '<div class="pm-dd-name">' + d.name + '</div>' +
        '<div class="pm-dd-count">' + d.cardCount + '/20 cartes</div>' +
        (valid ? '' : '<div class="pm-dd-warn">Incomplet</div>') +
        '</div>';
    }).join('') +
    '<div class="pm-duel-deck" data-did="starter">' +
      '<div class="pm-dd-name">DECK STARTER</div>' +
      '<div class="pm-dd-count">Deck par defaut</div>' +
    '</div>';

    container.querySelectorAll('.pm-duel-deck:not(.pm-duel-deck--invalid)').forEach(function(el) {
      el.addEventListener('click', function() {
        var deckId = this.dataset.did;
        sendDuelChallenge(friendId, deckId === 'starter' ? 'starter' : parseInt(deckId));
      });
    });
  } catch(e) { showToast('Erreur', 'error'); }
};

function sendDuelChallenge(friendId, deckId) {
  if (typeof io === 'undefined') { showToast('Erreur connexion', 'error'); return; }
  var sock = window._toastSocket || io();
  sock.emit('duel:challenge', { targetId: friendId, deckId: deckId });
  sock.once('duel:sent', function() {
    closeProfileModal();
    showToast('Defi envoye ! En attente de reponse...', 'info', 5000);
  });
  sock.once('duel:error', function(data) {
    showToast(data.error || 'Erreur', 'error');
  });
}

// Init: click on avatar opens own profile + listen for duel challenges
document.addEventListener('DOMContentLoaded', function() {
  var avatarEl = document.querySelector('.dash-avatar');
  if (avatarEl) {
    avatarEl.style.cursor = 'pointer';
    avatarEl.addEventListener('click', function() {
      if (window._myUserId) openProfileModal(window._myUserId);
    });
  }

  // Listen for incoming duel challenges
  setTimeout(function() {
    if (typeof io === 'undefined') return;
    var sock = window._toastSocket || io();

    sock.on('duel:challenge', function(data) {
      showDuelChallengeNotif(data);
    });

    sock.on('duel:declined', function() {
      showToast('Defi refuse', 'warning');
    });

    // If we receive pvp:matched from a duel, redirect to battle
    sock.on('pvp:matched', function(data) {
      sessionStorage.setItem('pvpBattleData', JSON.stringify(data));
      sessionStorage.setItem('opponentName', data.opponentName);
      sessionStorage.setItem('battleMode', 'pvp');
      window.location.href = '/pvp-battle';
    });

    sock.on('duel:expired', function() {
      var el = document.getElementById('duel-notif-overlay');
      if (el) el.remove();
    });
  }, 700);
});

function showDuelChallengeNotif(data) {
  // Remove old notif if exists
  var old = document.getElementById('duel-notif-overlay');
  if (old) old.remove();

  var overlay = document.createElement('div');
  overlay.id = 'duel-notif-overlay';
  overlay.className = 'duel-notif-overlay';
  overlay.innerHTML =
    '<div class="duel-notif">' +
      '<div class="duel-notif-icon">⚔</div>' +
      '<div class="duel-notif-text">' +
        '<div class="duel-notif-title">DEFI EN DUEL !</div>' +
        '<div class="duel-notif-from">' + data.challengerAvatar + ' ' + data.challengerName + '</div>' +
      '</div>' +
      '<div class="duel-notif-timer" id="duel-timer">30</div>' +
      '<div class="duel-notif-actions">' +
        '<button class="pm-btn pm-btn-accept duel-accept-btn" id="duel-accept-btn">ACCEPTER</button>' +
        '<button class="pm-btn pm-btn-remove duel-decline-btn" id="duel-decline-btn">REFUSER</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  // Timer countdown
  var timeLeft = 30;
  var timerEl = document.getElementById('duel-timer');
  var timerInterval = setInterval(function() {
    timeLeft--;
    if (timerEl) timerEl.textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      overlay.remove();
    }
  }, 1000);

  document.getElementById('duel-decline-btn').addEventListener('click', function() {
    clearInterval(timerInterval);
    var sock = window._toastSocket || io();
    sock.emit('duel:decline', { challengeId: data.challengeId });
    overlay.remove();
  });

  document.getElementById('duel-accept-btn').addEventListener('click', async function() {
    clearInterval(timerInterval);
    // Need to pick a deck first
    overlay.querySelector('.duel-notif').innerHTML =
      '<div class="duel-notif-title">CHOISIR VOTRE DECK</div>' +
      '<div class="pm-duel-decks" id="duel-accept-decks" style="margin-top:12px">Chargement...</div>';

    try {
      var res = await fetch('/api/decks');
      var decks = await res.json();
      if (!Array.isArray(decks)) decks = decks.decks || [];
      decks = decks.map(function(d) { return { id: d.id, name: d.name, cardCount: d.cards ? d.cards.length : 0 }; });

      var container = document.getElementById('duel-accept-decks');
      container.innerHTML = decks.map(function(d) {
        var valid = d.cardCount === 20;
        return '<div class="pm-duel-deck' + (valid ? '' : ' pm-duel-deck--invalid') + '" data-did="' + d.id + '">' +
          '<div class="pm-dd-name">' + d.name + '</div>' +
          '<div class="pm-dd-count">' + d.cardCount + '/20</div>' +
          '</div>';
      }).join('') +
      '<div class="pm-duel-deck" data-did="starter">' +
        '<div class="pm-dd-name">DECK STARTER</div>' +
        '<div class="pm-dd-count">Par defaut</div>' +
      '</div>';

      container.querySelectorAll('.pm-duel-deck:not(.pm-duel-deck--invalid)').forEach(function(el) {
        el.addEventListener('click', function() {
          var deckId = this.dataset.did;
          var sock = window._toastSocket || io();
          sock.emit('duel:accept', { challengeId: data.challengeId, deckId: deckId === 'starter' ? 'starter' : parseInt(deckId) });
          overlay.remove();
          showToast('Duel lance !', 'success');
        });
      });
    } catch(e) {
      showToast('Erreur chargement decks', 'error');
      overlay.remove();
    }
  });
}

})();
