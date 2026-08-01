import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0175_project_window_compliance_shares.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(new URL("../tokenless/projectWindowComplianceShares.ts", import.meta.url), "utf8");

test("0175 is a new project/window share and leaves immutable single-packet grants alone", () => {
  assert.match(migration, /CREATE TABLE "tokenless_project_window_compliance_shares"/u);
  assert.doesNotMatch(migration, /ALTER TABLE "tokenless_assurance_evidence_share_grants"/u);
  assert.doesNotMatch(migration, /UPDATE "?tokenless_assurance_evidence_share_grants/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "project_id"\)[\s\S]*?REFERENCES "tokenless_assurance_projects" \("workspace_id", "project_id"\)/u,
  );
  assert.match(migration, /"evidence_window_end" > "evidence_window_start"/u);
  assert.match(migration, /"expires_at" <= "issued_at" \+ interval '30 days'/u);
  assert.match(migration, /'not_benchmark_research_or_article_40_access'/u);
});

test("0175 uses separate exact packet and exact 0174 report bindings without a polymorphic source FK", () => {
  assert.match(migration, /CREATE TABLE "tokenless_project_window_share_evidence_packets"/u);
  assert.match(migration, /CREATE TABLE "tokenless_project_window_share_report_versions"/u);
  assert.match(
    migration,
    /FOREIGN KEY \("run_id", "packet_id", "packet_digest", "generated_at"\)[\s\S]*?REFERENCES "tokenless_assurance_evidence_packets" \("run_id", "packet_id", "packet_digest", "generated_at"\)/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "report_id", "report_version", "report_digest"\)[\s\S]*?REFERENCES "tokenless_dsa_part8_report_versions"[\s\S]*?\("workspace_id", "report_id", "report_version", "report_digest"\)/u,
  );
  assert.doesNotMatch(
    migration,
    /FOREIGN KEY \([^)]*artifact_kind[^)]*\)[\s\S]{0,200}REFERENCES "tokenless_(?:assurance_evidence_packets|dsa_part8_report_versions)"/u,
  );
});

test("0175 makes grant, bindings, revocation, access, and denial replay append-only and complete", () => {
  for (const table of [
    "tokenless_project_window_compliance_shares",
    "tokenless_project_window_compliance_share_artifacts",
    "tokenless_project_window_share_evidence_packets",
    "tokenless_project_window_share_report_versions",
    "tokenless_project_window_compliance_share_revocations",
    "tokenless_project_window_compliance_share_access_events",
    "tokenless_project_window_compliance_share_access_snapshots",
  ]) {
    assert.match(migration, new RegExp(`${table.replaceAll("_", "_")}.*append_only`, "u"));
  }
  assert.match(migration, /DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(migration, /project-window share manifest is incomplete/u);
  assert.match(migration, /project-window artifact lacks one exact typed binding/u);
  assert.match(migration, /project-window access snapshot has an invalid typed artifact binding/u);
  assert.match(migration, /project-window access event lacks one terminal replay snapshot/u);
  assert.match(migration, /"result" = 'denied'/u);
});

test("0175 scopes replay by secret-derived identity and SQL forbids duplicate terminal access events", () => {
  assert.match(migration, /UNIQUE \("share_lookup_hash", "token_lookup_hash", "idempotency_key"\)/u);
  assert.doesNotMatch(migration, /"idempotency_key" text NOT NULL UNIQUE/u);
  assert.match(migration, /UNIQUE \("access_id"\)/u);
  assert.match(service, /from "~~\/lib\/db\/advisoryLocks"/u);
  assert.match(service, /acquireTransactionAdvisoryLock\(client, identity\.accessId\)/u);
  assert.match(service, /sha256Rfc8785\(\{ shareLookupHash, tokenLookupHash, idempotencyKey:/u);
});

test("bearer material is hash-only and invalid-token denials stay workspace-neutral", () => {
  assert.match(migration, /"token_hash" text NOT NULL/u);
  assert.doesNotMatch(migration, /"(?:bearer_secret|raw_token|access_token|secret)"/iu);
  const accessEvents = migration.slice(
    migration.indexOf('CREATE TABLE "tokenless_project_window_compliance_share_access_events"'),
    migration.indexOf('CREATE TABLE "tokenless_project_window_compliance_share_access_snapshots"'),
  );
  assert.doesNotMatch(accessEvents, /"workspace_id"|"project_id"|"share_id"/u);
  assert.match(service, /if \(!SHARE_ID\.test\(presentedShareId\)[\s\S]*?return deny\("not_found"\)/u);
});

test("manager-only issue and revoke use active tenant/project authorization", () => {
  assert.match(service, /m\.role IN \('owner','admin'\)/u);
  assert.match(service, /p\.status='active'/u);
  assert.match(service, /issueProjectWindowComplianceShare/u);
  assert.match(service, /revokeProjectWindowComplianceShare/u);
  assert.doesNotMatch(service, /m\.role IN \([^)]*auditor/u);
});

test("packet disclosure verifies the bound signing key, key ID, signature, digest, and source identity", () => {
  assert.match(service, /verifyEvidenceExport\(packet,[\s\S]*?expectedPublicKey:[\s\S]*?expectedKeyId:/u);
  assert.match(service, /payload\.packetId !== input\.packetId/u);
  assert.match(service, /payload\.runId !== input\.runId/u);
  assert.match(service, /record\.packetDigest !== input\.packetDigest/u);
  assert.match(service, /signing\.algorithm !== input\.signingAlgorithm/u);
  assert.match(service, /JSON\.stringify\(packet\) !== input\.packetJson/u);
});
