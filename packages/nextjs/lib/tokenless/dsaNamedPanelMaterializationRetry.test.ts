import assert from "node:assert/strict";
import test from "node:test";
import {
  DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_EVERY_FAILURES,
  DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_MS,
  dsaNamedPanelMaterializationFailureState,
  projectDsaNamedPanelMaterializationRetry,
} from "~~/lib/tokenless/dsaNamedPanelMaterializationRetry";

test("materialization failures enter a deterministic bounded cooldown without a permanent dead end", () => {
  assert.equal(DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_EVERY_FAILURES, 8);
  assert.equal(DSA_NAMED_PANEL_MATERIALIZATION_COOLDOWN_MS, 15 * 60_000);
  assert.equal(dsaNamedPanelMaterializationFailureState(1), "retrying");
  assert.equal(dsaNamedPanelMaterializationFailureState(7), "retrying");
  assert.equal(dsaNamedPanelMaterializationFailureState(8), "cooldown");
  assert.equal(dsaNamedPanelMaterializationFailureState(9), "retrying");
  assert.equal(dsaNamedPanelMaterializationFailureState(16), "cooldown");
  assert.throws(() => dsaNamedPanelMaterializationFailureState(0));
});

test("operational projection exposes only generic retry state, count, and due time", () => {
  assert.deepEqual(
    projectDsaNamedPanelMaterializationRetry({
      storedState: null,
      failureCount: null,
      nextRetryAt: null,
      responseComplete: false,
    }),
    { state: "ready", failureCount: 0, nextRetryAt: null },
  );
  assert.deepEqual(
    projectDsaNamedPanelMaterializationRetry({
      storedState: "cooldown",
      failureCount: 8,
      nextRetryAt: new Date("2026-08-01T12:15:00.000Z"),
      responseComplete: false,
    }),
    { state: "cooldown", failureCount: 8, nextRetryAt: "2026-08-01T12:15:00.000Z" },
  );
  assert.deepEqual(
    projectDsaNamedPanelMaterializationRetry({
      storedState: "retrying",
      failureCount: 3,
      nextRetryAt: new Date("2026-08-01T12:00:00.000Z"),
      responseComplete: true,
    }),
    { state: "ready", failureCount: 3, nextRetryAt: null },
  );
  assert.throws(() =>
    projectDsaNamedPanelMaterializationRetry({
      storedState: "failed_with_private_detail",
      failureCount: 1,
      nextRetryAt: new Date("2026-08-01T12:00:00.000Z"),
      responseComplete: false,
    }),
  );
});
