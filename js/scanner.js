// js/scanner.js — Scanner tab: pulls live Solana candidates from the
// dexscreener-scan Netlify function and renders filterable token cards.
import { state } from './state.js';
import { fetchScan } from './api.js';
import { buildTokenCard, showToast } from './ui.js';
import { manualBuy } from './wallet.js';
import { computeSignal } from './autotrade.js';
import { renderTrending } from './trending.js';
import { renderWatchlist } from './watchlist.js';

let refreshTimer = null;

export async function refreshScan() {
  try {
    const data = await fetchScan();
    state.tokens = data.tokens || [];
    state.scannedAt = data.scannedAt || Date.now();
    renderScanner();
    renderTrending();
    renderWatchlist();
    updateLastScanned();
  } catch (err) {
    showToast('Scan failed: ' + (err.message || err), 'error');
  }
}

function updateLastScanned() {
  const el = document.getElementById('last-scanned');
  if (el && state.scannedAt) {
    el.textContent = 'Updated ' + new Date(state.scannedAt).toLocaleTimeString();
  }
}

function getFilters() {
  const signal = document.getElementById('filter-signal');
  const liquidity = document.getElementById('filter-liquidity');
  const volume = document.getElementById('filter-volume');
  const age = document.getElementById('filter-age');
  return {
    signal: signal ? signal.value : 'all',
    liquidity: liquidity ? Number(liquidity.value || 0) : 0,
    volume: volume ? Number(volume.value || 0) : 0,
    age: age ? age.value : 'all'
  };
}

export function renderScanner() {
  const grid = document.getElementById('scanner-grid');
  if (!grid) return;
  const filters = getFilters();

  let tokens = state.tokens.slice();

  if (filters.signal !== 'all') {
    tokens = tokens.filter(t => computeSignal(t) === filters.signal);
  }
  if (filters.liquidity > 0) {
    tokens = tokens.filter(t => (t.liquidityUsd || 0) >= filters.liquidity);
  }
  if (filters.volume > 0) {
    tokens = tokens.filter(t => ((t.volume && t.volume.h24) || 0) >= filters.volume);
  }
  if (filters.age !== 'all') {
    const maxMs = { '1h': 3600000, '6h': 21600000, '24h': 86400000 }[filters.age];
    if (maxMs) {
      tokens = tokens.filter(t => t.pairCreatedAt && (Date.now() - Number(t.pairCreatedAt)) <= maxMs);
    }
  }

  tokens.sort((a, b) => (b.score || 0) - (a.score || 0));

  grid.innerHTML = '';
  if (tokens.length === 0) {
    grid.innerHTML = '<p class="muted">No tokens match the current filters.</p>';
    return;
  }
  tokens.forEach(t => {
    grid.appendChild(buildTokenCard(t, manualBuy));
  });
}

export function initScannerTab() {
  ['filter-signal', 'filter-liquidity', 'filter-volume', 'filter-age'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', renderScanner);
  });
  refreshScan();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshScan, 25000);
}
