function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

function isPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateIntent(intent) {
  const errors = [];

  if (!intent?.wallet) errors.push("A connected Phantom wallet is required.");
  if (intent?.mode !== "armed" && intent?.mode !== "paper") errors.push("Mode must be paper or armed.");
  if (!intent?.token?.symbol || !intent?.token?.address) errors.push("Token symbol and address are required.");
  if (!intent?.agent?.name) errors.push("A winning agent bid is required.");
  if (!isPositiveNumber(intent?.order?.sizeSol)) errors.push("Order size must be greater than zero.");
  if (!isPositiveNumber(intent?.order?.maxWalletExposureSol)) errors.push("Wallet exposure limit is required.");
  if (intent?.order?.sizeSol > intent?.order?.maxWalletExposureSol) errors.push("Order size exceeds wallet exposure limit.");
  if (!isPositiveNumber(intent?.order?.takeProfitPercent)) errors.push("Take profit must be greater than zero.");
  if (!isPositiveNumber(intent?.order?.stopLossPercent)) errors.push("Stop loss must be greater than zero.");
  if (intent?.token?.score < 72) errors.push("Token score is below the risk gate.");

  return errors;
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

  const errors = validateIntent(intent);
  if (errors.length) {
    return json({ error: "Trade intent rejected", details: errors }, { status: 422 });
  }

  const intentId = crypto.randomUUID();
  return json({
    accepted: true,
    intentId,
    guardrails: {
      requiresPhantomSignature: true,
      serverDoesNotHoldPrivateKeys: true,
      maxWalletExposureSol: intent.order.maxWalletExposureSol,
      preparedFor: intent.wallet,
    },
  });
};

export const config = {
  path: "/api/trade/intent",
};
