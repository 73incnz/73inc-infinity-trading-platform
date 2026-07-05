// js/portfolio.js — Portfolio tab: reads live SOL + SPL holdings via the
// wallet-portfolio Netlify function (RPC + Jupiter/DexScreener pricing).
import { state } from './state.js';
import { fetchPortfolio } from './api.js';
import { formatNum, formatAddr } from './ui.js';
import { manualSell } from './wallet.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function refreshPortfolio() {
  const summary = document.getElementById('portfolio-summary');
  const list = document.getElementById('portfolio-holdings');
  if (!summary || !list) return;

  if (!state.wallet) {
    summary.innerHTML = '<p class="muted">Connect your Phantom wallet to view your portfolio.</p>';
    list.innerHTML = '';
    return;
  }

  summary.innerHTML = '<p class="muted">Loading portfolio...</p>';
  try {
    const data = await fetchPortfolio(state.wallet);
    summary.innerHTML =
      '<div class="stat-box"><span class="stat-label">Wallet</span><span class="stat-val">' + formatAddr(state.wallet) + '</span></div>' +
      '<div class="stat-box"><span class="stat-label">SOL Balance</span><span class="stat-val">' + Number(data.solBalance || 0).toFixed(4) + '</span></div>' +
      '<div class="stat-box"><span class="stat-label">Portfolio Value</span><span class="stat-val">$' + formatNum(data.portfolioUsd) + '</span></div>';

    const holdings = data.holdings || [];
    if (holdings.length === 0) {
      list.innerHTML = '<p class="muted">No SPL token holdings found.</p>';
      return;
    }
    list.innerHTML = holdings.map(h => {
      return '<div class="holding-row">' +
        '<img class="holding-img" src="' + escapeHtml(h.imageUrl || '') + '" onerror="this.style.display=\'none\'" />' +
        '<span class="holding-symbol">' + escapeHtml(h.symbol || (h.mint ? h.mint.slice(0, 6) : '?')) + '</span>' +
        '<span>' + Number(h.balance || 0).toLocaleString() + '</span>' +
        '<span>$' + formatNum(h.valueUsd) + '</span>' +
        '<button class="tbtn sell-btn">Sell</button>' +
      '</div>';
    }).join('');

    list.querySelectorAll('.sell-btn').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        const h = holdings[i];
        manualSell(h.mint, h.rawAmount, h.symbol);
      });
    });
  } catch (err) {
    summary.innerHTML = '<p class="muted">Failed to load portfolio: ' + escapeHtml(err.message || String(err)) + '</p>';
    list.innerHTML = '';
  }
}

export function initPortfolioTab() {
  refreshPortfolio();
  document.addEventListener('wallet-changed', refreshPortfolio);
}
