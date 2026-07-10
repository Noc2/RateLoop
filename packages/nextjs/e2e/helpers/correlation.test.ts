import { correlationKeeperEnvOverrides } from "./correlation";
import assert from "node:assert/strict";
import test from "node:test";

test("correlation artifacts use the local file-backed artifact server", () => {
  const builderEnv = correlationKeeperEnvOverrides();
  const env = correlationKeeperEnvOverrides("/tmp/correlation-artifact.json");

  assert.equal(builderEnv.KEEPER_CORRELATION_SNAPSHOTS_MODE, "auto");
  assert.equal(builderEnv.KEEPER_CORRELATION_ARTIFACT_STORAGE, "file");
  assert.equal(env.KEEPER_CORRELATION_SNAPSHOTS_MODE, "file");
  assert.equal(env.KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH, "/tmp/correlation-artifact.json");
  assert.equal(env.KEEPER_CORRELATION_ARTIFACT_STORAGE, "file");
  assert.equal(env.METRICS_ENABLED, "true");
  assert.equal(env.KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL, builderEnv.KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL);
  assert.equal(env.KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR, builderEnv.KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR);
});
