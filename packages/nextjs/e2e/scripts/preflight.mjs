#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { buildE2EServiceUrl } from "../service-url.mjs";

const E2E_BASE_URL = process.env.E2E_BASE_URL?.trim() || "http://localhost:3000";
const E2E_RPC_URL = process.env.E2E_RPC_URL?.trim() || "http://127.0.0.1:8545";
const PONDER_URL = process.env.NEXT_PUBLIC_PONDER_URL?.trim() || "http://localhost:42069";
const E2E_KEEPER_URL = process.env.E2E_KEEPER_URL?.trim() || "http://localhost:9090";

const MAX_WAIT_MS = Number(process.env.E2E_PREFLIGHT_TIMEOUT_MS || 30_000);
const POLL_INTERVAL_MS = 2_000;

const services = [
  {
    name: "Anvil (local chain)",
    url: E2E_RPC_URL,
    hint: "yarn chain",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
  },
  {
    name: "Next.js (frontend)",
    url: E2E_BASE_URL,
    hint: "yarn start",
  },
  {
    name: "Ponder (indexer API)",
    url: buildE2EServiceUrl(PONDER_URL, "/content?limit=1"),
    hint: "yarn ponder:dev",
  },
];

if (process.env.REQUIRE_E2E_KEEPER === "1" || process.argv.includes("--require-keeper")) {
  services.push({
    name: "Keeper (settlement service)",
    url: new URL("/health", E2E_KEEPER_URL).toString(),
    hint: "yarn keeper:dev",
  });
}

function httpStatus(service) {
  const args = ["-s", "-m", "5", "-o", "/dev/null", "-w", "%{http_code}"];

  if (service.method) {
    args.push("-X", service.method);
  }

  for (const [header, value] of Object.entries(service.headers ?? {})) {
    args.push("-H", `${header}: ${value}`);
  }

  if (service.body) {
    args.push("--data", service.body);
  }

  args.push(service.url);

  try {
    return Number(execFileSync("curl", args, { encoding: "utf8" }).trim());
  } catch {
    return null;
  }
}

async function waitForService(service) {
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT_MS) {
    const status = httpStatus(service);
    if (status && status >= 200 && status < 400) {
      return { ok: true, service, status };
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { ok: false, service, status: null };
}

console.log("Checking RateLoop E2E services...");

const results = await Promise.all(services.map(waitForService));
const failures = results.filter(result => !result.ok);

for (const result of results) {
  const prefix = result.ok ? "✓" : "✗";
  console.log(`${prefix} ${result.service.name}: ${result.service.url}`);
}

if (failures.length > 0) {
  console.error("\nE2E infrastructure is not ready.");
  for (const { service } of failures) {
    console.error(`- ${service.name} did not respond at ${service.url}`);
    console.error(`  Start it with: ${service.hint}`);
  }
  console.error("\nQuick local start:");
  console.error("  Terminal 1: yarn chain");
  console.error("  Terminal 2: yarn deploy");
  console.error("  Terminal 3: yarn dev:stack");
  process.exit(1);
}

console.log("All required E2E services are reachable.");
