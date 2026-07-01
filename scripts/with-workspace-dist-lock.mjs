import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LOCK_HELD_ENV = "RATELOOP_WORKSPACE_DIST_LOCK_HELD";
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STALE_LOCK_MS = Number.parseInt(process.env.RATELOOP_WORKSPACE_DIST_LOCK_STALE_MS ?? "", 10) || 10 * 60_000;
const RETRY_MS = Number.parseInt(process.env.RATELOOP_WORKSPACE_DIST_LOCK_RETRY_MS ?? "", 10) || 250;
const HEARTBEAT_MS =
  Number.parseInt(process.env.RATELOOP_WORKSPACE_DIST_LOCK_HEARTBEAT_MS ?? "", 10) ||
  Math.max(25, Math.min(30_000, Math.floor(STALE_LOCK_MS / 3)));
const REMOVE_LOCK_OPTIONS = { force: true, recursive: true, maxRetries: 5, retryDelay: RETRY_MS };

function hashScope(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function defaultLockScope() {
  const railwayParts = [
    process.env.RAILWAY_PROJECT_ID,
    process.env.RAILWAY_PROJECT_NAME,
    process.env.RAILWAY_ENVIRONMENT_ID,
    process.env.RAILWAY_ENVIRONMENT_NAME,
    process.env.RAILWAY_SERVICE_ID,
    process.env.RAILWAY_SERVICE_NAME,
    process.env.RAILWAY_DEPLOYMENT_ID,
    process.env.RAILWAY_REPLICA_ID,
    process.env.RAILWAY_GIT_COMMIT_SHA,
    process.env.RAILWAY_GIT_BRANCH,
  ].filter(Boolean);

  if (railwayParts.length > 0) {
    if (!process.env.RAILWAY_DEPLOYMENT_ID && !process.env.RAILWAY_REPLICA_ID) {
      railwayParts.push(`pid:${process.pid}`);
    }
    return `railway-${hashScope(railwayParts.join(":"))}`;
  }

  // Railpack builds unpack the repo under /app on shared builders. Without
  // Railway metadata in the build env, keep those ephemeral builds isolated.
  if (process.env.RATELOOP_WORKSPACE_DIST_LOCK_EPHEMERAL === "1" || REPO_ROOT === "/app") {
    return `ephemeral-${hashScope(`${REPO_ROOT}:${process.pid}`)}`;
  }

  return `local-${hashScope(REPO_ROOT)}`;
}

const DEFAULT_LOCK_DIR = join(tmpdir(), `rateloop-workspace-dist-${defaultLockScope()}.lock`);

function usage() {
  console.error('Usage: node scripts/with-workspace-dist-lock.mjs "<command>"');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ownerPath(lockDir) {
  return join(lockDir, "owner.json");
}

function heartbeatPath(lockDir, token) {
  return join(lockDir, `heartbeat.${token}.json`);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function parseOwner(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function readOwner(lockDir) {
  const raw = await readFile(ownerPath(lockDir), "utf8").catch(() => null);
  return raw ? parseOwner(raw) : null;
}

async function readHeartbeat(lockDir, token) {
  if (!token) return null;
  const raw = await readFile(heartbeatPath(lockDir, token), "utf8").catch(() => null);
  return raw ? parseOwner(raw) : null;
}

function timestampMs(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ownerAgeMs(owner, stats, heartbeat = null) {
  const timestamp =
    timestampMs(heartbeat?.updatedAt) ??
    timestampMs(owner?.updatedAt) ??
    timestampMs(owner?.startedAt) ??
    (Number.isFinite(stats?.mtimeMs) ? stats.mtimeMs : null);
  return timestamp === null ? null : Date.now() - timestamp;
}

async function lockDirectoryIdentity(lockDir) {
  const stats = await stat(lockDir);
  return { dev: stats.dev, ino: stats.ino };
}

function sameLockDirectoryIdentity(left, right) {
  return Boolean(left && right && left.dev === right.dev && left.ino === right.ino);
}

async function assertLockDirectoryIdentity(lockDir, owner) {
  if (!owner.lockDirectory) return;
  const current = await lockDirectoryIdentity(lockDir);
  if (!sameLockDirectoryIdentity(current, owner.lockDirectory)) {
    throw new Error("Workspace dist lock directory is now owned by another process.");
  }
}

async function lockDirectoryStillOwned(lockDir, owner) {
  if (!owner.lockDirectory) return true;
  const current = await lockDirectoryIdentity(lockDir).catch(() => null);
  return sameLockDirectoryIdentity(current, owner.lockDirectory);
}

async function writeOwner(lockDir, owner) {
  await assertLockDirectoryIdentity(lockDir, owner);
  const nextOwner = {
    ...owner,
    updatedAt: new Date().toISOString(),
  };
  const temporaryPath = join(lockDir, `owner.${process.pid}.${owner.token}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(nextOwner)}\n`, "utf8");
  await assertLockDirectoryIdentity(lockDir, owner);
  await rename(temporaryPath, ownerPath(lockDir));
}

async function writeHeartbeat(lockDir, owner) {
  await assertLockDirectoryIdentity(lockDir, owner);
  const existing = await readOwner(lockDir);
  if (existing?.token !== owner.token) {
    throw new Error("Workspace dist lock is now owned by another process.");
  }

  const heartbeat = {
    pid: owner.pid,
    token: owner.token,
    updatedAt: new Date().toISOString(),
  };
  const temporaryPath = join(lockDir, `heartbeat.${process.pid}.${owner.token}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(heartbeat)}\n`, "utf8");
  await assertLockDirectoryIdentity(lockDir, owner);
  await rename(temporaryPath, heartbeatPath(lockDir, owner.token));
}

function startHeartbeat(lockDir, owner) {
  const heartbeat = setInterval(() => {
    writeHeartbeat(lockDir, owner).catch(() => {
      clearInterval(heartbeat);
    });
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  return () => clearInterval(heartbeat);
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      env: {
        ...process.env,
        [LOCK_HELD_ENV]: "1",
      },
      shell: true,
      stdio: "inherit",
    });

    const forwardSigint = () => {
      child.kill("SIGINT");
    };
    const forwardSigterm = () => {
      child.kill("SIGTERM");
    };
    process.once("SIGINT", forwardSigint);
    process.once("SIGTERM", forwardSigterm);

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      process.off("SIGINT", forwardSigint);
      process.off("SIGTERM", forwardSigterm);
      if (signal) {
        resolve(128 + (signal === "SIGINT" ? 2 : 15));
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

async function acquireLock(lockDir) {
  const owner = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    token: randomUUID(),
  };

  while (true) {
    try {
      await mkdir(lockDir);
      owner.lockDirectory = await lockDirectoryIdentity(lockDir);
      await writeOwner(lockDir, owner);
      await writeHeartbeat(lockDir, owner);
      return owner;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const stats = await stat(lockDir).catch(() => null);
      const currentOwner = await readOwner(lockDir);
      const currentHeartbeat = await readHeartbeat(lockDir, currentOwner?.token);
      const ageMs = ownerAgeMs(currentOwner, stats, currentHeartbeat);
      const ownerAlive = isPidAlive(currentOwner?.pid);
      const legacyLiveOwner = ownerAlive && !currentOwner?.token && !currentOwner?.updatedAt;
      const heartbeatExpired = currentOwner?.updatedAt && ageMs !== null && ageMs > STALE_LOCK_MS;
      const deadOwnerExpired = !ownerAlive && ageMs !== null && ageMs > STALE_LOCK_MS;

      const ownerMissingAndDirectoryExpired =
        !currentOwner && stats && Date.now() - stats.mtimeMs > STALE_LOCK_MS;

      if (!legacyLiveOwner && (heartbeatExpired || deadOwnerExpired || ownerMissingAndDirectoryExpired)) {
        await rm(lockDir, REMOVE_LOCK_OPTIONS);
        continue;
      }

      await sleep(RETRY_MS);
    }
  }
}

async function releaseLock(lockDir, owner) {
  if (!(await lockDirectoryStillOwned(lockDir, owner))) {
    return;
  }
  const currentOwner = await readOwner(lockDir);
  if (currentOwner?.token !== owner.token) {
    return;
  }
  await rm(lockDir, REMOVE_LOCK_OPTIONS);
}

const command = process.argv.slice(2).join(" ").trim();
if (!command) {
  usage();
  process.exit(2);
}

if (process.env[LOCK_HELD_ENV] === "1") {
  process.exit(await runCommand(command));
}

const lockDir = process.env.RATELOOP_WORKSPACE_DIST_LOCK_DIR || DEFAULT_LOCK_DIR;
const owner = await acquireLock(lockDir);
const stopHeartbeat = startHeartbeat(lockDir, owner);

let exitCode = 1;
try {
  exitCode = await runCommand(command);
} finally {
  stopHeartbeat();
  await releaseLock(lockDir, owner);
}

process.exit(exitCode);
