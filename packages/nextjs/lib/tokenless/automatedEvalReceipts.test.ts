import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { __adaptiveReviewServiceTestUtils } from "~~/lib/tokenless/adaptiveReviewService";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import {
  AUTOMATED_EVAL_RECEIPT_SCHEMA_VERSION,
  authenticateAutomatedEvalPrincipal,
  exportAutomatedEvalLabeledData,
  ingestAutomatedEvalReceipt,
  parseAutomatedEvalReceipt,
} from "~~/lib/tokenless/automatedEvalReceipts";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { seedReadyHumanReviewBinding } from "~~/lib/tokenless/testing/humanReviewBindingFixture";

const OWNER = "0x1111111111111111111111111111111111111111";
const NOW = new Date("2026-07-16T12:00:00.000Z");
const originalSamplerKey = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
const originalSamplerVersion = process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;

beforeEach(() => {
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = "77".repeat(32);
  process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = "automated-eval-test-v1";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (originalSamplerKey === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY = originalSamplerKey;
  if (originalSamplerVersion === undefined) delete process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION;
  else process.env.TOKENLESS_ADAPTIVE_REVIEW_SAMPLER_KEY_VERSION = originalSamplerVersion;
});

async function setup(label = "automated-eval") {
  const { workspaceId } = await createWorkspace({ name: `Workspace ${label}`, ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: `agent-${label}`,
    version: { displayName: `Agent ${label}`, provider: "OpenAI", model: "gpt-test", environment: "production" },
  });
  const audience = { reviewerSource: "public_network" };
  const audiencePolicyHash = __adaptiveReviewServiceTestUtils.sha256(audience);
  const policyId = `arp_${label.replaceAll("-", "_")}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_review_policies
          (policy_id,version,workspace_id,agent_id,agent_version_id,mode,enabled,
           agreement_threshold_bps,production_floor_bps,maximum_unreviewed_gap,rules_json,
           audience_policy_json,created_by,approved_by,created_at)
          VALUES (?,1,?,?,?,'adaptive',true,7000,1000,20,'{}',?,?,?,?)`,
    args: [
      policyId,
      workspaceId,
      agent.agentId,
      agent.currentVersion.versionId,
      JSON.stringify(audience),
      OWNER.toLowerCase(),
      OWNER.toLowerCase(),
      NOW,
    ],
  });
  await seedReadyHumanReviewBinding({
    workspaceId,
    agentId: agent.agentId,
    agentVersionId: agent.currentVersion.versionId,
    policyId,
    actor: OWNER.toLowerCase(),
  });
  const full = await createWorkspaceApiKey({
    workspaceId,
    name: `Automated eval ${label}`,
    scopes: ["telemetry:write", "review:decide", "evaluation:read"],
  });
  const ingestOnly = await createWorkspaceApiKey({
    workspaceId,
    name: `Automated eval ingest ${label}`,
    scopes: ["telemetry:write"],
  });
  return {
    workspaceId,
    agent,
    policyId,
    audiencePolicyHash,
    principal: await authenticateAutomatedEvalPrincipal(`Bearer ${full.token}`, "telemetry:write"),
    ingestOnlyPrincipal: await authenticateAutomatedEvalPrincipal(`Bearer ${ingestOnly.token}`, "telemetry:write"),
  };
}

function receipt(
  setupData: Awaited<ReturnType<typeof setup>>,
  outcome: "pass" | "fail" | "uncertain",
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: AUTOMATED_EVAL_RECEIPT_SCHEMA_VERSION,
    provider: "nemo_guardrails",
    externalReceiptId: `rail-${outcome}-0001`,
    agentId: setupData.agent.agentId,
    agentVersionId: setupData.agent.currentVersion.versionId,
    evaluator: { name: "content_safety", version: "0.23.0" },
    evaluation: { checkName: "output_safety", outcome, scoreBps: 5_000, thresholdBps: 8_000 },
    contentCommitment: __adaptiveReviewServiceTestUtils.sha256({ output: `${outcome}-candidate` }),
    observedAt: NOW.toISOString(),
    ...(outcome === "uncertain"
      ? {
          reviewContext: {
            policyId: setupData.policyId,
            policyVersion: 1,
            workflowKey: "support_reply",
            riskTier: "guardrail_uncertain",
            audiencePolicyHash: setupData.audiencePolicyHash,
            declaredConfidenceBps: 5_000,
            metadataComplete: true,
            execution: {
              externalExecutionId: "nemo-rail-uncertain-0001",
              status: "completed",
              primarySpanId: "generation-primary",
              generationSpans: [
                {
                  spanId: "generation-primary",
                  role: "primary",
                  provider: "OpenAI",
                  requestedModel: "gpt-test",
                },
              ],
            },
          },
        }
      : {}),
    ...overrides,
  };
}

test("receipt parsing is commitment-only and rejects fields that could impersonate a human verdict", async () => {
  const setupData = await setup("parse");
  const parsed = parseAutomatedEvalReceipt(receipt(setupData, "pass"), NOW);
  assert.match(parsed.externalReferenceHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal("externalReceiptId" in parsed, false);
  assert.throws(
    () => parseAutomatedEvalReceipt({ ...receipt(setupData, "pass"), humanVerdict: "positive" }, NOW),
    /unsupported fields/u,
  );
  assert.throws(
    () => parseAutomatedEvalReceipt({ ...receipt(setupData, "uncertain"), reviewContext: undefined }, NOW),
    /Exactly uncertain receipts/u,
  );
  assert.throws(
    () => parseAutomatedEvalReceipt({ ...receipt(setupData, "pass"), reviewContext: {} }, NOW),
    /reviewContext/u,
  );
});

test("conclusive automated receipts remain automated evidence and create no review opportunity", async () => {
  const setupData = await setup("conclusive");
  const result = await ingestAutomatedEvalReceipt({
    principal: setupData.ingestOnlyPrincipal,
    idempotencyKey: "nemo-pass-0001",
    request: receipt(setupData, "pass"),
    now: NOW,
  });
  assert.equal(result.automatedSignal.outcome, "pass");
  assert.equal(result.automatedSignal.humanVerdict, null);
  assert.equal(result.humanReview, null);
  const counts = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM tokenless_assurance_automated_eval_receipts WHERE workspace_id=?) AS receipts,
            (SELECT COUNT(*) FROM tokenless_assurance_automated_eval_escalations WHERE workspace_id=?) AS escalations,
            (SELECT COUNT(*) FROM tokenless_agent_review_opportunities WHERE workspace_id=?) AS opportunities`,
    args: [setupData.workspaceId, setupData.workspaceId, setupData.workspaceId],
  });
  assert.deepEqual(
    [Number(counts.rows[0].receipts), Number(counts.rows[0].escalations), Number(counts.rows[0].opportunities)],
    [1, 0, 0],
  );
});

test("uncertain guardrails create a real required human-review opportunity with a frozen source receipt", async () => {
  const setupData = await setup("uncertain");
  const result = await ingestAutomatedEvalReceipt({
    principal: setupData.principal,
    idempotencyKey: "nemo-uncertain-0001",
    request: receipt(setupData, "uncertain"),
    now: NOW,
  });
  assert.equal(result.automatedSignal.outcome, "uncertain");
  assert.equal(result.automatedSignal.humanVerdict, null);
  assert.equal(result.humanReview?.required, true);
  assert.equal(result.humanReview?.decision, "required");
  const stored = await dbClient.execute({
    sql: `SELECT r.normalized_receipt_json,r.external_reference_hash,e.trigger_kind,e.state,
                 o.decision,o.critical_risk,o.reason_codes_json,o.source_evidence_hash
          FROM tokenless_assurance_automated_eval_receipts r
          JOIN tokenless_assurance_automated_eval_escalations e ON e.receipt_id=r.receipt_id
          JOIN tokenless_agent_review_opportunities o ON o.opportunity_id=e.opportunity_id
          WHERE r.workspace_id=?`,
    args: [setupData.workspaceId],
  });
  assert.equal(stored.rows[0].trigger_kind, "guardrail_uncertain");
  assert.equal(stored.rows[0].state, "human_review_required");
  assert.equal(stored.rows[0].decision, "required");
  assert.equal(stored.rows[0].critical_risk, true);
  assert.match(String(stored.rows[0].reason_codes_json), /critical_risk/u);
  assert.equal(stored.rows[0].source_evidence_hash, result.receiptHash);
  assert.match(String(stored.rows[0].external_reference_hash), /^sha256:[0-9a-f]{64}$/u);
  const normalized = JSON.parse(String(stored.rows[0].normalized_receipt_json));
  assert.equal("externalReceiptId" in normalized, false);
  assert.match(normalized.externalReferenceHash, /^sha256:[0-9a-f]{64}$/u);
});

test("ingest is exact-replay idempotent, rejects conflicts, and requires review authority only for uncertainty", async () => {
  const setupData = await setup("idempotency");
  const request = receipt(setupData, "uncertain");
  const first = await ingestAutomatedEvalReceipt({
    principal: setupData.principal,
    idempotencyKey: "nemo-replay-0001",
    request,
    now: NOW,
  });
  const replay = await ingestAutomatedEvalReceipt({
    principal: setupData.principal,
    idempotencyKey: "nemo-replay-0001",
    request,
    now: NOW,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.receiptId, first.receiptId);
  assert.equal(replay.humanReview?.opportunityId, first.humanReview?.opportunityId);
  await assert.rejects(
    () =>
      ingestAutomatedEvalReceipt({
        principal: setupData.principal,
        idempotencyKey: "nemo-replay-0001",
        request: receipt(setupData, "uncertain", {
          contentCommitment: __adaptiveReviewServiceTestUtils.sha256({ output: "changed" }),
        }),
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "automated_eval_receipt_conflict",
  );
  await assert.rejects(
    () =>
      ingestAutomatedEvalReceipt({
        principal: setupData.ingestOnlyPrincipal,
        idempotencyKey: "nemo-no-review-scope",
        request: receipt(setupData, "uncertain", { externalReceiptId: "rail-uncertain-no-scope" }),
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "insufficient_scope",
  );
});

test("uncertain ingest persists its source receipt before retrying a failed escalation", async () => {
  const setupData = await setup("durable-escalation");
  const request = receipt(setupData, "uncertain", { externalReceiptId: "rail-durable-escalation" });
  await assert.rejects(
    () =>
      ingestAutomatedEvalReceipt({
        principal: setupData.principal,
        idempotencyKey: "nemo-durable-escalation",
        request,
        now: NOW,
        evaluateReview: async () => Promise.reject(new Error("temporary adaptive-review failure")),
      }),
    /temporary adaptive-review failure/u,
  );
  const [receipts, escalations] = await Promise.all([
    dbClient.execute({
      sql: "SELECT COUNT(*) AS count FROM tokenless_assurance_automated_eval_receipts WHERE workspace_id=?",
      args: [setupData.workspaceId],
    }),
    dbClient.execute({
      sql: "SELECT COUNT(*) AS count FROM tokenless_assurance_automated_eval_escalations WHERE workspace_id=?",
      args: [setupData.workspaceId],
    }),
  ]);
  assert.equal(Number(receipts.rows[0].count), 1);
  assert.equal(Number(escalations.rows[0].count), 0);

  const resumed = await ingestAutomatedEvalReceipt({
    principal: setupData.principal,
    idempotencyKey: "nemo-durable-escalation",
    request,
    now: NOW,
  });
  assert.equal(resumed.replayed, true);
  assert.equal(resumed.humanReview?.required, true);
});

test("labeled-data exports are tenant-scoped, bounded, commitment-only, and require evaluation read scope", async () => {
  const first = await setup("export-one");
  const second = await setup("export-two");
  await ingestAutomatedEvalReceipt({
    principal: first.principal,
    idempotencyKey: "export-one-pass",
    request: receipt(first, "pass"),
    now: NOW,
  });
  await ingestAutomatedEvalReceipt({
    principal: second.principal,
    idempotencyKey: "export-two-pass",
    request: receipt(second, "pass"),
    now: NOW,
  });
  const exported = await exportAutomatedEvalLabeledData({
    principal: first.principal,
    from: new Date(NOW.getTime() - 1_000),
    to: new Date(NOW.getTime() + 1_000),
    now: NOW,
  });
  assert.equal(exported.workspaceId, first.workspaceId);
  assert.deepEqual(exported.items, []);
  assert.equal(exported.privacy.contentMode, "commitments_only");
  assert.equal(exported.privacy.reviewerIdentitiesIncluded, false);
  assert.match(exported.exportDigest, /^sha256:[0-9a-f]{64}$/u);
  const audit = await dbClient.execute({
    sql: `SELECT action,actor_kind,actor_reference,metadata_json
          FROM tokenless_audit_events WHERE workspace_id=? ORDER BY sequence DESC LIMIT 1`,
    args: [first.workspaceId],
  });
  assert.equal(audit.rows[0].action, "automated_eval.labeled_data_exported");
  assert.equal(audit.rows[0].actor_kind, "api_key");
  assert.equal(JSON.parse(String(audit.rows[0].metadata_json)).exportDigest, exported.exportDigest);
  await assert.rejects(
    () =>
      exportAutomatedEvalLabeledData({
        principal: first.ingestOnlyPrincipal,
        from: new Date(NOW.getTime() - 1_000),
        to: new Date(NOW.getTime() + 1_000),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "insufficient_scope",
  );
});
