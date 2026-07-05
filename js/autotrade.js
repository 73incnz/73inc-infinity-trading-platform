// js/autotrade.js — the auto-flag signal engine.
// IMPORTANT: this module NEVER silently executes a live trade. In 'paper' mode it
// simulates positions locally. In 'live' mode it only ever surfaces BUY/SELL signals
// with a Confirm button — every real trade requires an explicit user click, which
// then goes through wallet.js (Phantom signature) exactly like a manual trade.
import { state, saveAutotrade, SOL_MINT } from './state.js';
import { showToast } from './ui.js';
import { manualBuy, manualSell } from './wallet.js';

export function computeSignal(token) {
  const s = state.autotrade;
  const risk = token.risk || {};
  const liq = token.liquidityUsd || 0;
  const vol = (token.volume && token.volume.h24) || 0;
  const score = token.score || 0;

  if (liq < 1000 || risk.level === 'danger') return 'AVOID';
  if (score >= s.minScore && liq >= s.minLiquidity && vol >= s.minVolume && risk.eligible) return 'BUY';
  if (score >= s.minScore - 15 && liq >= s.minLiquidity * 0.5) return 'WATCH';
  return 'NEUTRAL';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function log(msg, type) {
  const s = state.autotrade;
  s.log.unshift({ msg, type: type || 'info', at: Date.now() });
  if (s.log.length > 200) s.log.length = 200;
  saveAutotrade();
  renderLog();
}

export function renderLog() {
  const el = document.getElementById('autotrade-log');
  if (!el) return;
  const s = state.autotrade;
  el.innerHTML = s.log.slice(0, 50).map(entry => {
    const time = new Date(entry.at).toLocaleTimeString();
    return '<div class="log-row log-' + entry.type + '"><span class="log-time">' + time + '</span> ' + escapeHtml(entry.msg) + '</div>';
  }).join('');
}

let engineTimer = null;

export function initAutotradeTab() {
  const root = document.getElementById('tab-autotrade');
  if (!root) return;
  const s = state.autotrade;

  root.innerHTML =
    '<div class="autotrade-layout">' +
      '<div class="at-settings panel">' +
        '<h3>Auto-Flag Settings</h3>' +
        '<label>Min Score <input type="number" id="at-minScore" value="' + s.minScore + '"></label>' +
        '<label>Min Liquidity ($) <input type="number" id="at-minLiquidity" value="' + s.minLiquidity + '"></label>' +
        '<label>Min Volume 24h ($) <input type="number" id="at-minVolume" value="' + s.minVolume + '"></label>' +
        '<label>Take Profit (%) <input type="number" id="at-tp" value="' + s.takeProfitPct + '"></label>' +
        '<label>Stop Loss (%) <input type="number" id="at-sl" value="' + s.stopLossPct + '"></label>' +
        '<label>Max Positions <input type="number" id="at-maxPos" value="' + s.maxPositions + '"></label>' +
        '<div class="at-mode-row">' +
          '<button id="mode-paper" class="mode-btn' + (s.mode === 'paper' ? ' active' : '') + '">Paper Mode</button>' +
          '<button id="mode-live" class="mode-btn' + (s.mode === 'live' ? ' active' : '') + '">Live Mode</button>' +
        '</div>' +
        '<p class="live-warning">Live mode requires a connected wallet and only ever surfaces BUY/SELL signals below for your manual, one-click confirmation. Nothing executes without your explicit click.</p>' +
        '<button id="engine-toggle" class="engine-btn">' + (s.running ? 'Stop Engine' : 'Start Engine') + '</button>' +
      '</div>' +
      '<div class="at-main">' +
        '<div class="at-stats panel">' +
          '<div class="stat-box"><span class="stat-label">Trades</span><span class="stat-val" id="stat-trades">0</span></div>' +
          '<div class="stat-box"><span class="stat-label">Win Rate</span><span class="stat-val" id="stat-winrate">0%</span></div>' +
          '<div class="stat-box"><span class="stat-label">PnL (SOL)</span><span class="stat-val" id="stat-pnl">0</span></div>' +
          '<div class="stat-box"><span class="stat-label">Open</span><span class="stat-val" id="stat-open">0</span></div>' +
        '</div>' +
        '<div class="panel"><h3>Live Signals</h3><div id="at-signals" class="signals-list"></div></div>' +
        '<div class="panel"><h3>Open Positions</h3><div id="at-positions" class="positions-list"></div></div>' +
        '<div class="panel"><h3>Activity Log</h3><div id="autotrade-log" class="log-list"></div></div>' +
      '</div>' +
    '</div>';

  document.getElementById('at-minScore').addEventListener('change', e => { s.minScore = Number(e.target.value); saveAutotrade(); });
  document.getElementById('at-minLiquidity').addEventListener('change', e => { s.minLiquidity = Number(e.target.value); saveAutotrade(); });
  document.getElementById('at-minVolume').addEventListener('change', e => { s.minVolume = Number(e.target.value); saveAutotrade(); });
  document.getElementById('at-tp').addEventListener('change', e => { s.takeProfitPct = Number(e.target.value); saveAutotrade(); });
  document.getElementById('at-sl').addEventListener('change', e => { s.stopLossPct = Number(e.target.value); saveAutotrade(); });
  document.getElementById('at-maxPos').addEventListener('change', e => { s.maxPositions = Number(e.target.value); saveAutotrade(); });

  document.getElementById('mode-paper').addEventListener('click', () => setMode('paper'));
  document.getElementById('mode-live').addEventListener('click', () => setMode('live'));
  document.getElementById('engine-toggle').addEventListener('click', toggleEngine);

  renderLog();
  renderPositions();
  renderStats();
  renderSignals();
}

export function setMode(mode) {
  const s = state.autotrade;
  if (mode === 'live' && !state.wallet) {
    showToast('Connect your wallet before enabling Live mode', 'warn');
    return;
  }
  s.mode = mode;
  saveAutotrade();
  const paperBtn = document.getElementById('mode-paper');
  const liveBtn = document.getElementById('mode-live');
  if (paperBtn) paperBtn.classList.toggle('active', mode === 'paper');
  if (liveBtn) liveBtn.classList.toggle('active', mode === 'live');
  log('Switched to ' + mode.toUpperCase() + ' mode', 'info');
}

export function toggleEngine() {
  const s = state.autotrade;
  s.running = !s.running;
  saveAutotrade();
  const btn = document.getElementById('engine-toggle');
  if (btn) btn.textContent = s.running ? 'Stop Engine' : 'Start Engine';

  if (s.running) {
    log('Auto-flag engine started (' + s.mode + ' mode)', 'success');
    runCycle();
    engineTimer = setInterval(runCycle, 20000);
  } else {
    log('Auto-flag engine stopped', 'info');
    if (engineTimer) clearInterval(engineTimer);
    engineTimer = null;
  }
}

export function runCycle() {
  try {
    checkExits();
    scanForEntries();
  } catch (err) {
    log('Cycle error: ' + (err.message || err), 'error');
  }
  renderSignals();
  renderPositions();
  renderStats();
}

export function scanForEntries() {
  const s = state.autotrade;
  const openCount = Object.keys(s.positions).length;
  const slots = s.maxPositions - openCount;
  if (slots <= 0) return;

  const candidates = state.tokens
    .filter(t => computeSignal(t) === 'BUY' && !s.positions[t.address])
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, slots);

  candidates.forEach(t => {
    if (s.mode === 'paper') {
      openPaperPosition(t);
    }
    // In live mode, candidates are surfaced via renderSignals() with a
    // 'Confirm Buy' button. No automatic execution happens here.
  });
}

export function openPaperPosition(token) {
  const s = state.autotrade;
  s.positions[token.address] = {
    address: token.address,
    symbol: token.symbol,
    entryPrice: token.priceUsd,
    sizeSol: 0.05,
    openedAt: Date.now(),
    simulated: true
  };
  saveAutotrade();
  log('Paper BUY ' + token.symbol + ' @ $' + token.priceUsd, 'success');
}

export function checkExits() {
  const s = state.autotrade;
  const byAddr = {};
  state.tokens.forEach(t => { byAddr[t.address] = t; });

  Object.keys(s.positions).forEach(address => {
    const pos = s.positions[address];
    const fresh = byAddr[address];
    if (!fresh || !fresh.priceUsd || !pos.entryPrice) return;

    const pnlPct = ((fresh.priceUsd - pos.entryPrice) / pos.entryPrice) * 100;
    const hitTP = pnlPct >= s.takeProfitPct;
    const hitSL = pnlPct <= -s.stopLossPct;
    pos.lastPrice = fresh.priceUsd;
    pos.pnlPct = pnlPct;

    if (!hitTP && !hitSL) {
      pos.pendingExit = null;
      return;
    }

    if (pos.simulated) {
      s.stats.trades = (s.stats.trades || 0) + 1;
      if (pnlPct > 0) s.stats.wins = (s.stats.wins || 0) + 1;
      const pnlSol = pos.sizeSol * (pnlPct / 100);
      s.portfolio.pnlSol = (s.portfolio.pnlSol || 0) + pnlSol;
      log(
        (hitTP ? 'TAKE PROFIT' : 'STOP LOSS') + ' — paper SELL ' + pos.symbol +
        ' @ ' + pnlPct.toFixed(1) + '% (' + pnlSol.toFixed(4) + ' SOL)',
        hitTP ? 'success' : 'warn'
      );
      delete s.positions[address];
      saveAutotrade();
    } else {
      pos.pendingExit = hitTP ? 'TP' : 'SL';
      saveAutotrade();
    }
  });
}

export function renderSignals() {
  const el = document.getElementById('at-signals');
  if (!el) return;
  const s = state.autotrade;

  const buySignals = state.tokens
    .filter(t => computeSignal(t) === 'BUY' && !s.positions[t.address])
    .slice(0, 10);
  const sellSignals = Object.values(s.positions).filter(p => p.pendingExit);

  if (s.mode !== 'live') {
    el.innerHTML = '<p class="muted">Paper mode is active — matching BUY signals are opened automatically as simulated positions below. Switch to Live mode to see manual-confirm signals here.</p>';
    return;
  }

  if (buySignals.length === 0 && sellSignals.length === 0) {
    el.innerHTML = '<p class="muted">No signals right now.</p>';
    return;
  }

  el.innerHTML = '';

  sellSignals.forEach(pos => {
    const row = document.createElement('div');
    row.className = 'signal-row signal-sell';
    row.innerHTML = '<span>' + (pos.pendingExit === 'TP' ? '🟢 TAKE PROFIT' : '🔴 STOP LOSS') +
      ' — ' + escapeHtml(pos.symbol) + ' (' + (pos.pnlPct || 0).toFixed(1) + '%)</span>' +
      '<button class="tbtn confirm-sell">Confirm Sell</button>';
    row.querySelector('.confirm-sell').addEventListener('click', async () => {
      await manualSell(pos.address, Math.round((pos.sizeSol || 0.05) * 1e9), pos.symbol);
      delete s.positions[pos.address];
      saveAutotrade();
      renderSignals();
      renderPositions();
    });
    el.appendChild(row);
  });

  buySignals.forEach(t => {
    const row = document.createElement('div');
    row.className = 'signal-row signal-buy';
    row.innerHTML = '<span>🟢 BUY — ' + escapeHtml(t.symbol) + ' (score ' + t.score + ')</span>' +
      '<button class="tbtn confirm-buy">Confirm Buy</button>';
    row.querySelector('.confirm-buy').addEventListener('click', async () => {
      await manualBuy(t);
    });
    el.appendChild(row);
  });
}

export function renderPositions() {
  const el = document.getElementById('at-positions');
  if (!el) return;
  const s = state.autotrade;
  const positions = Object.values(s.positions);

  if (positions.length === 0) {
    el.innerHTML = '<p class="muted">No open positions.</p>';
    return;
  }

  el.innerHTML = positions.map(p => {
    const pnl = p.pnlPct != null ? p.pnlPct.toFixed(1) + '%' : '-';
    const pnlClass = (p.pnlPct || 0) >= 0 ? 'pnl-pos' : 'pnl-neg';
    return '<div class="position-row">' +
      '<span class="pos-symbol">' + escapeHtml(p.symbol) + '</span>' +
      '<span>Entry $' + p.entryPrice + '</span>' +
      '<span class="' + pnlClass + '">' + pnl + '</span>' +
      '<span>' + p.sizeSol + ' SOL</span>' +
      '<span>' + (p.simulated ? 'paper' : 'live') + '</span>' +
    '</div>';
  }).join('');
}

export function renderStats() {
  const s = state.autotrade;
  const trades = s.stats.trades || 0;
  const wins = s.stats.wins || 0;
  const winRate = trades > 0 ? Math.round((wins / trades) * 100) : 0;
  const openCount = Object.keys(s.positions).length;

  const elTrades = document.getElementById('stat-trades');
  const elWinRate = document.getElementById('stat-winrate');
  const elPnl = document.getElementById('stat-pnl');
  const elOpen = document.getElementById('stat-open');

  if (elTrades) elTrades.textContent = trades;
  if (elWinRate) elWinRate.textContent = winRate + '%';
  if (elPnl) elPnl.textContent = (s.portfolio.pnlSol || 0).toFixed(4);
  if (elOpen) elOpen.textContent = openCount;
}
