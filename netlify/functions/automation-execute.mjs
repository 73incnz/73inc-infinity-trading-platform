function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function validate(command) {
  const errors = [];
  if (!command?.action || !["buy", "sell-half", "sell-all", "cancel"].includes(command.action)) errors.push("Unsupported action.");
  if (!command?.token?.address || !command?.token?.symbol) errors.push("Token identity is required.");
  if (command.action === "buy" && Number(command?.order?.sizeSol) !== 0.05) errors.push("Automated entries are fixed at 0.05 SOL.");
  if (command.action === "buy" && command?.token?.risk?.eligible !== true) errors.push("RugCheck eligibility is required.");
  if (command.action === "buy" && Number(command?.token?.score || 0) < 75) errors.push("Token score is below 75.");
  return errors;
}

export default async (request) => {
  if (request.method === "GET") {
    return json({
      configured: Boolean(Netlify.env.get("AUTOTRADE_EXECUTION_URL") && Netlify.env.get("AUTOTRADE_EXECUTION_TOKEN")),
      provider: Netlify.env.get("AUTOTRADE_PROVIDER") || "execution-webhook",
      safeguards: { orderSizeSol: 0.05, rugCheckRequired: true, minimumScore: 75 },
    });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let command;
  try {
    command = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const errors = validate(command);
  if (errors.length) return json({ error: "Execution rejected", details: errors }, 422);

  if (command.mode === "paper") {
    return json({ accepted: true, simulated: true, executionId: crypto.randomUUID(), action: command.action });
  }

  const endpoint = Netlify.env.get("AUTOTRADE_EXECUTION_URL");
  const token = Netlify.env.get("AUTOTRADE_EXECUTION_TOKEN");
  if (!endpoint || !token) return json({ error: "Live execution adapter is not configured." }, 503);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...command, requestedAt: new Date().toISOString(), source: "73inc-infinity-project" }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: result.error || `Execution adapter returned ${response.status}` }, 502);
    return json({ accepted: true, simulated: false, executionId: result.executionId || result.signature || crypto.randomUUID(), result });
  } catch (error) {
    return json({ error: error.message || "Execution adapter failed." }, 502);
  }
};

export const config = { path: "/api/automation/execute" };
