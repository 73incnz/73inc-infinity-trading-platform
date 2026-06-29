const DEXSCREENER_API = "https://api.dexscreener.com";

async function getJson(path) {
  const response = await fetch(`${DEXSCREENER_API}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "73inc-trading-desk/1.0" },
  });

  if (!response.ok) {
    throw new Error(`DexScreener returned ${response.status} for ${path}`);
  }

  return response.json();
}

function uniqueSolanaAddresses(groups) {
  return [...new Set(
    groups
      .flat()
      .filter((item) => item?.chainId === "solana" && item?.tokenAddress)
      .map((item) => item.tokenAddress),
  )].slice(0, 30);
}

function bestPairByToken(pairs) {
  const selected = new Map();

  for (const pair of pairs) {
    const address = pair?.baseToken?.address;
    if (!address || pair.chainId !== "solana") continue;
    const current = selected.get(address);
    if (!current || Number(pair.liquidity?.usd || 0) > Number(current.liquidity?.usd || 0)) {
      selected.set(address, pair);
    }
  }

  return [...selected.values()];
}

export default async (request) => {
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const [profiles, latestBoosts, topBoosts] = await Promise.all([
      getJson("/token-profiles/latest/v1"),
      getJson("/token-boosts/latest/v1"),
      getJson("/token-boosts/top/v1"),
    ]);
    const addresses = uniqueSolanaAddresses([profiles, latestBoosts, topBoosts]);

    if (!addresses.length) {
      return Response.json(
        { tokens: [], scannedAt: new Date().toISOString(), source: "DexScreener" },
        { headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const pairs = await getJson(`/tokens/v1/solana/${addresses.join(",")}`);
    const profileMap = new Map(
      [...profiles, ...latestBoosts, ...topBoosts]
        .filter((item) => item?.chainId === "solana")
        .map((item) => [item.tokenAddress, item]),
    );

    const tokens = bestPairByToken(pairs)
      .map((pair) => {
        const buys = Number(pair.txns?.h1?.buys || 0);
        const sells = Number(pair.txns?.h1?.sells || 0);
        const profile = profileMap.get(pair.baseToken.address) || {};
        return {
          address: pair.baseToken.address,
          pairAddress: pair.pairAddress,
          symbol: pair.baseToken.symbol || "UNKNOWN",
          name: pair.baseToken.name || "Unknown token",
          dexId: pair.dexId || "unknown",
          url: pair.url,
          imageUrl: pair.info?.imageUrl || profile.icon || "",
          priceUsd: Number(pair.priceUsd || 0),
          liquidityUsd: Number(pair.liquidity?.usd || 0),
          marketCap: Number(pair.marketCap || pair.fdv || 0),
          pairCreatedAt: Number(pair.pairCreatedAt || 0),
          boosts: Number(pair.boosts?.active || profile.amount || 0),
          transactions: pair.txns || {},
          volume: pair.volume || {},
          priceChange: pair.priceChange || {},
          buyPressure: buys + sells > 0 ? Math.round((buys / (buys + sells)) * 100) : 0,
          socials: pair.info?.socials || [],
        };
      })
      .sort((a, b) => b.pairCreatedAt - a.pairCreatedAt);

    return Response.json(
      { tokens, scannedAt: new Date().toISOString(), source: "DexScreener" },
      {
        headers: {
          "Cache-Control": "public, max-age=15, stale-while-revalidate=30",
          "Netlify-CDN-Cache-Control": "public, durable, s-maxage=15, stale-while-revalidate=30",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (error) {
    return Response.json(
      { error: "DexScreener scan failed", details: error.message },
      { status: 502, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } },
    );
  }
};

export const config = {
  path: "/api/dexscreener/scan",
};
