import { NextRequest } from "next/server";
import { POST, createNetworkBenchmarkActivationPost } from "./route";
import assert from "node:assert/strict";
import test from "node:test";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const URL = "https://tokenless.example.test/api/internal/compliance/network-benchmark/activation";
const ACTIVE_DEPLOYMENT_KEY =
  "tokenless-v4:84532:0x1111111111111111111111111111111111111111:0x2222222222222222222222222222222222222222:0x3333333333333333333333333333333333333333:0x4444444444444444444444444444444444444444";

function activationBody() {
  const evidenceTypes = [
    "audit_partner_method_acceptance",
    "provider_pilot_acceptance",
    "network_supply_demand_confirmation",
    "hosted_paid_core_testnet_exercise",
    "keeper_recovery_exercise",
    "indexer_recovery_exercise",
    "paid_eligibility_payout_tax_dac7_readiness",
    "sanctions_screening_readiness",
    "reviewer_contract_worker_information_appeal_readiness",
    "algorithmic_management_human_review_readiness",
    "private_worker_communication_readiness",
    "worker_data_privacy_governance_readiness",
  ];
  const evidence = evidenceTypes.map((evidenceType, index) => ({
    workspaceId: "workspace_benchmark",
    projectId: "project_benchmark",
    benchmarkId: "benchmark_closed_pool",
    evidenceWindowStart: "2026-07-01T00:00:00.000Z",
    evidenceWindowEnd: "2026-07-31T00:00:00.000Z",
    methodVersion: "method_v1",
    deploymentKey: ACTIVE_DEPLOYMENT_KEY,
    evidenceId: `evidence_${index}`,
    evidenceType,
    counterpartyReferenceHash: `sha256:${"b".repeat(64)}`,
    artifactDigest: `sha256:${"c".repeat(64)}`,
    completedAt: "2026-07-30T00:00:00.000Z",
  }));
  evidence[0] = { ...evidence[0]!, counterpartyReferenceHash: `sha256:${"a".repeat(64)}` };
  evidence[1] = { ...evidence[1]!, counterpartyReferenceHash: `sha256:${"b".repeat(64)}` };
  evidence[2] = { ...evidence[2]!, counterpartyReferenceHash: `sha256:${"b".repeat(64)}` };
  evidence.push({
    ...evidence[1]!,
    evidenceId: "evidence_provider_2",
    counterpartyReferenceHash: `sha256:${"c".repeat(64)}`,
  });
  evidence.push({
    ...evidence[2]!,
    evidenceId: "evidence_demand_2",
    counterpartyReferenceHash: `sha256:${"c".repeat(64)}`,
  });
  return {
    action: "activate",
    workspaceManagerReferencePrincipalId: "rlp_manager_0001",
    workspaceId: "workspace_benchmark",
    projectId: "project_benchmark",
    benchmarkId: "benchmark_closed_pool",
    activationReference: "activation_v1",
    evidenceWindowStart: "2026-07-01T00:00:00.000Z",
    evidenceWindowEnd: "2026-07-31T00:00:00.000Z",
    methodVersion: "method_v1",
    deploymentKey: ACTIVE_DEPLOYMENT_KEY,
    activationScope: "testnet_network_benchmark_exercise",
    permittedWorkerJurisdictions: ["DE", "FR"],
    authorizationDurationSeconds: 86_400,
    evidence,
    opportunityIds: ["opportunity_public_safe"],
  };
}

test("default network benchmark activation fails closed without its secret or key version", async () => {
  const previousSecret = process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET;
  const previousKeyVersion = process.env.TOKENLESS_COMPLIANCE_OPERATOR_KEY_VERSION;
  try {
    delete process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET;
    delete process.env.TOKENLESS_COMPLIANCE_OPERATOR_KEY_VERSION;
    const unavailable = await POST(new NextRequest(URL, { method: "POST", body: "not-json" }));
    assert.equal(unavailable.status, 503);

    process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET = "o".repeat(32);
    const missingVersion = await POST(
      new NextRequest(URL, {
        method: "POST",
        headers: { authorization: `Bearer ${"o".repeat(32)}` },
        body: "not-json",
      }),
    );
    assert.equal(missingVersion.status, 503);
  } finally {
    if (previousSecret === undefined) delete process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET;
    else process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET = previousSecret;
    if (previousKeyVersion === undefined) delete process.env.TOKENLESS_COMPLIANCE_OPERATOR_KEY_VERSION;
    else process.env.TOKENLESS_COMPLIANCE_OPERATOR_KEY_VERSION = previousKeyVersion;
  }
});

test("network benchmark activation requires a compliance operator before parsing or persistence", async () => {
  let called = false;
  const post = createNetworkBenchmarkActivationPost({
    authorizeOperator() {
      throw new TokenlessServiceError("denied", 401, "invalid_operator_credential");
    },
    async activate() {
      called = true;
      return {} as never;
    },
    async deactivate() {
      called = true;
      return {} as never;
    },
  });
  const response = await post(new NextRequest(URL, { method: "POST", body: "not-json" }));
  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("network benchmark activation binds operator-attested evidence to a non-participating active manager reference", async () => {
  const received: Record<string, unknown>[] = [];
  let suppliedAuthorization: string | null = null;
  const post = createNetworkBenchmarkActivationPost({
    authorizeOperator(authorization) {
      suppliedAuthorization = authorization;
      return { keyVersion: "operator_v1" };
    },
    async activate(input) {
      received.push(input as unknown as Record<string, unknown>);
      return { activationHash: `sha256:${"a".repeat(64)}` } as never;
    },
    async deactivate() {
      assert.fail("deactivate must not be called");
    },
  });
  const response = await post(
    new NextRequest(URL, {
      method: "POST",
      headers: { authorization: "Bearer operator-secret", "Content-Type": "application/json" },
      body: JSON.stringify(activationBody()),
    }),
  );
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal(suppliedAuthorization, "Bearer operator-secret");
  assert.equal(received[0]?.workspaceManagerReferencePrincipalId, "rlp_manager_0001");
  assert.equal(received[0]?.complianceOperatorKeyVersion, "operator_v1");
  assert.equal(received[0]?.workspaceId, "workspace_benchmark");
  assert.equal(received[0]?.activationScope, "testnet_network_benchmark_exercise");
  assert.deepEqual(received[0]?.permittedWorkerJurisdictions, ["DE", "FR"]);
});

test("network benchmark activation rejects a non-testnet scope before persistence", async () => {
  let called = false;
  const post = createNetworkBenchmarkActivationPost({
    authorizeOperator() {
      return { keyVersion: "operator_v1" };
    },
    async activate() {
      called = true;
      return {} as never;
    },
    async deactivate() {
      called = true;
      return {} as never;
    },
  });
  const response = await post(
    new NextRequest(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...activationBody(), activationScope: "live_marketplace_release" }),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("network benchmark activation requires the exact permitted-jurisdiction set field", async () => {
  let called = false;
  const post = createNetworkBenchmarkActivationPost({
    authorizeOperator() {
      return { keyVersion: "operator_v1" };
    },
    async activate() {
      called = true;
      return {} as never;
    },
    async deactivate() {
      called = true;
      return {} as never;
    },
  });
  const missingJurisdictions = Object.fromEntries(
    Object.entries(activationBody()).filter(([key]) => key !== "permittedWorkerJurisdictions"),
  );
  const response = await post(
    new NextRequest(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(missingJurisdictions),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("network benchmark activation rejects unsupported evidence fields before persistence", async () => {
  let called = false;
  const post = createNetworkBenchmarkActivationPost({
    authorizeOperator() {
      return { keyVersion: "operator_v1" };
    },
    async activate() {
      called = true;
      return {} as never;
    },
    async deactivate() {
      called = true;
      return {} as never;
    },
  });
  const body: Record<string, unknown> = {
    ...activationBody(),
    evidence: [{ ...activationBody().evidence[0]!, rawPrivateArtifact: "forbidden" }],
  };
  const response = await post(
    new NextRequest(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("network benchmark emergency deactivation requires only the operator and the exact activation identity", async () => {
  let received: Record<string, unknown> | null = null;
  const post = createNetworkBenchmarkActivationPost({
    authorizeOperator() {
      return { keyVersion: "operator_v2" };
    },
    async activate() {
      assert.fail("activate must not be called");
    },
    async deactivate(input) {
      received = input as unknown as Record<string, unknown>;
      return { deactivationHash: `sha256:${"e".repeat(64)}` } as never;
    },
  });
  const response = await post(
    new NextRequest(URL, {
      method: "POST",
      headers: { authorization: "Bearer operator-secret", "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "deactivate",
        workspaceId: "workspace_benchmark",
        projectId: "project_benchmark",
        activationReference: "activation_v1",
        reason: "release_gate_failure",
      }),
    }),
  );
  assert.equal(response.status, 201);
  assert.deepEqual(received, {
    complianceOperatorKeyVersion: "operator_v2",
    workspaceId: "workspace_benchmark",
    projectId: "project_benchmark",
    activationReference: "activation_v1",
    reason: "release_gate_failure",
  });
});
