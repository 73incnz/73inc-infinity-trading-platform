function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function isPositiveIntegerLike(value) {
  try {
    return BigInt(String(value)) > 0n;
  } catch {
    return false;
  }
}

async function getJson(url, timeoutMs = 15000, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "73inc-infinity-project/1.0",
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || payload.message || `${new URL(url).hostname} returned ${response.status}`);
  }
  return payload;
}

export default async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const wallet = String(body?.wallet || "").trim();
  const inputMint = String(body?.inputMint || "").trim();
  const outputMint = String(body?.outputMint || "").trim();
  const slippageBps = Number.isFinite(Number(body?.slippageBps)) ? Math.max(1, Math.min(1000, Number(body.slippageBps))) : 100;
  const amountRaw = body?.amountRaw;

  if (!wallet || !inputMint || !outputMint || !isPositiveIntegerLike(amountRaw)) {
    return json({ error: "Wallet, mints, and a positive raw amount are required." }, 422);
  }

  const amount = String(amountRaw);
  const quoteUrl = new URL("https://lite-api.jup.ag/swap/v1/quote");
  quoteUrl.searchParams.set("inputMint", inputMint);
  quoteUrl.searchParams.set("outputMint", outputMint);
  quoteUrl.searchParams.set("amount", amount);
  quoteUrl.searchParams.set("slippageBps", String(slippageBps));

  try {
    const quote = await getJson(quoteUrl.toString());
    const swap = await getJson("https://lite-api.jup.ag/swap/v1/swap", 20000, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto",
      }),
    });

    return json({
      quote,
      swapTransaction: swap.swapTransaction,
      lastValidBlockHeight: swap.lastValidBlockHeight,
      prioritizationFeeLamports: swap.prioritizationFeeLamports,
      computeUnitLimit: swap.computeUnitLimit,
      signatureFeeLamports: swap.signatureFeeLamports,
    });
  } catch (error) {
    return json({ error: error.message || "Jupiter swap preparation failed." }, 502);
  }
};

export const config = { path: "/api/jupiter/swap" };
