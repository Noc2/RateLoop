import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  buildPonderStartArgs,
  buildProtocolDeploymentKey,
  resolvePonderChainId,
} from "./databaseSchema.mjs";
import { parseJsonRpcQuantityNumber } from "../../../scripts/json-rpc.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const contractsRoot = resolve(repoRoot, "packages/contracts");
const nodeUtilsRoot = resolve(repoRoot, "packages/node-utils");
const require = createRequire(import.meta.url);
const PRODUCTION_RPC_CHAIN_ID_TIMEOUT_MS = 5_000;
export const requiredContractsArtifacts = [
  resolve(contractsRoot, "dist/esm/abis/index.js"),
  resolve(contractsRoot, "dist/esm/deployedContracts.js"),
  resolve(contractsRoot, "dist/esm/deployments.js"),
  resolve(contractsRoot, "dist/esm/protocol.js"),
];
export const requiredNodeUtilsArtifacts = [
  resolve(nodeUtilsRoot, "dist/esm/correlationScoring.js"),
  resolve(nodeUtilsRoot, "dist/esm/json.js"),
];
export const requiredRuntimeWorkspaceArtifacts = [
  ...requiredContractsArtifacts,
  ...requiredNodeUtilsArtifacts,
];
function readEnv(env, key) {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

export async function assertProductionRpcChainId({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = PRODUCTION_RPC_CHAIN_ID_TIMEOUT_MS,
} = {}) {
  if (readEnv(env, "NODE_ENV") !== "production") return false;

  const expectedChainId = resolvePonderChainId(env);
  if (!expectedChainId) return false;

  const key = `PONDER_RPC_URL_${expectedChainId}`;
  const rpcUrl = readEnv(env, key);
  if (!rpcUrl) {
    throw new Error(`Missing ${key} for production Ponder startup.`);
  }
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "global fetch is required for production Ponder RPC chain-id validation.",
    );
  }

  let response;
  try {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${key} eth_chainId probe failed: ${message}`);
  }

  if (!response.ok) {
    throw new Error(
      `${key} returned HTTP ${response.status} on eth_chainId probe.`,
    );
  }

  const body = await response.json().catch(() => null);
  const reportedChainId = parseJsonRpcQuantityNumber(body?.result);
  if (reportedChainId === null) {
    throw new Error(`${key} eth_chainId probe returned no chainId.`);
  }
  if (reportedChainId !== expectedChainId) {
    throw new Error(
      `${key} reports chainId ${reportedChainId} but ${expectedChainId} expected.`,
    );
  }

  return true;
}

export function contractsArtifactsExist({
  exists = existsSync,
  requiredArtifacts = requiredContractsArtifacts,
} = {}) {
  return requiredArtifacts.every((path) => exists(path));
}

export function runtimeWorkspaceArtifactsExist({
  exists = existsSync,
  requiredArtifacts = requiredRuntimeWorkspaceArtifacts,
} = {}) {
  return requiredArtifacts.every((path) => exists(path));
}

export function ensureRuntimeWorkspaceArtifacts({
  exists = existsSync,
  spawnSyncImpl = spawnSync,
  cwd = repoRoot,
  requiredArtifacts = requiredRuntimeWorkspaceArtifacts,
} = {}) {
  if (runtimeWorkspaceArtifactsExist({ exists, requiredArtifacts })) {
    return false;
  }

  console.warn(
    "[ponder:start] Missing runtime workspace build artifacts; building Ponder workspace dependencies.",
  );
  const result = spawnSyncImpl(
    "yarn",
    ["workspace", "@rateloop/ponder", "build:workspace-deps"],
    {
      cwd,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw new Error(
      `Failed to build Ponder workspace dependencies: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Failed to build Ponder workspace dependencies: yarn exited with status ${result.status ?? "unknown"}.`,
    );
  }
  if (!runtimeWorkspaceArtifactsExist({ exists, requiredArtifacts })) {
    throw new Error(
      "Built Ponder workspace dependencies, but required runtime artifacts are still missing.",
    );
  }

  return true;
}

export const ensureContractsArtifacts = ensureRuntimeWorkspaceArtifacts;

export function resolveProtocolDeploymentKeyFromArtifacts({
  env = process.env,
  requireImpl = require,
} = {}) {
  const chainId = resolvePonderChainId(env);
  if (!chainId) return undefined;

  let deployments;
  try {
    deployments = requireImpl("@rateloop/contracts/deployments");
  } catch {
    return undefined;
  }

  const getSharedDeploymentAddress = deployments.getSharedDeploymentAddress;
  if (typeof getSharedDeploymentAddress !== "function") return undefined;

  const contentRegistryAddress = getSharedDeploymentAddress(
    chainId,
    "ContentRegistry",
  );
  const feedbackRegistryAddress = getSharedDeploymentAddress(
    chainId,
    "FeedbackRegistry",
  );
  if (!contentRegistryAddress || !feedbackRegistryAddress) return undefined;

  return buildProtocolDeploymentKey({
    chainId,
    contentRegistryAddress,
    feedbackRegistryAddress,
  });
}

function withProtocolDeploymentKey(env, resolveProtocolDeploymentKeyImpl) {
  const configuredDeploymentKey = readEnv(
    env,
    "RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY",
  );
  const artifactDeploymentKey = resolveProtocolDeploymentKeyImpl({ env });
  const enforceArtifactDeploymentKey = readEnv(env, "PONDER_NETWORK") === "base";

  if (
    enforceArtifactDeploymentKey &&
    configuredDeploymentKey &&
    artifactDeploymentKey &&
    configuredDeploymentKey.toLowerCase() !== artifactDeploymentKey.toLowerCase()
  ) {
    throw new Error(
      `RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY=${configuredDeploymentKey} does not match the shared deployment artifacts (${artifactDeploymentKey}). ` +
        "Remove the stale environment override or refresh the shared deployment artifacts before starting Ponder.",
    );
  }

  const deploymentKey =
    configuredDeploymentKey && !enforceArtifactDeploymentKey
      ? configuredDeploymentKey
      : artifactDeploymentKey ?? configuredDeploymentKey;
  if (!deploymentKey) return env;

  return {
    ...env,
    RATELOOP_PONDER_PROTOCOL_DEPLOYMENT_KEY: deploymentKey,
  };
}

export async function startPonder({
  argv = process.argv.slice(2),
  env = process.env,
  spawnImpl = spawn,
  assertProductionRpcChainIdImpl = assertProductionRpcChainId,
  ensureContractsArtifactsImpl,
  ensureRuntimeWorkspaceArtifactsImpl = ensureRuntimeWorkspaceArtifacts,
  resolveProtocolDeploymentKeyImpl = resolveProtocolDeploymentKeyFromArtifacts,
} = {}) {
  const ensureArtifactsImpl =
    ensureContractsArtifactsImpl ?? ensureRuntimeWorkspaceArtifactsImpl;
  ensureArtifactsImpl();
  await assertProductionRpcChainIdImpl({ env });

  const launcherEnv = withProtocolDeploymentKey(
    env,
    resolveProtocolDeploymentKeyImpl,
  );
  const {
    args,
    env: childEnv,
    schemaInfo,
  } = buildPonderStartArgs(argv, launcherEnv);

  if (schemaInfo?.ignoredLiveSchemaOverride) {
    console.warn(
      `[ponder:start] Ignoring live Ponder schema override; using protocol deployment-scoped schema ${schemaInfo.schema}.`,
    );
    console.warn(
      "[ponder:start] Remove stale RATELOOP_PONDER_DATABASE_SCHEMA or DATABASE_SCHEMA env vars, or set RATELOOP_PONDER_ALLOW_LIVE_SCHEMA_OVERRIDE=true only for deliberate recovery.",
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await startPonder();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ponder:start] ${message}`);
    process.exitCode = 1;
  }
}
