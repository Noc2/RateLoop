#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { MissingDockerComposeError, ensureLocalDatabase, formatDatabaseTarget, resolveNextDatabaseConfig } from "./dev-db.mjs";
import { applyKeeperDevStackEnvDefaults, getMissingKeeperEnvVars } from "./dev-stack-keeper.mjs";
import { resolvePonderDatabaseSchema } from "../packages/ponder/scripts/databaseSchema.mjs";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(currentFile), "..");
const nextProjectDir = path.join(repoRoot, "packages", "nextjs");
const ponderProjectDir = path.join(repoRoot, "packages", "ponder");
const nextDevLockPath = path.join(nextProjectDir, ".next-dev.lock");
const ponderEnvPath = path.join(ponderProjectDir, ".env.local");
const ponderPgliteDir = path.join(ponderProjectDir, ".ponder", "pglite");
const ponderDeploymentFingerprintPath = path.join(ponderProjectDir, ".ponder", "dev-stack-deployment-fingerprint");
const deployedContractsPath = path.join(repoRoot, "packages", "contracts", "src", "deployedContracts.ts");
const yarnCommand = process.platform === "win32" ? "yarn.cmd" : "yarn";
const baseServices = [
  {
    name: "Ponder",
    label: "ponder",
    color: "\u001b[36m",
    command: yarnCommand,
    args: ["workspace", "@rateloop/ponder", "dev:built-contracts"],
  },
  {
    name: "Next",
    label: "next",
    color: "\u001b[33m",
    command: yarnCommand,
    args: ["workspace", "@rateloop/nextjs", "dev:built-workspace-deps"],
  },
];
const keeperService = {
  name: "Keeper",
  label: "keeper",
  color: "\u001b[35m",
  command: yarnCommand,
  args: ["workspace", "@rateloop/keeper", "dev:built-workspace-deps"],
};
const ponderNetworkChainIds = {
  hardhat: "31337",
  baseSepolia: "84532",
  base: "8453",
  worldchainSepolia: "4801",
  worldchain: "480",
};
const allowRemoteDbPushFlag = "--allow-remote-db-push";
const skipDbPushFlag = "--skip-db-push";
export const LOCAL_E2E_CONFIDENTIALITY_JOB_SECRET = "rateloop-local-e2e-confidentiality-job-secret";
const ponderLocalDeploymentEnvKeys = [
  "PONDER_ADVISORY_VOTE_RECORDER_ADDRESS",
  "PONDER_CATEGORY_REGISTRY_ADDRESS",
  "PONDER_CLUSTER_PAYOUT_ORACLE_ADDRESS",
  "PONDER_CONTENT_REGISTRY_ADDRESS",
  "PONDER_FEEDBACK_BONUS_ESCROW_ADDRESS",
  "PONDER_FEEDBACK_REGISTRY_ADDRESS",
  "PONDER_FRONTEND_REGISTRY_ADDRESS",
  "PONDER_LAUNCH_DISTRIBUTION_POOL_ADDRESS",
  "PONDER_LREP_ADDRESS",
  "PONDER_PROFILE_REGISTRY_ADDRESS",
  "PONDER_QUESTION_REWARD_POOL_ESCROW_ADDRESS",
  "PONDER_RATER_REGISTRY_ADDRESS",
  "PONDER_ROUND_REWARD_DISTRIBUTOR_ADDRESS",
  "PONDER_ROUND_VOTING_ENGINE_ADDRESS",
];
const resetColor = "\u001b[0m";
const ponderRpcProbeTimeoutMs = 2_500;
const managedChildren = [];
let shuttingDown = false;

function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

function readActiveNextDevLock() {
  if (!existsSync(nextDevLockPath)) return null;

  try {
    const raw = readFileSync(nextDevLockPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pid === "number" && pidIsAlive(parsed.pid)) {
      return parsed;
    }
  } catch {
    // Ignore malformed/stale locks here. Next's own preflight handles cleanup.
  }

  return null;
}

function prefixOutput(stream, target, prefix) {
  let buffer = "";

  stream.on("data", chunk => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      target.write(`${prefix} ${line}\n`);
    }
  });

  stream.on("end", () => {
    if (buffer) {
      target.write(`${prefix} ${buffer}\n`);
    }
  });
}

function warnIfMissing(filePath, message) {
  if (!existsSync(filePath)) {
    console.warn(`[dev-stack] ${message}`);
  }
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const values = {};
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }

  return values;
}

function isLocalPonderRpcUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

function getPonderNetworkFromEnv(env) {
  return env.PONDER_NETWORK?.trim() || "hardhat";
}

function getPonderRpcUrlFromEnv(env) {
  return env.PONDER_RPC_URL_31337?.trim() || "http://127.0.0.1:8545";
}

export function getPonderRpcPreflightPlan({
  ponderNetwork = "hardhat",
  ponderRpcUrl = "http://127.0.0.1:8545",
} = {}) {
  if (ponderNetwork !== "hardhat" || !isLocalPonderRpcUrl(ponderRpcUrl)) {
    return {
      shouldCheck: false,
      reason: "Ponder is not targeting local hardhat",
    };
  }

  return {
    shouldCheck: true,
    rpcUrl: ponderRpcUrl,
    expectedChainId: "31337",
    envKey: "PONDER_RPC_URL_31337",
  };
}

function formatPonderRpcStartupHelp(rpcUrl) {
  return (
    `Ponder is configured for local hardhat at ${rpcUrl}, but that RPC is not ready.\n` +
    "[dev-stack] Start Anvil with `yarn chain` in another terminal, run `yarn deploy` after the chain is ready, then rerun `yarn dev:stack`.\n" +
    "[dev-stack] To use a deployed network instead, update packages/ponder/.env.local with the matching PONDER_NETWORK and RPC URL."
  );
}

function getFetchFailureMessage(error, timeoutMs) {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return `timed out after ${timeoutMs}ms`;
    }

    if (error.cause instanceof Error && error.cause.message && error.cause.message !== error.message) {
      return `${error.message}: ${error.cause.message}`;
    }

    return error.message;
  }

  return String(error);
}

export async function getPonderRpcReadinessError({
  ponderNetwork = "hardhat",
  ponderRpcUrl = "http://127.0.0.1:8545",
  fetchImpl = fetch,
  timeoutMs = ponderRpcProbeTimeoutMs,
} = {}) {
  const plan = getPonderRpcPreflightPlan({ ponderNetwork, ponderRpcUrl });
  if (!plan.shouldCheck) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(plan.rpcUrl, {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      headers: { "content-type": "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    return `${formatPonderRpcStartupHelp(plan.rpcUrl)}\n[dev-stack] ${plan.envKey} probe failed: ${getFetchFailureMessage(error, timeoutMs)}.`;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    return `${formatPonderRpcStartupHelp(plan.rpcUrl)}\n[dev-stack] ${plan.envKey} returned HTTP ${response.status} on eth_chainId.`;
  }

  const body = await response.json().catch(() => null);
  const reportedChainId = typeof body?.result === "string" ? Number.parseInt(body.result, 16) : NaN;
  if (!Number.isFinite(reportedChainId)) {
    return `${formatPonderRpcStartupHelp(plan.rpcUrl)}\n[dev-stack] ${plan.envKey} returned no chainId from eth_chainId.`;
  }

  if (String(reportedChainId) !== plan.expectedChainId) {
    return (
      `${formatPonderRpcStartupHelp(plan.rpcUrl)}\n` +
      `[dev-stack] ${plan.envKey} reports chain ${reportedChainId}, but local hardhat expects chain ${plan.expectedChainId}.`
    );
  }

  return null;
}

export function getDevStackNetworkAlignmentWarning({
  keeperEnabled = false,
  keeperEnv = {},
  ponderEnv = {},
} = {}) {
  if (!keeperEnabled) return null;

  const ponderBaseUrl = keeperEnv.PONDER_BASE_URL?.trim();
  if (!ponderBaseUrl || !isLocalPonderRpcUrl(ponderBaseUrl)) return null;

  const ponderNetwork = getPonderNetworkFromEnv(ponderEnv);
  const ponderChainId = ponderNetworkChainIds[ponderNetwork];
  const keeperChainId = keeperEnv.CHAIN_ID?.trim();

  if (!ponderChainId || !keeperChainId || keeperChainId === ponderChainId) {
    return null;
  }

  return (
    `Keeper is configured for chain ${keeperChainId}, but its PONDER_BASE_URL points at the local Ponder service ` +
    `while Ponder is configured for ${ponderNetwork} (chain ${ponderChainId}). ` +
    "Update packages/keeper/.env.local and packages/ponder/.env.local to target the same chain, " +
    "or set PONDER_BASE_URL to the matching remote Ponder API."
  );
}

export function getPonderDeploymentFingerprint({ deployedContractsContent, env = {} } = {}) {
  if (!deployedContractsContent) return null;

  const hash = createHash("sha256").update(deployedContractsContent);
  for (const key of ponderLocalDeploymentEnvKeys) {
    const value = env[key]?.trim();
    if (value) {
      hash.update("\0").update(key).update("=").update(value);
    }
  }

  return hash.digest("hex");
}

function getDeploymentFingerprint(env) {
  if (!existsSync(deployedContractsPath)) return null;

  return getPonderDeploymentFingerprint({
    deployedContractsContent: readFileSync(deployedContractsPath, "utf8"),
    env,
  });
}

export function getPonderDataResetPlan({
  ponderNetwork = "hardhat",
  ponderRpcUrl = "http://127.0.0.1:8545",
  currentFingerprint,
  storedFingerprint,
  hasPglite,
} = {}) {
  if (ponderNetwork !== "hardhat" || !isLocalPonderRpcUrl(ponderRpcUrl)) {
    return {
      shouldRecord: false,
      shouldReset: false,
      reason: "Ponder is not targeting local hardhat",
    };
  }

  if (!currentFingerprint) {
    return {
      shouldRecord: false,
      shouldReset: false,
      reason: "deployment fingerprint is unavailable",
    };
  }

  if (storedFingerprint === currentFingerprint) {
    return {
      shouldRecord: false,
      shouldReset: false,
      reason: "local deployment artifact is unchanged",
    };
  }

  return {
    shouldRecord: true,
    shouldReset: hasPglite,
    reason: storedFingerprint ? "local deployment artifact changed" : "no local deployment fingerprint was recorded",
  };
}

function resetLocalPonderDataIfDeploymentChanged(env) {
  const currentFingerprint = getDeploymentFingerprint(env);
  const storedFingerprint = existsSync(ponderDeploymentFingerprintPath)
    ? readFileSync(ponderDeploymentFingerprintPath, "utf8").trim()
    : undefined;
  const plan = getPonderDataResetPlan({
    ponderNetwork: getPonderNetworkFromEnv(env),
    ponderRpcUrl: getPonderRpcUrlFromEnv(env),
    currentFingerprint,
    storedFingerprint,
    hasPglite: existsSync(ponderPgliteDir),
  });

  if (plan.shouldReset) {
    rmSync(ponderPgliteDir, { recursive: true, force: true });
    console.log(`[dev-stack] Cleared local Ponder PGlite data because ${plan.reason}.`);
  }

  if (plan.shouldRecord && currentFingerprint) {
    mkdirSync(path.dirname(ponderDeploymentFingerprintPath), { recursive: true });
    writeFileSync(ponderDeploymentFingerprintPath, `${currentFingerprint}\n`);
  }
}

function resolveKeeperStartupStatus() {
  const keeperEnvPath = path.join(repoRoot, "packages", "keeper", ".env.local");
  const nextEnvPath = path.join(repoRoot, "packages", "nextjs", ".env.local");
  const nextEnvFromFile = parseEnvFile(nextEnvPath);
  const envFromFile = parseEnvFile(keeperEnvPath);
  const env = applyKeeperDevStackEnvDefaults({
    NEXT_PUBLIC_PONDER_URL: nextEnvFromFile.NEXT_PUBLIC_PONDER_URL,
    ...envFromFile,
    ...process.env,
  });
  const missing = getMissingKeeperEnvVars(env);

  return {
    keeperEnvPath,
    enabled: missing.length === 0,
    missing,
    env,
  };
}

function resolvePonderStartupEnv() {
  const envFromFile = parseEnvFile(ponderEnvPath);
  return { ...envFromFile, ...process.env };
}

function getPonderChainIdFromEnv(env = {}) {
  return ponderNetworkChainIds[getPonderNetworkFromEnv(env)];
}

export function resolvePonderServiceEnv(env = {}) {
  const schemaInfo = resolvePonderDatabaseSchema(env);
  const serviceEnv = {
    ...env,
    DATABASE_SCHEMA: schemaInfo.schema,
  };

  if (
    getPonderNetworkFromEnv(serviceEnv) === "hardhat" &&
    isLocalPonderRpcUrl(getPonderRpcUrlFromEnv(serviceEnv)) &&
    !serviceEnv.PONDER_METADATA_SYNC_TOKEN?.trim() &&
    !serviceEnv.PONDER_METADATA_SYNC_ALLOW_OPEN?.trim()
  ) {
    serviceEnv.PONDER_METADATA_SYNC_ALLOW_OPEN = "true";
  }

  return serviceEnv;
}

export function resolveNextServiceEnv({
  databaseUrl,
  ponderEnv = {},
  baseEnv = process.env,
} = {}) {
  const env = {
    DATABASE_URL: databaseUrl,
  };
  const ponderChainId = getPonderChainIdFromEnv(ponderEnv);

  if (!ponderChainId) return env;

  if (!baseEnv.NEXT_PUBLIC_TARGET_NETWORKS?.trim()) {
    env.NEXT_PUBLIC_TARGET_NETWORKS = ponderChainId;
  }

  if (!baseEnv.RATELOOP_E2E_PRODUCTION_BUILD?.trim()) {
    env.RATELOOP_E2E_PRODUCTION_BUILD = "true";
  }

  if (!baseEnv.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD?.trim()) {
    env.NEXT_PUBLIC_RATELOOP_E2E_PRODUCTION_BUILD = "true";
  }

  if (!baseEnv.RATELOOP_IMAGE_MODERATION_MODE?.trim()) {
    env.RATELOOP_IMAGE_MODERATION_MODE = "disabled";
  }

  if (!baseEnv.RATELOOP_QUESTION_DETAILS_MODERATION_MODE?.trim()) {
    env.RATELOOP_QUESTION_DETAILS_MODERATION_MODE = "disabled";
  }

  if (
    ponderChainId === "31337" &&
    !baseEnv.RATELOOP_CONFIDENTIALITY_JOB_SECRET?.trim() &&
    !baseEnv.CRON_SECRET?.trim()
  ) {
    env.RATELOOP_CONFIDENTIALITY_JOB_SECRET = LOCAL_E2E_CONFIDENTIALITY_JOB_SECRET;
  }

  const rpcEnvKey = `NEXT_PUBLIC_RPC_URL_${ponderChainId}`;
  const ponderRpcUrl = ponderEnv[`PONDER_RPC_URL_${ponderChainId}`]?.trim();
  if (!baseEnv[rpcEnvKey]?.trim() && ponderRpcUrl) {
    env[rpcEnvKey] = ponderRpcUrl;
  }

  return env;
}

function printMissingDockerHelp(databaseConfig) {
  console.error("[dev-stack] Docker is not available for the local Postgres helper.");
  console.error("[dev-stack] Choose one of these next steps:");
  console.error("[dev-stack]  1. Install Docker Desktop, then rerun `yarn dev:stack`.");
  console.error(
    `[dev-stack]  2. Start Postgres yourself at ${databaseConfig.host}:${databaseConfig.port}/${databaseConfig.databaseName}, set DATABASE_URL, then run \`yarn dev:stack --skip-db\`.`,
  );
}

function outputIndicatesFailure(output) {
  return (
    /(^|\n)\s*(Error|error):/m.test(output) ||
    /severity:\s*['"]FATAL['"]/i.test(output) ||
    /connect\s+(EPERM|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND)\b/i.test(output)
  );
}

function outputHasMissingRoleError(output) {
  return /role\s+"[^"]+"\s+does not exist/i.test(output);
}

function envFlagIsEnabled(name) {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function getDbPushPlan(databaseConfig, options = {}) {
  if (options.skipDbPush) {
    return {
      shouldRun: false,
      reason: "Next.js schema push was disabled",
    };
  }

  if (databaseConfig.isMemory) {
    return {
      shouldRun: false,
      reason: "DATABASE_URL uses the in-memory development database",
    };
  }

  if (!databaseConfig.isLocal && !options.allowRemoteDbPush) {
    return {
      shouldRun: false,
      reason: `DATABASE_URL points to non-local ${formatDatabaseTarget(databaseConfig)}`,
      help:
        "Apply numbered SQL migrations through the deployment database migration process. " +
        "`db:push` is controlled schema sync, not the deploy migration runner; " +
        `rerun dev-stack with ${allowRemoteDbPushFlag} only when you explicitly want schema sync against this database.`,
    };
  }

  return {
    shouldRun: true,
  };
}

function runDbPush(databaseConfig, options = {}) {
  const plan = getDbPushPlan(databaseConfig, options);
  if (!plan.shouldRun) {
    console.log(`[dev-stack] Skipping Next.js schema push because ${plan.reason}.`);
    if (plan.help) {
      console.log(`[dev-stack] ${plan.help}`);
    }
    return;
  }

  if (!databaseConfig.isLocal) {
    console.warn(`[dev-stack] Remote schema push explicitly enabled for ${formatDatabaseTarget(databaseConfig)}.`);
  }

  console.log(`[dev-stack] Applying the Next.js database schema at ${formatDatabaseTarget(databaseConfig)}...`);

  const inheritStdio = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const dbPushArgs = ["workspace", "@rateloop/nextjs", "db:push"];
  if (databaseConfig.isLocal) {
    dbPushArgs.push("--force");
  }

  const result = spawnSync(yarnCommand, dbPushArgs, {
    cwd: repoRoot,
    ...(inheritStdio ? { stdio: "inherit" } : { encoding: "utf8" }),
    env: {
      ...process.env,
      DATABASE_URL: databaseConfig.url,
    },
  });

  if (!inheritStdio) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0 || outputIndicatesFailure(combinedOutput)) {
    if (databaseConfig.isLocal && outputHasMissingRoleError(combinedOutput)) {
      throw new Error(
        `Failed to apply the Next.js database schema against ${formatDatabaseTarget(databaseConfig)} because the local Postgres volume was initialized with different credentials. ` +
          "Run `yarn dev:db:reset` once, then rerun `yarn dev:stack`.",
      );
    }

    throw new Error(
      `Failed to apply the Next.js database schema against ${formatDatabaseTarget(databaseConfig)}. ` +
        "If you are using your own local Postgres, set DATABASE_URL to a valid role/password and rerun with `yarn dev:stack --skip-db`.",
    );
  }
}

export function getUnexpectedServiceExitCode(code) {
  // A managed service exiting on its own is an abnormal teardown, so the
  // stack must report failure even when the service itself exited with 0.
  return typeof code === "number" && code !== 0 ? code : 1;
}

export function getDevStackServices({ keeperEnabled = false } = {}) {
  return keeperEnabled ? [...baseServices, keeperService] : [...baseServices];
}

function buildWorkspaceDependencies() {
  console.log("[dev-stack] Building shared workspace dependencies before starting services...");
  const result = spawnSync(yarnCommand, ["build:workspace-deps"], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error("Failed to build shared workspace dependencies before starting the dev stack.");
  }
}

function spawnService(service, extraEnv = {}) {
  const prefix = `${service.color}[${service.label}]${resetColor}`;
  const child = spawn(service.command, service.args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...extraEnv,
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  managedChildren.push(child);
  prefixOutput(child.stdout, process.stdout, prefix);
  prefixOutput(child.stderr, process.stderr, prefix);

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    const suffix = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[dev-stack] ${service.name} exited with ${suffix}. Shutting down the rest of the stack.`);
    shutdown(getUnexpectedServiceExitCode(code));
  });

  child.on("error", error => {
    if (shuttingDown) return;

    console.error(`[dev-stack] Failed to start ${service.name}: ${error.message}`);
    shutdown(1);
  });
}

async function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of managedChildren) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  await new Promise(resolve => setTimeout(resolve, 2_000));

  for (const child of managedChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }

  process.exit(exitCode);
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage: node scripts/dev-stack.mjs [--skip-db] [--skip-db-push] [--allow-remote-db-push]

Starts the local app stack:
  - local Postgres for the Next app
  - Next.js schema push for local databases
  - Ponder
  - Next.js
  - Keeper (when configured)

Options:
  --skip-db                 Do not start the local Postgres container
  --skip-db-push            Do not apply the Next.js database schema
  --allow-remote-db-push    Allow dev-stack to run db:push against a non-local DATABASE_URL

Environment:
  RATELOOP_DEV_STACK_SKIP_DB_PUSH=1
`);
    return;
  }

  const databaseConfig = resolveNextDatabaseConfig();
  const skipDb = process.argv.includes("--skip-db");
  const skipDbPush = process.argv.includes(skipDbPushFlag) || envFlagIsEnabled("RATELOOP_DEV_STACK_SKIP_DB_PUSH");
  const allowRemoteDbPush = process.argv.includes(allowRemoteDbPushFlag);
  const activeNextDevLock = readActiveNextDevLock();
  const keeperStartup = resolveKeeperStartupStatus();

  warnIfMissing(
    ponderEnvPath,
    "packages/ponder/.env.local is missing. Ponder will use defaults where it can, but RPC/network settings may be incomplete.",
  );

  if (activeNextDevLock) {
    console.error(
      `[dev-stack] Next is already running for this workspace (PID ${activeNextDevLock.pid}). ` +
        "Stop that process before running `yarn dev:stack` so the full stack can start cleanly.",
    );
    process.exit(1);
  }

  if (skipDb) {
    console.log(`[dev-stack] Skipping local Postgres. Using ${formatDatabaseTarget(databaseConfig)}.`);
  } else {
    try {
      const localDbResult = await ensureLocalDatabase(databaseConfig);
      if (localDbResult.skipped) {
        console.log(`[dev-stack] Skipping local Postgres because ${localDbResult.reason}.`);
      }
    } catch (error) {
      if (error instanceof MissingDockerComposeError) {
        printMissingDockerHelp(databaseConfig);
        process.exit(1);
      }
      throw error;
    }
  }

  runDbPush(databaseConfig, { skipDbPush, allowRemoteDbPush });
  const ponderStartupEnv = resolvePonderStartupEnv();
  const ponderReadinessError = await getPonderRpcReadinessError({
    ponderNetwork: getPonderNetworkFromEnv(ponderStartupEnv),
    ponderRpcUrl: getPonderRpcUrlFromEnv(ponderStartupEnv),
  });
  if (ponderReadinessError) {
    throw new Error(ponderReadinessError);
  }

  resetLocalPonderDataIfDeploymentChanged(ponderStartupEnv);

  const alignmentWarning = getDevStackNetworkAlignmentWarning({
    keeperEnabled: keeperStartup.enabled,
    keeperEnv: keeperStartup.env,
    ponderEnv: ponderStartupEnv,
  });
  if (alignmentWarning) {
    console.warn(`[dev-stack] ${alignmentWarning}`);
  }

  const services = getDevStackServices({ keeperEnabled: keeperStartup.enabled });
  if (!keeperStartup.enabled) {
    console.log(
      `[dev-stack] Skipping Keeper because ${keeperStartup.missing.join(", ")} is not configured in the environment or ${path.relative(repoRoot, keeperStartup.keeperEnvPath)}.`,
    );
  }

  buildWorkspaceDependencies();

  console.log(`[dev-stack] Starting ${services.map(service => service.name).join(", ")}...`);
  console.log("[dev-stack] Deployment stays separate. Point your env files at the chain you already deployed to.");

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  const ponderServiceEnv = resolvePonderServiceEnv(ponderStartupEnv);
  const nextServiceEnv = resolveNextServiceEnv({
    databaseUrl: databaseConfig.url,
    ponderEnv: ponderStartupEnv,
  });
  for (const service of services) {
    const serviceEnv =
      service.label === "keeper"
        ? keeperStartup.env
        : service.label === "ponder"
          ? ponderServiceEnv
          : service.label === "next"
            ? nextServiceEnv
          : {};

    spawnService(service, serviceEnv);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(`[dev-stack] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
