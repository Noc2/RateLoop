import {
  TOKENLESS_RELEASE_IDENTITY_SCHEMA,
  TOKENLESS_RELEASE_PROJECT,
  tokenlessReleaseIdentity,
} from "./releaseIdentity";
import assert from "node:assert/strict";
import test from "node:test";

const SHA = "a".repeat(40);

function hosted(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL: "1",
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "tokenless",
    VERCEL_GIT_COMMIT_SHA: SHA,
    VERCEL_PROJECT_ID: TOKENLESS_RELEASE_PROJECT.projectId,
    ...overrides,
  };
}

test("release identity publishes only the pinned tokenless project and safe Git identity", () => {
  assert.deepEqual(
    tokenlessReleaseIdentity({
      ...hosted(),
      DATABASE_URL: "postgresql://must-not-appear",
      TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY: "must-not-appear",
    }),
    {
      schemaVersion: TOKENLESS_RELEASE_IDENTITY_SCHEMA,
      deploymentLine: "tokenless",
      project: {
        id: TOKENLESS_RELEASE_PROJECT.projectId,
        name: TOKENLESS_RELEASE_PROJECT.projectName,
      },
      environment: "production",
      git: { ref: "tokenless", sha: SHA },
    },
  );
});

test("release identity fails closed for unexpected hosted project metadata", () => {
  for (const environment of [
    hosted({ VERCEL_PROJECT_ID: "prj_legacy" }),
    hosted({ VERCEL_ENV: "development" }),
    hosted({ VERCEL_GIT_COMMIT_SHA: "short" }),
    hosted({ VERCEL_GIT_COMMIT_REF: "tokenless\ninjected" }),
  ]) {
    assert.throws(() => tokenlessReleaseIdentity(environment), /Release identity/u);
  }
});

test("local release identity does not invent hosted Git metadata", () => {
  assert.deepEqual(tokenlessReleaseIdentity({}), {
    schemaVersion: TOKENLESS_RELEASE_IDENTITY_SCHEMA,
    deploymentLine: "tokenless",
    project: {
      id: TOKENLESS_RELEASE_PROJECT.projectId,
      name: TOKENLESS_RELEASE_PROJECT.projectName,
    },
    environment: "development",
    git: { ref: null, sha: null },
  });
});
