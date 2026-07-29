import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0162_evidence_share_grants.sql", import.meta.url), "utf8");
const model = readFileSync(new URL("./humanAssuranceSchema.ts", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ breakpoints: boolean; idx: number; tag: string; version: string; when: number }>;
};

test("0162 narrows hash-only evidence shares through every tenant and record boundary", () => {
  assert.match(migration, /CREATE TABLE "tokenless_assurance_evidence_share_grants"/u);
  assert.match(migration, /"token_hash" text NOT NULL UNIQUE/u);
  assert.match(migration, /CHECK \("token_hash" ~ '\^sha256:\[0-9a-f\]\{64\}\$'\)/u);
  assert.doesNotMatch(migration, /bearer_secret|raw_token|secret"/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id","project_id"\)[\s\S]*REFERENCES "tokenless_assurance_projects"\("workspace_id","project_id"\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("project_id","run_id"\)[\s\S]*REFERENCES "tokenless_assurance_runs"\("project_id","run_id"\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("run_id","packet_id"\)[\s\S]*REFERENCES "tokenless_assurance_evidence_packets"\("run_id","packet_id"\)/u,
  );
  assert.match(migration, /"expires_at" > "created_at"/u);
  assert.match(migration, /"revoked_at" IS NULL OR "revoked_at" >= "created_at"/u);
  assert.match(migration, /WHERE "revoked_at" IS NULL/u);
  assert.match(model, /export const tokenlessAssuranceEvidenceShareGrants = pgTable/u);
  assert.match(model, /workspaceProjectFk: foreignKey/u);
  assert.match(model, /projectRunFk: foreignKey/u);
  assert.match(model, /runPacketFk: foreignKey/u);
  assert.match(model, /tokenHash: text\("token_hash"\)\.notNull\(\)\.unique\(\)/u);
  assert.deepEqual(journal.entries.at(-1), {
    idx: 162,
    version: "7",
    when: 1785232800000,
    tag: "0162_evidence_share_grants",
    breakpoints: true,
  });
});
