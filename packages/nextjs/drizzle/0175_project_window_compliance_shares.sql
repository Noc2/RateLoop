ALTER TABLE "tokenless_assurance_evidence_packets"
  ADD CONSTRAINT "tokenless_evidence_packets_share_exact_uq"
  UNIQUE ("run_id", "packet_id", "packet_digest", "generated_at");--> statement-breakpoint
CREATE TABLE "tokenless_project_window_compliance_shares" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "share_id" text NOT NULL,
  "schema_version" text NOT NULL,
  "token_hash" text NOT NULL,
  "evidence_window_start" timestamp with time zone NOT NULL,
  "evidence_window_end" timestamp with time zone NOT NULL,
  "expected_artifact_count" integer NOT NULL,
  "expected_packet_count" integer NOT NULL,
  "expected_report_count" integer NOT NULL,
  "artifact_manifest_json" text NOT NULL,
  "artifact_manifest_root" text NOT NULL,
  "access_basis" text NOT NULL,
  "statutory_access_status" text NOT NULL,
  "grant_json" text NOT NULL,
  "grant_hash" text NOT NULL,
  "issued_by" text NOT NULL,
  "issued_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_project_window_compliance_shares_pk"
    PRIMARY KEY ("workspace_id", "share_id"),
  CONSTRAINT "tokenless_project_window_compliance_shares_token_uq"
    UNIQUE ("token_hash"),
  CONSTRAINT "tokenless_project_window_compliance_shares_scope_uq"
    UNIQUE ("workspace_id", "project_id", "share_id"),
  CONSTRAINT "tokenless_project_window_compliance_shares_manifest_uq"
    UNIQUE ("workspace_id", "project_id", "share_id", "evidence_window_start", "evidence_window_end",
            "expected_artifact_count", "artifact_manifest_root", "grant_hash"),
  CONSTRAINT "tokenless_project_window_compliance_shares_revocation_uq"
    UNIQUE ("workspace_id", "project_id", "share_id", "issued_at", "grant_hash"),
  CONSTRAINT "tokenless_project_window_compliance_shares_project_fk"
    FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects" ("workspace_id", "project_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_compliance_shares_contract_check" CHECK (
    "share_id" ~ '^pwcs_[A-Za-z0-9_-]{22}$'
    AND "schema_version" = 'rateloop.project-window-compliance-share.v1'
    AND "token_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "evidence_window_end" > "evidence_window_start"
    AND "expected_artifact_count" BETWEEN 1 AND 5000
    AND "expected_packet_count" BETWEEN 0 AND 5000
    AND "expected_report_count" BETWEEN 0 AND 5000
    AND "expected_packet_count" + "expected_report_count" = "expected_artifact_count"
    AND "artifact_manifest_root" ~ '^sha256:[0-9a-f]{64}$'
    AND "grant_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "access_basis" = 'bounded_project_window_compliance_evidence'
    AND "statutory_access_status" = 'not_benchmark_research_or_article_40_access'
    AND "expires_at" > "issued_at"
    AND "expires_at" <= "issued_at" + interval '30 days'
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_project_window_compliance_shares_project_idx"
  ON "tokenless_project_window_compliance_shares"
  ("workspace_id", "project_id", "issued_at", "share_id");--> statement-breakpoint
CREATE INDEX "tokenless_project_window_compliance_shares_expiry_idx"
  ON "tokenless_project_window_compliance_shares" ("expires_at");--> statement-breakpoint
CREATE TABLE "tokenless_project_window_compliance_share_artifacts" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "share_id" text NOT NULL,
  "evidence_window_start" timestamp with time zone NOT NULL,
  "evidence_window_end" timestamp with time zone NOT NULL,
  "expected_artifact_count" integer NOT NULL,
  "artifact_manifest_root" text NOT NULL,
  "grant_hash" text NOT NULL,
  "manifest_position" integer NOT NULL,
  "artifact_kind" text NOT NULL,
  "artifact_key" text NOT NULL,
  "artifact_id" text NOT NULL,
  "artifact_version" integer NOT NULL,
  "artifact_digest" text NOT NULL,
  "artifact_window_start" timestamp with time zone NOT NULL,
  "artifact_window_end" timestamp with time zone NOT NULL,
  "binding_json" text NOT NULL,
  "binding_hash" text NOT NULL,
  CONSTRAINT "tokenless_project_window_compliance_share_artifacts_pk"
    PRIMARY KEY ("workspace_id", "share_id", "manifest_position"),
  CONSTRAINT "tokenless_project_window_compliance_share_artifacts_key_uq"
    UNIQUE ("workspace_id", "share_id", "artifact_key"),
  CONSTRAINT "tokenless_project_window_compliance_share_artifacts_exact_uq"
    UNIQUE ("workspace_id", "project_id", "share_id", "manifest_position", "artifact_kind", "artifact_id",
            "artifact_version", "artifact_digest", "artifact_window_start", "artifact_window_end", "binding_hash"),
  CONSTRAINT "tokenless_project_window_compliance_share_artifacts_share_fk"
    FOREIGN KEY ("workspace_id", "project_id", "share_id", "evidence_window_start", "evidence_window_end",
                 "expected_artifact_count", "artifact_manifest_root", "grant_hash")
    REFERENCES "tokenless_project_window_compliance_shares"
      ("workspace_id", "project_id", "share_id", "evidence_window_start", "evidence_window_end",
       "expected_artifact_count", "artifact_manifest_root", "grant_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_compliance_share_artifacts_contract_check" CHECK (
    "manifest_position" BETWEEN 1 AND "expected_artifact_count"
    AND "artifact_kind" IN ('evidence_packet','part8_report_version')
    AND "artifact_version" >= 0
    AND "artifact_digest" ~ '^sha256:[0-9a-f]{64}$'
    AND "binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND (("artifact_kind" = 'evidence_packet'
          AND "artifact_key" = 'packet:' || "artifact_id"
          AND "artifact_version" = 0
          AND "artifact_window_start" = "artifact_window_end"
          AND "artifact_window_start" >= "evidence_window_start"
          AND "artifact_window_start" < "evidence_window_end")
         OR ("artifact_kind" = 'part8_report_version'
          AND "artifact_key" = 'report:' || "artifact_id" || ':' || "artifact_version"::text
          AND "artifact_version" > 0
          AND "artifact_window_end" > "artifact_window_start"
          AND "artifact_window_start" >= "evidence_window_start"
          AND "artifact_window_end" <= "evidence_window_end"))
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_project_window_share_evidence_packets" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "share_id" text NOT NULL,
  "manifest_position" integer NOT NULL,
  "artifact_kind" text NOT NULL,
  "artifact_id" text NOT NULL,
  "artifact_version" integer NOT NULL,
  "artifact_digest" text NOT NULL,
  "artifact_window_start" timestamp with time zone NOT NULL,
  "artifact_window_end" timestamp with time zone NOT NULL,
  "binding_hash" text NOT NULL,
  "run_id" text NOT NULL,
  "packet_id" text NOT NULL,
  "packet_digest" text NOT NULL,
  "generated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_project_window_share_evidence_packets_pk"
    PRIMARY KEY ("workspace_id", "share_id", "manifest_position"),
  CONSTRAINT "tokenless_project_window_share_evidence_packets_exact_uq"
    UNIQUE ("workspace_id", "project_id", "share_id", "manifest_position", "artifact_kind", "artifact_id",
            "artifact_version", "artifact_digest", "artifact_window_start", "artifact_window_end", "binding_hash"),
  CONSTRAINT "tokenless_project_window_share_evidence_packets_artifact_fk"
    FOREIGN KEY ("workspace_id", "project_id", "share_id", "manifest_position", "artifact_kind", "artifact_id",
                 "artifact_version", "artifact_digest", "artifact_window_start", "artifact_window_end", "binding_hash")
    REFERENCES "tokenless_project_window_compliance_share_artifacts"
      ("workspace_id", "project_id", "share_id", "manifest_position", "artifact_kind", "artifact_id",
       "artifact_version", "artifact_digest", "artifact_window_start", "artifact_window_end", "binding_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_share_evidence_packets_run_fk"
    FOREIGN KEY ("project_id", "run_id")
    REFERENCES "tokenless_assurance_runs" ("project_id", "run_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_share_evidence_packets_packet_fk"
    FOREIGN KEY ("run_id", "packet_id", "packet_digest", "generated_at")
    REFERENCES "tokenless_assurance_evidence_packets" ("run_id", "packet_id", "packet_digest", "generated_at")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_share_evidence_packets_contract_check" CHECK (
    "artifact_kind" = 'evidence_packet' AND "artifact_id" = "packet_id" AND "artifact_version" = 0
    AND "artifact_digest" = "packet_digest"
    AND "artifact_window_start" = "generated_at" AND "artifact_window_end" = "generated_at"
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_project_window_share_report_versions" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "share_id" text NOT NULL,
  "manifest_position" integer NOT NULL,
  "artifact_kind" text NOT NULL,
  "artifact_id" text NOT NULL,
  "artifact_version" integer NOT NULL,
  "artifact_digest" text NOT NULL,
  "artifact_window_start" timestamp with time zone NOT NULL,
  "artifact_window_end" timestamp with time zone NOT NULL,
  "binding_hash" text NOT NULL,
  "report_id" text NOT NULL,
  "report_version" integer NOT NULL,
  "report_digest" text NOT NULL,
  "reporting_period_start" timestamp with time zone NOT NULL,
  "reporting_period_end" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_project_window_share_report_versions_pk"
    PRIMARY KEY ("workspace_id", "share_id", "manifest_position"),
  CONSTRAINT "tokenless_project_window_share_report_versions_exact_uq"
    UNIQUE ("workspace_id", "project_id", "share_id", "manifest_position", "artifact_kind", "artifact_id",
            "artifact_version", "artifact_digest", "artifact_window_start", "artifact_window_end", "binding_hash"),
  CONSTRAINT "tokenless_project_window_share_report_versions_artifact_fk"
    FOREIGN KEY ("workspace_id", "project_id", "share_id", "manifest_position", "artifact_kind", "artifact_id",
                 "artifact_version", "artifact_digest", "artifact_window_start", "artifact_window_end", "binding_hash")
    REFERENCES "tokenless_project_window_compliance_share_artifacts"
      ("workspace_id", "project_id", "share_id", "manifest_position", "artifact_kind", "artifact_id",
       "artifact_version", "artifact_digest", "artifact_window_start", "artifact_window_end", "binding_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_share_report_versions_report_fk"
    FOREIGN KEY ("workspace_id", "report_id", "report_version", "report_digest")
    REFERENCES "tokenless_dsa_part8_report_versions"
      ("workspace_id", "report_id", "report_version", "report_digest") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_share_report_versions_contract_check" CHECK (
    "artifact_kind" = 'part8_report_version' AND "artifact_id" = "report_id"
    AND "artifact_version" = "report_version" AND "artifact_digest" = "report_digest"
    AND "artifact_window_start" = "reporting_period_start"
    AND "artifact_window_end" = "reporting_period_end"
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_project_window_compliance_share_revocations" (
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "share_id" text NOT NULL,
  "revocation_id" text NOT NULL,
  "reason" text NOT NULL,
  "issued_at" timestamp with time zone NOT NULL,
  "grant_hash" text NOT NULL,
  "revoked_by" text NOT NULL,
  "revoked_at" timestamp with time zone NOT NULL,
  "revocation_json" text NOT NULL,
  "revocation_hash" text NOT NULL,
  CONSTRAINT "tokenless_project_window_compliance_share_revocations_pk"
    PRIMARY KEY ("workspace_id", "revocation_id"),
  CONSTRAINT "tokenless_project_window_compliance_share_revocations_share_uq"
    UNIQUE ("workspace_id", "share_id"),
  CONSTRAINT "tokenless_project_window_compliance_share_revocations_share_fk"
    FOREIGN KEY ("workspace_id", "project_id", "share_id", "issued_at", "grant_hash")
    REFERENCES "tokenless_project_window_compliance_shares"
      ("workspace_id", "project_id", "share_id", "issued_at", "grant_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_compliance_share_revocations_contract_check" CHECK (
    "revocation_id" ~ '^pwrv_[A-Za-z0-9_-]{22}$'
    AND "reason" IN ('manager_request','security_response','share_replaced','issuance_error')
    AND "grant_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "revocation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "revoked_at" >= "issued_at"
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_project_window_compliance_share_access_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "access_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_binding_hash" text NOT NULL,
  "share_lookup_hash" text NOT NULL,
  "token_lookup_hash" text NOT NULL,
  "result" text NOT NULL,
  "denial_reason" text,
  "occurred_at" timestamp with time zone NOT NULL,
  "event_json" text NOT NULL,
  "event_hash" text NOT NULL,
  CONSTRAINT "tokenless_project_window_compliance_share_access_events_exact_uq"
    UNIQUE ("event_id", "event_hash", "result"),
  CONSTRAINT "tokenless_project_window_compliance_share_access_events_access_uq"
    UNIQUE ("access_id"),
  CONSTRAINT "tokenless_project_window_compliance_share_access_events_contract_check" CHECK (
    "event_id" ~ '^pwae_[A-Za-z0-9_-]{22}$'
    AND "access_id" ~ '^pwca_[A-Za-z0-9_-]{22}$'
    AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$'
    AND "request_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "share_lookup_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "token_lookup_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "event_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND (("result" = 'success' AND "denial_reason" IS NULL)
         OR ("result" = 'denied' AND "denial_reason" IN
           ('not_found','expired','revoked','tenant_mismatch','window_mismatch','unbound_artifact',
            'artifact_invalid','idempotency_conflict')))
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_project_window_compliance_share_access_events_replay_idx"
  ON "tokenless_project_window_compliance_share_access_events"
  ("access_id", "idempotency_key", "occurred_at", "event_id");--> statement-breakpoint
CREATE TABLE "tokenless_project_window_compliance_share_access_snapshots" (
  "access_id" text PRIMARY KEY NOT NULL,
  "idempotency_key" text NOT NULL,
  "share_lookup_hash" text NOT NULL,
  "token_lookup_hash" text NOT NULL,
  "request_binding_hash" text NOT NULL,
  "event_id" text NOT NULL,
  "event_hash" text NOT NULL,
  "result" text NOT NULL,
  "denial_reason" text,
  "response_json" text,
  "response_hash" text,
  "occurred_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_project_window_compliance_share_access_snapshots_exact_uq"
    UNIQUE ("event_id", "event_hash", "result"),
  CONSTRAINT "tokenless_project_window_compliance_share_access_snapshots_replay_uq"
    UNIQUE ("share_lookup_hash", "token_lookup_hash", "idempotency_key"),
  CONSTRAINT "tokenless_project_window_compliance_share_access_snapshots_event_fk"
    FOREIGN KEY ("event_id", "event_hash", "result")
    REFERENCES "tokenless_project_window_compliance_share_access_events" ("event_id", "event_hash", "result")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_compliance_share_access_snapshots_contract_check" CHECK (
    "access_id" ~ '^pwca_[A-Za-z0-9_-]{22}$'
    AND "idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$'
    AND "share_lookup_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "token_lookup_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND (("result" = 'success' AND "denial_reason" IS NULL
          AND "response_json" IS NOT NULL AND "response_hash" ~ '^sha256:[0-9a-f]{64}$')
         OR ("result" = 'denied' AND "denial_reason" IS NOT NULL
          AND "response_json" IS NULL AND "response_hash" IS NULL))
  )
);--> statement-breakpoint
CREATE TABLE "tokenless_project_window_share_packet_accesses" (
  "event_id" text PRIMARY KEY NOT NULL,
  "event_hash" text NOT NULL,
  "result" text NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "share_id" text NOT NULL,
  "manifest_position" integer NOT NULL,
  "artifact_kind" text NOT NULL,
  "artifact_id" text NOT NULL,
  "artifact_version" integer NOT NULL,
  "artifact_digest" text NOT NULL,
  "artifact_window_start" timestamp with time zone NOT NULL,
  "artifact_window_end" timestamp with time zone NOT NULL,
  "binding_hash" text NOT NULL,
  CONSTRAINT "tokenless_project_window_share_packet_accesses_snapshot_fk"
    FOREIGN KEY ("event_id", "event_hash", "result")
    REFERENCES "tokenless_project_window_compliance_share_access_snapshots" ("event_id", "event_hash", "result")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_share_packet_accesses_artifact_fk"
    FOREIGN KEY ("workspace_id", "project_id", "share_id", "manifest_position", "artifact_kind", "artifact_id",
                 "artifact_version", "artifact_digest", "artifact_window_start", "artifact_window_end", "binding_hash")
    REFERENCES "tokenless_project_window_share_evidence_packets"
      ("workspace_id", "project_id", "share_id", "manifest_position", "artifact_kind", "artifact_id",
       "artifact_version", "artifact_digest", "artifact_window_start", "artifact_window_end", "binding_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_share_packet_accesses_contract_check"
    CHECK ("result" = 'success' AND "artifact_kind" = 'evidence_packet')
);--> statement-breakpoint
CREATE TABLE "tokenless_project_window_share_report_accesses" (
  "event_id" text PRIMARY KEY NOT NULL,
  "event_hash" text NOT NULL,
  "result" text NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  "share_id" text NOT NULL,
  "manifest_position" integer NOT NULL,
  "artifact_kind" text NOT NULL,
  "artifact_id" text NOT NULL,
  "artifact_version" integer NOT NULL,
  "artifact_digest" text NOT NULL,
  "artifact_window_start" timestamp with time zone NOT NULL,
  "artifact_window_end" timestamp with time zone NOT NULL,
  "binding_hash" text NOT NULL,
  CONSTRAINT "tokenless_project_window_share_report_accesses_snapshot_fk"
    FOREIGN KEY ("event_id", "event_hash", "result")
    REFERENCES "tokenless_project_window_compliance_share_access_snapshots" ("event_id", "event_hash", "result")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_share_report_accesses_artifact_fk"
    FOREIGN KEY ("workspace_id", "project_id", "share_id", "manifest_position", "artifact_kind", "artifact_id",
                 "artifact_version", "artifact_digest", "artifact_window_start", "artifact_window_end", "binding_hash")
    REFERENCES "tokenless_project_window_share_report_versions"
      ("workspace_id", "project_id", "share_id", "manifest_position", "artifact_kind", "artifact_id",
       "artifact_version", "artifact_digest", "artifact_window_start", "artifact_window_end", "binding_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_project_window_share_report_accesses_contract_check"
    CHECK ("result" = 'success' AND "artifact_kind" = 'part8_report_version')
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_project_window_share_complete_at_commit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_count integer; packet_count integer; report_count integer;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE artifact_kind='evidence_packet'),
         count(*) FILTER (WHERE artifact_kind='part8_report_version')
    INTO artifact_count,packet_count,report_count
  FROM tokenless_project_window_compliance_share_artifacts
  WHERE workspace_id=NEW.workspace_id AND share_id=NEW.share_id;
  IF artifact_count <> NEW.expected_artifact_count OR packet_count <> NEW.expected_packet_count
     OR report_count <> NEW.expected_report_count THEN
    RAISE EXCEPTION 'project-window share manifest is incomplete' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_project_window_share_complete_at_commit
AFTER INSERT ON "tokenless_project_window_compliance_shares"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_project_window_share_complete_at_commit();--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_project_window_artifact_exact_at_commit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE packet_count integer; report_count integer;
BEGIN
  SELECT count(*) INTO packet_count FROM tokenless_project_window_share_evidence_packets
   WHERE workspace_id=NEW.workspace_id AND share_id=NEW.share_id AND manifest_position=NEW.manifest_position;
  SELECT count(*) INTO report_count FROM tokenless_project_window_share_report_versions
   WHERE workspace_id=NEW.workspace_id AND share_id=NEW.share_id AND manifest_position=NEW.manifest_position;
  IF (NEW.artifact_kind='evidence_packet' AND (packet_count<>1 OR report_count<>0))
     OR (NEW.artifact_kind='part8_report_version' AND (packet_count<>0 OR report_count<>1)) THEN
    RAISE EXCEPTION 'project-window artifact lacks one exact typed binding' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_project_window_artifact_exact_at_commit
AFTER INSERT ON "tokenless_project_window_compliance_share_artifacts"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_project_window_artifact_exact_at_commit();--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_project_window_access_exact_at_commit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE packet_count integer; report_count integer;
BEGIN
  SELECT count(*) INTO packet_count FROM tokenless_project_window_share_packet_accesses WHERE event_id=NEW.event_id;
  SELECT count(*) INTO report_count FROM tokenless_project_window_share_report_accesses WHERE event_id=NEW.event_id;
  IF (NEW.result='success' AND packet_count+report_count<>1)
     OR (NEW.result='denied' AND packet_count+report_count<>0) THEN
    RAISE EXCEPTION 'project-window access snapshot has an invalid typed artifact binding' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_project_window_access_exact_at_commit
AFTER INSERT ON "tokenless_project_window_compliance_share_access_snapshots"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_project_window_access_exact_at_commit();--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_guard_project_window_access_terminal_at_commit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot_count integer;
BEGIN
  SELECT count(*) INTO snapshot_count
  FROM tokenless_project_window_compliance_share_access_snapshots
  WHERE access_id=NEW.access_id AND event_id=NEW.event_id AND event_hash=NEW.event_hash AND result=NEW.result;
  IF snapshot_count<>1 THEN
    RAISE EXCEPTION 'project-window access event lacks one terminal replay snapshot' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tokenless_project_window_access_terminal_at_commit
AFTER INSERT ON "tokenless_project_window_compliance_share_access_events"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION tokenless_guard_project_window_access_terminal_at_commit();--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_reject_project_window_share_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'project-window compliance-share evidence is append-only' USING ERRCODE='55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER tokenless_project_window_compliance_shares_append_only
BEFORE UPDATE OR DELETE ON "tokenless_project_window_compliance_shares"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_project_window_share_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_project_window_compliance_share_artifacts_append_only
BEFORE UPDATE OR DELETE ON "tokenless_project_window_compliance_share_artifacts"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_project_window_share_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_project_window_share_evidence_packets_append_only
BEFORE UPDATE OR DELETE ON "tokenless_project_window_share_evidence_packets"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_project_window_share_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_project_window_share_report_versions_append_only
BEFORE UPDATE OR DELETE ON "tokenless_project_window_share_report_versions"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_project_window_share_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_project_window_compliance_share_revocations_append_only
BEFORE UPDATE OR DELETE ON "tokenless_project_window_compliance_share_revocations"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_project_window_share_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_project_window_compliance_share_access_events_append_only
BEFORE UPDATE OR DELETE ON "tokenless_project_window_compliance_share_access_events"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_project_window_share_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_project_window_compliance_share_access_snapshots_append_only
BEFORE UPDATE OR DELETE ON "tokenless_project_window_compliance_share_access_snapshots"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_project_window_share_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_project_window_share_packet_accesses_append_only
BEFORE UPDATE OR DELETE ON "tokenless_project_window_share_packet_accesses"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_project_window_share_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_project_window_share_report_accesses_append_only
BEFORE UPDATE OR DELETE ON "tokenless_project_window_share_report_accesses"
FOR EACH ROW EXECUTE FUNCTION tokenless_reject_project_window_share_mutation();
