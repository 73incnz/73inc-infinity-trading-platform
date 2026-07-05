// js/watchlist.js — Watchlist tab. Purely local (localStorage-backed via
// state.js) — no third-party cloud sync, so nothing about your watched
// tokens ever leaves your browser.
import { state } from './state.js';
import { buildTokenCard } from './ui.js';
import { manualBuy } from './wallet.js';

export function renderWatchlist() {
  const grid = document.getElementById('watchlist-grid');
  if (!grid) return;

  const tokens = state.tokens.filter(t => state.watchlist.includes(t.address));

  grid.innerHTML = '';
  if (tokens.length === 0) {
    grid.innerHTML = '<p class="muted">Your watchlist is empty. Click the ☆ Watch button on any token to add it here (saved locally in your browser only).</p>';
    return;
  }
  tokens.forEach(t => grid.appendChild(buildTokenCard(t, manualBuy)));
}

export function initWatchlistTab() {
  renderWatchlist();
}
