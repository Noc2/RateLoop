import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LOCK_HELD_ENV = "RATELOOP_WORKSPACE_DIST_LOCK_HELD";
const DEFAULT_LOCK_DIR = join(tmpdir(), "rateloop-workspace-dist.lock");
const STALE_LOCK_MS = Number.parseInt(process.env.RATELOOP_WORKSPACE_DIST_LOCK_STALE_MS ?? "", 10) || 10 * 60_000;
const RETRY_MS = Number.parseInt(process.env.RATELOOP_WORKSPACE_DIST_LOCK_RETRY_MS ?? "", 10) || 250;

function usage() {
  console.error('Usage: node scripts/with-workspace-dist-lock.mjs "<command>"');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  while (true) {
    try {
      await mkdir(lockDir);
      await writeFile(
        join(lockDir, "owner.json"),
        `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
        "utf8",
      );
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const stats = await stat(lockDir).catch(() => null);
      if (stats && Date.now() - stats.mtimeMs > STALE_LOCK_MS) {
        await rm(lockDir, { force: true, recursive: true });
        continue;
      }

      await sleep(RETRY_MS);
    }
  }
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
await acquireLock(lockDir);

let exitCode = 1;
try {
  exitCode = await runCommand(command);
} finally {
  await rm(lockDir, { force: true, recursive: true });
}

process.exit(exitCode);
