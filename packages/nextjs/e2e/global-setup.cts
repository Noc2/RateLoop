/**
 * Playwright global setup — validates that all required services are running
 * before any test executes.  Fails fast with actionable error messages.
 */
import { resolve } from "path";
import { execFileSync } from "child_process";
import { ensureBaselineSeedData, ensureLocalHumanCredentials } from "./helpers/baseline-seed";
import {
  E2E_BASE_URL,
  E2E_KEEPER_HEALTH_URL,
  E2E_RPC_URL,
  PONDER_URL,
  buildE2EServiceUrl,
} from "./helpers/service-urls";

const SERVICES = [
  {
    name: "Anvil (local chain)",
    url: E2E_RPC_URL,
    method: "POST" as const,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
    hint: "yarn chain",
  },
  {
    name: "Next.js (frontend)",
    url: E2E_BASE_URL,
    hint: "yarn start",
  },
  {
    name: "Ponder (indexer)",
    url: buildE2EServiceUrl(PONDER_URL, "/content?limit=1"),
    hint: "yarn ponder:dev",
  },
];

const MAX_WAIT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;
const NEXTJS_DIR = resolve(__dirname, "..");

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 5_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function httpStatus(service: (typeof SERVICES)[number]): Promise<number | null> {
  try {
    const response = await fetchWithTimeout(service.url, {
      method: service.method ?? "GET",
      headers: service.headers,
      body: service.body,
    });
    return response.status;
  } catch {
    return null;
  }
}

async function checkService(service: (typeof SERVICES)[number]): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    const status = await httpStatus(service);
    if (status && status >= 200 && status < 400) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(
    `\n\n  ✗ ${service.name} not responding at ${service.url}\n` + `    Start it with: ${service.hint}\n`,
  );
}

/**
 * Top up the keeper account (Anvil account #1) with ETH.
 * After many test runs the keeper exhausts its gas budget for settlements.
 * anvil_setBalance is a local-only Anvil cheat code — safe and instant.
 */
async function topUpKeeperBalance(): Promise<void> {
  // Keeper = Anvil account #1 (0x70997970C51812dc3A010C7d01b50e0d17dc79C8)
  const KEEPER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  // 10,000 ETH in hex (0x21E19E0C9BAB2400000)
  const BALANCE_HEX = "0x21E19E0C9BAB2400000";

  try {
    const response = await fetchWithTimeout(E2E_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "anvil_setBalance",
        params: [KEEPER_ADDRESS, BALANCE_HEX],
        id: 1,
      }),
    });
    const json = await response.json().catch(() => null);
    if (response.ok && !json?.error) {
      console.log("  ✓ Keeper (account #1) balance topped up to 10,000 ETH");
    }
  } catch {
    // Non-fatal — keeper may still have enough balance
  }
}

/**
 * Ensure the Next.js Postgres database schema is up to date.
 * Runs the workspace `db:push` command so Drizzle resolves the Next.js config.
 * This is idempotent — safe to run on every test start.
 */
async function ensureDatabaseSchema(): Promise<void> {
  try {
    execFileSync("yarn", ["db:push"], {
      cwd: NEXTJS_DIR,
      env: process.env,
      stdio: "pipe",
      timeout: 60_000,
    });
    console.log("  ✓ Postgres database schema up to date");
  } catch (err: any) {
    const details = [err.stdout?.toString().trim(), err.stderr?.toString().trim(), err.message]
      .filter(Boolean)
      .join("\n");
    throw new Error(`Failed to apply the Next.js database schema before E2E tests.\n${details}`);
  }
}

async function globalSetup() {
  console.log("\n  Checking E2E infrastructure...");

  const results = await Promise.allSettled(SERVICES.map(checkService));

  const failures = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map(r => r.reason.message);

  if (failures.length > 0) {
    throw new Error(
      `E2E infrastructure not ready:\n${failures.join("\n")}\n\n` +
        "  Quick start:\n" +
        "    Check first: yarn workspace @rateloop/nextjs e2e:preflight\n" +
        "    Terminal 1: yarn chain\n" +
        "    Terminal 2: yarn deploy\n" +
        "    Terminal 3: yarn dev:stack\n\n" +
        "  Or start services manually:\n" +
        "    Terminal 1: yarn chain\n" +
        "    Terminal 2: yarn deploy  (once chain is up)\n" +
        "    Terminal 3: yarn ponder:dev\n" +
        "    Terminal 4: yarn start\n",
    );
  }

  // Ensure the app database schema exists for API routes that use server-side persistence.
  await ensureDatabaseSchema();

  // Local time-skip shards can advance Anvil past the deterministic rater
  // credential TTL. Refresh them so repeated Playwright runs stay isolated.
  await ensureLocalHumanCredentials();

  // Seed the baseline local content + commits expected by the E2E suite when
  // the chain/indexer starts empty.
  await ensureBaselineSeedData();

  // Top up keeper balance to prevent gas exhaustion during settlements
  await topUpKeeperBalance();

  // Keeper health check. The dedicated keeper-backed settlement project
  // requires a live keeper process with metrics enabled.
  try {
    const response = await fetchWithTimeout(E2E_KEEPER_HEALTH_URL, {}, 3_000);
    if (response.status >= 200 && response.status < 400) {
      console.log("  ✓ Keeper (settlement service) running with metrics");
    } else {
      if (process.env.REQUIRE_E2E_KEEPER === "1") {
        throw new Error("Keeper health check returned non-OK");
      }
      console.warn("  ⚠ Keeper health check returned non-OK — keeper-backed settlement tests may fail");
    }
  } catch {
    if (process.env.REQUIRE_E2E_KEEPER === "1") {
      throw new Error(
        `E2E keeper-backed settlement tests require a running keeper at ${E2E_KEEPER_HEALTH_URL}.\n` +
          "  Start it with: yarn keeper:dev\n",
      );
    }
    console.log("  ⓘ Keeper health endpoint not available — start with: yarn keeper:dev");
  }

  console.log("  ✓ All services ready\n");
}

export default globalSetup;
