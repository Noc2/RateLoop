import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const TOKENLESS_PROJECT = {
  projectId: "prj_H6C2pfWKEAupFroHbLfzhquaNCLm",
  projectName: "rateloop-tokenless",
};

function readJson(relativeUrl) {
  return JSON.parse(readFileSync(new URL(relativeUrl, import.meta.url), "utf8"));
}

test("the canonical Vercel command deploys from the repository root into the isolated tokenless project", () => {
  const rootPackage = readJson("../../../package.json");
  const nextPackage = readJson("../package.json");
  const rootLink = readJson("../../../.vercel/project.json");
  const nextLink = readJson("../.vercel/project.json");

  assert.equal(rootPackage.scripts.vercel, "yarn workspace @rateloop/nextjs vercel");
  assert.match(nextPackage.scripts.vercel, /^vercel --cwd \.\.\/\.\./u);
  assert.deepEqual(
    { projectId: rootLink.projectId, projectName: rootLink.projectName },
    TOKENLESS_PROJECT,
  );
  assert.deepEqual(
    { projectId: nextLink.projectId, projectName: nextLink.projectName },
    TOKENLESS_PROJECT,
  );
});
