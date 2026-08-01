import assert from "node:assert/strict";
import test from "node:test";
import {
  type NetworkBenchmarkEvidence,
  __networkBenchmarkActivationTestUtils,
  buildNetworkBenchmarkActivation,
  evaluateNetworkBenchmarkExecutionAuthorization,
} from "~~/lib/tokenless/networkBenchmarkActivation";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const boundary = {
  workspaceId: "workspace_network_benchmark",
  projectId: "project_network_benchmark",
  benchmarkId: "benchmark_public_safe_2026",
  activationReference: "network_activation_2026_01",
  evidenceWindowStart: "2026-07-01T00:00:00.000Z",
  evidenceWindowEnd: "2026-07-31T00:00:00.000Z",
  methodVersion: "paid_randomized_network_assignment_v1",
  deploymentKey: "tokenless-v4:84532:panel:issuer:adapter:bonus",
} as const;

function evidence(
  evidenceId: string,
  evidenceType: NetworkBenchmarkEvidence["evidenceType"],
  counterpartyCharacter: string,
  artifactCharacter: string,
): NetworkBenchmarkEvidence {
  return {
    ...boundary,
    evidenceId,
    evidenceType,
    counterpartyReferenceHash: digest(counterpartyCharacter),
    artifactDigest: digest(artifactCharacter),
    completedAt: "2026-07-30T12:00:00.000Z",
  };
}

const requiredEvidence: readonly NetworkBenchmarkEvidence[] = [
  evidence("audit_acceptance", "audit_partner_method_acceptance", "a", "1"),
  evidence("provider_pilot_one", "provider_pilot_acceptance", "b", "2"),
  evidence("provider_pilot_two", "provider_pilot_acceptance", "c", "3"),
  evidence("hosted_e2e", "hosted_end_to_end_exercise", "d", "4"),
  evidence("keeper_recovery", "keeper_recovery_exercise", "e", "5"),
  evidence("indexer_recovery", "indexer_recovery_exercise", "f", "6"),
  evidence("paid_readiness", "paid_eligibility_payout_tax_dac7_readiness", "0", "b"),
  evidence("sanctions_readiness", "sanctions_screening_readiness", "1", "c"),
  evidence("worker_contract_readiness", "reviewer_contract_worker_information_appeal_readiness", "2", "d"),
  evidence("worker_privacy_readiness", "worker_data_privacy_governance_readiness", "3", "e"),
];

const opportunities = [
  {
    opportunityId: "opportunity_network_one",
    requestProfileId: "profile_network",
    requestProfileVersion: 2,
    requestProfileHash: digest("7"),
    sourceEvidenceHash: digest("8"),
    suggestionCommitment: digest("9"),
  },
  {
    opportunityId: "opportunity_network_two",
    requestProfileId: "profile_network",
    requestProfileVersion: 2,
    requestProfileHash: digest("7"),
    sourceEvidenceHash: digest("0"),
    suggestionCommitment: digest("a"),
  },
] as const;

function build() {
  return buildNetworkBenchmarkActivation({
    ...boundary,
    activatedBy: "principal_network_manager",
    activatedAt: "2026-08-01T00:00:00.000Z",
    authorizationDurationSeconds: 7 * 24 * 60 * 60,
    evidence: requiredEvidence,
    opportunities,
  });
}

test("network benchmark activation is deterministic and binds all required typed evidence", () => {
  const first = build();
  const reordered = buildNetworkBenchmarkActivation({
    ...boundary,
    activatedBy: "principal_network_manager",
    activatedAt: "2026-08-01T00:00:00.000Z",
    authorizationDurationSeconds: 7 * 24 * 60 * 60,
    evidence: [...requiredEvidence].reverse(),
    opportunities: [...opportunities].reverse(),
  });
  assert.equal(first.activationHash, reordered.activationHash);
  assert.equal(first.evidenceManifestRoot, reordered.evidenceManifestRoot);
  assert.equal(first.opportunityManifestRoot, reordered.opportunityManifestRoot);
  assert.equal(first.expectedEvidenceCount, 10);
  assert.equal(first.expectedOpportunityCount, 2);
  assert.deepEqual(
    first.evidence.map(item => [item.evidenceType, item.evidenceOutcome]),
    [
      ["audit_partner_method_acceptance", "accepted"],
      ["hosted_end_to_end_exercise", "passed"],
      ["indexer_recovery_exercise", "passed"],
      ["keeper_recovery_exercise", "passed"],
      ["paid_eligibility_payout_tax_dac7_readiness", "documented_ready"],
      ["provider_pilot_acceptance", "accepted"],
      ["provider_pilot_acceptance", "accepted"],
      ["reviewer_contract_worker_information_appeal_readiness", "documented_ready"],
      ["sanctions_screening_readiness", "documented_ready"],
      ["worker_data_privacy_governance_readiness", "documented_ready"],
    ],
  );
});

test("manifest order is locale-independent at ASCII case and punctuation boundaries", () => {
  const compare = __networkBenchmarkActivationTestUtils.codeUnitCompare;
  assert.deepEqual(["a", "Z", "_", "-", "A"].sort(compare), ["-", "A", "Z", "_", "a"]);
  assert.equal(compare("opportunity_A", "opportunity_a"), -1);
});

test("activation rejects incomplete, duplicate-provider, cross-benchmark, and cross-deployment evidence", () => {
  const base = {
    ...boundary,
    activatedBy: "principal_network_manager",
    activatedAt: "2026-08-01T00:00:00.000Z",
    authorizationDurationSeconds: 86_400,
    opportunities,
  };
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: requiredEvidence.slice(0, -1) }),
    /every paid-work legal-readiness evidence type/u,
  );
  const sameProvider = requiredEvidence.map(item =>
    item.evidenceId === "provider_pilot_two" ? { ...item, counterpartyReferenceHash: digest("b") } : item,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: sameProvider }),
    /two distinct accepted provider pilots/u,
  );
  const crossBenchmark = requiredEvidence.map((item, index) =>
    index === 0 ? { ...item, benchmarkId: "benchmark_unrelated" } : item,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: crossBenchmark }),
    /exact benchmark boundary/u,
  );
  const crossDeployment = requiredEvidence.map((item, index) =>
    index === 0 ? { ...item, deploymentKey: "tokenless-v4:84532:other" } : item,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: crossDeployment }),
    /exact benchmark boundary/u,
  );
});

test("execution fails closed across benchmark, deployment, unrelated opportunities, expiry, and deactivation", () => {
  const activation = build();
  const exact = {
    activation,
    workspaceId: boundary.workspaceId,
    projectId: boundary.projectId,
    benchmarkId: boundary.benchmarkId,
    methodVersion: boundary.methodVersion,
    deploymentKey: boundary.deploymentKey,
    opportunityId: opportunities[0].opportunityId,
    now: "2026-08-02T00:00:00.000Z",
    deactivated: false,
  };
  assert.deepEqual(evaluateNetworkBenchmarkExecutionAuthorization(exact), {
    allowed: true,
    reason: "authorized",
  });
  assert.equal(
    evaluateNetworkBenchmarkExecutionAuthorization({ ...exact, benchmarkId: "benchmark_other" }).reason,
    "scope_mismatch",
  );
  assert.equal(
    evaluateNetworkBenchmarkExecutionAuthorization({ ...exact, deploymentKey: "tokenless-v4:84532:other" }).reason,
    "scope_mismatch",
  );
  assert.equal(
    evaluateNetworkBenchmarkExecutionAuthorization({ ...exact, opportunityId: "opportunity_not_authorized" }).reason,
    "opportunity_not_authorized",
  );
  assert.equal(
    evaluateNetworkBenchmarkExecutionAuthorization({ ...exact, now: activation.authorizationExpiresAt }).reason,
    "expired",
  );
  assert.equal(evaluateNetworkBenchmarkExecutionAuthorization({ ...exact, deactivated: true }).reason, "deactivated");
});

test("activation is execution-only and conveys no authority over unrelated opportunities or methods", () => {
  const activation = build();
  assert.equal(activation.activationScope, "exact_public_safe_benchmark_network_execution");
  assert.equal(activation.unrelatedOpportunityAuthority, "none");
  assert.equal(activation.publicSafeOnly, true);
  assert.equal(
    evaluateNetworkBenchmarkExecutionAuthorization({
      activation,
      workspaceId: boundary.workspaceId,
      projectId: boundary.projectId,
      benchmarkId: boundary.benchmarkId,
      methodVersion: "surprisingly_popular_v1",
      deploymentKey: boundary.deploymentKey,
      opportunityId: opportunities[0].opportunityId,
      now: "2026-08-02T00:00:00.000Z",
      deactivated: false,
    }).allowed,
    false,
  );
});
