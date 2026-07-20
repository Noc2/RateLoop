import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";

import {
  attachTokenlessRuntimeCodeEvidence,
  reconstructTokenlessDeploymentFromBroadcast,
  serializeTokenlessDeploymentArtifact,
  TOKENLESS_BASE_SEPOLIA_CHAIN_ID,
  TOKENLESS_BASE_SEPOLIA_NETWORK,
} from "./tokenlessDeployment.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const foundryRoot = join(scriptDirectory, "..");
const DEFAULT_BYTECODE_RETRY_ATTEMPTS = 30;
const DEFAULT_BYTECODE_RETRY_DELAY_MS = 1_000;

export function tokenlessBroadcastPath(root = foundryRoot) {
  return join(
    root,
    "broadcast",
    "DeployTokenless.s.sol",
    String(TOKENLESS_BASE_SEPOLIA_CHAIN_ID),
    "run-latest.json",
  );
}

export function tokenlessDeploymentPath(root = foundryRoot) {
  return join(
    root,
    "deployments",
    "tokenless-v4",
    `${TOKENLESS_BASE_SEPOLIA_CHAIN_ID}.json`,
  );
}

export function compiledBeaconVerifierRuntimeCodeHash(root = foundryRoot) {
  const artifactPath = join(
    root,
    "out",
    "QuicknetTBeaconVerifier.sol",
    "QuicknetTBeaconVerifier.json",
  );
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Missing compiled QuicknetTBeaconVerifier artifact ${artifactPath}. Run the deploy-profile build first.`,
    );
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  const bytecode = artifact.deployedBytecode?.object;
  if (typeof bytecode !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(bytecode)) {
    throw new Error("Compiled QuicknetTBeaconVerifier has no exact deployed runtime bytecode.");
  }
  return keccak256(bytecode).toLowerCase();
}

async function rpcBytecodeLoader(rpcUrl, address) {
  if (!rpcUrl) throw new Error("RPC_URL is required to bind runtime bytecode evidence.");
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getCode",
      params: [address, "latest"],
    }),
  });
  if (!response.ok) throw new Error(`RPC bytecode request failed with HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.error) throw new Error(`RPC bytecode request failed: ${payload.error.message ?? "unknown error"}.`);
  return payload.result;
}

function hasDeployedBytecode(value) {
  return typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/u.test(value);
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function loadBytecodeAfterRpcPropagation(
  getBytecode,
  address,
  {
    attempts = DEFAULT_BYTECODE_RETRY_ATTEMPTS,
    delayMs = DEFAULT_BYTECODE_RETRY_DELAY_MS,
    waitForRetry = wait,
  } = {},
) {
  if (!Number.isSafeInteger(attempts) || attempts <= 0) {
    throw new Error("bytecodeRetryAttempts must be a positive integer.");
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
    throw new Error("bytecodeRetryDelayMs must be a non-negative integer.");
  }

  let lastResult;
  let lastError;
  // A successful Forge receipt can reach one load-balanced RPC backend before
  // eth_getCode reaches another. Retry only the evidence read; never the deploy.
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastResult = await getBytecode(address);
      lastError = undefined;
      if (hasDeployedBytecode(lastResult)) return lastResult;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) await waitForRetry(delayMs);
  }
  if (lastError) throw lastError;
  return lastResult;
}

export async function exportTokenlessDeploymentFromBroadcast({
  broadcastPath = tokenlessBroadcastPath(),
  deploymentPath = tokenlessDeploymentPath(),
  targetNetwork = process.env.DEPLOY_TARGET_NETWORK,
  getBytecode = (address) => rpcBytecodeLoader(process.env.RPC_URL, address),
  expectedBeaconVerifierRuntimeCodeHash = compiledBeaconVerifierRuntimeCodeHash(),
  bytecodeRetryAttempts = DEFAULT_BYTECODE_RETRY_ATTEMPTS,
  bytecodeRetryDelayMs = DEFAULT_BYTECODE_RETRY_DELAY_MS,
  waitForBytecodeRetry = wait,
} = {}) {
  if (targetNetwork !== TOKENLESS_BASE_SEPOLIA_NETWORK) {
    throw new Error(
      `Tokenless deployment export requires DEPLOY_TARGET_NETWORK=${TOKENLESS_BASE_SEPOLIA_NETWORK}.`,
    );
  }
  if (!existsSync(broadcastPath)) {
    throw new Error(`Missing tokenless broadcast ${broadcastPath}.`);
  }

  const broadcast = JSON.parse(readFileSync(broadcastPath, "utf8"));
  const reconstructed = reconstructTokenlessDeploymentFromBroadcast(broadcast);
  const artifact = await attachTokenlessRuntimeCodeEvidence(reconstructed, {
    getBytecode: (address) =>
      loadBytecodeAfterRpcPropagation(getBytecode, address, {
        attempts: bytecodeRetryAttempts,
        delayMs: bytecodeRetryDelayMs,
        waitForRetry: waitForBytecodeRetry,
      }),
    expectedBeaconVerifierRuntimeCodeHash,
  });

  mkdirSync(dirname(deploymentPath), { recursive: true });
  writeFileSync(
    deploymentPath,
    serializeTokenlessDeploymentArtifact(artifact),
    "utf8",
  );
  return { artifact, deploymentPath };
}

async function main() {
  const { artifact, deploymentPath } = await exportTokenlessDeploymentFromBroadcast();
  console.log(
    `Exported ${artifact.schemaVersion} deployment to ${deploymentPath}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(
      `[export-tokenless-deployment] ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}
