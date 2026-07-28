import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { searchAuthorizedSiteData } from "~~/lib/search/authorizedSiteSearch";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import { getWorkspaceEvaluationDashboard } from "~~/lib/tokenless/evaluationDashboard";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const NOW = new Date("2026-07-28T08:00:00.000Z");
const HASH = (marker: string) => `sha256:${marker.repeat(64)}`;

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function principal(label: string) {
  const betterAuthUserId = `better_search_${label}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_better_auth_users
          (id,name,email,email_verified,created_at,updated_at)
          VALUES (?,?,?,true,?,?)`,
    args: [betterAuthUserId, `Reviewer ${label}`, `${label}@example.test`, NOW, NOW],
  });
  return (
    await resolveBetterAuthPrincipal({
      betterAuthUserId,
      displayName: `Reviewer ${label}`,
      method: "email-otp",
    })
  ).principalId;
}

async function seedWorkspace(label: string, owner: string) {
  const { workspaceId } = await createWorkspace({ name: `${label} workspace`, ownerAddress: owner });
  const projectId = `project_${label}`;
  const rubricId = `rubric_${label}`;
  const suiteId = `suite_${label}`;
  const policyId = `policy_${label}`;
  const runId = `run_${label}_exact`;
  const packetId = `packet_${label}_exact`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id,workspace_id,name,description,data_classification,status,retention_days,
           created_by,created_at,updated_at)
          VALUES (?,?,?,?,'confidential','active',30,?,?,?)`,
    args: [projectId, workspaceId, `${label} release review`, `${label} project marker`, owner, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_rubrics
          (rubric_id,project_id,version,prompt,failure_tags_json,rationale_json,pass_rule_json,rubric_json,created_at)
          VALUES (?,?,1,'Review','[]','{}','{}','{}',?)`,
    args: [rubricId, projectId, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_suites
          (suite_id,project_id,name,version,status,rubric_id,rubric_version,created_at,updated_at)
          VALUES (?,?,?,1,'frozen',?,1,?,?)`,
    args: [suiteId, projectId, `${label} suite`, rubricId, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_audience_policies
          (policy_id,project_id,version,reviewer_source,compensation,cohorts_json,selection,
           fallbacks_json,required_qualifications_json,assurance_json,buyer_privacy_json,
           legal_eligibility_required,policy_hash,policy_json,created_at)
          VALUES (?,?,1,'customer_invited','unpaid','[]','customer_named','{}','[]','{}','{}',
                  false,?,'{}',?)`,
    args: [policyId, projectId, HASH(label[0] ?? "a"), NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_runs
          (run_id,project_id,suite_id,suite_version,audience_policy_id,audience_policy_version,
           status,policy_hash,created_by,created_at,updated_at,completed_at)
          VALUES (?,?,?,1,?,1,'completed',?,?,?, ?,?)`,
    args: [runId, projectId, suiteId, policyId, HASH(label[0] ?? "a"), owner, NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_evidence_packets
          (packet_id,run_id,manifest_hash,case_root,response_root,aggregation_version,result_json,
           limitations_json,chain_references_json,signature,generated_at,packet_digest,packet_json,
           signature_algorithm,signing_key_id,signing_public_key)
          VALUES (?,?,?,'case-root','response-root','v1','{}','[]','{}','signature',?,?, '{}',
                  'Ed25519','key-test','public-key')`,
    args: [packetId, runId, HASH("e"), NOW, HASH(label[0] ?? "f")],
  });
  const agent = await createWorkspaceAgent({
    accountAddress: owner,
    workspaceId,
    externalId: `${label}-external-agent`,
    version: {
      displayName: `${label} quality agent`,
      description: `${label} agent marker`,
      provider: "OpenAI",
      model: "gpt-5",
      modelVersion: `${label}-model`,
      environment: "production",
    },
  });
  return { agent, packetId, projectId, runId, workspaceId };
}

async function addReviewer(workspaceId: string, reviewer: string) {
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_reviewers
          (workspace_id,principal_address,status,activated_at,created_by,updated_at)
          VALUES (?,?,'active',?,?,?)`,
    args: [workspaceId, reviewer, NOW, reviewer, NOW],
  });
}

test("private search is workspace-scoped and keeps reviewer roster search manager-only", async () => {
  const ownerAlpha = await principal("owner-alpha");
  const ownerBeta = await principal("owner-beta");
  const memberAlpha = await principal("member-alpha");
  const outsider = await principal("outsider");
  const reviewerOne = await principal("searchable-reviewer-one");
  const reviewerTwo = await principal("searchable-reviewer-two");
  const alpha = await seedWorkspace("alpha", ownerAlpha);
  await seedWorkspace("beta-secret", ownerBeta);
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
          VALUES (?,?,'member',?)`,
    args: [alpha.workspaceId, memberAlpha, NOW],
  });
  await addReviewer(alpha.workspaceId, reviewerOne);
  await addReviewer(alpha.workspaceId, reviewerTwo);

  assert.deepEqual(await searchAuthorizedSiteData({ accountAddress: ownerAlpha, query: "beta-secret" }), []);
  assert.deepEqual(await searchAuthorizedSiteData({ accountAddress: outsider, query: "alpha" }), []);

  const memberData = await searchAuthorizedSiteData({ accountAddress: memberAlpha, query: "alpha" });
  assert.ok(memberData.some(result => result.area === "Run"));
  assert.ok(memberData.some(result => result.area === "Evidence"));
  assert.ok(memberData.some(result => result.area === "Agent"));
  assert.ok(memberData.some(result => result.area === "Project"));
  assert.equal(
    memberData.some(result => result.area === "Reviewer"),
    false,
  );

  const ownerRoster = await searchAuthorizedSiteData({ accountAddress: ownerAlpha, query: "searchable reviewer" });
  assert.equal(ownerRoster.filter(result => result.area === "Reviewer").length, 1);
  assert.match(ownerRoster[0]?.href ?? "", /^\/agents\/review-setup\?workspace=.*#workspace-reviewers-heading$/u);
  assert.doesNotMatch(JSON.stringify(ownerRoster), new RegExp(reviewerOne, "u"));
  assert.doesNotMatch(JSON.stringify(ownerRoster), new RegExp(reviewerTwo, "u"));
});

test("exact run, packet, project, agent, and version identifiers link to addressable canonical routes", async () => {
  const owner = await principal("exact-owner");
  const seeded = await seedWorkspace("exact", owner);
  const workspace = encodeURIComponent(seeded.workspaceId);

  const run = await searchAuthorizedSiteData({ accountAddress: owner, query: seeded.runId });
  assert.ok(
    run.some(
      result =>
        result.area === "Run" &&
        result.href === `/agents/results?workspace=${workspace}&resultRun=${encodeURIComponent(seeded.runId)}`,
    ),
  );

  const packet = await searchAuthorizedSiteData({ accountAddress: owner, query: seeded.packetId });
  assert.deepEqual(
    packet.map(result => result.area),
    ["Evidence"],
  );
  assert.equal(
    packet[0]?.href,
    `/agents/evidence?workspace=${workspace}&run=${encodeURIComponent(seeded.runId)}&packet=${encodeURIComponent(
      seeded.packetId,
    )}`,
  );

  const project = await searchAuthorizedSiteData({ accountAddress: owner, query: seeded.projectId });
  assert.ok(
    project.some(
      result =>
        result.area === "Project" &&
        result.href ===
          `/agents/results?workspace=${workspace}&resultProject=${encodeURIComponent(
            seeded.projectId,
          )}&resultQ=exact+release+review`,
    ),
  );

  for (const identifier of [seeded.agent.agentId, seeded.agent.currentVersion.versionId]) {
    const agent = await searchAuthorizedSiteData({ accountAddress: owner, query: identifier });
    assert.equal(agent[0]?.area, "Agent");
    assert.equal(
      agent[0]?.href,
      `/agents/connections?workspace=${workspace}&agent=${encodeURIComponent(
        seeded.agent.agentId,
      )}&version=${encodeURIComponent(seeded.agent.currentVersion.versionId)}`,
    );
  }
});

test("an exact search link can load an authorized run outside the recent dashboard window", async () => {
  const owner = await principal("older-run-owner");
  const seeded = await seedWorkspace("c", owner);
  for (let index = 0; index < 101; index += 1) {
    const createdAt = new Date(NOW.getTime() + (index + 1) * 60_000);
    await dbClient.execute({
      sql: `INSERT INTO tokenless_assurance_runs
            (run_id,project_id,suite_id,suite_version,audience_policy_id,audience_policy_version,
             status,policy_hash,created_by,created_at,updated_at)
            VALUES (?,?,?,1,?,1,'draft',?,?,?,?)`,
      args: [`run_c_recent_${index}`, seeded.projectId, "suite_c", "policy_c", HASH("c"), owner, createdAt, createdAt],
    });
  }

  const recent = await getWorkspaceEvaluationDashboard({
    accountAddress: owner,
    workspaceId: seeded.workspaceId,
  });
  assert.equal(
    recent.runs.some(run => run.runId === seeded.runId),
    false,
  );

  const selected = await getWorkspaceEvaluationDashboard({
    accountAddress: owner,
    requestedRunId: seeded.runId,
    workspaceId: seeded.workspaceId,
  });
  assert.equal(
    selected.runs.some(run => run.runId === seeded.runId),
    true,
  );
});

test("private search never queries blind-response or RateLoop-network reviewer identity stores", () => {
  const source = readFileSync(new URL("./authorizedSiteSearch.ts", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /tokenless_assurance_responses|reviewer_key|tokenless_assurance_cohort_reviewers|tokenless_rater_profiles|rater_id/u,
  );
  assert.match(source, /aw\.role IN \('owner','admin'\) AND r\.status='active'/u);
});
