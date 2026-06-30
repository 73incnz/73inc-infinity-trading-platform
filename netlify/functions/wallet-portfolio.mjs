const RPC_URL = Netlify.env.get("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com";
const DEXSCREENER_API = "https://api.dexscreener.com";
const JUPITER_QUOTE_API = "https://lite-api.jup.ag/swap/v1/quote";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

async function rpc(method, params = [], timeoutMs = 15000) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `RPC ${method} failed with ${response.status}`);
  }
  return payload.result;
}

async function getJson(url, timeoutMs = 15000) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "73inc-infinity-project/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `${new URL(url).hostname} returned ${response.status}`);
  }
  return payload;
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function bestPairsByMint(groups) {
  const selected = new Map();
  for (const pair of groups.flat()) {
    const mint = pair?.baseToken?.address;
    if (!mint || pair.chainId !== "solana") continue;
    const current = selected.get(mint);
    if (!current || Number(pair.liquidity?.usd || 0) > Number(current.liquidity?.usd || 0)) selected.set(mint, pair);
  }
  return selected;
}

async function fetchSolPriceUsd() {
  try {
    const quote = await getJson(`${JUPITER_QUOTE_API}?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}&amount=1000000000&slippageBps=100`, 10000);
    return Number(quote.outAmount || 0) / 1e6;
  } catch {
    return 0;
  }
}

async function fetchMintPrices(mints) {
  const priceMap = new Map();
  const batches = chunk(mints.filter(Boolean).slice(0, 60), 30);
  for (const batch of batches) {
    try {
      const pairs = await getJson(`${DEXSCREENER_API}/tokens/v1/solana/${batch.join(",")}`, 15000);
      for (const pair of pairs) {
        const mint = pair?.baseToken?.address;
        if (!mint || pair.chainId !== "solana") continue;
        const current = priceMap.get(mint);
        if (!current || Number(pair.liquidity?.usd || 0) > Number(current.liquidityUsd || 0)) {
          priceMap.set(mint, {
            mint,
            symbol: pair.baseToken?.symbol || mint.slice(0, 4),
            name: pair.baseToken?.name || mint,
            priceUsd: Number(pair.priceUsd || 0),
            liquidityUsd: Number(pair.liquidity?.usd || 0),
            imageUrl: pair.info?.imageUrl || pair.info?.icon || "",
            url: pair.url || "",
          });
        }
      }
    } catch {
      // Partial pricing is acceptable; the UI will still show the wallet snapshot and any priced holdings.
    }
  }
  return priceMap;
}

function addAccount(holdings, mint, amount, decimals) {
  if (!mint || !amount || amount <= 0n) return;
  const current = holdings.get(mint) || { mint, balance: 0, rawAmount: 0n, decimals: decimals || 0 };
  current.balance += Number(amount) / 10 ** Number(decimals || 0);
  current.rawAmount += amount;
  current.decimals = decimals || current.decimals || 0;
  holdings.set(mint, current);
}

export default async (request) => {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const wallet = String(new URL(request.url).searchParams.get("wallet") || "").trim();
  if (!wallet) return json({ error: "Wallet address is required." }, 422);

  const errors = [];
  const tokenAccounts = new Map();
  let solBalanceLamports = 0n;

  try {
    const [balance, accountResults] = await Promise.all([
      rpc("getBalance", [wallet, { commitment: "confirmed" }]),
      Promise.allSettled(TOKEN_PROGRAMS.map((programId) => rpc("getTokenAccountsByOwner", [wallet, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }]))),
    ]);

    solBalanceLamports = BigInt(balance?.value || 0);

    for (const result of accountResults) {
      if (result.status !== "fulfilled") {
        errors.push(result.reason?.message || "Token account lookup failed.");
        continue;
      }

      for (const item of result.value?.value || []) {
        const info = item?.account?.data?.parsed?.info;
        const tokenAmount = info?.tokenAmount || {};
        const mint = info?.mint;
        const amount = BigInt(tokenAmount.amount || "0");
        if (!mint || amount <= 0n) continue;
        addAccount(tokenAccounts, mint, amount, tokenAmount.decimals || 0);
      }
    }
  } catch (error) {
    errors.push(error.message || "RPC wallet lookup failed.");
  }

  const solBalance = Number(solBalanceLamports) / 1e9;
  let solPriceUsd = 0;
  try {
    solPriceUsd = await fetchSolPriceUsd();
  } catch (error) {
    errors.push(error.message || "SOL price lookup failed.");
  }

  const pricedMints = [...tokenAccounts.keys()].filter((mint) => mint !== SOL_MINT);
  const prices = await fetchMintPrices(pricedMints);
  const holdings = [
    {
      mint: SOL_MINT,
      symbol: "SOL",
      name: "Solana",
      balance: solBalance,
      rawAmount: solBalanceLamports.toString(),
      decimals: 9,
      priceUsd: solPriceUsd,
      valueUsd: solBalance * solPriceUsd,
      imageUrl: "",
      url: "https://solana.com",
      source: "Jupiter",
    },
    ...[...tokenAccounts.values()].map((holding) => {
      const price = prices.get(holding.mint) || {};
      const priceUsd = Number(price.priceUsd || 0);
      return {
        mint: holding.mint,
        symbol: price.symbol || holding.mint.slice(0, 4),
        name: price.name || holding.mint,
        balance: holding.balance,
        rawAmount: holding.rawAmount.toString(),
        decimals: holding.decimals,
        priceUsd,
        valueUsd: holding.balance * priceUsd,
        imageUrl: price.imageUrl || "",
        url: price.url || `https://dexscreener.com/solana/${holding.mint}`,
        source: price.priceUsd ? "DexScreener" : "RPC",
      };
    }),
  ].filter((holding) => holding.balance > 0 && Number.isFinite(holding.balance))
    .sort((a, b) => Number(b.valueUsd || 0) - Number(a.valueUsd || 0));

  const portfolioUsd = holdings.reduce((sum, holding) => sum + Number(holding.valueUsd || 0), 0);

  return json({
    wallet,
    solBalance,
    solBalanceLamports: solBalanceLamports.toString(),
    solPriceUsd,
    portfolioUsd,
    holdings: holdings.slice(0, 30),
    updatedAt: new Date().toISOString(),
    notes: errors.length ? errors.slice(0, 4) : ["Live wallet snapshot loaded."],
  });
};

export const config = { path: "/api/wallet/portfolio" };
