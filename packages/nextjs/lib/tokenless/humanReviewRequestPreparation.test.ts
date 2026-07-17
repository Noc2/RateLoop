import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { hashFrozenBinaryReviewQuestion, resolveHumanReviewQuestion } from "~~/lib/tokenless/humanReviewQuestions";
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
    questionAuthority: "owner_fixed" as const,
    resultSemantics: "assurance" as const,
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

test("freezes exact specialist requirements into the prepared request", () => {
  const expertiseRequirements = [
    {
      definitionId: "expd_financial_analysis",
      definitionVersion: 2,
      definitionHash: HASH("b"),
      minimumSeats: 5,
      sourceScope: "rateloop_network" as const,
    },
  ];
  const base = {
    opportunityId: "aop_expertise",
    workflowKey: "refund-review",
    selectionPolicy: { id: "rpol_exact", version: 3 },
    contentCommitments: {
      source: hashPreparedPayload("source"),
      suggestion: hashPreparedPayload("suggestion"),
    },
    preparedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    sourcePayload: "source",
    suggestionPayload: "suggestion",
  };
  const prepared = prepareHumanReviewRequest({
    ...base,
    requestProfile: { ...profile(), expertiseRequirements },
  });
  assert.deepEqual(prepared.preparedRequest.audience.expertiseRequirements, expertiseRequirements);
  assert.throws(
    () =>
      prepareHumanReviewRequest({
        ...base,
        requestProfile: {
          ...profile(),
          expertiseRequirements: [{ ...expertiseRequirements[0]!, minimumSeats: 4 }],
        },
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "review_configuration_invalid",
  );
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

test("fails closed when payload commitments drift and carries rationale off into the public schema", () => {
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
  assert.deepEqual(
    prepareHumanReviewRequest({ ...base, requestProfile: { ...profile(), rationaleMode: "off" } }).quoteTerms.question
      .rationale,
    { mode: "off" },
  );
});

test("canonical hashes are independent of object insertion order", () => {
  const left = { z: 1, nested: { b: true, a: "x" } };
  const right = { nested: { a: "x", b: true }, z: 1 };
  assert.equal(__humanReviewRequestPreparationTestUtils.canonicalJson(left), '{"nested":{"a":"x","b":true},"z":1}');
  assert.equal(hashPreparedHumanReviewValue(left), hashPreparedHumanReviewValue(right));
});

test("binds each dynamic feedback question into the prepared request and deterministic hash", () => {
  const dynamicProfile = {
    ...profile(),
    questionAuthority: "agent_per_request" as const,
    resultSemantics: "feedback" as const,
    criterion: null,
    positiveLabel: null,
    negativeLabel: null,
  };
  const exact = (prompt: string) => {
    const effectiveQuestion = resolveHumanReviewQuestion({
      policy: dynamicProfile,
      callerQuestion: {
        kind: "binary",
        prompt,
        positiveLabel: "Would buy",
        negativeLabel: "Would not buy",
      },
    });
    return prepareHumanReviewRequest({
      opportunityId: "aop_market",
      workflowKey: "market-research",
      requestProfile: dynamicProfile,
      selectionPolicy: { id: "rpol_exact", version: 3 },
      contentCommitments: {
        source: hashPreparedPayload("source"),
        suggestion: hashPreparedPayload("suggestion"),
      },
      preparedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 3_600_000),
      sourcePayload: "source",
      suggestionPayload: "suggestion",
      effectiveQuestion,
      effectiveQuestionHash: hashFrozenBinaryReviewQuestion(effectiveQuestion),
    });
  };
  const first = exact("Would you buy this product?");
  const second = exact("Would you recommend this product?");
  assert.equal(first.preparedRequest.question.resultSemantics, "feedback");
  assert.equal(first.preparedRequest.question.questionAuthority, "agent_per_request");
  assert.equal(first.preparedRequest.question.criterion, "Would you buy this product?");
  assert.notEqual(first.questionHash, second.questionHash);
  assert.notEqual(first.preparedRequestHash, second.preparedRequestHash);
});

test("fails closed when a dynamic public profile reaches preparation without a frozen question", () => {
  assert.throws(
    () =>
      prepareHumanReviewRequest({
        opportunityId: "aop_market",
        workflowKey: "market-research",
        requestProfile: {
          ...profile(),
          questionAuthority: "agent_per_request",
          resultSemantics: "feedback",
          criterion: null,
          positiveLabel: null,
          negativeLabel: null,
        },
        selectionPolicy: { id: "rpol_exact", version: 3 },
        contentCommitments: {
          source: hashPreparedPayload("source"),
          suggestion: hashPreparedPayload("suggestion"),
        },
        preparedAt: NOW,
        expiresAt: new Date(NOW.getTime() + 3_600_000),
        sourcePayload: "source",
        suggestionPayload: "suggestion",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "review_question_required",
  );
});
