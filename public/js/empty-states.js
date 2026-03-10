// empty-states.js — Engaging empty state messages with CTAs
(function() {
  'use strict';

  const emptyStates = {
    'collection-grid': {
      icon: '&#128230;',
      title: 'AUCUNE CARTE',
      text: 'Votre collection est vide. Ouvrez des boosters pour obtenir vos premieres cartes !',
      cta: { label: '> BOUTIQUE', href: '/shop' }
    },
    'decks-preview-list': {
      icon: '&#127183;',
      title: 'AUCUN DECK',
      text: 'Creez votre premier deck pour partir au combat.',
      cta: { label: '> CREER UN DECK', href: '/decks' }
    },
    'quests-grid': {
      icon: '&#128220;',
      title: 'AUCUNE QUETE',
      text: 'Les quetes se renouvellent chaque jour. Revenez bientot !',
      cta: null
    },
    'market-grid': {
      icon: '&#128176;',
      title: 'MARCHE VIDE',
      text: 'Aucune carte en vente pour le moment.',
      cta: null
    },
    'guild-browse-list': {
      icon: '&#127984;',
      title: 'AUCUNE GUILDE',
      text: 'Soyez le premier a creer une guilde !',
      cta: null
    },
    'fusion-grid': {
      icon: '&#128302;',
      title: 'AUCUNE CARTE A FUSIONNER',
      text: 'Vous avez besoin de doubles pour fusionner. Ouvrez plus de boosters !',
      cta: { label: '> BOUTIQUE', href: '/shop' }
    },
    'eveil-grid': {
      icon: '&#10024;',
      title: 'AUCUN EVEIL DISPONIBLE',
      text: 'Fusionnez des cartes pour debloquer les eveils.',
      cta: null
    },
    'deck-card-grid': {
      icon: '&#128214;',
      title: 'AUCUNE CARTE DISPONIBLE',
      text: 'Obtenez des cartes pour construire votre deck.',
      cta: { label: '> BOUTIQUE', href: '/shop' }
    },
    'casino-history-list': {
      icon: '&#127922;',
      title: 'AUCUN HISTORIQUE',
      text: 'Tentez votre chance a la roue pour voir vos resultats ici.',
      cta: null
    }
  };

  function createEmptyState(config) {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.innerHTML = `
      <div class="empty-state-icon">${config.icon}</div>
      <div class="empty-state-title">${config.title}</div>
      <div class="empty-state-text">${config.text}</div>
      ${config.cta ? `<a href="${config.cta.href}" class="empty-state-cta">${config.cta.label}</a>` : ''}
    `;
    return div;
  }

  // Expose globally so page scripts can use it
  window.showEmptyState = function(containerId, customConfig) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const config = customConfig || emptyStates[containerId];
    if (!config) return;

    // Clear skeletons/loading content
    container.classList.remove('skeleton-active');
    container.innerHTML = '';
    container.appendChild(createEmptyState(config));
  };

  window.hideEmptyState = function(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();
  };
})();
