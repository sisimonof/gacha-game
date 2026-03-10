// reward-fx.js — Floating reward animations (+X credits, +XP, etc.)
(function() {
  // Create the container for floating rewards
  document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('reward-fx-container')) {
      const c = document.createElement('div');
      c.id = 'reward-fx-container';
      c.className = 'reward-fx-container';
      document.body.appendChild(c);
    }
  });

  /**
   * Show a floating reward animation
   * @param {string} text - e.g. "+500", "+3 cartes"
   * @param {string} type - "credits", "xp", "essence", "cards", "generic"
   * @param {Element} [anchor] - optional element to position near (defaults to center-top)
   */
  window.showRewardFx = function(text, type, anchor) {
    type = type || 'generic';
    const container = document.getElementById('reward-fx-container');
    if (!container) return;

    const COLORS = {
      credits:  { color: '#ffcc00', icon: '💰', shadow: 'rgba(255, 204, 0, 0.6)' },
      xp:      { color: '#66aaff', icon: '⭐', shadow: 'rgba(102, 170, 255, 0.6)' },
      essence: { color: '#cc66ff', icon: '⛏',  shadow: 'rgba(204, 102, 255, 0.6)' },
      cards:   { color: '#00ff88', icon: '🃏', shadow: 'rgba(0, 255, 136, 0.6)' },
      generic: { color: '#ffffff', icon: '✦',  shadow: 'rgba(255, 255, 255, 0.5)' }
    };

    var cfg = COLORS[type] || COLORS.generic;

    var el = document.createElement('div');
    el.className = 'reward-fx reward-fx--' + type;
    el.innerHTML = '<span class="reward-fx-icon">' + cfg.icon + '</span> ' +
                   '<span class="reward-fx-text">' + text + '</span>';
    el.style.color = cfg.color;
    el.style.textShadow = '0 0 12px ' + cfg.shadow + ', 0 0 24px ' + cfg.shadow;

    // Position near anchor element or center of screen
    if (anchor) {
      var rect = anchor.getBoundingClientRect();
      el.style.left = rect.left + rect.width / 2 + 'px';
      el.style.top = rect.top + 'px';
    } else {
      el.style.left = '50%';
      el.style.top = '30%';
      el.style.transform = 'translateX(-50%)';
    }

    container.appendChild(el);
    requestAnimationFrame(function() { el.classList.add('reward-fx--animate'); });

    setTimeout(function() { el.remove(); }, 2000);
  };

  // Helper: show credits reward near the credits display
  window.showCreditsReward = function(amount) {
    var el = document.getElementById('stat-credits') || document.getElementById('nav-credits');
    showRewardFx('+' + amount + ' CR', 'credits', el);
  };

  window.showXpReward = function(amount) {
    var el = document.getElementById('sidebar-bp-xp');
    showRewardFx('+' + amount + ' XP', 'xp', el);
  };

  window.showEssenceReward = function(amount) {
    var el = document.getElementById('stat-essence');
    showRewardFx('+' + amount, 'essence', el);
  };
})();
