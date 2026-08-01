import { sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  type DsaBlindedCasePayload,
  type DsaReviewerAuthorizationSnapshot,
  type DsaWithheldCaseValues,
  freezeDsaBlindedCaseMapping,
  projectDsaBlindedReviewerCase,
} from "~~/lib/tokenless/dsaBlindedCaseProjection";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const REVIEWER = "0x1111111111111111111111111111111111111111";
const OTHER_REVIEWER = "0x2222222222222222222222222222222222222222";
const NOW = new Date("2030-01-02T12:00:00.000Z");
const FROZEN_AT = "2030-01-01T12:00:00.000Z";
const EXPIRES_AT = "2030-01-03T12:00:00.000Z";
const QUALIFICATION_EXPIRES_AT = "2030-02-01T12:00:00.000Z";

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

function payload(): DsaBlindedCasePayload {
  return {
    schemaVersion: "rateloop.dsa-blinded-case.v1",
    blindedCaseId: "dsa_case_0123456789abcdef01234567",
    content: {
      artifactId: "artifact_blinded_01",
      artifactVersion: 3,
      contentHash: sha256("frozen-content"),
      contentType: "application/json",
      language: "de-DE",
    },
    policy: {
      categoryCode: "ILLEGAL_HATE_SPEECH",
      policyHash: sha256("policy-v4"),
      policyVersion: 4,
      question: "Does the frozen content match the cited policy category?",
    },
    reference: {
      populationId: "population_2029_h2",
      populationVersion: 2,
      frameId: "frame_2029_h2_de",
      frameVersion: 1,
      sampleId: "sample_2030_01",
      sampleVersion: 1,
      position: 17,
    },
  };
}

function withheld(): DsaWithheldCaseValues {
  return {
    providerIdentity: { legalName: "Provider Alpha GmbH", tenant: "provider-alpha" },
    automatedOutcome: { action: "remove", score: "machine-score-secret" },
    internalSourceDecisionId: "decision-secret-42",
    receiptIdentifiers: ["puid-secret-99", { statementReceipt: "receipt-secret-88" }],
    mutableMetadata: { operatorNote: "confidential-note", sourceUpdatedBy: "operator-secret" },
  };
}

function authorization(mappingCommitment: `sha256:${string}`): DsaReviewerAuthorizationSnapshot {
  return {
    workspaceReviewerStatus: "active",
    workspacePrincipalStatus: "active",
    privateGroupStatus: "active",
    accessGrant: {
      status: "active",
      revokedAt: null,
      validFrom: "2029-12-01T00:00:00.000Z",
      validUntil: "2030-03-01T00:00:00.000Z",
      projectScope: "selected",
      projectIds: ["project-private-dsa"],
      maxPrivateSensitivity: "regulated",
    },
    artifactLease: {
      status: "active",
      artifactId: payload().content.artifactId,
      contentHash: payload().content.contentHash,
      expiresAt: "2030-03-01T00:00:00.000Z",
      revokedAt: null,
    },
    assignment: {
      assignmentId: "assignment-internal-01",
      status: "accepted",
      leaseState: "issued",
      workspaceId: "workspace-internal-01",
      projectId: "project-private-dsa",
      reviewerPrincipalId: REVIEWER,
      blindedCaseId: payload().blindedCaseId,
      mappingCommitment,
      frozenAt: FROZEN_AT,
      expiresAt: EXPIRES_AT,
      confidentialityAcceptedAt: FROZEN_AT,
      confidentialityTermsHash: sha256("confidentiality-terms"),
      privateSensitivity: "restricted",
    },
    qualification: {
      provenanceJson: JSON.stringify([
        {
          key: "expertise:legal:privacy-compliance",
          value: true,
          source: "owner_attested",
          assertedBy: "workspace-owner",
          verifiedAt: "2029-12-01T00:00:00.000Z",
          expiresAt: QUALIFICATION_EXPIRES_AT,
        },
      ]),
      requiredExpertiseKeys: ["legal:privacy-compliance"],
      expiresAt: QUALIFICATION_EXPIRES_AT,
    },
    conflict: {
      status: "cleared",
      declarationHash: sha256("conflict-declaration"),
      frozenAt: FROZEN_AT,
      expiresAt: QUALIFICATION_EXPIRES_AT,
    },
  };
}

function code(error: unknown) {
  return error instanceof TokenlessServiceError ? error.code : null;
}

test("an authorized reviewer receives only the deterministic frozen blinded mapping", () => {
  const first = freezeDsaBlindedCaseMapping({ payload: payload(), withheld: withheld() });
  const second = freezeDsaBlindedCaseMapping({ payload: structuredClone(payload()), withheld: withheld() });
  assert.deepEqual(second, first);
  assert.equal(second.mappingCommitment, first.mappingCommitment);
  assert.equal(second.mappingCommitment, sha256Rfc8785(payload()));

  const projected = projectDsaBlindedReviewerCase({
    principalId: REVIEWER,
    now: NOW,
    authorization: authorization(first.mappingCommitment),
    mapping: first,
    withheld: withheld(),
  });
  assert.deepEqual(projected, first);
  assert.deepEqual(Object.keys(projected).sort(), [
    "blindedCaseId",
    "content",
    "mappingCommitment",
    "policy",
    "reference",
    "schemaVersion",
  ]);
  assert.equal(Object.isFrozen(projected), true);
  assert.equal(Object.isFrozen(projected.content), true);
  assert.equal(Object.isFrozen(projected.policy), true);
  assert.equal(Object.isFrozen(projected.reference), true);

  const serialized = JSON.stringify(projected).toLocaleLowerCase("en-US");
  for (const secret of [
    "provider alpha gmbh",
    "provider-alpha",
    "remove",
    "machine-score-secret",
    "upheld",
    "appeal-secret-reason",
    "decision-secret-42",
    "puid-secret-99",
    "receipt-secret-88",
    "confidential-note",
    "operator-secret",
    "assignment-internal-01",
    "workspace-internal-01",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});

test("authorization fails closed across reviewer, roster, grant, lease, qualification, and conflict boundaries", () => {
  const mapping = freezeDsaBlindedCaseMapping({ payload: payload(), withheld: withheld() });
  const baseline = authorization(mapping.mappingCommitment);
  const cases: Array<[string, string, (value: DsaReviewerAuthorizationSnapshot) => void]> = [
    ["other reviewer", OTHER_REVIEWER, () => undefined],
    ["inactive workspace reviewer", REVIEWER, value => void (value.workspaceReviewerStatus = "inactive")],
    ["disabled principal", REVIEWER, value => void (value.workspacePrincipalStatus = "disabled")],
    ["inactive private group", REVIEWER, value => void (value.privateGroupStatus = "inactive")],
    ["revoked access grant", REVIEWER, value => void (value.accessGrant.status = "revoked")],
    ["revocation timestamp", REVIEWER, value => void (value.accessGrant.revokedAt = FROZEN_AT)],
    [
      "grant starts after assignment freeze",
      REVIEWER,
      value => void (value.accessGrant.validFrom = "2030-01-01T12:00:01.000Z"),
    ],
    [
      "grant expires before the assignment",
      REVIEWER,
      value => void (value.accessGrant.validUntil = "2030-01-03T11:59:59.000Z"),
    ],
    ["wrong project scope", REVIEWER, value => void (value.accessGrant.projectIds = ["different-project"])],
    ["insufficient sensitivity", REVIEWER, value => void (value.accessGrant.maxPrivateSensitivity = "internal")],
    ["unaccepted assignment", REVIEWER, value => void (value.assignment.status = "reserved")],
    ["unissued lease", REVIEWER, value => void (value.assignment.leaseState = "expired")],
    ["invalid assignment identity", REVIEWER, value => void (value.assignment.assignmentId = "")],
    [
      "confidentiality accepted after freeze",
      REVIEWER,
      value => void (value.assignment.confidentialityAcceptedAt = "2030-01-01T12:00:01.000Z"),
    ],
    ["revoked artifact lease", REVIEWER, value => void (value.artifactLease.status = "revoked")],
    ["artifact lease revocation", REVIEWER, value => void (value.artifactLease.revokedAt = FROZEN_AT)],
    ["wrong leased artifact", REVIEWER, value => void (value.artifactLease.artifactId = "artifact_other")],
    ["wrong leased content", REVIEWER, value => void (value.artifactLease.contentHash = sha256("other-content"))],
    [
      "artifact lease expires before the assignment",
      REVIEWER,
      value => void (value.artifactLease.expiresAt = "2030-01-03T11:59:59.000Z"),
    ],
    ["expired assignment", REVIEWER, value => void (value.assignment.expiresAt = "2030-01-02T11:59:59.000Z")],
    [
      "qualification expires before the assignment",
      REVIEWER,
      value => void (value.qualification.expiresAt = "2030-01-03T11:59:59.000Z"),
    ],
    ["missing expertise", REVIEWER, value => void (value.qualification.provenanceJson = "[]")],
    ["declared conflict", REVIEWER, value => void (value.conflict.status = "declared")],
    [
      "conflict resolved after assignment freeze",
      REVIEWER,
      value => void (value.conflict.frozenAt = "2030-01-01T12:00:01.000Z"),
    ],
    [
      "conflict clearance expires before the assignment",
      REVIEWER,
      value => void (value.conflict.expiresAt = "2030-01-03T11:59:59.000Z"),
    ],
  ];

  for (const [name, principalId, mutate] of cases) {
    const candidate = structuredClone(baseline);
    mutate(candidate);
    assert.throws(
      () =>
        projectDsaBlindedReviewerCase({
          principalId,
          now: NOW,
          authorization: candidate,
          mapping,
          withheld: withheld(),
        }),
      (error: unknown) => code(error) === "dsa_blinded_case_not_found",
      name,
    );
  }
});

test("the committed mapping reproduces exactly and every frozen-field drift conflicts", () => {
  const mapping = freezeDsaBlindedCaseMapping({ payload: payload(), withheld: withheld() });
  const changed = structuredClone(mapping);
  changed.content.artifactVersion += 1;
  assert.throws(
    () =>
      projectDsaBlindedReviewerCase({
        principalId: REVIEWER,
        now: NOW,
        authorization: authorization(mapping.mappingCommitment),
        mapping: changed,
        withheld: withheld(),
      }),
    (error: unknown) => code(error) === "dsa_blinded_mapping_conflict",
  );

  const wrongBinding = authorization(mapping.mappingCommitment);
  wrongBinding.assignment.mappingCommitment = sha256("different-mapping");
  assert.throws(
    () =>
      projectDsaBlindedReviewerCase({
        principalId: REVIEWER,
        now: NOW,
        authorization: wrongBinding,
        mapping,
        withheld: withheld(),
      }),
    (error: unknown) => code(error) === "dsa_blinded_case_not_found",
  );
});

test("nested unblinded keys are rejected instead of being stripped", () => {
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    value => void ((value.content as Record<string, unknown>).providerIdentity = "Provider Alpha GmbH"),
    value => void ((value.content as Record<string, unknown>).machineOutcome = { action: "remove" }),
    value => void ((value.policy as Record<string, unknown>).appealResult = { result: "upheld" }),
    value => void ((value.reference as Record<string, unknown>).sourceDecisionId = "decision-secret-42"),
    value => void ((value.reference as Record<string, unknown>).statementReceiptId = "receipt-secret-88"),
    value =>
      void ((value.policy as Record<string, unknown>).metadata = {
        nested: { provider: "Provider Alpha GmbH", updatedAt: "2030-01-02T00:00:00.000Z" },
      }),
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(payload()) as unknown as Record<string, unknown>;
    mutate(candidate);
    assert.throws(
      () => freezeDsaBlindedCaseMapping({ payload: candidate, withheld: withheld() }),
      (error: unknown) => code(error) === "dsa_blinded_payload_unblinded",
    );
  }
});

test("withheld values cannot be smuggled through otherwise authorized frozen fields", () => {
  const mutations: Array<(value: DsaBlindedCasePayload) => void> = [
    value => void (value.policy.question = "Provider Alpha GmbH"),
    value => void (value.policy.question = "remove"),
    value => void (value.policy.categoryCode = "decision-secret-42"),
    value => void (value.content.artifactId = "receipt-secret-88"),
    value => void (value.reference.sampleId = "puid-secret-99"),
  ];
  for (const mutate of mutations) {
    const candidate = structuredClone(payload());
    mutate(candidate);
    assert.throws(
      () => freezeDsaBlindedCaseMapping({ payload: candidate, withheld: withheld() }),
      (error: unknown) => code(error) === "dsa_blinded_payload_unblinded",
    );
  }
});

test("authorization precedes projection and an authorized request still rejects an added unblinded field", () => {
  const mapping = freezeDsaBlindedCaseMapping({ payload: payload(), withheld: withheld() }) as unknown as Record<
    string,
    unknown
  >;
  const candidate = structuredClone(mapping);
  (candidate.reference as Record<string, unknown>).appealResult = "upheld";
  assert.throws(
    () =>
      projectDsaBlindedReviewerCase({
        principalId: OTHER_REVIEWER,
        now: NOW,
        authorization: authorization(mapping.mappingCommitment as `sha256:${string}`),
        mapping: candidate,
        withheld: withheld(),
      }),
    (error: unknown) => code(error) === "dsa_blinded_case_not_found",
  );
  assert.throws(
    () =>
      projectDsaBlindedReviewerCase({
        principalId: REVIEWER,
        now: NOW,
        authorization: authorization(mapping.mappingCommitment as `sha256:${string}`),
        mapping: candidate,
        withheld: withheld(),
      }),
    (error: unknown) => code(error) === "dsa_blinded_payload_unblinded",
  );
});

test("projection refuses an incomplete withheld-source context", () => {
  for (const mutate of [
    (value: DsaWithheldCaseValues) => void (value.providerIdentity = undefined),
    (value: DsaWithheldCaseValues) => void (value.internalSourceDecisionId = null),
    (value: DsaWithheldCaseValues) => void (value.automatedOutcome = undefined),
    (value: DsaWithheldCaseValues) => void (value.receiptIdentifiers = undefined),
  ]) {
    const context = structuredClone(withheld());
    mutate(context);
    assert.throws(
      () => freezeDsaBlindedCaseMapping({ payload: payload(), withheld: context }),
      (error: unknown) => code(error) === "dsa_blinded_withheld_context_invalid",
    );
  }
});
