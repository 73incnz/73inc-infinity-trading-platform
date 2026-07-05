// js/trending.js — Trending tab: same live token set as Scanner, ranked by
// price change over a selectable period.
import { state } from './state.js';
import { buildTokenCard } from './ui.js';
import { manualBuy } from './wallet.js';

export function renderTrending() {
  const grid = document.getElementById('trending-grid');
  if (!grid) return;
  const period = state.trendingPeriod || 'h24';

  const tokens = state.tokens.slice().sort((a, b) => {
    const av = (a.priceChange && a.priceChange[period]) || 0;
    const bv = (b.priceChange && b.priceChange[period]) || 0;
    return bv - av;
  }).slice(0, 30);

  grid.innerHTML = '';
  if (tokens.length === 0) {
    grid.innerHTML = '<p class="muted">No trending data yet.</p>';
    return;
  }
  tokens.forEach(t => grid.appendChild(buildTokenCard(t, manualBuy)));
}

export function initTrendingTab() {
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.trendingPeriod = btn.dataset.period;
      renderTrending();
    });
  });
  renderTrending();
}
