// keyboard-nav.js — Keyboard shortcuts for navigation & actions
(function() {
  'use strict';

  const NAV_SHORTCUTS = {
    'h': '/menu',        // Home / Accueil
    'b': '/shop',        // Boutique
    'c': '/collection',  // Collection
    'm': '/mine',        // Mine
    'j': '/combat',      // Jouer / Combat
    'p': '/battlepass',   // Passe
    'v': '/market',      // Vente / Marche
    'k': '/casino',      // Casino (K)
    's': '/stats',       // Stats
    'f': '/fusion',      // Forge / Fusion
    'w': '/wiki',        // Wiki
    'g': '/guilds'       // Guildes
  };

  // Shortcut overlay element
  let overlay = null;
  let overlayTimeout = null;

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'kbd-overlay';
    overlay.innerHTML = `
      <div class="kbd-overlay-title">RACCOURCIS CLAVIER</div>
      <div class="kbd-overlay-grid">
        <div class="kbd-shortcut"><kbd>H</kbd><span>Accueil</span></div>
        <div class="kbd-shortcut"><kbd>B</kbd><span>Boutique</span></div>
        <div class="kbd-shortcut"><kbd>C</kbd><span>Collection</span></div>
        <div class="kbd-shortcut"><kbd>M</kbd><span>Mine</span></div>
        <div class="kbd-shortcut"><kbd>J</kbd><span>Combat</span></div>
        <div class="kbd-shortcut"><kbd>P</kbd><span>Passe</span></div>
        <div class="kbd-shortcut"><kbd>V</kbd><span>Marche</span></div>
        <div class="kbd-shortcut"><kbd>K</kbd><span>Casino</span></div>
        <div class="kbd-shortcut"><kbd>S</kbd><span>Stats</span></div>
        <div class="kbd-shortcut"><kbd>F</kbd><span>Forge</span></div>
        <div class="kbd-shortcut"><kbd>W</kbd><span>Wiki</span></div>
        <div class="kbd-shortcut"><kbd>G</kbd><span>Guildes</span></div>
      </div>
      <div class="kbd-overlay-footer">
        <div class="kbd-shortcut"><kbd>Echap</kbd><span>Fermer modals</span></div>
        <div class="kbd-shortcut"><kbd>?</kbd><span>Ce panneau</span></div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function showOverlay() {
    if (!overlay) createOverlay();
    overlay.classList.add('kbd-overlay--visible');
    clearTimeout(overlayTimeout);
  }

  function hideOverlay() {
    if (overlay) overlay.classList.remove('kbd-overlay--visible');
  }

  function isInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function closeAnyModal() {
    // Close overlays by clicking their close buttons or removing visible class
    document.querySelectorAll('.settings-overlay, .achievements-overlay, .patchnotes-overlay, .profile-modal-overlay').forEach(el => {
      if (el.style.display !== 'none' && !el.classList.contains('hidden')) {
        const closeBtn = el.querySelector('.settings-close, .achievements-close, .patchnotes-close, .profile-modal-close');
        if (closeBtn) closeBtn.click();
      }
    });

    // Close mobile more panel
    const morePanel = document.getElementById('mobile-more-panel');
    if (morePanel && morePanel.classList.contains('mobile-more--open')) {
      morePanel.classList.remove('mobile-more--open');
    }

    // Close keyboard overlay
    hideOverlay();
  }

  document.addEventListener('keydown', function(e) {
    // Never intercept when typing in inputs
    if (isInputFocused()) return;

    const key = e.key.toLowerCase();

    // Escape — close modals
    if (key === 'escape') {
      e.preventDefault();
      closeAnyModal();
      return;
    }

    // ? — toggle shortcut overlay
    if (key === '?' || (e.shiftKey && key === '/')) {
      e.preventDefault();
      if (overlay && overlay.classList.contains('kbd-overlay--visible')) {
        hideOverlay();
      } else {
        showOverlay();
      }
      return;
    }

    // Don't navigate with modifier keys (allow Ctrl+C etc.)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Navigation shortcuts
    if (NAV_SHORTCUTS[key]) {
      const target = NAV_SHORTCUTS[key];
      // Don't navigate if already on that page
      if (window.location.pathname === target) return;
      e.preventDefault();
      window.location.href = target;
    }
  });
})();
