// js/state.js — shared in-memory + localStorage-backed state for the app.

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // storage full or unavailable, ignore
  }
}

export const state = {
  wallet: null,
  tokens: [],
  scannedAt: null,
  currentTab: 'scanner',
  trendingPeriod: 'h24',
  watchlist: load('73inc_watchlist', []),
  autotrade: load('73inc_autotrade', {
    running: false,
    mode: 'paper',
    minScore: 72,
    minLiquidity: 5000,
    minVolume: 5000,
    maxPositions: 5,
    takeProfitPct: 25,
    stopLossPct: 15,
    positions: {},
    portfolio: { trades: 0, wins: 0, pnlSol: 0 },
    log: [],
    stats: {}
  })
};

export function saveWatchlist() {
  save('73inc_watchlist', state.watchlist);
}

export function saveAutotrade() {
  save('73inc_autotrade', state.autotrade);
}

export function isWatched(address) {
  return state.watchlist.includes(address);
}

export function toggleWatch(address) {
  const idx = state.watchlist.indexOf(address);
  if (idx >= 0) {
    state.watchlist.splice(idx, 1);
  } else {
    state.watchlist.push(address);
  }
  saveWatchlist();
  return isWatched(address);
}
