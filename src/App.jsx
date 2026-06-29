import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ExternalLink,
  Gauge,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  Zap,
} from "lucide-react";

const scanWindows = [
  { id: "1h", label: "1H", apiKey: "h1" },
  { id: "6h", label: "6H", apiKey: "h6" },
  { id: "24h", label: "24H", apiKey: "h24" },
];

const defaultFilters = {
  minLiquidity: 10000,
  minVolume: 5000,
  minBuyPressure: 45,
};

const API_BASE = import.meta.env.DEV ? "https://73inc-trading-desk.netlify.app" : "";

function getPhantomProvider() {
  if (typeof window === "undefined") return null;
  const provider = window.phantom?.solana || window.solana;
  return provider?.isPhantom ? provider : null;
}

function shortKey(value) {
  return value ? `${value.slice(0, 4)}...${value.slice(-4)}` : "";
}

function compactMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function formatPrice(value) {
  const price = Number(value || 0);
  if (!price) return "$0.00";
  if (price < 0.0001) return `$${price.toPrecision(3)}`;
  return `$${price.toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
}

function formatAge(minutes) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

function scoreToken(token, timeframe) {
  const volume = Number(token.volume?.[timeframe.apiKey] || 0);
  const liquidityScore = Math.min(30, (token.liquidity / 100000) * 30);
  const volumeScore = Math.min(25, (volume / 250000) * 25);
  const pressureScore = Math.min(25, (token.buyPressure / 70) * 25);
  const freshnessScore = token.age <= 60 ? 15 : token.age <= 360 ? 9 : 4;
  const boostScore = Math.min(5, token.boosts || 0);
  return Math.round(Math.min(100, liquidityScore + volumeScore + pressureScore + freshnessScore + boostScore));
}

function signalFor(token) {
  if (token.liquidity < 10000 || token.buyPressure < 45) return "Review";
  if (token.score >= 78 && token.change > 3) return "Buy";
  if (token.score >= 58 && token.change > 0) return "Watch";
  return "Hold";
}

function normalizeToken(token) {
  return {
    symbol: token.symbol,
    name: token.name,
    address: token.address,
    pairAddress: token.pairAddress,
    dexUrl: token.url,
    imageUrl: token.imageUrl,
    age: token.pairCreatedAt ? Math.max(0, Math.round((Date.now() - token.pairCreatedAt) / 60000)) : 0,
    liquidity: Number(token.liquidityUsd || 0),
    volume: token.volume || {},
    priceChange: token.priceChange || {},
    buyPressure: Number(token.buyPressure || 0),
    price: Number(token.priceUsd || 0),
    marketCap: Number(token.marketCap || 0),
    boosts: Number(token.boosts || 0),
    transactions: token.transactions || {},
  };
}

function App() {
  const [tokens, setTokens] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [scanWindow, setScanWindow] = useState("1h");
  const [filters, setFilters] = useState(defaultFilters);
  const [query, setQuery] = useState("");
  const [scanState, setScanState] = useState({ status: "Connecting", error: "", scannedAt: null });
  const [wallet, setWallet] = useState({ detected: false, connected: false, publicKey: "" });
  const [autoTrade, setAutoTrade] = useState(false);
  const [order, setOrder] = useState({ sizeSol: 0.1, takeProfitPercent: 25, stopLossPercent: 10 });
  const [routeState, setRouteState] = useState({ status: "Idle", intentId: "", route: null, error: "" });

  const timeframe = scanWindows.find((item) => item.id === scanWindow) || scanWindows[0];

  async function scanMarket({ manual = false } = {}) {
    setScanState((current) => ({ ...current, status: "Scanning", error: "" }));
    try {
      const response = await fetch(`${API_BASE}/api/dexscreener/scan${manual ? `?refresh=${Date.now()}` : ""}`, {
        headers: { Accept: "application/json" },
        cache: manual ? "no-store" : "default",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.details || result.error || "DexScreener is unavailable.");
      const nextTokens = result.tokens.map(normalizeToken);
      setTokens(nextTokens);
      setSelectedAddress((current) => nextTokens.some((token) => token.address === current) ? current : nextTokens[0]?.address || "");
      setScanState({ status: "Live", error: "", scannedAt: new Date(result.scannedAt) });
    } catch (error) {
      setScanState((current) => ({ ...current, status: "Offline", error: error.message }));
    }
  }

  useEffect(() => {
    scanMarket();
    const timer = window.setInterval(() => scanMarket(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const provider = getPhantomProvider();
    setWallet({
      detected: Boolean(provider),
      connected: Boolean(provider?.isConnected && provider?.publicKey),
      publicKey: provider?.publicKey?.toString?.() || "",
    });
    if (!provider) return undefined;

    const handleConnect = (publicKey) => setWallet({ detected: true, connected: true, publicKey: publicKey?.toString?.() || "" });
    const handleDisconnect = () => {
      setWallet({ detected: true, connected: false, publicKey: "" });
      setAutoTrade(false);
      setRouteState({ status: "Idle", intentId: "", route: null, error: "" });
    };
    const handleAccountChanged = (publicKey) => publicKey ? handleConnect(publicKey) : handleDisconnect();
    provider.on?.("connect", handleConnect);
    provider.on?.("disconnect", handleDisconnect);
    provider.on?.("accountChanged", handleAccountChanged);
    return () => {
      provider.off?.("connect", handleConnect);
      provider.off?.("disconnect", handleDisconnect);
      provider.off?.("accountChanged", handleAccountChanged);
    };
  }, []);

  useEffect(() => {
    setRouteState({ status: "Idle", intentId: "", route: null, error: "" });
  }, [selectedAddress, order.sizeSol, order.takeProfitPercent, order.stopLossPercent]);

  const rankedTokens = useMemo(() => {
    const searchValue = query.trim().toLowerCase();
    return tokens
      .map((token) => {
        const score = scoreToken(token, timeframe);
        const change = Number(token.priceChange?.[timeframe.apiKey] || 0);
        const enriched = { ...token, score, change };
        return { ...enriched, signal: signalFor(enriched) };
      })
      .filter((token) => token.liquidity >= filters.minLiquidity)
      .filter((token) => Number(token.volume?.[timeframe.apiKey] || 0) >= filters.minVolume)
      .filter((token) => token.buyPressure >= filters.minBuyPressure)
      .filter((token) => !searchValue || `${token.symbol} ${token.name} ${token.address}`.toLowerCase().includes(searchValue))
      .sort((a, b) => b.score - a.score);
  }, [filters, query, timeframe, tokens]);

  const selectedToken = rankedTokens.find((token) => token.address === selectedAddress) || rankedTokens[0] || null;
  const newPairs = rankedTokens.filter((token) => token.age <= 60).slice(0, 4);
  const buySignals = rankedTokens.filter((token) => token.signal === "Buy").length;
  const photonUrl = selectedToken?.pairAddress
    ? `https://photon-sol.tinyastro.io/en/lp/${selectedToken.pairAddress}`
    : "https://photon-sol.tinyastro.io";

  async function connectPhantom() {
    const provider = getPhantomProvider();
    if (!provider) {
      window.open("https://phantom.com/download", "_blank", "noopener,noreferrer");
      return;
    }
    try {
      const response = await provider.connect();
      const publicKey = response.publicKey?.toString?.() || provider.publicKey?.toString?.() || "";
      setWallet({ detected: true, connected: true, publicKey });
    } catch {
      setWallet((current) => ({ ...current, connected: false }));
    }
  }

  function buildIntent() {
    return {
      wallet: wallet.publicKey,
      mode: autoTrade ? "armed" : "paper",
      token: {
        symbol: selectedToken.symbol,
        address: selectedToken.address,
        score: selectedToken.score,
      },
      agent: { name: "73inc Signal Agent", confidence: selectedToken.score },
      order: {
        side: "buy",
        sizeSol: order.sizeSol,
        maxWalletExposureSol: order.sizeSol,
        entryPrice: selectedToken.price,
        takeProfitPercent: order.takeProfitPercent,
        stopLossPercent: order.stopLossPercent,
        slippageBps: 150,
      },
    };
  }

  async function preparePhotonRoute() {
    if (!wallet.connected || !selectedToken) return;
    setRouteState({ status: "Preparing", intentId: "", route: null, error: "" });
    try {
      const intent = buildIntent();
      const intentResponse = await fetch(`${API_BASE}/api/trade/intent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
      });
      const intentResult = await intentResponse.json();
      if (!intentResponse.ok) throw new Error(Array.isArray(intentResult.details) ? intentResult.details.join(" ") : intentResult.error);

      const routeResponse = await fetch(`${API_BASE}/api/photon/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...intent, intentId: intentResult.intentId }),
      });
      const routeResult = await routeResponse.json();
      if (!routeResponse.ok) throw new Error(routeResult.error || "Photon route failed.");
      setRouteState({
        status: routeResult.configured ? "Ready to sign" : "Simulation ready",
        intentId: intentResult.intentId,
        route: routeResult.route,
        error: "",
      });
    } catch (error) {
      setRouteState({ status: "Blocked", intentId: "", route: null, error: error.message || "Route preparation failed." });
    }
  }

  async function signAndSendTrade() {
    const provider = getPhantomProvider();
    const message = routeState.route?.transactionMessage || routeState.route?.transactionBase58;
    if (!provider || !autoTrade || !message) return;
    try {
      setRouteState((current) => ({ ...current, status: "Awaiting signature", error: "" }));
      const result = await provider.request({
        method: "signAndSendTransaction",
        params: { message, options: { skipPreflight: false, preflightCommitment: "confirmed" } },
      });
      setRouteState((current) => ({ ...current, status: `Submitted ${shortKey(result?.signature || "")}` }));
    } catch (error) {
      setRouteState((current) => ({ ...current, status: "Signature cancelled", error: error.message || "Phantom rejected the transaction." }));
    }
  }

  return (
    <main className="desk-shell">
      <header className="app-header">
        <a className="desk-brand" href="#scanner" aria-label="73inc Trading Desk home">
          <span className="desk-logo">73</span>
          <span><strong>73inc Trading Desk</strong><small>Solana live scanner</small></span>
        </a>
        <nav className="desk-nav" aria-label="Primary navigation">
          <a className="active" href="#scanner">Scanner</a>
          <a href="#new-pairs">New pairs</a>
          <a href="#automation">Automation</a>
        </nav>
        <div className="header-actions">
          <span className={`live-state ${scanState.status.toLowerCase()}`}><i />{scanState.status}</span>
          <a className="photon-button" href={photonUrl} target="_blank" rel="noreferrer">
            <Zap size={16} /> Photon <ExternalLink size={13} />
          </a>
          <button className={wallet.connected ? "wallet-button connected" : "wallet-button"} onClick={connectPhantom} type="button">
            {wallet.connected ? <CheckCircle2 size={17} /> : <Wallet size={17} />}
            {wallet.connected ? shortKey(wallet.publicKey) : "Connect Phantom"}
          </button>
        </div>
      </header>

      <section className="summary-strip" aria-label="Trading desk summary">
        <div><CircleDollarSign size={18} /><span>Deployed</span><strong>0.00 SOL</strong></div>
        <div><Activity size={18} /><span>Live pairs</span><strong>{rankedTokens.length}</strong></div>
        <div><Sparkles size={18} /><span>Buy signals</span><strong>{buySignals}</strong></div>
        <div><Bot size={18} /><span>Automation</span><strong>{autoTrade ? "Armed" : "Off"}</strong></div>
      </section>

      <section className="scanner-section" id="scanner">
        <div className="scanner-title-row">
          <div><p className="desk-kicker">DexScreener feed</p><h1>Live Solana opportunities</h1></div>
          <div className="scan-controls">
            <div className="timeframe-control" role="tablist" aria-label="Market timeframe">
              {scanWindows.map((item) => (
                <button key={item.id} type="button" role="tab" aria-selected={scanWindow === item.id} className={scanWindow === item.id ? "active" : ""} onClick={() => setScanWindow(item.id)}>{item.label}</button>
              ))}
            </div>
            <button className="icon-action" type="button" title="Refresh scanner" aria-label="Refresh scanner" disabled={scanState.status === "Scanning"} onClick={() => scanMarket({ manual: true })}>
              <RefreshCw size={18} className={scanState.status === "Scanning" ? "spin" : ""} />
            </button>
          </div>
        </div>

        <div className="filter-bar">
          <label className="search-box"><Search size={17} /><input aria-label="Search tokens" placeholder="Search token or address" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label>Min liquidity<input type="number" value={filters.minLiquidity} onChange={(event) => setFilters((current) => ({ ...current, minLiquidity: Number(event.target.value) }))} /></label>
          <label>Min volume<input type="number" value={filters.minVolume} onChange={(event) => setFilters((current) => ({ ...current, minVolume: Number(event.target.value) }))} /></label>
          <label>Buy pressure<input type="number" min="0" max="100" value={filters.minBuyPressure} onChange={(event) => setFilters((current) => ({ ...current, minBuyPressure: Number(event.target.value) }))} /></label>
          <span className="updated-at">{scanState.scannedAt ? `Updated ${scanState.scannedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Connecting to market"}</span>
        </div>
        {scanState.error ? <p className="feed-error">{scanState.error}</p> : null}

        <div className="scanner-layout">
          <section className="market-table" aria-label="Live Solana market results">
            <div className="market-head"><span>Token</span><span>Price</span><span>{timeframe.label}</span><span>Volume</span><span>Liquidity</span><span>Signal</span><span>Score</span></div>
            <div className="market-body">
              {rankedTokens.map((token) => (
                <button className={selectedToken?.address === token.address ? "market-row selected" : "market-row"} type="button" key={token.address} onClick={() => setSelectedAddress(token.address)}>
                  <span className="token-identity">
                    {token.imageUrl ? <img src={token.imageUrl} alt="" /> : <i>{token.symbol.slice(0, 1)}</i>}
                    <span><strong>{token.symbol}</strong><small>{token.name}</small></span>
                  </span>
                  <span>{formatPrice(token.price)}</span>
                  <span className={token.change >= 0 ? "gain" : "loss"}>{token.change >= 0 ? "+" : ""}{token.change.toFixed(1)}%</span>
                  <span>{compactMoney(token.volume?.[timeframe.apiKey])}</span>
                  <span>{compactMoney(token.liquidity)}</span>
                  <span><b className={`signal-pill ${token.signal.toLowerCase()}`}>{token.signal}</b></span>
                  <span className="score-cell">{token.score}</span>
                </button>
              ))}
              {!rankedTokens.length ? <div className="no-results"><Search size={24} /><strong>No pairs match these filters</strong><span>Lower a threshold or wait for the next live scan.</span></div> : null}
            </div>
          </section>

          <aside className="token-inspector" aria-label="Selected token details">
            {selectedToken ? (
              <>
                <div className="inspector-title">
                  <span className="token-avatar">{selectedToken.imageUrl ? <img src={selectedToken.imageUrl} alt="" /> : selectedToken.symbol.slice(0, 1)}</span>
                  <div><p>{selectedToken.name}</p><h2>{selectedToken.symbol}</h2></div>
                  <span className={`signal-pill ${selectedToken.signal.toLowerCase()}`}>{selectedToken.signal}</span>
                </div>
                <div className="inspector-price"><strong>{formatPrice(selectedToken.price)}</strong><span className={selectedToken.change >= 0 ? "gain" : "loss"}>{selectedToken.change >= 0 ? "+" : ""}{selectedToken.change.toFixed(2)}%</span></div>
                <dl className="token-metrics">
                  <div><dt>Liquidity</dt><dd>{compactMoney(selectedToken.liquidity)}</dd></div>
                  <div><dt>Volume</dt><dd>{compactMoney(selectedToken.volume?.[timeframe.apiKey])}</dd></div>
                  <div><dt>Market cap</dt><dd>{compactMoney(selectedToken.marketCap)}</dd></div>
                  <div><dt>Buy pressure</dt><dd>{selectedToken.buyPressure}%</dd></div>
                  <div><dt>Pair age</dt><dd>{formatAge(selectedToken.age)}</dd></div>
                  <div><dt>Score</dt><dd>{selectedToken.score}/100</dd></div>
                </dl>
                <div className="inspector-actions">
                  <a className="trade-primary" href={photonUrl} target="_blank" rel="noreferrer"><Zap size={17} /> Trade on Photon <ChevronRight size={16} /></a>
                  <a className="trade-secondary" href={selectedToken.dexUrl} target="_blank" rel="noreferrer">View on DexScreener <ExternalLink size={14} /></a>
                </div>
                <p className="contract-address">{selectedToken.address}</p>
              </>
            ) : <div className="no-selection"><Gauge size={28} /><strong>Select a live pair</strong></div>}
          </aside>
        </div>
      </section>

      <section className="lower-grid">
        <section className="new-pairs-panel" id="new-pairs">
          <div className="panel-heading"><div><p className="desk-kicker">Discovered this hour</p><h2>New pairs</h2></div><span>{newPairs.length} found</span></div>
          <div className="new-pair-list">
            {newPairs.map((token) => (
              <button type="button" key={token.address} onClick={() => { setSelectedAddress(token.address); document.querySelector("#scanner")?.scrollIntoView(); }}>
                <span><strong>{token.symbol}</strong><small>{formatAge(token.age)} old</small></span><span>{compactMoney(token.liquidity)} liq</span><ChevronRight size={16} />
              </button>
            ))}
            {!newPairs.length ? <p>No qualifying pairs were created in the last hour.</p> : null}
          </div>
        </section>

        <section className="automation-panel" id="automation">
          <div className="panel-heading"><div><p className="desk-kicker">Execution guard</p><h2>Automation</h2></div><ShieldCheck size={22} /></div>
          <div className="automation-status"><span><Bot size={20} /><span><strong>{autoTrade ? "Armed" : "Inactive"}</strong><small>{autoTrade ? "Wallet approval still required" : "Enable after connecting Phantom"}</small></span></span><label className="switch"><input type="checkbox" checked={autoTrade} disabled={!wallet.connected} onChange={(event) => setAutoTrade(event.target.checked)} /><i /></label></div>
          <p>Signals never submit a transaction silently. Phantom remains the final approval step for every live trade.</p>
          <div className="order-controls">
            <label>Order size <span>{order.sizeSol.toFixed(2)} SOL</span><input type="range" min="0.01" max="1" step="0.01" value={order.sizeSol} onChange={(event) => setOrder((current) => ({ ...current, sizeSol: Number(event.target.value) }))} /></label>
            <label>Take profit <span>{order.takeProfitPercent}%</span><input type="range" min="5" max="100" value={order.takeProfitPercent} onChange={(event) => setOrder((current) => ({ ...current, takeProfitPercent: Number(event.target.value) }))} /></label>
            <label>Stop loss <span>{order.stopLossPercent}%</span><input type="range" min="3" max="40" value={order.stopLossPercent} onChange={(event) => setOrder((current) => ({ ...current, stopLossPercent: Number(event.target.value) }))} /></label>
          </div>
          <div className={`route-status ${routeState.error ? "error" : ""}`}><span>Photon route</span><strong>{routeState.status}</strong></div>
          {routeState.error ? <p className="route-error">{routeState.error}</p> : null}
          <button type="button" className="route-button" disabled={!wallet.connected || !selectedToken || routeState.status === "Preparing"} onClick={preparePhotonRoute}><Zap size={17} />{routeState.status === "Preparing" ? "Preparing route" : "Prepare Photon route"}</button>
          <button type="button" className="execute-button" disabled={!autoTrade || !(routeState.route?.transactionMessage || routeState.route?.transactionBase58)} onClick={signAndSendTrade}><ShieldCheck size={17} />Sign and send with Phantom</button>
          <button type="button" className="automation-wallet" onClick={connectPhantom}><Wallet size={17} />{wallet.connected ? `Connected ${shortKey(wallet.publicKey)}` : "Connect Phantom to arm"}</button>
        </section>
      </section>
    </main>
  );
}

export default App;
