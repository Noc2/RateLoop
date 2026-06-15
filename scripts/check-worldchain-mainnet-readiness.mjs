import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PONDER_INDEXED_CONTRACTS,
  REQUIRED_DEPLOYED_CONTRACTS,
  REQUIRED_SELECTOR_CHECKS,
  REQUIRED_SUBMISSION_MEDIA_VALIDATOR_SELECTORS,
  buildDeploymentAddressMap,
  bytecodeContainsSelector,
  getSelectorProbeCode,
  getSubmissionMediaValidatorAddress,
  getSubmissionMediaValidatorAuthorizedEmitter,
  parseGeneratedContractsForChain,
} from "./check-worldchain-sepolia-readiness.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const WORLDCHAIN_CHAIN_ID = 480;
const WORLDCHAIN_CHAIN_ID_HEX = "0x1e0";
const WORLDCHAIN_DEPLOYMENT_ARTIFACT = "packages/foundry/deployments/480.json";
const WORLDCHAIN_USDC = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1";
const WORLD_ID_PRODUCTION_VERIFIER =
  "0x00000000009E00F9FE82CfeeBB4556686da094d7";
const WORLD_ID_STAGING_VERIFIER = "0x703a6316c975DEabF30b637c155edD53e24657DB";
const WORLD_ID_VERIFIER_SELECTOR = "0x40340c44";
const DEPLOYMENT_PROFILE_BY_MODE = {
  production: "production",
  canary: "mainnet-canary",
};
const WORLD_ID_VERIFIER_BY_MODE = {
  production: WORLD_ID_PRODUCTION_VERIFIER,
  canary: WORLD_ID_STAGING_VERIFIER,
};

function isAddress(value) {
  return typeof value === "string" && ADDRESS_RE.test(value);
}

function addCheck(checks, failures, ok, message) {
  checks.push({ ok, message });
  if (!ok) failures.push(message);
}

function normalizeAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function parseAddressResult(result) {
  if (typeof result !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(result)) {
    return undefined;
  }
  return `0x${result.slice(-40)}`;
}

export function mainnetNotDeployedMessage() {
  return `World Chain mainnet is not deployed: missing ${WORLDCHAIN_DEPLOYMENT_ARTIFACT}.`;
}

export function validateOfflineReadiness({
  deploymentJson,
  deployedContractsSource,
  expectedMode = "production",
  protocolSource,
}) {
  const checks = [];
  const failures = [];
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  const generatedContracts = parseGeneratedContractsForChain(
    deployedContractsSource,
    WORLDCHAIN_CHAIN_ID,
  );
  const expectedDeploymentProfile = DEPLOYMENT_PROFILE_BY_MODE[expectedMode];

  addCheck(
    checks,
    failures,
    deploymentJson.networkName === "worldchain",
    "deployment artifact targets worldchain",
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
    deploymentJson.deploymentProfile === expectedDeploymentProfile,
    `deployment artifact profile is ${expectedDeploymentProfile}`,
  );
  addCheck(
    checks,
    failures,
    Number.isInteger(deploymentJson.deploymentBlockNumber) &&
      deploymentJson.deploymentBlockNumber > 0,
    "deployment artifact has a positive deployment block",
  );

  for (const contractName of REQUIRED_DEPLOYED_CONTRACTS) {
    const deploymentAddress = deploymentAddresses.get(contractName);
    addCheck(
      checks,
      failures,
      isAddress(deploymentAddress),
      `${contractName} has an address in packages/foundry/deployments/480.json`,
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
        Number.isInteger(generated?.deployedOnBlock) &&
          generated.deployedOnBlock > 0,
        `${contractName} has a positive generated deployedOnBlock for Ponder start blocks`,
      );
    }
  }

  addCheck(
    checks,
    failures,
    protocolSource.includes(`480: "${WORLDCHAIN_USDC}"`),
    "Next.js default USDC address is configured for World Chain mainnet",
  );

  return { ok: failures.length === 0, checks, failures };
}

export function loadOfflineInputs(root = repoRoot) {
  const deploymentPath = join(root, WORLDCHAIN_DEPLOYMENT_ARTIFACT);
  return {
    deploymentJson: JSON.parse(readFileSync(deploymentPath, "utf8")),
    deployedContractsSource: readFileSync(
      join(root, "packages/contracts/src/deployedContracts.ts"),
      "utf8",
    ),
    protocolSource: readFileSync(
      join(root, "packages/contracts/src/protocol.ts"),
      "utf8",
    ),
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
  if (!response.ok)
    throw new Error(`${method} returned HTTP ${response.status}`);
  const body = await response.json();
  if (body.error)
    throw new Error(
      `${method} failed: ${body.error.message ?? JSON.stringify(body.error)}`,
    );
  return body.result;
}

export async function validateLiveReadiness({
  appUrl,
  deploymentJson,
  expectedMode = "production",
  ponderUrl,
  requireTargets = false,
  rpcUrl,
}) {
  const checks = [];
  const failures = [];
  const deploymentAddresses = buildDeploymentAddressMap(deploymentJson);
  const expectedVerifier = WORLD_ID_VERIFIER_BY_MODE[expectedMode];

  if (rpcUrl) {
    try {
      const chainId = await rpc(rpcUrl, "eth_chainId");
      addCheck(
        checks,
        failures,
        String(chainId).toLowerCase() === WORLDCHAIN_CHAIN_ID_HEX,
        `RPC reports World Chain mainnet chainId ${WORLDCHAIN_CHAIN_ID}`,
      );

      for (const contractName of REQUIRED_DEPLOYED_CONTRACTS) {
        const address = deploymentAddresses.get(contractName);
        if (!address) continue;
        const code = await rpc(rpcUrl, "eth_getCode", [address, "latest"]);
        addCheck(
          checks,
          failures,
          typeof code === "string" && code !== "0x",
          `${contractName} has bytecode on RPC`,
        );
      }

      for (const selectorCheck of REQUIRED_SELECTOR_CHECKS) {
        const address = deploymentAddresses.get(selectorCheck.contractName);
        if (!address) continue;
        const { code, target } = await getSelectorProbeCode(
          rpcUrl,
          selectorCheck.contractName,
          address,
        );
        for (const selector of selectorCheck.selectors) {
          addCheck(
            checks,
            failures,
            bytecodeContainsSelector(code, selector),
            `${target} bytecode contains selector ${selector}`,
          );
        }
      }

      const contentRegistryAddress = deploymentAddresses.get("ContentRegistry");
      if (contentRegistryAddress) {
        const validatorAddress = await getSubmissionMediaValidatorAddress(
          rpcUrl,
          contentRegistryAddress,
        );
        addCheck(
          checks,
          failures,
          isAddress(validatorAddress),
          "ContentRegistry submissionMediaValidator has an address",
        );
        if (validatorAddress) {
          const validatorCode = await rpc(rpcUrl, "eth_getCode", [
            validatorAddress,
            "latest",
          ]);
          addCheck(
            checks,
            failures,
            typeof validatorCode === "string" && validatorCode !== "0x",
            "ContentRegistry submissionMediaValidator has bytecode",
          );
          for (const selector of REQUIRED_SUBMISSION_MEDIA_VALIDATOR_SELECTORS) {
            addCheck(
              checks,
              failures,
              bytecodeContainsSelector(validatorCode, selector),
              `ContentRegistry submissionMediaValidator bytecode contains selector ${selector}`,
            );
          }
          const authorizedEmitter =
            await getSubmissionMediaValidatorAuthorizedEmitter(
              rpcUrl,
              validatorAddress,
            );
          addCheck(
            checks,
            failures,
            normalizeAddress(authorizedEmitter) ===
              normalizeAddress(contentRegistryAddress),
            "ContentRegistry submissionMediaValidator authorizedEmitter is ContentRegistry",
          );
        }
      }

      const raterRegistry = deploymentAddresses.get("RaterRegistry");
      if (raterRegistry && expectedVerifier) {
        const verifierResult = await rpc(rpcUrl, "eth_call", [
          { to: raterRegistry, data: WORLD_ID_VERIFIER_SELECTOR },
          "latest",
        ]);
        const verifier = parseAddressResult(verifierResult);
        addCheck(
          checks,
          failures,
          normalizeAddress(verifier) === normalizeAddress(expectedVerifier),
          `RaterRegistry World ID verifier is ${expectedVerifier}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addCheck(
        checks,
        failures,
        false,
        `RPC readiness probe failed: ${message}`,
      );
    }
  } else {
    addCheck(
      checks,
      failures,
      !requireTargets,
      "live RPC probe skipped because WORLDCHAIN_RPC_URL is unset",
    );
  }

  if (ponderUrl) {
    try {
      const statusUrl = new URL("/status", ponderUrl);
      const response = await fetchWithTimeout(statusUrl);
      addCheck(
        checks,
        failures,
        response.ok,
        `Ponder /status returns HTTP ${response.status}`,
      );
      if (response.ok) {
        const status = await response.json().catch(() => null);
        const blockNumber = status?.worldchain?.block?.number;
        addCheck(
          checks,
          failures,
          Number(blockNumber) >= Number(deploymentJson.deploymentBlockNumber),
          "Ponder has indexed at or beyond the deployment block",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addCheck(
        checks,
        failures,
        false,
        `Ponder readiness probe failed: ${message}`,
      );
    }
  } else {
    addCheck(
      checks,
      failures,
      !requireTargets,
      "live Ponder probe skipped because WORLDCHAIN_PONDER_URL is unset",
    );
  }

  if (appUrl) {
    for (const path of ["/", "/ask", "/docs/ai", "/api/agent/templates"]) {
      try {
        const response = await fetchWithTimeout(new URL(path, appUrl));
        addCheck(
          checks,
          failures,
          response.status < 500,
          `app route ${path} returns below HTTP 500`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addCheck(
          checks,
          failures,
          false,
          `app route ${path} probe failed: ${message}`,
        );
      }
    }
  } else {
    addCheck(
      checks,
      failures,
      !requireTargets,
      "live app probe skipped because WORLDCHAIN_APP_URL is unset",
    );
  }

  return { ok: failures.length === 0, checks, failures };
}

function parseArgs(argv) {
  const canary = argv.includes("--canary");
  const production = argv.includes("--production");
  if (canary && production) {
    throw new Error("Use only one of --canary or --production.");
  }

  return {
    expectedMode: canary ? "canary" : "production",
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
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  let offlineInputs;
  try {
    offlineInputs = loadOfflineInputs();
  } catch (error) {
    if (
      error?.code === "ENOENT" &&
      error.path?.endsWith(WORLDCHAIN_DEPLOYMENT_ARTIFACT)
    ) {
      console.error(mainnetNotDeployedMessage());
      process.exit(1);
      return;
    }
    throw error;
  }
  const offlineResult = validateOfflineReadiness({
    ...offlineInputs,
    expectedMode: args.expectedMode,
  });
  printResult(
    `World Chain mainnet ${args.expectedMode} offline readiness`,
    offlineResult,
    args.json,
  );

  let liveResult = { ok: true, checks: [], failures: [] };
  if (args.live) {
    liveResult = await validateLiveReadiness({
      appUrl: process.env.WORLDCHAIN_APP_URL,
      deploymentJson: offlineInputs.deploymentJson,
      expectedMode: args.expectedMode,
      ponderUrl: process.env.WORLDCHAIN_PONDER_URL,
      requireTargets: args.requireLiveTargets,
      rpcUrl: process.env.WORLDCHAIN_RPC_URL,
    });
    printResult(
      `World Chain mainnet ${args.expectedMode} live readiness`,
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
