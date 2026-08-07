import { assertVercelSessionOutlivesDeploy, runTokenlessVercel } from "./deploy-tokenless-vercel.mjs";
import { TOKENLESS_VERCEL_PROJECT } from "./tokenless-vercel-project.mjs";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

function fixture({ packageLink = TOKENLESS_VERCEL_PROJECT, rootLink = TOKENLESS_VERCEL_PROJECT } = {}) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "rateloop-vercel-command-"));
  const packageRoot = path.join(repoRoot, "packages/nextjs");
  mkdirSync(path.join(repoRoot, ".vercel"), { recursive: true });
  mkdirSync(path.join(packageRoot, ".vercel"), { recursive: true });
  if (rootLink) writeFileSync(path.join(repoRoot, ".vercel/project.json"), JSON.stringify(rootLink));
  if (packageLink) writeFileSync(path.join(packageRoot, ".vercel/project.json"), JSON.stringify(packageLink));
  return { packageRoot, repoRoot };
}

test("the tracked canonical command validates both links before deploying from the repository root", () => {
  const rootPackage = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  const nextPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(rootPackage.scripts.vercel, "yarn workspace @rateloop/nextjs vercel");
  assert.equal(nextPackage.scripts.vercel, "node scripts/deploy-tokenless-vercel.mjs");

  const paths = fixture();
  const calls = [];
  let inspectCount = 0;
  const status = runTokenlessVercel({
    ...paths,
    forwardedArgs: ["--prod", "--yes"],
    spawn: (...args) => {
      calls.push(args);
      if (args[1].includes("inspect")) {
        inspectCount += 1;
        return {
          status: 0,
          stdout: JSON.stringify({
            aliases: ["rateloop-tokenless.vercel.app"],
            id: `dpl_${inspectCount}`,
            name: TOKENLESS_VERCEL_PROJECT.projectName,
            readyState: "READY",
            target: "production",
          }),
        };
      }
      return { status: 0 };
    },
  });
  assert.equal(status, 0);
  assert.equal(calls.length, 3);
  const deployCall = calls[1];
  assert.equal(deployCall[0], "yarn");
  assert.deepEqual(deployCall[1], ["exec", "vercel", "--cwd", paths.repoRoot, "--prod", "--yes"]);
  assert.equal(deployCall[1].includes("--project"), false);
  assert.equal(deployCall[1].includes("--build-env"), false);
});

test("a production deploy fails closed when Vercel exits zero without moving the alias", () => {
  const paths = fixture();
  const deployment = JSON.stringify({
    aliases: ["rateloop-tokenless.vercel.app"],
    id: "dpl_unchanged",
    name: TOKENLESS_VERCEL_PROJECT.projectName,
    readyState: "READY",
    target: "production",
  });
  assert.throws(
    () =>
      runTokenlessVercel({
        ...paths,
        forwardedArgs: ["--prod", "--yes"],
        spawn: (_command, args) => (args.includes("inspect") ? { status: 0, stdout: deployment } : { status: 0 }),
      }),
    /no-op deployment/i,
  );
});

test("a production deploy fails closed when the resulting alias cannot be verified", () => {
  const paths = fixture();
  let inspectCount = 0;
  assert.throws(
    () =>
      runTokenlessVercel({
        ...paths,
        forwardedArgs: ["--prod", "--yes"],
        spawn: (_command, args) => {
          if (!args.includes("inspect")) return { status: 0 };
          inspectCount += 1;
          if (inspectCount === 1) return { status: 1, stdout: "" };
          return { status: 0, stdout: "Vercel CLI 54.18.0" };
        },
      }),
    /did not expose a ready production deployment/i,
  );
});

for (const [name, links] of [
  ["missing root link", { rootLink: null }],
  ["missing package link", { packageLink: null }],
  ["legacy root link", { rootLink: { projectId: "prj_legacy", projectName: "rate-loop-nextjs" } }],
  ["legacy package link", { packageLink: { projectId: "prj_legacy", projectName: "rate-loop-nextjs" } }],
]) {
  test(`the deploy command fails closed for a ${name}`, () => {
    let spawnCount = 0;
    assert.throws(
      () =>
        runTokenlessVercel({
          ...fixture(links),
          forwardedArgs: ["--prod"],
          spawn: () => {
            spawnCount += 1;
            return { status: 0 };
          },
        }),
      /aborted before contacting Vercel/i,
    );
    assert.equal(spawnCount, 0);
  });
}

const HOUR = 3_600_000;

test("a deploy is refused when the Vercel session cannot outlive it", () => {
  // The CLI validates its token once, at startup, with no margin. A session that
  // expires during the build kills the CLI while Vercel's builder finishes, which
  // reports a failure for a deployment that succeeded. That cost a confusing hour.
  const auth = expiresAt => () => JSON.stringify({ expiresAt, token: "redacted" });
  const now = Date.UTC(2026, 7, 7, 15, 30);

  assert.throws(
    () =>
      assertVercelSessionOutlivesDeploy({
        env: { HOME: "/home/dev" },
        now,
        platform: "linux",
        readFileSync: auth(Math.floor((now + 3 * 60_000) / 1000)),
      }),
    /expires in 3m/u,
  );
  assert.throws(
    () =>
      assertVercelSessionOutlivesDeploy({
        env: { HOME: "/home/dev" },
        now,
        platform: "linux",
        readFileSync: auth(Math.floor((now - HOUR) / 1000)),
      }),
    /has expired/u,
  );
  // Comfortable session, token auth, and an unreadable file all proceed: the
  // preflight exists to catch a known failure, not to gate on its own guesses.
  assertVercelSessionOutlivesDeploy({
    env: { HOME: "/home/dev" },
    now,
    platform: "linux",
    readFileSync: auth(Math.floor((now + 4 * HOUR) / 1000)),
  });
  assertVercelSessionOutlivesDeploy({
    env: { HOME: "/home/dev", VERCEL_TOKEN: "redacted" },
    now,
    platform: "linux",
    readFileSync: () => {
      throw new Error("must not read the session file when a token is configured");
    },
  });
  assertVercelSessionOutlivesDeploy({
    env: { HOME: "/home/dev" },
    now,
    platform: "linux",
    readFileSync: () => {
      throw new Error("ENOENT");
    },
  });
});

test("a CLI failure over a verified new deployment reports its own exit code", () => {
  // Exit 2 rather than 0 or 1: the site is correct but the run was not clean, so
  // a caller neither believes it failed nor chains on as if nothing happened.
  const paths = fixture();
  let inspectCount = 0;
  const spawn = (...args) => {
    if (args[1].includes("inspect")) {
      inspectCount += 1;
      return {
        status: 0,
        stdout: JSON.stringify({
          aliases: ["rateloop-tokenless.vercel.app"],
          id: `dpl_${inspectCount}`,
          name: TOKENLESS_VERCEL_PROJECT.projectName,
          readyState: "READY",
          target: "production",
        }),
      };
    }
    return { status: 1 };
  };
  assert.equal(runTokenlessVercel({ ...paths, forwardedArgs: ["--prod"], spawn }), 2);
});

test("an unauthorized verification is reported as unknown, not as failure", () => {
  // "We could not ask" and "the deployment is wrong" must not collapse together:
  // a blind retry could duplicate a deployment that already succeeded.
  const paths = fixture();
  assert.throws(
    () =>
      runTokenlessVercel({
        ...paths,
        forwardedArgs: ["--prod"],
        spawn: (...args) =>
          args[1].includes("inspect") ? { status: 1, stderr: "Error: Not authorized" } : { status: 1 },
      }),
    /status is unknown/u,
  );
});
