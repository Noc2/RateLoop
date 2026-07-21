import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0131_workspace_reviewer_policy_acceptances.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

test("0131 binds private policy acceptance to exact workspace reviewer grants", () => {
  const journalEntry = journal.entries.find(entry => entry.idx === 131);
  assert.equal(journalEntry?.idx, 131);
  assert.equal(journalEntry?.tag, "0131_workspace_reviewer_policy_acceptances");
  assert.match(migration, /DROP CONSTRAINT "tokenless_private_group_policy_acceptances_membership_fk"/u);
  assert.match(migration, /DROP CONSTRAINT "tokenless_private_unpaid_review_assignments_membership_fk"/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "workspace_reviewer_access_grant_id", "workspace_reviewer_access_grant_hash"\)/u,
  );
  assert.match(
    migration,
    /REFERENCES "tokenless_workspace_reviewer_access_grants"\("workspace_id", "grant_id", "grant_hash"\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("people_invitation_id", "workspace_id"\)\s+REFERENCES "tokenless_workspace_reviewer_invitations"\("invitation_id", "workspace_id"\)/u,
  );
  assert.match(
    migration,
    /SET "people_invitation_id" = NULL[\s\S]+NOT EXISTS[\s\S]+"tokenless_workspace_reviewer_invitations"/u,
  );
});
