import { useEffect, useMemo, useState } from "react";

const initialCriteria = {
  minLiquidity: 80000,
  maxAge: 45,
  maxTopHolders: 32,
  minVolume: 160000,
  minBuyPressure: 58,
  requireMintRevoked: true,
  requireLpLocked: true,
};

const tokens = [
  {
    symbol: "NOVA",
    name: "Nova Cat",
    address: "4nVx...91Qp",
    age: 11,
    liquidity: 142000,
    volume: 391000,
    holders: 1180,
    topHolders: 24,
    buyPressure: 72,
    mintRevoked: true,
    lpLocked: true,
    price: 0.000041,
    spread: 0.9,
    risk: "Medium",
    trend: "+36%",
  },
  {
    symbol: "FUSE",
    name: "Fuse Runner",
    address: "6fUz...p7Ke",
    age: 28,
    liquidity: 93000,
    volume: 218000,
    holders: 694,
    topHolders: 29,
    buyPressure: 63,
    mintRevoked: true,
    lpLocked: true,
    price: 0.000019,
    spread: 1.4,
    risk: "Medium",
    trend: "+19%",
  },
  {
    symbol: "BOLT",
    name: "Bolt AI",
    address: "9BoL...r2Lt",
    age: 7,
    liquidity: 69000,
    volume: 492000,
    holders: 431,
    topHolders: 41,
    buyPressure: 81,
    mintRevoked: true,
    lpLocked: false,
    price: 0.000086,
    spread: 2.8,
    risk: "High",
    trend: "+61%",
  },
  {
    symbol: "MICA",
    name: "Mica Labs",
    address: "2Mic...9asT",
    age: 36,
    liquidity: 286000,
    volume: 311000,
    holders: 1960,
    topHolders: 18,
    buyPressure: 56,
    mintRevoked: true,
    lpLocked: true,
    price: 0.00013,
    spread: 0.6,
    risk: "Low",
    trend: "+8%",
  },
  {
    symbol: "RIFT",
    name: "Rift Dog",
    address: "8RiF...2doG",
    age: 52,
    liquidity: 121000,
    volume: 147000,
    holders: 874,
    topHolders: 27,
    buyPressure: 49,
    mintRevoked: false,
    lpLocked: true,
    price: 0.000027,
    spread: 1.1,
    risk: "High",
    trend: "-4%",
  },
];

const agents = [
  {
    name: "Scout",
    role: "Discovery",
    wallet: "Primary Phantom",
    maxBid: 0.18,
    needs: ["Fresh launch", "LP locked", "Buy pressure"],
    bias: "Fast entry",
  },
  {
    name: "Risk Desk",
    role: "Safety",
    wallet: "Vault wallet",
    maxBid: 0.08,
    needs: ["Holder spread", "Mint revoked", "Low spread"],
    bias: "Capital protection",
  },
  {
    name: "Momentum",
    role: "Execution",
    wallet: "Photon wallet",
    maxBid: 0.24,
    needs: ["Volume surge", "Trend strength", "Liquidity"],
    bias: "Breakout capture",
  },
];

const executionSteps = [
  "Scanner scores token against your rule set",
  "Agents submit bids with wallet, size, entry, stop, and target",
  "Risk gate rejects trades that break wallet or exposure limits",
  "Photon route is prepared for quote and slippage validation",
  "Phantom prompts the final signature before live execution",
  "Exit watcher trails gain target, stop loss, and emergency sell rules",
];

function getPhantomProvider() {
  if (typeof window === "undefined") return null;
  const provider = window.phantom?.solana || window.solana;
  return provider?.isPhantom ? provider : null;
}

function shortKey(value) {
  if (!value) return "";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function buildTradeIntent({ token, bid, walletLimit, profitTarget, stopLoss, mode, publicKey }) {
  return {
    mode,
    wallet: publicKey,
    token: {
      symbol: token.symbol,
      name: token.name,
      address: token.address,
      price: token.price,
      score: token.score,
      risk: token.risk,
    },
    order: {
      side: "buy",
      sizeSol: Number(Math.min(bid?.bid || 0, walletLimit).toFixed(4)),
      maxWalletExposureSol: walletLimit,
      entryPrice: token.price,
      takeProfitPercent: profitTarget,
      stopLossPercent: stopLoss,
      slippageBps: 120,
    },
    agent: bid
      ? {
          name: bid.name,
          confidence: bid.confidence,
          wallet: bid.wallet,
        }
      : null,
  };
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSol(value) {
  return `${value.toFixed(2)} SOL`;
}

function scoreToken(token, criteria) {
  const checks = [
    token.liquidity >= criteria.minLiquidity,
    token.age <= criteria.maxAge,
    token.topHolders <= criteria.maxTopHolders,
    token.volume >= criteria.minVolume,
    token.buyPressure >= criteria.minBuyPressure,
    !criteria.requireMintRevoked || token.mintRevoked,
    !criteria.requireLpLocked || token.lpLocked,
  ];
  const base = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  const momentumBoost = token.buyPressure > 70 ? 6 : token.buyPressure > 62 ? 3 : 0;
  const spreadPenalty = token.spread > 2 ? 7 : token.spread > 1.2 ? 3 : 0;
  return Math.max(0, Math.min(100, base + momentumBoost - spreadPenalty));
}

function getAgentBid(agent, token, score) {
  const riskPenalty = token.risk === "High" ? 0.42 : token.risk === "Medium" ? 0.16 : 0;
  const momentum = token.buyPressure / 100;
  const confidence = Math.max(0, Math.min(0.98, score / 100 + momentum * 0.18 - riskPenalty));
  const bid = confidence > 0.62 ? agent.maxBid * confidence : 0;
  const target = token.price * (1 + (agent.name === "Momentum" ? 0.38 : 0.24));
  const stop = token.price * (agent.name === "Risk Desk" ? 0.91 : 0.86);

  return {
    ...agent,
    confidence: Math.round(confidence * 100),
    bid,
    entry: token.price,
    target,
    stop,
    status: bid > 0 ? "Bid" : "Pass",
  };
}

function App() {
  const [criteria, setCriteria] = useState(initialCriteria);
  const [selectedSymbol, setSelectedSymbol] = useState("NOVA");
  const [mode, setMode] = useState("paper");
  const [walletLimit, setWalletLimit] = useState(0.35);
  const [profitTarget, setProfitTarget] = useState(28);
  const [stopLoss, setStopLoss] = useState(12);
  const [phantom, setPhantom] = useState({
    detected: false,
    connected: false,
    publicKey: "",
    status: "Not connected",
  });
  const [routeState, setRouteState] = useState({
    status: "Idle",
    configured: false,
    intentId: "",
    route: null,
    error: "",
  });
  const [automationLog, setAutomationLog] = useState([
    "Paper mode ready. Connect Phantom and prepare a Photon route before live execution.",
  ]);

  const scoredTokens = useMemo(
    () =>
      tokens
        .map((token) => ({ ...token, score: scoreToken(token, criteria) }))
        .sort((a, b) => b.score - a.score),
    [criteria],
  );

  const selectedToken = scoredTokens.find((token) => token.symbol === selectedSymbol) || scoredTokens[0];
  const bids = agents.map((agent) => getAgentBid(agent, selectedToken, selectedToken.score));
  const winningBid = bids.filter((bid) => bid.status === "Bid").sort((a, b) => b.confidence - a.confidence)[0];
  const approved = selectedToken.score >= 72 && winningBid && winningBid.bid <= walletLimit;
  const canPrepareRoute = approved && phantom.connected && winningBid;
  const routePrepared = Boolean(routeState.route?.transactionMessage || routeState.route?.transactionBase58);
  const canExecute = mode === "armed" && canPrepareRoute && routePrepared;

  useEffect(() => {
    const provider = getPhantomProvider();
    setPhantom((current) => ({
      ...current,
      detected: Boolean(provider),
      connected: Boolean(provider?.isConnected && provider?.publicKey),
      publicKey: provider?.publicKey?.toString?.() || current.publicKey,
      status: provider ? "Phantom detected" : "Install Phantom to connect",
    }));

    if (!provider) return undefined;

    provider.connect?.({ onlyIfTrusted: true }).catch(() => {});
    const handleConnect = (publicKey) => {
      const key = publicKey?.toString?.() || provider.publicKey?.toString?.() || "";
      setPhantom({ detected: true, connected: true, publicKey: key, status: "Connected" });
      appendLog(`Phantom connected: ${shortKey(key)}`);
    };
    const handleDisconnect = () => {
      setPhantom({ detected: true, connected: false, publicKey: "", status: "Disconnected" });
      appendLog("Phantom disconnected.");
    };
    const handleAccountChanged = (publicKey) => {
      const key = publicKey?.toString?.() || "";
      setPhantom((current) => ({ ...current, connected: Boolean(key), publicKey: key, status: key ? "Account changed" : "Reconnect required" }));
      appendLog(key ? `Phantom account changed: ${shortKey(key)}` : "Phantom account removed. Reconnect required.");
    };

    provider.on?.("connect", handleConnect);
    provider.on?.("disconnect", handleDisconnect);
    provider.on?.("accountChanged", handleAccountChanged);

    return () => {
      provider.off?.("connect", handleConnect);
      provider.off?.("disconnect", handleDisconnect);
      provider.off?.("accountChanged", handleAccountChanged);
    };
  }, []);

  function updateCriteria(key, value) {
    setCriteria((current) => ({ ...current, [key]: value }));
  }

  function appendLog(message) {
    setAutomationLog((current) => [message, ...current].slice(0, 6));
  }

  async function connectPhantom() {
    const provider = getPhantomProvider();
    if (!provider) {
      setPhantom({ detected: false, connected: false, publicKey: "", status: "Phantom extension not found" });
      appendLog("Phantom extension not found in this browser.");
      return;
    }

    try {
      const response = await provider.connect();
      const publicKey = response.publicKey?.toString?.() || provider.publicKey?.toString?.() || "";
      setPhantom({ detected: true, connected: true, publicKey, status: "Connected" });
      appendLog(`Phantom connected: ${shortKey(publicKey)}`);
    } catch (error) {
      setPhantom((current) => ({ ...current, status: "Connection rejected" }));
      appendLog(error?.message || "Phantom connection rejected.");
    }
  }

  async function preparePhotonRoute() {
    if (!canPrepareRoute) {
      appendLog("Route blocked: wallet, winning bid, or risk gate is not ready.");
      return;
    }

    const intent = buildTradeIntent({
      token: selectedToken,
      bid: winningBid,
      walletLimit,
      profitTarget,
      stopLoss,
      mode,
      publicKey: phantom.publicKey,
    });

    setRouteState((current) => ({ ...current, status: "Preparing", error: "" }));
    appendLog(`Preparing Photon route for ${selectedToken.symbol} via ${winningBid.name}.`);

    try {
      const intentResponse = await fetch("/api/trade/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
      });
      const intentResult = await intentResponse.json();
      if (!intentResponse.ok) throw new Error(intentResult.error || "Trade intent rejected.");

      const routeResponse = await fetch("/api/photon/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...intent, intentId: intentResult.intentId }),
      });
      const routeResult = await routeResponse.json();
      if (!routeResponse.ok) throw new Error(routeResult.error || "Photon route failed.");

      setRouteState({
        status: routeResult.configured ? "Ready" : "Simulation",
        configured: Boolean(routeResult.configured),
        intentId: intentResult.intentId,
        route: routeResult.route,
        error: "",
      });
      appendLog(routeResult.configured ? "Photon route ready for Phantom signature." : "Photon endpoint not configured. Simulation route prepared.");
    } catch (error) {
      setRouteState({ status: "Error", configured: false, intentId: "", route: null, error: error.message });
      appendLog(error.message);
    }
  }

  async function executePreparedTrade() {
    if (!canExecute) {
      appendLog("Execution blocked: armed mode, Phantom, and prepared route are required.");
      return;
    }

    const provider = getPhantomProvider();
    if (!provider) {
      appendLog("Execution blocked: Phantom provider is unavailable.");
      return;
    }

    const message = routeState.route.transactionMessage || routeState.route.transactionBase58;
    try {
      appendLog("Requesting Phantom signature. Review the wallet prompt before approving.");
      const result = await provider.request({
        method: "signAndSendTransaction",
        params: {
          message,
          options: {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          },
        },
      });
      appendLog(`Trade submitted: ${shortKey(result.signature || "")}`);
      setRouteState((current) => ({ ...current, status: "Submitted" }));
    } catch (error) {
      appendLog(error?.message || "Phantom signature was rejected.");
    }
  }

  return (
    <main className="trade-shell">
      <header className="topbar">
        <a className="brand" href="#console" aria-label="73inc Trading Desk home">
          <span className="brand-mark">73</span>
          <span>
            <strong>73inc Trading Desk</strong>
            <small>Solana execution console</small>
          </span>
        </a>
        <nav className="nav-links" aria-label="Primary navigation">
          <a href="#scanner">Scanner</a>
          <a href="#agents">Agents</a>
          <a href="#wallet">Wallet</a>
          <a href="#execution">Execution</a>
        </nav>
        <div className="mode-toggle" aria-label="Trading mode">
          <button className={mode === "paper" ? "active" : ""} onClick={() => setMode("paper")}>Paper</button>
          <button className={mode === "armed" ? "active" : ""} onClick={() => setMode("armed")}>Armed</button>
        </div>
      </header>

      <section className="hero" id="console">
        <div>
          <p className="eyebrow">73inc — Auckland, New Zealand</p>
          <h1>Automated trading desk for Solana agent execution.</h1>
          <p className="lede">
            Configure token filters, let specialist agents bid for entries, then route approved trades through a guarded Phantom and Photon execution flow.
          </p>
        </div>
        <div className="hero-panel" aria-label="Current route summary">
          <span className={`status ${approved ? "ok" : "hold"}`}>{approved ? "Approved" : "Waiting"}</span>
          <strong>{selectedToken.symbol}</strong>
          <small>{selectedToken.name}</small>
          <div className="route-line">
            <span>Entry</span>
            <b>${selectedToken.price.toFixed(6)}</b>
          </div>
          <div className="route-line">
            <span>Target</span>
            <b>{profitTarget}%</b>
          </div>
          <div className="route-line">
            <span>Stop</span>
            <b>{stopLoss}%</b>
          </div>
        </div>
      </section>

      <section className="console-grid">
        <aside className="control-panel" id="scanner">
          <div className="section-heading">
            <p className="eyebrow">Scanner rules</p>
            <h2>Token criteria</h2>
          </div>

          <label>
            Minimum liquidity
            <input type="number" value={criteria.minLiquidity} onChange={(event) => updateCriteria("minLiquidity", Number(event.target.value))} />
          </label>
          <label>
            Maximum age, minutes
            <input type="number" value={criteria.maxAge} onChange={(event) => updateCriteria("maxAge", Number(event.target.value))} />
          </label>
          <label>
            Max top-holder concentration
            <input type="number" value={criteria.maxTopHolders} onChange={(event) => updateCriteria("maxTopHolders", Number(event.target.value))} />
          </label>
          <label>
            Minimum 1h volume
            <input type="number" value={criteria.minVolume} onChange={(event) => updateCriteria("minVolume", Number(event.target.value))} />
          </label>
          <label>
            Minimum buy pressure
            <input type="range" min="35" max="90" value={criteria.minBuyPressure} onChange={(event) => updateCriteria("minBuyPressure", Number(event.target.value))} />
            <span>{criteria.minBuyPressure}%</span>
          </label>

          <div className="checks">
            <label>
              <input type="checkbox" checked={criteria.requireMintRevoked} onChange={(event) => updateCriteria("requireMintRevoked", event.target.checked)} />
              Mint authority revoked
            </label>
            <label>
              <input type="checkbox" checked={criteria.requireLpLocked} onChange={(event) => updateCriteria("requireLpLocked", event.target.checked)} />
              LP locked
            </label>
          </div>
        </aside>

        <section className="scanner-board">
          <div className="section-heading">
            <p className="eyebrow">Live candidates</p>
            <h2>Scanner queue</h2>
          </div>
          <div className="token-list">
            {scoredTokens.map((token) => (
              <button
                className={`token-row ${selectedToken.symbol === token.symbol ? "selected" : ""}`}
                key={token.symbol}
                onClick={() => setSelectedSymbol(token.symbol)}
              >
                <span>
                  <b>{token.symbol}</b>
                  <small>{token.address}</small>
                </span>
                <span>{formatMoney(token.liquidity)}</span>
                <span>{token.age}m</span>
                <span>{token.buyPressure}% buys</span>
                <strong>{token.score}</strong>
              </button>
            ))}
          </div>
        </section>

        <section className="decision-panel">
          <div className="section-heading">
            <p className="eyebrow">Selected token</p>
            <h2>{selectedToken.name}</h2>
          </div>
          <div className="metrics">
            <div><span>Score</span><b>{selectedToken.score}/100</b></div>
            <div><span>Liquidity</span><b>{formatMoney(selectedToken.liquidity)}</b></div>
            <div><span>Volume</span><b>{formatMoney(selectedToken.volume)}</b></div>
            <div><span>Spread</span><b>{selectedToken.spread}%</b></div>
            <div><span>Holders</span><b>{selectedToken.holders}</b></div>
            <div><span>Trend</span><b>{selectedToken.trend}</b></div>
          </div>
          <div className="risk-bar">
            <span>Risk gate</span>
            <strong className={approved ? "pass" : "fail"}>{approved ? "Pass" : "Review"}</strong>
          </div>
        </section>
      </section>

      <section className="agents-section" id="agents">
        <div className="section-heading">
          <p className="eyebrow">Competitive bidding</p>
          <h2>AI agent desk</h2>
        </div>
        <div className="agent-grid">
          {bids.map((bid) => (
            <article className={bid.status === "Bid" ? "agent-card active" : "agent-card"} key={bid.name}>
              <div className="agent-top">
                <span>{bid.role}</span>
                <strong>{bid.status}</strong>
              </div>
              <h3>{bid.name}</h3>
              <p>{bid.bias}</p>
              <div className="bid-line"><span>Confidence</span><b>{bid.confidence}%</b></div>
              <div className="bid-line"><span>Bid size</span><b>{formatSol(bid.bid)}</b></div>
              <div className="bid-line"><span>Wallet</span><b>{bid.wallet}</b></div>
              <div className="agent-needs">
                {bid.needs.map((need) => <span key={need}>{need}</span>)}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="execution-grid" id="execution">
        <div className="execution-panel" id="wallet">
          <div className="section-heading">
            <p className="eyebrow">Wallet connection</p>
            <h2>Phantom and Photon</h2>
          </div>
          <div className="connection-stack">
            <div className="connection-row">
              <span>Phantom</span>
              <strong>{phantom.connected ? shortKey(phantom.publicKey) : phantom.status}</strong>
            </div>
            <div className="connection-row">
              <span>Photon route</span>
              <strong>{routeState.status}</strong>
            </div>
            <div className="connection-row">
              <span>Intent</span>
              <strong>{routeState.intentId ? shortKey(routeState.intentId) : "None"}</strong>
            </div>
          </div>
          <div className="action-row">
            <button className="secondary-action" type="button" onClick={connectPhantom}>
              {phantom.connected ? "Reconnect Phantom" : "Connect Phantom"}
            </button>
            <button className="secondary-action" type="button" disabled={!canPrepareRoute} onClick={preparePhotonRoute}>
              Prepare Photon route
            </button>
          </div>
          {routeState.error ? <p className="error-note">{routeState.error}</p> : null}
        </div>

        <div className="execution-panel">
          <div className="section-heading">
            <p className="eyebrow">Order controls</p>
            <h2>Wallet and exits</h2>
          </div>
          <label>
            Max wallet exposure
            <input type="range" min="0.05" max="1" step="0.01" value={walletLimit} onChange={(event) => setWalletLimit(Number(event.target.value))} />
            <span>{formatSol(walletLimit)}</span>
          </label>
          <label>
            Take profit
            <input type="range" min="5" max="100" value={profitTarget} onChange={(event) => setProfitTarget(Number(event.target.value))} />
            <span>{profitTarget}%</span>
          </label>
          <label>
            Stop loss
            <input type="range" min="3" max="40" value={stopLoss} onChange={(event) => setStopLoss(Number(event.target.value))} />
            <span>{stopLoss}%</span>
          </label>
          <button className="primary-action" disabled={!canExecute} onClick={executePreparedTrade}>
            {canExecute ? "Sign and send with Phantom" : "Connect, route, then arm"}
          </button>
        </div>

        <div className="execution-panel">
          <div className="section-heading">
            <p className="eyebrow">Automation path</p>
            <h2>Execution pipeline</h2>
          </div>
          <ol className="steps">
            {executionSteps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <div className="adapter-note">
            <strong>Integration note</strong>
            <p>
              Phantom connection and signing are wired through the injected Solana provider. Photon execution is routed through a Netlify Function that expects a configured Photon endpoint to return a signable Solana transaction message.
            </p>
          </div>
          <div className="log-panel">
            <strong>Automation log</strong>
            {automationLog.map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
