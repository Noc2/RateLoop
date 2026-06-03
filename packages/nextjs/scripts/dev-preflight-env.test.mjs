import assert from "node:assert/strict";
import test from "node:test";

import { buildNextDevEnv, disableExperimentalWebStorageFlag } from "./dev-preflight-env.mjs";

test("leaves supported Node dev env unchanged", () => {
  const env = { NODE_OPTIONS: "--trace-warnings" };

  assert.equal(buildNextDevEnv({ currentNodeMajor: 24, env, supportedNodeMajor: 24 }), env);
});

test("appends the Web Storage opt-out on Node 26", () => {
  const env = buildNextDevEnv({
    currentNodeMajor: 26,
    env: { NODE_OPTIONS: "--trace-warnings" },
    supportedNodeMajor: 24,
  });

  assert.equal(env.NODE_OPTIONS, `--trace-warnings ${disableExperimentalWebStorageFlag}`);
});

test("does not duplicate an existing Web Storage opt-out", () => {
  const originalEnv = { NODE_OPTIONS: disableExperimentalWebStorageFlag };

  assert.equal(
    buildNextDevEnv({ currentNodeMajor: 26, env: originalEnv, supportedNodeMajor: 24 }),
    originalEnv,
  );
});
