import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  type NetworkBenchmarkEvidence,
  __networkBenchmarkActivationTestUtils,
  buildNetworkBenchmarkActivation,
  createNetworkBenchmarkActivationService,
  evaluateNetworkBenchmarkExecutionAuthorization,
  requireActiveNetworkBenchmarkAssignmentAcceptance,
} from "~~/lib/tokenless/networkBenchmarkActivation";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const ACTIVE_DEPLOYMENT_KEY =
  "tokenless-v4:84532:0x1111111111111111111111111111111111111111:0x2222222222222222222222222222222222222222:0x3333333333333333333333333333333333333333:0x4444444444444444444444444444444444444444";
const OTHER_DEPLOYMENT_KEY =
  "tokenless-v4:84532:0x1111111111111111111111111111111111111111:0x2222222222222222222222222222222222222222:0x3333333333333333333333333333333333333333:0x5555555555555555555555555555555555555555";
const boundary = {
  workspaceId: "workspace_network_benchmark",
  projectId: "project_network_benchmark",
  benchmarkId: "benchmark_public_safe_2026",
  activationReference: "network_activation_2026_01",
  evidenceWindowStart: "2026-07-01T00:00:00.000Z",
  evidenceWindowEnd: "2026-07-31T00:00:00.000Z",
  methodVersion: "paid_randomized_network_assignment_v1",
  deploymentKey: ACTIVE_DEPLOYMENT_KEY,
  activationScope: "testnet_network_benchmark_exercise",
  permittedWorkerJurisdictions: ["DE", "FR"],
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
  evidence("network_demand_one", "network_supply_demand_confirmation", "b", "f"),
  evidence("network_demand_two", "network_supply_demand_confirmation", "c", "a"),
  evidence("hosted_paid_core", "hosted_paid_core_testnet_exercise", "d", "4"),
  evidence("keeper_recovery", "keeper_recovery_exercise", "e", "5"),
  evidence("indexer_recovery", "indexer_recovery_exercise", "f", "6"),
  evidence("paid_readiness", "paid_eligibility_payout_tax_dac7_readiness", "0", "b"),
  evidence("sanctions_readiness", "sanctions_screening_readiness", "1", "c"),
  evidence("worker_contract_readiness", "reviewer_contract_worker_information_appeal_readiness", "2", "d"),
  evidence("algorithmic_human_review", "algorithmic_management_human_review_readiness", "4", "f"),
  evidence("private_worker_channel", "private_worker_communication_readiness", "5", "0"),
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
    workspaceManagerReferencePrincipalId: "principal_network_manager",
    complianceOperatorKeyVersion: "compliance-v7",
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
    workspaceManagerReferencePrincipalId: "principal_network_manager",
    complianceOperatorKeyVersion: "compliance-v7",
    activatedAt: "2026-08-01T00:00:00.000Z",
    authorizationDurationSeconds: 7 * 24 * 60 * 60,
    evidence: [...requiredEvidence].reverse(),
    opportunities: [...opportunities].reverse(),
  });
  assert.equal(first.activationHash, reordered.activationHash);
  assert.equal(first.evidenceManifestRoot, reordered.evidenceManifestRoot);
  assert.equal(first.opportunityManifestRoot, reordered.opportunityManifestRoot);
  assert.equal(first.expectedEvidenceCount, 14);
  assert.equal(first.expectedOpportunityCount, 2);
  assert.equal(first.schemaVersion, "rateloop.network-benchmark-activation.v2");
  assert.equal(first.attestedBy, "tokenless_compliance_operator:compliance-v7");
  assert.equal(first.workspaceManagerReferencePrincipalId, "principal_network_manager");
  assert.equal(first.activationScope, "testnet_network_benchmark_exercise");
  assert.deepEqual(first.permittedWorkerJurisdictions, ["DE", "FR"]);
  assert.match(first.permittedWorkerJurisdictionsHash, /^sha256:[0-9a-f]{64}$/u);
  assert.ok(
    first.evidence.every(item => item.permittedWorkerJurisdictionsHash === first.permittedWorkerJurisdictionsHash),
  );
  assert.ok(
    first.opportunities.every(item => item.permittedWorkerJurisdictionsHash === first.permittedWorkerJurisdictionsHash),
  );
  assert.ok(first.evidence.every(item => item.schemaVersion === "rateloop.network-benchmark-activation-evidence.v2"));
  assert.ok(
    first.opportunities.every(item => item.schemaVersion === "rateloop.network-benchmark-opportunity-authorization.v2"),
  );
  assert.deepEqual(
    first.evidence.map(item => [item.evidenceType, item.evidenceOutcome]),
    [
      ["algorithmic_management_human_review_readiness", "documented_ready"],
      ["audit_partner_method_acceptance", "accepted"],
      ["hosted_paid_core_testnet_exercise", "passed"],
      ["indexer_recovery_exercise", "passed"],
      ["keeper_recovery_exercise", "passed"],
      ["network_supply_demand_confirmation", "accepted"],
      ["network_supply_demand_confirmation", "accepted"],
      ["paid_eligibility_payout_tax_dac7_readiness", "documented_ready"],
      ["private_worker_communication_readiness", "documented_ready"],
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
    workspaceManagerReferencePrincipalId: "principal_network_manager",
    complianceOperatorKeyVersion: "compliance-v7",
    activatedAt: "2026-08-01T00:00:00.000Z",
    authorizationDurationSeconds: 86_400,
    opportunities,
  };
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: requiredEvidence.slice(0, -1) }),
    /every other paid-work legal-readiness evidence type/u,
  );
  const providerAsAuditor = requiredEvidence.map(item =>
    item.evidenceId === "audit_acceptance" ? { ...item, counterpartyReferenceHash: digest("b") } : item,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: providerAsAuditor }),
    /one distinct method-review counterparty/u,
  );
  const sameProvider = requiredEvidence.map(item =>
    item.evidenceId === "provider_pilot_two" ? { ...item, counterpartyReferenceHash: digest("b") } : item,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: sameProvider }),
    /two distinct accepted provider pilots/u,
  );
  const sameDemandCounterparty = requiredEvidence.map(item =>
    item.evidenceId === "network_demand_two" ? { ...item, counterpartyReferenceHash: digest("b") } : item,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: sameDemandCounterparty }),
    /network-supply demand confirmation from two of those providers/u,
  );
  const unmatchedDemandCounterparty = requiredEvidence.map(item =>
    item.evidenceId === "network_demand_two" ? { ...item, counterpartyReferenceHash: digest("4") } : item,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: unmatchedDemandCounterparty }),
    /network-supply demand confirmation from two of those providers/u,
  );
  const crossBenchmark = requiredEvidence.map((item, index) =>
    index === 0 ? { ...item, benchmarkId: "benchmark_unrelated" } : item,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: crossBenchmark }),
    /exact benchmark boundary/u,
  );
  const crossDeployment = requiredEvidence.map((item, index) =>
    index === 0 ? { ...item, deploymentKey: OTHER_DEPLOYMENT_KEY } : item,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: crossDeployment }),
    /exact benchmark boundary/u,
  );
  const unsupported = [
    ...requiredEvidence,
    { ...requiredEvidence[0]!, evidenceId: "unsupported", evidenceType: "open_marketplace_launch" },
  ] as unknown as NetworkBenchmarkEvidence[];
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, evidence: unsupported }),
    /evidence type is unsupported/u,
  );
});

test("activation requires a closed evidence window and evidence completed inside it", () => {
  const base = {
    ...boundary,
    workspaceManagerReferencePrincipalId: "principal_network_manager",
    complianceOperatorKeyVersion: "compliance-v7",
    activatedAt: "2026-08-01T00:00:00.000Z",
    authorizationDurationSeconds: 86_400,
    evidence: requiredEvidence,
    opportunities,
  };
  assert.throws(
    () =>
      buildNetworkBenchmarkActivation({
        ...base,
        evidenceWindowEnd: "2026-08-02T00:00:00.000Z",
        evidence: requiredEvidence.map(item => ({ ...item, evidenceWindowEnd: "2026-08-02T00:00:00.000Z" })),
      }),
    /evidence window must be closed/u,
  );
  assert.throws(
    () =>
      buildNetworkBenchmarkActivation({
        ...base,
        evidence: requiredEvidence.map((item, index) =>
          index === 0 ? { ...item, completedAt: "2026-06-30T23:59:59.999Z" } : item,
        ),
      }),
    /complete inside the closed evidence window/u,
  );
  assert.throws(
    () =>
      buildNetworkBenchmarkActivation({
        ...base,
        evidence: requiredEvidence.map((item, index) =>
          index === 0 ? { ...item, completedAt: "2026-07-31T00:00:00.001Z" } : item,
        ),
      }),
    /complete inside the closed evidence window/u,
  );
});

test("activation is restricted to the Base Sepolia exercise and a sorted supported jurisdiction set", () => {
  const base = {
    ...boundary,
    workspaceManagerReferencePrincipalId: "principal_network_manager",
    complianceOperatorKeyVersion: "compliance-v7",
    activatedAt: "2026-08-01T00:00:00.000Z",
    authorizationDurationSeconds: 86_400,
    evidence: requiredEvidence,
    opportunities,
  };
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, activationScope: "live_marketplace_release" as never }),
    /restricted to the testnet network benchmark exercise/u,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, deploymentKey: "tokenless-v4:8453:deployment" }),
    /Base Sepolia key/u,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, permittedWorkerJurisdictions: ["FR", "DE"] }),
    /bytewise-sorted/u,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, permittedWorkerJurisdictions: ["DE", "DE"] }),
    /unique/u,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, permittedWorkerJurisdictions: ["US"] }),
    /supported ISO alpha-2/u,
  );
  assert.throws(
    () => buildNetworkBenchmarkActivation({ ...base, permittedWorkerJurisdictions: [] }),
    /At least one supported worker jurisdiction/u,
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
    residenceCountry: "DE",
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
    evaluateNetworkBenchmarkExecutionAuthorization({ ...exact, deploymentKey: OTHER_DEPLOYMENT_KEY }).reason,
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
  assert.equal(
    evaluateNetworkBenchmarkExecutionAuthorization({ ...exact, residenceCountry: "AT" }).reason,
    "worker_jurisdiction_not_permitted",
  );
});

test("activation is execution-only and conveys no authority over unrelated opportunities or methods", () => {
  const activation = build();
  assert.equal(activation.activationScope, "testnet_network_benchmark_exercise");
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
      residenceCountry: "DE",
      now: "2026-08-02T00:00:00.000Z",
      deactivated: false,
    }).allowed,
    false,
  );
});

test("assignment acceptance delegates to the exact active activation and hides database details on denial", async () => {
  const calls: { sql: string; args: unknown[] | undefined }[] = [];
  const client = {
    async query(sql: string, args?: unknown[]) {
      calls.push({ sql, args });
      return { rows: [{ activation_reference: boundary.activationReference }], rowCount: 1 };
    },
  } as Pick<PoolClient, "query">;
  assert.equal(
    await requireActiveNetworkBenchmarkAssignmentAcceptance(client, {
      workspaceId: boundary.workspaceId,
      projectId: boundary.projectId,
      runId: "run_network_one",
      residenceCountry: "DE",
    }),
    boundary.activationReference,
  );
  assert.match(calls[0]!.sql, /tokenless_require_network_benchmark_assignment_acceptance/u);
  assert.deepEqual(calls[0]!.args, [boundary.workspaceId, boundary.projectId, "run_network_one", "DE"]);

  const deniedClient = {
    async query() {
      throw new Error("database detail must not escape");
    },
  } as unknown as Pick<PoolClient, "query">;
  await assert.rejects(
    requireActiveNetworkBenchmarkAssignmentAcceptance(deniedClient, {
      workspaceId: boundary.workspaceId,
      projectId: boundary.projectId,
      runId: "run_network_one",
      residenceCountry: "AT",
    }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "network_benchmark_assignment_acceptance_blocked");
      assert.doesNotMatch((error as Error).message, /database detail/u);
      return true;
    },
  );
});

test("activation audit attributes the operator and labels the manager as a non-participating reference", () => {
  const activation = build();
  const occurredAt = new Date("2026-08-01T00:00:00.000Z");
  const audit = __networkBenchmarkActivationTestUtils.activationAuditInput({
    activation,
    workspaceManagerReferencePrincipalId: "principal_network_manager",
    operatorKeyVersion: "compliance-v7",
    occurredAt,
  });
  assert.equal(audit.actorKind, "operator");
  assert.equal(audit.actorReference, "tokenless_compliance_operator:compliance-v7");
  assert.equal(audit.assuranceMethod, "dedicated_compliance_operator_bearer");
  assert.equal(audit.targetId, boundary.activationReference);
  assert.equal(audit.occurredAt, occurredAt);
  assert.deepEqual(audit.metadata, {
    activationHash: activation.activationHash,
    authorityKind: "compliance_operator_shared_secret",
    evidenceManifestRoot: activation.evidenceManifestRoot,
    workspaceManagerReferencePrincipalId: "principal_network_manager",
    opportunityManifestRoot: activation.opportunityManifestRoot,
    operatorKeyVersion: "compliance-v7",
    activationScope: "testnet_network_benchmark_exercise",
    permittedWorkerJurisdictionsHash: activation.permittedWorkerJurisdictionsHash,
  });
});

test("deactivation audit preserves operator, manager, reason, and supersession separately", () => {
  const occurredAt = new Date("2026-08-04T00:00:00.000Z");
  const audit = __networkBenchmarkActivationTestUtils.deactivationAuditInput({
    workspaceId: boundary.workspaceId,
    activationReference: boundary.activationReference,
    activationHash: digest("a"),
    deactivationHash: digest("b"),
    workspaceManagerReferencePrincipalId: "principal_network_manager",
    operatorKeyVersion: "compliance-v8",
    occurredAt,
    reason: "superseded",
    supersededByActivationReference: "network_activation_2026_02",
  });
  assert.equal(audit.actorReference, "tokenless_compliance_operator:compliance-v8");
  assert.equal(audit.reason, "superseded");
  assert.equal(audit.idempotencyKey, `network-benchmark-deactivation:${"b".repeat(64)}`);
  assert.deepEqual(audit.metadata, {
    activationHash: digest("a"),
    authorityKind: "compliance_operator_shared_secret",
    deactivationHash: digest("b"),
    workspaceManagerReferencePrincipalId: "principal_network_manager",
    operatorKeyVersion: "compliance-v8",
    supersededByActivationReference: "network_activation_2026_02",
  });
});

test("activation service rejects malformed and stale deployment keys before opening a transaction", async () => {
  let connections = 0;
  const service = createNetworkBenchmarkActivationService({
    activeDeploymentKey: ACTIVE_DEPLOYMENT_KEY,
    pool: {
      async connect() {
        connections += 1;
        throw new Error("database must not be reached");
      },
    } as unknown as Pick<Pool, "connect">,
    async appendAudit() {
      assert.fail("a rejected deployment key must not be audited as activated");
    },
  });
  const input = {
    ...boundary,
    workspaceManagerReferencePrincipalId: "principal_network_manager",
    complianceOperatorKeyVersion: "compliance-v9",
    authorizationDurationSeconds: 86_400,
    evidence: requiredEvidence,
    opportunityIds: [opportunities[0]!.opportunityId],
  };

  await assert.rejects(
    service.activate({ ...input, deploymentKey: "tokenless-v4:84532:any-text" }),
    /complete tokenless-v4 Base Sepolia key/u,
  );
  await assert.rejects(
    service.activate({ ...input, deploymentKey: OTHER_DEPLOYMENT_KEY }),
    /must match the active tokenless deployment/u,
  );
  assert.equal(connections, 0);
});

test("activation service verifies a manager reference but canonically attributes the operator", async () => {
  const statements: string[] = [];
  const audits: Record<string, unknown>[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("FROM tokenless_workspaces")) {
        return {
          rows: [
            {
              workspace_status: "active",
              project_status: "active",
              project_visibility: "public",
              project_data_classification: "public",
              project_material_kind: "synthetic",
              role: "owner",
              principal_status: "active",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("transaction_timestamp()")) {
        return { rows: [{ transaction_time: new Date("2026-08-01T00:00:00.000Z") }], rowCount: 1 };
      }
      if (sql.includes("FROM tokenless_agent_review_opportunities")) {
        return {
          rows: [
            {
              opportunity_id: opportunities[0]!.opportunityId,
              request_profile_id: opportunities[0]!.requestProfileId,
              request_profile_version: opportunities[0]!.requestProfileVersion,
              request_profile_hash: opportunities[0]!.requestProfileHash,
              source_evidence_hash: opportunities[0]!.sourceEvidenceHash,
              suggestion_commitment: opportunities[0]!.suggestionCommitment,
              status: "decided",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  } as unknown as PoolClient;
  const service = createNetworkBenchmarkActivationService({
    activeDeploymentKey: ACTIVE_DEPLOYMENT_KEY,
    pool: { connect: async () => client } as unknown as Pick<Pool, "connect">,
    async appendAudit(input) {
      audits.push(input as unknown as Record<string, unknown>);
      return {} as never;
    },
  });
  const activation = await service.activate({
    ...boundary,
    workspaceManagerReferencePrincipalId: "principal_network_manager",
    complianceOperatorKeyVersion: "compliance-v9",
    authorizationDurationSeconds: 86_400,
    evidence: requiredEvidence,
    opportunityIds: [opportunities[0]!.opportunityId],
  });
  assert.equal(activation.schemaVersion, "rateloop.network-benchmark-activation.v2");
  assert.equal(activation.attestedBy, "tokenless_compliance_operator:compliance-v9");
  assert.equal(activation.workspaceManagerReferencePrincipalId, "principal_network_manager");
  assert.ok(statements.some(sql => sql.includes("FROM tokenless_workspaces")));
  assert.ok(
    statements.some(
      sql =>
        sql.includes("JOIN tokenless_agent_review_request_profiles") &&
        sql.includes("profile.audience='public_network'") &&
        sql.includes("profile.content_boundary='public_or_test'") &&
        sql.includes("profile.compensation_mode='usdc'") &&
        sql.includes("profile.configuration_status='ready'") &&
        sql.includes("profile.superseded_at IS NULL"),
    ),
  );
  assert.ok(statements.some(sql => sql.includes("compliance_operator_key_version")));
  assert.equal(audits[0]?.actorReference, "tokenless_compliance_operator:compliance-v9");
});

test("activation service rejects an opportunity when its frozen request profile is not public-network ready", async () => {
  const client = {
    async query(sql: string) {
      if (sql.includes("FROM tokenless_workspaces")) {
        return {
          rows: [
            {
              workspace_status: "active",
              project_status: "active",
              project_visibility: "public",
              project_data_classification: "public",
              project_material_kind: "synthetic",
              role: "owner",
              principal_status: "active",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("transaction_timestamp()")) {
        return { rows: [{ transaction_time: new Date("2026-08-01T00:00:00.000Z") }], rowCount: 1 };
      }
      if (sql.includes("FROM tokenless_agent_review_opportunities")) {
        assert.ok(sql.includes("profile.audience='public_network'"));
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  } as unknown as PoolClient;
  const service = createNetworkBenchmarkActivationService({
    activeDeploymentKey: ACTIVE_DEPLOYMENT_KEY,
    pool: { connect: async () => client } as unknown as Pick<Pool, "connect">,
    async appendAudit() {
      assert.fail("an unavailable request profile must not be audited as activated");
    },
  });
  await assert.rejects(
    service.activate({
      ...boundary,
      workspaceManagerReferencePrincipalId: "principal_network_manager",
      complianceOperatorKeyVersion: "compliance-v9",
      authorizationDurationSeconds: 86_400,
      evidence: requiredEvidence,
      opportunityIds: [opportunities[0]!.opportunityId],
    }),
    /network benchmark opportunities are unavailable/u,
  );
});

test("activation service rejects a private project before reading its opportunities", async () => {
  let opportunityRead = false;
  const client = {
    async query(sql: string) {
      if (sql.includes("FROM tokenless_workspaces")) {
        return {
          rows: [
            {
              workspace_status: "active",
              project_status: "active",
              project_visibility: "private",
              project_data_classification: "internal",
              project_material_kind: null,
              role: "owner",
              principal_status: "active",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM tokenless_agent_review_opportunities")) opportunityRead = true;
      return { rows: [], rowCount: 1 };
    },
    release() {},
  } as unknown as PoolClient;
  const service = createNetworkBenchmarkActivationService({
    activeDeploymentKey: ACTIVE_DEPLOYMENT_KEY,
    pool: { connect: async () => client } as unknown as Pick<Pool, "connect">,
    async appendAudit() {
      assert.fail("a private project must not be audited as activated");
    },
  });
  await assert.rejects(
    service.activate({
      ...boundary,
      workspaceManagerReferencePrincipalId: "principal_network_manager",
      complianceOperatorKeyVersion: "compliance-v9",
      authorizationDurationSeconds: 86_400,
      evidence: requiredEvidence,
      opportunityIds: [opportunities[0]!.opportunityId],
    }),
    /Network benchmark project not found/u,
  );
  assert.equal(opportunityRead, false);
});

test("emergency deactivation does not depend on the manager remaining active", async () => {
  const statements: string[] = [];
  const audits: Record<string, unknown>[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes("FROM tokenless_network_benchmark_activations")) {
        return {
          rows: [
            {
              workspace_id: boundary.workspaceId,
              project_id: boundary.projectId,
              benchmark_id: boundary.benchmarkId,
              activation_reference: boundary.activationReference,
              activation_hash: digest("a"),
              evidence_window_start: boundary.evidenceWindowStart,
              evidence_window_end: boundary.evidenceWindowEnd,
              method_version: boundary.methodVersion,
              deployment_key: boundary.deploymentKey,
              workspace_manager_reference_principal_id: "principal_removed_manager",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("transaction_timestamp()")) {
        return { rows: [{ transaction_time: new Date("2026-08-04T00:00:00.000Z") }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  } as unknown as PoolClient;
  const service = createNetworkBenchmarkActivationService({
    activeDeploymentKey: ACTIVE_DEPLOYMENT_KEY,
    pool: { connect: async () => client } as unknown as Pick<Pool, "connect">,
    async appendAudit(input) {
      audits.push(input as unknown as Record<string, unknown>);
      return {} as never;
    },
  });
  const deactivation = await service.deactivate({
    complianceOperatorKeyVersion: "compliance-v10",
    workspaceId: boundary.workspaceId,
    projectId: boundary.projectId,
    activationReference: boundary.activationReference,
    reason: "release_gate_failure",
  });
  assert.equal(deactivation.schemaVersion, "rateloop.network-benchmark-activation-deactivation.v2");
  assert.equal(deactivation.attestedBy, "tokenless_compliance_operator:compliance-v10");
  assert.equal(deactivation.workspaceManagerReferencePrincipalId, "principal_removed_manager");
  assert.ok(!statements.some(sql => sql.includes("FROM tokenless_workspaces")));
  assert.equal(audits[0]?.actorReference, "tokenless_compliance_operator:compliance-v10");
  assert.deepEqual(
    (audits[0]?.metadata as Record<string, unknown>).workspaceManagerReferencePrincipalId,
    "principal_removed_manager",
  );
});
