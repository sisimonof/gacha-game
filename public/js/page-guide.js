// page-guide.js — First-visit guide system with step-by-step tooltips
(function() {

// Guide definitions per page
var GUIDES = {
  menu: {
    title: 'TABLEAU DE BORD',
    steps: [
      { target: '.dash-avatar', text: 'Cliquez sur votre avatar pour ouvrir votre PROFIL. Vous pouvez y ajouter une bio et une vitrine de cartes !', pos: 'right' },
      { target: '#stat-credits', text: 'Vos CREDITS — la monnaie principale. Gagnez-en via les combats, quetes et le casino.', pos: 'bottom' },
      { target: '#stat-cards', text: 'Votre nombre total de CARTES collectionnees.', pos: 'bottom' },
      { target: '.dash-quests-section', text: 'Vos QUETES quotidiennes et hebdomadaires. Completez-les pour gagner des credits et de l\'XP !', pos: 'top' },
      { target: '.dash-decks-section', text: 'Apercu de vos DECKS de combat. Vous avez besoin d\'un deck de 20 cartes pour combattre.', pos: 'top' },
      { target: '.dash-nav-links', text: 'La barre de navigation — accedez a toutes les fonctionnalites du jeu depuis ici.', pos: 'bottom' },
    ]
  },
  shop: {
    title: 'LA BOUTIQUE',
    steps: [
      { target: '.shop-boosters-grid,.booster-section', text: 'Voici les BOOSTERS disponibles. Chaque booster contient 5 cartes aleatoires de differentes raretes.', pos: 'bottom' },
      { target: '.booster-card,.shop-booster-card', text: 'Cliquez sur un booster pour l\'ouvrir. Le prix et les chances de chaque rarete sont affiches.', pos: 'top', fallback: true },
      { target: '.daily-shop-section,.shop-daily', text: 'La BOUTIQUE DU JOUR propose des cartes specifiques qui changent chaque jour. Revenez souvent !', pos: 'top', fallback: true },
    ]
  },
  collection: {
    title: 'VOTRE COLLECTION',
    steps: [
      { target: '.collection-grid,.cards-grid', text: 'Toutes vos cartes sont ici. Cliquez sur une carte pour voir ses details, la vendre ou la mettre en vitrine.', pos: 'top' },
      { target: '.collection-filters,.filter-bar', text: 'Filtrez par RARETE, ELEMENT ou TYPE pour trouver rapidement une carte.', pos: 'bottom', fallback: true },
      { target: '.collection-search,#search-input', text: 'Recherchez une carte par nom.', pos: 'bottom', fallback: true },
    ]
  },
  combat: {
    title: 'ZONE DE COMBAT',
    steps: [
      { target: '.combat-pve-section,.pve-section', text: 'Le mode PvE — Affrontez des adversaires controles par l\'IA pour gagner des credits et de l\'XP.', pos: 'bottom', fallback: true },
      { target: '.combat-pvp-section,.pvp-section', text: 'Le mode PvP — Affrontez de VRAIS joueurs en temps reel ! Grimpez dans le classement ELO.', pos: 'bottom', fallback: true },
      { target: '.deck-selector,.combat-deck-select', text: 'Selectionnez votre DECK avant de combattre. Vous pouvez aussi utiliser le deck starter par defaut.', pos: 'top', fallback: true },
    ]
  },
  casino: {
    title: 'LE CASINO',
    steps: [
      { target: '#casino-wheel-wrap', text: 'La ROULETTE — Tournez pour gagner des credits, de l\'XP, ou meme des cartes rares !', pos: 'right' },
      { target: '#jackpot-banner', text: 'Le JACKPOT PROGRESSIF ! La cagnotte monte a chaque spin. Si vous gagnez, vous remportez tout !', pos: 'bottom' },
      { target: '#spin-btn', text: 'Chaque spin coute 85 CR. Appuyez ici pour tenter votre chance !', pos: 'top' },
      { target: '.casino-history', text: 'L\'historique de vos derniers resultats. Suivez votre chance !', pos: 'top' },
    ]
  },
  mine: {
    title: 'LA MINE D\'EXTRACTION',
    steps: [
      { target: '.mine-grid,.excavation-grid', text: 'Cliquez sur une case pour CREUSER. Chaque case cache un tresor : credits, essence, ou cartes !', pos: 'top', fallback: true },
      { target: '.mine-depth,.depth-display', text: 'Votre profondeur actuelle. Plus vous creusez profond, plus les tresors sont precieux !', pos: 'bottom', fallback: true },
      { target: '.mine-energy,.essence-display', text: 'L\'ESSENCE est la ressource de la mine. Utilisez-la pour la fusion de cartes a la Forge.', pos: 'bottom', fallback: true },
    ]
  },
  fusion: {
    title: 'LA FORGE',
    steps: [
      { target: '.fusion-zone,.fusion-area', text: 'Placez 2 cartes identiques ici pour tenter une FUSION. La carte resultante sera plus puissante !', pos: 'top', fallback: true },
      { target: '.fusion-chances,.success-rate', text: 'Le taux de reussite depend de la rarete. Les fusions de cartes communes reussissent plus souvent.', pos: 'bottom', fallback: true },
      { target: '.awakening-zone,.awakening-section', text: 'L\'EVEIL permet de transcender une carte au-dela de ses limites avec de l\'essence.', pos: 'top', fallback: true },
    ]
  },
  battlepass: {
    title: 'PASSE DE COMBAT',
    steps: [
      { target: '.bp-track,.bp-tiers', text: 'Chaque palier offre des recompenses uniques. Gagnez de l\'XP en jouant pour progresser !', pos: 'bottom', fallback: true },
      { target: '.bp-xp-bar,.bp-progress', text: 'Votre barre de progression. L\'XP vient des combats, quetes et du casino.', pos: 'bottom', fallback: true },
    ]
  },
  market: {
    title: 'LE MARCHE',
    steps: [
      { target: '.market-listings,.market-grid', text: 'Parcourez les cartes mises en vente par les autres joueurs. Les bonnes affaires sont rares !', pos: 'top', fallback: true },
      { target: '.market-sell-btn,.sell-section', text: 'Vendez vos propres cartes en fixant votre prix. Les doublons sont parfaits pour ca !', pos: 'bottom', fallback: true },
    ]
  },
  decks: {
    title: 'CONSTRUCTEUR DE DECKS',
    steps: [
      { target: '.deck-builder,.deck-area', text: 'Faites glisser ou cliquez sur des cartes pour les ajouter a votre deck. Un deck = 20 cartes exactement.', pos: 'top', fallback: true },
      { target: '.deck-stats,.deck-info', text: 'Les statistiques de votre deck : cout moyen en mana, repartition des elements, etc.', pos: 'bottom', fallback: true },
    ]
  },
  guilds: {
    title: 'LES GUILDES',
    steps: [
      { target: '.guild-list,.guilds-grid', text: 'Rejoignez une guilde existante ou creez la votre ! Les guildes offrent un chat et un tresor partage.', pos: 'top', fallback: true },
      { target: '.guild-treasury,.guild-stats', text: 'Le tresor de guilde se remplit avec les contributions des membres.', pos: 'bottom', fallback: true },
    ]
  },
  stats: {
    title: 'VOS STATISTIQUES',
    steps: [
      { target: '.stats-grid,.stats-section', text: 'Toutes vos statistiques de jeu : combats, casino, fusions, et bien plus. Suivez votre progression !', pos: 'top', fallback: true },
    ]
  },
};

// Detect current page
function getCurrentPage() {
  var path = window.location.pathname.replace(/^\//, '').replace(/\.html$/, '');
  if (path === '' || path === 'menu') return 'menu';
  if (path === 'pvp-battle' || path === 'battle') return null; // no guide during battle
  return path;
}

// Check if guide was already seen
function hasSeenGuide(page) {
  return localStorage.getItem('guide_seen_' + page) === '1';
}

function markGuideSeen(page) {
  localStorage.setItem('guide_seen_' + page, '1');
}

// Create guide overlay
function showGuide(page) {
  var guide = GUIDES[page];
  if (!guide) return;

  var currentStep = 0;
  var overlay = document.createElement('div');
  overlay.id = 'page-guide-overlay';
  overlay.className = 'page-guide-overlay';
  document.body.appendChild(overlay);

  var tooltip = document.createElement('div');
  tooltip.id = 'page-guide-tooltip';
  tooltip.className = 'page-guide-tooltip';
  tooltip.innerHTML =
    '<div class="pg-header">' +
      '<span class="pg-step-badge" id="pg-step-badge">1/' + guide.steps.length + '</span>' +
      '<span class="pg-title" id="pg-title">' + guide.title + '</span>' +
    '</div>' +
    '<div class="pg-text" id="pg-text"></div>' +
    '<div class="pg-arrow" id="pg-arrow"></div>' +
    '<div class="pg-actions">' +
      '<button class="pg-btn pg-btn-skip" id="pg-skip">PASSER LE GUIDE</button>' +
      '<button class="pg-btn pg-btn-next" id="pg-next">SUIVANT ▶</button>' +
    '</div>';
  document.body.appendChild(tooltip);

  function findTarget(step) {
    var selectors = step.target.split(',');
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i].trim());
      if (el && el.offsetParent !== null) return el;
    }
    return step.fallback ? null : null;
  }

  function showStep(idx) {
    if (idx >= guide.steps.length) {
      closeGuide();
      return;
    }
    currentStep = idx;
    var step = guide.steps[idx];
    var target = findTarget(step);

    document.getElementById('pg-step-badge').textContent = (idx + 1) + '/' + guide.steps.length;
    document.getElementById('pg-text').textContent = step.text;

    // Remove old highlight
    var oldHL = document.querySelector('.pg-highlight');
    if (oldHL) oldHL.classList.remove('pg-highlight');

    if (target) {
      target.classList.add('pg-highlight');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Position tooltip near target
      setTimeout(function() {
        positionTooltip(target, step.pos || 'bottom');
      }, 300);
    } else {
      // No target found, show tooltip centered
      tooltip.style.position = 'fixed';
      tooltip.style.top = '50%';
      tooltip.style.left = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
      document.getElementById('pg-arrow').className = 'pg-arrow pg-arrow-hidden';
    }

    // Update button text on last step
    document.getElementById('pg-next').textContent = idx === guide.steps.length - 1 ? 'TERMINER ✓' : 'SUIVANT ▶';
  }

  function positionTooltip(target, pos) {
    var rect = target.getBoundingClientRect();
    var ttW = 320;
    var ttH = tooltip.offsetHeight || 180;
    var margin = 16;
    var arrowEl = document.getElementById('pg-arrow');

    tooltip.style.transform = '';
    tooltip.style.position = 'fixed';

    if (pos === 'bottom') {
      tooltip.style.top = Math.min(rect.bottom + margin, window.innerHeight - ttH - 10) + 'px';
      tooltip.style.left = Math.max(10, Math.min(rect.left + rect.width / 2 - ttW / 2, window.innerWidth - ttW - 10)) + 'px';
      arrowEl.className = 'pg-arrow pg-arrow-up';
    } else if (pos === 'top') {
      tooltip.style.top = Math.max(10, rect.top - ttH - margin) + 'px';
      tooltip.style.left = Math.max(10, Math.min(rect.left + rect.width / 2 - ttW / 2, window.innerWidth - ttW - 10)) + 'px';
      arrowEl.className = 'pg-arrow pg-arrow-down';
    } else if (pos === 'right') {
      tooltip.style.top = Math.max(10, rect.top + rect.height / 2 - ttH / 2) + 'px';
      tooltip.style.left = Math.min(rect.right + margin, window.innerWidth - ttW - 10) + 'px';
      arrowEl.className = 'pg-arrow pg-arrow-left';
    } else if (pos === 'left') {
      tooltip.style.top = Math.max(10, rect.top + rect.height / 2 - ttH / 2) + 'px';
      tooltip.style.left = Math.max(10, rect.left - ttW - margin) + 'px';
      arrowEl.className = 'pg-arrow pg-arrow-right';
    }
  }

  function closeGuide() {
    var hl = document.querySelector('.pg-highlight');
    if (hl) hl.classList.remove('pg-highlight');
    overlay.remove();
    tooltip.remove();
    markGuideSeen(page);
  }

  document.getElementById('pg-next').addEventListener('click', function() {
    showStep(currentStep + 1);
  });

  document.getElementById('pg-skip').addEventListener('click', closeGuide);

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) showStep(currentStep + 1);
  });

  // Start
  setTimeout(function() { showStep(0); }, 800);
}

// Init on page load
document.addEventListener('DOMContentLoaded', function() {
  var page = getCurrentPage();
  if (!page) return;
  if (hasSeenGuide(page)) return;

  // Delay to let page content render
  setTimeout(function() {
    showGuide(page);
  }, 1500);
});

// Allow re-triggering guide from a help button
window.showPageGuide = function() {
  var page = getCurrentPage();
  if (page) {
    localStorage.removeItem('guide_seen_' + page);
    showGuide(page);
  }
};

})();
