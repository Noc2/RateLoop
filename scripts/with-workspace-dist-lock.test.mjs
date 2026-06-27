import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SCRIPT = "scripts/with-workspace-dist-lock.mjs";

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nodeEval(code) {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code.replace(/\s+/g, " ").trim())}`;
}

async function makeTempDir() {
  return mkdtemp(join(tmpdir(), "rateloop-dist-lock-test-"));
}

function lockEnv(lockDir, overrides = {}) {
  return {
    ...process.env,
    RATELOOP_WORKSPACE_DIST_LOCK_DIR: lockDir,
    RATELOOP_WORKSPACE_DIST_LOCK_HEARTBEAT_MS: "25",
    RATELOOP_WORKSPACE_DIST_LOCK_RETRY_MS: "20",
    RATELOOP_WORKSPACE_DIST_LOCK_STALE_MS: "80",
    ...overrides,
  };
}

function spawnLock(command, env) {
  const child = spawn(process.execPath, [SCRIPT, command], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => {
    stdout += chunk;
  });
  child.stderr.on("data", chunk => {
    stderr += chunk;
  });
  const result = new Promise(resolve => {
    child.on("exit", (code, signal) => {
      resolve({ code, signal, stderr, stdout });
    });
  });
  return { child, result };
}

async function runLock(command, env) {
  return spawnLock(command, env).result;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("active workspace dist locks heartbeat instead of going stale", async () => {
  const tempDir = await makeTempDir();
  const lockDir = join(tempDir, "workspace-dist.lock");
  const env = lockEnv(lockDir);
  const first = spawnLock(nodeEval("setTimeout(() => process.exit(0), 450);"), env);

  try {
    await sleep(140);
    const startedAt = Date.now();
    const second = await runLock(nodeEval("process.exit(0);"), env);
    const waitedMs = Date.now() - startedAt;

    assert.equal(second.code, 0, second.stderr);
    assert.ok(
      waitedMs >= 200,
      `second lock holder should wait for the active heartbeat, but only waited ${waitedMs}ms`,
    );
    assert.equal((await first.result).code, 0);
  } finally {
    first.child.kill("SIGTERM");
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("stale dead-owner workspace dist locks are reclaimed", async () => {
  const tempDir = await makeTempDir();
  const lockDir = join(tempDir, "workspace-dist.lock");
  const marker = join(tempDir, "ran.txt");
  await mkdir(lockDir);
  await writeFile(
    join(lockDir, "owner.json"),
    `${JSON.stringify({ pid: process.pid + 999_999, startedAt: "2000-01-01T00:00:00.000Z" })}\n`,
    "utf8",
  );

  try {
    const result = await runLock(nodeEval(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ok");`), lockEnv(lockDir));

    assert.equal(result.code, 0, result.stderr);
    assert.equal(await readFile(marker, "utf8"), "ok");
    assert.equal(await pathExists(lockDir), false);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("legacy live-owner workspace dist locks are not stolen", async () => {
  const tempDir = await makeTempDir();
  const lockDir = join(tempDir, "workspace-dist.lock");
  const marker = join(tempDir, "ran.txt");
  await mkdir(lockDir);
  await writeFile(
    join(lockDir, "owner.json"),
    `${JSON.stringify({ pid: process.pid, startedAt: "2000-01-01T00:00:00.000Z" })}\n`,
    "utf8",
  );
  const waiting = spawnLock(nodeEval(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "stolen");`), lockEnv(lockDir));

  try {
    await sleep(180);
    assert.equal(await pathExists(marker), false);
  } finally {
    waiting.child.kill("SIGTERM");
    await waiting.result;
    await rm(tempDir, { force: true, recursive: true });
  }
});

test("releasing an old workspace dist lock does not delete a newer owner", async () => {
  const tempDir = await makeTempDir();
  const lockDir = join(tempDir, "workspace-dist.lock");
  const command = nodeEval(`
    const fs = require("node:fs");
    const path = require("node:path");
    const lockDir = process.env.RATELOOP_WORKSPACE_DIST_LOCK_DIR;
    fs.rmSync(lockDir, { force: true, recursive: true });
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token: "new-owner",
      updatedAt: new Date().toISOString(),
    }) + "\\n");
  `);

  try {
    const result = await runLock(command, lockEnv(lockDir));
    assert.equal(result.code, 0, result.stderr);
    const owner = JSON.parse(await readFile(join(lockDir, "owner.json"), "utf8"));
    assert.equal(owner.token, "new-owner");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
