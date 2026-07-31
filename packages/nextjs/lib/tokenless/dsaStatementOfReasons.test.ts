import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyDsaSorPuidLookup,
  classifyDsaSorSubmission,
  preflightDsaSorBatch,
  preflightDsaSorPayload,
} from "~~/lib/tokenless/dsaStatementOfReasons";

test("validates opaque PUIDs, batch atomicity, and safe structured payloads", () => {
  const statement = {
    puid: "rls_01JABCDEF_0001",
    payload: {
      decision_visibility: ["DECISION_VISIBILITY_CONTENT_DISABLED"],
      content_id: "4006381333931",
      legal_reference_url: "https://eur-lex.europa.eu/legal-content/EN/TXT/",
    },
    humanConfirmedResidualFreeText: false,
    allowedPublicUrlHosts: ["eur-lex.europa.eu"],
  };
  assert.deepEqual(preflightDsaSorPayload(statement), { valid: true, violations: [] });
  assert.deepEqual(preflightDsaSorBatch({ statements: [statement] }), { valid: true, violations: [] });
  const duplicate = preflightDsaSorBatch({ statements: [statement, statement] });
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.violations.some(violation => violation.code === "duplicate_puid"));
  assert.equal(preflightDsaSorBatch({ statements: [] }).violations[0]?.code, "batch_too_large");
  assert.equal(preflightDsaSorBatch({ statements: Array.from({ length: 101 }, () => statement) }).valid, false);
});

test("fails closed on known identifiers, source identity, unsafe URLs, free text, and invalid IDs", () => {
  const result = preflightDsaSorPayload({
    puid: "person@example.com",
    payload: {
      source_identity: "named-user",
      content_id: "123",
      decision_facts: "Contact person@example.com or +49 170 1234567 from 192.168.1.1",
      evidence_url: "https://example.com/item?user=123",
    },
    humanConfirmedResidualFreeText: false,
    allowedPublicUrlHosts: ["example.com"],
  });
  assert.equal(result.valid, false);
  assert.deepEqual(
    new Set(result.violations.map(violation => violation.code)),
    new Set([
      "invalid_puid",
      "source_identity_forbidden",
      "invalid_ean13",
      "known_personal_identifier",
      "residual_free_text_unconfirmed",
      "unsafe_url",
    ]),
  );
});

test("only a complete 201 response is a creation receipt and ambiguous outcomes require PUID lookup", () => {
  const body = {
    uuid: "commission-uuid",
    id: 42,
    created_at: "2026-07-31T12:00:00.000Z",
    permalink: "https://transparency.dsa.ec.europa.eu/statement/42",
    self: "https://transparency.dsa.ec.europa.eu/api/v1/statement/42",
  };
  assert.deepEqual(classifyDsaSorSubmission(201, body), { status: "created", receipt: body });
  assert.equal(classifyDsaSorSubmission(201, {}).status, "invalid_creation_receipt");
  assert.equal(classifyDsaSorSubmission(422, {}).status, "validation_rejected");
  assert.equal(classifyDsaSorSubmission(503, {}).status, "unknown_outcome_check_puid_before_retry");
  assert.equal(classifyDsaSorSubmission(401, {}).status, "failed");
  assert.equal(classifyDsaSorPuidLookup(302), "exists");
  assert.equal(classifyDsaSorPuidLookup(404), "absent");
  assert.equal(classifyDsaSorPuidLookup(500), "unknown");
});
