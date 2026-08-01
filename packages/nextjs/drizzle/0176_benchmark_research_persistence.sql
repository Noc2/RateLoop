ALTER TABLE "tokenless_dsa_reference_sampling_epochs"
  ADD CONSTRAINT "tokenless_dsa_reference_epochs_research_binding_unique"
  UNIQUE ("workspace_id", "epoch_id", "project_id", "benchmark_id", "activation_reference",
          "deployment_key", "commitment_digest");--> statement-breakpoint
ALTER TABLE "tokenless_dsa_reference_label_sets"
  ADD CONSTRAINT "tokenless_dsa_reference_label_sets_research_binding_unique"
  UNIQUE ("workspace_id", "label_set_id", "epoch_id", "commitment_digest", "sample_digest",
          "manifest_root", "label_root", "set_hash");--> statement-breakpoint
ALTER TABLE "tokenless_security_audit_events"
  ADD CONSTRAINT "tokenless_security_audit_events_research_binding_unique"
  UNIQUE ("scope_kind", "scope_id", "event_id", "event_digest");--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_reject_benchmark_research_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'benchmark research evidence is append-only'
    USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION tokenless_set_benchmark_research_agreement_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.accepted_at := date_trunc('milliseconds', transaction_timestamp());
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TABLE "tokenless_benchmark_activations" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "deployment_key" text NOT NULL,
  "status" text NOT NULL,
  "public_safe_only" boolean NOT NULL,
  "access_class" text NOT NULL,
  "activation_scope" text NOT NULL,
  "network_release_authority" text NOT NULL,
  "activation_json" text NOT NULL,
  "activation_hash" text NOT NULL,
  "activated_by" text NOT NULL,
  "activated_at" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "tokenless_benchmark_activations_pk"
    PRIMARY KEY ("workspace_id", "activation_reference"),
  CONSTRAINT "tokenless_benchmark_activations_exact_unique"
    UNIQUE ("workspace_id", "project_id", "benchmark_id", "activation_reference", "deployment_key",
            "status", "public_safe_only"),
  CONSTRAINT "tokenless_benchmark_activations_project_fk"
    FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects" ("workspace_id", "project_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_activations_actor_fk"
    FOREIGN KEY ("activated_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_activations_contract_check" CHECK (
    "benchmark_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "activation_reference" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "deployment_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "status" = 'active'
    AND "public_safe_only" = true
    AND "access_class" = 'contractual_public_safe_benchmark_research'
    AND "activation_scope" = 'research_export_only'
    AND "network_release_authority" = 'none'
    AND "activation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "activation_hash" = 'sha256:' || encode(digest(convert_to("activation_json", 'UTF8'), 'sha256'), 'hex')
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_benchmark_research_agreement_offers" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "agreement_id" text NOT NULL,
  "agreement_version" integer NOT NULL,
  "recipient_principal_id" text NOT NULL,
  "purpose" text NOT NULL,
  "data_classification" text NOT NULL,
  "status" text NOT NULL,
  "access_basis" text NOT NULL,
  "offer_json" text NOT NULL,
  "offer_hash" text NOT NULL,
  "offered_by" text NOT NULL,
  "offered_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_benchmark_research_agreement_offers_pk"
    PRIMARY KEY ("workspace_id", "agreement_id", "agreement_version"),
  CONSTRAINT "tokenless_benchmark_research_agreement_offers_exact_unique"
    UNIQUE ("workspace_id", "project_id", "benchmark_id", "agreement_id", "agreement_version",
            "recipient_principal_id", "purpose", "data_classification", "status", "access_basis", "offer_hash"),
  CONSTRAINT "tokenless_benchmark_research_agreement_offers_project_fk"
    FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects" ("workspace_id", "project_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_agreement_offers_recipient_fk"
    FOREIGN KEY ("recipient_principal_id") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_agreement_offers_manager_fk"
    FOREIGN KEY ("offered_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_agreement_offers_contract_check" CHECK (
    "agreement_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "agreement_version" > 0
    AND "purpose" IN ('methodology_validation', 'sample_reproduction', 'reference_label_analysis')
    AND "data_classification" = 'public_safe'
    AND "status" = 'offered'
    AND "access_basis" = 'accepted_contractual_public_safe_benchmark_agreement'
    AND "offer_hash" = 'sha256:' || encode(digest(convert_to("offer_json", 'UTF8'), 'sha256'), 'hex')
    AND "expires_at" > "offered_at"
    AND "expires_at" <= "offered_at" + interval '30 days'
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_benchmark_research_agreement_acceptances" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "agreement_id" text NOT NULL,
  "agreement_version" integer NOT NULL,
  "recipient_principal_id" text NOT NULL,
  "purpose" text NOT NULL,
  "data_classification" text NOT NULL,
  "status" text NOT NULL,
  "access_basis" text NOT NULL,
  "offer_status" text NOT NULL,
  "offer_hash" text NOT NULL,
  "agreement_json" text NOT NULL,
  "agreement_hash" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "tokenless_benchmark_research_agreement_acceptances_pk"
    PRIMARY KEY ("workspace_id", "agreement_id", "agreement_version"),
  CONSTRAINT "tokenless_benchmark_research_agreements_scope_unique"
    UNIQUE ("workspace_id", "recipient_principal_id", "project_id", "benchmark_id", "purpose",
            "agreement_id", "agreement_version"),
  CONSTRAINT "tokenless_benchmark_research_agreements_exact_unique"
    UNIQUE ("workspace_id", "project_id", "benchmark_id", "agreement_id", "agreement_version",
            "recipient_principal_id", "purpose", "data_classification", "status", "access_basis", "accepted_at"),
  CONSTRAINT "tokenless_benchmark_research_agreements_project_fk"
    FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects" ("workspace_id", "project_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_agreements_recipient_fk"
    FOREIGN KEY ("recipient_principal_id") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_agreements_offer_fk"
    FOREIGN KEY ("workspace_id", "project_id", "benchmark_id", "agreement_id", "agreement_version",
                 "recipient_principal_id", "purpose", "data_classification", "offer_status", "access_basis", "offer_hash")
    REFERENCES "tokenless_benchmark_research_agreement_offers"
      ("workspace_id", "project_id", "benchmark_id", "agreement_id", "agreement_version",
       "recipient_principal_id", "purpose", "data_classification", "status", "access_basis", "offer_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_agreements_contract_check" CHECK (
    "benchmark_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "agreement_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "agreement_version" > 0
    AND "purpose" IN ('methodology_validation', 'sample_reproduction', 'reference_label_analysis')
    AND "data_classification" = 'public_safe'
    AND "status" = 'accepted'
    AND "offer_status" = 'offered'
    AND "access_basis" = 'accepted_contractual_public_safe_benchmark_agreement'
    AND "agreement_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "offer_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "agreement_hash" = 'sha256:' || encode(digest(convert_to("agreement_json", 'UTF8'), 'sha256'), 'hex')
  )
);--> statement-breakpoint
CREATE TRIGGER tokenless_benchmark_research_agreements_database_time
BEFORE INSERT ON "tokenless_benchmark_research_agreement_acceptances"
FOR EACH ROW EXECUTE FUNCTION tokenless_set_benchmark_research_agreement_time();--> statement-breakpoint

CREATE TABLE "tokenless_benchmark_research_approved_exports" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "deployment_key" text NOT NULL,
  "export_id" text NOT NULL,
  "schema_version" text NOT NULL,
  "approval_id" text NOT NULL,
  "approval_status" text NOT NULL,
  "data_classification" text NOT NULL,
  "activation_status" text NOT NULL,
  "public_safe_only" boolean NOT NULL,
  "derivation" text NOT NULL,
  "epoch_id" text NOT NULL,
  "commitment_digest" text NOT NULL,
  "sample_digest" text NOT NULL,
  "manifest_root" text NOT NULL,
  "label_set_id" text NOT NULL,
  "label_root" text NOT NULL,
  "label_set_hash" text NOT NULL,
  "audit_event_id" text NOT NULL,
  "audit_event_digest" text NOT NULL,
  "attestation_job_id" text NOT NULL,
  "attestation_artifact_kind" text NOT NULL,
  "attestation_artifact_digest" text NOT NULL,
  "export_json" text NOT NULL,
  "export_digest" text NOT NULL,
  "approved_by" text NOT NULL,
  "approved_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_benchmark_research_approved_exports_pk"
    PRIMARY KEY ("workspace_id", "export_id"),
  CONSTRAINT "tokenless_benchmark_research_approved_exports_exact_unique"
    UNIQUE ("workspace_id", "export_id", "export_digest", "project_id", "benchmark_id",
            "activation_reference", "deployment_key"),
  CONSTRAINT "tokenless_benchmark_research_exports_activation_fk"
    FOREIGN KEY ("workspace_id", "project_id", "benchmark_id", "activation_reference", "deployment_key",
                 "activation_status", "public_safe_only")
    REFERENCES "tokenless_benchmark_activations"
      ("workspace_id", "project_id", "benchmark_id", "activation_reference", "deployment_key",
       "status", "public_safe_only") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_exports_epoch_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "project_id", "benchmark_id", "activation_reference",
                 "deployment_key", "commitment_digest")
    REFERENCES "tokenless_dsa_reference_sampling_epochs"
      ("workspace_id", "epoch_id", "project_id", "benchmark_id", "activation_reference",
       "deployment_key", "commitment_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_exports_sample_fk"
    FOREIGN KEY ("workspace_id", "epoch_id", "commitment_digest", "sample_digest", "manifest_root")
    REFERENCES "tokenless_dsa_reference_samples"
      ("workspace_id", "epoch_id", "commitment_digest", "sample_digest", "manifest_root") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_exports_label_set_fk"
    FOREIGN KEY ("workspace_id", "label_set_id", "epoch_id", "commitment_digest", "sample_digest",
                 "manifest_root", "label_root", "label_set_hash")
    REFERENCES "tokenless_dsa_reference_label_sets"
      ("workspace_id", "label_set_id", "epoch_id", "commitment_digest", "sample_digest",
       "manifest_root", "label_root", "set_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_exports_audit_fk"
    FOREIGN KEY ("workspace_id", "audit_event_id", "audit_event_digest")
    REFERENCES "tokenless_audit_events" ("workspace_id", "event_id", "event_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_exports_attestation_fk"
    FOREIGN KEY ("workspace_id", "attestation_job_id", "attestation_artifact_kind",
                 "attestation_artifact_digest")
    REFERENCES "tokenless_assurance_attestation_jobs"
      ("workspace_id", "job_id", "artifact_kind", "artifact_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_exports_approver_fk"
    FOREIGN KEY ("approved_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_exports_contract_check" CHECK (
    "schema_version" = 'rateloop.approved-public-safe-reference-export.v1'
    AND "approval_status" = 'approved_immutable'
    AND "data_classification" = 'public_safe'
    AND "activation_status" = 'active'
    AND "public_safe_only" = true
    AND "derivation" = 'verified_committed_and_frozen_reference_sample'
    AND "epoch_id" ~ '^rse_[0-9a-f]{40}$'
    AND "label_set_id" ~ '^rsls_[0-9a-f]{40}$'
    AND "commitment_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "sample_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "manifest_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "label_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "label_set_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "audit_event_id" ~ '^audit_[0-9a-f]{32}$'
    AND "audit_event_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "attestation_job_id" ~ '^aat_[0-9a-f]{40}$'
    AND "attestation_artifact_kind" = 'audit_export_head'
    AND "attestation_artifact_digest" = "audit_event_digest"
    AND "export_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "export_digest" = 'sha256:' || encode(digest(convert_to("export_json", 'UTF8'), 'sha256'), 'hex')
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_benchmark_research_grants" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "activation_reference" text NOT NULL,
  "deployment_key" text NOT NULL,
  "grant_id" text NOT NULL,
  "schema_version" text NOT NULL,
  "export_id" text NOT NULL,
  "export_digest" text NOT NULL,
  "agreement_id" text NOT NULL,
  "agreement_version" integer NOT NULL,
  "agreement_accepted_at" timestamp with time zone NOT NULL,
  "recipient_principal_id" text NOT NULL,
  "purpose" text NOT NULL,
  "scopes_json" text NOT NULL,
  "data_classification" text NOT NULL,
  "agreement_status" text NOT NULL,
  "access_basis" text NOT NULL,
  "access_class" text NOT NULL,
  "token_lookup_key_id" text NOT NULL,
  "token_lookup_digest" text NOT NULL,
  "recipient_binding_key_id" text NOT NULL,
  "recipient_binding_digest" text NOT NULL,
  "authorization_digest" text NOT NULL,
  "grant_json" text NOT NULL,
  "event_digest" text NOT NULL,
  "authorized_by" text NOT NULL,
  "issued_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_benchmark_research_grants_pk" PRIMARY KEY ("grant_id"),
  CONSTRAINT "tokenless_benchmark_research_grants_token_lookup_unique" UNIQUE ("token_lookup_digest"),
  CONSTRAINT "tokenless_benchmark_research_grants_exact_unique"
    UNIQUE ("workspace_id", "grant_id", "event_digest", "export_id", "export_digest",
            "recipient_principal_id", "recipient_binding_digest", "authorization_digest", "purpose", "scopes_json",
            "project_id", "benchmark_id"),
  CONSTRAINT "tokenless_benchmark_research_grants_revocation_binding_unique"
    UNIQUE ("workspace_id", "grant_id", "event_digest"),
  CONSTRAINT "tokenless_benchmark_research_grants_export_fk"
    FOREIGN KEY ("workspace_id", "export_id", "export_digest", "project_id", "benchmark_id",
                 "activation_reference", "deployment_key")
    REFERENCES "tokenless_benchmark_research_approved_exports"
      ("workspace_id", "export_id", "export_digest", "project_id", "benchmark_id",
       "activation_reference", "deployment_key") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_grants_agreement_fk"
    FOREIGN KEY ("workspace_id", "project_id", "benchmark_id", "agreement_id", "agreement_version",
                 "recipient_principal_id", "purpose", "data_classification", "agreement_status", "access_basis",
                 "agreement_accepted_at")
    REFERENCES "tokenless_benchmark_research_agreement_acceptances"
      ("workspace_id", "project_id", "benchmark_id", "agreement_id", "agreement_version",
       "recipient_principal_id", "purpose", "data_classification", "status", "access_basis", "accepted_at")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_grants_authorizer_fk"
    FOREIGN KEY ("authorized_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_grants_contract_check" CHECK (
    "grant_id" ~ '^brg_[A-Za-z0-9_-]{22}$'
    AND "schema_version" = 'rateloop.benchmark-research-grant-event.v2'
    AND "agreement_version" > 0
    AND "purpose" IN ('methodology_validation', 'sample_reproduction', 'reference_label_analysis')
    AND "data_classification" = 'public_safe'
    AND "agreement_status" = 'accepted'
    AND "access_basis" = 'accepted_contractual_public_safe_benchmark_agreement'
    AND "access_class" = 'contractual_public_safe_benchmark_research'
    AND "token_lookup_key_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "token_lookup_digest" ~ '^hmac-sha256:[0-9a-f]{64}$'
    AND "recipient_binding_key_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'
    AND "recipient_binding_digest" ~ '^hmac-sha256:[0-9a-f]{64}$'
    AND "authorization_digest" ~ '^hmac-sha256:[0-9a-f]{64}$'
    AND "event_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "event_digest" = 'sha256:' || encode(digest(convert_to("grant_json", 'UTF8'), 'sha256'), 'hex')
    AND "agreement_accepted_at" <= "issued_at"
    AND "expires_at" > "issued_at"
    AND "expires_at" <= "issued_at" + interval '30 days'
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_benchmark_research_revocations" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "grant_id" text NOT NULL,
  "grant_event_digest" text NOT NULL,
  "schema_version" text NOT NULL,
  "reason" text NOT NULL,
  "revocation_json" text NOT NULL,
  "event_digest" text NOT NULL,
  "revoked_by" text NOT NULL,
  "revoked_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_benchmark_research_revocations_pk" PRIMARY KEY ("grant_id"),
  CONSTRAINT "tokenless_benchmark_research_revocations_grant_fk"
    FOREIGN KEY ("workspace_id", "grant_id", "grant_event_digest")
    REFERENCES "tokenless_benchmark_research_grants" ("workspace_id", "grant_id", "event_digest")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_revocations_actor_fk"
    FOREIGN KEY ("revoked_by") REFERENCES "tokenless_principals" ("principal_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_revocations_contract_check" CHECK (
    "schema_version" = 'rateloop.benchmark-research-grant-event.v2'
    AND "reason" IN ('recipient_request', 'scope_withdrawn', 'security_response', 'grant_replaced')
    AND "grant_event_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "event_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "event_digest" = 'sha256:' || encode(digest(convert_to("revocation_json", 'UTF8'), 'sha256'), 'hex')
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_benchmark_research_access_audits" (
  "access_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "benchmark_id" text NOT NULL,
  "grant_id" text NOT NULL,
  "grant_event_digest" text NOT NULL,
  "export_id" text NOT NULL,
  "export_digest" text NOT NULL,
  "recipient_principal_id" text NOT NULL,
  "recipient_binding_digest" text NOT NULL,
  "authorization_digest" text NOT NULL,
  "grant_lookup_digest" text NOT NULL,
  "recipient_lookup_digest" text NOT NULL,
  "purpose" text NOT NULL,
  "scopes_json" text NOT NULL,
  "projection" text NOT NULL,
  "request_binding_json" text NOT NULL,
  "request_binding_digest" text NOT NULL,
  "components_json" text NOT NULL,
  "view_digest" text NOT NULL,
  "accessed_at" timestamp with time zone NOT NULL,
  "audit_json" text NOT NULL,
  "audit_digest" text NOT NULL,
  "audit_event_id" text NOT NULL,
  "audit_event_digest" text NOT NULL,
  "previous_event_digest" text NOT NULL,
  "chain_head_digest" text NOT NULL,
  CONSTRAINT "tokenless_benchmark_research_access_audits_pk" PRIMARY KEY ("access_id"),
  CONSTRAINT "tokenless_benchmark_research_access_audits_idempotency_unique"
    UNIQUE ("grant_lookup_digest", "recipient_lookup_digest", "idempotency_key"),
  CONSTRAINT "tokenless_benchmark_research_access_audits_exact_unique"
    UNIQUE ("access_id", "grant_lookup_digest", "recipient_lookup_digest", "idempotency_key",
            "request_binding_digest", "audit_digest",
            "audit_event_id", "audit_event_digest"),
  CONSTRAINT "tokenless_benchmark_research_access_audits_grant_fk"
    FOREIGN KEY ("workspace_id", "grant_id", "grant_event_digest", "export_id", "export_digest",
                 "recipient_principal_id", "recipient_binding_digest", "authorization_digest", "purpose",
                 "scopes_json", "project_id", "benchmark_id")
    REFERENCES "tokenless_benchmark_research_grants"
      ("workspace_id", "grant_id", "event_digest", "export_id", "export_digest",
       "recipient_principal_id", "recipient_binding_digest", "authorization_digest", "purpose",
       "scopes_json", "project_id", "benchmark_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_access_audits_audit_fk"
    FOREIGN KEY ("workspace_id", "audit_event_id", "audit_event_digest")
    REFERENCES "tokenless_audit_events" ("workspace_id", "event_id", "event_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_access_audits_contract_check" CHECK (
    "access_id" ~ '^bra_[A-Za-z0-9_-]{22}$'
    AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
    AND "purpose" IN ('methodology_validation', 'sample_reproduction', 'reference_label_analysis')
    AND "projection" IN ('methodology_summary', 'reference_sample_evidence', 'reference_labels')
    AND "recipient_binding_digest" ~ '^hmac-sha256:[0-9a-f]{64}$'
    AND "authorization_digest" ~ '^hmac-sha256:[0-9a-f]{64}$'
    AND "grant_lookup_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "recipient_lookup_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_binding_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_binding_digest" = 'sha256:' || encode(digest(convert_to("request_binding_json", 'UTF8'), 'sha256'), 'hex')
    AND "view_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "audit_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "audit_digest" = 'sha256:' || encode(digest(convert_to("audit_json", 'UTF8'), 'sha256'), 'hex')
    AND "audit_event_id" ~ '^audit_[0-9a-f]{32}$'
    AND "audit_event_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "previous_event_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "chain_head_digest" = "audit_event_digest"
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_benchmark_research_access_snapshots" (
  "access_id" text NOT NULL,
  "grant_lookup_digest" text NOT NULL,
  "recipient_lookup_digest" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_binding_json" text NOT NULL,
  "request_binding_digest" text NOT NULL,
  "accessed_at" timestamp with time zone NOT NULL,
  "view_digest" text NOT NULL,
  "bytes_digest" text NOT NULL,
  "response_bytes" bytea NOT NULL,
  "audit_digest" text NOT NULL,
  "audit_event_id" text NOT NULL,
  "audit_event_digest" text NOT NULL,
  "previous_event_digest" text NOT NULL,
  "chain_head_digest" text NOT NULL,
  CONSTRAINT "tokenless_benchmark_research_access_snapshots_pk" PRIMARY KEY ("access_id"),
  CONSTRAINT "tokenless_benchmark_research_access_snapshots_idempotency_unique"
    UNIQUE ("grant_lookup_digest", "recipient_lookup_digest", "idempotency_key"),
  CONSTRAINT "tokenless_benchmark_research_access_snapshots_audit_fk"
    FOREIGN KEY ("access_id", "grant_lookup_digest", "recipient_lookup_digest", "idempotency_key",
                 "request_binding_digest", "audit_digest",
                 "audit_event_id", "audit_event_digest")
    REFERENCES "tokenless_benchmark_research_access_audits"
      ("access_id", "grant_lookup_digest", "recipient_lookup_digest", "idempotency_key",
       "request_binding_digest", "audit_digest",
       "audit_event_id", "audit_event_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_access_snapshots_contract_check" CHECK (
    "access_id" ~ '^bra_[A-Za-z0-9_-]{22}$'
    AND "grant_lookup_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "recipient_lookup_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
    AND "request_binding_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_binding_digest" = 'sha256:' || encode(digest(convert_to("request_binding_json", 'UTF8'), 'sha256'), 'hex')
    AND "view_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "bytes_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "bytes_digest" = 'sha256:' || encode(digest("response_bytes", 'sha256'), 'hex')
    AND octet_length("response_bytes") > 0
    AND "audit_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "audit_event_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "previous_event_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "chain_head_digest" = "audit_event_digest"
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_benchmark_research_denied_access_audits" (
  "denial_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text,
  "access_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_lookup_digest" text NOT NULL,
  "grant_lookup_digest" text NOT NULL,
  "recipient_lookup_digest" text NOT NULL,
  "page_offset" integer NOT NULL,
  "page_limit" integer NOT NULL,
  "reason" text NOT NULL,
  "denial_json" text NOT NULL,
  "denial_digest" text NOT NULL,
  "security_scope_kind" text NOT NULL,
  "security_scope_id" text NOT NULL,
  "security_event_id" text NOT NULL,
  "security_event_digest" text NOT NULL,
  "previous_event_digest" text NOT NULL,
  "chain_head_digest" text NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT "tokenless_benchmark_research_denials_security_audit_fk"
    FOREIGN KEY ("security_scope_kind", "security_scope_id", "security_event_id", "security_event_digest")
    REFERENCES "tokenless_security_audit_events" ("scope_kind", "scope_id", "event_id", "event_digest")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_benchmark_research_denials_contract_check" CHECK (
    "denial_id" ~ '^brd_[0-9a-f]{40}$'
    AND "access_id" ~ '^bra_[A-Za-z0-9_-]{22}$'
    AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$'
    AND "request_lookup_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "grant_lookup_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "recipient_lookup_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "page_offset" >= 0
    AND "page_limit" BETWEEN 1 AND 500
    AND "reason" IN ('not_found', 'inactive', 'binding_rejected', 'authorization_rejected',
                     'projection_rejected', 'idempotency_conflict')
    AND "denial_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "denial_digest" = 'sha256:' || encode(digest(convert_to("denial_json", 'UTF8'), 'sha256'), 'hex')
    AND "security_scope_kind" = 'system'
    AND "security_scope_id" = 'benchmark-research-access'
    AND "security_event_id" ~ '^saudit_[0-9a-f]{32}$'
    AND "security_event_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "previous_event_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "chain_head_digest" = "security_event_digest"
  )
);--> statement-breakpoint

CREATE INDEX "tokenless_benchmark_research_grants_recipient_idx"
  ON "tokenless_benchmark_research_grants" USING btree
  ("recipient_principal_id", "workspace_id", "expires_at");--> statement-breakpoint
CREATE INDEX "tokenless_benchmark_research_denials_lookup_idx"
  ON "tokenless_benchmark_research_denied_access_audits" USING btree
  ("request_lookup_digest", "recorded_at");--> statement-breakpoint

CREATE TRIGGER tokenless_benchmark_activations_append_only
BEFORE UPDATE OR DELETE ON "tokenless_benchmark_activations"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_benchmark_research_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_benchmark_research_agreements_append_only
BEFORE UPDATE OR DELETE ON "tokenless_benchmark_research_agreement_acceptances"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_benchmark_research_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_benchmark_research_agreement_offers_append_only
BEFORE UPDATE OR DELETE ON "tokenless_benchmark_research_agreement_offers"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_benchmark_research_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_benchmark_research_approved_exports_append_only
BEFORE UPDATE OR DELETE ON "tokenless_benchmark_research_approved_exports"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_benchmark_research_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_benchmark_research_grants_append_only
BEFORE UPDATE OR DELETE ON "tokenless_benchmark_research_grants"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_benchmark_research_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_benchmark_research_revocations_append_only
BEFORE UPDATE OR DELETE ON "tokenless_benchmark_research_revocations"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_benchmark_research_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_benchmark_research_access_audits_append_only
BEFORE UPDATE OR DELETE ON "tokenless_benchmark_research_access_audits"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_benchmark_research_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_benchmark_research_access_snapshots_append_only
BEFORE UPDATE OR DELETE ON "tokenless_benchmark_research_access_snapshots"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_benchmark_research_immutable_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_benchmark_research_denials_append_only
BEFORE UPDATE OR DELETE ON "tokenless_benchmark_research_denied_access_audits"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_benchmark_research_immutable_mutation();
