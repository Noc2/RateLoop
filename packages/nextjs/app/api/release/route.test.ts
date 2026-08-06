import { releaseIdentityResponse } from "./route";
import assert from "node:assert/strict";
import test from "node:test";
import { TOKENLESS_RELEASE_PROJECT } from "~~/lib/tokenless/releaseIdentity";

const SHA = "b".repeat(40);

test("public release identity is no-store and contains no environment secrets", async () => {
  const response = releaseIdentityResponse({
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "tokenless",
    VERCEL_GIT_COMMIT_SHA: SHA,
    VERCEL_PROJECT_ID: TOKENLESS_RELEASE_PROJECT.projectId,
    DATABASE_URL: "postgresql://must-not-appear",
    BETTER_AUTH_SECRET: "must-not-appear",
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, no-store, max-age=0");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const body = await response.json();
  assert.deepEqual(body.git, { ref: "tokenless", sha: SHA });
  assert.deepEqual(body.project, {
    id: TOKENLESS_RELEASE_PROJECT.projectId,
    name: TOKENLESS_RELEASE_PROJECT.projectName,
  });
  assert.doesNotMatch(JSON.stringify(body), /must-not-appear/u);
});

test("public release identity returns a generic unavailable response on project mismatch", async () => {
  const response = releaseIdentityResponse({
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "tokenless",
    VERCEL_GIT_COMMIT_SHA: SHA,
    VERCEL_PROJECT_ID: "prj_legacy",
  });

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "public, no-store, max-age=0");
  assert.deepEqual(await response.json(), {
    schemaVersion: "rateloop.release-identity.v1",
    deploymentLine: "tokenless",
    status: "unavailable",
  });
});
