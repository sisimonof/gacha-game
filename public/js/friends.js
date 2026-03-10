// friends.js — Friends panel + Terminal Chat widget
(function() {
  let friendsData = null;
  let currentChatFriendId = null;
  let currentChatFriendName = '';

  const panelHTML = '<button class="friends-toggle" id="friends-toggle" onclick="toggleFriendsPanel()">' +
    '<span class="friends-toggle-icon">👥</span>' +
    '<span class="friends-badge hidden" id="friends-badge">0</span>' +
  '</button>' +
  '<div class="friends-panel hidden" id="friends-panel">' +
    '<div class="friends-panel-header">' +
      '<div class="friends-tabs">' +
        '<button class="friends-tab active" data-tab="list" onclick="switchFriendsTab(\'list\')">AMIS</button>' +
        '<button class="friends-tab" data-tab="requests" onclick="switchFriendsTab(\'requests\')">DEMANDES <span class="friends-req-count" id="friends-req-count"></span></button>' +
      '</div>' +
      '<button class="friends-panel-close" onclick="toggleFriendsPanel()">&times;</button>' +
    '</div>' +
    '<div class="friends-tab-content" id="friends-tab-list">' +
      '<div class="friends-add-bar">' +
        '<input type="text" id="friend-add-input" placeholder="Pseudo du joueur..." maxlength="20" onkeydown="if(event.key===\'Enter\')sendFriendRequest()">' +
        '<button onclick="sendFriendRequest()">+</button>' +
      '</div>' +
      '<div class="friends-list" id="friends-list"><div class="friends-empty">Chargement...</div></div>' +
    '</div>' +
    '<div class="friends-tab-content hidden" id="friends-tab-requests">' +
      '<div class="friends-requests-list" id="friends-requests"></div>' +
    '</div>' +
  '</div>' +
  '<div class="chat-window hidden" id="chat-window">' +
    '<div class="chat-header">' +
      '<span class="chat-header-name" id="chat-header-name">???</span>' +
      '<button class="chat-close" onclick="closeChat()">&times;</button>' +
    '</div>' +
    '<div class="chat-messages" id="chat-messages"></div>' +
    '<div class="chat-typing hidden" id="chat-typing">ecrit...</div>' +
    '<div class="chat-input-bar">' +
      '<span class="chat-prompt">&gt;</span>' +
      '<input type="text" id="chat-input" placeholder="Message..." maxlength="500" onkeydown="if(event.key===\'Enter\')sendChatMessage()">' +
      '<button onclick="sendChatMessage()">ENVOYER</button>' +
    '</div>' +
  '</div>';

  document.addEventListener('DOMContentLoaded', function() {
    const wrapper = document.createElement('div');
    wrapper.id = 'friends-widget';
    wrapper.innerHTML = panelHTML;
    document.body.appendChild(wrapper);
    loadFriends();
    initFriendsSocket();
  });

  window.toggleFriendsPanel = function() {
    const panel = document.getElementById('friends-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) loadFriends();
  };

  window.switchFriendsTab = function(tab) {
    document.querySelectorAll('.friends-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tab); });
    document.getElementById('friends-tab-list').classList.toggle('hidden', tab !== 'list');
    document.getElementById('friends-tab-requests').classList.toggle('hidden', tab !== 'requests');
  };

  async function loadFriends() {
    try {
      const res = await fetch('/api/friends');
      if (!res.ok) return;
      friendsData = await res.json();
      renderFriendsList();
      renderRequests();
      updateBadge();
    } catch(e) {}
  }

  function renderFriendsList() {
    var container = document.getElementById('friends-list');
    if (!friendsData || friendsData.friends.length === 0) {
      container.innerHTML = '<div class="friends-empty">Aucun ami</div>';
      return;
    }
    container.innerHTML = friendsData.friends
      .sort(function(a, b) { return (b.online ? 1 : 0) - (a.online ? 1 : 0); })
      .map(function(f) {
        var name = f.displayName || f.username;
        var frameClass = (f.profileFrame && f.profileFrame !== 'none') ? ' frame-' + f.profileFrame : '';
        return '<div class="friend-item ' + (f.online ? 'online' : '') + '">' +
          '<div class="friend-item-main" onclick="openChat(' + f.friendUserId + ', \'' + escapeAttr(name) + '\')">' +
            '<span class="friend-status-dot ' + (f.online ? 'dot-online' : 'dot-offline') + '"></span>' +
            '<span class="friend-avatar' + frameClass + '">' + (f.avatar || '⚔') + '</span>' +
            '<span class="friend-name">' + escapeHtml(name) + '</span>' +
            (f.unreadCount > 0 ? '<span class="friend-unread">' + f.unreadCount + '</span>' : '') +
          '</div>' +
          '<button class="friend-remove-btn" onclick="removeFriend(' + f.friendshipId + ', \'' + escapeAttr(name) + '\')" title="Supprimer">✗</button>' +
        '</div>';
      }).join('');
  }

  function renderRequests() {
    var container = document.getElementById('friends-requests');
    var reqs = (friendsData && friendsData.pendingReceived) || [];
    var sent = (friendsData && friendsData.pendingSent) || [];
    var reqCount = document.getElementById('friends-req-count');
    if (reqCount) reqCount.textContent = reqs.length > 0 ? '(' + reqs.length + ')' : '';

    var html = '';
    if (reqs.length > 0) {
      html += '<div class="friends-req-title">RECUES</div>';
      html += reqs.map(function(r) {
        return '<div class="friend-req-item">' +
          '<span class="friend-avatar">' + (r.avatar || '⚔') + '</span>' +
          '<span class="friend-name">' + escapeHtml(r.displayName || r.username) + '</span>' +
          '<button class="friend-accept-btn" onclick="acceptFriend(' + r.friendshipId + ')">✓</button>' +
          '<button class="friend-decline-btn" onclick="declineFriend(' + r.friendshipId + ')">✗</button>' +
        '</div>';
      }).join('');
    }
    if (sent.length > 0) {
      html += '<div class="friends-req-title">ENVOYEES</div>';
      html += sent.map(function(r) {
        return '<div class="friend-req-item sent"><span class="friend-avatar">' + (r.avatar || '⚔') + '</span><span class="friend-name">' + escapeHtml(r.displayName || r.username) + '</span><span class="friend-pending">en attente</span></div>';
      }).join('');
    }
    if (!html) html = '<div class="friends-empty">Aucune demande</div>';
    container.innerHTML = html;
  }

  function updateBadge() {
    var badge = document.getElementById('friends-badge');
    var total = 0;
    if (friendsData) {
      total += (friendsData.pendingReceived || []).length;
      friendsData.friends.forEach(function(f) { total += f.unreadCount || 0; });
    }
    if (total > 0) { badge.textContent = total; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }
  }

  window.openChat = async function(friendId, friendName) {
    currentChatFriendId = friendId;
    currentChatFriendName = friendName;
    document.getElementById('chat-header-name').textContent = friendName;
    document.getElementById('chat-window').classList.remove('hidden');
    document.getElementById('friends-panel').classList.add('hidden');

    try {
      var res = await fetch('/api/chat/' + friendId);
      var messages = await res.json();
      renderMessages(messages);
      scrollChatBottom();
    } catch(e) {}
    loadFriends();
  };

  window.closeChat = function() {
    document.getElementById('chat-window').classList.add('hidden');
    currentChatFriendId = null;
  };

  window.sendChatMessage = async function() {
    var input = document.getElementById('chat-input');
    var message = input.value.trim();
    if (!message || !currentChatFriendId) return;
    input.value = '';

    // Send typing stop
    try {
      var res = await fetch('/api/chat/' + currentChatFriendId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message })
      });
      var msg = await res.json();
      if (msg.id) { appendMessage(msg, true); scrollChatBottom(); }
    } catch(e) {}
  };

  window.sendFriendRequest = async function() {
    var input = document.getElementById('friend-add-input');
    var username = input.value.trim();
    if (!username) return;
    try {
      var res = await fetch('/api/friends/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username })
      });
      var data = await res.json();
      if (data.success) {
        input.value = '';
        if (window.showToast) showToast('Demande envoyee !', 'success');
        loadFriends();
      } else {
        if (window.showToast) showToast(data.error, 'error');
      }
    } catch(e) { if (window.showToast) showToast('Erreur reseau', 'error'); }
  };

  window.acceptFriend = async function(friendshipId) {
    try {
      var res = await fetch('/api/friends/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId: friendshipId })
      });
      if (res.ok) { if (window.showToast) showToast('Ami accepte !', 'success'); loadFriends(); }
    } catch(e) {}
  };

  window.declineFriend = async function(friendshipId) {
    try {
      await fetch('/api/friends/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId: friendshipId })
      });
      loadFriends();
    } catch(e) {}
  };

  window.removeFriend = async function(friendshipId, name) {
    if (!confirm('Supprimer ' + name + ' de ta liste d\'amis ?')) return;
    try {
      var res = await fetch('/api/friends/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendshipId: friendshipId })
      });
      if (res.ok) {
        if (typeof showToast === 'function') showToast(name + ' supprime de tes amis', 'info');
        loadFriends();
      }
    } catch(e) {}
  };

  function renderMessages(messages) {
    var container = document.getElementById('chat-messages');
    container.innerHTML = messages.map(function(m) {
      var isMine = m.sender_id !== currentChatFriendId;
      var time = new Date(m.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return '<div class="chat-msg ' + (isMine ? 'chat-msg--mine' : 'chat-msg--theirs') + '">' +
        '<span class="chat-msg-time">[' + time + ']</span> ' +
        '<span class="chat-msg-text">' + escapeHtml(m.message) + '</span>' +
      '</div>';
    }).join('');
  }

  function appendMessage(msg, isMine) {
    var container = document.getElementById('chat-messages');
    var time = new Date(msg.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    var div = document.createElement('div');
    div.className = 'chat-msg ' + (isMine ? 'chat-msg--mine' : 'chat-msg--theirs');
    div.innerHTML = '<span class="chat-msg-time">[' + time + ']</span> <span class="chat-msg-text">' + escapeHtml(msg.message) + '</span>';
    container.appendChild(div);
  }

  function scrollChatBottom() {
    var container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  function initFriendsSocket() {
    // Reuse the toast socket or create one
    setTimeout(function() {
      var socket = window._toastSocket || (typeof io !== 'undefined' ? io() : null);
      if (!socket) return;
      if (!window._toastSocket) window._toastSocket = socket;

      socket.on('chat:message', function(msg) {
        if (msg.sender_id === currentChatFriendId) {
          appendMessage(msg, false);
          scrollChatBottom();
          fetch('/api/chat/' + msg.sender_id); // mark read
        } else {
          if (window.showToast) showToast(msg.senderName + ': ' + msg.message.substring(0, 50), 'chat');
        }
        loadFriends();
      });

      socket.on('friend:request', function(data) {
        if (window.showToast) showToast(data.username + ' veut etre ton ami !', 'friend');
        loadFriends();
      });

      socket.on('friend:accepted', function(data) {
        if (window.showToast) showToast(data.username + ' a accepte ta demande !', 'success');
        loadFriends();
      });

      socket.on('friend:status', function() { loadFriends(); });

      socket.on('chat:typing', function(data) {
        if (data.userId === currentChatFriendId) {
          var typing = document.getElementById('chat-typing');
          if (typing) {
            typing.classList.remove('hidden');
            clearTimeout(typing._timer);
            typing._timer = setTimeout(function() { typing.classList.add('hidden'); }, 2000);
          }
        }
      });
    }, 800);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
  function escapeAttr(str) {
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
  }
})();
