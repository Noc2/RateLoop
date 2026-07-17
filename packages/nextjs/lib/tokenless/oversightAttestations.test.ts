import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { GET } from "~~/app/api/account/workspaces/[workspaceId]/oversight/attestations/route";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import {
  attestOversightDesignation,
  listOversightDesignations,
  revokeOversightDesignation,
} from "~~/lib/tokenless/oversightAttestations";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const APP_ORIGIN = "https://tokenless.example.test";
const DECISION_OWNER = "0x2222222222222222222222222222222222222222";
const MEMBER = "0x3333333333333333333333333333333333333333";
const NOW = new Date("2026-07-17T12:00:00.000Z");

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function fixture(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_oversight_owner_${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  const { workspaceId } = await createWorkspace({ name: `Oversight ${label}`, ownerAddress: identity.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
          VALUES (?,?,'member',?),(?,?,'member',?)`,
    args: [workspaceId, DECISION_OWNER, NOW, workspaceId, MEMBER, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_member_governance
          (workspace_id,account_address,governance_role,created_by,created_at,updated_at)
          VALUES (?,?,'decision_owner',?,?,?)`,
    args: [workspaceId, DECISION_OWNER, identity.principalId, NOW, NOW],
  });
  return { identity, session, workspaceId };
}

async function auditActions(workspaceId: string) {
  const result = await dbClient.execute({
    sql: `SELECT action,target_kind,metadata_json FROM tokenless_audit_events
          WHERE workspace_id = ? ORDER BY sequence ASC`,
    args: [workspaceId],
  });
  return result.rows as Array<Record<string, unknown>>;
}

test("attestation binds a decision owner with authority scope, bounded expiry, and audit-chained lifecycle", async () => {
  const { identity, workspaceId } = await fixture("lifecycle");
  const attested = await attestOversightDesignation({
    accountAddress: identity.principalId,
    workspaceId,
    memberAccountAddress: DECISION_OWNER,
    competenceBasis: "Senior claims lead with model-risk training.",
    trainingRecords: [{ name: "EU AI Act oversight basics", completedAt: "2026-06-01T00:00:00.000Z", scope: "claims" }],
    authorityScope: "both",
    expiresAt: "2027-07-17T12:00:00.000Z",
    now: NOW,
  });
  assert.equal(attested.status, "active");
  assert.equal(attested.expired, false);
  assert.equal(attested.authorityScope, "both");
  assert.equal(attested.attestedBy, identity.principalId);
  assert.deepEqual(attested.trainingRecords, [
    { name: "EU AI Act oversight basics", completedAt: "2026-06-01T00:00:00.000Z", scope: "claims" },
  ]);

  // Upsert supersedes the previous attestation in place for the same member.
  const updated = await attestOversightDesignation({
    accountAddress: identity.principalId,
    workspaceId,
    memberAccountAddress: DECISION_OWNER,
    competenceBasis: "Senior claims lead; refreshed calibration.",
    authorityScope: "stop",
    now: NOW,
  });
  assert.equal(updated.attestationId, attested.attestationId);
  assert.equal(updated.authorityScope, "stop");

  const revoked = await revokeOversightDesignation({
    accountAddress: identity.principalId,
    workspaceId,
    memberAccountAddress: DECISION_OWNER,
    now: NOW,
  });
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revokedBy, identity.principalId);

  const events = await auditActions(workspaceId);
  const oversightEvents = events.filter(event => String(event.action).startsWith("oversight."));
  assert.deepEqual(
    oversightEvents.map(event => event.action),
    ["oversight.designation_attested", "oversight.designation_attested", "oversight.designation_revoked"],
  );
  for (const event of oversightEvents) {
    assert.equal(event.target_kind, "oversight_attestation");
    assert.match(String(event.metadata_json), /"role":"decision_owner"/u);
    assert.doesNotMatch(String(event.metadata_json), /claims lead/u);
  }

  await assert.rejects(
    revokeOversightDesignation({
      accountAddress: identity.principalId,
      workspaceId,
      memberAccountAddress: DECISION_OWNER,
      now: NOW,
    }),
    (error: TokenlessServiceError) => error.code === "oversight_attestation_not_found",
  );
});

test("attestations require the decision_owner role, a manager caller, and expiry within 24 months", async () => {
  const { identity, workspaceId } = await fixture("bounds");
  await assert.rejects(
    attestOversightDesignation({
      accountAddress: identity.principalId,
      workspaceId,
      memberAccountAddress: MEMBER,
      competenceBasis: "Basis",
      authorityScope: "override",
      now: NOW,
    }),
    (error: TokenlessServiceError) => error.code === "oversight_member_not_found",
  );
  await assert.rejects(
    attestOversightDesignation({
      accountAddress: MEMBER,
      workspaceId,
      memberAccountAddress: DECISION_OWNER,
      competenceBasis: "Basis",
      authorityScope: "override",
      now: NOW,
    }),
    (error: TokenlessServiceError) => error.code === "workspace_not_found",
  );
  await assert.rejects(
    attestOversightDesignation({
      accountAddress: identity.principalId,
      workspaceId,
      memberAccountAddress: DECISION_OWNER,
      competenceBasis: "Basis",
      authorityScope: "override",
      expiresAt: "2028-08-01T00:00:00.000Z",
      now: NOW,
    }),
    (error: TokenlessServiceError) => error.code === "invalid_oversight_attestation",
  );
  await assert.rejects(
    attestOversightDesignation({
      accountAddress: identity.principalId,
      workspaceId,
      memberAccountAddress: DECISION_OWNER,
      competenceBasis: "Basis",
      authorityScope: "escalate",
      now: NOW,
    }),
    (error: TokenlessServiceError) => error.code === "invalid_oversight_attestation",
  );
});

test("expired attestations stay listed and are flagged instead of silently disappearing", async () => {
  const { identity, workspaceId } = await fixture("expiry");
  await attestOversightDesignation({
    accountAddress: identity.principalId,
    workspaceId,
    memberAccountAddress: DECISION_OWNER,
    competenceBasis: "Basis",
    authorityScope: "override",
    expiresAt: "2026-08-01T00:00:00.000Z",
    now: NOW,
  });
  const later = new Date("2026-09-01T00:00:00.000Z");
  const listed = await listOversightDesignations({
    accountAddress: identity.principalId,
    workspaceId,
    now: later,
  });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.status, "active");
  assert.equal(listed[0]?.expired, true);
  await assert.rejects(
    listOversightDesignations({ accountAddress: MEMBER, workspaceId, now: later }),
    (error: TokenlessServiceError) => error.code === "workspace_not_found",
  );
});

test("the attestations route is a session-scoped no-store resource whose mutation stays same-origin", async () => {
  const { session, workspaceId, identity } = await fixture("route");
  await attestOversightDesignation({
    accountAddress: identity.principalId,
    workspaceId,
    memberAccountAddress: DECISION_OWNER,
    competenceBasis: "Basis",
    authorityScope: "override",
    now: NOW,
  });
  const context = { params: Promise.resolve({ workspaceId }) };
  const response = await GET(
    new NextRequest(`${APP_ORIGIN}/api/account/workspaces/${workspaceId}/oversight/attestations`, {
      headers: { cookie: `${AUTH_SESSION_COOKIE}=${session.token}` },
    }),
    context,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = (await response.json()) as { attestations: Array<{ authorityScope: string }> };
  assert.equal(body.attestations.length, 1);
  assert.equal(body.attestations[0]?.authorityScope, "override");

  const unauthenticated = await GET(
    new NextRequest(`${APP_ORIGIN}/api/account/workspaces/${workspaceId}/oversight/attestations`),
    context,
  );
  assert.equal(unauthenticated.status, 401);

  const source = readFileSync(
    new URL("../../app/api/account/workspaces/[workspaceId]/oversight/attestations/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /requireBrowserSession\(request, \{ mutation: true \}\)/u);
  assert.match(source, /attestOversightDesignation/u);
  assert.match(source, /revokeOversightDesignation/u);
  assert.match(source, /PUT_KEYS/u);
});
