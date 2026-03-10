// mobile-nav.js — Bottom navigation bar for mobile
(function() {
  // Only show on screens <= 900px
  if (window.innerWidth > 900 && !window.matchMedia('(max-width: 900px)').matches) return;

  const currentPath = window.location.pathname;

  const mainLinks = [
    { href: '/menu',       icon: '&#9776;',   label: 'ACCUEIL' },
    { href: '/shop',       icon: '&#128176;',  label: 'BOUTIQUE' },
    { href: '/collection', icon: '&#128214;',  label: 'COLLECTION' },
    { href: '/combat',     icon: '&#9876;',    label: 'COMBAT' },
    { href: '#more',       icon: '&#8943;',    label: 'PLUS' }
  ];

  const moreLinks = [
    { href: '/mine',       icon: '&#9935;',    label: 'MINE' },
    { href: '/fusion',     icon: '&#128302;',  label: 'FORGE' },
    { href: '/casino',     icon: '&#127922;',  label: 'CASINO' },
    { href: '/market',     icon: '&#128176;',  label: 'MARCHE' },
    { href: '/battlepass', icon: '&#127942;',  label: 'PASSE' },
    { href: '/stats',      icon: '&#128202;',  label: 'STATS' },
    { href: '/wiki',       icon: '&#128214;',  label: 'WIKI' },
    { href: '/guilds',     icon: '&#9876;',    label: 'GUILDES' }
  ];

  // Build bottom nav
  const nav = document.createElement('nav');
  nav.className = 'mobile-bottom-nav';
  nav.innerHTML = mainLinks.map(link => {
    const isActive = (link.href !== '#more' && currentPath === link.href) ||
                     (link.href === '#more' && moreLinks.some(m => m.href === currentPath));
    const activeClass = isActive ? 'mobile-nav-item--active' : '';
    const moreClass = link.href === '#more' ? 'mobile-nav-more-btn' : '';
    return `<a href="${link.href}" class="mobile-nav-item ${activeClass} ${moreClass}" ${link.href === '#more' ? 'onclick="toggleMobileMore(event)"' : ''}>
      <span class="mobile-nav-icon">${link.icon}</span>
      <span class="mobile-nav-label">${link.label}</span>
    </a>`;
  }).join('');

  // Build "more" panel
  const panel = document.createElement('div');
  panel.className = 'mobile-more-panel';
  panel.id = 'mobile-more-panel';
  panel.innerHTML = `
    <div class="mobile-more-overlay" onclick="toggleMobileMore(event)"></div>
    <div class="mobile-more-content">
      <div class="mobile-more-header">
        <span class="mobile-more-title">NAVIGATION</span>
        <button class="mobile-more-close" onclick="toggleMobileMore(event)">&times;</button>
      </div>
      <div class="mobile-more-grid">
        ${moreLinks.map(link => {
          const isActive = currentPath === link.href;
          return `<a href="${link.href}" class="mobile-more-item ${isActive ? 'mobile-more-item--active' : ''}">
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

  // Toggle more panel
  window.toggleMobileMore = function(e) {
    e.preventDefault();
    e.stopPropagation();
    const p = document.getElementById('mobile-more-panel');
    p.classList.toggle('mobile-more--open');
  };

  // Also build on resize
  window.addEventListener('resize', function() {
    if (window.innerWidth <= 900) {
      nav.style.display = '';
      document.body.classList.add('has-mobile-nav');
    } else {
      nav.style.display = 'none';
      document.body.classList.remove('has-mobile-nav');
      document.getElementById('mobile-more-panel').classList.remove('mobile-more--open');
    }
  });
})();
