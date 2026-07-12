import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
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
    "run-latest.json"
  );
}

export function tokenlessDeploymentPath(root = foundryRoot) {
  return join(
    root,
    "deployments",
    "tokenless-v1",
    `${TOKENLESS_BASE_SEPOLIA_CHAIN_ID}.json`
  );
}

export function exportTokenlessDeploymentFromBroadcast({
  broadcastPath = tokenlessBroadcastPath(),
  deploymentPath = tokenlessDeploymentPath(),
  targetNetwork = process.env.DEPLOY_TARGET_NETWORK,
} = {}) {
  if (targetNetwork !== TOKENLESS_BASE_SEPOLIA_NETWORK) {
    throw new Error(
      `Tokenless deployment export requires DEPLOY_TARGET_NETWORK=${TOKENLESS_BASE_SEPOLIA_NETWORK}.`
    );
  }
  if (!existsSync(broadcastPath)) {
    throw new Error(`Missing tokenless broadcast ${broadcastPath}.`);
  }

  const broadcast = JSON.parse(readFileSync(broadcastPath, "utf8"));
  const artifact = reconstructTokenlessDeploymentFromBroadcast(broadcast);

  mkdirSync(dirname(deploymentPath), { recursive: true });
  writeFileSync(
    deploymentPath,
    serializeTokenlessDeploymentArtifact(artifact),
    "utf8"
  );
  return { artifact, deploymentPath };
}

async function main() {
  const { artifact, deploymentPath } = exportTokenlessDeploymentFromBroadcast();
  console.log(
    `Exported ${artifact.schemaVersion} deployment to ${deploymentPath}`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(
      `[export-tokenless-deployment] ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 1;
  }
}
