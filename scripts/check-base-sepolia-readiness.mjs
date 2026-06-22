import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addBasePreconfirmationEnvChecks,
  buildDeploymentAddressMap,
  loadOfflineInputs,
  validateLiveReadiness,
  validateOfflineReadiness,
} from "./check-worldchain-sepolia-readiness.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
export const DEFAULT_BASE_SEPOLIA_NEXT_ENV_FILE =
  "docs/testing/base-sepolia-next-env.fixture";

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
const KNOWN_STALE_BASE_SEPOLIA_X402_QUESTION_SUBMITTER =
  "0x24ab19e0d8052dec62bec59e986e336adc4721f3";

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
  for (const warning of result.warnings ?? []) {
    console.log(`WARN ${warning}`);
  }
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

export function baseSepoliaNotDeployedMessage() {
  return `Base Sepolia is not deployed: missing ${BASE_SEPOLIA_READINESS_CONFIG.deploymentPath}.`;
}

function readOptionalEnvFile(root, filePath) {
  if (!filePath) return null;
  const resolvedPath = isAbsolute(filePath)
    ? filePath
    : resolve(root, filePath);
  return readFileSync(resolvedPath, "utf8");
}

export function resolveBaseSepoliaNextEnvFilePath(env = process.env) {
  return env.BASE_SEPOLIA_NEXT_ENV_FILE?.trim() || DEFAULT_BASE_SEPOLIA_NEXT_ENV_FILE;
}

function loadBaseSepoliaOfflineInputs(root = repoRoot) {
  return {
    ...loadOfflineInputs(root, BASE_SEPOLIA_READINESS_CONFIG),
    appEnvSource: readOptionalEnvFile(
      root,
      resolveBaseSepoliaNextEnvFilePath(),
    ),
  };
}

export function validateBaseSepoliaOfflineReadiness(inputs) {
  const result = validateOfflineReadiness(
    inputs,
    BASE_SEPOLIA_READINESS_CONFIG,
  );
  const appEnvSource = inputs.appEnvSource ?? "";
  const deploymentAddresses = buildDeploymentAddressMap(inputs.deploymentJson);
  const x402QuestionSubmitter = deploymentAddresses.get("X402QuestionSubmitter");
  result.warnings ??= [];

  addCheck(
    result,
    appEnvSource.trim().length > 0,
    "Base Sepolia Next.js env source is configured",
  );
  addCheck(
    result,
    envSourceHasAssignment(
      appEnvSource,
      "NEXT_PUBLIC_TARGET_NETWORKS",
      "84532",
    ),
    "Next.js staging env targets Base Sepolia",
  );
  if (
    x402QuestionSubmitter?.toLowerCase() ===
    KNOWN_STALE_BASE_SEPOLIA_X402_QUESTION_SUBMITTER
  ) {
    result.warnings.push(
      "Base Sepolia X402QuestionSubmitter is the known stale staging submitter; one-shot Feedback Bonus x402 submissions remain disabled until the staging submitter is refreshed.",
    );
  }

  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let offlineInputs;
  try {
    offlineInputs = loadBaseSepoliaOfflineInputs();
  } catch (error) {
    if (
      error?.code === "ENOENT" &&
      error.path?.endsWith(BASE_SEPOLIA_READINESS_CONFIG.deploymentPath)
    ) {
      console.error(baseSepoliaNotDeployedMessage());
      process.exit(1);
      return;
    }
    throw error;
  }

  const offlineResult = validateBaseSepoliaOfflineReadiness(offlineInputs);
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
    addBasePreconfirmationEnvChecks({
      chainId: BASE_SEPOLIA_READINESS_CONFIG.chainId,
      checks: liveResult.checks,
      failures: liveResult.failures,
      sourceLabel: "live environment",
    });
    liveResult.ok = liveResult.failures.length === 0;
    printResult("Base Sepolia live readiness", liveResult, args.json);
  }

  if (!offlineResult.ok || !liveResult.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
