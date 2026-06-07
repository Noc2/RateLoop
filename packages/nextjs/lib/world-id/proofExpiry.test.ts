import {
  WORLD_ID_PROOF_EXPIRED_MESSAGE,
  assertWorldIdProofHasSubmissionWindow,
  getWorldIdCredentialRequestExpiresAtMin,
  getWorldIdRequestPollingTimeoutMs,
} from "./proofExpiry";
import assert from "node:assert/strict";
import test from "node:test";

test("derives polling timeout from the signed World ID request expiry", () => {
  assert.equal(getWorldIdRequestPollingTimeoutMs({ expires_at: 1_700_000_300 }, 1_700_000_000_000), 270_000);
  assert.equal(getWorldIdRequestPollingTimeoutMs({ expires_at: "1700000300" }, 1_700_000_000_000), 270_000);
});

test("returns an expired polling timeout when the request has no submission buffer left", () => {
  assert.equal(getWorldIdRequestPollingTimeoutMs({ expires_at: 1_700_000_020 }, 1_700_000_000_000), 0);
});

test("leaves polling timeout unset when the request expiry is unavailable", () => {
  assert.equal(getWorldIdRequestPollingTimeoutMs({}), undefined);
  assert.equal(getWorldIdRequestPollingTimeoutMs({ expires_at: "soon" }), undefined);
});

test("sets credential requests to require the deployed one-year credential window", () => {
  assert.equal(getWorldIdCredentialRequestExpiresAtMin("credential", 1_700_000_000_000), 1_731_536_000);
});

test("sets presence requests to require the deployed fresh recheck window", () => {
  assert.equal(getWorldIdCredentialRequestExpiresAtMin("presence", 1_700_000_000_000), 1_700_000_900);
});

test("accepts World ID proof expiry with enough submission window", () => {
  assert.doesNotThrow(() => assertWorldIdProofHasSubmissionWindow(1_700_000_120, 1_700_000_000_000));
});

test("rejects expired or nearly expired World ID proofs before wallet submission", () => {
  assert.throws(
    () => assertWorldIdProofHasSubmissionWindow(1_700_000_020, 1_700_000_000_000),
    new RegExp(WORLD_ID_PROOF_EXPIRED_MESSAGE),
  );
  assert.throws(
    () => assertWorldIdProofHasSubmissionWindow(1_699_999_999, 1_700_000_000_000),
    new RegExp(WORLD_ID_PROOF_EXPIRED_MESSAGE),
  );
});
