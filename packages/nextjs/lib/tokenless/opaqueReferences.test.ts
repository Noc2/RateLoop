import assert from "node:assert/strict";
import test from "node:test";
import { isOpaqueSubjectReference } from "~~/lib/tokenless/opaqueReferences";

test("opaque subject references accept only supported SHA-256 and HMAC schemes", () => {
  assert.equal(isOpaqueSubjectReference(`sha256:${"1".repeat(64)}`), true);
  assert.equal(isOpaqueSubjectReference(`hmac-sha256:${"2".repeat(64)}`), true);
  assert.equal(isOpaqueSubjectReference(`hmac-sha256:hmac-v1:${"3".repeat(64)}`), true);
  assert.equal(isOpaqueSubjectReference(`hmac-sha256:world.subject_2026-07:${"4".repeat(64)}`), true);
  assert.equal(isOpaqueSubjectReference(`hmac-sha256::${"5".repeat(64)}`), false);
  assert.equal(isOpaqueSubjectReference(`hmac-sha256:hmac/v1:${"6".repeat(64)}`), false);
  assert.equal(isOpaqueSubjectReference(`hmac-sha256:hmac-v1:${"g".repeat(64)}`), false);
  assert.equal(isOpaqueSubjectReference("world-nullifier-plaintext"), false);
});
