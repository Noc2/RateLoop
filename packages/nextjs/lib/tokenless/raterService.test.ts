import { HUMAN_ASSURANCE_SCHEMA_VERSION } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import { __raterServiceTestUtils, listPaidRaterTasks } from "~~/lib/tokenless/raterService";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-07-12T20:00:00.000Z");

function paidAdmissionPolicy() {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_rater_tasks",
    version: 1,
    reviewerSource: "rateloop_network" as const,
    compensation: "paid" as const,
    cohorts: [],
    selection: "randomized" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: ["account_control", "live_human", "minimum_age"].map(capability => ({
        capability: capability as "account_control" | "live_human" | "minimum_age",
        reviewerSources: ["rateloop_network" as const],
        allowedProviders: ["identity-production"],
      })),
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source" as const],
      minimumAggregationSize: 10,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
}

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("commit authorization rejects a sealed payload whose signed hash differs", () => {
  assert.throws(
    () =>
      __raterServiceTestUtils.validateAuthorization({
        roundId: "42",
        drandNetwork: "quicknet-t",
        beaconRound: 123,
        sealedPayload: "0x1234",
        sealedPayloadHash: `0x${"11".repeat(32)}`,
        sealedCommitment: `0x${"22".repeat(32)}`,
        payoutCommitment: `0x${"33".repeat(32)}`,
        panelAddress: "0x2222222222222222222222222222222222222222",
        chainId: 84532,
        nullifier: `0x${"44".repeat(32)}`,
        voteKey: "0x3333333333333333333333333333333333333333",
        voteKeySignature: `0x${"55".repeat(65)}`,
      }),
    /Sealed payload hash does not match/,
  );
});

async function seedTask(sandbox: boolean) {
  const frozenPolicy = freezeAdmissionPolicy(paidAdmissionPolicy());
  await dbClient.execute({
    sql: "INSERT INTO tokenless_workspaces (workspace_id, name, status, created_at, updated_at) VALUES ('ws_tasks', 'Tasks', 'active', ?, ?)",
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_agent_quotes (quote_id, request_hash, request_json, response_json, expires_at, created_at) VALUES ('quote_tasks', 'hash', '{}', '{}', ?, ?)",
    args: [new Date(NOW.getTime() + 60_000), NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_agent_asks (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json, status, sandbox, created_at, updated_at) VALUES ('op_tasks', 'task:test:1234', 'hash', 'quote_tasks', '{}', '{}', 'open', ?, ?, ?)",
    args: [sandbox, NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_content_records (content_id, workspace_id, content_hash, content_json, moderation_status, created_at, updated_at) VALUES ('cnt_tasks', 'ws_tasks', ?, ?, 'approved', ?, ?)",
    args: [`${"11".repeat(32)}`, JSON.stringify({ kind: "binary", prompt: "Ship it?" }), NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_question_records (question_id, workspace_id, content_id, quote_id, terms_hash, terms_json, moderation_status, created_at, updated_at) VALUES ('qst_tasks', 'ws_tasks', 'cnt_tasks', 'quote_tasks', ?, '{}', 'approved', ?, ?)",
    args: [`${"22".repeat(32)}`, NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_ask_ownership (operation_key, workspace_id, owner_account_address, question_id, payment_mode, payment_state, payment_reference, idempotency_key, created_at, updated_at) VALUES ('op_tasks', 'ws_tasks', ?, 'qst_tasks', 'prepaid', 'confirmed', 'payment', 'task:test:1234', ?, ?)",
    args: [ACCOUNT, NOW, NOW],
  });
  const panel = "0x2222222222222222222222222222222222222222";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_chain_executions
          (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id, deployment_block,
           panel_address, issuer_address, x402_submitter_address, usdc_address, funder_address, content_id, terms_hash,
           round_terms_json, total_funded_atomic, state, round_id, created_at, updated_at)
          VALUES ('exec_tasks', 'op_tasks', 'prepaid', 'payment', 'deployment', 84532, 1, ?, ?, ?, ?, ?, ?, ?, ?, 31875000, 'confirmed', 42, ?, ?)`,
    args: [
      panel,
      "0x3333333333333333333333333333333333333333",
      "0x4444444444444444444444444444444444444444",
      "0x5555555555555555555555555555555555555555",
      ACCOUNT,
      `0x${"11".repeat(32)}`,
      `0x${"22".repeat(32)}`,
      JSON.stringify({
        bountyAmount: "25000000",
        attemptCompensation: "333333",
        maximumCommits: 15,
        admissionPolicyHash: frozenPolicy.admissionPolicyHash,
        beaconRound: "123",
        beaconNetworkHash: `0x${"66".repeat(32)}`,
      }),
      NOW,
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_voucher_rounds
          (chain_id, panel_address, round_id, content_id, admission_policy_hash, admission_policy_json,
           maximum_commits, voucher_not_before, voucher_deadline, status, created_at, updated_at)
          VALUES (84532, ?, 42, ?, ?, ?, 15, ?, ?, 'open', ?, ?)`,
    args: [
      panel,
      `0x${"11".repeat(32)}`,
      frozenPolicy.admissionPolicyHash,
      frozenPolicy.policyJson,
      new Date(NOW.getTime() - 1_000),
      new Date(NOW.getTime() + 60_000),
      NOW,
      NOW,
    ],
  });
  return frozenPolicy;
}

test("task discovery fails closed for live content without an assignment", async () => {
  await seedTask(false);
  assert.deepEqual(await listPaidRaterTasks(ACCOUNT, NOW), []);
});

test("task discovery exposes exact compensation for explicit sandbox content", async () => {
  const frozenPolicy = await seedTask(true);
  const tasks = await listPaidRaterTasks(ACCOUNT, NOW);
  assert.equal(tasks[0]?.question.prompt, "Ship it?");
  assert.equal(tasks[0]?.admissionPolicyHash, frozenPolicy.admissionPolicyHash);
  assert.deepEqual(tasks[0]?.earnings, {
    guaranteedBaseAtomic: "1333333",
    possibleBonusAtomic: "333333",
    attemptCompensationAtomic: "333333",
  });
  assert.equal("votePrivateKey" in tasks[0]!, false);
});
