CREATE TABLE "tokenless_sanctions_screenings" (
  "screening_id" text PRIMARY KEY NOT NULL,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id") ON DELETE RESTRICT,
  "source" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "subject_ciphertext" text NOT NULL,
  "subject_key_version" text NOT NULL,
  "subject_key_domain" text NOT NULL,
  "list_snapshot_hash" text,
  "screened_by" text,
  "requested_at" timestamp with time zone NOT NULL,
  "screened_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_sanctions_screenings_source_check"
    CHECK ("source" IN ('manual:v1','opensanctions:v1')),
  CONSTRAINT "tokenless_sanctions_screenings_status_check"
    CHECK ("status" IN ('pending','clear','review','match')),
  CONSTRAINT "tokenless_sanctions_screenings_vault_check"
    CHECK ("subject_key_domain" = 'provider_evidence'),
  CONSTRAINT "tokenless_sanctions_screenings_snapshot_check"
    CHECK ("list_snapshot_hash" IS NULL OR "list_snapshot_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_sanctions_screenings_terminal_check" CHECK (
    ("status" = 'pending' AND "screened_at" IS NULL AND "expires_at" IS NULL
      AND "list_snapshot_hash" IS NULL AND "screened_by" IS NULL)
    OR
    ("status" <> 'pending' AND "screened_at" IS NOT NULL AND "expires_at" > "screened_at"
      AND "list_snapshot_hash" IS NOT NULL AND "screened_by" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_sanctions_screenings_queue_idx"
  ON "tokenless_sanctions_screenings" USING btree ("status", "requested_at", "screening_id");--> statement-breakpoint
CREATE INDEX "tokenless_sanctions_screenings_rater_idx"
  ON "tokenless_sanctions_screenings" USING btree ("rater_id", "status", "expires_at");--> statement-breakpoint

CREATE TABLE "tokenless_paid_eligibility_scopes" (
  "scope_id" text PRIMARY KEY NOT NULL,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id") ON DELETE RESTRICT,
  "reviewer_source" text NOT NULL,
  "workspace_id" text REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "compensation_mode" text NOT NULL DEFAULT 'usdc',
  "adulthood_basis" text NOT NULL,
  "adulthood_assertion_id" text REFERENCES "tokenless_assurance_assertions"("assertion_id") ON DELETE RESTRICT,
  "invitation_qualification_id" text REFERENCES "tokenless_reviewer_qualifications"("qualification_id") ON DELETE RESTRICT,
  "sanctions_screening_id" text NOT NULL REFERENCES "tokenless_sanctions_screenings"("screening_id") ON DELETE RESTRICT,
  "status" text NOT NULL,
  "blocked_reason" text,
  "valid_until" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_paid_eligibility_scopes_source_check"
    CHECK ("reviewer_source" IN ('customer_invited','rateloop_network')),
  CONSTRAINT "tokenless_paid_eligibility_scopes_compensation_check"
    CHECK ("compensation_mode" = 'usdc'),
  CONSTRAINT "tokenless_paid_eligibility_scopes_adulthood_check"
    CHECK ("adulthood_basis" IN ('customer_attested','provider_attested','self_declared')),
  CONSTRAINT "tokenless_paid_eligibility_scopes_status_check"
    CHECK ("status" IN ('pending','eligible','review','blocked','expired')),
  CONSTRAINT "tokenless_paid_eligibility_scopes_lane_check" CHECK (
    (
      "reviewer_source" = 'customer_invited'
      AND "workspace_id" IS NOT NULL
      AND "adulthood_basis" = 'customer_attested'
      AND "adulthood_assertion_id" IS NOT NULL
      AND "invitation_qualification_id" IS NOT NULL
    )
    OR
    (
      "reviewer_source" = 'rateloop_network'
      AND "workspace_id" IS NULL
      AND "adulthood_basis" IN ('provider_attested','self_declared')
      AND "adulthood_assertion_id" IS NOT NULL
      AND "invitation_qualification_id" IS NULL
    )
  ),
  CONSTRAINT "tokenless_paid_eligibility_scopes_validity_check" CHECK (
    ("status" = 'eligible' AND "valid_until" IS NOT NULL)
    OR ("status" <> 'eligible')
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_paid_eligibility_scopes_exact_unique"
  ON "tokenless_paid_eligibility_scopes"
  ("rater_id", "reviewer_source", COALESCE("workspace_id", ''));--> statement-breakpoint
CREATE INDEX "tokenless_paid_eligibility_scopes_current_idx"
  ON "tokenless_paid_eligibility_scopes"
  ("rater_id", "reviewer_source", "workspace_id", "status", "valid_until");--> statement-breakpoint

ALTER TABLE "tokenless_workspace_reviewer_invitations"
  ADD COLUMN "paid_adulthood_attested" boolean DEFAULT false NOT NULL,
  ADD COLUMN "paid_adulthood_attested_by" text,
  ADD COLUMN "paid_adulthood_attested_at" timestamp with time zone,
  ADD CONSTRAINT "tokenless_workspace_reviewer_invitations_adulthood_check" CHECK (
    (
      "paid_adulthood_attested" = false
      AND "paid_adulthood_attested_by" IS NULL
      AND "paid_adulthood_attested_at" IS NULL
    )
    OR
    (
      "paid_adulthood_attested" = true
      AND "paid_adulthood_attested_by" IS NOT NULL
      AND "paid_adulthood_attested_at" IS NOT NULL
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_voucher_rounds"
  ADD COLUMN "workspace_id" text REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tokenless_voucher_rounds"
  ADD CONSTRAINT "tokenless_voucher_rounds_workspace_scope_check" CHECK (
    "workspace_id" IS NULL
    OR ("admission_policy_json"::jsonb ->> 'reviewerSource') = 'customer_invited'
  );
