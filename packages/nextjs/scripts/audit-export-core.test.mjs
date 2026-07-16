import { AUDIT_GENESIS_DIGEST, auditEventDigest, verifyAuditExport } from "./audit-export-core.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

function fixture() {
  const payload = {
    action: "workspace.created",
    actorKind: "principal",
    actorReference: "rlp_owner_1234",
    assuranceMethod: "better_auth_session",
    eventId: "audit_fixture_1",
    homeRegion: "eu",
    metadata: { source: "test" },
    occurredAt: "2026-07-16T12:00:00.000Z",
    purpose: "workspace_administration",
    reason: "owner_request",
    requestCorrelation: null,
    result: "success",
    targetId: "workspace_fixture",
    targetKind: "workspace",
    workspaceId: "workspace_fixture",
    sequence: 1,
  };
  const eventDigest = auditEventDigest(AUDIT_GENESIS_DIGEST, payload);
  return {
    exportedAt: "2026-07-16T12:01:00.000Z",
    format: "rateloop-audit-v1",
    integrity: { eventCount: 1, headDigest: eventDigest, valid: true },
    events: [
      {
        event_id: payload.eventId,
        workspace_id: payload.workspaceId,
        sequence: 1,
        previous_digest: AUDIT_GENESIS_DIGEST,
        event_digest: eventDigest,
        home_region: payload.homeRegion,
        actor_kind: payload.actorKind,
        actor_reference: payload.actorReference,
        assurance_method: payload.assuranceMethod,
        action: payload.action,
        target_kind: payload.targetKind,
        target_id: payload.targetId,
        purpose: payload.purpose,
        reason: payload.reason,
        request_correlation: null,
        result: payload.result,
        metadata_json: JSON.stringify(payload.metadata),
        occurred_at: payload.occurredAt,
      },
    ],
    workspaceId: payload.workspaceId,
  };
}

test("verifies a complete exported audit chain and optional external head pin", () => {
  const exported = fixture();
  assert.equal(verifyAuditExport(exported).valid, true);
  assert.equal(verifyAuditExport(exported, { expectedHead: exported.integrity.headDigest }).valid, true);
  assert.deepEqual(verifyAuditExport(exported, { expectedHead: `sha256:${"1".repeat(64)}` }).errors, [
    "expected_head_mismatch",
  ]);
});

test("detects event and head tampering", () => {
  const altered = fixture();
  altered.events[0].reason = "tampered";
  assert.deepEqual(verifyAuditExport(altered).errors, ["event_digest_mismatch"]);
  const missing = fixture();
  missing.events = [];
  assert.deepEqual(verifyAuditExport(missing).errors, ["head_mismatch"]);
});
