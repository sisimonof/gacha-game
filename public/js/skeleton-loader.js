// skeleton-loader.js — Skeleton screen placeholders for loading states
(function() {
  'use strict';

  // Generate skeleton card HTML
  function skeletonCard() {
    return '<div class="skeleton-card"><div class="skeleton-img skeleton-pulse"></div><div class="skeleton-line skeleton-pulse" style="width:70%"></div><div class="skeleton-line skeleton-pulse" style="width:50%"></div></div>';
  }

  // Generate skeleton row (for quests, decks, lists)
  function skeletonRow() {
    return '<div class="skeleton-row"><div class="skeleton-circle skeleton-pulse"></div><div class="skeleton-row-lines"><div class="skeleton-line skeleton-pulse" style="width:80%"></div><div class="skeleton-line skeleton-pulse" style="width:50%"></div></div></div>';
  }

  // Generate skeleton listing (for market)
  function skeletonListing() {
    return '<div class="skeleton-listing"><div class="skeleton-img skeleton-pulse"></div><div class="skeleton-line skeleton-pulse" style="width:60%"></div><div class="skeleton-line skeleton-pulse" style="width:40%"></div></div>';
  }

  // Replace loading text with skeleton placeholders
  function initSkeletons() {
    // Quest loading in menu
    document.querySelectorAll('.quest-loading').forEach(el => {
      el.innerHTML = skeletonRow() + skeletonRow() + skeletonRow();
      el.classList.add('skeleton-container');
    });

    // Market loading
    document.querySelectorAll('.market-loading').forEach(el => {
      el.innerHTML = skeletonListing() + skeletonListing() + skeletonListing() + skeletonListing();
      el.classList.add('skeleton-container', 'skeleton-container--grid');
    });

    // Guild loading
    document.querySelectorAll('.guild-loading').forEach(el => {
      el.innerHTML = skeletonRow() + skeletonRow() + skeletonRow();
      el.classList.add('skeleton-container');
    });

    // Collection grid — show skeleton cards while loading
    const collGrid = document.getElementById('collection-grid');
    if (collGrid && collGrid.children.length === 0) {
      let html = '';
      for (let i = 0; i < 12; i++) html += skeletonCard();
      collGrid.innerHTML = html;
      collGrid.classList.add('skeleton-active');
    }

    // Fusion grids
    document.querySelectorAll('.fusion-grid, .eveil-grid').forEach(el => {
      if (el.children.length === 0) {
        let html = '';
        for (let i = 0; i < 6; i++) html += skeletonCard();
        el.innerHTML = html;
        el.classList.add('skeleton-active');
      }
    });

    // Deck card grid
    const deckGrid = document.querySelector('.deck-card-grid');
    if (deckGrid && deckGrid.children.length === 0) {
      let html = '';
      for (let i = 0; i < 8; i++) html += skeletonCard();
      deckGrid.innerHTML = html;
      deckGrid.classList.add('skeleton-active');
    }
  }

  // Global helper to clear skeletons when real content is ready
  window.clearSkeletons = function(container) {
    if (!container) return;
    container.classList.remove('skeleton-active');
    container.querySelectorAll('.skeleton-container').forEach(el => {
      el.classList.remove('skeleton-container');
    });
  };

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSkeletons);
  } else {
    initSkeletons();
  }
})();
