import { runTokenlessVercel } from "./deploy-tokenless-vercel.mjs";
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
  const status = runTokenlessVercel({
    ...paths,
    forwardedArgs: ["--prod", "--yes"],
    spawn: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });
  assert.equal(status, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "yarn");
  assert.deepEqual(calls[0][1].slice(0, 6), [
    "exec",
    "vercel",
    "--cwd",
    paths.repoRoot,
    "--project",
    TOKENLESS_VERCEL_PROJECT.projectId,
  ]);
  assert.deepEqual(calls[0][1].slice(-2), ["--prod", "--yes"]);
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
