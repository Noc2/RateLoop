import assert from "node:assert/strict";
import test from "node:test";
import { __benchmarkResearchPersistenceTestUtils } from "~~/lib/tokenless/benchmarkResearchPersistence";
import { deriveCapabilityIssuanceIdempotency } from "~~/lib/tokenless/capabilityIssuanceIdempotency";
import { __projectWindowComplianceSharesTestUtils } from "~~/lib/tokenless/projectWindowComplianceShares";

const base = {
  actorPrincipalId: `rlp_${"a".repeat(40)}`,
  workspaceId: "workspace_idempotency",
  projectId: "project_idempotency",
  idempotencyKey: "issuance-idempotency-0001",
  request: { expiresAt: "2026-08-02T00:00:00.000Z" },
} as const;

test("both capability issuers consume the one shared idempotency invariant", () => {
  assert.equal(
    __projectWindowComplianceSharesTestUtils.deriveCapabilityIssuanceIdempotency,
    deriveCapabilityIssuanceIdempotency,
  );
  assert.equal(
    __benchmarkResearchPersistenceTestUtils.deriveCapabilityIssuanceIdempotency,
    deriveCapabilityIssuanceIdempotency,
  );
});

test("issuance bindings are deterministic, actor-scoped, kind-scoped, and contain no raw key", () => {
  const share = deriveCapabilityIssuanceIdempotency({ ...base, capabilityKind: "project_window_compliance_share" });
  const replay = deriveCapabilityIssuanceIdempotency({ ...base, capabilityKind: "project_window_compliance_share" });
  const grant = deriveCapabilityIssuanceIdempotency({ ...base, capabilityKind: "benchmark_research_grant" });
  const actor = deriveCapabilityIssuanceIdempotency({
    ...base,
    capabilityKind: "project_window_compliance_share",
    actorPrincipalId: `rlp_${"b".repeat(40)}`,
  });
  assert.deepEqual(share, replay);
  assert.notEqual(share.idempotencyKeyDigest, grant.idempotencyKeyDigest);
  assert.notEqual(share.requestBindingHash, grant.requestBindingHash);
  assert.notEqual(share.idempotencyKeyDigest, actor.idempotencyKeyDigest);
  assert.doesNotMatch(JSON.stringify([share, grant, actor]), new RegExp(base.idempotencyKey, "u"));
  assert.match(share.idempotencyKeyDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.match(share.requestBindingHash, /^sha256:[0-9a-f]{64}$/u);
});

test("issuance idempotency key boundaries fail closed", () => {
  assert.throws(
    () =>
      deriveCapabilityIssuanceIdempotency({
        ...base,
        capabilityKind: "project_window_compliance_share",
        idempotencyKey: "short",
      }),
    /idempotency key is invalid/iu,
  );
  assert.doesNotThrow(() =>
    deriveCapabilityIssuanceIdempotency({
      ...base,
      capabilityKind: "project_window_compliance_share",
      idempotencyKey: "a".repeat(160),
    }),
  );
  assert.throws(() =>
    deriveCapabilityIssuanceIdempotency({
      ...base,
      capabilityKind: "project_window_compliance_share",
      idempotencyKey: "a".repeat(161),
    }),
  );
});
