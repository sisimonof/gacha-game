// market.js — Player-to-player card marketplace
(function() {
  const TAX_RATE = 0.10;
  const PAGE_SIZE = 20;

  let currentTab = 'browse';
  let currentPage = 1;
  let totalPages = 1;
  let myCards = [];
  let selectedSellCard = null;
  let selectedBuyListing = null;
  let credits = 0;

  // === INIT ===
  document.addEventListener('DOMContentLoaded', () => {
    loadCredits();
    loadMarketListings();
    initSocket();

    // Price input live tax update
    const priceInput = document.getElementById('sell-price-input');
    if (priceInput) {
      priceInput.addEventListener('input', updateTaxPreview);
    }
  });

  async function loadCredits() {
    try {
      const res = await fetch('/api/me');
      if (!res.ok) return;
      const data = await res.json();
      credits = data.credits;
      document.getElementById('credits-count').textContent = credits;
    } catch(e) {}
  }

  // === SOCKET ===
  function initSocket() {
    setTimeout(() => {
      const socket = window._toastSocket || (typeof io !== 'undefined' ? io() : null);
      if (!socket) return;
      if (!window._toastSocket) window._toastSocket = socket;

      socket.on('notification', function(data) {
        if (data.message && data.message.includes('vendue')) {
          // Refresh credits and listings
          loadCredits();
          if (currentTab === 'my-listings') loadMyListings();
        }
      });
    }, 800);
  }

  // === TAB SWITCHING ===
  window.switchTab = function(tab) {
    currentTab = tab;
    document.querySelectorAll('.market-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.getElementById('tab-browse').classList.toggle('hidden', tab !== 'browse');
    document.getElementById('tab-sell').classList.toggle('hidden', tab !== 'sell');
    document.getElementById('tab-my-listings').classList.toggle('hidden', tab !== 'my-listings');

    if (tab === 'browse') loadMarketListings();
    else if (tab === 'sell') loadMyCardsForSale();
    else if (tab === 'my-listings') loadMyListings();
  };

  // ============================================
  // BROWSE TAB — listings
  // ============================================
  async function loadMarketListings() {
    const grid = document.getElementById('market-grid');
    grid.innerHTML = '<div class="market-loading">Chargement...</div>';

    const search = document.getElementById('market-search').value.trim();
    const rarity = document.getElementById('market-rarity').value;
    const element = document.getElementById('market-element').value;
    const sort = document.getElementById('market-sort').value;

    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (rarity !== 'all') params.set('rarity', rarity);
    if (element !== 'all') params.set('element', element);
    if (sort) params.set('sort', sort);
    params.set('page', currentPage);

    try {
      const res = await fetch('/api/market?' + params.toString());
      if (!res.ok) throw new Error();
      const data = await res.json();

      totalPages = data.totalPages || 1;
      renderListings(data.listings);
      renderPagination();
    } catch(e) {
      grid.innerHTML = '<div class="market-loading">Erreur de chargement</div>';
    }
  }

  function renderListings(listings) {
    const grid = document.getElementById('market-grid');
    if (!listings || listings.length === 0) {
      grid.innerHTML = '<div class="market-empty">Aucune carte en vente</div>';
      return;
    }

    grid.innerHTML = listings.map(l => {
      const r = RARITY_COLORS[l.rarity] || RARITY_COLORS.commune;
      const elemIcon = ELEMENT_ICONS[l.element] || '?';
      const sellerName = l.sellerDisplayName || l.sellerName;
      const cardEmoji = l.emoji || elemIcon;
      const hasImage = l.image && l.image !== '';

      let badges = '';
      if (l.is_shiny) badges += '<span class="market-card-badge badge-shiny">SHINY</span>';
      if (l.is_fused) badges += '<span class="market-card-badge badge-fused">FUSION+</span>';
      if (l.is_temp) badges += '<span class="market-card-badge badge-temp">TEMP</span>';

      const visual = hasImage
        ? '<img class="market-card-img" src="/img/cards/' + l.image + '" alt="' + l.name + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
          '<div class="market-card-emoji" style="display:none">' + cardEmoji + '</div>'
        : '<div class="market-card-emoji">' + cardEmoji + '</div>';

      return '<div class="market-listing-card" onclick="openBuyModal(' + l.listingId + ',' + JSON.stringify(l).replace(/"/g, '&quot;') + ')" style="border-color:' + r.color + '">' +
        '<div class="market-card-rarity" style="background:' + r.color + '">' + r.label + '</div>' +
        badges +
        '<div class="market-card-visual">' + visual + '</div>' +
        '<div class="market-card-name">' + l.name + '</div>' +
        '<div class="market-card-element" style="color:' + (ELEMENT_COLORS[l.element] || '#00ff41') + '">' + elemIcon + ' ' + (ELEMENT_NAMES[l.element] || '') + '</div>' +
        '<div class="market-card-stats-mini">' +
          '<span style="color:#ff4444">ATK ' + l.attack + '</span>' +
          '<span style="color:#4488ff">DEF ' + l.defense + '</span>' +
          '<span style="color:#44dd44">PV ' + l.hp + '</span>' +
        '</div>' +
        '<div class="market-card-price">' + l.price + ' CR</div>' +
        '<div class="market-card-seller">' + (l.sellerAvatar || '') + ' ' + escapeHtml(sellerName) + '</div>' +
      '</div>';
    }).join('');
  }

  // === PAGINATION ===
  function renderPagination() {
    const container = document.getElementById('market-pagination');
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = '';
    if (currentPage > 1) {
      html += '<button class="market-page-btn" onclick="goToPage(' + (currentPage - 1) + ')">&laquo;</button>';
    }
    for (let i = 1; i <= totalPages; i++) {
      if (i === currentPage) {
        html += '<button class="market-page-btn market-page-active">' + i + '</button>';
      } else if (Math.abs(i - currentPage) <= 2 || i === 1 || i === totalPages) {
        html += '<button class="market-page-btn" onclick="goToPage(' + i + ')">' + i + '</button>';
      } else if (Math.abs(i - currentPage) === 3) {
        html += '<span class="market-page-dots">...</span>';
      }
    }
    if (currentPage < totalPages) {
      html += '<button class="market-page-btn" onclick="goToPage(' + (currentPage + 1) + ')">&raquo;</button>';
    }
    container.innerHTML = html;
  }

  window.goToPage = function(page) {
    currentPage = page;
    loadMarketListings();
    // Scroll to top of grid
    document.getElementById('market-grid').scrollIntoView({ behavior: 'smooth' });
  };

  // === FILTERS ===
  // Debounce search
  let searchTimer;
  const searchInput = document.getElementById('market-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { currentPage = 1; loadMarketListings(); }, 400);
    });
  }

  document.getElementById('market-rarity')?.addEventListener('change', () => { currentPage = 1; loadMarketListings(); });
  document.getElementById('market-element')?.addEventListener('change', () => { currentPage = 1; loadMarketListings(); });
  document.getElementById('market-sort')?.addEventListener('change', () => { currentPage = 1; loadMarketListings(); });

  // ============================================
  // BUY MODAL
  // ============================================
  window.openBuyModal = function(listingId, listing) {
    selectedBuyListing = listing;
    selectedBuyListing._listingId = listingId;

    const emoji = listing.emoji || ELEMENT_ICONS[listing.element] || '?';
    document.getElementById('buy-preview-emoji').textContent = emoji;
    document.getElementById('buy-preview-name').textContent = listing.name;

    const r = RARITY_COLORS[listing.rarity] || RARITY_COLORS.commune;
    let infoHtml = '<span style="color:' + r.color + '">' + r.label + '</span>';
    if (listing.is_shiny) infoHtml += ' <span style="color:#ffcc00">SHINY</span>';
    if (listing.is_fused) infoHtml += ' <span style="color:#ff6600">FUSION+</span>';
    infoHtml += '<br><strong>' + listing.price + ' CR</strong>';
    document.getElementById('buy-price-info').innerHTML = infoHtml;

    const sellerName = listing.sellerDisplayName || listing.sellerName || '';
    document.getElementById('buy-seller-info').textContent = 'Vendeur: ' + sellerName;

    document.getElementById('buy-overlay').classList.remove('hidden');
  };

  window.closeBuyModal = function() {
    document.getElementById('buy-overlay').classList.add('hidden');
    selectedBuyListing = null;
  };

  window.confirmBuy = async function() {
    if (!selectedBuyListing) return;
    const listingId = selectedBuyListing._listingId;

    try {
      const res = await fetch('/api/market/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId })
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Erreur', 'error');
        return;
      }

      credits = data.credits;
      document.getElementById('credits-count').textContent = credits;
      showToast(data.message, 'success', 5000);
      closeBuyModal();
      loadMarketListings();
    } catch(e) {
      showToast('Erreur reseau', 'error');
    }
  };

  // ============================================
  // SELL TAB — my cards
  // ============================================
  async function loadMyCardsForSale() {
    const grid = document.getElementById('sell-cards-grid');
    grid.innerHTML = '<div class="market-loading">Chargement...</div>';

    try {
      const res = await fetch('/api/market/my-cards');
      if (!res.ok) throw new Error();
      myCards = await res.json();
      renderSellGrid();
    } catch(e) {
      grid.innerHTML = '<div class="market-loading">Erreur de chargement</div>';
    }
  }

  function renderSellGrid() {
    const grid = document.getElementById('sell-cards-grid');
    if (!myCards || myCards.length === 0) {
      grid.innerHTML = '<div class="market-empty">Aucune carte dans votre collection</div>';
      return;
    }

    grid.innerHTML = myCards.map(card => {
      const r = RARITY_COLORS[card.rarity] || RARITY_COLORS.commune;
      const elemIcon = ELEMENT_ICONS[card.element] || '?';
      const cardEmoji = card.emoji || elemIcon;
      const onMarket = card.onMarket;

      let badges = '';
      if (card.is_shiny) badges += '<span class="market-card-badge badge-shiny">SHINY</span>';
      if (card.is_fused) badges += '<span class="market-card-badge badge-fused">FUSION+</span>';
      if (card.is_temp) badges += '<span class="market-card-badge badge-temp">TEMP</span>';
      if (onMarket) badges += '<span class="market-card-badge badge-market">EN VENTE</span>';

      const hasImage = card.image && card.image !== '';
      const visual = hasImage
        ? '<img class="market-card-img" src="/img/cards/' + card.image + '" alt="' + card.name + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
          '<div class="market-card-emoji" style="display:none">' + cardEmoji + '</div>'
        : '<div class="market-card-emoji">' + cardEmoji + '</div>';

      const clickAction = onMarket ? '' : 'onclick="openSellModal(' + card.userCardId + ',' + JSON.stringify(card).replace(/"/g, '&quot;') + ')"';
      const disabledCls = onMarket ? ' market-sell-card--disabled' : '';

      return '<div class="market-listing-card market-sell-card' + disabledCls + '" ' + clickAction + ' style="border-color:' + r.color + '">' +
        '<div class="market-card-rarity" style="background:' + r.color + '">' + r.label + '</div>' +
        badges +
        '<div class="market-card-visual">' + visual + '</div>' +
        '<div class="market-card-name">' + card.name + '</div>' +
        '<div class="market-card-element" style="color:' + (ELEMENT_COLORS[card.element] || '#00ff41') + '">' + elemIcon + '</div>' +
        '<div class="market-card-stats-mini">' +
          '<span style="color:#ff4444">ATK ' + card.attack + '</span>' +
          '<span style="color:#4488ff">DEF ' + card.defense + '</span>' +
          '<span style="color:#44dd44">PV ' + card.hp + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ============================================
  // SELL MODAL
  // ============================================
  window.openSellModal = function(userCardId, card) {
    selectedSellCard = card;
    selectedSellCard._userCardId = userCardId;

    const emoji = card.emoji || ELEMENT_ICONS[card.element] || '?';
    document.getElementById('sell-preview-emoji').textContent = emoji;
    document.getElementById('sell-preview-name').textContent = card.name;

    const priceInput = document.getElementById('sell-price-input');
    priceInput.value = 100;
    updateTaxPreview();

    document.getElementById('sell-overlay').classList.remove('hidden');
  };

  window.closeSellModal = function() {
    document.getElementById('sell-overlay').classList.add('hidden');
    selectedSellCard = null;
  };

  function updateTaxPreview() {
    const priceInput = document.getElementById('sell-price-input');
    const price = parseInt(priceInput.value) || 0;
    const tax = Math.floor(price * TAX_RATE);
    const received = price - tax;
    document.getElementById('sell-tax-info').textContent = 'Taxe 10% — Vous recevrez: ' + received + ' CR';
  }

  window.confirmSell = async function() {
    if (!selectedSellCard) return;
    const priceInput = document.getElementById('sell-price-input');
    const price = parseInt(priceInput.value);

    if (!price || price < 10 || price > 999999) {
      showToast('Prix entre 10 et 999 999 CR', 'error');
      return;
    }

    try {
      const res = await fetch('/api/market/sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCardId: selectedSellCard._userCardId, price })
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Erreur', 'error');
        return;
      }

      showToast(data.message, 'success');
      closeSellModal();
      loadMyCardsForSale();
    } catch(e) {
      showToast('Erreur reseau', 'error');
    }
  };

  // ============================================
  // MY LISTINGS TAB
  // ============================================
  async function loadMyListings() {
    const container = document.getElementById('my-listings-container');
    container.innerHTML = '<div class="market-loading">Chargement...</div>';

    try {
      const res = await fetch('/api/market/my-listings');
      if (!res.ok) throw new Error();
      const listings = await res.json();
      renderMyListings(listings);
    } catch(e) {
      container.innerHTML = '<div class="market-loading">Erreur de chargement</div>';
    }
  }

  function renderMyListings(listings) {
    const container = document.getElementById('my-listings-container');
    if (!listings || listings.length === 0) {
      container.innerHTML = '<div class="market-empty">Aucune vente active</div>';
      return;
    }

    container.innerHTML = '<div class="market-my-listings-grid">' + listings.map(l => {
      const r = RARITY_COLORS[l.rarity] || RARITY_COLORS.commune;
      const elemIcon = ELEMENT_ICONS[l.element] || '?';
      const cardEmoji = l.emoji || elemIcon;
      const hasImage = l.image && l.image !== '';

      let badges = '';
      if (l.is_shiny) badges += '<span class="market-card-badge badge-shiny">SHINY</span>';
      if (l.is_fused) badges += '<span class="market-card-badge badge-fused">FUSION+</span>';

      const tax = Math.floor(l.price * TAX_RATE);
      const received = l.price - tax;

      const visual = hasImage
        ? '<img class="market-card-img" src="/img/cards/' + l.image + '" alt="' + l.name + '" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
          '<div class="market-card-emoji" style="display:none">' + cardEmoji + '</div>'
        : '<div class="market-card-emoji">' + cardEmoji + '</div>';

      return '<div class="market-listing-card market-my-listing" style="border-color:' + r.color + '">' +
        '<div class="market-card-rarity" style="background:' + r.color + '">' + r.label + '</div>' +
        badges +
        '<div class="market-card-visual">' + visual + '</div>' +
        '<div class="market-card-name">' + l.name + '</div>' +
        '<div class="market-card-price">' + l.price + ' CR</div>' +
        '<div class="market-card-tax">Vous recevrez: ' + received + ' CR</div>' +
        '<button class="market-cancel-btn" onclick="cancelListing(' + l.listingId + ')">ANNULER</button>' +
      '</div>';
    }).join('') + '</div>';
  }

  window.cancelListing = async function(listingId) {
    try {
      const res = await fetch('/api/market/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId })
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || 'Erreur', 'error');
        return;
      }

      showToast(data.message, 'success');
      loadMyListings();
    } catch(e) {
      showToast('Erreur reseau', 'error');
    }
  };

  // === UTILS ===
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
})();
