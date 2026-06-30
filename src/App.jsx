import { useEffect, useMemo, useRef, useState } from "react";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import {
  Activity, Bot, CheckCircle2, ChevronRight, CircleAlert, CircleDollarSign,
  ExternalLink, Gauge, Link2, LogOut, RefreshCw, Search,
  ShieldCheck, Square, TrendingUp, Wallet, Waves, XCircle, Zap,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const SOLANA_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const WINDOWS = [
  { id: "h1", label: "1H", dataKey: "h1" },
  { id: "h6", label: "6H", dataKey: "h6" },
  { id: "h24", label: "24H", dataKey: "h24" },
  { id: "d3", label: "3D", dataKey: "h24", proxy: true },
  { id: "d7", label: "7D", dataKey: "h24", proxy: true },
];
const DEFAULTS = {
  orderSizeSol: 0.05,
  stopLoss: 18,
  firstTakeProfit: 100,
  firstSellPercent: 50,
  trailingDrop: 22,
  minScore: 75,
  minLiquidity: 25000,
  maxPositions: 3,
};
const AGENTS = [
  { name: "Atlas", role: "Momentum", icon: TrendingUp, focus: "Volume acceleration and price structure" },
  { name: "Sentinel", role: "Risk", icon: ShieldCheck, focus: "RugCheck, LP lock and liquidity depth" },
  { name: "Pulse", role: "Activity", icon: Activity, focus: "Buy pressure and transaction velocity" },
  { name: "Orbit", role: "Exit", icon: Waves, focus: "Profit ladder, trailing stop and emergency exits" },
];

function getPhantomProvider() {
  if (typeof window === "undefined") return null;
  const provider = window.phantom?.solana || window.solana;
  return provider?.isPhantom ? provider : null;
}

function shortKey(value) {
  return value ? `${value.slice(0, 4)}...${value.slice(-4)}` : "";
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function price(value) {
  const number = Number(value || 0);
  if (!number) return "$0.00";
  if (number < 0.0001) return `$${number.toPrecision(3)}`;
  return `$${number.toLocaleString("en-US", { maximumFractionDigits: 7 })}`;
}

function age(timestamp) {
  const minutes = Math.max(0, Math.round((Date.now() - Number(timestamp || Date.now())) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

function windowScore(token, window) {
  const volume = Number(token.volume?.[window.dataKey] || 0);
  const tx = token.transactions?.[window.dataKey] || {};
  const activity = Number(tx.buys || 0) + Number(tx.sells || 0);
  const momentum = Number(token.priceChange?.[window.dataKey] || 0);
  const windowSignal = Math.min(30, volume / 25000) + Math.min(24, activity / 20) + Math.max(0, Math.min(22, (momentum + 12) / 3));
  return Math.round(Math.max(0, Math.min(100, token.score * 0.68 + windowSignal * 0.32)));
}

function openChecks(token) {
  const urls = [token.url, token.dextoolsUrl, token.rugcheckUrl].filter(Boolean);
  if (!urls.length) return;

  urls.forEach((url) => {
    const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
    if (popup) {
      popup.opener = null;
      popup.location.href = url;
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.style.position = "fixed";
    anchor.style.left = "-9999px";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  });
}

function base64ToUint8Array(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function emptyWalletSummary() {
  return {
    status: "Disconnected",
    solBalance: 0,
    solBalanceLamports: 0,
    solPriceUsd: 0,
    portfolioUsd: 0,
    holdings: [],
    updatedAt: null,
    error: "",
  };
}

function App() {
  const [tokens, setTokens] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [scanWindow, setScanWindow] = useState("h1");
  const [query, setQuery] = useState("");
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [scanState, setScanState] = useState({ status: "Connecting", error: "", scannedAt: null, note: "" });
  const [phantom, setPhantom] = useState({ detected: false, connected: false, publicKey: "" });
  const [photon, setPhoton] = useState({ connected: false, status: "Not linked" });
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [mode, setMode] = useState("paper");
  const [adapter, setAdapter] = useState({ configured: false, provider: "execution-webhook" });
  const [positions, setPositions] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("infinity-positions") || "[]");
      return Array.isArray(saved)
        ? saved.map((position) => ({
          ...position,
          mode: position.mode || "paper",
          tokenAmountRaw: position.tokenAmountRaw || "",
          remainingTokenAmountRaw: position.remainingTokenAmountRaw || "",
        }))
        : [];
    } catch {
      return [];
    }
  });
  const [events, setEvents] = useState(["Infinity engine standing by. Paper mode is active."]);
  const [selectedView, setSelectedView] = useState("market");
  const [settings, setSettings] = useState(DEFAULTS);
  const [walletSummary, setWalletSummary] = useState(emptyWalletSummary);
  const engineBusy = useRef(false);

  const timeframe = WINDOWS.find((item) => item.id === scanWindow) || WINDOWS[0];

  function log(message) {
    setEvents((current) => [`${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${message}`, ...current].slice(0, 12));
  }

  async function refreshWalletPortfolio(walletAddress = phantom.publicKey) {
    if (!walletAddress) {
      setWalletSummary(emptyWalletSummary());
      return null;
    }

    setWalletSummary((current) => ({ ...current, status: "Refreshing", error: "" }));
    try {
      const response = await fetch(`${API_BASE}/api/wallet/portfolio?wallet=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.details || result.error || "Wallet portfolio unavailable.");

      const holdings = Array.isArray(result.holdings) ? result.holdings : [];
      const next = {
        status: "Live",
        solBalance: Number(result.solBalance || 0),
        solBalanceLamports: Number(result.solBalanceLamports || 0),
        solPriceUsd: Number(result.solPriceUsd || 0),
        portfolioUsd: Number(result.portfolioUsd || 0),
        holdings,
        updatedAt: result.updatedAt ? new Date(result.updatedAt) : new Date(),
        error: "",
      };
      setWalletSummary(next);
      return next;
    } catch (error) {
      setWalletSummary((current) => ({ ...current, status: "Offline", error: error.message || "Wallet portfolio unavailable." }));
      return null;
    }
  }

  async function scanMarket({ manual = false } = {}) {
    setScanState((current) => ({ ...current, status: "Scanning", error: "" }));
    try {
      const response = await fetch(`${API_BASE}/api/dexscreener/scan${manual ? `?refresh=${Date.now()}` : ""}`, { cache: manual ? "no-store" : "default" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.details || result.error || "Scanner unavailable.");
      setTokens(result.tokens || []);
      setSelectedAddress((current) => result.tokens.some((token) => token.address === current) ? current : result.tokens[0]?.address || "");
      setScanState({ status: "Live", error: "", scannedAt: new Date(result.scannedAt), note: result.notes?.longWindowData || "" });
    } catch (error) {
      setScanState((current) => ({ ...current, status: "Offline", error: error.message }));
    }
  }

  useEffect(() => {
    scanMarket();
    fetch(`${API_BASE}/api/automation/execute`).then((response) => response.json()).then(setAdapter).catch(() => {});
    const timer = window.setInterval(() => scanMarket(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("infinity-positions", JSON.stringify(positions));
  }, [positions]);

  useEffect(() => {
    const provider = getPhantomProvider();
    setPhantom({ detected: Boolean(provider), connected: Boolean(provider?.isConnected && provider?.publicKey), publicKey: provider?.publicKey?.toString?.() || "" });
    if (!provider) return undefined;
    const connect = (key) => {
      const walletAddress = key?.toString?.() || provider.publicKey?.toString?.() || "";
      setPhantom({ detected: true, connected: true, publicKey: walletAddress });
      void refreshWalletPortfolio(walletAddress);
    };
    const disconnect = () => {
      setPhantom({ detected: true, connected: false, publicKey: "" });
      setWalletSummary(emptyWalletSummary());
    };
    provider.on?.("connect", connect);
    provider.on?.("disconnect", disconnect);
    provider.on?.("accountChanged", (key) => key ? connect(key) : disconnect());
    return () => {
      provider.off?.("connect", connect);
      provider.off?.("disconnect", disconnect);
    };
  }, []);

  useEffect(() => {
    if (!phantom.connected || !phantom.publicKey) {
      setWalletSummary(emptyWalletSummary());
      return undefined;
    }

    void refreshWalletPortfolio(phantom.publicKey);
    const timer = window.setInterval(() => refreshWalletPortfolio(phantom.publicKey), 45000);
    return () => window.clearInterval(timer);
  }, [phantom.connected, phantom.publicKey]);

  const rankedTokens = useMemo(() => tokens
    .map((token) => ({ ...token, windowScore: windowScore(token, timeframe) }))
    .filter((token) => !query.trim() || `${token.symbol} ${token.name} ${token.address}`.toLowerCase().includes(query.toLowerCase()))
    .filter((token) => !eligibleOnly || token.risk?.eligible)
    .sort((a, b) => b.windowScore - a.windowScore), [eligibleOnly, query, timeframe, tokens]);

  const selectedToken = rankedTokens.find((token) => token.address === selectedAddress) || rankedTokens[0] || null;
  const pumpTokens = useMemo(() => tokens.filter((token) => token.isPump).sort((a, b) => (b.socials?.score || 0) - (a.socials?.score || 0) || b.score - a.score), [tokens]);
  const eligibleCount = tokens.filter((token) => token.risk?.eligible && token.score >= settings.minScore && token.liquidityUsd >= settings.minLiquidity).length;
  const activePositions = positions.filter((position) => position.status === "open");

  const agentBids = useMemo(() => selectedToken ? AGENTS.map((agent, index) => {
    const modifiers = [selectedToken.windowScore, selectedToken.risk?.score || 0, selectedToken.buyPressure, selectedToken.socials?.score || 0];
    const confidence = Math.round(modifiers[index] * 0.55 + selectedToken.score * 0.45);
    return { ...agent, confidence, decision: selectedToken.risk?.eligible && confidence >= 70 ? "Bid" : confidence >= 55 ? "Watch" : "Pass" };
  }) : [], [selectedToken]);

  async function connectPhantom() {
    const provider = getPhantomProvider();
    if (!provider) return window.open("https://phantom.com/download", "_blank", "noopener,noreferrer");
    try {
      const result = await provider.connect();
      const walletAddress = result.publicKey?.toString?.() || provider.publicKey?.toString?.() || "";
      setPhantom({ detected: true, connected: true, publicKey: walletAddress });
      void refreshWalletPortfolio(walletAddress);
      log("Phantom connected.");
    } catch (error) {
      log(error.message || "Phantom connection declined.");
    }
  }

  async function disconnectPhantom() {
    try { await getPhantomProvider()?.disconnect?.(); } catch { /* provider state still clears locally */ }
    setPhantom((current) => ({ ...current, connected: false, publicKey: "" }));
    setWalletSummary(emptyWalletSummary());
    log("Phantom disconnected.");
  }

  function connectPhoton() {
    setPhoton({ connected: true, status: "Deep-link ready" });
    window.open("https://photon-sol.tinyastro.io", "_blank", "noopener,noreferrer");
    log("Photon workspace opened. Session remains managed by Photon.");
  }

  function disconnectPhoton() {
    setPhoton({ connected: false, status: "Not linked" });
    log("Photon deep-link session cleared locally.");
  }

  async function executePhantomTrade(command, executionMode) {
    const provider = getPhantomProvider();
    if (!provider || !phantom.connected || !phantom.publicKey) {
      throw new Error("Connect Phantom before using live trading.");
    }

    if (command.action === "cancel") {
      return { accepted: true, simulated: false, executionId: crypto.randomUUID(), action: "cancel" };
    }

    const token = command.token || command.position || {};
    const slippageBps = Number(command?.order?.slippageBps || 100);
    const liveMode = executionMode || "live";
    const isBuy = command.action === "buy";
    const remainingRaw = BigInt(command?.position?.remainingTokenAmountRaw || command?.position?.tokenAmountRaw || 0);
    let amountRaw;

    if (isBuy) {
      amountRaw = BigInt(Math.round(Number(command?.order?.sizeSol || DEFAULTS.orderSizeSol) * 1e9));
    } else if (command.action === "sell-half") {
      amountRaw = remainingRaw / 2n;
    } else {
      amountRaw = remainingRaw;
    }

    if (!amountRaw || amountRaw <= 0n) {
      throw new Error("The live trade amount is too small to route.");
    }

    if (isBuy && (token.risk?.eligible !== true || Number(token.score || 0) < settings.minScore || Number(token.liquidityUsd || 0) < settings.minLiquidity)) {
      throw new Error("Token does not clear the live trading gate.");
    }

    const response = await fetch(`${API_BASE}/api/jupiter/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wallet: phantom.publicKey,
        inputMint: isBuy ? SOL_MINT : token.address,
        outputMint: isBuy ? token.address : SOL_MINT,
        amountRaw: amountRaw.toString(),
        slippageBps,
        side: isBuy ? "buy" : "sell",
        mode: liveMode,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.details || result.error || "Live swap request failed.");
    }

    const transaction = VersionedTransaction.deserialize(base64ToUint8Array(result.swapTransaction));
    const signatureResult = await provider.signAndSendTransaction(transaction);
    const signature = signatureResult?.signature || signatureResult;

    try {
      const connection = new Connection(SOLANA_RPC_URL, "confirmed");
      await connection.confirmTransaction(signature, "confirmed");
    } catch {
      // Confirmation is best-effort here; the wallet feed refresh below will catch the actual settled state.
    }

    return {
      accepted: true,
      simulated: false,
      executionId: signature || crypto.randomUUID(),
      signature,
      route: result,
      amountRaw: amountRaw.toString(),
      action: command.action,
    };
  }

  async function execute(command, executionMode = mode) {
    if (executionMode === "live" && phantom.connected) {
      return executePhantomTrade(command, executionMode);
    }

    const response = await fetch(`${API_BASE}/api/automation/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...command, mode: executionMode }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(Array.isArray(result.details) ? result.details.join(" ") : result.error);
    return result;
  }

  async function openPosition(token) {
    const executionMode = mode;
    const result = await execute({ action: "buy", token, order: { sizeSol: settings.orderSizeSol }, rules: settings }, executionMode);
    const tokenAmountRaw = result.route?.outAmount ? String(result.route.outAmount) : "";
    const position = {
      id: result.executionId,
      tokenAddress: token.address,
      symbol: token.symbol,
      entryPrice: token.priceUsd,
      currentPrice: token.priceUsd,
      highPrice: token.priceUsd,
      sizeSol: settings.orderSizeSol,
      remainingPercent: 100,
      partialTaken: false,
      status: "open",
      mode: executionMode,
      openedAt: new Date().toISOString(),
      tokenAmountRaw,
      remainingTokenAmountRaw: tokenAmountRaw,
      entrySignature: result.signature || "",
    };
    setPositions((current) => [position, ...current]);
    log(`${executionMode === "paper" ? "Paper" : "Live"} buy accepted: ${token.symbol} at ${price(token.priceUsd)}.`);
    if (executionMode === "live") void refreshWalletPortfolio();
  }

  async function closePosition(position, action, reason) {
    const token = tokens.find((item) => item.address === position.tokenAddress) || { address: position.tokenAddress, symbol: position.symbol, score: 100, risk: { eligible: true } };
    const result = await execute({ action, token, position, reason }, position.mode || mode);
    setPositions((current) => current.map((item) => item.id === position.id ? {
      ...item,
      status: action === "sell-half" ? "open" : "closed",
      remainingPercent: action === "sell-half" ? 50 : 0,
      partialTaken: action === "sell-half" ? true : item.partialTaken,
      remainingTokenAmountRaw: action === "sell-half" && item.remainingTokenAmountRaw
        ? (() => {
            const remaining = BigInt(item.remainingTokenAmountRaw || "0");
            const sold = BigInt(result.amountRaw || "0");
            return remaining > sold ? (remaining - sold).toString() : "";
          })()
        : action === "sell-half"
          ? item.remainingTokenAmountRaw
          : "0",
      closedAt: action === "sell-half" ? undefined : new Date().toISOString(),
      exitReason: reason,
      exitSignature: result.signature || item.exitSignature || "",
    } : item));
    log(`${position.symbol}: ${reason}.`);
    if ((position.mode || mode) === "live") void refreshWalletPortfolio();
  }

  const liveReady = phantom.connected || adapter.configured;

  async function runAgentCycle() {
    if (engineBusy.current) return;
    engineBusy.current = true;
    try {
      for (const position of activePositions) {
        const token = tokens.find((item) => item.address === position.tokenAddress);
        if (!token) continue;
        const pnl = ((token.priceUsd / position.entryPrice) - 1) * 100;
        const highPrice = Math.max(position.highPrice || position.entryPrice, token.priceUsd);
        setPositions((current) => current.map((item) => item.id === position.id ? { ...item, currentPrice: token.priceUsd, highPrice } : item));
        if (!token.risk?.eligible || token.liquidityUsd < 12000 || token.buyPressure < 35) await closePosition(position, "sell-all", "Emergency risk exit");
        else if (pnl <= -settings.stopLoss) await closePosition(position, "sell-all", `Stop loss at ${pnl.toFixed(1)}%`);
        else if (!position.partialTaken && pnl >= settings.firstTakeProfit) await closePosition(position, "sell-half", "100% target reached, 50% secured");
        else if (position.partialTaken && token.priceUsd <= highPrice * (1 - settings.trailingDrop / 100)) await closePosition(position, "sell-all", "Trailing stop closed the runner");
      }

      const openAddresses = new Set(activePositions.map((position) => position.tokenAddress));
      const candidate = tokens
        .filter((token) => !openAddresses.has(token.address))
        .filter((token) => token.risk?.eligible && token.score >= settings.minScore && token.liquidityUsd >= settings.minLiquidity)
        .sort((a, b) => b.score - a.score)[0];
      if (autoEnabled && activePositions.length < settings.maxPositions && candidate) await openPosition(candidate);
    } catch (error) {
      log(`Engine blocked: ${error.message}`);
    } finally {
      engineBusy.current = false;
    }
  }

  useEffect(() => {
    if (autoEnabled && tokens.length) void runAgentCycle();
  }, [autoEnabled, tokens, mode, phantom.connected, phantom.publicKey]);

  async function emergencyStop() {
    setAutoEnabled(false);
    log("Emergency stop activated. New entries disabled.");
    await Promise.allSettled(activePositions.map((position) => closePosition(position, "sell-all", "Manual emergency override")));
  }

  return (
    <main className="station-shell">
      <header className="station-header">
        <a className="brand" href="#top"><span>73∞</span><div><strong>73inc Infinity Project</strong><small>Internal Solana intelligence station</small></div></a>
        <nav aria-label="Station views">
          <button className={selectedView === "market" ? "active" : ""} onClick={() => setSelectedView("market")}>Market</button>
          <button className={selectedView === "pump" ? "active" : ""} onClick={() => setSelectedView("pump")}>Pump.fun</button>
          <button className={selectedView === "agents" ? "active" : ""} onClick={() => setSelectedView("agents")}>Agents</button>
          <button className={selectedView === "positions" ? "active" : ""} onClick={() => setSelectedView("positions")}>Positions</button>
        </nav>
        <div className="connection-cluster">
          <div className="connection-pair"><button className={phantom.connected ? "connected" : ""} onClick={connectPhantom}><Wallet size={15} />{phantom.connected ? shortKey(phantom.publicKey) : "Phantom Connect"}</button><button className="icon-button" title="Disconnect Phantom" aria-label="Disconnect Phantom" disabled={!phantom.connected} onClick={disconnectPhantom}><LogOut size={15} /></button></div>
          <div className="connection-pair"><button className={photon.connected ? "connected photon" : ""} onClick={connectPhoton}><Zap size={15} />{photon.connected ? photon.status : "Photon Connect"}</button><button className="icon-button" title="Disconnect Photon" aria-label="Disconnect Photon" disabled={!photon.connected} onClick={disconnectPhoton}><LogOut size={15} /></button></div>
        </div>
      </header>

      <section className="command-strip" id="top">
        <div><span>Scanner</span><strong className={scanState.status === "Live" ? "positive" : "warning"}><i />{scanState.status}</strong></div>
        <div><span>Universe</span><strong>{tokens.length} tokens</strong></div>
        <div><span>Trade eligible</span><strong>{eligibleCount}</strong></div>
        <div><span>Wallet SOL</span><strong>{phantom.connected ? `${walletSummary.solBalance.toFixed(4)} SOL` : "Disconnected"}</strong></div>
        <div><span>Portfolio</span><strong>{phantom.connected ? money(walletSummary.portfolioUsd) : "—"}</strong></div>
        <div><span>Execution</span><strong>{mode === "paper" ? "Paper" : liveReady ? (phantom.connected ? "Live via Phantom" : "Live ready") : "Live locked"}</strong></div>
        <button className="emergency" disabled={!autoEnabled && !activePositions.length} onClick={emergencyStop}><Square size={14} fill="currentColor" /> Emergency stop</button>
      </section>

      <section className="operations-bar">
        <div className="engine-state"><Bot size={18} /><div><strong>Infinity Agent Engine</strong><span>{autoEnabled ? "Scanning and managing positions" : "Paused"}</span></div><label className="switch"><input type="checkbox" checked={autoEnabled} onChange={(event) => setAutoEnabled(event.target.checked)} /><i /></label></div>
        <div className="mode-control" aria-label="Execution mode"><button type="button" className={mode === "paper" ? "active" : ""} onClick={() => setMode("paper")}>Paper</button><button type="button" className={mode === "live" ? "active" : ""} onClick={() => setMode("live")} disabled={!liveReady} title={liveReady ? "Live trading via Phantom or adapter" : "Connect Phantom or configure the execution adapter"}>Live</button></div>
        <span className="guardrail"><ShieldCheck size={16} /> RugCheck required · 0.05 SOL fixed entry{phantom.connected ? " · Phantom signs live orders" : adapter.configured ? " · Adapter ready" : ""}</span>
        <button className="cycle-button" onClick={runAgentCycle}><Bot size={16} /> Run agent cycle</button>
      </section>

      <section className="wallet-summary-band">
        <div className="wallet-summary-head">
          <div>
            <p>Wallet feed</p>
            <h2>True Phantom balance and portfolio</h2>
            <span>{phantom.connected ? `Connected as ${shortKey(phantom.publicKey)} · ${walletSummary.updatedAt ? `refreshed ${walletSummary.updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "refreshing now"}` : "Connect Phantom to load live wallet balances and holdings."}</span>
          </div>
          <button className="icon-button" title="Refresh wallet" aria-label="Refresh wallet" disabled={!phantom.connected} onClick={() => refreshWalletPortfolio()}><RefreshCw size={17} /></button>
        </div>
        <div className="wallet-summary-grid">
          <article><span>Wallet</span><strong>{phantom.connected ? shortKey(phantom.publicKey) : "Not connected"}</strong></article>
          <article><span>SOL balance</span><strong>{phantom.connected ? `${walletSummary.solBalance.toFixed(4)} SOL` : "—"}</strong></article>
          <article><span>Portfolio value</span><strong>{phantom.connected ? money(walletSummary.portfolioUsd) : "—"}</strong></article>
          <article><span>Holdings</span><strong>{phantom.connected ? walletSummary.holdings.length : "—"}</strong></article>
        </div>
        <div className="wallet-holdings">
          {phantom.connected && walletSummary.holdings.length ? walletSummary.holdings.slice(0, 6).map((holding) => (
            <div className="wallet-holding" key={holding.mint}>
              <div className="wallet-holding-name">
                <b>{holding.symbol || holding.mint.slice(0, 4)}</b>
                <span>{holding.name || holding.mint}</span>
              </div>
              <div className="wallet-holding-values">
                <strong>{Number(holding.balance || 0).toLocaleString("en-US", { maximumFractionDigits: 4 })}</strong>
                <small>{money(holding.valueUsd)}</small>
              </div>
            </div>
          )) : <div className="empty"><CircleDollarSign size={24} />{phantom.connected ? "No priced holdings found" : "Connect Phantom to inspect balances"}</div>}
        </div>
        {walletSummary.error ? <div className="alert error"><XCircle size={17} />{walletSummary.error}</div> : null}
      </section>

      {selectedView === "market" ? <>
        <section className="section-heading">
          <div><p>Cross-source discovery</p><h1>Trending Solana scanner</h1><span>Ranked by liquidity, activity, momentum, profile strength and RugCheck trust.</span></div>
          <div className="time-tabs">{WINDOWS.map((item) => <button key={item.id} className={scanWindow === item.id ? "active" : ""} onClick={() => setScanWindow(item.id)}>{item.label}</button>)}</div>
        </section>
        <section className="filter-row">
          <label className="search"><Search size={16} /><input placeholder="Search symbol, name or mint" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label className="check-control"><input type="checkbox" checked={eligibleOnly} onChange={(event) => setEligibleOnly(event.target.checked)} />Auto-trade eligible only</label>
          {timeframe.proxy ? <span className="proxy-note"><CircleAlert size={14} />3D/7D currently use a conservative 24H momentum proxy</span> : null}
          <span>{scanState.scannedAt ? `Updated ${scanState.scannedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for feed"}</span>
          <button className="icon-button" title="Refresh scanner" aria-label="Refresh scanner" onClick={() => scanMarket({ manual: true })}><RefreshCw size={17} /></button>
        </section>
        {scanState.error ? <div className="alert error"><XCircle size={17} />{scanState.error}</div> : null}

        <section className="market-layout">
          <div className="market-table">
            <div className="market-head"><span># / Token</span><span>Price</span><span>{timeframe.label}</span><span>Volume</span><span>Liquidity</span><span>Risk</span><span>Score</span></div>
            <div className="market-body">{rankedTokens.slice(0, 70).map((token, index) => <button key={token.address} className={selectedToken?.address === token.address ? "market-row selected" : "market-row"} onClick={() => setSelectedAddress(token.address)}>
              <span className="token-cell"><b>{index + 1}</b>{token.imageUrl ? <img src={token.imageUrl} alt="" /> : <i>{token.symbol.slice(0, 1)}</i>}<span><strong>{token.symbol}</strong><small>{token.name}</small></span></span>
              <span>{price(token.priceUsd)}</span>
              <span className={Number(token.priceChange?.[timeframe.dataKey] || 0) >= 0 ? "positive" : "negative"}>{Number(token.priceChange?.[timeframe.dataKey] || 0) >= 0 ? "+" : ""}{Number(token.priceChange?.[timeframe.dataKey] || 0).toFixed(1)}%</span>
              <span>{money(token.volume?.[timeframe.dataKey])}</span><span>{money(token.liquidityUsd)}</span>
              <span><b className={`risk-tag ${token.risk?.eligible ? "clear" : token.risk?.checked ? "danger" : "unknown"}`}>{token.risk?.eligible ? "Cleared" : token.risk?.checked ? "Blocked" : "Unknown"}</b></span>
              <span className="score">{token.windowScore}</span>
            </button>)}</div>
          </div>

          <aside className="inspector">{selectedToken ? <>
            <div className="inspector-header"><div className="token-mark">{selectedToken.imageUrl ? <img src={selectedToken.imageUrl} alt="" /> : selectedToken.symbol.slice(0, 1)}</div><div><span>{selectedToken.name}</span><h2>{selectedToken.symbol}</h2></div><b className={`risk-tag ${selectedToken.risk?.eligible ? "clear" : "danger"}`}>{selectedToken.risk?.eligible ? "RugCheck pass" : "Blocked"}</b></div>
            <div className="price-line"><strong>{price(selectedToken.priceUsd)}</strong><span className={Number(selectedToken.priceChange?.[timeframe.dataKey] || 0) >= 0 ? "positive" : "negative"}>{Number(selectedToken.priceChange?.[timeframe.dataKey] || 0).toFixed(2)}%</span></div>
            <dl><div><dt>Infinity score</dt><dd>{selectedToken.windowScore}/100</dd></div><div><dt>RugCheck trust</dt><dd>{selectedToken.risk?.score || 0}/100</dd></div><div><dt>Liquidity</dt><dd>{money(selectedToken.liquidityUsd)}</dd></div><div><dt>Buy pressure</dt><dd>{selectedToken.buyPressure}%</dd></div><div><dt>Market cap</dt><dd>{money(selectedToken.marketCap)}</dd></div><div><dt>Age</dt><dd>{age(selectedToken.pairCreatedAt)}</dd></div></dl>
            <div className="risk-findings"><strong>Risk findings</strong>{selectedToken.risk?.risks?.length ? selectedToken.risk.risks.slice(0, 3).map((risk) => <span key={risk.name}><CircleAlert size={13} />{risk.name}</span>) : <span><CheckCircle2 size={13} />No reported summary risks</span>}</div>
            <div className="inspection-links"><a href={selectedToken.url} target="_blank" rel="noreferrer">DexScreener <ExternalLink size={13} /></a><a href={selectedToken.dextoolsUrl} target="_blank" rel="noreferrer">Dextools <ExternalLink size={13} /></a><a href={selectedToken.rugcheckUrl} target="_blank" rel="noreferrer">RugCheck <ExternalLink size={13} /></a><button type="button" onClick={() => openChecks(selectedToken)}><Link2 size={14} />Open all checks</button></div>
            <a className="photon-trade" href={selectedToken.photonUrl} target="_blank" rel="noreferrer"><Zap size={16} />Inspect on Photon <ChevronRight size={15} /></a>
            <code>{selectedToken.address}</code>
          </> : <div className="empty"><Gauge size={25} />Select a token</div>}</aside>
        </section>
      </> : null}

      {selectedView === "pump" ? <section className="view-section">
        <div className="section-heading"><div><p>Launch intelligence</p><h1>Pump.fun scanner</h1><span>New launches ranked first by public identity, then trust and trading strength.</span></div><span className="count-badge">{pumpTokens.length} detected</span></div>
        <div className="pump-grid">{pumpTokens.slice(0, 30).map((token) => <article key={token.address} className="pump-item">
          <div><span className="token-mark">{token.imageUrl ? <img src={token.imageUrl} alt="" /> : token.symbol.slice(0, 1)}</span><div><strong>{token.symbol}</strong><small>{age(token.pairCreatedAt)} · {money(token.liquidityUsd)} liquidity</small></div><b>{token.score}</b></div>
          <div className="social-rank"><span className={token.socials?.hasX ? "on" : ""}>X</span><span className={token.socials?.hasWebsite ? "on" : ""}>Web</span><span className={token.socials?.hasTelegram ? "on" : ""}>TG</span><em>Profile {token.socials?.score || 0}</em></div>
          <p>{token.risk?.eligible ? "RugCheck cleared for agent review" : "Risk gate blocked or unverified"}</p>
          <div><a href={token.url} target="_blank" rel="noreferrer">DEX</a><a href={token.dextoolsUrl} target="_blank" rel="noreferrer">Tools</a><a href={token.rugcheckUrl} target="_blank" rel="noreferrer">Risk</a><button type="button" onClick={() => openChecks(token)}>All</button></div>
        </article>)}</div>
      </section> : null}

      {selectedView === "agents" ? <section className="view-section">
        <div className="section-heading"><div><p>Decision market</p><h1>AI agent bids</h1><span>Specialist agents independently score the selected token before the risk gate permits execution.</span></div></div>
        <div className="agent-grid">{agentBids.map((agent) => <article className="agent-item" key={agent.name}><agent.icon size={20} /><div><span>{agent.role} agent</span><h2>{agent.name}</h2><p>{agent.focus}</p></div><div className={`agent-decision ${agent.decision.toLowerCase()}`}><strong>{agent.confidence}%</strong><span>{agent.decision}</span></div></article>)}</div>
        <div className="agent-consensus"><Bot size={22} /><div><strong>Consensus</strong><span>{selectedToken ? `${agentBids.filter((agent) => agent.decision === "Bid").length} of ${agentBids.length} agents bid on ${selectedToken.symbol}` : "Select a token in Market"}</span></div><button type="button" disabled={!selectedToken || !selectedToken.risk?.eligible} onClick={() => selectedToken && openPosition(selectedToken)}>Manual 0.05 SOL entry</button></div>
      </section> : null}

      {selectedView === "positions" ? <section className="view-section">
        <div className="section-heading"><div><p>Position control</p><h1>Automation and overrides</h1><span>Every position can be closed manually. The emergency control stops entries and requests full exits.</span></div></div>
        <div className="risk-settings">
            <label>Entry size<strong>0.05 SOL</strong></label><label>Stop loss<strong>-{settings.stopLoss}%</strong><input type="range" min="8" max="30" value={settings.stopLoss} onChange={(event) => setSettings((current) => ({ ...current, stopLoss: Number(event.target.value) }))} /></label><label>First take profit<strong>+{settings.firstTakeProfit}% / sell 50%</strong></label><label>Runner trail<strong>{settings.trailingDrop}% from high</strong><input type="range" min="10" max="35" value={settings.trailingDrop} onChange={(event) => setSettings((current) => ({ ...current, trailingDrop: Number(event.target.value) }))} /></label><label>Minimum score<strong>{settings.minScore}</strong><input type="range" min="70" max="90" value={settings.minScore} onChange={(event) => setSettings((current) => ({ ...current, minScore: Number(event.target.value) }))} /></label>
        </div>
        <div className="position-table"><div className="position-head"><span>Position</span><span>Mode</span><span>Entry</span><span>Current</span><span>P/L</span><span>Remaining</span><span>Override</span></div>{positions.length ? positions.map((position) => {
          const current = tokens.find((token) => token.address === position.tokenAddress)?.priceUsd || position.currentPrice;
          const pnl = ((current / position.entryPrice) - 1) * 100;
          return <div className="position-row" key={position.id}><span><strong>{position.symbol}</strong><small>{position.status}</small></span><span>{position.mode}</span><span>{price(position.entryPrice)}</span><span>{price(current)}</span><span className={pnl >= 0 ? "positive" : "negative"}>{pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}%</span><span>{position.remainingPercent}%</span><span><button type="button" disabled={position.status !== "open"} onClick={() => closePosition(position, "sell-all", "Manual position override")}><XCircle size={14} />Close</button></span></div>;
        }) : <div className="empty"><CircleDollarSign size={24} />No positions yet</div>}</div>
        <div className="event-log"><strong>Engine log</strong>{events.map((event) => <span key={event}>{event}</span>)}</div>
      </section> : null}
    </main>
  );
}

export default App;
