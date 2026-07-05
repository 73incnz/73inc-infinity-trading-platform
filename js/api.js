// js/api.js — thin wrappers around the Netlify function endpoints.
// The server never holds private keys; swaps are signed client-side by Phantom.

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Request failed: ' + res.status);
  }
  return res.json();
}

async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || ('Request failed: ' + res.status));
    err.details = data;
    throw err;
  }
  return data;
}

export function fetchScan() {
  return apiGet('/api/dexscreener/scan');
}

export function fetchPortfolio(wallet) {
  return apiGet('/api/wallet/portfolio?wallet=' + encodeURIComponent(wallet));
}

export function prepareJupiterSwap(params) {
  return apiPost('/api/jupiter/swap', params);
}

export function submitTradeIntent(intent) {
  return apiPost('/api/trade/intent', intent);
}

export function executeAutomation(command) {
  return apiPost('/api/automation/execute', command);
}

export function getAutomationConfig() {
  return apiGet('/api/automation/execute');
}
