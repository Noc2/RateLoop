import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { getWorkspaceEvaluationDashboard } from "~~/lib/tokenless/evaluationDashboard";
import {
  addAssuranceCase,
  createAssuranceAudiencePolicy,
  createAssuranceProject,
  createAssuranceRun,
  createAssuranceSuite,
  freezeAssuranceSuite,
  markAssuranceCaseReady,
} from "~~/lib/tokenless/humanAssurance";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const OWNER: `0x${string}` = "0x1111111111111111111111111111111111111111";
const OUTSIDER = "0x2222222222222222222222222222222222222222";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

function hash(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function seedArtifact(projectId: string, role: "baseline" | "candidate") {
  const now = new Date();
  const artifactId = `${projectId}_${role}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_artifacts
          (artifact_id, project_id, role, label, digest, content_type, size_bytes, storage_ref,
           redaction_status, renderer_policy, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'text/plain', 10, ?, 'approved', 'plain_text', ?, ?)`,
    args: [artifactId, projectId, role, role, hash(artifactId), `artifact://test/${artifactId}`, now, now],
  });
  return artifactId;
}

test("evaluation dashboard suppresses small cells and never attributes legacy runs to registered agents", async () => {
  const { workspaceId } = await createWorkspace({ name: "Evaluation workspace", ownerAddress: OWNER });
  const principal = { kind: "workspace_session" as const, accountAddress: OWNER, workspaceId, role: "owner" as const };
  const { projectId } = await createAssuranceProject({
    principal,
    name: "Support release gate",
    dataClassification: "confidential",
    retentionDays: 30,
  });
  const [baselineArtifactId, candidateArtifactId] = await Promise.all([
    seedArtifact(projectId, "baseline"),
    seedArtifact(projectId, "candidate"),
  ]);
  const suite = await createAssuranceSuite({
    principal,
    projectId,
    name: "Support quality",
    rubric: {
      prompt: "Which answer is better?",
      failureTags: [{ key: "incorrect", label: "Incorrect" }],
      rationale: { mode: "optional", maxLength: 500 },
      passRule: {
        metric: "candidate_preference_share_bps",
        operator: "gte",
        thresholdBps: 6_000,
        minimumValidResponses: 3,
      },
    },
  });
  const assuranceCase = await addAssuranceCase({
    principal,
    suiteId: suite.suiteId,
    suiteVersion: suite.version,
    title: "Support response",
    instructions: "Compare the baseline and candidate support responses.",
    baselineArtifactId,
    candidateArtifactId,
  });
  await markAssuranceCaseReady({ principal, caseId: assuranceCase.caseId });
  await freezeAssuranceSuite({ principal, suiteId: suite.suiteId, suiteVersion: suite.version });
  const audience = await createAssuranceAudiencePolicy({
    principal,
    projectId,
    policy: {
      reviewerSource: "customer_invited",
      compensation: "unpaid",
      cohorts: [{ cohortId: "employees", minimumReviewers: 1, maximumReviewers: 3 }],
      selection: "customer_named",
      fallbacks: { allowed: false, sources: [] },
      requiredQualifications: [],
      assurance: {
        requirements: [
          {
            capability: "customer_invitation",
            reviewerSources: ["customer_invited"],
            allowedProviders: ["rateloop:invitation"],
          },
        ],
      },
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
    audiencePolicyId: audience.policy.policyId,
    audiencePolicyVersion: audience.policy.version,
  });
  await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "support-agent",
    version: {
      displayName: "Support agent",
      provider: "OpenAI",
      model: "gpt-5",
      environment: "production",
    },
  });

  const now = new Date();
  for (const [index, choice] of ["candidate", "baseline"].entries()) {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_responses
            (response_id, run_id, case_id, reviewer_key, reviewer_source, choice,
             failure_tag_keys_json, qualification_keys_json, assurance_capabilities_json,
             response_digest, validity, submitted_at, updated_at)
            VALUES (?, ?, ?, ?, 'customer_invited', ?, '[]', '[]',
                    '["customer_invitation"]', ?, 'valid', ?, ?)`,
      args: [
        `response_${index}`,
        run.runId,
        assuranceCase.caseId,
        `reviewer_${index}`,
        choice,
        hash(`response_${index}`),
        now,
        now,
      ],
    });
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_mechanism_health
          (run_id,workspace_id,project_id,scope_hash,non_gold_case_count,unanimous_case_count,
           valid_response_count,candidate_share_bps,rbts_score_count,eligible_chain_case_count,
           indexed_chain_case_count,rbts_score_mean_bps,rbts_score_variance_bps2,gold_outcome_count,
           gold_failure_count,comparable_drift_bps,observed_at)
          VALUES (?,?,?, ?,1,1,3,6666,0,0,0,NULL,NULL,0,0,NULL,?)`,
    args: [run.runId, workspaceId, projectId, hash("mechanism-scope"), now],
  });

  const suppressed = await getWorkspaceEvaluationDashboard({ accountAddress: OWNER, workspaceId });
  assert.equal(suppressed.runs[0]?.sampleStatus, "suppressed");
  assert.equal(suppressed.runs[0]?.candidateSelectionShareBps, null);
  assert.equal(suppressed.runs[0]?.choices, null);
  assert.equal(suppressed.runs[0]?.mechanismHealth, null);
  assert.equal(suppressed.agents[0]?.attributedRunCount, 0);
  assert.equal(suppressed.summary.attributedRuns, 0);

  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_responses
          (response_id, run_id, case_id, reviewer_key, reviewer_source, choice,
           failure_tag_keys_json, qualification_keys_json, assurance_capabilities_json,
           response_digest, validity, submitted_at, updated_at)
          VALUES ('response_2', ?, ?, 'reviewer_2', 'customer_invited', 'candidate', '[]', '[]',
                  '["customer_invitation"]', ?, 'valid', ?, ?)`,
    args: [run.runId, assuranceCase.caseId, hash("response_2"), now, now],
  });
  const released = await getWorkspaceEvaluationDashboard({ accountAddress: OWNER, workspaceId });
  assert.equal(released.runs[0]?.sampleStatus, "small");
  assert.equal(released.runs[0]?.candidateSelectionShareBps, 6_666);
  assert.deepEqual(released.runs[0]?.mechanismHealth, {
    unanimityRateBps: 10_000,
    rbtsScoreVarianceBps2: null,
    goldFailureRateBps: null,
    comparableDriftBps: null,
  });
  assert.deepEqual(released.runs[0]?.attribution, { status: "unattributed", agentId: null, versionId: null });
  assert.ok(released.runs[0]?.candidateSelectionIntervalBps);

  await assert.rejects(
    () => getWorkspaceEvaluationDashboard({ accountAddress: OUTSIDER, workspaceId }),
    /Workspace not found/,
  );
});
