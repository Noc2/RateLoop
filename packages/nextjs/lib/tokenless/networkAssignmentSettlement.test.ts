import { HUMAN_ASSURANCE_SCHEMA_VERSION } from "@rateloop/sdk";
import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";
import { freezeAdmissionPolicy } from "~~/lib/tokenless/admissionPolicy";
import {
  __networkAssignmentSettlementTestUtils,
  attachIssuedNetworkVoucher,
  bindSelectedNetworkAssignment,
  loadExactNetworkRoundBindings,
  loadExactNetworkVoucherSelection,
  markNetworkVoucherConsumed,
  releaseSelectedNetworkAssignmentsForAccountDeletion,
} from "~~/lib/tokenless/networkAssignmentSettlement";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const PRINCIPAL = "rlp_network_assignment_test";
const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const PANEL = "0x2222222222222222222222222222222222222222" as const;
const CONTENT_ID = `0x${"a".repeat(64)}`;

function networkPolicy() {
  return {
    schemaVersion: HUMAN_ASSURANCE_SCHEMA_VERSION,
    policyId: "policy_network_exact",
    version: 1,
    reviewerSource: "rateloop_network" as const,
    integrity: {
      schemaVersion: "rateloop.integrity-assignment.v1" as const,
      epochId: "integrity:2026-07-26:001",
      epochManifestHash: `sha256:${"b".repeat(64)}` as const,
      maxClusterShareBps: 5_000,
      allowedRiskBands: ["low"] as const,
      recentCoassignmentWindowSeconds: 86_400,
      maxRecentCoassignments: 0,
      maxPerCustomer: 1,
      onePerProviderSubject: true as const,
    },
    compensation: "paid" as const,
    cohorts: [],
    selection: "randomized" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "account_control" as const,
          reviewerSources: ["rateloop_network" as const],
          allowedProviders: ["identity-production"],
        },
        {
          capability: "live_human" as const,
          reviewerSources: ["rateloop_network" as const],
          allowedProviders: ["identity-production"],
        },
        {
          capability: "minimum_age" as const,
          reviewerSources: ["rateloop_network" as const],
          allowedProviders: ["identity-production"],
        },
        {
          capability: "unique_human" as const,
          reviewerSources: ["rateloop_network" as const],
          allowedProviders: ["world:poh"],
        },
      ],
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source" as const],
      minimumAggregationSize: 2,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
}

test("funded network rounds are checked against the frozen policy and exact conservation", async () => {
  const frozen = freezeAdmissionPolicy(networkPolicy());
  const client = {
    async query() {
      return {
        rowCount: 1,
        rows: [
          {
            case_id: "case_exact",
            content_id: CONTENT_ID,
            admission_policy_hash: frozen.admissionPolicyHash,
            round_id: "42",
            round_status: "open",
            operation_key: "op_exact",
            deployment_key: "deployment_exact",
            chain_id: 84532,
            panel_address: PANEL,
            round_terms_json: JSON.stringify({
              bountyAmount: "100",
              feeAmount: "10",
              attemptReserve: "15",
              maximumCommits: 1,
            }),
            total_funded_atomic: "125",
            execution_state: "confirmed",
            confirmed_at: NOW,
            operation_workspace_id: "ws_exact",
            terms_json: JSON.stringify({ audiencePolicy: frozen.policy }),
            voucher_content_id: CONTENT_ID,
            voucher_admission_policy_hash: frozen.admissionPolicyHash,
            maximum_commits: 1,
            voucher_deadline: new Date(NOW.getTime() + 60_000),
            voucher_status: "open",
          },
        ],
      };
    },
  } as unknown as Pick<PoolClient, "query">;

  const rounds = await loadExactNetworkRoundBindings(client, {
    workspaceId: "ws_exact",
    runId: "run_exact",
    audiencePolicyHash: frozen.policyHash,
    audiencePolicyJson: frozen.policyJson,
    targetCount: 1,
    now: NOW,
  });
  assert.equal(rounds.length, 1);
  assert.deepEqual(
    {
      caseId: rounds[0]?.caseId,
      operationKey: rounds[0]?.operationKey,
      roundId: rounds[0]?.roundId,
      totalFundedAtomic: rounds[0]?.totalFundedAtomic,
      maximumCommits: rounds[0]?.maximumCommits,
    },
    {
      caseId: "case_exact",
      operationKey: "op_exact",
      roundId: "42",
      totalFundedAtomic: "125",
      maximumCommits: 1,
    },
  );
});

test("one selected seat advances through exact voucher issuance and consumption receipts", async () => {
  const integrity = {
    epochId: "integrity:2026-07-26:001",
    epochManifestHash: `sha256:${"b".repeat(64)}`,
    reviewerLookup: "reviewer_lookup_exact",
    clusterPseudonym: "cluster_exact",
    riskBand: "low",
    providerSubjectHashes: [`hmac-sha256:v1:${"c".repeat(64)}`],
    activeCustomerAssignments: 0,
    recentCoassignments: 0,
  };
  const integrityHash = __networkAssignmentSettlementTestUtils.sha256(integrity);
  const writes: Array<{ sql: string; values: readonly unknown[] | undefined }> = [];
  const bindingClient = {
    async query(sql: string, values?: readonly unknown[]) {
      writes.push({ sql, values });
      return { rowCount: 1, rows: [] };
    },
  } as unknown as Pick<PoolClient, "query">;
  const bound = await bindSelectedNetworkAssignment(bindingClient, {
    assignmentId: "assignment_exact",
    runId: "run_exact",
    subpanelId: "subpanel_exact",
    selectionBatchId: "batch_exact",
    integrityProvenanceHash: integrityHash,
    integrityReviewerLookup: "reviewer_lookup_exact",
    rounds: [
      {
        caseId: "case_exact",
        operationKey: "op_exact",
        deploymentKey: "deployment_exact",
        chainId: 84532,
        panelAddress: PANEL,
        roundId: "42",
        contentId: CONTENT_ID,
        admissionPolicyHash: `0x${"d".repeat(64)}`,
        roundTermsHash: `sha256:${"e".repeat(64)}`,
        totalFundedAtomic: "125",
        maximumCommits: 1,
      },
    ],
    now: NOW,
  });
  assert.match(bound.marker, /^selection:batch_exact:[0-9a-f]{64}$/u);
  assert.equal(bound.selectionBindingHashes.length, 1);
  assert.match(
    String(writes[1]?.values?.[4]),
    /"selectionBindingHash"/u,
    "selection receipt should preserve the exact binding",
  );
  assert.match(String(writes[1]?.values?.[4]), /"integrityReviewerCommitment":"sha256:/u);
  assert.doesNotMatch(String(writes[1]?.values?.[4]), /reviewer_lookup_exact/u);

  const selectionHash = bound.selectionBindingHashes[0]!;
  const selectionClient = {
    async query() {
      return {
        rowCount: 1,
        rows: [
          {
            binding_id: "binding_exact",
            assignment_id: "assignment_exact",
            operation_key: "op_exact",
            deployment_key: "deployment_exact",
            chain_id: 84532,
            panel_address: PANEL,
            round_id: "42",
            content_id: CONTENT_ID,
            principal_id: PRINCIPAL,
            assignment_status: "reserved",
            reservation_expires_at: new Date(NOW.getTime() + 60_000),
            assignment_expires_at: null,
            state: "selected",
            selection_binding_hash: selectionHash,
            admission_policy_hash: `0x${"d".repeat(64)}`,
            integrity_provenance_hash: integrityHash,
            assignment_integrity_provenance_hash: integrityHash,
            integrity_provenance_json: JSON.stringify(integrity),
            execution_operation_key: "op_exact",
            execution_deployment_key: "deployment_exact",
            execution_chain_id: 84532,
            execution_panel_address: PANEL,
            execution_round_id: "42",
            execution_content_id: CONTENT_ID,
            execution_state: "confirmed",
          },
        ],
      };
    },
  } as unknown as Pick<PoolClient, "query">;
  const selected = await loadExactNetworkVoucherSelection(selectionClient, {
    principalId: PRINCIPAL,
    assignmentId: "assignment_exact",
    selectionBindingHash: selectionHash,
    chainId: 84532,
    panelAddress: PANEL,
    roundId: "42",
    contentId: CONTENT_ID,
    admissionPolicyHash: `0x${"d".repeat(64)}`,
    now: NOW,
  });
  assert.equal(selected.bindingId, "binding_exact");

  const issuedWrites: string[] = [];
  const issuedClient = {
    async query(sql: string) {
      issuedWrites.push(sql);
      if (sql.startsWith("SELECT")) {
        return { rowCount: 1, rows: [{ operation_key: "op_exact", round_id: "42", content_id: CONTENT_ID }] };
      }
      return { rowCount: 1, rows: [] };
    },
  } as unknown as Pick<PoolClient, "query">;
  await attachIssuedNetworkVoucher(issuedClient, {
    ...selected,
    voucherId: "voucher_exact",
    issuedAt: NOW,
  });
  assert.equal(issuedWrites.length, 3);
  assert.match(issuedWrites[0]!, /^SELECT/u);
  assert.match(issuedWrites[1]!, /^INSERT INTO tokenless_network_assignment_settlement_receipts/u);
  assert.match(issuedWrites[2]!, /^UPDATE/u);

  const consumedWrites: string[] = [];
  const consumedClient = {
    async query(sql: string) {
      consumedWrites.push(sql);
      if (sql.startsWith("SELECT")) {
        return {
          rowCount: 1,
          rows: [
            {
              binding_id: "binding_exact",
              assignment_id: "assignment_exact",
              selection_binding_hash: selectionHash,
              state: "voucher_issued",
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  } as unknown as Pick<PoolClient, "query">;
  assert.deepEqual(
    await markNetworkVoucherConsumed(consumedClient, {
      voucherId: "voucher_exact",
      commitId: "commit_exact",
      transactionHash: `0x${"f".repeat(64)}`,
      committedAt: NOW,
    }),
    { networkBinding: true, replayed: false },
  );
  assert.equal(consumedWrites.length, 3);

  await assert.rejects(
    () =>
      loadExactNetworkVoucherSelection(selectionClient, {
        principalId: PRINCIPAL,
        assignmentId: "assignment_exact",
        selectionBindingHash: `sha256:${"0".repeat(64)}`,
        chainId: 84532,
        panelAddress: PANEL,
        roundId: "42",
        contentId: CONTENT_ID,
        admissionPolicyHash: `0x${"d".repeat(64)}`,
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "network_selection_binding_mismatch",
  );
  await assert.rejects(
    () =>
      loadExactNetworkVoucherSelection(selectionClient, {
        principalId: PRINCIPAL,
        assignmentId: "assignment_exact",
        selectionBindingHash: selectionHash,
        chainId: 84532,
        panelAddress: "0x3333333333333333333333333333333333333333",
        roundId: "42",
        contentId: CONTENT_ID,
        admissionPolicyHash: `0x${"d".repeat(64)}`,
        now: NOW,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "network_selection_binding_mismatch",
  );
});

test("account deletion releases selected seats to pseudonymous retained evidence", async () => {
  const statements: Array<{ sql: string; values: readonly unknown[] | undefined }> = [];
  const client = {
    async query(sql: string, values?: readonly unknown[]) {
      statements.push({ sql, values });
      if (sql.startsWith("SELECT")) {
        return {
          rowCount: 1,
          rows: [
            {
              binding_id: "binding_delete",
              assignment_id: "assignment_delete",
              selection_binding_hash: `sha256:${"a".repeat(64)}`,
              transition_revision: 1,
            },
          ],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  } as unknown as Pick<PoolClient, "query">;
  assert.deepEqual(
    await releaseSelectedNetworkAssignmentsForAccountDeletion(client, {
      principalId: PRINCIPAL,
      receiptDigest: "b".repeat(64),
      now: NOW,
    }),
    { released: 1 },
  );
  assert.match(statements[0]!.sql, /assignment\.status='released'/u);
  assert.match(statements[0]!.sql, /profile\.principal_id=\$1/u);
  assert.match(statements[1]!.sql, /^INSERT INTO tokenless_network_assignment_settlement_receipts/u);
  assert.match(statements[2]!.sql, /terminal_outcome='not_accepted'/u);
  const receiptJson = String(statements[1]?.values?.[4]);
  assert.match(receiptJson, /"accountDeletionReceiptHash":"sha256:b{64}"/u);
  assert.doesNotMatch(receiptJson, new RegExp(PRINCIPAL, "u"));
});

test("voucher expiry preserves every local commit state that can still confirm", () => {
  assert.deepEqual(__networkAssignmentSettlementTestUtils.recoverableLocalCommitStates, [
    "prepared",
    "signed",
    "retry",
    "submitted",
    "confirmed",
  ]);
});

test("terminal settlement distinguishes payout, compensation, pending, and expired claims", () => {
  const base = {
    schemaVersion: "rateloop.rater-settlement.v1" as const,
    chainId: 84532,
    panelAddress: PANEL,
    roundId: "42",
    voteKey: ACCOUNT,
    commitKey: `0x${"1".repeat(64)}` as `0x${string}`,
    commitState: "confirmed",
    revealed: true,
    scoringEligible: true,
    canReveal: false,
    canClaim: false,
    commitDeadline: "1",
    revealDeadline: "2",
    beaconFailureDeadline: "3",
  };
  const terminal = __networkAssignmentSettlementTestUtils.terminalSettlement;
  assert.equal(
    terminal(
      {
        ...base,
        roundStatus: "finalized",
        claimed: true,
        finalizedPayoutAtomic: "100",
        compensationAtomic: "10",
        claimKind: "payout",
        claimDeadline: "2000000000",
      },
      NOW,
    ),
    "paid",
  );
  assert.equal(
    terminal(
      {
        ...base,
        roundStatus: "under_quorum_compensated",
        claimed: true,
        finalizedPayoutAtomic: "0",
        compensationAtomic: "10",
        claimKind: "compensation",
        claimDeadline: "2000000000",
      },
      NOW,
    ),
    "compensated",
  );
  assert.equal(
    terminal(
      {
        ...base,
        roundStatus: "finalized",
        claimed: false,
        finalizedPayoutAtomic: "100",
        compensationAtomic: "10",
        claimKind: "payout",
        claimDeadline: "2000000000",
      },
      NOW,
    ),
    null,
  );
  assert.equal(
    terminal(
      {
        ...base,
        roundStatus: "beacon_failure_compensated",
        claimed: false,
        finalizedPayoutAtomic: "0",
        compensationAtomic: "10",
        claimKind: "compensation",
        claimDeadline: "1",
      },
      NOW,
    ),
    "claim_expired",
  );
});
