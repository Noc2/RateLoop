import { NextRequest } from "next/server";
import { POST as createAudiencePolicy } from "./workspaces/[workspaceId]/assurance/projects/[projectId]/audience-policies/route";
import { POST as createProject } from "./workspaces/[workspaceId]/assurance/projects/route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const ORIGIN = "https://tokenless.example.test";
const previousAppUrl = process.env.APP_URL;

beforeEach(() => {
  process.env.APP_URL = ORIGIN;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
});

async function browserPrincipal(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_assurance_project_${label}`,
    method: "passkey",
  });
  return { principalId: identity.principalId, token: (await createAuthSession(identity)).token };
}

function request(path: string, body: unknown, token?: string, origin = ORIGIN) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin,
      ...(token ? { cookie: `${AUTH_SESSION_COOKIE}=${token}` } : {}),
    },
  });
}

function networkPolicy() {
  return {
    reviewerSource: "rateloop_network" as const,
    integrity: {
      schemaVersion: "rateloop.integrity-assignment.v1" as const,
      epochId: "integrity:2030-01-01:001",
      epochManifestHash: `sha256:${"a".repeat(64)}`,
      maxClusterShareBps: 5_000,
      allowedRiskBands: ["low", "medium"] as const,
      recentCoassignmentWindowSeconds: 86_400,
      maxRecentCoassignments: 2,
      maxPerCustomer: 3,
      onePerProviderSubject: true as const,
    },
    compensation: "paid" as const,
    cohorts: [{ cohortId: "global-public", minimumReviewers: 3, maximumReviewers: 3 }],
    selection: "randomized" as const,
    fallbacks: { allowed: false, sources: [] },
    requiredQualifications: [],
    assurance: {
      requirements: [
        {
          capability: "unique_human" as const,
          reviewerSources: ["rateloop_network" as const],
          allowedProviders: ["world:poh"],
          freshnessSeconds: 3_600,
        },
      ],
    },
    buyerPrivacy: {
      visibleFields: ["reviewer_source" as const],
      minimumAggregationSize: 3,
      suppressSmallCells: true,
    },
    legalEligibilityRequired: true,
  };
}

test("browser project and audience-policy routes enforce mutation origin and strict public dimensions", async () => {
  const owner = await browserPrincipal("owner");
  const { workspaceId } = await createWorkspace({ name: "Public assurance", ownerAddress: owner.principalId });
  const projectPath = `/api/account/workspaces/${workspaceId}/assurance/projects`;
  const projectContext = { params: Promise.resolve({ workspaceId }) };

  const csrf = await createProject(
    request(
      projectPath,
      {
        name: "Rejected",
        visibility: "public",
        dataClassification: "public",
        publicMaterialKind: "public",
        confirmedNoSensitiveData: true,
        retentionDays: 30,
      },
      owner.token,
      "https://attacker.example",
    ),
    projectContext,
  );
  assert.equal(csrf.status, 403);

  const malformed = await createProject(
    request(
      projectPath,
      {
        name: "Mismatch",
        visibility: "public",
        dataClassification: "confidential",
        publicMaterialKind: "redacted",
        confirmedNoSensitiveData: true,
        retentionDays: 30,
        unexpected: true,
      },
      owner.token,
    ),
    projectContext,
  );
  assert.equal(malformed.status, 400);

  for (const publicMaterialKind of ["public", "synthetic", "redacted"] as const) {
    const response = await createProject(
      request(
        projectPath,
        {
          name: `${publicMaterialKind} project`,
          visibility: "public",
          dataClassification: "public",
          publicMaterialKind,
          confirmedNoSensitiveData: true,
          retentionDays: 30,
        },
        owner.token,
      ),
      projectContext,
    );
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  }

  const projects = await dbClient.execute({
    sql: `SELECT project_id,visibility,material_kind,data_classification
          FROM tokenless_assurance_projects WHERE workspace_id=? ORDER BY created_at`,
    args: [workspaceId],
  });
  assert.deepEqual(
    projects.rows.map(row => [row.visibility, row.material_kind, row.data_classification]),
    [
      ["public", "public", "public"],
      ["public", "synthetic", "public"],
      ["public", "redacted", "public"],
    ],
  );

  const projectId = String(projects.rows[0]?.project_id);
  const policyPath = `${projectPath}/${projectId}/audience-policies`;
  const policyContext = { params: Promise.resolve({ workspaceId, projectId }) };
  const policyCsrf = await createAudiencePolicy(
    request(policyPath, networkPolicy(), owner.token, "https://attacker.example"),
    policyContext,
  );
  assert.equal(policyCsrf.status, 403);
  const invalidPolicy = await createAudiencePolicy(
    request(policyPath, { ...networkPolicy(), unknown: true }, owner.token),
    policyContext,
  );
  assert.equal(invalidPolicy.status, 400);
  const created = await createAudiencePolicy(request(policyPath, networkPolicy(), owner.token), policyContext);
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal((await created.json()).policy.reviewerSource, "rateloop_network");
});

test("project routes conceal tenant resources from members without project access and outsiders", async () => {
  const owner = await browserPrincipal("owner-conceal");
  const member = await browserPrincipal("member-conceal");
  const outsider = await browserPrincipal("outsider-conceal");
  const { workspaceId } = await createWorkspace({ name: "Concealed assurance", ownerAddress: owner.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
          VALUES (?,?, 'member', ?)`,
    args: [workspaceId, member.principalId, new Date()],
  });
  const path = `/api/account/workspaces/${workspaceId}/assurance/projects`;
  const context = { params: Promise.resolve({ workspaceId }) };
  const body = {
    name: "Private project",
    visibility: "private",
    dataClassification: "internal",
    retentionDays: 30,
  };
  assert.equal((await createProject(request(path, body, member.token), context)).status, 403);
  assert.equal((await createProject(request(path, body, outsider.token), context)).status, 404);

  const created = await createProject(request(path, body, owner.token), context);
  assert.equal(created.status, 201);
  const projectId = String((await created.json()).projectId);
  const policyPath = `${path}/${projectId}/audience-policies`;
  const policyContext = { params: Promise.resolve({ workspaceId, projectId }) };
  assert.equal(
    (await createAudiencePolicy(request(policyPath, networkPolicy(), member.token), policyContext)).status,
    404,
  );
  assert.equal(
    (await createAudiencePolicy(request(policyPath, networkPolicy(), outsider.token), policyContext)).status,
    404,
  );
});
