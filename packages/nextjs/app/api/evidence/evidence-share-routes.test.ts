import { NextRequest } from "next/server";
import { DELETE as revokeShare } from "../account/workspaces/[workspaceId]/assurance/runs/[runId]/evidence/shares/[grantId]/route";
import {
  POST as createShare,
  GET as listShares,
} from "../account/workspaces/[workspaceId]/assurance/runs/[runId]/evidence/shares/route";
import { POST as redeemShare } from "./shares/[grantId]/redeem/route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { createProjectOwnerAssignment } from "~~/lib/tokenless/projectAccess";

const ORIGIN = "https://tokenless.example.test";
const NO_STORE = "private, no-store, max-age=0";
const NOW = new Date("2026-07-29T12:00:00.000Z");
const HASH = (character: string) => `sha256:${character.repeat(64)}`;
const PACKET = {
  payload: { packetId: "packet_share_route", runId: "run_share_route" },
  signing: { algorithm: "Ed25519", keyId: "ed25519:route", publicKey: "route-public-key" },
  packetDigest: HASH("9"),
  signature: "route-signature",
};
const previousAppUrl = process.env.APP_URL;
const previousRateLimitSecret = process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;

beforeEach(() => {
  process.env.APP_URL = ORIGIN;
  process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = "evidence-share-route-test-secret-at-least-32-characters";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
  if (previousRateLimitSecret === undefined) delete process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET;
  else process.env.TOKENLESS_MCP_RATE_LIMIT_SECRET = previousRateLimitSecret;
});

async function browser(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_evidence_share_${label}`,
    method: "passkey",
  });
  return { principalId: identity.principalId, token: (await createAuthSession(identity)).token };
}

function accountRequest(
  path: string,
  options: { body?: unknown; method?: "GET" | "POST" | "DELETE"; origin?: string; token?: string } = {},
) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new NextRequest(`${ORIGIN}${path}`, {
    body,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.token ? { cookie: `${AUTH_SESSION_COOKIE}=${options.token}` } : {}),
    },
    method: options.method ?? "GET",
  });
}

function publicRequest(path: string, body: unknown, origin = ORIGIN) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin,
      "x-real-ip": "203.0.113.50",
    },
  });
}

async function seedEvidence(owner: { principalId: string }) {
  const { workspaceId } = await createWorkspace({ name: "Evidence share route", ownerAddress: owner.principalId });
  const projectId = "project_share_route";
  const rubricId = "rubric_share_route";
  const suiteId = "suite_share_route";
  const policyId = "policy_share_route";
  const runId = "run_share_route";
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_projects
          (project_id,workspace_id,name,data_classification,status,retention_days,created_by,created_at,updated_at)
          VALUES (?,?,'Evidence share route','confidential','active',30,?,?,?)`,
    args: [projectId, workspaceId, owner.principalId, NOW, NOW],
  });
  await createProjectOwnerAssignment({
    accountAddress: owner.principalId,
    now: NOW,
    projectId,
    workspaceId,
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
          VALUES (?,?,'Evidence share suite',1,'frozen',?,1,?,?)`,
    args: [suiteId, projectId, rubricId, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_audience_policies
          (policy_id,project_id,version,reviewer_source,compensation,cohorts_json,selection,
           fallbacks_json,required_qualifications_json,assurance_json,buyer_privacy_json,
           legal_eligibility_required,policy_hash,policy_json,created_at)
          VALUES (?,?,1,'public_network','unpaid','[]','open','{}','[]','{}','{}',false,?,'{}',?)`,
    args: [policyId, projectId, HASH("1"), NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_runs
          (run_id,project_id,suite_id,suite_version,audience_policy_id,audience_policy_version,
           status,policy_hash,created_by,created_at,updated_at,completed_at)
          VALUES (?,?,?,1,?,1,'completed',?,?,?,?,?)`,
    args: [runId, projectId, suiteId, policyId, HASH("1"), owner.principalId, NOW, NOW, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_assurance_evidence_packets
          (packet_id,run_id,manifest_hash,case_root,response_root,aggregation_version,result_json,
           limitations_json,chain_references_json,signature,generated_at,packet_digest,packet_json,
           signature_algorithm,signing_key_id,signing_public_key)
          VALUES ('packet_share_route',?,?, 'case-root','response-root','v1','{}','[]','{}',
                  'route-signature',?,?,?,'Ed25519','ed25519:route','route-public-key')`,
    args: [runId, HASH("2"), NOW, HASH("9"), JSON.stringify(PACKET)],
  });
  return { projectId, runId, workspaceId };
}

test("account routes require an authorized same-origin session and reveal the bearer secret once in a fragment", async () => {
  const owner = await browser("owner");
  const outsider = await browser("outsider");
  const scope = await seedEvidence(owner);
  const path = `/api/account/workspaces/${scope.workspaceId}/assurance/runs/${scope.runId}/evidence/shares`;
  const context = { params: Promise.resolve({ runId: scope.runId, workspaceId: scope.workspaceId }) };

  const unauthenticated = await listShares(accountRequest(path), context);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("cache-control"), NO_STORE);
  const hidden = await listShares(accountRequest(path, { token: outsider.token }), context);
  assert.equal(hidden.status, 404);
  const crossOrigin = await createShare(
    accountRequest(path, {
      body: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      method: "POST",
      origin: "https://attacker.example",
      token: owner.token,
    }),
    context,
  );
  assert.equal(crossOrigin.status, 403);

  const created = await createShare(
    accountRequest(path, {
      body: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      method: "POST",
      origin: ORIGIN,
      token: owner.token,
    }),
    context,
  );
  assert.equal(created.status, 201, await created.clone().text());
  assert.equal(created.headers.get("cache-control"), NO_STORE);
  const body = (await created.json()) as { share: { grantId: string }; shareUrl: string };
  const shareUrl = new URL(body.shareUrl);
  assert.equal(shareUrl.origin, ORIGIN);
  assert.equal(shareUrl.pathname, `/evidence/share/${body.share.grantId}`);
  assert.equal(shareUrl.search, "");
  assert.match(shareUrl.hash, /^#[A-Za-z0-9_-]{43}$/u);
  const secret = shareUrl.hash.slice(1);
  const stored = await dbClient.execute("SELECT token_hash FROM tokenless_assurance_evidence_share_grants");
  assert.equal(JSON.stringify(stored.rows).includes(secret), false);

  const listed = await listShares(accountRequest(path, { token: owner.token }), context);
  assert.equal(listed.status, 200);
  const listedBody = (await listed.json()) as Record<string, unknown>;
  assert.equal(JSON.stringify(listedBody).includes(secret), false);
  assert.equal((listedBody.shares as unknown[]).length, 1);
});

test("public redemption is same-origin POST-only, returns only the packet, and uniformly hides invalid or revoked grants", async () => {
  const owner = await browser("public-owner");
  const scope = await seedEvidence(owner);
  const accountPath = `/api/account/workspaces/${scope.workspaceId}/assurance/runs/${scope.runId}/evidence/shares`;
  const accountContext = { params: Promise.resolve({ runId: scope.runId, workspaceId: scope.workspaceId }) };
  const created = await createShare(
    accountRequest(accountPath, {
      body: { expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
      method: "POST",
      origin: ORIGIN,
      token: owner.token,
    }),
    accountContext,
  );
  const createdBody = (await created.json()) as { share: { grantId: string }; shareUrl: string };
  const secret = new URL(createdBody.shareUrl).hash.slice(1);
  const redeemPath = `/api/evidence/shares/${createdBody.share.grantId}/redeem`;
  const redeemContext = { params: Promise.resolve({ grantId: createdBody.share.grantId }) };

  const crossOrigin = await redeemShare(
    publicRequest(redeemPath, { secret }, "https://attacker.example"),
    redeemContext,
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.headers.get("cache-control"), NO_STORE);
  assert.equal(crossOrigin.headers.get("referrer-policy"), "no-referrer");
  assert.equal(crossOrigin.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");

  const strictBody = await redeemShare(
    publicRequest(redeemPath, { secret, workspaceId: scope.workspaceId }),
    redeemContext,
  );
  assert.equal(strictBody.status, 400);

  const wrong = await redeemShare(
    publicRequest(redeemPath, { secret: Buffer.alloc(32, 7).toString("base64url") }),
    redeemContext,
  );
  assert.equal(wrong.status, 404);
  const wrongBody = await wrong.json();

  const redeemed = await redeemShare(publicRequest(redeemPath, { secret }), redeemContext);
  assert.equal(redeemed.status, 200, await redeemed.clone().text());
  assert.deepEqual(await redeemed.json(), PACKET);
  assert.equal(redeemed.headers.get("cache-control"), NO_STORE);
  assert.equal(redeemed.headers.get("referrer-policy"), "no-referrer");
  assert.equal(redeemed.headers.get("x-content-type-options"), "nosniff");
  assert.equal(redeemed.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");

  const revokePath = `${accountPath}/${createdBody.share.grantId}`;
  const revoked = await revokeShare(
    accountRequest(revokePath, { method: "DELETE", origin: ORIGIN, token: owner.token }),
    { params: Promise.resolve({ ...scope, grantId: createdBody.share.grantId }) },
  );
  assert.equal(revoked.status, 204);
  const afterRevoke = await redeemShare(publicRequest(redeemPath, { secret }), redeemContext);
  assert.equal(afterRevoke.status, 404);
  assert.deepEqual(await afterRevoke.json(), wrongBody);
});
