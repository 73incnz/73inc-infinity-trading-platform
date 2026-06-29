function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function requestPhotonRoute(intent) {
  const endpoint = Netlify.env.get("PHOTON_ROUTE_URL");
  const apiKey = Netlify.env.get("PHOTON_API_KEY");

  if (!endpoint) return null;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      wallet: intent.wallet,
      tokenAddress: intent.token.address,
      side: intent.order.side,
      amountSol: intent.order.sizeSol,
      slippageBps: intent.order.slippageBps,
      intentId: intent.intentId,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Photon route failed with ${response.status}`);
  }

  return payload;
}

function simulationRoute(intent) {
  return {
    provider: "simulation",
    token: intent.token.symbol,
    side: intent.order.side,
    sizeSol: intent.order.sizeSol,
    estimatedEntryPrice: intent.order.entryPrice,
    takeProfitPercent: intent.order.takeProfitPercent,
    stopLossPercent: intent.order.stopLossPercent,
    transactionMessage: "",
    note: "Set PHOTON_ROUTE_URL and PHOTON_API_KEY in this Netlify project to return a signable Solana transaction message.",
  };
}

export default async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let intent;
  try {
    intent = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!intent?.wallet || !intent?.token?.address || !intent?.order?.sizeSol || !intent?.intentId) {
    return json({ error: "Wallet, token, order size, and intent id are required." }, { status: 422 });
  }

  let photonRoute;
  try {
    photonRoute = await requestPhotonRoute(intent);
    if (!photonRoute) {
      return json({
        configured: false,
        route: simulationRoute(intent),
      });
    }
  } catch (error) {
    return json({ error: error.message || "Photon route request failed." }, { status: 502 });
  }

  return json({
    configured: true,
    route: {
      provider: "photon",
      token: intent.token.symbol,
      side: intent.order.side,
      sizeSol: intent.order.sizeSol,
      quote: photonRoute.quote || photonRoute,
      transactionMessage: photonRoute.transactionMessage || photonRoute.message || photonRoute.transactionBase58 || "",
      transactionBase58: photonRoute.transactionBase58 || "",
    },
  });
};

export const config = {
  path: "/api/photon/route",
};
