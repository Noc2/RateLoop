import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0130_workspace_reviewer_roster.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0130 registers the workspace reviewer roster before the current migration journal head", () => {
  assert.deepEqual(
    journal.entries.find(entry => entry.idx === 130),
    {
      idx: 130,
      version: "7",
      when: 1784408400000,
      tag: "0130_workspace_reviewer_roster",
      breakpoints: true,
    },
  );
});

test("0130 keeps workspace membership and reviewer authority independent", () => {
  assert.match(migration, /CREATE TABLE "tokenless_workspace_reviewers"/u);
  assert.match(migration, /CREATE TABLE "tokenless_workspace_reviewer_invitations"/u);
  assert.match(migration, /CREATE TABLE "tokenless_workspace_reviewer_access_grants"/u);
  assert.match(migration, /CREATE TABLE "tokenless_workspace_reviewer_invitation_redemptions"/u);
  assert.doesNotMatch(migration, /INSERT INTO "tokenless_workspace_members"/u);
  assert.match(migration, /Preserve every existing reviewer entitlement as an independent immutable grant/u);
});

test("0130 snapshots exact reviewer grants and terms on assignment records", () => {
  assert.match(migration, /UNIQUE \("workspace_id", "grant_id", "grant_hash"\)/u);
  assert.match(migration, /UNIQUE \("workspace_id", "version", "terms_hash"\)/u);
  for (const table of ["tokenless_assurance_assignments", "tokenless_private_unpaid_review_assignments"]) {
    const start = migration.indexOf(`ALTER TABLE "${table}"`);
    assert.ok(start >= 0, `${table} is migrated`);
    const statementEnd = migration.indexOf("--> statement-breakpoint", start);
    const statement = migration.slice(start, statementEnd < 0 ? migration.length : statementEnd);
    assert.match(statement, /ADD COLUMN "workspace_reviewer_access_grant_id" text/u);
    assert.match(statement, /ADD COLUMN "workspace_reviewer_access_grant_hash" text/u);
    assert.match(
      statement,
      /REFERENCES "tokenless_workspace_reviewer_access_grants"\("workspace_id", "grant_id", "grant_hash"\)/u,
    );
  }
  assert.match(
    migration,
    /REFERENCES "tokenless_workspace_reviewer_terms_versions"\("workspace_id", "version", "terms_hash"\)/u,
  );
});

test("0130 binds invitation, grant, project, and redemption records to one workspace", () => {
  assert.match(migration, /UNIQUE \("invitation_id", "workspace_id"\)/u);
  assert.match(
    migration,
    /FOREIGN KEY \("invitation_id", "workspace_id"\)\s+REFERENCES "tokenless_workspace_reviewer_invitations"\("invitation_id", "workspace_id"\)/u,
  );
  assert.match(migration, /UNIQUE \("grant_id", "workspace_id"\)/u);
  assert.match(
    migration,
    /FOREIGN KEY \("grant_id", "workspace_id"\)\s+REFERENCES "tokenless_workspace_reviewer_access_grants"\("grant_id", "workspace_id"\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("invitation_id", "grant_id"\)\s+REFERENCES "tokenless_workspace_reviewer_access_grants"\("source_invitation_id", "grant_id"\)/u,
  );
});

test("0130 fails closed instead of silently losing unmapped legacy reviewers", () => {
  assert.match(migration, /LEFT JOIN "tokenless_principals" principal/u);
  assert.match(migration, /principal\."principal_id" IS NULL/u);
  assert.match(migration, /RAISE EXCEPTION/u);
  assert.match(migration, /resolve legacy identities first/u);
  assert.match(migration, /one grant per legacy membership/u);
  assert.match(migration, /l\."workspace_id" \|\| '\|' \|\| l\."group_id"/u);
});

test("0130 constrains reviewer lifecycle, scope, sensitivity, hashes, and invitation use", () => {
  assert.match(migration, /"status" IN \('active', 'removed', 'left', 'expired'\)/u);
  assert.match(migration, /"project_scope" IN \('all', 'selected'\)/u);
  assert.match(migration, /"max_private_sensitivity" IN \('internal', 'confidential', 'restricted', 'regulated'\)/u);
  assert.match(migration, /"grant_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /"maximum_redemptions" BETWEEN 1 AND 1000/u);
  assert.match(migration, /"redemption_count" BETWEEN 0 AND "maximum_redemptions"/u);
  assert.match(migration, /PRIMARY KEY \("invitation_id", "principal_address"\)/u);
});

test("0130 preserves legacy member invitations while assigning new invitation namespaces", () => {
  assert.match(migration, /ALTER COLUMN "governance_role" DROP NOT NULL/u);
  assert.match(migration, /ADD COLUMN "token_prefix" text/u);
  assert.match(migration, /ADD COLUMN "intended_email_hash" text/u);
  assert.match(migration, /"governance_role" IS NULL/u);
});

test("0130 keeps explicit constraint and index names within PostgreSQL's identifier limit", () => {
  const identifiers = [
    ...[...migration.matchAll(/(?:ADD )?CONSTRAINT "([^"]+)"/gu)].map(match => match[1]!),
    ...[...migration.matchAll(/CREATE (?:UNIQUE )?INDEX "([^"]+)"/gu)].map(match => match[1]!),
  ];
  assert.ok(identifiers.length > 0);
  for (const identifier of identifiers) {
    assert.ok(Buffer.byteLength(identifier, "utf8") <= 63, `${identifier} exceeds PostgreSQL's 63-byte limit`);
  }
});
