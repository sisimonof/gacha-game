// mobile-nav.js — Enhanced bottom navigation bar for mobile
(function() {
  // Only show on screens <= 900px
  if (window.innerWidth > 900 && !window.matchMedia('(max-width: 900px)').matches) return;

  const currentPath = window.location.pathname;

  const mainLinks = [
    { href: '/menu',       icon: '🏠',  label: 'ACCUEIL',    color: '' },
    { href: '/shop',       icon: '🛒',  label: 'BOUTIQUE',   color: '#00e5ff' },
    { href: '/collection', icon: '📚',  label: 'COLLECT.',   color: '' },
    { href: '/combat',     icon: '⚔️',   label: 'COMBAT',     color: '#ff4444' },
    { href: '#more',       icon: '⋯',   label: 'PLUS',       color: '' }
  ];

  const moreLinks = [
    { href: '/mine',       icon: '⛏️',   label: 'MINE',       color: '#ff8800' },
    { href: '/fusion',     icon: '🔮',  label: 'FORGE',      color: '#cc44cc' },
    { href: '/casino',     icon: '🎰',  label: 'CASINO',     color: '#ff4444' },
    { href: '/market',     icon: '💰',  label: 'MARCHE',     color: '#ffcc00' },
    { href: '/battlepass', icon: '🏆',  label: 'PASSE',      color: '#ffaa00' },
    { href: '/stats',      icon: '📊',  label: 'STATS',      color: '#00cccc' },
    { href: '/wiki',       icon: '📖',  label: 'WIKI',       color: '' },
    { href: '/guilds',     icon: '🏰',  label: 'GUILDES',    color: '#00cc66' }
  ];

  // Build bottom nav
  const nav = document.createElement('nav');
  nav.className = 'mobile-bottom-nav';
  nav.innerHTML = mainLinks.map(link => {
    const isActive = (link.href !== '#more' && currentPath === link.href) ||
                     (link.href === '#more' && moreLinks.some(m => m.href === currentPath));
    const activeClass = isActive ? 'mobile-nav-item--active' : '';
    const moreClass = link.href === '#more' ? 'mobile-nav-more-btn' : '';
    const colorStyle = isActive && link.color ? `style="color:${link.color}; text-shadow: 0 0 10px ${link.color}50"` : '';
    return `<a href="${link.href}" class="mobile-nav-item ${activeClass} ${moreClass}" ${link.href === '#more' ? 'onclick="toggleMobileMore(event)"' : ''}>
      <span class="mobile-nav-icon" ${colorStyle}>${link.icon}</span>
      <span class="mobile-nav-label" ${colorStyle}>${link.label}</span>
      ${isActive && link.href !== '#more' ? '<span class="mobile-nav-dot"></span>' : ''}
    </a>`;
  }).join('');

  // Build "more" panel
  const panel = document.createElement('div');
  panel.className = 'mobile-more-panel';
  panel.id = 'mobile-more-panel';
  panel.innerHTML = `
    <div class="mobile-more-overlay" onclick="toggleMobileMore(event)"></div>
    <div class="mobile-more-content">
      <div class="mobile-more-handle"></div>
      <div class="mobile-more-grid">
        ${moreLinks.map(link => {
          const isActive = currentPath === link.href;
          const colorAttr = link.color ? `style="--item-color:${link.color}"` : '';
          return `<a href="${link.href}" class="mobile-more-item ${isActive ? 'mobile-more-item--active' : ''}" ${colorAttr}>
            <span class="mobile-more-icon">${link.icon}</span>
            <span class="mobile-more-label">${link.label}</span>
          </a>`;
        }).join('')}
      </div>
    </div>
  `;

  document.body.appendChild(panel);
  document.body.appendChild(nav);
  document.body.classList.add('has-mobile-nav');

  // Hide desktop elements on mobile
  const backBtn = document.querySelector('.back-btn');
  if (backBtn) backBtn.classList.add('mobile-hidden');

  // Toggle more panel
  window.toggleMobileMore = function(e) {
    e.preventDefault();
    e.stopPropagation();
    const p = document.getElementById('mobile-more-panel');
    p.classList.toggle('mobile-more--open');
  };

  // Swipe down to close more panel
  let touchStartY = 0;
  const moreContent = panel.querySelector('.mobile-more-content');
  moreContent.addEventListener('touchstart', function(e) {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  moreContent.addEventListener('touchmove', function(e) {
    const diff = e.touches[0].clientY - touchStartY;
    if (diff > 60) {
      panel.classList.remove('mobile-more--open');
    }
  }, { passive: true });

  // Handle resize
  window.addEventListener('resize', function() {
    if (window.innerWidth <= 900) {
      nav.style.display = '';
      document.body.classList.add('has-mobile-nav');
    } else {
      nav.style.display = 'none';
      document.body.classList.remove('has-mobile-nav');
      panel.classList.remove('mobile-more--open');
    }
  });
})();
