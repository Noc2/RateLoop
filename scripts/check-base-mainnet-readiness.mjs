import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addBasePreconfirmationEnvChecks,
  loadOfflineInputs,
  validateLiveReadiness,
  validateOfflineReadiness,
} from "./readiness-core.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);

export const BASE_MAINNET_READINESS_CONFIG = {
  appEnvName: "BASE_APP_URL",
  chainId: 8453,
  chainIdHex: "0x2105",
  deploymentPath: "packages/foundry/deployments/8453.json",
  keeperEnvName: "BASE_KEEPER_URL",
  label: "Base mainnet",
  networkName: "base",
  ponderEnvName: "BASE_PONDER_URL",
  ponderStatusKey: "base",
  rpcEnvName: "BASE_RPC_URL",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

const PRODUCTION_DEPLOYMENT_PROFILE = "production";

function parseArgs(argv) {
  return {
    live: argv.includes("--live"),
    json: argv.includes("--json"),
    requireLiveTargets: argv.includes("--require-live-targets"),
  };
}

function addCheck(result, ok, message) {
  result.checks.push({ ok, message });
  if (!ok) result.failures.push(message);
  result.ok = result.failures.length === 0;
}

function envSourceHasAssignment(source, key, expectedValue) {
  return source
    .split(/\r?\n/)
    .some((line) => line.trim() === `${key}=${expectedValue}`);
}

function printResult(title, result, json = false) {
  if (json) {
    console.log(JSON.stringify({ title, ...result }, null, 2));
    return;
  }

  console.log(`\n${title}`);
  for (const check of result.checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.message}`);
  }
}

export function baseMainnetNotDeployedMessage() {
  return `Base mainnet is not deployed: missing ${BASE_MAINNET_READINESS_CONFIG.deploymentPath}.`;
}

export function validateBaseMainnetOfflineReadiness(inputs) {
  const result = validateOfflineReadiness(
    inputs,
    BASE_MAINNET_READINESS_CONFIG,
  );

  addCheck(
    result,
    inputs.deploymentJson.deploymentProfile === PRODUCTION_DEPLOYMENT_PROFILE,
    `deployment artifact profile is ${PRODUCTION_DEPLOYMENT_PROFILE}`,
  );
  addCheck(
    result,
    envSourceHasAssignment(
      inputs.envProductionSource ?? "",
      "NEXT_PUBLIC_TARGET_NETWORKS",
      "8453",
    ),
    "Next.js production env targets Base mainnet",
  );
  addCheck(
    result,
    envSourceHasAssignment(
      inputs.envProductionSource ?? "",
      "NEXT_PUBLIC_WORLD_ID_ENVIRONMENT",
      "production",
    ),
    "Next.js production env uses production World ID",
  );
  addCheck(
    result,
    envSourceHasAssignment(
      inputs.envProductionSource ?? "",
      "NEXT_PUBLIC_WORLD_ID_PROOF_MODE",
      "legacy",
    ),
    "Next.js production env requests legacy World ID proofs",
  );
  addBasePreconfirmationEnvChecks({
    chainId: BASE_MAINNET_READINESS_CONFIG.chainId,
    checks: result.checks,
    envSource: inputs.envProductionSource,
    failures: result.failures,
    sourceLabel: "Next.js production env",
  });
  result.ok = result.failures.length === 0;

  return result;
}

function loadBaseMainnetOfflineInputs(root = repoRoot) {
  return {
    ...loadOfflineInputs(root, BASE_MAINNET_READINESS_CONFIG),
    envProductionSource: readFileSync(
      join(root, "packages/nextjs/.env.production"),
      "utf8",
    ),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let offlineInputs;
  try {
    offlineInputs = loadBaseMainnetOfflineInputs();
  } catch (error) {
    if (
      error?.code === "ENOENT" &&
      error.path?.endsWith(BASE_MAINNET_READINESS_CONFIG.deploymentPath)
    ) {
      console.error(baseMainnetNotDeployedMessage());
      process.exit(1);
      return;
    }
    throw error;
  }

  const offlineResult = validateBaseMainnetOfflineReadiness(offlineInputs);
  printResult(
    "Base mainnet production offline readiness",
    offlineResult,
    args.json,
  );

  let liveResult = { ok: true, checks: [], failures: [] };
  if (args.live) {
    liveResult = await validateLiveReadiness({
      appUrl: process.env.BASE_APP_URL,
      deploymentJson: offlineInputs.deploymentJson,
      keeperUrl: process.env.BASE_KEEPER_URL,
      ponderUrl: process.env.BASE_PONDER_URL,
      readinessConfig: BASE_MAINNET_READINESS_CONFIG,
      requireTargets: args.requireLiveTargets,
      rpcUrl: process.env.BASE_RPC_URL,
    });
    addBasePreconfirmationEnvChecks({
      chainId: BASE_MAINNET_READINESS_CONFIG.chainId,
      checks: liveResult.checks,
      failures: liveResult.failures,
      sourceLabel: "live environment",
    });
    liveResult.ok = liveResult.failures.length === 0;
    printResult(
      "Base mainnet production live readiness",
      liveResult,
      args.json,
    );
  }

  if (!offlineResult.ok || !liveResult.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
