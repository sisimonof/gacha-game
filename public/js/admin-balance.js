// admin-balance.js — Balance analysis tool for admin
(function() {
  'use strict';

  let currentData = null;

  const ELEMENT_ICONS = { feu: '🔥', eau: '💧', terre: '🌿', lumiere: '✨', ombre: '🌑' };
  const ELEMENT_COLORS = { feu: '#ff4422', eau: '#2299ff', terre: '#44aa33', lumiere: '#ffcc00', ombre: '#9944cc' };
  const RARITY_COLORS = { commune: '#888', rare: '#4488ff', epique: '#cc44ff', legendaire: '#ffaa00', chaos: '#ff0044', secret: '#111' };

  async function loadAnalysis() {
    const days = document.getElementById('period-select').value;
    const minGames = document.getElementById('mingames-select').value;

    try {
      const res = await fetch(`/api/admin/balance-analysis?days=${days}&minGames=${minGames}`);
      if (!res.ok) {
        if (res.status === 403) {
          showToast && showToast('Acces refuse — admin requis', 'error');
          return;
        }
        throw new Error('Erreur serveur');
      }
      currentData = await res.json();
      renderAll();
    } catch (err) {
      document.getElementById('suggestions-container').innerHTML =
        '<div class="balance-empty">Erreur lors du chargement. Verifiez que vous etes admin.</div>';
    }
  }

  function renderAll() {
    if (!currentData) return;
    renderOverview();
    renderSuggestions();
    renderBreakdowns();
    renderCardTable();
  }

  function renderOverview() {
    const d = currentData;
    document.getElementById('total-battles').textContent = d.total_battles.toLocaleString();
    document.getElementById('total-cards-tracked').textContent = d.card_stats.length;
    document.getElementById('avg-winrate').textContent = (d.global_avg?.avg_winrate || 0) + '%';
    document.getElementById('suggestions-count').textContent = d.suggestions.length;
  }

  function renderSuggestions() {
    const container = document.getElementById('suggestions-container');
    const suggestions = currentData.suggestions;

    if (suggestions.length === 0) {
      container.innerHTML = '<div class="balance-empty">Aucun desequilibre detecte. Toutes les cartes sont equilibrees !</div>';
      return;
    }

    container.innerHTML = suggestions.map(s => {
      const isNerf = s.type === 'nerf';
      const icon = isNerf ? '&#128308;' : '&#128994;';
      const label = isNerf ? 'NERF' : 'BUFF';
      const sevClass = s.severity === 'critical' ? 'balance-sug--critical' : 'balance-sug--moderate';
      const rarityColor = RARITY_COLORS[s.rarity] || '#888';

      return `<div class="balance-suggestion ${sevClass}" data-card-id="${s.card_id}">
        <div class="balance-sug-header">
          <span class="balance-sug-icon">${icon}</span>
          <span class="balance-sug-name" style="color:${rarityColor}">${s.name}</span>
          <span class="balance-sug-badge balance-sug-badge--${s.type}">${label}</span>
          <span class="balance-sug-badge balance-sug-badge--${s.severity}">${s.severity.toUpperCase()}</span>
        </div>
        <div class="balance-sug-reasons">
          ${s.reasons.map(r => `<span class="balance-sug-reason">${r}</span>`).join('')}
        </div>
        <div class="balance-sug-changes">
          <span class="balance-sug-changes-label">Suggestions :</span>
          ${s.suggested_changes.map(c => `<span class="balance-sug-change">${c}</span>`).join('')}
        </div>
        <div class="balance-sug-stats">
          <span>WR: ${s.stats.winrate}%</span>
          <span>Kills: ${s.stats.avg_kills}/g</span>
          <span>Survie: ${s.stats.survival_rate}%</span>
          <span>${s.stats.games} parties</span>
        </div>
        <button class="balance-apply-btn" onclick="applyQuickBalance(${s.card_id}, '${s.type}')">APPLIQUER AUTO</button>
      </div>`;
    }).join('');
  }

  function renderBreakdowns() {
    renderBreakdown('element-breakdown', currentData.element_stats, 'element', ELEMENT_ICONS, ELEMENT_COLORS);
    renderBreakdown('rarity-breakdown', currentData.rarity_stats, 'rarity', {}, RARITY_COLORS);
    renderBreakdown('type-breakdown', currentData.type_stats, 'type', { guerrier: '⚔', mage: '🔮', bete: '🐾', divin: '👼', objet: '📦' }, {});
  }

  function renderBreakdown(containerId, stats, key, icons, colors) {
    const container = document.getElementById(containerId);
    if (!stats || stats.length === 0) {
      container.innerHTML = '<div class="balance-empty">Pas de donnees</div>';
      return;
    }

    container.innerHTML = stats.map(s => {
      const name = s[key];
      const icon = icons[name] || '';
      const color = colors[name] || 'var(--primary)';
      const wr = s.winrate || 0;
      const barWidth = Math.max(5, wr);
      const isBalanced = wr >= 45 && wr <= 55;
      const statusClass = wr > 55 ? 'balance-bar--high' : (wr < 45 ? 'balance-bar--low' : 'balance-bar--ok');

      return `<div class="balance-bar-row">
        <span class="balance-bar-label" style="color:${color}">${icon} ${name.toUpperCase()}</span>
        <div class="balance-bar-track">
          <div class="balance-bar-fill ${statusClass}" style="width:${barWidth}%"></div>
          <span class="balance-bar-value">${wr}%</span>
        </div>
        <span class="balance-bar-games">${s.total_games}g</span>
      </div>`;
    }).join('');
  }

  function renderCardTable() {
    const tbody = document.getElementById('card-table-body');
    let cards = [...currentData.card_stats];
    const avgWr = currentData.global_avg?.avg_winrate || 50;

    // Filter
    const search = document.getElementById('card-search').value.toLowerCase();
    const filterElem = document.getElementById('filter-element').value;
    const filterRarity = document.getElementById('filter-rarity').value;

    if (search) cards = cards.filter(c => c.name.toLowerCase().includes(search));
    if (filterElem) cards = cards.filter(c => c.element === filterElem);
    if (filterRarity) cards = cards.filter(c => c.rarity === filterRarity);

    // Sort
    const sort = document.getElementById('sort-select').value;
    const sortFns = {
      winrate_desc: (a, b) => b.winrate - a.winrate,
      winrate_asc: (a, b) => a.winrate - b.winrate,
      games_desc: (a, b) => b.total_games - a.total_games,
      kills_desc: (a, b) => b.avg_kills - a.avg_kills,
      dmg_desc: (a, b) => b.avg_dmg_dealt - a.avg_dmg_dealt,
      survival_desc: (a, b) => b.survival_rate - a.survival_rate,
    };
    cards.sort(sortFns[sort] || sortFns.winrate_desc);

    tbody.innerHTML = cards.map(c => {
      const wr = c.winrate;
      const wrClass = wr > avgWr + 12 ? 'balance-wr--op' : (wr < avgWr - 12 ? 'balance-wr--weak' : 'balance-wr--ok');
      const elemIcon = ELEMENT_ICONS[c.element] || '';
      const rarColor = RARITY_COLORS[c.rarity] || '#888';

      let status = '&#9989;';
      if (wr > avgWr + 12) status = '<span style="color:#ff4444">&#9650; OP</span>';
      else if (wr < avgWr - 12) status = '<span style="color:#44aaff">&#9660; FAIBLE</span>';

      return `<tr>
        <td class="balance-td-name" style="color:${rarColor}">${c.name}</td>
        <td><span class="balance-rarity-dot" style="background:${rarColor}"></span>${c.rarity}</td>
        <td>${elemIcon} ${c.element}</td>
        <td>${c.type}</td>
        <td>${c.attack}/${c.defense}/${c.hp}</td>
        <td>${c.total_games}</td>
        <td class="${wrClass}">${wr}%</td>
        <td>${c.avg_kills}</td>
        <td>${c.avg_dmg_dealt}</td>
        <td>${c.survival_rate}%</td>
        <td>${status}</td>
      </tr>`;
    }).join('');

    if (cards.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="balance-empty">Aucune carte avec assez de donnees.</td></tr>';
    }
  }

  // Quick balance: auto-apply suggested stat changes
  window.applyQuickBalance = async function(cardId, type) {
    const suggestion = currentData?.suggestions.find(s => s.card_id === cardId);
    if (!suggestion) return;

    const card = currentData.card_stats.find(c => c.card_id === cardId);
    if (!card) return;

    const changes = {};
    if (type === 'nerf') {
      if (suggestion.stats.avg_kills > (currentData.global_avg?.avg_kills || 1) * 1.5) {
        changes.attack = Math.max(1, card.attack - 1);
      }
      if (suggestion.stats.survival_rate > 70) {
        changes.hp = Math.max(1, card.hp - 1);
      }
      if (Object.keys(changes).length === 0) {
        changes.mana_cost = card.mana_cost + 1;
      }
    } else {
      if (suggestion.stats.avg_kills < (currentData.global_avg?.avg_kills || 1) * 0.5) {
        changes.attack = card.attack + 1;
      }
      if (suggestion.stats.survival_rate < 30) {
        changes.hp = card.hp + 1;
      }
      if (Object.keys(changes).length === 0 && card.mana_cost > 1) {
        changes.mana_cost = card.mana_cost - 1;
      }
    }

    if (Object.keys(changes).length === 0) {
      showToast && showToast('Aucun changement auto possible pour cette carte', 'info');
      return;
    }

    try {
      const res = await fetch('/api/admin/apply-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId, changes })
      });
      const data = await res.json();
      if (data.success) {
        const changeStr = Object.entries(changes).map(([k, v]) => `${k}: ${v}`).join(', ');
        showToast && showToast(`${card.name} modifie: ${changeStr}`, 'success');
        // Refresh data
        loadAnalysis();
      } else {
        showToast && showToast(data.error || 'Erreur', 'error');
      }
    } catch (err) {
      showToast && showToast('Erreur reseau', 'error');
    }
  };

  // Event listeners
  document.getElementById('refresh-btn').addEventListener('click', loadAnalysis);
  document.getElementById('period-select').addEventListener('change', loadAnalysis);
  document.getElementById('mingames-select').addEventListener('change', loadAnalysis);
  document.getElementById('card-search').addEventListener('input', () => currentData && renderCardTable());
  document.getElementById('sort-select').addEventListener('change', () => currentData && renderCardTable());
  document.getElementById('filter-element').addEventListener('change', () => currentData && renderCardTable());
  document.getElementById('filter-rarity').addEventListener('change', () => currentData && renderCardTable());

  // Initial load
  loadAnalysis();
})();
