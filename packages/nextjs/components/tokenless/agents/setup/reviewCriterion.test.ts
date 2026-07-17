import {
  REVIEW_ANSWER_LABEL_MAX_LENGTH,
  REVIEW_CRITERION_MAX_LENGTH,
  buildReviewCriterionRequestProfile,
  reviewCriterionFormValues,
} from "./reviewCriterion";
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSetupReviewDraft } from "~~/lib/tokenless/workspaceAgentSetup";

const profile: Omit<AgentSetupReviewDraft["requestProfile"], "configurationStatus"> = {
  questionAuthority: "owner_fixed",
  resultSemantics: "assurance",
  criterion: "Is this response safe and correct?",
  positiveLabel: "Approve",
  negativeLabel: "Reject",
  rationaleMode: "required",
  audience: "private_invited",
  contentBoundary: "private_workspace",
  privateSensitivity: "confidential",
  privateGroupId: "pgrp_reviewers",
  responseWindowSeconds: 3_600,
  panelSize: 2,
  compensationMode: "unpaid",
  bountyPerSeatAtomic: null,
};

test("criterion form resumes the exact saved question and answer format", () => {
  assert.deepEqual(
    reviewCriterionFormValues({
      ...profile,
      criterion: "Is the cited source authoritative?",
      positiveLabel: "Supported",
      negativeLabel: "Unsupported",
      rationaleMode: "optional",
      configurationStatus: "ready",
    }),
    {
      questionAuthority: "owner_fixed",
      criterion: "Is the cited source authoritative?",
      positiveLabel: "Supported",
      negativeLabel: "Unsupported",
      rationaleMode: "optional",
    },
  );
});

test("criterion composition trims exact text fields and preserves unrelated profile fields", () => {
  const result = buildReviewCriterionRequestProfile(profile, {
    questionAuthority: "owner_fixed",
    criterion: "  Is the answer supported?  ",
    positiveLabel: "  Yes  ",
    negativeLabel: "  No  ",
    rationaleMode: "off",
  });

  assert.equal(result.criterion, "Is the answer supported?");
  assert.equal(result.positiveLabel, "Yes");
  assert.equal(result.negativeLabel, "No");
  assert.equal(result.rationaleMode, "off");
  assert.equal(result.audience, "private_invited");
  assert.equal(result.responseWindowSeconds, 3_600);
  assert.equal("resultSemantics" in result, false);
});

test("agent-per-request composition omits fixed text and keeps owner-controlled rationale", () => {
  const result = buildReviewCriterionRequestProfile(profile, {
    questionAuthority: "agent_per_request",
    criterion: "This must not be sent",
    positiveLabel: "Approve",
    negativeLabel: "Reject",
    rationaleMode: "optional",
  });

  assert.equal(result.questionAuthority, "agent_per_request");
  assert.equal(result.rationaleMode, "optional");
  assert.equal("criterion" in result, false);
  assert.equal("positiveLabel" in result, false);
  assert.equal("negativeLabel" in result, false);
  assert.equal("resultSemantics" in result, false);
});

test("criterion composition rejects missing text and equivalent answer labels", () => {
  assert.throws(
    () => buildReviewCriterionRequestProfile(profile, { ...reviewCriterionFormValues(undefined), criterion: " " }),
    /Review question is required/,
  );
  assert.throws(
    () =>
      buildReviewCriterionRequestProfile(profile, {
        ...reviewCriterionFormValues(undefined),
        positiveLabel: "Approve",
        negativeLabel: " approve ",
      }),
    /labels must differ/,
  );
});

test("criterion composition enforces the server text limits", () => {
  assert.throws(
    () =>
      buildReviewCriterionRequestProfile(profile, {
        ...reviewCriterionFormValues(undefined),
        criterion: "x".repeat(REVIEW_CRITERION_MAX_LENGTH + 1),
      }),
    /500 characters or fewer/,
  );
  assert.throws(
    () =>
      buildReviewCriterionRequestProfile(profile, {
        ...reviewCriterionFormValues(undefined),
        positiveLabel: "x".repeat(REVIEW_ANSWER_LABEL_MAX_LENGTH + 1),
      }),
    /40 characters or fewer/,
  );
});

test("criterion composition rejects an unknown rationale mode", () => {
  assert.throws(
    () =>
      buildReviewCriterionRequestProfile(profile, {
        ...reviewCriterionFormValues(undefined),
        rationaleMode: "sometimes" as AgentSetupReviewDraft["requestProfile"]["rationaleMode"],
      }),
    /valid rationale setting/,
  );
});
