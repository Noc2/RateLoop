import { fileURLToPath } from "node:url";
import {
  loadOfflineInputs,
  validateLiveReadiness,
  validateOfflineReadiness,
  WORLDCHAIN_SEPOLIA_READINESS_CONFIG,
} from "./readiness-core.mjs";

export * from "./readiness-core.mjs";

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const offlineInputs = loadOfflineInputs(
    undefined,
    WORLDCHAIN_SEPOLIA_READINESS_CONFIG,
  );
  const offlineResult = validateOfflineReadiness(
    offlineInputs,
    WORLDCHAIN_SEPOLIA_READINESS_CONFIG,
  );
  printResult(
    "World Chain Sepolia offline readiness",
    offlineResult,
    args.json,
  );

  let liveResult = { ok: true, checks: [], failures: [] };
  if (args.live) {
    liveResult = await validateLiveReadiness({
      appUrl: process.env.WORLDCHAIN_SEPOLIA_APP_URL,
      deploymentJson: offlineInputs.deploymentJson,
      ponderUrl: process.env.WORLDCHAIN_SEPOLIA_PONDER_URL,
      readinessConfig: WORLDCHAIN_SEPOLIA_READINESS_CONFIG,
      requireTargets: args.requireLiveTargets,
      rpcUrl: process.env.WORLDCHAIN_SEPOLIA_RPC_URL,
    });
    printResult("World Chain Sepolia live readiness", liveResult, args.json);
  }

  if (!offlineResult.ok || !liveResult.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
