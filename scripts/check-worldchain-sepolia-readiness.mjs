import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const WORLDCHAIN_SEPOLIA_CHAIN_ID = 4801;
const WORLDCHAIN_SEPOLIA_CHAIN_ID_HEX = "0x12c1";
const WORLDCHAIN_SEPOLIA_USDC = "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88";

export const REQUIRED_DEPLOYED_CONTRACTS = [
  "AdvisoryVoteRecorder",
  "CategoryRegistry",
  "ClusterPayoutOracle",
  "ContentRegistry",
  "FeedbackBonusEscrow",
  "FeedbackRegistry",
  "FrontendRegistry",
  "LaunchDistributionPool",
  "LoopReputation",
  "ProfileRegistry",
  "QuestionRewardPoolEscrow",
  "RaterRegistry",
  "RoundRewardDistributor",
  "RoundVotingEngine",
  "X402QuestionSubmitter",
];

export const PONDER_INDEXED_CONTRACTS = [
  "AdvisoryVoteRecorder",
  "CategoryRegistry",
  "ClusterPayoutOracle",
  "ContentRegistry",
  "FeedbackBonusEscrow",
  "FeedbackRegistry",
  "FrontendRegistry",
  "LaunchDistributionPool",
  "LoopReputation",
  "ProfileRegistry",
  "QuestionRewardPoolEscrow",
  "RaterRegistry",
  "RoundRewardDistributor",
  "RoundVotingEngine",
];

function isAddress(value) {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

function addCheck(checks, failures, ok, message) {
  checks.push({ ok, message });
  if (!ok) failures.push(message);
}

export function buildDeploymentAddressMap(deploymentJson) {
  const byName = new Map();
  for (const [key, value] of Object.entries(deploymentJson)) {
    if (isAddress(key) && typeof value === "string") {
      byName.set(value, key);
    }
  }
  return byName;
}

export function parseGeneratedContractsForChain(source, chainId = WORLDCHAIN_SEPOLIA_CHAIN_ID) {
  const marker = `  ${chainId}: {`;
  const start = source.indexOf(marker);
  if (start === -1) return new Map();

  const nextChainMatch = /\n  \d+: \{/g;
  nextChainMatch.lastIndex = start + marker.length;
  const next = nextChainMatch.exec(source);
  const chainSource = source.slice(start, next?.index ?? source.length);
  const contracts = new Map();

  for (const contractName of REQUIRED_DEPLOYED_CONTRACTS) {
    const contractRe = new RegExp(
      `${contractName}:\\s*\\{[\\s\\S]*?address:\\s*"([^"]+)"[\\s\\S]*?deployedOnBlock:\\s*(\\d+)`,
    );
    const match = contractRe.exec(chainSource);
    if (match) {
      contracts.set(contractName, {
        address: match[1],
        deployedOnBlock: Number(match[2]),
      });
    }
  }

  return contracts;
}

export function validateOfflineReadiness({
  deploymentJson,
  deployedContractsSource,
  questionRewardPoolsSource,
}) {
  const checks = [];
  const failures = [];
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  const generatedContracts = parseGeneratedContractsForChain(deployedContractsSource);

  addCheck(
    checks,
    failures,
    deploymentJson.networkName === "worldchainSepolia",
    "deployment artifact targets worldchainSepolia",
  );
  addCheck(
    checks,
    failures,
    deploymentJson.deploymentComplete === "true",
    "deployment artifact is marked complete",
  );
  addCheck(
    checks,
    failures,
    Number.isInteger(deploymentJson.deploymentBlockNumber) && deploymentJson.deploymentBlockNumber > 0,
    "deployment artifact has a positive deployment block",
  );

  for (const contractName of REQUIRED_DEPLOYED_CONTRACTS) {
    const deploymentAddress = deploymentAddresses.get(contractName);
    addCheck(
      checks,
      failures,
      isAddress(deploymentAddress),
      `${contractName} has an address in packages/foundry/deployments/4801.json`,
    );

    const generated = generatedContracts.get(contractName);
    addCheck(
      checks,
      failures,
      isAddress(generated?.address),
      `${contractName} has an address in packages/contracts/src/deployedContracts.ts`,
    );

    if (deploymentAddress && generated?.address) {
      addCheck(
        checks,
        failures,
        deploymentAddress.toLowerCase() === generated.address.toLowerCase(),
        `${contractName} address matches between foundry and generated contract artifacts`,
      );
    }

    if (PONDER_INDEXED_CONTRACTS.includes(contractName)) {
      addCheck(
        checks,
        failures,
        Number.isInteger(generated?.deployedOnBlock) && generated.deployedOnBlock > 0,
        `${contractName} has a positive generated deployedOnBlock for Ponder start blocks`,
      );
    }
  }

  addCheck(
    checks,
    failures,
    questionRewardPoolsSource.includes(`4801: "${WORLDCHAIN_SEPOLIA_USDC}"`),
    "Next.js default USDC address is configured for World Chain Sepolia",
  );

  return { ok: failures.length === 0, checks, failures };
}

function loadOfflineInputs(root = repoRoot) {
  return {
    deploymentJson: JSON.parse(readFileSync(join(root, "packages/foundry/deployments/4801.json"), "utf8")),
    deployedContractsSource: readFileSync(join(root, "packages/contracts/src/deployedContracts.ts"), "utf8"),
    questionRewardPoolsSource: readFileSync(join(root, "packages/nextjs/lib/questionRewardPools.ts"), "utf8"),
  };
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function rpc(rpcUrl, method, params = []) {
  const response = await fetchWithTimeout(rpcUrl, {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
}

export async function validateLiveReadiness({
  appUrl,
  deploymentJson,
  ponderUrl,
  requireTargets = false,
  rpcUrl,
}) {
  const checks = [];
  const failures = [];
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);

  if (rpcUrl) {
    try {
      const chainId = await rpc(rpcUrl, "eth_chainId");
      addCheck(
        checks,
        failures,
        String(chainId).toLowerCase() === WORLDCHAIN_SEPOLIA_CHAIN_ID_HEX,
        `RPC reports World Chain Sepolia chainId ${WORLDCHAIN_SEPOLIA_CHAIN_ID}`,
      );

      for (const contractName of REQUIRED_DEPLOYED_CONTRACTS) {
        const address = deploymentAddresses.get(contractName);
        if (!address) continue;
        const code = await rpc(rpcUrl, "eth_getCode", [address, "latest"]);
        addCheck(checks, failures, typeof code === "string" && code !== "0x", `${contractName} has bytecode on RPC`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addCheck(checks, failures, false, `RPC readiness probe failed: ${message}`);
    }
  } else {
    addCheck(
      checks,
      failures,
      !requireTargets,
      "live RPC probe skipped because WORLDCHAIN_SEPOLIA_RPC_URL is unset",
    );
  }

  if (ponderUrl) {
    try {
      const statusUrl = new URL("/status", ponderUrl);
      const response = await fetchWithTimeout(statusUrl);
      addCheck(checks, failures, response.ok, `Ponder /status returns HTTP ${response.status}`);
      if (response.ok) {
        const status = await response.json().catch(() => null);
        const blockNumber = status?.worldchainSepolia?.block?.number;
        addCheck(
          checks,
          failures,
          Number(blockNumber) >= Number(deploymentJson.deploymentBlockNumber),
          "Ponder has indexed at or beyond the deployment block",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addCheck(checks, failures, false, `Ponder readiness probe failed: ${message}`);
    }
  } else {
    addCheck(
      checks,
      failures,
      !requireTargets,
      "live Ponder probe skipped because WORLDCHAIN_SEPOLIA_PONDER_URL is unset",
    );
  }

  if (appUrl) {
    for (const path of ["/", "/ask", "/docs/ai", "/api/agent/templates"]) {
      try {
        const response = await fetchWithTimeout(new URL(path, appUrl));
        addCheck(checks, failures, response.status < 500, `app route ${path} returns below HTTP 500`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addCheck(checks, failures, false, `app route ${path} probe failed: ${message}`);
      }
    }
  } else {
    addCheck(
      checks,
      failures,
      !requireTargets,
      "live app probe skipped because WORLDCHAIN_SEPOLIA_APP_URL is unset",
    );
  }

  return { ok: failures.length === 0, checks, failures };
}

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
  const offlineInputs = loadOfflineInputs();
  const offlineResult = validateOfflineReadiness(offlineInputs);
  printResult("World Chain Sepolia offline readiness", offlineResult, args.json);

  let liveResult = { ok: true, checks: [], failures: [] };
  if (args.live) {
    liveResult = await validateLiveReadiness({
      appUrl: process.env.WORLDCHAIN_SEPOLIA_APP_URL,
      deploymentJson: offlineInputs.deploymentJson,
      ponderUrl: process.env.WORLDCHAIN_SEPOLIA_PONDER_URL,
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
