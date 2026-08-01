import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../drizzle/0176_benchmark_research_persistence.sql", import.meta.url),
  "utf8",
);

test("0176 persists every contractual benchmark-research boundary as append-only evidence", () => {
  for (const relation of [
    "tokenless_benchmark_activations",
    "tokenless_benchmark_research_agreement_acceptances",
    "tokenless_benchmark_research_approved_exports",
    "tokenless_benchmark_research_grants",
    "tokenless_benchmark_research_revocations",
    "tokenless_benchmark_research_access_snapshots",
    "tokenless_benchmark_research_access_audits",
    "tokenless_benchmark_research_denied_access_audits",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE "${relation}"`, "u"));
    assert.match(migration, new RegExp(`BEFORE UPDATE OR DELETE ON "${relation}"`, "u"));
  }
  assert.doesNotMatch(migration, /ON DELETE CASCADE/u);
});

test("0176 requires a manager-created exact offer and cannot activate reviewer-network work", () => {
  assert.match(migration, /CREATE TABLE "tokenless_benchmark_research_agreement_offers"/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "project_id", "benchmark_id", "agreement_id", "agreement_version",[\s\S]*?REFERENCES "tokenless_benchmark_research_agreement_offers"/u,
  );
  assert.match(migration, /FOREIGN KEY \("offered_by"\) REFERENCES "tokenless_principals"/u);
  assert.match(migration, /"activation_scope" = 'research_export_only'/u);
  assert.match(migration, /"network_release_authority" = 'none'/u);
});

test("0176 binds exports to one activation, frozen epoch and sample, label set, audit, and attestation", () => {
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "project_id", "benchmark_id", "activation_reference", "deployment_key",[\s\S]*?REFERENCES "tokenless_benchmark_activations"/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "epoch_id", "project_id", "benchmark_id", "activation_reference",[\s\S]*?REFERENCES "tokenless_dsa_reference_sampling_epochs"/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "epoch_id", "commitment_digest", "sample_digest", "manifest_root"\)[\s\S]*?REFERENCES "tokenless_dsa_reference_samples"/u,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "label_set_id", "epoch_id", "commitment_digest", "sample_digest",[\s\S]*?REFERENCES "tokenless_dsa_reference_label_sets"/u,
  );
  assert.match(migration, /REFERENCES "tokenless_audit_events" \("workspace_id", "event_id", "event_digest"\)/u);
  assert.match(migration, /"attestation_artifact_digest" = "audit_event_digest"/u);
});

test("0176 binds agreement, grant and authorization to exact recipients and database time", () => {
  assert.match(migration, /NEW\.accepted_at := date_trunc\('milliseconds', transaction_timestamp\(\)\)/u);
  assert.match(
    migration,
    /FOREIGN KEY \("workspace_id", "project_id", "benchmark_id", "agreement_id", "agreement_version",[\s\S]*?"recipient_principal_id", "purpose", "data_classification", "agreement_status", "access_basis",[\s\S]*?REFERENCES "tokenless_benchmark_research_agreement_acceptances"/u,
  );
  assert.match(migration, /"token_lookup_digest" ~ '\^hmac-sha256:/u);
  assert.match(migration, /UNIQUE \("token_lookup_digest"\)/u);
  assert.match(migration, /"expires_at" <= "issued_at" \+ interval '30 days'/u);
  assert.match(migration, /"data_classification" = 'public_safe'/u);
});

test("0176 preserves exact replay and commits every denial to the system security chain", () => {
  assert.match(migration, /PRIMARY KEY \("access_id"\)/u);
  assert.match(migration, /UNIQUE \("grant_lookup_digest", "recipient_lookup_digest", "idempotency_key"\)/u);
  assert.doesNotMatch(migration, /UNIQUE \("idempotency_key"\)/u);
  assert.match(migration, /"response_bytes" bytea NOT NULL/u);
  assert.match(migration, /"accessed_at" timestamp with time zone NOT NULL/u);
  assert.match(
    migration,
    /FOREIGN KEY \("security_scope_kind", "security_scope_id", "security_event_id", "security_event_digest"\)[\s\S]*?REFERENCES "tokenless_security_audit_events"/u,
  );
  assert.match(migration, /"security_scope_kind" = 'system'/u);
  assert.match(migration, /"security_scope_id" = 'benchmark-research-access'/u);
  assert.match(migration, /'idempotency_conflict'/u);
});

test("0176 recomputes every persisted content digest inside Postgres", () => {
  for (const [digestColumn, bytesColumn] of [
    ["activation_hash", "activation_json"],
    ["agreement_hash", "agreement_json"],
    ["export_digest", "export_json"],
    ["event_digest", "grant_json"],
    ["event_digest", "revocation_json"],
    ["request_binding_digest", "request_binding_json"],
    ["audit_digest", "audit_json"],
    ["denial_digest", "denial_json"],
  ]) {
    assert.match(
      migration,
      new RegExp(`"${digestColumn}" = 'sha256:' \\|\\| encode\\(digest\\(convert_to\\("${bytesColumn}"`, "u"),
    );
  }
  assert.match(migration, /"bytes_digest" = 'sha256:' \|\| encode\(digest\("response_bytes", 'sha256'\), 'hex'\)/u);
});

test("0176 allows the same idempotency key in different hash-only recipient scopes", () => {
  assert.match(migration, /UNIQUE \("grant_lookup_digest", "recipient_lookup_digest", "idempotency_key"\)/u);
  assert.match(
    migration,
    /FOREIGN KEY \("access_id", "grant_lookup_digest", "recipient_lookup_digest", "idempotency_key",/u,
  );
});

test("0176 is contractual public-safe research only", () => {
  assert.match(migration, /contractual_public_safe_benchmark_research/u);
  assert.doesNotMatch(migration, /article.?40/iu);
  assert.doesNotMatch(migration, /operational|adaptive/iu);
});
