import { fileURLToPath } from "node:url";
import {
  loadOfflineInputs,
  printReadinessResults,
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

  let liveResult = { ok: true, checks: [], failures: [] };
  if (args.live) {
    liveResult = await validateLiveReadiness({
      appUrl: process.env.WORLDCHAIN_SEPOLIA_APP_URL,
      deploymentJson: offlineInputs.deploymentJson,
      keeperUrl: process.env.WORLDCHAIN_SEPOLIA_KEEPER_URL,
      ponderUrl: process.env.WORLDCHAIN_SEPOLIA_PONDER_URL,
      readinessConfig: WORLDCHAIN_SEPOLIA_READINESS_CONFIG,
      requireTargets: args.requireLiveTargets,
      rpcUrl: process.env.WORLDCHAIN_SEPOLIA_RPC_URL,
    });
  }

  printReadinessResults({
    json: args.json,
    liveResult: args.live ? liveResult : null,
    liveTitle: "World Chain Sepolia live readiness",
    offlineResult,
    offlineTitle: "World Chain Sepolia offline readiness",
  });

  if (!offlineResult.ok || !liveResult.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
