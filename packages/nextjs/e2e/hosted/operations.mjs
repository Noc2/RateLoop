import { BASE_SEPOLIA_CHAIN_ID, HostedE2ESafetyError } from "./safety.mjs";

function serviceOrigin(raw, key) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HostedE2ESafetyError([`${key} must be an absolute URL.`]);
  }
  const errors = [];
  if (parsed.protocol !== "https:") errors.push(`${key} must use HTTPS.`);
  if (parsed.port || parsed.username || parsed.password) {
    errors.push(`${key} must not contain a port or credentials.`);
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    errors.push(`${key} must identify the service origin without a path, query, or fragment.`);
  }
  if (errors.length) throw new HostedE2ESafetyError(errors);
  return parsed.origin;
}

async function checkedResponse(fetchImpl, url, init, label) {
  const response = await fetchImpl(url, {
    ...init,
    headers: { accept: "application/json", ...init?.headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  return response;
}

async function checkedJson(fetchImpl, url, init, label) {
  const response = await checkedResponse(fetchImpl, url, init, label);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} did not return JSON.`);
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid response.`);
  }
  return value;
}

export async function checkHostedOperations({ fetchImpl = fetch, keeperAuthToken, keeperUrl, ponderUrl }) {
  const keeperOrigin = serviceOrigin(keeperUrl, "E2E_KEEPER_URL");
  const ponderOrigin = serviceOrigin(ponderUrl, "E2E_PONDER_URL");

  const [readyRaw, ponderRaw] = await Promise.all([
    checkedJson(fetchImpl, `${keeperOrigin}/ready`, undefined, "Keeper readiness"),
    checkedJson(fetchImpl, `${ponderOrigin}/health/tokenless`, undefined, "Ponder tokenless health"),
  ]);
  const ready = requireObject(readyRaw, "Keeper readiness");
  if (ready.status !== "ok" || ready.protocol !== "tokenless-v4") {
    throw new Error("Keeper readiness is not healthy tokenless-v4.");
  }
  const ponder = requireObject(ponderRaw, "Ponder tokenless health");
  if (
    ponder.status !== "ok" ||
    ponder.protocol !== "tokenless-v4" ||
    String(ponder.chainId) !== BASE_SEPOLIA_CHAIN_ID ||
    ponder.indexReady !== true
  ) {
    throw new Error("Ponder is not a ready tokenless-v4 Base Sepolia indexer.");
  }

  const token = keeperAuthToken?.trim();
  let authenticatedKeeper = "skipped";
  if (token) {
    const authorization = { authorization: `Bearer ${token}` };
    const [healthRaw, metricsResponse] = await Promise.all([
      checkedJson(fetchImpl, `${keeperOrigin}/health`, { headers: authorization }, "Keeper health"),
      checkedResponse(fetchImpl, `${keeperOrigin}/metrics`, { headers: authorization }, "Keeper metrics"),
    ]);
    const health = requireObject(healthRaw, "Keeper health");
    if (health.status !== "ok" || health.protocol !== "tokenless-v4") {
      throw new Error("Authenticated keeper health is degraded.");
    }
    const walletBalanceWei = BigInt(String(health.walletBalanceWei));
    const minimumWalletBalanceWei = BigInt(String(health.minimumWalletBalanceWei));
    if (walletBalanceWei < minimumWalletBalanceWei) {
      throw new Error("Keeper gas balance is below its configured minimum.");
    }
    const metrics = await metricsResponse.text();
    for (const metric of [
      "keeper_last_successful_run_timestamp",
      "keeper_wallet_balance_wei",
      "keeper_minimum_wallet_balance_wei",
    ]) {
      if (!new RegExp(`^${metric} `, "mu").test(metrics)) {
        throw new Error(`Keeper metrics omitted ${metric}.`);
      }
    }
    authenticatedKeeper = "checked";
  }

  return {
    authenticatedKeeper,
    keeper: { protocol: ready.protocol, status: ready.status },
    ponder: {
      chainId: String(ponder.chainId),
      deploymentKey: String(ponder.deploymentKey),
      indexBlock: ponder.indexBlock,
      protocol: ponder.protocol,
      status: ponder.status,
    },
  };
}
