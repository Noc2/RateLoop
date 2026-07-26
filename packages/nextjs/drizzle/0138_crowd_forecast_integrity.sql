CREATE TABLE "tokenless_forecast_calibration_accumulators" (
  "subject_space" text NOT NULL,
  "subject_key" text NOT NULL,
  "key_version" text NOT NULL,
  "workspace_id" text REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "rater_id" text REFERENCES "tokenless_rater_profiles"("rater_id") ON DELETE CASCADE,
  "observation_count" numeric(78, 0) NOT NULL DEFAULT 0,
  "outcome_observation_count" numeric(78, 0) NOT NULL DEFAULT 0,
  "forecast_sum_bps" numeric(78, 0) NOT NULL DEFAULT 0,
  "forecast_square_sum" numeric(78, 0) NOT NULL DEFAULT 0,
  "squared_error_sum" numeric(78, 0) NOT NULL DEFAULT 0,
  "outcome_positive_count" numeric(78, 0) NOT NULL DEFAULT 0,
  "positive_outcome_forecast_sum_bps" numeric(78, 0) NOT NULL DEFAULT 0,
  "positive_outcome_count" numeric(78, 0) NOT NULL DEFAULT 0,
  "negative_outcome_forecast_sum_bps" numeric(78, 0) NOT NULL DEFAULT 0,
  "negative_outcome_count" numeric(78, 0) NOT NULL DEFAULT 0,
  "positive_vote_forecast_sum_bps" numeric(78, 0) NOT NULL DEFAULT 0,
  "positive_vote_count" numeric(78, 0) NOT NULL DEFAULT 0,
  "negative_vote_forecast_sum_bps" numeric(78, 0) NOT NULL DEFAULT 0,
  "negative_vote_count" numeric(78, 0) NOT NULL DEFAULT 0,
  "current_reason_codes_json" text NOT NULL DEFAULT '[]',
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("subject_space", "subject_key"),
  CONSTRAINT "tokenless_forecast_calibration_identity_check" CHECK (
    (
      "subject_space" = 'invited_workspace'
      AND "workspace_id" IS NOT NULL
      AND "rater_id" IS NULL
      AND "subject_key" ~ '^hmac-sha256:[0-9a-f]{64}$'
    )
    OR
    (
      "subject_space" = 'network_rater'
      AND "workspace_id" IS NULL
      AND "rater_id" IS NOT NULL
      AND "subject_key" = "rater_id"
    )
  ),
  CONSTRAINT "tokenless_forecast_calibration_nonnegative_check" CHECK (
    "observation_count" >= 0
    AND "outcome_observation_count" >= 0
    AND "outcome_observation_count" <= "observation_count"
    AND "forecast_sum_bps" >= 0
    AND "forecast_square_sum" >= 0
    AND "squared_error_sum" >= 0
    AND "outcome_positive_count" >= 0
    AND "positive_outcome_forecast_sum_bps" >= 0
    AND "positive_outcome_count" >= 0
    AND "negative_outcome_forecast_sum_bps" >= 0
    AND "negative_outcome_count" >= 0
    AND "positive_vote_forecast_sum_bps" >= 0
    AND "positive_vote_count" >= 0
    AND "negative_vote_forecast_sum_bps" >= 0
    AND "negative_vote_count" >= 0
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_forecast_calibration_workspace_idx"
  ON "tokenless_forecast_calibration_accumulators" ("workspace_id","subject_space","updated_at");--> statement-breakpoint
CREATE INDEX "tokenless_forecast_calibration_rater_idx"
  ON "tokenless_forecast_calibration_accumulators" ("rater_id","subject_space","updated_at");--> statement-breakpoint

CREATE TABLE "tokenless_forecast_workspace_histograms" (
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "subject_space" text NOT NULL,
  "observation_count" numeric(78, 0) NOT NULL DEFAULT 0,
  "buckets_json" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("workspace_id","subject_space"),
  CONSTRAINT "tokenless_forecast_workspace_histogram_space_check"
    CHECK ("subject_space" IN ('invited_workspace','network_rater')),
  CONSTRAINT "tokenless_forecast_workspace_histogram_count_check"
    CHECK ("observation_count" >= 0)
);--> statement-breakpoint

CREATE TABLE "tokenless_forecast_pair_accumulators" (
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "subject_space" text NOT NULL,
  "left_subject_key" text NOT NULL,
  "right_subject_key" text NOT NULL,
  "observation_count" numeric(78, 0) NOT NULL DEFAULT 0,
  "exact_match_count" numeric(78, 0) NOT NULL DEFAULT 0,
  "expected_exact_match_bps_sum" numeric(78, 0) NOT NULL DEFAULT 0,
  "distance_sum_bps" numeric(78, 0) NOT NULL DEFAULT 0,
  "distance_square_sum" numeric(78, 0) NOT NULL DEFAULT 0,
  "current_reason_codes_json" text NOT NULL DEFAULT '[]',
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("workspace_id","subject_space","left_subject_key","right_subject_key"),
  CONSTRAINT "tokenless_forecast_pair_space_check"
    CHECK ("subject_space" IN ('invited_workspace','network_rater')),
  CONSTRAINT "tokenless_forecast_pair_order_check"
    CHECK ("left_subject_key" < "right_subject_key"),
  CONSTRAINT "tokenless_forecast_pair_nonnegative_check" CHECK (
    "observation_count" >= 0
    AND "exact_match_count" >= 0
    AND "expected_exact_match_bps_sum" >= 0
    AND "distance_sum_bps" >= 0
    AND "distance_square_sum" >= 0
  )
);--> statement-breakpoint

CREATE TABLE "tokenless_forecast_integrity_terminal_receipts" (
  "lane" text NOT NULL,
  "terminal_key" text NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "source_set_commitment" text NOT NULL,
  "aggregated_forecast_count" integer NOT NULL,
  "processed_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("lane","terminal_key"),
  CONSTRAINT "tokenless_forecast_terminal_lane_check"
    CHECK ("lane" IN ('private_invited','public_paid')),
  CONSTRAINT "tokenless_forecast_terminal_commitment_check"
    CHECK ("source_set_commitment" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_forecast_terminal_count_check"
    CHECK ("aggregated_forecast_count" >= 0)
);--> statement-breakpoint
CREATE INDEX "tokenless_forecast_terminal_workspace_idx"
  ON "tokenless_forecast_integrity_terminal_receipts" ("workspace_id","processed_at");--> statement-breakpoint

CREATE TABLE "tokenless_forecast_integrity_findings" (
  "finding_id" text PRIMARY KEY NOT NULL,
  "dedupe_key" text NOT NULL UNIQUE,
  "subject_space" text NOT NULL,
  "subject_key" text NOT NULL,
  "workspace_id" text REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE CASCADE,
  "peer_subject_key" text,
  "reason_code" text NOT NULL,
  "severity" text NOT NULL,
  "source_observation_count" numeric(78, 0) NOT NULL,
  "evidence_counters_json" text NOT NULL,
  "payout_effect" text NOT NULL DEFAULT 'none',
  "consequence" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_forecast_finding_space_check"
    CHECK ("subject_space" IN ('invited_workspace','network_rater')),
  CONSTRAINT "tokenless_forecast_finding_reason_check"
    CHECK ("reason_code" IN (
      'forecast_invariant','forecast_discrimination_absent',
      'forecast_vote_decoupled','forecast_pair_lockstep'
    )),
  CONSTRAINT "tokenless_forecast_finding_severity_check"
    CHECK ("severity" IN ('soft','hard')),
  CONSTRAINT "tokenless_forecast_finding_payout_check"
    CHECK ("payout_effect" = 'none'),
  CONSTRAINT "tokenless_forecast_finding_consequence_check"
    CHECK ("consequence" IN ('none','future_assignment_restriction'))
);--> statement-breakpoint
CREATE INDEX "tokenless_forecast_findings_subject_idx"
  ON "tokenless_forecast_integrity_findings"
  ("subject_space","subject_key","created_at");--> statement-breakpoint

CREATE TABLE "tokenless_forecast_integrity_appeals" (
  "appeal_id" text PRIMARY KEY NOT NULL,
  "finding_id" text NOT NULL REFERENCES "tokenless_forecast_integrity_findings"("finding_id") ON DELETE CASCADE,
  "subject_space" text NOT NULL,
  "subject_key" text NOT NULL,
  "reason_code" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "opened_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" text,
  "resolution_reason" text,
  CONSTRAINT "tokenless_forecast_appeal_space_check"
    CHECK ("subject_space" IN ('invited_workspace','network_rater')),
  CONSTRAINT "tokenless_forecast_appeal_reason_check"
    CHECK ("reason_code" IN ('context_missing','shared_process','measurement_error','other')),
  CONSTRAINT "tokenless_forecast_appeal_status_check"
    CHECK ("status" IN ('open','accepted','rejected','withdrawn')),
  CONSTRAINT "tokenless_forecast_appeal_resolution_check" CHECK (
    ("status" = 'open' AND "resolved_at" IS NULL AND "resolved_by" IS NULL)
    OR
    ("status" <> 'open' AND "resolved_at" IS NOT NULL AND "resolved_by" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_forecast_appeal_one_open_per_finding_idx"
  ON "tokenless_forecast_integrity_appeals" ("finding_id")
  WHERE "status" = 'open';--> statement-breakpoint
CREATE INDEX "tokenless_forecast_appeal_subject_idx"
  ON "tokenless_forecast_integrity_appeals" ("subject_space","subject_key","status","opened_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_reject_forecast_finding_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('rateloop.account_erasure', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'crowd forecast integrity findings are append-only';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_forecast_findings_no_update"
  BEFORE UPDATE ON "tokenless_forecast_integrity_findings"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_forecast_finding_mutation"();--> statement-breakpoint
CREATE TRIGGER "tokenless_forecast_findings_no_delete"
  BEFORE DELETE ON "tokenless_forecast_integrity_findings"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_reject_forecast_finding_mutation"();
