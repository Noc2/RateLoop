import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  HUMAN_REVIEW_FIXED_BASE_BPS,
  HUMAN_REVIEW_PLATFORM_FEE_BPS,
  HUMAN_REVIEW_UINT256_MAX,
  __humanReviewRequestPreparationTestUtils,
  deriveHumanReviewEconomics,
  hashPreparedHumanReviewValue,
  prepareHumanReviewRequest,
} from "~~/lib/tokenless/humanReviewRequestPreparation";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const HASH = (character: string) => `sha256:${character.repeat(64)}` as const;
const NOW = new Date("2026-07-16T12:00:00.000Z");

function profile() {
  return {
    id: "rrp_exact",
    version: 2,
    hash: HASH("a"),
    agentId: "agent_exact",
    agentVersionId: "version_exact",
    criterion: "Is the proposed refund correct and safe to approve?",
    positiveLabel: "Approve",
    negativeLabel: "Reject",
    rationaleMode: "required" as const,
    audience: "public_network" as const,
    contentBoundary: "public_or_test" as const,
    privateSensitivity: null,
    privateGroupId: null,
    responseWindowSeconds: 3_600,
    panelSize: 5,
    compensationMode: "usdc" as const,
    bountyPerSeatAtomic: "1000000",
  };
}

function preparation() {
  return prepareHumanReviewRequest({
    opportunityId: "aop_exact",
    workflowKey: "refund-review",
    requestProfile: profile(),
    selectionPolicy: { id: "rpol_exact", version: 3 },
    contentCommitments: {
      source: hashPreparedPayload("source"),
      suggestion: hashPreparedPayload("suggestion"),
    },
    preparedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    sourcePayload: "source",
    suggestionPayload: "suggestion",
  });
}

function hashPreparedPayload(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

test("derives the RateLoop fee and RBTS fixed-base reserve from the exact paid profile", () => {
  const economics = deriveHumanReviewEconomics(profile());
  assert.equal(HUMAN_REVIEW_PLATFORM_FEE_BPS, 750);
  assert.equal(HUMAN_REVIEW_FIXED_BASE_BPS, 8_000);
  assert.deepEqual(economics, {
    schemaVersion: "rateloop.human-review-derived-economics.v1",
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
    panelSize: 5,
    baseBountyAtomic: "5000000",
    feeBps: 750,
    feeAtomic: "375000",
    attemptReserveAtomic: "4000000",
    maximumChargeAtomic: "9375000",
  });
  assert.equal(BigInt(economics.attemptReserveAtomic) / 5n, 800000n);
  assert.equal(Object.isFrozen(economics), true);
});

test("prepares and hashes owner-bound question, audience, timing, panel, economics, and provenance", () => {
  const prepared = preparation();
  assert.equal(prepared.preparedRequest.question.criterion, profile().criterion);
  assert.equal(prepared.preparedRequest.question.positiveLabel, "Approve");
  assert.equal(prepared.preparedRequest.question.negativeLabel, "Reject");
  assert.equal(prepared.preparedRequest.question.rationaleMode, "required");
  assert.equal(prepared.preparedRequest.audience.kind, "public_network");
  assert.equal(prepared.preparedRequest.timing.expiresAt, "2026-07-16T13:00:00.000Z");
  assert.equal(prepared.preparedRequest.panel.size, 5);
  assert.equal(prepared.preparedRequest.provenance.selectionPolicyId, "rpol_exact");
  assert.equal(prepared.maximumChargeAtomic, "9375000");
  assert.deepEqual(prepared.quoteTerms.budget, {
    bountyAtomic: "5000000",
    attemptReserveAtomic: "4000000",
    feeBps: 750,
  });
  assert.deepEqual(prepared.quoteTerms.requestProfile, { id: "rrp_exact", version: 2, hash: HASH("a") });
  assert.deepEqual(prepared.quoteTerms.reviewEconomics, {
    compensationMode: "usdc",
    bountyPerSeatAtomic: "1000000",
    panelSize: 5,
  });
  assert.deepEqual(prepared.quoteTerms.question.rationale, { mode: "required", minLength: 10, maxLength: 2_000 });
  assert.equal(prepared.preparedRequestHash, hashPreparedHumanReviewValue(prepared.preparedRequest));
  assert.equal(prepared.derivedEconomicsHash, hashPreparedHumanReviewValue(prepared.derivedEconomics));
  assert.equal(Object.isFrozen(prepared.preparedRequest.question), true);
  assert.equal(Object.isFrozen(prepared.quoteTerms.budget), true);
});

test("derives a zero-liability envelope for an unpaid invited profile", () => {
  const economics = deriveHumanReviewEconomics({
    compensationMode: "unpaid",
    bountyPerSeatAtomic: null,
    panelSize: 2,
  });
  assert.deepEqual(economics, {
    schemaVersion: "rateloop.human-review-derived-economics.v1",
    compensationMode: "unpaid",
    bountyPerSeatAtomic: "0",
    panelSize: 2,
    baseBountyAtomic: "0",
    feeBps: 0,
    feeAtomic: "0",
    attemptReserveAtomic: "0",
    maximumChargeAtomic: "0",
  });
});

test("fails closed on non-canonical atomics, uint256 overflow, caps, or an unfundable fixed base", () => {
  const invalid = [
    { compensationMode: "usdc" as const, bountyPerSeatAtomic: "01", panelSize: 5 },
    { compensationMode: "usdc" as const, bountyPerSeatAtomic: "1", panelSize: 5 },
    { compensationMode: "usdc" as const, bountyPerSeatAtomic: HUMAN_REVIEW_UINT256_MAX.toString(), panelSize: 2 },
    { compensationMode: "usdc" as const, bountyPerSeatAtomic: "1000000", panelSize: 101 },
    { compensationMode: "unpaid" as const, bountyPerSeatAtomic: "1", panelSize: 2 },
  ];
  for (const value of invalid) {
    assert.throws(
      () => deriveHumanReviewEconomics(value),
      (error: unknown) => {
        return error instanceof TokenlessServiceError && error.code === "review_configuration_invalid";
      },
    );
  }
});

test("fails closed when payload commitments drift or rationale off reaches the unsupported public schema", () => {
  const base = {
    opportunityId: "aop_exact",
    workflowKey: "refund-review",
    requestProfile: profile(),
    selectionPolicy: { id: "rpol_exact", version: 3 },
    contentCommitments: { source: hashPreparedPayload("source"), suggestion: hashPreparedPayload("suggestion") },
    preparedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    sourcePayload: "source",
    suggestionPayload: "suggestion",
  };
  assert.throws(
    () => prepareHumanReviewRequest({ ...base, sourcePayload: "changed" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "source_payload_commitment_mismatch",
  );
  assert.throws(
    () => prepareHumanReviewRequest({ ...base, requestProfile: { ...profile(), rationaleMode: "off" } }),
    /rationale mode 'off' is not supported/,
  );
});

test("canonical hashes are independent of object insertion order", () => {
  const left = { z: 1, nested: { b: true, a: "x" } };
  const right = { nested: { a: "x", b: true }, z: 1 };
  assert.equal(__humanReviewRequestPreparationTestUtils.canonicalJson(left), '{"nested":{"a":"x","b":true},"z":1}');
  assert.equal(hashPreparedHumanReviewValue(left), hashPreparedHumanReviewValue(right));
});
