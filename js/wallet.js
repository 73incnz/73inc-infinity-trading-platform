// js/wallet.js — Phantom connect/disconnect and client-side signed swaps.
// The server (netlify/functions/jupiter-swap.mjs) only ever returns an UNSIGNED
// transaction. Phantom signs it here in the browser; no private key ever leaves the user.
import { state } from './state.js';
import { showToast, formatAddr } from './ui.js';
import { prepareJupiterSwap } from './api.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const RPC_URL = 'https://api.mainnet-beta.solana.com';

function getProvider() {
  if (window.phantom && window.phantom.solana && window.phantom.solana.isPhantom) {
    return window.phantom.solana;
  }
  if (window.solana && window.solana.isPhantom) {
    return window.solana;
  }
  return null;
}

export function updateWalletUI() {
  const btn = document.getElementById('connect-btn');
  const addrEl = document.getElementById('wallet-addr');
  if (!btn) return;
  if (state.wallet) {
    btn.textContent = 'Disconnect';
    btn.classList.add('connected');
    if (addrEl) addrEl.textContent = formatAddr(state.wallet);
  } else {
    btn.textContent = 'Connect Phantom';
    btn.classList.remove('connected');
    if (addrEl) addrEl.textContent = '';
  }
  document.dispatchEvent(new CustomEvent('wallet-changed'));
}

export async function connectPhantom() {
  const provider = getProvider();
  if (!provider) {
    showToast('Phantom wallet not found. Opening install page...', 'warn');
    window.open('https://phantom.app/', '_blank');
    return;
  }
  try {
    const resp = await provider.connect({ onlyIfTrusted: false });
    state.wallet = resp.publicKey.toString();
    updateWalletUI();
    showToast('Wallet connected: ' + formatAddr(state.wallet), 'success');
  } catch (err) {
    showToast('Connection cancelled or failed', 'error');
  }
}

export async function disconnectPhantom() {
  const provider = getProvider();
  try {
    if (provider) await provider.disconnect();
  } catch (err) {
    // ignore
  }
  state.wallet = null;
  updateWalletUI();
  showToast('Wallet disconnected', 'info');
}

export async function autoReconnect() {
  const provider = getProvider();
  if (!provider) return;
  if (provider.on) {
    provider.on('disconnect', () => {
      state.wallet = null;
      updateWalletUI();
    });
    provider.on('accountChanged', (pk) => {
      state.wallet = pk ? pk.toString() : null;
      updateWalletUI();
    });
  }
  try {
    const resp = await provider.connect({ onlyIfTrusted: true });
    state.wallet = resp.publicKey.toString();
    updateWalletUI();
  } catch (err) {
    // not previously trusted — user must click Connect
  }
}

async function signAndSend(swapTransactionBase64) {
  const provider = getProvider();
  if (!provider) throw new Error('Wallet not connected');
  const raw = atob(swapTransactionBase64);
  const txBuf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) txBuf[i] = raw.charCodeAt(i);
  const tx = window.solanaWeb3.VersionedTransaction.deserialize(txBuf);

  if (provider.signAndSendTransaction) {
    try {
      const { signature } = await provider.signAndSendTransaction(tx);
      return signature;
    } catch (err) {
      // fall through to manual sign + send path below
    }
  }

  const signed = await provider.signTransaction(tx);
  const signedBytes = signed.serialize();
  let binary = '';
  for (let i = 0; i < signedBytes.length; i++) binary += String.fromCharCode(signedBytes[i]);
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendTransaction',
      params: [btoa(binary), { encoding: 'base64', skipPreflight: false, maxRetries: 3 }]
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Transaction failed');
  return data.result;
}

export async function manualBuy(token) {
  if (!state.wallet) {
    showToast('Connect your wallet first', 'warn');
    return;
  }
  const amountStr = prompt('SOL amount to spend on ' + token.symbol + ':', '0.05');
  if (!amountStr) return;
  const amountSol = parseFloat(amountStr);
  if (!amountSol || amountSol <= 0) {
    showToast('Invalid amount', 'error');
    return;
  }
  const confirmMsg = 'Confirm BUY ' + amountSol + ' SOL of ' + token.symbol +
    ' (' + formatAddr(token.address) + ')?\nThis opens Phantom for your signature.';
  if (!confirm(confirmMsg)) return;

  try {
    const amountRaw = String(Math.round(amountSol * 1e9));
    const swap = await prepareJupiterSwap({
      wallet: state.wallet,
      inputMint: SOL_MINT,
      outputMint: token.address,
      amountRaw,
      slippageBps: 100
    });
    const sig = await signAndSend(swap.swapTransaction);
    showToast('Buy submitted: ' + sig.slice(0, 8) + '...', 'success');
  } catch (err) {
    showToast('Buy failed: ' + (err.message || err), 'error');
  }
}

export async function manualSell(mint, amountRaw, symbol) {
  if (!state.wallet) {
    showToast('Connect your wallet first', 'warn');
    return;
  }
  if (!confirm('Confirm SELL all ' + (symbol || mint) + ' back to SOL?\nThis opens Phantom for your signature.')) return;
  try {
    const swap = await prepareJupiterSwap({
      wallet: state.wallet,
      inputMint: mint,
      outputMint: SOL_MINT,
      amountRaw: String(amountRaw),
      slippageBps: 150
    });
    const sig = await signAndSend(swap.swapTransaction);
    showToast('Sell submitted: ' + sig.slice(0, 8) + '...', 'success');
  } catch (err) {
    showToast('Sell failed: ' + (err.message || err), 'error');
  }
}
