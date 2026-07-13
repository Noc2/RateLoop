import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  authenticateAssuranceApiPrincipal,
  createAssuranceApiProject,
  getAssuranceApiProject,
  getAssuranceApiRunStatus,
  listAssuranceApiProjects,
  parseAssuranceApiProjectRequest,
} from "~~/lib/tokenless/assuranceIntegrations";
import { freezeAssuranceRunOrchestration } from "~~/lib/tokenless/assuranceRunOrchestration";
import {
  addAssuranceCase,
  createAssuranceAudiencePolicy,
  createAssuranceRun,
  createAssuranceSuite,
  freezeAssuranceSuite,
  markAssuranceCaseReady,
} from "~~/lib/tokenless/humanAssurance";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const ADDRESS_A = "0x1111111111111111111111111111111111111111";
const ADDRESS_B = "0x2222222222222222222222222222222222222222";

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

async function workspaceWithKey(name: string, ownerAddress: string) {
  const { workspaceId } = await createWorkspace({ name, ownerAddress });
  const key = await createWorkspaceApiKey({ workspaceId, name: `${name} integration` });
  return { workspaceId, ...key };
}

function digest(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function seedArtifact(input: { artifactId: string; projectId: string; role: "baseline" | "candidate" }) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_artifacts
          (artifact_id, project_id, role, label, digest, content_type, size_bytes,
           storage_ref, redaction_status, renderer_policy, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'text/plain', 20, ?, 'approved', 'plain_text', ?, ?)`,
    args: [
      input.artifactId,
      input.projectId,
      input.role,
      input.role,
      digest(input.artifactId),
      `artifact://integration/${input.artifactId}`,
      now,
      now,
    ],
  });
}

test("workspace API keys create and list only their own assurance projects", async () => {
  const first = await workspaceWithKey("Consultancy", ADDRESS_A);
  const second = await workspaceWithKey("Other client", ADDRESS_B);

  await assert.rejects(
    () => authenticateAssuranceApiPrincipal(null),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "workspace_api_key_required",
  );
  const firstPrincipal = await authenticateAssuranceApiPrincipal(`Bearer ${first.token}`);
  const secondPrincipal = await authenticateAssuranceApiPrincipal(`Bearer ${second.token}`);
  const created = await createAssuranceApiProject({
    principal: firstPrincipal,
    request: parseAssuranceApiProjectRequest({
      name: "Support release checks",
      dataClassification: "confidential",
      retentionDays: 90,
    }),
  });

  assert.equal(created.workspaceId, first.workspaceId);
  assert.deepEqual(
    (await listAssuranceApiProjects(firstPrincipal)).projects.map(project => project.projectId),
    [created.projectId],
  );
  assert.deepEqual((await listAssuranceApiProjects(secondPrincipal)).projects, []);
  await assert.rejects(
    () => getAssuranceApiProject({ principal: secondPrincipal, projectId: created.projectId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_project_not_found",
  );
});

test("run status is aggregate-only and fails closed across workspaces", async () => {
  const first = await workspaceWithKey("Evaluation team", ADDRESS_A);
  const second = await workspaceWithKey("Other tenant", ADDRESS_B);
  const principal = await authenticateAssuranceApiPrincipal(`Bearer ${first.token}`);
  const otherPrincipal = await authenticateAssuranceApiPrincipal(`Bearer ${second.token}`);
  const project = await createAssuranceApiProject({
    principal,
    request: {
      name: "Release quality",
      dataClassification: "internal",
      retentionDays: 30,
    },
  });
  await Promise.all([
    seedArtifact({ artifactId: "baseline_release", projectId: project.projectId, role: "baseline" }),
    seedArtifact({ artifactId: "candidate_release", projectId: project.projectId, role: "candidate" }),
  ]);
  const suite = await createAssuranceSuite({
    principal,
    projectId: project.projectId,
    name: "Blinded release comparison",
    rubric: {
      prompt: "Which output follows the support policy better?",
      failureTags: [{ key: "incorrect", label: "Incorrect" }],
      rationale: { mode: "required", minLength: 10, maxLength: 500 },
      passRule: {
        metric: "candidate_preference_share_bps",
        operator: "gte",
        thresholdBps: 6000,
        minimumValidResponses: 3,
      },
    },
  });
  const assuranceCase = await addAssuranceCase({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    title: "Refund request",
    instructions: "Compare both blinded outputs against the supplied customer support policy.",
    baselineArtifactId: "baseline_release",
    candidateArtifactId: "candidate_release",
  });
  await markAssuranceCaseReady({ principal, caseId: assuranceCase.caseId });
  await freezeAssuranceSuite({ principal, suiteId: suite.suiteId, suiteVersion: suite.version });
  const policy = await createAssuranceAudiencePolicy({
    principal,
    projectId: project.projectId,
    policy: {
      reviewerSource: "customer_invited",
      compensation: "unpaid",
      cohorts: [{ cohortId: "support_leads", minimumReviewers: 3, maximumReviewers: 5 }],
      selection: "customer_named",
      fallbacks: { allowed: false, sources: [] },
      requiredQualifications: [],
      assurance: { requiredCapabilities: ["customer_invitation"], allowedProviders: [] },
      buyerPrivacy: {
        visibleFields: ["reviewer_source"],
        minimumAggregationSize: 3,
        suppressSmallCells: true,
      },
      legalEligibilityRequired: false,
    },
  });
  const run = await createAssuranceRun({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    audiencePolicyId: policy.policy.policyId,
    audiencePolicyVersion: policy.policy.version,
  });
  await freezeAssuranceRunOrchestration({ principal, runId: run.runId });

  const status = await getAssuranceApiRunStatus({ principal, runId: run.runId });
  assert.equal(status.runStatus, "frozen");
  assert.equal(status.totalCases, 1);
  assert.deepEqual(status.roundStates, { planned: 1 });
  assert.equal(status.decision, "pending");
  assert.equal("manifest" in status, false);
  await assert.rejects(
    () => getAssuranceApiRunStatus({ principal: otherPrincipal, runId: run.runId }),
    (error: unknown) => error instanceof TokenlessServiceError && error.code === "assurance_resource_not_found",
  );
});
