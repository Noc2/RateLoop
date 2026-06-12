import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(scriptDir);
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const WORLDCHAIN_SEPOLIA_CHAIN_ID = 4801;
const WORLDCHAIN_SEPOLIA_CHAIN_ID_HEX = "0x12c1";
const WORLDCHAIN_SEPOLIA_USDC = "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88";
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const SUBMISSION_MEDIA_VALIDATOR_SELECTOR = "0x738dbaa0";
const SUBMISSION_MEDIA_VALIDATOR_AUTHORIZED_EMITTER_SELECTOR = "0xb717bbbd";
export const REQUIRED_SUBMISSION_MEDIA_VALIDATOR_SELECTORS = [
  "0x6773a34f", // validateContextSubmission(string,string[],string,string,string,bool)
  "0x6b974e07", // validateSubmissionDetails(string,bytes32,bool)
];

export const REQUIRED_DEPLOYED_CONTRACTS = [
  "AdvisoryVoteRecorder",
  "CategoryRegistry",
  "ClusterPayoutOracle",
  "ConfidentialityEscrow",
  "ContentRegistry",
  "FeedbackBonusEscrow",
  "FeedbackRegistry",
  "FrontendRegistry",
  "LaunchDistributionPool",
  "LoopReputation",
  "ProfileRegistry",
  "ProtocolConfig",
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
  "ConfidentialityEscrow",
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

const PROXY_CONTRACTS = new Set([
  "ConfidentialityEscrow",
  "ContentRegistry",
  "FeedbackBonusEscrow",
  "FeedbackRegistry",
  "FrontendRegistry",
  "ProfileRegistry",
  "ProtocolConfig",
  "QuestionRewardPoolEscrow",
  "RaterRegistry",
  "RoundRewardDistributor",
  "RoundVotingEngine",
]);

export const REQUIRED_SELECTOR_CHECKS = [
  {
    contractName: "X402QuestionSubmitter",
    selectors: [
      "0x1c2fa657", // computeX402QuestionPaymentNonce with confidentiality config
      "0x61b030bc", // submitQuestionWithX402Payment with confidentiality config
    ],
  },
  {
    contractName: "ContentRegistry",
    selectors: [
      "0x774922ea", // submitQuestionWithRewardAndRoundConfig with confidentiality config
    ],
  },
  {
    contractName: "ConfidentialityEscrow",
    selectors: [
      "0xe3de2a7a", // recordAccessNexus(uint256,address)
      "0x517fbf76", // recordConfidentialityNexus(uint256,address)
    ],
  },
  {
    contractName: "ProtocolConfig",
    selectors: [
      "0xd5011d75", // confidentialityEscrow()
      "0xefdd8d2b", // revokeAdvisoryVoteRecorder(address)
    ],
  },
  {
    contractName: "RoundVotingEngine",
    selectors: [
      "0x6a951316", // setRole(bytes32,address,bool)
      "0x706f3d41", // roundConfidentialityEscrowSnapshotWord(uint256,uint256)
    ],
  },
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

function extractBalancedObject(source, openBraceIndex) {
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex, index + 1);
    }
  }
  return undefined;
}

export function parseGeneratedContractsForChain(
  source,
  chainId = WORLDCHAIN_SEPOLIA_CHAIN_ID,
) {
  const marker = `  ${chainId}: {`;
  const start = source.indexOf(marker);
  if (start === -1) return new Map();

  const nextChainMatch = /\n  \d+: \{/g;
  nextChainMatch.lastIndex = start + marker.length;
  const next = nextChainMatch.exec(source);
  const chainSource = source.slice(start, next?.index ?? source.length);
  const contracts = new Map();

  for (const contractName of REQUIRED_DEPLOYED_CONTRACTS) {
    const keyMatch = new RegExp(`(?:^|[\\s{,])${contractName}:\\s*\\{`).exec(
      chainSource,
    );
    if (!keyMatch) continue;

    // Parse only inside this contract's own balanced object so a missing field
    // can never borrow a value from the next contract entry.
    const contractSource = extractBalancedObject(
      chainSource,
      keyMatch.index + keyMatch[0].length - 1,
    );
    if (!contractSource) continue;

    const addressMatch = /address:\s*"([^"]+)"/.exec(contractSource);
    const deployedOnBlockMatch = /deployedOnBlock:\s*(\d+)/.exec(
      contractSource,
    );
    contracts.set(contractName, {
      address: addressMatch?.[1],
      deployedOnBlock: deployedOnBlockMatch
        ? Number(deployedOnBlockMatch[1])
        : undefined,
    });
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
  const generatedContracts = parseGeneratedContractsForChain(
    deployedContractsSource,
  );

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
        Number.isInteger(generated?.deployedOnBlock) &&
          generated.deployedOnBlock > 0,
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
    deploymentJson: JSON.parse(
      readFileSync(
        join(root, "packages/foundry/deployments/4801.json"),
        "utf8",
      ),
    ),
    deployedContractsSource: readFileSync(
      join(root, "packages/contracts/src/deployedContracts.ts"),
      "utf8",
    ),
    questionRewardPoolsSource: readFileSync(
      join(root, "packages/nextjs/lib/questionRewardPools.ts"),
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

function parseStorageAddress(value) {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    return undefined;
  }
  const address = `0x${value.slice(-40)}`;
  return address === "0x0000000000000000000000000000000000000000"
    ? undefined
    : address;
}

export function bytecodeContainsSelector(code, selector) {
  return (
    typeof code === "string" &&
    code.toLowerCase().includes(selector.toLowerCase().slice(2))
  );
}

export async function getSelectorProbeCode(rpcUrl, contractName, address) {
  if (!PROXY_CONTRACTS.has(contractName)) {
    return {
      address,
      code: await rpc(rpcUrl, "eth_getCode", [address, "latest"]),
      target: contractName,
    };
  }

  const implementation = parseStorageAddress(
    await rpc(rpcUrl, "eth_getStorageAt", [
      address,
      EIP1967_IMPLEMENTATION_SLOT,
      "latest",
    ]),
  );
  return {
    address: implementation ?? address,
    code: await rpc(rpcUrl, "eth_getCode", [
      implementation ?? address,
      "latest",
    ]),
    target: implementation ? `${contractName} implementation` : contractName,
  };
}

export async function getSubmissionMediaValidatorAddress(
  rpcUrl,
  contentRegistryAddress,
) {
  return parseStorageAddress(
    await rpc(rpcUrl, "eth_call", [
      { to: contentRegistryAddress, data: SUBMISSION_MEDIA_VALIDATOR_SELECTOR },
      "latest",
    ]),
  );
}

export async function getSubmissionMediaValidatorAuthorizedEmitter(
  rpcUrl,
  validatorAddress,
) {
  return parseStorageAddress(
    await rpc(rpcUrl, "eth_call", [
      {
        to: validatorAddress,
        data: SUBMISSION_MEDIA_VALIDATOR_AUTHORIZED_EMITTER_SELECTOR,
      },
      "latest",
    ]),
  );
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
            authorizedEmitter?.toLowerCase() ===
              contentRegistryAddress.toLowerCase(),
            "ContentRegistry submissionMediaValidator authorizedEmitter is ContentRegistry",
          );
        }
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
      "live RPC probe skipped because WORLDCHAIN_SEPOLIA_RPC_URL is unset",
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
      "live Ponder probe skipped because WORLDCHAIN_SEPOLIA_PONDER_URL is unset",
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
