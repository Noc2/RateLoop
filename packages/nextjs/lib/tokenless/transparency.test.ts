import {
  TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS,
  TOKENLESS_QUICKNET_T_CHAIN_HASH,
  TOKENLESS_SCORING_BEACON_SAFETY_MARGIN_SECONDS,
  tokenlessFirstQuicknetRoundAfter,
  tokenlessQuicknetTimestamp,
} from "@rateloop/sdk";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient, dbPool } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { type TokenlessChainRuntime, __setTokenlessChainRuntimeForTests } from "~~/lib/tokenless/chain/runtime";
import { moderateTokenlessPublicRaterResponse } from "~~/lib/tokenless/moderation";
import {
  __setPublicRaterResponseKeyringForTests,
  preparePublicRaterResponse,
} from "~~/lib/tokenless/publicRaterResponses";
import { createPublicRaterResponse } from "~~/lib/tokenless/rater/publicResponse";
import { tokenlessCommitKey } from "~~/lib/tokenless/rater/settlementRecovery";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import {
  appendFinalizedRoundEvidence,
  appendTerminalRoundEvidence,
  assertPublicWebhookDestination,
  createWorkspaceWebhook,
  deliverPendingWebhooks,
  deriveTerminalRoundEvidence,
  inspectWorkspaceTransparency,
  listWorkspaceWebhooks,
  publishTerminalRoundResult,
  recomputeRbtsSettlement,
  reviewAndPublishResult,
  stableTransparencyJson,
  subscribeAskWebhook,
  validateWebhookUrl,
} from "~~/lib/tokenless/transparency";

const OWNER = "0x1111111111111111111111111111111111111111";
const WORKSPACE = "ws_transparency";
const OPERATION = "op_transparency";
const PANEL = `0x${"aa".repeat(20)}`;
const ISSUER = `0x${"bb".repeat(20)}`;
const ADAPTER = `0x${"cc".repeat(20)}`;
const FEEDBACK_BONUS = `0x${"ff".repeat(20)}`;
const USDC = `0x${"dd".repeat(20)}`;
const FEE_RECIPIENT = `0x${"ee".repeat(20)}`;
const CONTENT_ID = `0x${"61".repeat(32)}` as `0x${string}`;
const TERMS_HASH = `0x${"62".repeat(32)}`;
const POLICY_HASH = `0x${"63".repeat(32)}`;
const BEACON_HASH = TOKENLESS_QUICKNET_T_CHAIN_HASH;
const DEPLOYMENT = `tokenless-v4:84532:${PANEL}:${ISSUER}:${ADAPTER}:${FEEDBACK_BONUS}`;
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
const NOW = new Date("2026-07-12T18:00:00.000Z");
const resolvePublic = async () => ["93.184.216.34"];
const FINALIZED_BLOCK = 44_060_000n;
const FINALIZED_BLOCK_HASH = `0x${"ab".repeat(32)}` as const;
let finalityLatestBlock = FINALIZED_BLOCK + 63n;
let canonicalFinalizedBlockHash: `0x${string}` = FINALIZED_BLOCK_HASH;
let finalityRpcFailure = false;

const FINALITY_ENV = {
  TOKENLESS_DEPLOYMENT_SCHEMA: "rateloop-tokenless-deployment-v4",
  TOKENLESS_CHAIN_ID: "84532",
  TOKENLESS_PANEL_ADDRESS: PANEL,
  TOKENLESS_CREDENTIAL_ISSUER_ADDRESS: ISSUER,
  TOKENLESS_X402_PANEL_SUBMITTER_ADDRESS: ADAPTER,
  TOKENLESS_FEEDBACK_BONUS_ADDRESS: FEEDBACK_BONUS,
  TOKENLESS_USDC_ADDRESS: USDC,
  TOKENLESS_FEE_RECIPIENT: FEE_RECIPIENT,
  TOKENLESS_DEPLOYMENT_KEY: DEPLOYMENT,
  TOKENLESS_DEPLOYMENT_BLOCK: "44050000",
  BASE_SEPOLIA_RPC_URL: "https://base-sepolia.example.test",
  TOKENLESS_EVIDENCE_CONFIRMATION_DEPTH: "64",
} as const;
const originalFinalityEnv = new Map(
  [...Object.keys(FINALITY_ENV), "TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG"].map(key => [key, process.env[key]]),
);

function configureFinalityEnvironment() {
  for (const [key, value] of Object.entries(FINALITY_ENV)) process.env[key] = value;
  delete process.env.TOKENLESS_EVIDENCE_FINALITY_BLOCK_TAG;
}

function restoreFinalityEnvironment() {
  for (const [key, value] of originalFinalityEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function finalityRuntime(): TokenlessChainRuntime {
  const failIfConfigured = () => {
    if (finalityRpcFailure) throw new Error("Base RPC unavailable");
  };
  return {
    publicClient: {
      getChainId: async () => {
        failIfConfigured();
        return 84_532;
      },
      getBlockNumber: async () => {
        failIfConfigured();
        return finalityLatestBlock;
      },
      getBlock: async ({ blockNumber }: { blockNumber?: bigint }) => {
        failIfConfigured();
        return {
          hash: blockNumber === FINALIZED_BLOCK ? canonicalFinalizedBlockHash : `0x${"ef".repeat(32)}`,
          number: blockNumber ?? finalityLatestBlock,
        };
      },
    } as unknown as TokenlessChainRuntime["publicClient"],
  };
}

const COMMIT_DEADLINE = 1_783_878_000n;
const REVEAL_DEADLINE = COMMIT_DEADLINE + 300n;
const BEACON_ROUND = tokenlessFirstQuicknetRoundAfter(COMMIT_DEADLINE);
const SCORING_BEACON_ROUND = tokenlessFirstQuicknetRoundAfter(
  REVEAL_DEADLINE + TOKENLESS_SCORING_BEACON_SAFETY_MARGIN_SECONDS,
);
const BEACON_FAILURE_DEADLINE =
  tokenlessQuicknetTimestamp(SCORING_BEACON_ROUND) + TOKENLESS_MINIMUM_BEACON_FAILURE_GRACE_SECONDS;

const roundTerms = {
  contentId: CONTENT_ID,
  termsHash: TERMS_HASH,
  beaconNetworkHash: BEACON_HASH,
  bountyAmount: "25000000",
  feeAmount: "1875000",
  attemptReserve: "20000000",
  attemptCompensation: "4000000",
  minimumReveals: 3,
  maximumCommits: 5,
  admissionPolicyHash: POLICY_HASH,
  commitDeadline: COMMIT_DEADLINE.toString(),
  revealDeadline: REVEAL_DEADLINE.toString(),
  beaconFailureDeadline: BEACON_FAILURE_DEADLINE.toString(),
  beaconRound: BEACON_ROUND.toString(),
  scoringBeaconRound: SCORING_BEACON_ROUND.toString(),
  claimGracePeriod: "604800",
  feeRecipient: FEE_RECIPIENT,
};

const VOTE_KEYS = Array.from({ length: 5 }, (_, index) => `0x${String(index + 1).padStart(40, "0")}` as `0x${string}`);
const COMMIT_KEYS = VOTE_KEYS.map(voteKey => tokenlessCommitKey(42n, voteKey));
const ENTROPY = `0x${"73".repeat(32)}` as const;
const RBTS_FIXTURE = recomputeRbtsSettlement({
  chainId: 84_532,
  entropy: ENTROPY,
  fixedBasePay: 4_000_000n,
  maximumBonus: 1_000_000n,
  mode: "rbts",
  panelAddress: PANEL as `0x${string}`,
  reveals: COMMIT_KEYS.map((commitKey, index) => ({
    commitKey,
    predictedUpBps: 7_000,
    vote: index === 4 ? (0 as const) : (1 as const),
  })),
  roundId: 42n,
});
const BOUNTY_REFUND = 25_000_000n - RBTS_FIXTURE.totalFinalizedLiability;
const FUNDER_REFUND = 20_000_000n + BOUNTY_REFUND;
const economics = {
  asset: "USDC" as const,
  decimals: 6 as const,
  bounty: {
    fundedAtomic: "25000000",
    paidAtomic: RBTS_FIXTURE.totalFinalizedLiability.toString(),
    refundedAtomic: BOUNTY_REFUND.toString(),
  },
  fee: { bps: 750, fundedAtomic: "1875000", paidAtomic: "1875000", refundedAtomic: "0" },
  attemptReserve: { fundedAtomic: "20000000", compensatedAtomic: "0", refundedAtomic: "20000000" },
  refund: {
    bountyAtomic: BOUNTY_REFUND.toString(),
    feeAtomic: "0",
    attemptReserveAtomic: "20000000",
    totalAtomic: FUNDER_REFUND.toString(),
  },
  compensation: { perAcceptedRevealCapAtomic: "4000000", recipientCount: 0, totalAtomic: "0" },
  totalFundedAtomic: "46875000",
};

function indexedRound(overrides: Record<string, unknown> = {}) {
  return {
    deploymentKey: DEPLOYMENT,
    roundId: "42",
    funder: OWNER,
    contentId: CONTENT_ID,
    termsHash: TERMS_HASH,
    beaconNetworkHash: BEACON_HASH,
    beaconRound: roundTerms.beaconRound,
    scoringBeaconRound: roundTerms.scoringBeaconRound,
    feeRecipient: FEE_RECIPIENT,
    bountyAmount: roundTerms.bountyAmount,
    feeAmount: roundTerms.feeAmount,
    attemptReserve: roundTerms.attemptReserve,
    attemptCompensation: roundTerms.attemptCompensation,
    fixedBasePay: "4000000",
    maximumBonus: "1000000",
    compensationPerRecipient: "0",
    funderRefund: FUNDER_REFUND.toString(),
    totalCompensation: "0",
    totalRbtsScoreBps: RBTS_FIXTURE.totalRbtsScoreBps.toString(),
    totalFinalizedLiability: RBTS_FIXTURE.totalFinalizedLiability.toString(),
    totalPaid: "0",
    entropy: ENTROPY,
    revealSetXor: RBTS_FIXTURE.revealSetXor,
    revealSetSum: RBTS_FIXTURE.revealSetSum.toString(),
    scoringSeed: RBTS_FIXTURE.scoringSeed,
    scoringVersion: 2,
    scoringMode: 1,
    minimumReveals: roundTerms.minimumReveals,
    maximumCommits: roundTerms.maximumCommits,
    admissionPolicyHash: POLICY_HASH,
    commitDeadline: roundTerms.commitDeadline,
    revealDeadline: roundTerms.revealDeadline,
    beaconFailureDeadline: roundTerms.beaconFailureDeadline,
    claimGracePeriod: roundTerms.claimGracePeriod,
    commitCount: 5,
    revealCount: 5,
    compensatedRevealCount: 5,
    frozenRevealCount: 5,
    aggregateCursor: 5,
    scoreCursor: 5,
    upVotes: 4,
    state: 5,
    createdBlock: "44050001",
    finalizedAt: String(Math.floor(NOW.getTime() / 1_000)),
    finalizedBlock: FINALIZED_BLOCK.toString(),
    finalizedBlockHash: FINALIZED_BLOCK_HASH,
    finalizedTxHash: `0x${"cd".repeat(32)}`,
    ...overrides,
  };
}

function indexedCommits(responseHash?: string) {
  return Array.from({ length: 5 }, (_, index) => {
    const score = RBTS_FIXTURE.scores.get(COMMIT_KEYS[index].toLowerCase())!;
    return {
      deploymentKey: DEPLOYMENT,
      roundId: "42",
      commitKey: COMMIT_KEYS[index],
      voteKey: VOTE_KEYS[index],
      nullifier: `0x${String(index + 11).padStart(64, "0")}`,
      responseHash: responseHash ?? `0x${String(index + 21).padStart(64, "0")}`,
      vote: index === 4 ? 0 : 1,
      predictedUpBps: 7_000,
      referenceCommitKey: score.referenceCommitKey,
      peerCommitKey: score.peerCommitKey,
      finalizedPayout: score.finalizedPayout.toString(),
      informationScoreBps: score.informationScoreBps,
      predictionScoreBps: score.predictionScoreBps,
      rbtsScoreBps: score.rbtsScoreBps,
      committedAt: String(Math.floor(NOW.getTime() / 1_000) + index * 10),
      revealed: true,
      scoringEligible: true,
    };
  });
}

function ponderFetch(input: { round?: Record<string, unknown>; commits?: Record<string, unknown>[] } = {}) {
  return async (request: string | URL | Request) => {
    const url = new URL(typeof request === "string" || request instanceof URL ? request : request.url);
    if (url.pathname.endsWith("/deployment")) {
      return Response.json({
        deploymentKey: DEPLOYMENT,
        chainId: 84_532,
        panelAddress: PANEL,
        issuerAddress: ISSUER,
        adapterAddress: ADAPTER,
        feedbackBonusAddress: FEEDBACK_BONUS,
        startBlock: 44_050_000,
      });
    }
    if (url.pathname.endsWith("/rounds/42/commits")) return Response.json(input.commits ?? indexedCommits());
    if (url.pathname.endsWith("/rounds/42")) return Response.json(input.round ?? indexedRound());
    return Response.json({ error: "not found" }, { status: 404 });
  };
}

async function seedFrozenIntegrityAssignments() {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id, workspace_id, name, data_classification, status, retention_days,
           created_by, created_at, updated_at)
          VALUES ('project_transparency', ?, 'Transparency integrity', 'confidential', 'active',
                  30, ?, ?, ?)`,
    args: [WORKSPACE, OWNER, NOW, NOW],
  });
  for (const [artifactId, role] of [
    ["artifact_transparency_a", "baseline"],
    ["artifact_transparency_b", "candidate"],
  ] as const) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_artifacts
            (artifact_id, project_id, role, label, digest, content_type, size_bytes,
             storage_ref, redaction_status, renderer_policy, created_at, updated_at)
            VALUES (?, 'project_transparency', ?, ?, ?, 'application/json', 1, ?,
                    'approved', 'safe_json', ?, ?)`,
      args: [
        artifactId,
        role,
        role,
        `sha256:${role === "baseline" ? "a".repeat(64) : "b".repeat(64)}`,
        `private:${artifactId}`,
        NOW,
        NOW,
      ],
    });
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_rubrics
          (rubric_id, project_id, version, prompt, failure_tags_json, rationale_json,
           pass_rule_json, rubric_json, created_at)
          VALUES ('rubric_transparency', 'project_transparency', 1, 'Ship decision', '[]',
                  '{"mode":"optional"}', '{"minimumValidResponses":3}', '{}', ?)`,
    args: [NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_suites
          (suite_id, project_id, name, version, status, rubric_id, rubric_version,
           manifest_hash, manifest_json, frozen_at, created_at, updated_at)
          VALUES ('suite_transparency', 'project_transparency', 'Suite', 1, 'frozen',
                  'rubric_transparency', 1, 'sha256:suite', '{}', ?, ?, ?)`,
    args: [NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cases
          (case_id, project_id, suite_id, suite_version, position, title, instructions,
           baseline_artifact_id, candidate_artifact_id, context_artifact_ids_json, status,
           created_at, updated_at, deterministic_checks_json)
          VALUES ('case_transparency', 'project_transparency', 'suite_transparency', 1, 1,
                  'Case', 'Compare', 'artifact_transparency_a', 'artifact_transparency_b',
                  '[]', 'ready', ?, ?, '[]')`,
    args: [NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_audience_policies
          (policy_id, project_id, version, reviewer_source, compensation, cohorts_json,
           selection, fallbacks_json, required_qualifications_json, assurance_json,
           buyer_privacy_json, legal_eligibility_required, policy_hash, policy_json, created_at)
          VALUES ('policy_transparency', 'project_transparency', 1, 'rateloop_network', 'paid',
                  '[]', 'randomized', '{"allowed":false,"sources":[]}', '[]',
                  '{"requirements":[]}', '{}', true, 'sha256:policy', '{}', ?)`,
    args: [NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_runs
          (run_id, project_id, suite_id, suite_version, audience_policy_id,
           audience_policy_version, status, policy_hash, manifest_hash, manifest_json,
           created_by, created_at, updated_at, frozen_at)
          VALUES ('run_transparency', 'project_transparency', 'suite_transparency', 1,
                  'policy_transparency', 1, 'completed', 'sha256:policy', 'sha256:manifest',
                  '{}', ?, ?, ?, ?)`,
    args: [OWNER, NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_run_cases
          (run_id, case_id, position, variant_a_artifact_id, variant_b_artifact_id,
           blinding_commitment, blinding_secret_json, deterministic_checks_json,
           deterministic_checks_hash, deterministic_checks_status, content_id,
           admission_policy_hash, round_id, round_status, created_at, updated_at)
          VALUES ('run_transparency', 'case_transparency', 1, 'artifact_transparency_a',
                  'artifact_transparency_b', 'sha256:blind', '{}', '[]', 'sha256:checks',
                  'not_applicable', ?, ?, '42', 'finalized', ?, ?)`,
    args: [CONTENT_ID, POLICY_HASH, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_cohorts
          (cohort_id, project_id, name, source, selection, capacity, active_reservations,
           qualification_rules_json, status, created_by, created_at, updated_at)
          VALUES ('cohort_transparency', 'project_transparency', 'Network', 'rateloop_network',
                  'randomized', 5, 0, '[]', 'active', ?, ?, ?)`,
    args: [OWNER, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_run_subpanels
          (subpanel_id, workspace_id, project_id, run_id, cohort_id, source, selection,
           target_count, active_reservations, policy_id, policy_version, policy_hash,
           run_manifest_hash, created_at)
          VALUES ('subpanel_transparency', ?, 'project_transparency', 'run_transparency',
                  'cohort_transparency', 'rateloop_network', 'randomized', 5, 0,
                  'policy_transparency', 1, 'sha256:policy', 'sha256:manifest', ?)`,
    args: [WORKSPACE, NOW],
  });
  for (let index = 0; index < 5; index += 1) {
    const accountAddress = `0x${String(index + 101).padStart(40, "0")}`;
    const reviewerLookup = `hmac-sha256:lookup-v1:${String(index + 1).padStart(64, "0")}`;
    const clusterPseudonym = `hmac-sha256:cluster-v1:${String(index + 11).padStart(64, "0")}`;
    const providerSubjectHashes = [`hmac-sha256:world-v1:${String(index + 21).padStart(64, "0")}`];
    const provenanceJson = stableTransparencyJson({
      schemaVersion: "rateloop.assignment-integrity-provenance.v1",
      constraints: { maxClusterShareBps: 5_000, maxRecentCoassignments: 0 },
      reviewerLookup,
      clusterPseudonym,
      providerSubjectHashes,
      recentCoassignments: 0,
    });
    const provenanceHash = `sha256:${createHash("sha256").update(provenanceJson).digest("hex")}`;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_cohort_reviewers
            (project_id, cohort_id, reviewer_account_address, qualification_provenance_json,
             maximum_active_assignments, active_reservations, status, created_by, created_at, updated_at)
            VALUES ('project_transparency', 'cohort_transparency', ?, '[]', 1, 0,
                    'active', ?, ?, ?)`,
      args: [accountAddress, OWNER, NOW, NOW],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_assignments
            (assignment_id, workspace_id, project_id, run_id, subpanel_id, cohort_id,
             reviewer_account_address, source, selection, status, confidentiality_terms_hash,
             qualification_provenance_json, assurance_snapshot_json, assurance_snapshot_hash,
             blinding_json, paid_assignment, paid_eligibility_checked_at, reservation_expires_at,
             assignment_expires_at, lease_issuer_account_address, lease_state, created_at, updated_at,
             integrity_reviewer_lookup, integrity_cluster_pseudonym, provider_subject_hashes_json,
             integrity_provenance_json, integrity_provenance_hash, rater_id, payout_account_snapshot)
            VALUES (?, ?, 'project_transparency', 'run_transparency', 'subpanel_transparency',
                    'cohort_transparency', ?, 'rateloop_network', 'randomized', ?, 'sha256:terms',
                    '[]', '{}', 'sha256:snapshot', '{}', true, ?, ?, ?, ?, 'expired', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `assignment_transparency_${index}`,
        WORKSPACE,
        accountAddress,
        index % 2 === 0 ? "reserved" : "expired",
        NOW,
        new Date(NOW.getTime() - 120_000),
        new Date(NOW.getTime() - 60_000),
        OWNER,
        NOW,
        NOW,
        reviewerLookup,
        clusterPseudonym,
        stableTransparencyJson(providerSubjectHashes),
        provenanceJson,
        provenanceHash,
        `rater_transparency_${index}`,
        accountAddress,
      ],
    });
  }
}

beforeEach(async () => {
  configureFinalityEnvironment();
  finalityLatestBlock = FINALIZED_BLOCK + 63n;
  canonicalFinalizedBlockHash = FINALIZED_BLOCK_HASH;
  finalityRpcFailure = false;
  __setTokenlessChainRuntimeForTests(finalityRuntime());
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
  __setPublicRaterResponseKeyringForTests({
    currentVersion: "v1",
    keys: new Map([["v1", Buffer.alloc(32, 7)]]),
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_workspaces (workspace_id, name, status, created_at, updated_at) VALUES (?, 'Transparency', 'active', ?, ?)",
    args: [WORKSPACE, NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at) VALUES (?, ?, 'owner', ?)",
    args: [WORKSPACE, OWNER, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_quotes
          (quote_id, request_hash, request_json, response_json, expires_at, created_at)
          VALUES ('quote_transparency', 'hash', ?, ?, ?, ?)`,
    args: [
      JSON.stringify({ question: { kind: "binary", prompt: "Ship?" }, visibility: "public" }),
      JSON.stringify({
        schemaVersion: "rateloop.tokenless.v2",
        audience: {
          admissionPolicyHash: POLICY_HASH,
          label: "Customer-invited reviewers",
          source: "customer_invited",
        },
        responseWindowSeconds: 3_600,
        requestProfile: null,
        reviewEconomics: null,
      }),
      new Date("2027-01-01T00:00:00Z"),
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_asks
          (operation_key, idempotency_key, request_hash, quote_id, request_json, economics_json, status, verdict_status, round_id, created_at, updated_at)
          VALUES (?, 'transparency:test:1', 'ask_hash', 'quote_transparency', '{}', ?, 'submitted', NULL, '42', ?, ?)`,
    args: [OPERATION, JSON.stringify(economics), NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_content_records (content_id, workspace_id, content_hash, content_json, moderation_status, created_at, updated_at) VALUES ('content_transparency', ?, 'content_hash', '{}', 'approved', ?, ?)",
    args: [WORKSPACE, NOW, NOW],
  });
  await dbClient.execute({
    sql: "INSERT INTO tokenless_question_records (question_id, workspace_id, content_id, quote_id, terms_hash, terms_json, moderation_status, created_at, updated_at) VALUES ('question_transparency', ?, 'content_transparency', 'quote_transparency', 'terms_hash', '{}', 'approved', ?, ?)",
    args: [WORKSPACE, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_ask_ownership
          (operation_key, workspace_id, owner_account_address, question_id, payment_mode, payment_state, payment_reference, idempotency_key, created_at, updated_at)
          VALUES (?, ?, ?, 'question_transparency', 'prepaid', 'settled', 'payment', 'transparency:test:1', ?, ?)`,
    args: [OPERATION, WORKSPACE, OWNER, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_chain_executions
          (execution_id, operation_key, payment_mode, payment_reference, deployment_key, chain_id, deployment_block, panel_address, issuer_address, x402_submitter_address, usdc_address, funder_address, content_id, terms_hash, round_terms_json, total_funded_atomic, state, round_id, created_at, updated_at)
          VALUES ('execution_transparency', ?, 'prepaid', 'payment', ?, 84532, 44050000, ?, ?, ?, ?, ?, ?, ?, ?, 46875000, 'confirmed', 42, ?, ?)`,
    args: [
      OPERATION,
      DEPLOYMENT,
      PANEL,
      ISSUER,
      ADAPTER,
      USDC,
      OWNER,
      CONTENT_ID,
      TERMS_HASH,
      JSON.stringify(roundTerms),
      NOW,
      NOW,
    ],
  });
  for (let index = 0; index < 5; index += 1) {
    const raterId = `rater_transparency_${index}`;
    const principalId = `principal_transparency_${index}`;
    const accountAddress = `0x${String(index + 101).padStart(40, "0")}`;
    const identitySubjectHash = `identity_${index}`;
    const voteKey = VOTE_KEYS[index]!;
    const assuranceSnapshotJson = stableTransparencyJson({
      schemaVersion: "rateloop.voucher-assurance-snapshot.v1",
      reviewerSource: "rateloop_network",
      assertions: [
        {
          assertionId: `assertion_${index}`,
          bindingId: `binding_${index}`,
          providerId: "self_xyz",
          providerNamespace: "self:test",
          subjectReferenceHash: identitySubjectHash,
          capabilities: ["live_human", "unique_human"],
          verifiedAt: NOW.toISOString(),
          expiresAt: "2027-01-01T00:00:00.000Z",
        },
      ],
      qualifications: [],
      cohortIds: [],
      capturedAt: NOW.toISOString(),
    });
    const assuranceSnapshotHash = `sha256:${createHash("sha256").update(assuranceSnapshotJson).digest("hex")}`;
    await dbClient.execute({
      sql: `INSERT INTO tokenless_principals (principal_id, status, created_at, updated_at)
            VALUES (?, 'active', ?, ?)`,
      args: [principalId, NOW, NOW],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_rater_profiles
            (rater_id, principal_id, account_address, nullifier_seed_ciphertext, nullifier_key_version,
             nullifier_key_domain, created_at, updated_at)
            VALUES (?, ?, ?, 'ciphertext', 'v1', 'vote_mapping', ?, ?)`,
      args: [raterId, principalId, accountAddress, NOW, NOW],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_paid_vouchers
            (voucher_id, rater_id, request_idempotency_key, request_hash,
             chain_id, panel_address, issuer_address, issuer_epoch, signer_address, round_id,
             content_id, vote_key, nullifier, admission_policy_hash, assurance_snapshot_hash,
             expires_at, payout_account_snapshot, voucher_json, voucher_signature,
             status, issued_at)
            VALUES (?, ?, ?, ?, 84532, ?, ?, 1, ?, 42, ?, ?, ?, ?, ?, ?, ?, '{}', 'signature', 'committed', ?)`,
      args: [
        `voucher_${index}`,
        raterId,
        `voucher_request_${index}`,
        `voucher_hash_${index}`,
        PANEL,
        ISSUER,
        ISSUER,
        CONTENT_ID,
        voteKey,
        `0x${String(index + 11).padStart(64, "0")}`,
        POLICY_HASH,
        assuranceSnapshotHash,
        new Date("2027-01-01T00:00:00Z"),
        accountAddress,
        NOW,
      ],
    });
    await dbClient.execute({
      sql: `INSERT INTO tokenless_voucher_assurance_snapshots
            (voucher_id, rater_id, reviewer_source, snapshot_json, snapshot_hash, created_at)
            VALUES (?, ?, 'rateloop_network', ?, ?, ?)`,
      args: [`voucher_${index}`, raterId, assuranceSnapshotJson, assuranceSnapshotHash, NOW],
    });
  }
});

afterEach(() => {
  __setPublicRaterResponseKeyringForTests(null);
  __setTokenlessChainRuntimeForTests(null);
  __setDatabaseResourcesForTests(null);
  restoreFinalityEnvironment();
});

test("canonical evidence and normative RBTS accounting are deterministic", () => {
  assert.equal(stableTransparencyJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
  const baseOnly = recomputeRbtsSettlement({
    chainId: 84_532,
    entropy: `0x${"00".repeat(32)}`,
    fixedBasePay: 4_000_000n,
    maximumBonus: 1_000_000n,
    mode: "base_only_beacon_unavailable",
    panelAddress: PANEL as `0x${string}`,
    reveals: COMMIT_KEYS.map((commitKey, index) => ({
      commitKey,
      predictedUpBps: 7_000,
      vote: index === 4 ? (0 as const) : (1 as const),
    })),
    roundId: 42n,
  });
  assert.equal(baseOnly.scoringSeed, `0x${"00".repeat(32)}`);
  assert.equal(baseOnly.totalFinalizedLiability, 20_000_000n);
  assert.ok([...baseOnly.scores.values()].every(score => score.rbtsScoreBps === 0));
});

test("finalized evidence rejects malformed Ponder provenance and altered frozen terms", async () => {
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({ round: indexedRound({ finalizedBlockHash: "0x12" }) }),
        ponderUrl: "https://ponder.example.test",
      }),
    /Finalized block hash is malformed/,
  );
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({ round: indexedRound({ bountyAmount: "1" }) }),
        ponderUrl: "https://ponder.example.test",
      }),
    /do not match the frozen terms/,
  );
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({ round: indexedRound({ entropy: `0x${"74".repeat(32)}` }) }),
        ponderUrl: "https://ponder.example.test",
      }),
    /RBTS aggregate evidence is inconsistent/,
  );
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({
          commits: indexedCommits().map((commit, index) =>
            index === 0 ? { ...commit, finalizedPayout: "4500001" } : commit,
          ),
        }),
        ponderUrl: "https://ponder.example.test",
      }),
    /RBTS score evidence is inconsistent/,
  );
  await dbClient.execute(
    "UPDATE tokenless_voucher_assurance_snapshots SET snapshot_json = '{}' WHERE voucher_id = 'voucher_0'",
  );
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch(),
        ponderUrl: "https://ponder.example.test",
      }),
    /provenance hash is invalid/,
  );
});

test("all incomplete terminal states publish conserved results instead of polling forever", async () => {
  const fullRefund = "46875000";
  const unrevealedCommits = indexedCommits().map(commit => ({
    ...commit,
    revealed: false,
    scoringEligible: false,
  }));
  const zeroCommit = await deriveTerminalRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch({
      commits: [],
      round: indexedRound({
        state: 6,
        commitCount: 0,
        revealCount: 0,
        compensatedRevealCount: 0,
        compensationPerRecipient: "0",
        totalCompensation: "0",
        funderRefund: fullRefund,
        claimDeadline: "0",
      }),
    }),
    ponderUrl: "https://ponder.example.test",
  });
  assert.equal(zeroCommit.verdictStatus, "zero_commit_refunded");
  assert.equal(zeroCommit.economics.refund.totalAtomic, fullRefund);

  const beaconFailure = await deriveTerminalRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch({
      commits: unrevealedCommits,
      round: indexedRound({
        state: 8,
        revealCount: 0,
        compensatedRevealCount: 0,
        compensationPerRecipient: "4000000",
        totalCompensation: "0",
        funderRefund: fullRefund,
        claimDeadline: "1784484000",
      }),
    }),
    ponderUrl: "https://ponder.example.test",
  });
  assert.equal(beaconFailure.verdictStatus, "beacon_failure_compensated");
  assert.equal(beaconFailure.economics.compensation.recipientCount, 0);

  const underQuorumCommits = indexedCommits().map((commit, index) => ({
    ...commit,
    revealed: index < 3,
    scoringEligible: index < 2,
  }));
  const underQuorumRound = indexedRound({
    state: 7,
    revealCount: 2,
    compensatedRevealCount: 3,
    compensationPerRecipient: "4000000",
    totalCompensation: "12000000",
    funderRefund: "34875000",
    claimDeadline: "1784484000",
  });
  const underQuorum = await deriveTerminalRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch({ commits: underQuorumCommits, round: underQuorumRound }),
    ponderUrl: "https://ponder.example.test",
  });
  assert.equal(underQuorum.verdictStatus, "under_quorum_compensated");
  assert.equal(underQuorum.timelyRevealCount, 2);
  assert.equal(underQuorum.compensatedRevealCount, 3);
  assert.equal(underQuorum.economics.compensation.totalAtomic, "12000000");
  assert.equal(underQuorum.economics.refund.totalAtomic, "34875000");

  await dbClient.execute({
    sql: `INSERT INTO tokenless_surprise_bounty_rounds
          (bounty_round_id, operation_key, deployment_key, version, state, policy_json,
           guaranteed_base_per_report_atomic, maximum_bonus_per_report_atomic,
           reserved_report_capacity, maximum_liability_atomic, paid_bonus_atomic,
           reservation_expires_at, created_at, updated_at)
          VALUES ('sbr_terminal', ?, ?, 'v1', 'funded', '{}', 1000000, 125000,
                  10, 1250000, 0, NULL, ?, ?)`,
    args: [OPERATION, DEPLOYMENT, NOW, NOW],
  });

  await assert.rejects(
    () =>
      deriveTerminalRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({
          commits: underQuorumCommits,
          round: { ...underQuorumRound, totalCompensation: "8000000" },
        }),
        ponderUrl: "https://ponder.example.test",
      }),
    /internally inconsistent/,
  );
  await assert.rejects(
    () =>
      deriveTerminalRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({
          commits: underQuorumCommits.map((commit, index) =>
            index === 1 ? { ...commit, voteKey: VOTE_KEYS[0] } : commit,
          ),
          round: underQuorumRound,
        }),
        ponderUrl: "https://ponder.example.test",
      }),
    /reveal identities are not unique/,
  );
  await assert.rejects(
    () =>
      deriveTerminalRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({
          commits: underQuorumCommits.map((commit, index) =>
            index === 0 ? { ...commit, responseHash: "0x12" } : commit,
          ),
          round: underQuorumRound,
        }),
        ponderUrl: "https://ponder.example.test",
      }),
    /response hash is malformed/,
  );

  await assert.rejects(
    () =>
      appendTerminalRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({
          commits: underQuorumCommits,
          round: {
            ...underQuorumRound,
            finalizedAt: String(Math.floor(Date.now() / 1_000) + 301),
          },
        }),
        ponderUrl: "https://ponder.example.test",
      }),
    /Terminal timestamp is invalid/,
  );
  const bountyBeforeValidEvidence = await dbClient.execute({
    sql: "SELECT state FROM tokenless_surprise_bounty_rounds WHERE operation_key = ?",
    args: [OPERATION],
  });
  assert.equal(bountyBeforeValidEvidence.rows[0]?.state, "funded");

  const appended = await appendTerminalRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch({ commits: underQuorumCommits, round: underQuorumRound }),
    ponderUrl: "https://ponder.example.test",
  });
  const replayedAppend = await appendTerminalRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch({ commits: underQuorumCommits, round: underQuorumRound }),
    ponderUrl: "https://ponder.example.test",
  });
  assert.equal(replayedAppend.eventId, appended.eventId);
  const closedBounty = await dbClient.execute({
    sql: `SELECT state, total_bonus_atomic, reservation_expires_at, completed_at
          FROM tokenless_surprise_bounty_rounds WHERE operation_key = ?`,
    args: [OPERATION],
  });
  assert.equal(closedBounty.rows[0]?.state, "insufficient_sample");
  assert.equal(String(closedBounty.rows[0]?.total_bonus_atomic), "0");
  assert.equal(closedBounty.rows[0]?.reservation_expires_at, null);
  assert.ok(closedBounty.rows[0]?.completed_at instanceof Date);

  canonicalFinalizedBlockHash = `0x${"bc".repeat(32)}`;
  await assert.rejects(
    () =>
      publishTerminalRoundResult({
        operationKey: OPERATION,
        appOrigin: "https://app.example.test",
        now: NOW,
      }),
    (error: unknown) =>
      error instanceof TokenlessServiceError && error.code === "indexed_evidence_pending" && error.retryable,
  );
  canonicalFinalizedBlockHash = FINALIZED_BLOCK_HASH;

  const endpoint = await createWorkspaceWebhook({
    accountAddress: OWNER,
    workspaceId: WORKSPACE,
    url: "https://hooks.example.test/terminal-result",
    eventTypes: ["result.ready"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  assert.equal(
    await subscribeAskWebhook({
      operationKey: OPERATION,
      workspaceId: WORKSPACE,
      registration: { url: endpoint.url, eventTypes: ["result.ready"] },
    }),
    true,
  );
  const [published, concurrentPublication] = await Promise.all([
    publishTerminalRoundResult({
      operationKey: OPERATION,
      appOrigin: "https://app.example.test",
      now: NOW,
    }),
    publishTerminalRoundResult({
      operationKey: OPERATION,
      appOrigin: "https://app.example.test",
      now: new Date(NOW.getTime() + 1_000),
    }),
  ]);
  assert.equal(concurrentPublication.publicationId, published.publicationId);
  assert.deepEqual(concurrentPublication.result, published.result);
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_asks
          SET verdict_status = 'pending', result_json = '{"wrong":true}'
          WHERE operation_key = ?`,
    args: [OPERATION],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_webhook_deliveries SET payload_json = '{"wrong":true}'
          WHERE publication_id = ?`,
    args: [published.publicationId],
  });
  const repairedPublication = await publishTerminalRoundResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: new Date(NOW.getTime() + 2_000),
  });
  const repairedProjection = await dbClient.execute({
    sql: `SELECT a.result_json, d.payload_json
          FROM tokenless_agent_asks a
          JOIN tokenless_result_publications p ON p.operation_key = a.operation_key
          JOIN tokenless_webhook_deliveries d ON d.publication_id = p.publication_id
          WHERE a.operation_key = ?`,
    args: [OPERATION],
  });
  assert.deepEqual(JSON.parse(String(repairedProjection.rows[0]?.result_json)), published.result);
  assert.equal(JSON.parse(String(repairedProjection.rows[0]?.payload_json)).occurredAt, NOW.toISOString());
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_asks
          SET verdict_status = 'pending', result_json = NULL
          WHERE operation_key = ?;
          DELETE FROM tokenless_webhook_deliveries WHERE publication_id = ?`,
    args: [OPERATION, published.publicationId],
  });
  const replayedPublication = await publishTerminalRoundResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: new Date(NOW.getTime() + 3_000),
  });
  assert.equal(published.result.verdictStatus, "under_quorum_compensated");
  assert.equal(published.result.audience.participantCount, 3);
  assert.equal(published.result.verdict, null);
  assert.equal(replayedPublication.publicationId, published.publicationId);
  assert.equal(replayedPublication.evidenceRoot, published.evidenceRoot);
  assert.equal(repairedPublication.publicationId, published.publicationId);
  const stored = await dbClient.execute({
    sql: `SELECT a.verdict_status, a.result_json, t.event_type
          FROM tokenless_agent_asks a
          JOIN tokenless_transparency_events t ON t.operation_key = a.operation_key
          WHERE a.operation_key = ?`,
    args: [OPERATION],
  });
  const deliveries = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_webhook_deliveries WHERE publication_id = ?",
    args: [published.publicationId],
  });
  assert.equal(stored.rows[0]?.verdict_status, "under_quorum_compensated");
  assert.equal(stored.rows[0]?.event_type, "round.terminal");
  assert.equal(JSON.parse(String(stored.rows[0]?.result_json)).terminal, true);
  assert.equal(Number(deliveries.rows[0]?.count), 1);
});

test("terminal results include only feedback bound to an indexed reveal commitment", async () => {
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_quotes SET response_json = ? WHERE quote_id = 'quote_transparency'`,
    args: [
      JSON.stringify({
        schemaVersion: "rateloop.tokenless.v2",
        audience: {
          admissionPolicyHash: POLICY_HASH,
          label: "RateLoop network",
          source: "rateloop_network",
        },
        responseWindowSeconds: 3_600,
        requestProfile: null,
        reviewEconomics: null,
      }),
    ],
  });
  const responses = [
    createPublicRaterResponse(
      { operationKey: OPERATION, roundId: "42", contentId: CONTENT_ID, rationale: { mode: "required" } },
      {
        category: "evidence",
        body: "This feedback is bound to the compensated reveal.",
        sourceUrl: "https://example.com/bound",
        nonce: `0x${"81".repeat(32)}`,
      },
    ),
    createPublicRaterResponse(
      { operationKey: OPERATION, roundId: "42", contentId: CONTENT_ID, rationale: { mode: "required" } },
      {
        category: "concern",
        body: "This feedback is not bound to the indexed reveal.",
        nonce: `0x${"82".repeat(32)}`,
      },
    ),
  ];
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    for (const [index, response] of responses.entries()) {
      await preparePublicRaterResponse(client, {
        voucherId: `voucher_${index}`,
        operationKey: OPERATION,
        questionId: "question_transparency",
        roundId: "42",
        contentId: CONTENT_ID,
        voteKey: VOTE_KEYS[index]!,
        reviewerSource: "rateloop_network",
        rationale: { mode: "required" },
        response,
        now: NOW,
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const storedResponses = await dbClient.execute({
    sql: `SELECT response_id FROM tokenless_public_rater_responses ORDER BY voucher_id`,
  });
  for (const row of storedResponses.rows) {
    await moderateTokenlessPublicRaterResponse({
      responseId: String(row.response_id),
      decision: "approved",
      reasonCode: "policy_pass",
      now: NOW,
    });
  }

  const terminalCommits = indexedCommits().map((commit, index) => ({
    ...commit,
    revealed: index < 3,
    scoringEligible: index < 2,
    responseHash: index === 0 ? responses[0]!.responseHash : commit.responseHash,
  }));
  const terminalRound = indexedRound({
    state: 7,
    revealCount: 2,
    compensatedRevealCount: 3,
    compensationPerRecipient: "4000000",
    totalCompensation: "12000000",
    funderRefund: "34875000",
    claimDeadline: "1784484000",
  });
  await assert.rejects(
    () =>
      appendTerminalRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({
          commits: terminalCommits,
          round: { ...terminalRound, finalizedAt: String(Math.floor(Date.now() / 1_000) + 301) },
        }),
        ponderUrl: "https://ponder.example.test",
      }),
    /Terminal timestamp is invalid/,
  );
  const beforeCanonicalVerification = await dbClient.execute({
    sql: `SELECT hash_verified_at FROM tokenless_public_rater_responses ORDER BY voucher_id`,
  });
  assert.ok(beforeCanonicalVerification.rows.every(row => row.hash_verified_at === null));
  await appendTerminalRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch({ commits: terminalCommits, round: terminalRound }),
    ponderUrl: "https://ponder.example.test",
  });

  const verification = await dbClient.execute({
    sql: `SELECT voucher_id, hash_verified_at FROM tokenless_public_rater_responses ORDER BY voucher_id`,
  });
  assert.ok(verification.rows[0]?.hash_verified_at instanceof Date);
  assert.equal(verification.rows[1]?.hash_verified_at, null);

  const published = await publishTerminalRoundResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: NOW,
  });
  assert.deepEqual(published.result.feedback, {
    items: [
      {
        category: "evidence",
        body: "This feedback is bound to the compensated reveal.",
        sourceUrl: "https://example.com/bound",
      },
    ],
    redactedCount: 0,
  });
});

test("evidence waits for the configured confirmation depth, then publishes idempotently", async () => {
  await seedFrozenIntegrityAssignments();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_surprise_bounty_rounds
          (bounty_round_id, operation_key, deployment_key, version, state, policy_json,
           guaranteed_base_per_report_atomic, maximum_bonus_per_report_atomic,
           reserved_report_capacity, maximum_liability_atomic, paid_bonus_atomic,
           reservation_expires_at, created_at, updated_at)
          VALUES ('sbr_finalized', ?, ?, 'v1', 'funded', '{}', 1000000, 125000,
                  10, 1250000, 0, NULL, ?, ?)`,
    args: [OPERATION, DEPLOYMENT, NOW, NOW],
  });
  finalityLatestBlock = FINALIZED_BLOCK + 62n;
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch(),
        ponderUrl: "https://ponder.example.test",
      }),
    error => error instanceof TokenlessServiceError && error.code === "indexed_evidence_pending" && error.retryable,
  );
  const beforeDepth = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_transparency_events WHERE operation_key = ?",
    args: [OPERATION],
  });
  assert.equal(Number(beforeDepth.rows[0]?.count), 0);

  finalityLatestBlock = FINALIZED_BLOCK + 63n;
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch({
          round: indexedRound({ finalizedAt: String(Math.floor(Date.now() / 1_000) + 301) }),
        }),
        ponderUrl: "https://ponder.example.test",
      }),
    /Finalization timestamp is invalid/,
  );
  const bountyBeforeValidEvidence = await dbClient.execute({
    sql: "SELECT state FROM tokenless_surprise_bounty_rounds WHERE operation_key = ?",
    args: [OPERATION],
  });
  assert.equal(bountyBeforeValidEvidence.rows[0]?.state, "funded");
  const appended = await appendFinalizedRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch(),
    ponderUrl: "https://ponder.example.test",
  });
  const appendReplay = await appendFinalizedRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch(),
    ponderUrl: "https://ponder.example.test",
  });
  assert.equal(appendReplay.eventId, appended.eventId);
  const storedEvidence = await dbClient.execute({
    sql: "SELECT evidence_json FROM tokenless_transparency_events WHERE operation_key = ? AND event_type = 'round.finalized'",
    args: [OPERATION],
  });
  const scoring = JSON.parse(String(storedEvidence.rows[0]?.evidence_json)).scoring as Record<string, unknown>;
  assert.equal(scoring.scoringBeaconRound, roundTerms.scoringBeaconRound);
  assert.equal("beaconRound" in scoring, false);
  const published = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: NOW,
  });
  const replay = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.match(appended.eventId, /^tpe_/);
  assert.match(published.publicationId ?? "", /^pub_/);
  assert.equal(published.result.methodologyUrl, "https://app.example.test/docs/evidence#commissioned-paid-panels");
  assert.equal(replay.publicationId, published.publicationId);
  const counts = await dbClient.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM tokenless_transparency_events WHERE operation_key = ?) AS evidence_count,
            (SELECT COUNT(*) FROM tokenless_result_publications WHERE operation_key = ?) AS publication_count,
            (SELECT COUNT(*) FROM tokenless_forecast_integrity_terminal_receipts
             WHERE lane = 'public_paid' AND terminal_key = ?) AS forecast_receipt_count,
            (SELECT MAX(aggregated_forecast_count) FROM tokenless_forecast_integrity_terminal_receipts
             WHERE lane = 'public_paid' AND terminal_key = ?) AS aggregated_forecast_count,
            (SELECT COUNT(*) FROM tokenless_paid_vouchers
             WHERE chain_id = 84532 AND LOWER(panel_address) = LOWER(?) AND round_id = 42) AS eligible_voucher_count,
            (SELECT COUNT(*) FROM tokenless_forecast_calibration_accumulators
             WHERE subject_space = 'network_rater') AS forecast_subject_count,
            (SELECT SUM(observation_count) FROM tokenless_forecast_calibration_accumulators
             WHERE subject_space = 'network_rater') AS forecast_observation_count`,
    args: [OPERATION, OPERATION, `${DEPLOYMENT}:42`, `${DEPLOYMENT}:42`, PANEL],
  });
  assert.equal(Number(counts.rows[0]?.evidence_count), 1);
  assert.equal(Number(counts.rows[0]?.publication_count), 1);
  assert.equal(Number(counts.rows[0]?.forecast_receipt_count), 1);
  assert.equal(Number(counts.rows[0]?.eligible_voucher_count), 5);
  assert.equal(Number(counts.rows[0]?.aggregated_forecast_count), 5);
  assert.equal(Number(counts.rows[0]?.forecast_subject_count), 5);
  assert.equal(Number(counts.rows[0]?.forecast_observation_count), 5);
});

test("publication fails closed on canonical block-hash drift and succeeds on an idempotent retry", async () => {
  await seedFrozenIntegrityAssignments();
  await appendFinalizedRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch(),
    ponderUrl: "https://ponder.example.test",
  });
  canonicalFinalizedBlockHash = `0x${"bc".repeat(32)}`;
  await assert.rejects(
    () =>
      reviewAndPublishResult({
        operationKey: OPERATION,
        appOrigin: "https://app.example.test",
        now: NOW,
      }),
    error => error instanceof TokenlessServiceError && error.code === "indexed_evidence_pending" && error.retryable,
  );
  const pending = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_result_publications WHERE operation_key = ?",
    args: [OPERATION],
  });
  assert.equal(Number(pending.rows[0]?.count), 0);

  canonicalFinalizedBlockHash = FINALIZED_BLOCK_HASH;
  const published = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: new Date(NOW.getTime() + 1_000),
  });
  const replay = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.equal(replay.publicationId, published.publicationId);
});

test("evidence persistence fails closed and remains retryable when the Base RPC is unavailable", async () => {
  finalityRpcFailure = true;
  await assert.rejects(
    () =>
      appendFinalizedRoundEvidence({
        operationKey: OPERATION,
        fetchImpl: ponderFetch(),
        ponderUrl: "https://ponder.example.test",
      }),
    error => error instanceof TokenlessServiceError && error.code === "indexed_evidence_pending" && error.retryable,
  );
  const persisted = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_transparency_events WHERE operation_key = ?",
    args: [OPERATION],
  });
  assert.equal(Number(persisted.rows[0]?.count), 0);
});

test("webhook registration rejects SSRF targets and returns its secret only once", async () => {
  assert.throws(() => validateWebhookUrl("https://127.0.0.1/hook"), /private or local/);
  assert.throws(() => validateWebhookUrl("http://hooks.example.test/hook"), /HTTPS/);
  const created = await createWorkspaceWebhook({
    accountAddress: OWNER,
    workspaceId: WORKSPACE,
    url: "https://hooks.example.test/result",
    eventTypes: ["result.ready"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  assert.match(created.signingSecret, /^rlwhsec_/);
  const listed = await listWorkspaceWebhooks({ accountAddress: OWNER, workspaceId: WORKSPACE });
  assert.equal(listed[0]?.endpointId, created.endpointId);
  assert.equal("signingSecret" in listed[0]!, false);
});

test("webhook URL classifier rejects every non-globally-routable address range", () => {
  const nonGlobal = [
    "https://0.0.0.0/hook",
    "https://10.1.2.3/hook",
    "https://100.64.0.1/hook", // carrier-grade NAT
    "https://127.0.0.1/hook",
    "https://169.254.10.10/hook", // link-local
    "https://172.16.5.5/hook",
    "https://192.0.0.8/hook", // IETF protocol assignments
    "https://192.0.2.5/hook", // TEST-NET-1
    "https://192.88.99.1/hook", // 6to4 relay anycast
    "https://192.168.1.1/hook",
    "https://198.18.0.1/hook", // benchmarking
    "https://198.51.100.7/hook", // TEST-NET-2
    "https://203.0.113.7/hook", // TEST-NET-3
    "https://[::1]/hook", // loopback
    "https://[::]/hook", // unspecified
    "https://[fc00::1]/hook", // unique local
    "https://[fd12:3456::1]/hook", // unique local
    "https://[fe80::1]/hook", // link-local
    "https://[ff02::1]/hook", // multicast
    "https://[2001:db8::1]/hook", // documentation
    "https://[3fff::1]/hook", // documentation (RFC 9637)
    "https://[64:ff9b::0a00:0001]/hook", // NAT64 embedding 10.0.0.1
    "https://[64:ff9b:1::a9fe:a9fe]/hook", // local-use NAT64 embedding 169.254.169.254
    "https://[64:ff9b:1::0808:0808]/hook", // local-use NAT64 is non-global regardless of embedded IPv4
    "https://[::ffff:192.168.0.1]/hook", // IPv4-mapped IPv6 private
    "https://[::ffff:127.0.0.1]/hook", // IPv4-mapped IPv6 loopback
  ];
  for (const url of nonGlobal) {
    assert.throws(() => validateWebhookUrl(url, false), /private or local host/, url);
  }
  const global = [
    "https://93.184.216.34/hook",
    "https://8.8.8.8/hook",
    "https://[2606:4700:4700::1111]/hook", // Cloudflare DNS
    "https://[::ffff:93.184.216.34]/hook", // IPv4-mapped public address
    "https://hooks.example.test/hook",
  ];
  for (const url of global) {
    assert.equal(validateWebhookUrl(url, false), new URL(url).toString(), url);
  }
});

test("resolved webhook destinations reject non-global addresses and pin the first resolved IP", async () => {
  await assert.rejects(
    assertPublicWebhookDestination("https://hooks.example.test/hook", async () => ["203.0.113.7"]),
    /private or local address/,
  );
  await assert.rejects(
    assertPublicWebhookDestination("https://hooks.example.test/hook", async () => ["93.184.216.34", "10.0.0.5"]),
    /private or local address/,
  );
  await assert.rejects(
    assertPublicWebhookDestination("https://hooks.example.test/hook", async () => []),
    /private or local address/,
  );
  assert.equal(
    await assertPublicWebhookDestination("https://hooks.example.test/hook", async () => ["93.184.216.34", "8.8.4.4"]),
    "93.184.216.34",
  );
});

test("webhook delivery pins the validated IP and ignores a rebinding second lookup", async () => {
  await seedFrozenIntegrityAssignments();
  const endpoint = await createWorkspaceWebhook({
    accountAddress: OWNER,
    workspaceId: WORKSPACE,
    url: "https://hooks.example.test/result",
    eventTypes: ["result.ready"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  await subscribeAskWebhook({
    operationKey: OPERATION,
    workspaceId: WORKSPACE,
    registration: { url: endpoint.url, eventTypes: ["result.ready"] },
  });
  await appendFinalizedRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch(),
    ponderUrl: "https://ponder.example.test",
  });
  await reviewAndPublishResult({ operationKey: OPERATION, appOrigin: "https://app.example.test", now: NOW });

  let resolverCalls = 0;
  const rebindingResolver = async () => {
    resolverCalls += 1;
    // A rebinding operator returns a public address during validation and a
    // network-local address on any subsequent lookup.
    return resolverCalls === 1 ? ["93.184.216.34"] : ["169.254.169.254"];
  };
  const pinnedAddresses: Array<string | undefined> = [];
  const fetchImpl = async (_url: string, init: RequestInit & { pinnedAddress?: string }) => {
    pinnedAddresses.push(init.pinnedAddress);
    return new Response(null, { status: 204 });
  };
  const outcomes = await deliverPendingWebhooks({
    fetchImpl,
    now: NOW,
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: rebindingResolver,
    operationKey: OPERATION,
  });
  assert.equal(outcomes[0]?.state, "delivered");
  // The hostname is resolved exactly once and its address is pinned for the
  // connection; the rebinding second lookup is never consulted.
  assert.equal(resolverCalls, 1);
  assert.deepEqual(pinnedAddresses, ["93.184.216.34"]);
});

async function seedPendingDelivery() {
  await seedFrozenIntegrityAssignments();
  const endpoint = await createWorkspaceWebhook({
    accountAddress: OWNER,
    workspaceId: WORKSPACE,
    url: "https://hooks.example.test/result",
    eventTypes: ["result.ready"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  await subscribeAskWebhook({
    operationKey: OPERATION,
    workspaceId: WORKSPACE,
    registration: { url: endpoint.url, eventTypes: ["result.ready"] },
  });
  await appendFinalizedRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch(),
    ponderUrl: "https://ponder.example.test",
  });
  await reviewAndPublishResult({ operationKey: OPERATION, appOrigin: "https://app.example.test", now: NOW });
  const pending = await dbClient.execute({
    sql: "SELECT delivery_id FROM tokenless_webhook_deliveries LIMIT 1",
    args: [],
  });
  return String((pending.rows[0] as Record<string, unknown>).delivery_id);
}

test("a webhook delivery stranded in 'delivering' past its lease is reclaimed and delivered", async () => {
  const deliveryId = await seedPendingDelivery();
  // Simulate a worker that claimed the row and then crashed before completing.
  await dbClient.execute({
    sql: `UPDATE tokenless_webhook_deliveries
          SET state = 'delivering', lease_generation = 1, lease_expires_at = ?
          WHERE delivery_id = ?`,
    args: [new Date(NOW.getTime() - 1_000), deliveryId],
  });
  const outcomes = await deliverPendingWebhooks({
    fetchImpl: async () => new Response(null, { status: 204 }),
    now: NOW,
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
    operationKey: OPERATION,
  });
  assert.deepEqual(outcomes, [{ deliveryId, state: "delivered" }]);
  const reclaimed = await dbClient.execute({
    sql: "SELECT state, lease_generation, lease_expires_at FROM tokenless_webhook_deliveries WHERE delivery_id = ?",
    args: [deliveryId],
  });
  const row = reclaimed.rows[0] as Record<string, unknown>;
  assert.equal(String(row.state), "delivered");
  // The reclaiming worker fenced its completion under a fresh generation.
  assert.equal(Number(row.lease_generation), 2);
  assert.equal(row.lease_expires_at, null);
});

test("webhook secret decryption failures release the claim into bounded retry", async () => {
  const deliveryId = await seedPendingDelivery();
  let fetchCalls = 0;
  const outcomes = await deliverPendingWebhooks({
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(null, { status: 204 });
    },
    now: NOW,
    encryptionKey: Buffer.alloc(32, 99).toString("base64url"),
    resolveHostname: resolvePublic,
    operationKey: OPERATION,
  });
  assert.deepEqual(outcomes, [{ deliveryId, state: "retry" }]);
  assert.equal(fetchCalls, 0);
  const retry = await dbClient.execute({
    sql: `SELECT state,attempt_count,lease_expires_at,next_attempt_at
          FROM tokenless_webhook_deliveries WHERE delivery_id=?`,
    args: [deliveryId],
  });
  assert.equal(retry.rows[0]?.state, "retry");
  assert.equal(Number(retry.rows[0]?.attempt_count), 1);
  assert.equal(retry.rows[0]?.lease_expires_at, null);
  assert.ok(retry.rows[0]?.next_attempt_at);
});

test("a stale worker's completion write is rejected once the lease is reclaimed", async () => {
  const deliveryId = await seedPendingDelivery();
  // While the original worker is mid-flight, another worker reclaims the lease
  // under a newer generation, exactly as it would after a lease expiry.
  const fetchImpl = async () => {
    await dbClient.execute({
      sql: `UPDATE tokenless_webhook_deliveries
            SET lease_generation = 2, lease_expires_at = ?
            WHERE delivery_id = ?`,
      args: [new Date(NOW.getTime() + 60_000), deliveryId],
    });
    return new Response(null, { status: 204 });
  };
  const outcomes = await deliverPendingWebhooks({
    fetchImpl,
    now: NOW,
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
    operationKey: OPERATION,
  });
  // The stale worker held generation 1; its delivered write is fenced out.
  assert.deepEqual(outcomes, []);
  const fenced = await dbClient.execute({
    sql: "SELECT state, lease_generation FROM tokenless_webhook_deliveries WHERE delivery_id = ?",
    args: [deliveryId],
  });
  const row = fenced.rows[0] as Record<string, unknown>;
  assert.equal(String(row.state), "delivering");
  assert.equal(Number(row.lease_generation), 2);
});

test("finalized evidence publishes once and webhook retries preserve idempotency and signatures", async () => {
  await seedFrozenIntegrityAssignments();
  const genericResponses = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_assurance_responses WHERE run_id = 'run_transparency'",
    args: [],
  });
  const assignmentStatuses = await dbClient.execute({
    sql: "SELECT status FROM tokenless_assurance_assignments WHERE run_id = 'run_transparency' ORDER BY status",
    args: [],
  });
  assert.equal(Number(genericResponses.rows[0]?.count), 0);
  assert.deepEqual(
    assignmentStatuses.rows.map(row => String(row.status)),
    ["expired", "expired", "reserved", "reserved", "reserved"],
  );
  const endpoint = await createWorkspaceWebhook({
    accountAddress: OWNER,
    workspaceId: WORKSPACE,
    url: "https://hooks.example.test/result",
    eventTypes: ["result.ready"],
    encryptionKey: ENCRYPTION_KEY,
    resolveHostname: resolvePublic,
  });
  assert.equal(
    await subscribeAskWebhook({
      operationKey: OPERATION,
      workspaceId: WORKSPACE,
      registration: { url: endpoint.url, eventTypes: ["result.ready"] },
    }),
    true,
  );
  const appended = await appendFinalizedRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch(),
    ponderUrl: "https://ponder.example.test",
  });
  assert.deepEqual(
    await appendFinalizedRoundEvidence({
      operationKey: OPERATION,
      fetchImpl: ponderFetch(),
      ponderUrl: "https://ponder.example.test",
    }),
    appended,
  );
  const published = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: NOW,
  });
  const replay = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: new Date(NOW.getTime() + 1_000),
  });
  assert.equal(replay.publicationId, published.publicationId);
  assert.equal(published.result.verdictStatus, "publishable");
  assert.equal(published.result.verdict?.preferenceShareBps, 8000);
  assert.deepEqual(published.result.verdict?.intervalBps, { lower: 3755, upper: 9638 });

  await dbClient.execute({
    sql: `UPDATE tokenless_agent_asks
          SET verdict_status = 'pending', result_json = NULL
          WHERE operation_key = ?`,
    args: [OPERATION],
  });
  await dbClient.execute({
    sql: "DELETE FROM tokenless_webhook_deliveries WHERE publication_id = ?",
    args: [published.publicationId],
  });
  const repaired = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: new Date(NOW.getTime() + 2_000),
  });
  assert.deepEqual(repaired.result, published.result);
  const repairedProjection = await dbClient.execute({
    sql: "SELECT result_json FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [OPERATION],
  });
  const repairedDeliveries = await dbClient.execute({
    sql: "SELECT COUNT(*) AS count FROM tokenless_webhook_deliveries WHERE publication_id = ?",
    args: [published.publicationId],
  });
  assert.deepEqual(JSON.parse(String(repairedProjection.rows[0]?.result_json)), published.result);
  assert.equal(Number(repairedDeliveries.rows[0]?.count), 1);

  let calls = 0;
  let deliveryId = "";
  const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    const headers = new Headers(init?.headers);
    deliveryId = headers.get("rateloop-delivery-id") ?? "";
    const body = String(init?.body);
    const timestamp = headers.get("rateloop-timestamp")!;
    const expected = `v1=${createHmac("sha256", endpoint.signingSecret).update(`${timestamp}.${body}`).digest("hex")}`;
    assert.equal(headers.get("rateloop-signature"), expected);
    return new Response(null, { status: calls === 1 ? 503 : 204 });
  };
  assert.equal(
    (
      await deliverPendingWebhooks({
        fetchImpl,
        now: NOW,
        encryptionKey: ENCRYPTION_KEY,
        resolveHostname: resolvePublic,
        operationKey: OPERATION,
      })
    )[0]?.state,
    "retry",
  );
  assert.equal(
    (
      await deliverPendingWebhooks({
        fetchImpl,
        now: new Date(NOW.getTime() + 30_000),
        encryptionKey: ENCRYPTION_KEY,
        resolveHostname: resolvePublic,
        operationKey: OPERATION,
      })
    )[0]?.state,
    "delivered",
  );
  assert.match(deliveryId, /^whd_/);

  const inspection = await inspectWorkspaceTransparency({
    accountAddress: OWNER,
    workspaceId: WORKSPACE,
    operationKey: OPERATION,
  });
  assert.equal(inspection.events.length, 1);
  const storedEvidence = inspection.events[0]?.evidence_json as Record<string, unknown>;
  assert.deepEqual(storedEvidence.analytics, {
    answerFingerprintRiskBps: 0,
    assignmentProvenanceGapBps: 0,
    issuedVoucherCount: 5,
    verifiedIdentityCount: 5,
  });
  assert.deepEqual(storedEvidence.provenance, {
    assignmentCount: 5,
    issuedVoucherCount: 5,
    matchedAssignmentCount: 5,
    validResponseCount: 5,
    verifiedIdentityCount: 5,
  });
  assert.equal((storedEvidence.roundTerms as Record<string, unknown>).commitDeadline, roundTerms.commitDeadline);
  assert.equal((storedEvidence.chain as Record<string, unknown>).transactionHash, `0x${"cd".repeat(32)}`);
  assert.equal(inspection.analyticsReviews[0]?.decision, "publishable");
  assert.equal(inspection.analyticsReviews[0]?.evaluation_schema_version, "rateloop.post-round-integrity.v1");
  assert.equal(inspection.analyticsReviews[0]?.payout_effect, "none");
  assert.equal(inspection.publications.length, 1);
  assert.equal(inspection.webhookDeliveries[0]?.state, "delivered");
});

test("post-round integrity can delist public interpretation without changing indexed settlement evidence", async () => {
  await seedFrozenIntegrityAssignments();
  await appendFinalizedRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch({ commits: indexedCommits(`0x${"fe".repeat(32)}`) }),
    ponderUrl: "https://ponder.example.test",
  });
  const published = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: NOW,
  });
  assert.equal(published.result.verdictStatus, "delisted");
  assert.equal(published.result.verdict, null);
  assert.deepEqual(published.reasonCodes, ["answer_fingerprint_concentration"]);
  const stored = await dbClient.execute({
    sql: "SELECT verdict_status, result_json FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [OPERATION],
  });
  assert.equal(stored.rows[0]?.verdict_status, "delisted");
  assert.equal(JSON.parse(String(stored.rows[0]?.result_json)).verdict, null);
});

test("pending integrity cannot mutate finalized accounting", async () => {
  await appendFinalizedRoundEvidence({
    operationKey: OPERATION,
    fetchImpl: ponderFetch(),
    ponderUrl: "https://ponder.example.test",
  });
  const before = await dbClient.execute({
    sql: "SELECT economics_json FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [OPERATION],
  });
  const pending = await reviewAndPublishResult({
    operationKey: OPERATION,
    appOrigin: "https://app.example.test",
    now: NOW,
  });
  assert.equal(pending.result.verdictStatus, "pending");
  assert.equal(pending.result.terminal, false);
  assert.equal(pending.publicationId, null);
  assert.equal(pending.evaluation.payoutEffect, "none");
  const after = await dbClient.execute({
    sql: "SELECT economics_json FROM tokenless_agent_asks WHERE operation_key = ?",
    args: [OPERATION],
  });
  assert.equal(String(after.rows[0]?.economics_json), String(before.rows[0]?.economics_json));
});
