import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { createHumanReviewOpportunityQuestionFreezer } from "~~/lib/tokenless/humanReviewOpportunityQuestions";
import {
  hashFrozenBinaryReviewQuestion,
  resolveHumanReviewQuestion,
  serializeFrozenBinaryReviewQuestion,
} from "~~/lib/tokenless/humanReviewQuestions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type QueryResult = { rowCount: number; rows: Record<string, unknown>[] };

const QUESTION = {
  kind: "binary" as const,
  prompt: "Would you buy this product?",
  positiveLabel: "Buy",
  negativeLabel: "Pass",
};

function profile(authority: "owner_fixed" | "agent_per_request" = "agent_per_request") {
  return authority === "owner_fixed"
    ? {
        question_authority: "owner_fixed",
        result_semantics: "assurance",
        criterion: "Is this response correct?",
        positive_label: "Approve",
        negative_label: "Reject",
        rationale_mode: "required",
        content_boundary: "public_or_test",
      }
    : {
        question_authority: "agent_per_request",
        result_semantics: "feedback",
        criterion: null,
        positive_label: null,
        negative_label: null,
        rationale_mode: "optional",
        content_boundary: "public_or_test",
      };
}

function frozenQuestion(question = QUESTION) {
  return resolveHumanReviewQuestion({
    policy: {
      questionAuthority: "agent_per_request",
      resultSemantics: "feedback",
      criterion: null,
      positiveLabel: null,
      negativeLabel: null,
      rationaleMode: "optional",
    },
    callerQuestion: question,
  });
}

function storedQuestion(question = QUESTION) {
  const frozen = frozenQuestion(question);
  return {
    workspace_id: "ws_question",
    opportunity_id: "aop_question",
    schema_version: "rateloop.binary-review-question.v1",
    question_authority: "agent_per_request",
    result_semantics: "feedback",
    question_hash: hashFrozenBinaryReviewQuestion(frozen),
    content_boundary: "public_or_test",
    question_json: serializeFrozenBinaryReviewQuestion(frozen),
    question_ciphertext: null,
    question_key_ref: null,
    submitted_by_integration_id: "int_question",
    submitted_at: new Date("2026-07-17T12:00:00.000Z"),
  };
}

function fakePool(input: { profile: Record<string, unknown>; existing?: Record<string, unknown> }) {
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  const client = {
    async query(sql: string, values: readonly unknown[] = []): Promise<QueryResult> {
      calls.push({ sql, values });
      if (sql.includes("FROM tokenless_agent_review_opportunities")) return { rowCount: 1, rows: [input.profile] };
      if (sql.includes("FROM tokenless_agent_review_opportunity_questions")) {
        return input.existing ? { rowCount: 1, rows: [input.existing] } : { rowCount: 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {},
  };
  return {
    calls,
    pool: {
      async connect() {
        return client as unknown as Pick<PoolClient, "query" | "release">;
      },
    },
  };
}

function request(callerQuestion: unknown = QUESTION) {
  return {
    workspaceId: "ws_question",
    opportunityId: "aop_question",
    integrationId: "int_question",
    callerQuestion,
    now: new Date("2026-07-17T12:00:00.000Z"),
  };
}

function code(error: unknown) {
  return error instanceof TokenlessServiceError ? error.code : null;
}

test("the freeze boundary enforces fixed and dynamic question authority before persistence", async () => {
  const fixed = fakePool({ profile: profile("owner_fixed") });
  await assert.rejects(
    createHumanReviewOpportunityQuestionFreezer(fixed.pool)(request()),
    error => code(error) === "review_question_override_not_allowed",
  );
  assert.equal(
    fixed.calls.some(call => call.sql.includes("INSERT INTO")),
    false,
  );
  assert.equal(fixed.calls.at(-1)?.sql, "ROLLBACK");

  const dynamic = fakePool({ profile: profile() });
  await assert.rejects(
    createHumanReviewOpportunityQuestionFreezer(dynamic.pool)({ ...request(), callerQuestion: undefined }),
    error => code(error) === "review_question_required",
  );
  assert.equal(
    dynamic.calls.some(call => call.sql.includes("INSERT INTO")),
    false,
  );
  assert.equal(dynamic.calls.at(-1)?.sql, "ROLLBACK");
});

test("a new dynamic question is appended exactly once with canonical public JSON", async () => {
  const fake = fakePool({ profile: profile() });
  const result = await createHumanReviewOpportunityQuestionFreezer(fake.pool)(request());
  assert.equal(result.persisted, true);
  assert.equal(result.replayed, false);
  assert.equal(result.question.resultSemantics, "feedback");
  const insert = fake.calls.find(call => call.sql.includes("INSERT INTO tokenless_agent_review_opportunity_questions"));
  assert.ok(insert);
  assert.equal(insert.values[3], result.questionHash);
  assert.equal(insert.values[5], serializeFrozenBinaryReviewQuestion(result.question));
  assert.equal(
    fake.calls.some(call => /^\s*UPDATE\b/u.test(call.sql)),
    false,
  );
  assert.equal(fake.calls.at(-1)?.sql, "COMMIT");
});

test("the same frozen question replays without an append or any downstream mutation", async () => {
  const fake = fakePool({ profile: profile(), existing: storedQuestion() });
  const result = await createHumanReviewOpportunityQuestionFreezer(fake.pool)(request());
  assert.equal(result.replayed, true);
  assert.equal(result.questionHash, storedQuestion().question_hash);
  assert.equal(
    fake.calls.some(call => call.sql.includes("INSERT INTO")),
    false,
  );
  assert.equal(
    fake.calls.some(call => /^\s*UPDATE\b/u.test(call.sql)),
    false,
  );
  assert.equal(fake.calls.at(-1)?.sql, "COMMIT");
});

test("a changed replay conflicts before append or downstream mutation", async () => {
  const fake = fakePool({ profile: profile(), existing: storedQuestion() });
  await assert.rejects(
    createHumanReviewOpportunityQuestionFreezer(fake.pool)(
      request({ ...QUESTION, prompt: "Do you like this product?" }),
    ),
    error => code(error) === "review_question_conflict",
  );
  assert.equal(
    fake.calls.some(call => call.sql.includes("INSERT INTO")),
    false,
  );
  assert.equal(
    fake.calls.some(call => /^\s*UPDATE\b/u.test(call.sql)),
    false,
  );
  assert.equal(fake.calls.at(-1)?.sql, "ROLLBACK");
});

test("private agent-written questions remain fail-closed without the future delivery capability", async () => {
  const privateProfile = { ...profile(), content_boundary: "private_workspace" };
  const fake = fakePool({ profile: privateProfile });
  await assert.rejects(
    createHumanReviewOpportunityQuestionFreezer(fake.pool)(request()),
    error => code(error) === "private_agent_review_questions_unavailable",
  );
  assert.equal(
    fake.calls.some(call => call.sql.includes("tokenless_agent_review_opportunity_questions")),
    false,
  );
  assert.equal(
    fake.calls.some(call => call.sql.includes("INSERT INTO")),
    false,
  );
  assert.equal(fake.calls.at(-1)?.sql, "ROLLBACK");
});
