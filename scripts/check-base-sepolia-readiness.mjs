import { fileURLToPath } from "node:url";
import {
  loadOfflineInputs,
  validateLiveReadiness,
  validateOfflineReadiness,
} from "./check-worldchain-sepolia-readiness.mjs";

export const BASE_SEPOLIA_READINESS_CONFIG = {
  appEnvName: "BASE_SEPOLIA_APP_URL",
  chainId: 84532,
  chainIdHex: "0x14a34",
  deploymentPath: "packages/foundry/deployments/84532.json",
  label: "Base Sepolia",
  networkName: "baseSepolia",
  ponderEnvName: "BASE_SEPOLIA_PONDER_URL",
  ponderStatusKey: "baseSepolia",
  rpcEnvName: "BASE_SEPOLIA_RPC_URL",
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

function parseArgs(argv) {
  return {
    live: argv.includes("--live"),
    json: argv.includes("--json"),
    requireLiveTargets: argv.includes("--require-live-targets"),
  };
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

export function baseSepoliaNotDeployedMessage() {
  return `Base Sepolia is not deployed: missing ${BASE_SEPOLIA_READINESS_CONFIG.deploymentPath}.`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let offlineInputs;
  try {
    offlineInputs = loadOfflineInputs(undefined, BASE_SEPOLIA_READINESS_CONFIG);
  } catch (error) {
    if (error?.code === "ENOENT" && error.path?.endsWith(BASE_SEPOLIA_READINESS_CONFIG.deploymentPath)) {
      console.error(baseSepoliaNotDeployedMessage());
      process.exit(1);
      return;
    }
    throw error;
  }

  const offlineResult = validateOfflineReadiness(offlineInputs, BASE_SEPOLIA_READINESS_CONFIG);
  printResult("Base Sepolia offline readiness", offlineResult, args.json);

  let liveResult = { ok: true, checks: [], failures: [] };
  if (args.live) {
    liveResult = await validateLiveReadiness({
      appUrl: process.env.BASE_SEPOLIA_APP_URL,
      deploymentJson: offlineInputs.deploymentJson,
      ponderUrl: process.env.BASE_SEPOLIA_PONDER_URL,
      readinessConfig: BASE_SEPOLIA_READINESS_CONFIG,
      requireTargets: args.requireLiveTargets,
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL,
    });
    printResult("Base Sepolia live readiness", liveResult, args.json);
  }

  if (!offlineResult.ok || !liveResult.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
