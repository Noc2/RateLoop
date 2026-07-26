import assert from "node:assert/strict";
import { test } from "node:test";
import { createNetworkAudienceOrchestration } from "~~/lib/tokenless/networkAudienceOrchestration";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { configurePaidLaneTestEnvironment } from "~~/test/helpers/paidLaneEnvironment";

configurePaidLaneTestEnvironment();

const HASH = `sha256:${"1".repeat(64)}` as `sha256:${string}`;

test("network audience orchestration binds preparation to network-only and reserves every exact subpanel", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const orchestrate = createNetworkAudienceOrchestration({
    prepare: async input => {
      calls.push({ kind: "prepare", ...input });
      return [
        { subpanelId: "subpanel_a", cohortId: "cohort_a", source: "rateloop_network", targetCount: 2 },
        { subpanelId: "subpanel_b", cohortId: "cohort_b", source: "rateloop_network", targetCount: 1 },
      ];
    },
    reserve: async input => {
      calls.push({ kind: "reserve", ...input });
      return {
        subpanelId: input.subpanelId,
        source: "rateloop_network",
        selectedCount: 1,
        selectionCommitment: HASH,
        integrity: {
          epochId: "integrity:2026-07-26",
          manifestHash: HASH,
          independentClusterCount: 1,
          largestClusterShareBps: 10_000,
          riskBandCounts: { low: 1, medium: 0, high: 0 },
        },
      };
    },
  });
  const result = await orchestrate({
    accountAddress: `rlp_${"1".repeat(24)}`,
    workspaceId: "workspace_network",
    projectId: "project_network",
    runId: "run_network",
    confidentialityTermsHash: HASH,
  });
  assert.equal(result.reservations.length, 2);
  assert.equal(calls[0]?.requiredSource, "rateloop_network");
  assert.deepEqual(
    calls.slice(1).map(value => value.subpanelId),
    ["subpanel_a", "subpanel_b"],
  );
});

test("network audience orchestration rejects invalid terms before preparation and mixed results before reservation", async () => {
  let prepared = 0;
  let reserved = 0;
  const orchestrate = createNetworkAudienceOrchestration({
    prepare: async () => {
      prepared += 1;
      return [
        {
          subpanelId: "subpanel_invited",
          cohortId: "cohort_invited",
          source: "customer_invited",
          targetCount: 1,
        },
      ];
    },
    reserve: async () => {
      reserved += 1;
      throw new Error("must not reserve");
    },
  });
  const base = {
    accountAddress: `rlp_${"1".repeat(24)}`,
    workspaceId: "workspace_network",
    projectId: "project_network",
    runId: "run_network",
  };
  await assert.rejects(
    orchestrate({ ...base, confidentialityTermsHash: "invalid" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_confidentiality_terms",
  );
  assert.equal(prepared, 0);
  await assert.rejects(
    orchestrate({ ...base, confidentialityTermsHash: HASH }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "network_audience_policy_required",
  );
  assert.equal(prepared, 1);
  assert.equal(reserved, 0);
});
