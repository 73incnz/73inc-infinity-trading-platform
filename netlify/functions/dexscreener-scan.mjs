const DEXSCREENER_API = "https://api.dexscreener.com";
const RUGCHECK_API = "https://api.rugcheck.xyz/v1";

async function getJson(url, timeoutMs = 12000) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "73inc-infinity-project/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  return response.json();
}

function chunks(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

async function mapLimited(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

function collectAddresses(groups) {
  return [...new Set(groups.flat()
    .filter((item) => item?.chainId === "solana" && item?.tokenAddress)
    .map((item) => item.tokenAddress))]
    .slice(0, 120);
}

function bestPairByToken(pairs) {
  const selected = new Map();
  for (const pair of pairs.flat()) {
    const address = pair?.baseToken?.address;
    if (!address || pair.chainId !== "solana") continue;
    const current = selected.get(address);
    if (!current || Number(pair.liquidity?.usd || 0) > Number(current.liquidity?.usd || 0)) selected.set(address, pair);
  }
  return [...selected.values()];
}

function profileLinks(pair, profile = {}) {
  const links = [
    ...(profile.links || []),
    ...(pair.info?.websites || []).map((item) => ({ type: "website", url: item.url })),
    ...(pair.info?.socials || []).map((item) => ({ type: item.type || item.platform, url: item.url || item.handle })),
  ].filter((item) => item?.url);
  return [...new Map(links.map((item) => [item.url, item])).values()].slice(0, 8);
}

function normalizeRisk(report) {
  if (!report) return { checked: false, eligible: false, score: 0, level: "unknown", risks: [], lpLockedPct: 0 };
  const normalizedRisk = Number(report.score_normalised ?? Math.min(100, Number(report.score || 0) / 100));
  const risks = (report.risks || []).slice(0, 8).map((risk) => ({
    name: risk.name,
    level: risk.level || "warn",
    description: risk.description || "",
  }));
  const dangerCount = risks.filter((risk) => risk.level === "danger").length;
  const level = dangerCount ? "danger" : risks.some((risk) => risk.level === "warn") ? "caution" : "clear";
  const score = Math.round(Math.max(0, Math.min(100, 100 - normalizedRisk)));
  return {
    checked: true,
    eligible: score >= 70 && dangerCount === 0,
    score,
    level,
    risks,
    lpLockedPct: Number(report.lpLockedPct || 0),
  };
}

function socialScore(links) {
  const types = links.map((item) => `${item.type || ""} ${item.url}`.toLowerCase());
  const hasX = types.some((value) => value.includes("twitter") || value.includes("x.com"));
  const hasWebsite = types.some((value) => value.includes("website") || (!value.includes("twitter") && !value.includes("telegram")));
  const hasTelegram = types.some((value) => value.includes("telegram") || value.includes("t.me"));
  return { hasX, hasWebsite, hasTelegram, score: hasX ? (hasWebsite ? (hasTelegram ? 100 : 82) : 68) : hasWebsite ? 42 : hasTelegram ? 28 : 0 };
}

function marketScore(pair, risk, links) {
  const liquidity = Number(pair.liquidity?.usd || 0);
  const volume = Number(pair.volume?.h24 || 0);
  const tx = pair.txns?.h1 || {};
  const activity = Number(tx.buys || 0) + Number(tx.sells || 0);
  const buyPressure = activity ? Number(tx.buys || 0) / activity : 0;
  const momentum = Number(pair.priceChange?.h24 || 0);
  const social = socialScore(links);
  const score =
    Math.min(18, liquidity / 10000) +
    Math.min(16, volume / 20000) +
    Math.min(14, activity / 35) +
    Math.min(10, buyPressure * 12) +
    Math.max(0, Math.min(10, (momentum + 10) / 4)) +
    social.score * 0.08 +
    risk.score * 0.24;
  return Math.round(Math.max(0, Math.min(100, score)));
}

export default async (request) => {
  if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });

  try {
    const paths = [
      "/token-profiles/latest/v1",
      "/token-boosts/latest/v1",
      "/token-boosts/top/v1",
      "/community-takeovers/latest/v1",
    ];
    const groups = await Promise.all(paths.map((path) => getJson(`${DEXSCREENER_API}${path}`)));
    const addresses = collectAddresses(groups);
    const pairGroups = await Promise.all(chunks(addresses, 30).map((batch) => getJson(`${DEXSCREENER_API}/tokens/v1/solana/${batch.join(",")}`)));
    const profileMap = new Map(groups.flat().filter((item) => item?.tokenAddress).map((item) => [item.tokenAddress, item]));
    const pairs = bestPairByToken(pairGroups)
      .filter((pair) => Number(pair.liquidity?.usd || 0) >= 1000)
      .sort((a, b) => Number(b.volume?.h24 || 0) - Number(a.volume?.h24 || 0))
      .slice(0, 70);

    const reports = await mapLimited(pairs, 10, async (pair) => {
      try {
        return await getJson(`${RUGCHECK_API}/tokens/${pair.baseToken.address}/report/summary`, 10000);
      } catch {
        return null;
      }
    });

    const tokens = pairs.map((pair, index) => {
      const address = pair.baseToken.address;
      const profile = profileMap.get(address) || {};
      const links = profileLinks(pair, profile);
      const risk = normalizeRisk(reports[index]);
      const socials = socialScore(links);
      const h1 = pair.txns?.h1 || {};
      const buys = Number(h1.buys || 0);
      const sells = Number(h1.sells || 0);
      const isPump = pair.dexId === "pumpswap" || address.toLowerCase().endsWith("pump") || pair.labels?.some((label) => `${label}`.toLowerCase().includes("pump"));
      return {
        address,
        pairAddress: pair.pairAddress,
        symbol: pair.baseToken.symbol || "UNKNOWN",
        name: pair.baseToken.name || "Unknown token",
        dexId: pair.dexId || "unknown",
        url: pair.url,
        dextoolsUrl: `https://www.dextools.io/app/en/solana/pair-explorer/${pair.pairAddress}`,
        rugcheckUrl: `https://rugcheck.xyz/tokens/${address}`,
        photonUrl: `https://photon-sol.tinyastro.io/en/lp/${pair.pairAddress}`,
        imageUrl: pair.info?.imageUrl || profile.icon || "",
        priceUsd: Number(pair.priceUsd || 0),
        liquidityUsd: Number(pair.liquidity?.usd || 0),
        marketCap: Number(pair.marketCap || pair.fdv || 0),
        pairCreatedAt: Number(pair.pairCreatedAt || 0),
        boosts: Number(pair.boosts?.active || profile.amount || 0),
        transactions: pair.txns || {},
        volume: pair.volume || {},
        priceChange: pair.priceChange || {},
        buyPressure: buys + sells ? Math.round((buys / (buys + sells)) * 100) : 0,
        links,
        socials,
        risk,
        isPump,
        score: marketScore(pair, risk, links),
      };
    }).sort((a, b) => b.score - a.score);

    return Response.json({
      tokens,
      scannedAt: new Date().toISOString(),
      sources: ["DexScreener", "RugCheck"],
      notes: { longWindowData: "3d and 7d ranks use available 24h momentum as a conservative proxy." },
    }, { headers: { "Cache-Control": "public, max-age=20, stale-while-revalidate=40", "Netlify-CDN-Cache-Control": "public, durable, s-maxage=20, stale-while-revalidate=40" } });
  } catch (error) {
    return Response.json({ error: "Market scan failed", details: error.message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
};

export const config = { path: "/api/dexscreener/scan" };
