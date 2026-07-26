import { HUMAN_ASSURANCE_SCHEMA_VERSION, type HumanAssuranceAudiencePolicy } from "@rateloop/sdk";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { PoolClient, QueryResult } from "pg";
import { type DatabaseResources, type QueryInput, __setDatabaseResourcesForTests } from "~~/lib/db";
import { hashHumanAssuranceDocument } from "~~/lib/tokenless/humanAssurance";
import {
  __publicNetworkReviewReachabilityTestUtils,
  abandonStalePublicNetworkFoundation,
  bindPublicNetworkReviewOperation,
  readReadyPublicNetworkReviewChild,
  releasePublicNetworkReviewBinding,
} from "~~/lib/tokenless/publicNetworkReviewReachability";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const HASH = `sha256:${"a".repeat(64)}` as const;
const OTHER_HASH = `sha256:${"b".repeat(64)}` as const;
const CONTENT_ID = `0x${"c".repeat(64)}` as const;
const ADMISSION_POLICY_HASH = `0x${"d".repeat(64)}` as const;
const PANEL = "0x1111111111111111111111111111111111111111";

function result(rows: Record<string, unknown>[] = [], rowCount = rows.length) {
  return { rows, rowCount } as QueryResult;
}

function installDatabase(input: {
  execute?: (input: QueryInput) => Promise<QueryResult>;
  connect: () => Promise<Pick<PoolClient, "query" | "release">>;
}) {
  __setDatabaseResourcesForTests({
    client: {
      execute: input.execute ?? (async () => result()),
    },
    database: {},
    pool: { connect: input.connect },
  } as unknown as DatabaseResources);
}

function networkPolicy(panelSize = 1): HumanAssuranceAudiencePolicy {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_public_network",
    version: 1,
    reviewerSource: "rateloop_network",
    integrity: {
      schemaVersion: "rateloop.integrity-assignment.v1",
      epochId: "integrity:2026-07-26:001",
      epochManifestHash: HASH,
      maxClusterShareBps: 10_000,
      allowedRiskBands: ["low"],
      recentCoassignmentWindowSeconds: 86_400,
      maxRecentCoassignments: 0,
      maxPerCustomer: 1,
      onePerProviderSubject: true,
    },
    compensation: "paid",
    cohorts: [{ cohortId: "global", minimumReviewers: panelSize, maximumReviewers: panelSize }],
    selection: "randomized",
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "unique_human",
          reviewerSources: ["rateloop_network"],
          allowedProviders: ["world:poh"],
        },
      ],
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source"],
      minimumAggregationSize: 1,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
}

afterEach(() => __setDatabaseResourcesForTests(null));

test("public network foundations require one exact paid randomized network cohort", () => {
  assert.equal(__publicNetworkReviewReachabilityTestUtils.reviewerTarget(networkPolicy(3), 3).cohortId, "global");
  assert.throws(
    () =>
      __publicNetworkReviewReachabilityTestUtils.reviewerTarget(
        { ...networkPolicy(3), compensation: "unpaid", legalEligibilityRequired: false },
        3,
      ),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "public_network_audience_policy_unreachable",
  );
  assert.throws(
    () => __publicNetworkReviewReachabilityTestUtils.reviewerTarget(networkPolicy(3), 2),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "public_network_audience_policy_unreachable",
  );
});

test("operation binding accepts only exact public moderated content and replays idempotently", async () => {
  let state = "foundation_ready";
  let operationKey: string | null = null;
  let updateCount = 0;
  const client = {
    async query(sql: string, values?: readonly unknown[]) {
      if (sql.includes("FROM tokenless_public_network_review_bindings binding")) {
        return result([
          {
            state,
            operation_key: operationKey,
            product_question_id: "qst_exact",
            product_content_id: CONTENT_ID,
            operation_workspace_id: "ws_exact",
            operation_question_id: "qst_exact",
            operation_content_hash: CONTENT_ID.slice(2),
            question_visibility: "public",
            question_data_classification: "redacted",
            question_moderation_status: "approved",
            confirmed_no_sensitive_data: true,
            content_moderation_status: "approved",
          },
        ]);
      }
      if (sql.startsWith("UPDATE tokenless_public_network_review_bindings")) {
        updateCount += 1;
        if (state === "foundation_ready") {
          state = "ask_bound";
          operationKey = String(values?.[0]);
          return result([{ project_id: "project_exact", run_id: "run_exact", case_id: "case_exact" }]);
        }
        return result();
      }
      if (sql.includes("SELECT project_id,run_id,case_id,state,operation_key")) {
        return result([
          {
            project_id: "project_exact",
            run_id: "run_exact",
            case_id: "case_exact",
            state,
            operation_key: operationKey,
          },
        ]);
      }
      throw new Error(`Unexpected binding query: ${sql}`);
    },
  } as Pick<PoolClient, "query">;
  const input = {
    bindingId: "pnrb_exact",
    workspaceId: "ws_exact",
    opportunityId: "opportunity_exact",
    operationKey: "op_exact",
    now: NOW,
  };
  assert.equal((await bindPublicNetworkReviewOperation(client, input)).run_id, "run_exact");
  assert.equal((await bindPublicNetworkReviewOperation(client, input)).run_id, "run_exact");
  assert.equal(updateCount, 2);

  state = "foundation_ready";
  operationKey = null;
  const privateClient = {
    async query() {
      return result([
        {
          state,
          operation_key: operationKey,
          product_question_id: "qst_exact",
          product_content_id: CONTENT_ID,
          operation_workspace_id: "ws_exact",
          operation_question_id: "qst_exact",
          operation_content_hash: CONTENT_ID.slice(2),
          question_visibility: "private",
          question_data_classification: "confidential",
          question_moderation_status: "approved",
          confirmed_no_sensitive_data: false,
          content_moderation_status: "approved",
        },
      ]);
    },
  } as Pick<PoolClient, "query">;
  await assert.rejects(
    () => bindPublicNetworkReviewOperation(privateClient, input),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "public_network_operation_binding_conflict",
  );
});

test("worker failures back off monotonically and dead-letter on the twentieth attempt", async () => {
  const worker = {
    state: "ask_bound",
    attempt: 0,
    nextAttemptAt: null as Date | null,
    errorCode: null as string | null,
    deadAt: null as Date | null,
  };
  const client = {
    async query(sql: string, values?: readonly unknown[]) {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
      if (sql.includes("SELECT state,worker_attempt_count")) {
        return result([{ state: worker.state, worker_attempt_count: worker.attempt }]);
      }
      if (sql.startsWith("UPDATE tokenless_public_network_review_bindings")) {
        worker.state = values?.[0] ? "dead" : worker.state;
        worker.attempt = Number(values?.[1]);
        worker.nextAttemptAt = (values?.[2] as Date | null) ?? null;
        worker.errorCode = String(values?.[3]);
        worker.deadAt = (values?.[4] as Date | null) ?? null;
        return result([], 1);
      }
      throw new Error(`Unexpected worker query: ${sql}`);
    },
    release() {},
  } as unknown as PoolClient;
  installDatabase({ connect: async () => client });

  await __publicNetworkReviewReachabilityTestUtils.recordPublicNetworkWorkerFailure(
    "pnrb_worker",
    new TokenlessServiceError("Pending.", 409, "network_round_binding_pending", true),
    NOW,
  );
  assert.equal(worker.attempt, 1);
  assert.equal(worker.state, "ask_bound");
  assert.equal(worker.errorCode, "network_round_binding_pending");
  assert.ok(worker.nextAttemptAt && worker.nextAttemptAt > NOW);

  worker.attempt = 19;
  await __publicNetworkReviewReachabilityTestUtils.recordPublicNetworkWorkerFailure(
    "pnrb_worker",
    new Error("terminal"),
    NOW,
  );
  assert.equal(worker.attempt, 20);
  assert.equal(worker.state, "dead");
  assert.equal(worker.nextAttemptAt, null);
  assert.deepEqual(worker.deadAt, NOW);
});

test("stale unbound foundations cancel their run and abandon exactly once", async () => {
  let abandoned = false;
  const writes: string[] = [];
  const client = {
    async query(sql: string) {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
      if (sql.includes("SELECT b.state,b.operation_key")) {
        return abandoned
          ? result()
          : result([
              {
                state: "foundation_ready",
                operation_key: null,
                run_id: "run_orphan",
                opportunity_operation: null,
              },
            ]);
      }
      writes.push(sql);
      if (sql.startsWith("UPDATE tokenless_public_network_review_bindings")) {
        abandoned = true;
        return result([{ binding_id: "pnrb_orphan" }]);
      }
      return result([], 1);
    },
    release() {},
  } as unknown as PoolClient;
  installDatabase({ connect: async () => client });

  assert.equal(await abandonStalePublicNetworkFoundation("pnrb_orphan", NOW), true);
  assert.equal(await abandonStalePublicNetworkFoundation("pnrb_orphan", NOW), false);
  assert.equal(writes.filter(sql => sql.startsWith("UPDATE tokenless_assurance_runs")).length, 1);
});

test("ready child reads replay the exact assignment, voucher, and settlement evidence", async () => {
  const selectionBindingHash = `sha256:${"e".repeat(64)}` as const;
  const assignmentId = "haas_exact";
  const batchId = "hasb_exact";
  const voucherMarker = `selection:${batchId}:${hashHumanAssuranceDocument({
    assignmentId,
    bindings: [selectionBindingHash],
  }).slice("sha256:".length)}`;
  const binding = {
    binding_id: "pnrb_ready",
    workspace_id: "ws_exact",
    opportunity_id: "opportunity_exact",
    project_id: "project_exact",
    run_id: "run_exact",
    case_id: "case_exact",
    confidentiality_terms_hash: HASH,
    operation_key: "op_exact",
    deployment_key: "deployment_exact",
    chain_id: 84532,
    panel_address: PANEL,
    round_id: "42",
    product_content_id: CONTENT_ID,
    admission_policy_hash: ADMISSION_POLICY_HASH,
    round_terms_hash: OTHER_HASH,
    total_funded_atomic: "125",
    maximum_commits: 1,
  };
  installDatabase({
    connect: async () => {
      throw new Error("read-ready should not open a transaction");
    },
    execute: async input => {
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.includes("FROM tokenless_public_network_review_bindings") && sql.includes("state='audience_ready'")) {
        return result([binding]);
      }
      if (sql.includes("COUNT(DISTINCT assignment.assignment_id)")) {
        return result([{ assignment_count: 1, settlement_count: 1 }]);
      }
      if (sql.includes("JOIN tokenless_rater_profiles")) {
        return result([
          {
            assignment_id: assignmentId,
            principal_id: "rlp_exact",
            payout_account: PANEL,
            voucher_marker: voucherMarker,
            selection_batch_id: batchId,
            binding_id: "nas_exact",
            selection_binding_hash: selectionBindingHash,
            integrity_provenance_hash: HASH,
            state: "selected",
          },
        ]);
      }
      throw new Error(`Unexpected ready query: ${sql}`);
    },
  });

  const ready = await readReadyPublicNetworkReviewChild("pnrb_ready");
  assert.equal(ready.operationKey, "op_exact");
  assert.deepEqual(ready.assignmentReferences, [assignmentId]);
  assert.equal(ready.assignments[0]?.voucherMarker, voucherMarker);
  assert.equal(
    (await readReadyPublicNetworkReviewChild("pnrb_ready")).settlementBindingHash,
    ready.settlementBindingHash,
  );
});

test("release preserves accepted liability but releases an unsubmitted funded child", async () => {
  let assignmentStatus: "reserved" | "accepted" = "reserved";
  const writes: string[] = [];
  const client = {
    async query(sql: string) {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return result();
      if (sql.includes("FROM tokenless_public_network_review_bindings binding")) {
        return result([
          {
            state: "ask_bound",
            run_id: "run_exact",
            chain_id: null,
            panel_address: null,
            round_id: null,
            execution_state: "preparing",
            submission_transaction_hash: null,
            payment_mode: "prepaid",
            payment_reference: "reservation_exact",
          },
        ]);
      }
      if (sql.includes("FROM tokenless_assurance_assignments")) {
        return result([{ assignment_id: "haas_exact", status: assignmentStatus }]);
      }
      if (sql.includes("FROM tokenless_network_assignment_settlements")) {
        return result([{ binding_id: "nas_exact", state: "selected" }]);
      }
      writes.push(sql);
      return result([], 1);
    },
    release() {},
  } as unknown as PoolClient;
  installDatabase({
    connect: async () => client,
    execute: async input => {
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.includes("live_assignments")) return result([{ live_assignments: 0, live_settlements: 0 }]);
      throw new Error(`Unexpected release query: ${sql}`);
    },
  });

  const released = await releasePublicNetworkReviewBinding({
    bindingId: "pnrb_exact",
    operationKey: "op_exact",
    now: NOW,
  });
  assert.equal(released.disposition, "funding_released");
  assert.ok(writes.some(sql => sql.startsWith("UPDATE tokenless_prepaid_reservations")));
  assert.ok(writes.some(sql => sql.startsWith("UPDATE tokenless_agent_asks")));
  assert.ok(writes.some(sql => sql.startsWith("UPDATE tokenless_public_network_review_bindings")));

  assignmentStatus = "accepted";
  writes.length = 0;
  await assert.rejects(
    () =>
      releasePublicNetworkReviewBinding({
        bindingId: "pnrb_exact",
        operationKey: "op_exact",
        now: NOW,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "public_network_child_liability_active",
  );
  assert.deepEqual(writes, []);
});
