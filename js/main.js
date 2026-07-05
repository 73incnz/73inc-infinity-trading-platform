// js/main.js — entry point: tab switching, header wallet controls, initial load.
import { state } from './state.js';
import { connectPhantom, disconnectPhantom, autoReconnect, updateWalletUI } from './wallet.js';
import { initScannerTab } from './scanner.js';
import { initTrendingTab, renderTrending } from './trending.js';
import { initWatchlistTab, renderWatchlist } from './watchlist.js';
import { initPortfolioTab, refreshPortfolio } from './portfolio.js';
import { initAutotradeTab } from './autotrade.js';

const TABS = ['scanner', 'trending', 'watchlist', 'portfolio', 'autotrade'];
const initialized = {};

function switchTab(tab) {
  state.currentTab = tab;
  TABS.forEach(t => {
    const panel = document.getElementById('tab-' + t);
    const navBtn = document.querySelector('.nav-btn[data-tab="' + t + '"]');
    if (panel) panel.classList.toggle('active', t === tab);
    if (navBtn) navBtn.classList.toggle('active', t === tab);
  });

  if (!initialized[tab]) {
    initialized[tab] = true;
    if (tab === 'scanner') initScannerTab();
    if (tab === 'trending') initTrendingTab();
    if (tab === 'watchlist') initWatchlistTab();
    if (tab === 'portfolio') initPortfolioTab();
    if (tab === 'autotrade') initAutotradeTab();
  } else {
    if (tab === 'trending') renderTrending();
    if (tab === 'watchlist') renderWatchlist();
    if (tab === 'portfolio') refreshPortfolio();
  }
}

function setupNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  const connectBtn = document.getElementById('connect-btn');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      if (state.wallet) disconnectPhantom();
      else connectPhantom();
    });
  }
}

async function init() {
  setupNav();
  await autoReconnect();
  updateWalletUI();
  switchTab('scanner');
}

document.addEventListener('DOMContentLoaded', init);
