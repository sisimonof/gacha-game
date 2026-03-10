// theme-detect.js — Auto-detect system color scheme on first visit
(function() {
  'use strict';

  // Only auto-detect if user hasn't manually chosen a theme
  var savedTheme = localStorage.getItem('gacha-theme');
  var hasChosen = localStorage.getItem('gacha-theme-chosen');

  if (!hasChosen && !savedTheme) {
    // Detect system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      // Light mode users get the blue theme (lighter feel)
      document.documentElement.setAttribute('data-theme', 'blue');
      localStorage.setItem('gacha-theme', 'blue');
    }
    // Dark mode or no preference: keep default green (already dark-optimized)
  }

  // Patch setTheme to record user choice
  var _origSetTheme = window.setTheme;
  Object.defineProperty(window, 'setTheme', {
    set: function(fn) {
      _origSetTheme = fn;
    },
    get: function() {
      return function(theme) {
        localStorage.setItem('gacha-theme-chosen', '1');
        if (_origSetTheme) _origSetTheme(theme);
        else {
          if (theme) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('gacha-theme', theme);
          } else {
            document.documentElement.removeAttribute('data-theme');
            localStorage.removeItem('gacha-theme');
          }
        }
      };
    },
    configurable: true
  });
})();
