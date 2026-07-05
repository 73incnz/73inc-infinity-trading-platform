// js/ui.js — shared DOM helpers: toasts, formatters, and the token card builder.
import { isWatched, toggleWatch } from './state.js';
import { computeSignal } from './autotrade.js';

let toastTimer = null;
export function showToast(msg, type) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast show ' + (type || '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 4000);
}

export function formatNum(n) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  n = Number(n);
  const sign = n < 0 ? '-' : '';
  n = Math.abs(n);
  if (n >= 1e9) return sign + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return sign + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return sign + (n / 1e3).toFixed(2) + 'K';
  return sign + n.toFixed(2);
}

export function formatPrice(p) {
  if (p === null || p === undefined || isNaN(p)) return '-';
  p = Number(p);
  if (p === 0) return '0';
  if (p < 0.000001) return p.toExponential(2);
  if (p < 1) return p.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return p.toFixed(4);
}

export function formatAge(createdAt) {
  if (!createdAt) return '-';
  const ms = Date.now() - Number(createdAt);
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return mins + 'm';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h';
  const days = Math.floor(hrs / 24);
  return days + 'd';
}

export function formatAddr(a) {
  if (!a) return '-';
  return a.slice(0, 4) + '...' + a.slice(-4);
}

export function riskClass(level) {
  if (level === 'clear') return 'risk-clear';
  if (level === 'caution') return 'risk-caution';
  if (level === 'danger') return 'risk-danger';
  return 'risk-unknown';
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function linkBtn(label, url, cls) {
  if (!url) return '';
  return '<a class="tbtn ' + (cls || '') + '" href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
}

export function buildTokenCard(token, onBuyClick) {
  const signal = computeSignal(token);
  const watched = isWatched(token.address);
  const risk = token.risk || {};
  const card = document.createElement('div');
  card.className = 'token-card';
  card.dataset.address = token.address;

  const signalClass = 'signal-' + signal.toLowerCase();
  const vol24 = token.volume && token.volume.h24;
  const chg24 = token.priceChange && token.priceChange.h24;

  card.innerHTML =
    '<div class="tc-head">' +
      '<img class="tc-img" src="' + escapeHtml(token.imageUrl || '') + '" onerror="this.style.display=\'none\'" />' +
      '<div class="tc-title">' +
        '<div class="tc-symbol">' + escapeHtml(token.symbol || '?') + '</div>' +
        '<div class="tc-name">' + escapeHtml(token.name || '') + '</div>' +
      '</div>' +
      '<div class="tc-badges">' +
        '<span class="badge ' + signalClass + '">' + signal + '</span>' +
        '<span class="badge ' + riskClass(risk.level) + '">' + (risk.level || 'unknown') + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="tc-metrics">' +
      '<div><span class="m-label">Price</span><span class="m-val">$' + formatPrice(token.priceUsd) + '</span></div>' +
      '<div><span class="m-label">Liquidity</span><span class="m-val">$' + formatNum(token.liquidityUsd) + '</span></div>' +
      '<div><span class="m-label">Mcap</span><span class="m-val">$' + formatNum(token.marketCap) + '</span></div>' +
      '<div><span class="m-label">Vol 24h</span><span class="m-val">$' + formatNum(vol24) + '</span></div>' +
      '<div><span class="m-label">Chg 24h</span><span class="m-val">' + (chg24 != null ? chg24.toFixed(1) + '%' : '-') + '</span></div>' +
      '<div><span class="m-label">Age</span><span class="m-val">' + formatAge(token.pairCreatedAt) + '</span></div>' +
      '<div><span class="m-label">Score</span><span class="m-val">' + (token.score != null ? token.score : '-') + '</span></div>' +
      '<div><span class="m-label">Addr</span><span class="m-val">' + formatAddr(token.address) + '</span></div>' +
    '</div>' +
    '<div class="tc-actions">' +
      '<button class="tbtn watch-btn' + (watched ? ' active' : '') + '">' + (watched ? '★ Watching' : '☆ Watch') + '</button>' +
      linkBtn('📊 Chart', token.url, 'chart') +
      linkBtn('🔧 DexTools', token.dextoolsUrl, 'dextools') +
      linkBtn('🛡 RugCheck', token.rugcheckUrl, 'rugcheck') +
      linkBtn('👥 Holders', 'https://solscan.io/token/' + token.address + '#holders', 'holders') +
      linkBtn('⚡ Photon', token.photonUrl, 'photon') +
      '<button class="tbtn buy-btn">🪙 Buy</button>' +
    '</div>';

  const watchBtn = card.querySelector('.watch-btn');
  watchBtn.addEventListener('click', () => {
    const now = toggleWatch(token.address);
    watchBtn.textContent = now ? '★ Watching' : '☆ Watch';
    watchBtn.classList.toggle('active', now);
  });

  const buyBtn = card.querySelector('.buy-btn');
  buyBtn.addEventListener('click', () => {
    if (typeof onBuyClick === 'function') onBuyClick(token);
  });

  return card;
}
