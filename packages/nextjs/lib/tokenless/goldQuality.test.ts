import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { PoolClient } from "pg";
import { __goldQualityTestUtils, recordGoldOutcomesForResponseBatch } from "~~/lib/tokenless/goldQuality";

test("small-run gold injection is bounded and never forces a calibration item", () => {
  assert.equal(__goldQualityTestUtils.goldInjectionCount(1, 500, 1, 9999), 0);
  assert.equal(__goldQualityTestUtils.goldInjectionCount(1, 500, 1, 0), 1);
  assert.equal(__goldQualityTestUtils.goldInjectionCount(100, 2_000, 5, 0), 5);
});

test("owner gold stays invited and public lanes require platform-synthetic provenance", () => {
  assert.equal(__goldQualityTestUtils.goldProvenanceForSource("customer_invited"), "owner_adjudicated");
  assert.equal(__goldQualityTestUtils.goldProvenanceForSource("rateloop_network"), "platform_synthetic");
  assert.equal(__goldQualityTestUtils.goldProvenanceForSource("hybrid"), "platform_synthetic");
});

test("the persisted selection commitment never exposes the HMAC ranking seed", () => {
  const seed = Buffer.alloc(32, 23);
  const commitment = __goldQualityTestUtils.selectionSeedCommitment(seed);
  assert.notEqual(commitment, `sha256:${seed.toString("hex")}`);
  assert.equal(commitment, `sha256:${createHash("sha256").update(seed).digest("hex")}`);
});

test("gold outcome persistence binds every identity and score column without shifted parameters", async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      calls.push({ text, values });
      if (text.includes("FROM tokenless_assurance_run_gold_items")) {
        return {
          rowCount: 1,
          rows: [
            {
              case_id: "case_gold",
              gold_item_id: "gold_1",
              expected_choice: "candidate",
              provenance: "owner_adjudicated",
            },
          ],
        };
      }
      if (text.includes("FROM tokenless_rater_profiles")) return { rowCount: 1, rows: [{ rater_id: "rater_1" }] };
      return { rowCount: 1, rows: [] };
    },
  } as unknown as PoolClient;
  const now = new Date("2026-07-17T00:00:00.000Z");
  await recordGoldOutcomesForResponseBatch(client, {
    runId: "run_1",
    workspaceId: "workspace_1",
    projectId: "project_1",
    assignmentId: "assignment_1",
    reviewerKey: `hmac-sha256:v1:${"a".repeat(64)}`,
    reviewerPrincipalId: "principal_reviewer_1",
    reviewerSource: "customer_invited",
    responses: [{ caseId: "case_gold", canonicalChoice: "candidate" }],
    now,
  });
  const insert = calls.find(call => call.text.includes("INSERT INTO tokenless_assurance_gold_outcomes"))!;
  assert.equal(insert.values?.length, 14);
  assert.deepEqual(insert.values?.slice(1), [
    "workspace_1",
    "project_1",
    "run_1",
    "case_gold",
    "gold_1",
    "assignment_1",
    `hmac-sha256:v1:${"a".repeat(64)}`,
    "rater_1",
    "customer_invited",
    "owner_adjudicated",
    "candidate",
    true,
    now,
  ]);
});
