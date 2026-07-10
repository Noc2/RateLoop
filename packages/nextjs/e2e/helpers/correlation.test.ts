import { correlationKeeperEnvOverrides } from "./correlation";
import assert from "node:assert/strict";
import test from "node:test";

test("prebuilt correlation artifacts do not configure a localhost public artifact server", () => {
  const env = correlationKeeperEnvOverrides("/tmp/correlation-artifact.json");

  assert.equal(env.KEEPER_CORRELATION_SNAPSHOTS_MODE, "file");
  assert.equal(env.KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH, "/tmp/correlation-artifact.json");
  assert.equal(env.KEEPER_CORRELATION_ARTIFACT_STORAGE, "data-uri");
  assert.equal(env.METRICS_ENABLED, "false");
  assert.equal("KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL" in env, false);
  assert.equal("KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR" in env, false);
});
