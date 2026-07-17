import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET } from "~~/app/api/account/workspaces/[workspaceId]/oversight/training-records/route";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";
import { exportTrainingRecords } from "~~/lib/tokenless/trainingRecordsExport";

const APP_ORIGIN = "https://tokenless.example.test";
const MEMBER = "0x3333333333333333333333333333333333333333";
const REVIEWER = "0x4444444444444444444444444444444444444444";
const NOW = new Date("2026-07-17T12:00:00.000Z");
const COMPETENCE_FREE_TEXT = "Free-text competence basis that must never leave the workspace UI.";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

async function fixture(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_training_records_${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  const { workspaceId } = await createWorkspace({ name: `Training ${label}`, ownerAddress: identity.principalId });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
          VALUES (?, ?, 'member', ?)`,
    args: [workspaceId, MEMBER, NOW],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_oversight_attestations
          (attestation_id, workspace_id, account_address, competence_basis, training_records_json,
           authority_scope, attested_by, attested_at, expires_at, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'both', ?, ?, ?, 'active', ?, ?)`,
    args: [
      `ovat_training_${label}`,
      workspaceId,
      MEMBER,
      COMPETENCE_FREE_TEXT,
      JSON.stringify([
        { name: "Oversight calibration", completedAt: "2026-06-01T00:00:00.000Z", scope: "support-replies" },
        { name: "EU AI Act basics", completedAt: "2026-05-15T00:00:00.000Z", scope: "governance" },
      ]),
      identity.principalId,
      new Date("2026-06-15T00:00:00.000Z"),
      new Date("2027-06-15T00:00:00.000Z"),
      NOW,
      NOW,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_reviewer_qualifications
          (qualification_id, rater_id, reviewer_account_address, reviewer_source, qualification_kind,
           cohort_ids_json, qualification_keys_json, evidence_kind, workspace_id, evidence_reference_hash,
           qualification_value_json, verified_at, expires_at, status, created_at, updated_at)
          VALUES (?, NULL, ?, 'customer_invited', 'expertise', '[]', ?, 'owner_attested', ?, ?, '{}', ?, ?, 'active', ?, ?)`,
    args: [
      `qual_training_${label}`,
      REVIEWER,
      JSON.stringify(["expertise:legal_review", "expertise:customer_support"]),
      workspaceId,
      `sha256:${"a".repeat(64)}`,
      new Date("2026-06-20T00:00:00.000Z"),
      new Date("2027-06-20T00:00:00.000Z"),
      NOW,
      NOW,
    ],
  });
  return { identity, session, workspaceId };
}

test("training records export carries designations and qualifications as names, dates, and scopes", async () => {
  const setup = await fixture("shape");
  const exported = await exportTrainingRecords({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    now: NOW,
  });
  assert.equal(exported.schemaVersion, "rateloop.training-records.v1");
  assert.equal(exported.oversightPersons.length, 1);
  const person = exported.oversightPersons[0]!;
  assert.equal(person.role, "decision_owner");
  assert.equal(person.status, "active");
  assert.equal(person.authorityScope, "both");
  assert.deepEqual(person.trainingRecords, [
    { name: "Oversight calibration", completedAt: "2026-06-01T00:00:00.000Z", scope: "support-replies" },
    { name: "EU AI Act basics", completedAt: "2026-05-15T00:00:00.000Z", scope: "governance" },
  ]);
  assert.equal(exported.reviewerQualifications.length, 1);
  const qualification = exported.reviewerQualifications[0]!;
  assert.match(qualification.reviewerDigest, /^revr_[0-9a-f]{24}$/);
  assert.deepEqual(qualification.qualificationKeys, ["expertise:customer_support", "expertise:legal_review"]);
  assert.equal(qualification.evidenceKind, "owner_attested");
  assert.deepEqual(exported.counts, {
    oversightPersons: 1,
    activeOversightPersons: 1,
    reviewerQualifications: 1,
    activeReviewerQualifications: 1,
  });
  assert.match(exported.exportDigest, /^sha256:[0-9a-f]{64}$/);
  const audit = await dbClient.execute({
    sql: `SELECT action FROM tokenless_audit_events
          WHERE workspace_id = ? AND action = 'oversight.training_records_export'`,
    args: [setup.workspaceId],
  });
  assert.equal(audit.rows.length, 1);
});

test("no leakage: competence free text and reviewer identities never enter the export", async () => {
  const setup = await fixture("leakage");
  const exported = await exportTrainingRecords({
    accountAddress: setup.identity.principalId,
    workspaceId: setup.workspaceId,
    now: NOW,
  });
  const serialized = JSON.stringify(exported);
  assert.doesNotMatch(serialized, /never leave the workspace UI/u);
  assert.doesNotMatch(serialized, new RegExp(REVIEWER.slice(2), "iu"));
  // The oversight person is the workspace's own designated member — the
  // assignment record identifies them; reviewers stay digests.
  assert.match(serialized, new RegExp(MEMBER.slice(2), "iu"));
  // Claims discipline: the export never asserts legal compliance.
  assert.doesNotMatch(serialized, /compliant|satisfies article/iu);
});

test("only owners and admins export training records, via a no-store attachment route", async () => {
  const setup = await fixture("authz");
  await assert.rejects(
    exportTrainingRecords({ accountAddress: MEMBER, workspaceId: setup.workspaceId }),
    (error: TokenlessServiceError) => error.code === "workspace_not_found",
  );
  const context = { params: Promise.resolve({ workspaceId: setup.workspaceId }) };
  const request = (token: string | null = setup.session.token) =>
    new NextRequest(`${APP_ORIGIN}/api/account/workspaces/${setup.workspaceId}/oversight/training-records`, {
      headers: token ? { cookie: `${AUTH_SESSION_COOKIE}=${token}` } : {},
    });
  assert.equal((await GET(request(null), context)).status, 401);
  const response = await GET(request(), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
  const body = (await response.json()) as { schemaVersion: string };
  assert.equal(body.schemaVersion, "rateloop.training-records.v1");
});
