import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  addAssuranceCase,
  archiveAssuranceProject,
  canonicalizeHumanAssuranceDocument,
  createAssuranceAudiencePolicy,
  createAssuranceProject,
  createAssuranceRun,
  createAssuranceSuite,
  freezeAssuranceRun,
  freezeAssuranceSuite,
  hashHumanAssuranceDocument,
  markAssuranceCaseReady,
  transitionAssuranceRun,
} from "~~/lib/tokenless/humanAssurance";
import { type ProductPrincipal, createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function fixtureHash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

async function principalFor(ownerAddress: string, name: string) {
  const { workspaceId } = await createWorkspace({ name, ownerAddress });
  const { apiKeyId } = await createWorkspaceApiKey({
    workspaceId,
    name: `${name} test key`,
  });
  const principal: ProductPrincipal = {
    kind: "api_key",
    apiKeyId,
    workspaceId,
    role: "member",
  };
  return { principal, workspaceId };
}

function rubric() {
  return {
    prompt: "Which answer better satisfies the customer policy?",
    failureTags: [
      { key: "incorrect", label: "Incorrect" },
      { key: "unsafe", label: "Unsafe" },
    ],
    rationale: { mode: "required" as const, minLength: 10, maxLength: 500 },
    passRule: {
      metric: "candidate_preference_share_bps" as const,
      operator: "gte" as const,
      thresholdBps: 6000,
      minimumValidResponses: 20,
    },
  };
}

function audiencePolicy() {
  return {
    reviewerSource: "customer_invited" as const,
    compensation: "paid" as const,
    cohorts: [{ cohortId: "support_leads", minimumReviewers: 10, maximumReviewers: 20 }],
    selection: "customer_named" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [{ key: "support_experience", operator: "attested" as const, value: true }],
    assurance: {
      requiredCapabilities: ["customer_invitation" as const],
      allowedProviders: [],
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source" as const, "qualification_summary" as const],
      minimumAggregationSize: 10,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
}

async function createProject(principal: ProductPrincipal, name = "Support QA") {
  return createAssuranceProject({
    principal,
    name,
    dataClassification: "confidential",
    retentionDays: 90,
  });
}

async function seedArtifact(input: {
  artifactId: string;
  projectId: string;
  role: "baseline" | "candidate" | "context";
  digest: string;
  redactionStatus?: "approved" | "pending";
}) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_artifacts
          (artifact_id, project_id, role, label, digest, content_type,
           size_bytes, storage_ref, redaction_status, renderer_policy,
           created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'text/plain', 42, ?, ?, 'plain_text', ?, ?)`,
    args: [
      input.artifactId,
      input.projectId,
      input.role,
      input.role,
      input.digest,
      `artifact://test/${input.artifactId}`,
      input.redactionStatus ?? "approved",
      now,
      now,
    ],
  });
}

async function frozenSuite(principal: ProductPrincipal, projectId: string) {
  await seedArtifact({
    artifactId: `${projectId}_baseline`,
    projectId,
    role: "baseline",
    digest: fixtureHash(`${projectId}:baseline`),
  });
  await seedArtifact({
    artifactId: `${projectId}_candidate`,
    projectId,
    role: "candidate",
    digest: fixtureHash(`${projectId}:candidate`),
  });
  const suite = await createAssuranceSuite({
    principal,
    projectId,
    name: "Release gate",
    rubric: rubric(),
  });
  const assuranceCase = await addAssuranceCase({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    title: "Refund request",
    instructions: "Compare the two blinded responses for correctness and safety.",
    baselineArtifactId: `${projectId}_baseline`,
    candidateArtifactId: `${projectId}_candidate`,
  });
  await markAssuranceCaseReady({ principal, caseId: assuranceCase.caseId });
  const frozen = await freezeAssuranceSuite({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
  });
  return { ...suite, ...frozen, caseId: assuranceCase.caseId };
}

test("audience policies canonicalize exact v2 content and are content-bound", async () => {
  const { principal } = await principalFor(ADDRESS_A, "Acme");
  const { projectId } = await createProject(principal);
  const created = await createAssuranceAudiencePolicy({
    principal,
    projectId,
    policy: audiencePolicy(),
  });
  const stored = await dbClient.execute({
    sql: `SELECT policy_json, policy_hash, reviewer_source, selection,
                 buyer_privacy_json
          FROM tokenless_assurance_audience_policies WHERE policy_id = ?`,
    args: [created.policy.policyId],
  });
  const row = stored.rows[0] as Record<string, unknown>;
  assert.equal(row.policy_json, canonicalizeHumanAssuranceDocument(created.policy));
  assert.equal(row.policy_hash, hashHumanAssuranceDocument(created.policy));
  assert.equal(row.reviewer_source, "customer_invited");
  assert.equal(row.selection, "customer_named");
  assert.deepEqual(JSON.parse(String(row.buyer_privacy_json)), created.policy.buyerPrivacy);
  assert.equal(String(row.policy_json).includes("tierId"), false);
  assert.equal(String(row.policy_json).includes("world-id"), false);

  assert.equal(
    hashHumanAssuranceDocument({ b: 2, a: { d: 4, c: 3 } }),
    hashHumanAssuranceDocument({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test("workspace authorization fails closed across tenants and non-product roles", async () => {
  const first = await principalFor(ADDRESS_A, "First");
  const second = await principalFor(ADDRESS_B, "Second");
  const { projectId } = await createProject(first.principal, "Private project");

  await assert.rejects(
    () =>
      createAssuranceSuite({
        principal: second.principal,
        projectId,
        name: "Stolen suite",
        rubric: rubric(),
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_project_not_found",
  );

  await assert.rejects(
    () =>
      createAssuranceProject({
        principal: { ...first.principal, role: "billing" },
        name: "Billing cannot create this",
        dataClassification: "internal",
        retentionDays: 30,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "insufficient_role",
  );
});

test("suite, case, and run manifests freeze immutably with strict lifecycle transitions", async () => {
  const { principal } = await principalFor(ADDRESS_A, "Acme");
  const { projectId } = await createProject(principal);
  await seedArtifact({
    artifactId: "baseline_pending",
    projectId,
    role: "baseline",
    digest: fixtureHash("baseline_pending"),
    redactionStatus: "pending",
  });
  await seedArtifact({
    artifactId: "candidate_ready",
    projectId,
    role: "candidate",
    digest: HASH_B,
  });
  const draftSuite = await createAssuranceSuite({
    principal,
    projectId,
    name: "Draft suite",
    rubric: rubric(),
  });
  const draftCase = await addAssuranceCase({
    principal,
    suiteId: draftSuite.suiteId,
    suiteVersion: draftSuite.version,
    title: "Pending case",
    instructions: "Compare both answers after the redaction review is complete.",
    baselineArtifactId: "baseline_pending",
    candidateArtifactId: "candidate_ready",
  });
  await assert.rejects(
    () => markAssuranceCaseReady({ principal, caseId: draftCase.caseId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_case_redaction_pending",
  );
  await assert.rejects(
    () =>
      freezeAssuranceSuite({
        principal,
        suiteId: draftSuite.suiteId,
        suiteVersion: draftSuite.version,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_suite_not_ready",
  );

  const suite = await frozenSuite(principal, projectId);
  const replay = await freezeAssuranceSuite({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
  });
  assert.equal(replay.manifestHash, suite.manifestHash);
  await assert.rejects(
    () =>
      addAssuranceCase({
        principal,
        suiteId: suite.suiteId,
        suiteVersion: suite.version,
        title: "Late mutation",
        instructions: "This must never be accepted after the suite is frozen.",
        baselineArtifactId: `${projectId}_baseline`,
        candidateArtifactId: `${projectId}_candidate`,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_suite_immutable",
  );

  const policy = await createAssuranceAudiencePolicy({
    principal,
    projectId,
    policy: audiencePolicy(),
  });
  const run = await createAssuranceRun({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    audiencePolicyId: policy.policy.policyId,
    audiencePolicyVersion: policy.policy.version,
  });
  const frozenRun = await freezeAssuranceRun({ principal, runId: run.runId });
  assert.equal((await freezeAssuranceRun({ principal, runId: run.runId })).manifestHash, frozenRun.manifestHash);
  await transitionAssuranceRun({ principal, runId: run.runId, status: "recruiting" });
  await transitionAssuranceRun({ principal, runId: run.runId, status: "collecting" });
  await assert.rejects(
    () => transitionAssuranceRun({ principal, runId: run.runId, status: "cancelled" }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_assurance_run_transition",
  );
  await transitionAssuranceRun({ principal, runId: run.runId, status: "aggregating" });
  await transitionAssuranceRun({ principal, runId: run.runId, status: "completed" });
  assert.deepEqual(await archiveAssuranceProject({ principal, projectId }), {
    projectId,
    status: "archived",
  });
});

test("case and run bindings are derived from parents and reject cross-project resources", async () => {
  const { principal } = await principalFor(ADDRESS_A, "Acme");
  const first = await createProject(principal, "First project");
  const second = await createProject(principal, "Second project");
  await seedArtifact({
    artifactId: "first_baseline",
    projectId: first.projectId,
    role: "baseline",
    digest: HASH_A,
  });
  await seedArtifact({
    artifactId: "second_candidate",
    projectId: second.projectId,
    role: "candidate",
    digest: HASH_B,
  });
  const suite = await createAssuranceSuite({
    principal,
    projectId: first.projectId,
    name: "Isolated suite",
    rubric: rubric(),
  });
  await assert.rejects(
    () =>
      addAssuranceCase({
        principal,
        suiteId: suite.suiteId,
        suiteVersion: suite.version,
        title: "Cross-project case",
        instructions: "Cross-project artifacts must never be accepted into this case.",
        baselineArtifactId: "first_baseline",
        candidateArtifactId: "second_candidate",
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_assurance_artifact",
  );

  const firstSuite = await frozenSuite(principal, first.projectId);
  const secondPolicy = await createAssuranceAudiencePolicy({
    principal,
    projectId: second.projectId,
    policy: audiencePolicy(),
  });
  await assert.rejects(
    () =>
      createAssuranceRun({
        principal,
        suiteId: firstSuite.suiteId,
        suiteVersion: firstSuite.version,
        audiencePolicyId: secondPolicy.policy.policyId,
        audiencePolicyVersion: secondPolicy.policy.version,
      }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "invalid_assurance_audience_policy",
  );
});
