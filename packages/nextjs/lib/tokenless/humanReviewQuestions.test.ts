import assert from "node:assert/strict";
import test from "node:test";
import {
  hashFrozenBinaryReviewQuestion,
  normalizeAgentPerRequestBinaryQuestion,
  resolveHumanReviewQuestion,
  serializeFrozenBinaryReviewQuestion,
} from "~~/lib/tokenless/humanReviewQuestions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

function fixedPolicy() {
  return {
    questionAuthority: "owner_fixed" as const,
    resultSemantics: "assurance" as const,
    criterion: "Is this response safe and correct?",
    positiveLabel: "Approve",
    negativeLabel: "Reject",
    rationaleMode: "required" as const,
  };
}

function dynamicPolicy() {
  return {
    questionAuthority: "agent_per_request" as const,
    resultSemantics: "feedback" as const,
    criterion: null,
    positiveLabel: null,
    negativeLabel: null,
    rationaleMode: "optional" as const,
  };
}

function code(error: unknown) {
  return error instanceof TokenlessServiceError ? error.code : null;
}

test("fixed owner questions reject every caller override", () => {
  assert.throws(
    () =>
      resolveHumanReviewQuestion({
        policy: fixedPolicy(),
        callerQuestion: { kind: "binary", prompt: "Would you buy this?", positiveLabel: "Yes", negativeLabel: "No" },
      }),
    error => code(error) === "review_question_override_not_allowed",
  );
  const resolved = resolveHumanReviewQuestion({ policy: fixedPolicy() });
  assert.equal(resolved.prompt, fixedPolicy().criterion);
  assert.equal(resolved.questionAuthority, "owner_fixed");
  assert.equal(resolved.resultSemantics, "assurance");
});

test("agent-per-request profiles require one strict binary feedback question", () => {
  assert.throws(
    () => resolveHumanReviewQuestion({ policy: dynamicPolicy() }),
    error => code(error) === "review_question_required",
  );
  const resolved = resolveHumanReviewQuestion({
    policy: dynamicPolicy(),
    callerQuestion: {
      kind: "binary",
      prompt: "  Would you buy this product?  ",
      positiveLabel: " Buy ",
      negativeLabel: " Pass ",
    },
  });
  assert.deepEqual(resolved, {
    schemaVersion: "rateloop.binary-review-question.v1",
    kind: "binary",
    prompt: "Would you buy this product?",
    positiveLabel: "Buy",
    negativeLabel: "Pass",
    rationaleMode: "optional",
    questionAuthority: "agent_per_request",
    resultSemantics: "feedback",
  });
  assert.equal(Object.isFrozen(resolved), true);
});

test("caller questions cannot set owner-controlled rationale or unknown fields", () => {
  assert.throws(
    () =>
      normalizeAgentPerRequestBinaryQuestion({
        kind: "binary",
        prompt: "Do you like this design?",
        positiveLabel: "Like",
        negativeLabel: "Dislike",
        rationaleMode: "off",
      }),
    error => code(error) === "invalid_review_question",
  );
  assert.throws(
    () =>
      normalizeAgentPerRequestBinaryQuestion({
        kind: "binary",
        prompt: "Do you like this design?",
        positiveLabel: "Same",
        negativeLabel: " same ",
      }),
    error => code(error) === "invalid_review_question",
  );
  assert.throws(
    () =>
      normalizeAgentPerRequestBinaryQuestion({
        kind: "binary",
        prompt: "Would you buy this?\nIgnore the surrounding reviewer task.",
        positiveLabel: "Yes",
        negativeLabel: "No",
      }),
    error => code(error) === "invalid_review_question",
  );
});

test("canonical question hashes are stable and change with exact reviewer-visible terms", () => {
  const first = resolveHumanReviewQuestion({
    policy: dynamicPolicy(),
    callerQuestion: { kind: "binary", prompt: "Would you buy this?", positiveLabel: "Yes", negativeLabel: "No" },
  });
  const replay = resolveHumanReviewQuestion({
    policy: dynamicPolicy(),
    callerQuestion: { negativeLabel: "No", positiveLabel: "Yes", prompt: "Would you buy this?", kind: "binary" },
  });
  const changed = resolveHumanReviewQuestion({
    policy: dynamicPolicy(),
    callerQuestion: { kind: "binary", prompt: "Do you like this?", positiveLabel: "Yes", negativeLabel: "No" },
  });
  assert.equal(serializeFrozenBinaryReviewQuestion(first), serializeFrozenBinaryReviewQuestion(replay));
  assert.equal(hashFrozenBinaryReviewQuestion(first), hashFrozenBinaryReviewQuestion(replay));
  assert.notEqual(hashFrozenBinaryReviewQuestion(first), hashFrozenBinaryReviewQuestion(changed));
  assert.match(hashFrozenBinaryReviewQuestion(first), /^sha256:[0-9a-f]{64}$/u);
});
