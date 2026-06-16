import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { buildPonderStartArgs, buildProtocolDeploymentKey } from "./databaseSchema.mjs";
import { PONDER_NETWORK_CHAIN_IDS } from "../src/protocol-deployment.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const contractsRoot = resolve(repoRoot, "packages/contracts");
const require = createRequire(import.meta.url);
export const requiredContractsArtifacts = [
  resolve(contractsRoot, "dist/esm/abis/index.js"),
  resolve(contractsRoot, "dist/esm/deployedContracts.js"),
  resolve(contractsRoot, "dist/esm/deployments.js"),
  resolve(contractsRoot, "dist/esm/protocol.js"),
];
function readEnv(env, key) {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function resolveChainId(env) {
  const ponderNetwork = readEnv(env, "PONDER_NETWORK");
  const networkChainId = PONDER_NETWORK_CHAIN_IDS[ponderNetwork];
  const explicitChainId = Number.parseInt(readEnv(env, "PONDER_CHAIN_ID") ?? "", 10);
  if (Number.isSafeInteger(explicitChainId) && explicitChainId > 0) {
    if (networkChainId !== undefined && explicitChainId !== networkChainId) {
      throw new Error(
        `PONDER_CHAIN_ID ${explicitChainId} does not match PONDER_NETWORK ${ponderNetwork} (${networkChainId}).`,
      );
    }
    if (ponderNetwork !== undefined && networkChainId === undefined) return undefined;
    return explicitChainId;
  }

  return networkChainId;
}

export function contractsArtifactsExist({
  exists = existsSync,
  requiredArtifacts = requiredContractsArtifacts,
} = {}) {
  return requiredArtifacts.every((path) => exists(path));
}

export function ensureContractsArtifacts({
  exists = existsSync,
  spawnSyncImpl = spawnSync,
  cwd = repoRoot,
  requiredArtifacts = requiredContractsArtifacts,
} = {}) {
  if (contractsArtifactsExist({ exists, requiredArtifacts })) {
    return false;
  }

  console.warn("[ponder:start] Missing @rateloop/contracts build artifacts; building the contracts workspace.");
  const result = spawnSyncImpl("yarn", ["workspace", "@rateloop/contracts", "build"], {
    cwd,
    stdio: "inherit",
  });

  if (result.error) {
    throw new Error(`Failed to build @rateloop/contracts: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Failed to build @rateloop/contracts: yarn exited with status ${result.status ?? "unknown"}.`);
  }
  if (!contractsArtifactsExist({ exists, requiredArtifacts })) {
    throw new Error("Built @rateloop/contracts, but required Ponder contract artifacts are still missing.");
  }

  return true;
}

export function resolveProtocolDeploymentKeyFromArtifacts({
  env = process.env,
  requireImpl = require,
} = {}) {
  const chainId = resolveChainId(env);
  if (!chainId) return undefined;

  let deployments;
  try {
    deployments = requireImpl("@rateloop/contracts/deployments");
  } catch {
    return undefined;
  }

  const getSharedDeploymentAddress = deployments.getSharedDeploymentAddress;
  if (typeof getSharedDeploymentAddress !== "function") return undefined;

  const contentRegistryAddress = getSharedDeploymentAddress(chainId, "ContentRegistry");
  const feedbackRegistryAddress = getSharedDeploymentAddress(chainId, "FeedbackRegistry");
  if (!contentRegistryAddress || !feedbackRegistryAddress) return undefined;

  return buildProtocolDeploymentKey({
    chainId,
    contentRegistryAddress,
    feedbackRegistryAddress,
  });
}

function withProtocolDeploymentKey(env, resolveProtocolDeploymentKeyImpl) {
  if (readEnv(env, "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY") || readEnv(env, "RATELOOP_PROTOCOL_DEPLOYMENT_KEY")) {
    return env;
  }

  const deploymentKey = resolveProtocolDeploymentKeyImpl({ env });
  if (!deploymentKey) return env;

  return {
    ...env,
    RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
  };
}

export function startPonder({
  argv = process.argv.slice(2),
  env = process.env,
  spawnImpl = spawn,
  ensureContractsArtifactsImpl = ensureContractsArtifacts,
  resolveProtocolDeploymentKeyImpl = resolveProtocolDeploymentKeyFromArtifacts,
} = {}) {
  ensureContractsArtifactsImpl();

  const launcherEnv = withProtocolDeploymentKey(env, resolveProtocolDeploymentKeyImpl);
  const { args, env: childEnv, schemaInfo } = buildPonderStartArgs(argv, launcherEnv);

  if (schemaInfo?.ignoredLegacyDatabaseSchema) {
    console.warn(
      `[ponder:start] Ignoring DATABASE_SCHEMA=ponder to avoid colliding with legacy Ponder app metadata; using ${schemaInfo.schema}.`,
    );
    console.warn("[ponder:start] Set RATELOOP_PONDER_DATABASE_SCHEMA to choose a different Ponder schema.");
  } else if (schemaInfo?.ignoredDeprecatedStaticSchema) {
    console.warn(
      `[ponder:start] Ignoring deprecated static Ponder schema override on Railway; using deployment-scoped schema ${schemaInfo.schema}.`,
    );
    console.warn(
      "[ponder:start] Remove RATELOOP_PONDER_DATABASE_SCHEMA=rateloop_ponder_worldchain_canary (or DATABASE_SCHEMA with the same value) from Railway env vars.",
    );
  } else if (schemaInfo?.source === "RAILWAY_DEPLOYMENT_ID") {
    console.warn(
      `[ponder:start] Using Railway deployment-scoped Ponder schema ${schemaInfo.schema}.`,
    );
  } else if (schemaInfo?.source === "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY") {
    console.warn(
      `[ponder:start] Using protocol deployment-scoped Ponder schema ${schemaInfo.schema}.`,
    );
  } else if (schemaInfo?.source === "default") {
    console.warn(
      `[ponder:start] DATABASE_SCHEMA is not set; using RateLoop's production default schema ${schemaInfo.schema}.`,
    );
  }

  const child = spawnImpl("ponder", args, {
    env: childEnv,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`[ponder:start] Failed to start Ponder: ${error.message}`);
    process.exitCode = 1;
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exitCode = code ?? 1;
  });

  return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    startPonder();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ponder:start] ${message}`);
    process.exitCode = 1;
  }
}
