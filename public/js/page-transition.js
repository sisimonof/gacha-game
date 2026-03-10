// page-transition.js — Smooth fade transitions between pages
(function() {
  'use strict';

  // Fade in on page load
  document.documentElement.classList.add('page-transitioning');

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function() {
    // Small delay to ensure CSS is applied, then remove transition class
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        document.documentElement.classList.remove('page-transitioning');
        document.documentElement.classList.add('page-ready');
      });
    });
  });

  // Intercept link clicks for fade out
  document.addEventListener('click', function(e) {
    const link = e.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');

    // Skip non-navigation links
    if (!href || href.startsWith('#') || href.startsWith('javascript:') ||
        link.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey) return;

    // Skip external links
    if (href.startsWith('http') && !href.startsWith(window.location.origin)) return;

    // Skip same page
    if (href === window.location.pathname) return;

    e.preventDefault();

    // Fade out
    document.documentElement.classList.add('page-leaving');

    // Navigate after animation
    setTimeout(function() {
      window.location.href = href;
    }, 200);
  });
})();
