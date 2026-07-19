import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  attachTokenlessRuntimeCodeEvidence,
  reconstructTokenlessDeploymentFromBroadcast,
  serializeTokenlessDeploymentArtifact,
  TOKENLESS_BASE_SEPOLIA_CHAIN_ID,
  TOKENLESS_BASE_SEPOLIA_NETWORK,
} from "./tokenlessDeployment.js";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const foundryRoot = join(scriptDirectory, "..");

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

export async function exportTokenlessDeploymentFromBroadcast({
  broadcastPath = tokenlessBroadcastPath(),
  deploymentPath = tokenlessDeploymentPath(),
  targetNetwork = process.env.DEPLOY_TARGET_NETWORK,
  getBytecode = (address) => rpcBytecodeLoader(process.env.RPC_URL, address),
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
    getBytecode,
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
