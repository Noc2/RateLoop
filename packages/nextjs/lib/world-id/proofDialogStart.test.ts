import { WORLD_CREDENTIAL_PROOF_OF_HUMAN } from "./credentials";
import { getWorldIdProofDialogAutoStartKey, getWorldIdProofDialogUnavailableMessage } from "./proofDialogStart";
import assert from "node:assert/strict";
import test from "node:test";

const READY_INPUT = {
  address: "0xAbC0000000000000000000000000000000000000",
  appId: "app_test",
  kind: WORLD_CREDENTIAL_PROOF_OF_HUMAN,
  open: true,
  purpose: "credential" as const,
  signal: "0xAbC0000000000000000000000000000000000000",
} as const;

test("getWorldIdProofDialogAutoStartKey is stable for equivalent request inputs", () => {
  assert.equal(
    getWorldIdProofDialogAutoStartKey(READY_INPUT),
    "app_test:0xabc0000000000000000000000000000000000000:3:credential:0xabc0000000000000000000000000000000000000",
  );
  assert.equal(
    getWorldIdProofDialogAutoStartKey({
      ...READY_INPUT,
      address: READY_INPUT.address.toLowerCase(),
      signal: READY_INPUT.signal.toLowerCase(),
    }),
    getWorldIdProofDialogAutoStartKey(READY_INPUT),
  );
});

test("getWorldIdProofDialogAutoStartKey changes when the proof purpose changes", () => {
  assert.notEqual(
    getWorldIdProofDialogAutoStartKey({ ...READY_INPUT, proofMode: "v4" }),
    getWorldIdProofDialogAutoStartKey({ ...READY_INPUT, proofMode: "v4", purpose: "presence" }),
  );
});

test("getWorldIdProofDialogAutoStartKey waits for configuration and wallet input", () => {
  assert.equal(getWorldIdProofDialogAutoStartKey({ ...READY_INPUT, appId: null }), null);
  assert.equal(getWorldIdProofDialogAutoStartKey({ ...READY_INPUT, address: undefined }), null);
  assert.equal(getWorldIdProofDialogAutoStartKey({ ...READY_INPUT, signal: "" }), null);
  assert.equal(getWorldIdProofDialogAutoStartKey({ ...READY_INPUT, open: false }), null);
});

test("getWorldIdProofDialogUnavailableMessage explains missing prerequisites", () => {
  assert.equal(
    getWorldIdProofDialogUnavailableMessage({ ...READY_INPUT, appId: null }),
    "World ID is not configured for this deployment.",
  );
  assert.equal(
    getWorldIdProofDialogUnavailableMessage({ ...READY_INPUT, address: undefined }),
    "Connect a wallet before verifying with World ID.",
  );
  assert.equal(getWorldIdProofDialogUnavailableMessage({ ...READY_INPUT, open: false, appId: null }), null);
  assert.equal(getWorldIdProofDialogUnavailableMessage(READY_INPUT), null);
});

test("getWorldIdProofDialogUnavailableMessage blocks v4-only actions in legacy mode", () => {
  assert.match(
    getWorldIdProofDialogUnavailableMessage({ ...READY_INPUT, purpose: "presence" }) ?? "",
    /World ID v3 credential/,
  );
  assert.equal(getWorldIdProofDialogUnavailableMessage({ ...READY_INPUT, proofMode: "v4", purpose: "presence" }), null);
});
