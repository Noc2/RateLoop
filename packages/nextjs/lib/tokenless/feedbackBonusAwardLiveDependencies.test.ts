import { type FeedbackBonusBodyReaders, createFeedbackBonusBodyReader } from "./feedbackBonusAwardLiveDependencies";
import { TokenlessServiceError } from "./server";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const RESPONSE_HASH = `0x${"ab".repeat(32)}`;
const PUBLIC_REFERENCE = "rateloop.feedback-body.v1:public_rater_response:rrs_feedback_a";
const PRIVATE_REFERENCE = "rateloop.feedback-body.v1:assurance_response:hares_feedback_b";

function harness(input?: { projected?: boolean; malformed?: boolean }) {
  const events: string[] = [];
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const publicInputs: unknown[] = [];
  const privateInputs: unknown[] = [];
  const readers: FeedbackBonusBodyReaders = {
    async publicRaterResponse(value) {
      events.push("public-vault");
      publicInputs.push(value);
      return "  Specific public feedback.  ";
    },
    async assuranceResponse(value) {
      events.push("private-vault");
      privateInputs.push(value);
      return "  Confidential invited feedback.  ";
    },
  };
  const reader = createFeedbackBonusBodyReader({
    readers,
    queryable: {
      async query(text, values) {
        events.push("projection");
        queries.push({ text, values });
        if (input?.projected === false) return { rowCount: 0, rows: [] };
        return {
          rowCount: 1,
          rows: [
            input?.malformed
              ? { opportunity_id: "opportunity_a", response_hash: "not-a-hash" }
              : { opportunity_id: "opportunity_a", response_hash: RESPONSE_HASH },
          ],
        };
      },
    },
  });
  return { events, privateInputs, publicInputs, queries, reader };
}

function request(bodyReference: string) {
  return {
    bodyReference,
    workspaceId: "workspace_a",
    awarderAccount: "acct_requester",
  };
}

test("typed public response references authorize the frozen awarder before exact vault resolution", async () => {
  const value = harness();
  assert.equal(await value.reader(request(PUBLIC_REFERENCE)), "Specific public feedback.");
  assert.deepEqual(value.events, ["projection", "public-vault"]);
  assert.deepEqual(value.queries[0]?.values, ["workspace_a", PUBLIC_REFERENCE, "acct_requester"]);
  assert.deepEqual(value.publicInputs, [
    {
      responseId: "rrs_feedback_a",
      workspaceId: "workspace_a",
      opportunityId: "opportunity_a",
      expectedResponseHash: RESPONSE_HASH,
    },
  ]);
  assert.equal(value.privateInputs.length, 0);
});

test("typed private references resolve only through the tenant-bound assurance vault boundary", async () => {
  const value = harness();
  assert.equal(await value.reader(request(PRIVATE_REFERENCE)), "Confidential invited feedback.");
  assert.deepEqual(value.events, ["projection", "private-vault"]);
  assert.deepEqual(value.privateInputs, [
    {
      responseId: "hares_feedback_b",
      workspaceId: "workspace_a",
      opportunityId: "opportunity_a",
    },
  ]);
  assert.equal(value.publicInputs.length, 0);
});

test("unknown, unversioned, and path-like references cannot reach either response vault", async () => {
  for (const bodyReference of [
    "public-response:rrs_feedback_a",
    "rateloop.feedback-body.v2:public_rater_response:rrs_feedback_a",
    "rateloop.feedback-body.v1:database:tokenless_public_rater_responses",
    "rateloop.feedback-body.v1:public_rater_response:../../secret",
  ]) {
    const value = harness();
    await assert.rejects(
      value.reader(request(bodyReference)),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "feedback_bonus_body_unavailable",
    );
    assert.deepEqual(value.events, []);
  }
});

test("missing or malformed projection state fails closed before body decryption", async () => {
  for (const options of [{ projected: false }, { malformed: true }]) {
    const value = harness(options);
    await assert.rejects(
      value.reader(request(PUBLIC_REFERENCE)),
      (error: unknown) => error instanceof TokenlessServiceError && error.code === "feedback_bonus_body_unavailable",
    );
    assert.deepEqual(value.events, ["projection"]);
  }
});

test("the authorization query selects no vote key, payout commitment, or payout preimage", () => {
  const source = readFileSync(new URL("./feedbackBonusAwardLiveDependencies.ts", import.meta.url), "utf8");
  const select = source.match(/SELECT feedback\.opportunity_id,[\s\S]+?LIMIT 2/u)?.[0] ?? "";
  assert.match(select, /pool\.awarder_account = \$3/u);
  assert.match(select, /feedback\.eligibility_status = 'eligible'/u);
  assert.doesNotMatch(select, /vote_key|payout_commitment|preimage/u);
  assert.match(source, /getLiveFeedbackBonusAwardDependencies/u);
  assert.doesNotMatch(source, /const liveDependencies|installFeedbackBonusAwardDependencies/u);
});
