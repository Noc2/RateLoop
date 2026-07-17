ALTER TABLE "tokenless_reviewer_qualifications"
  DROP CONSTRAINT "tokenless_reviewer_qualifications_kind_check";
--> statement-breakpoint
ALTER TABLE "tokenless_reviewer_qualifications"
  ALTER COLUMN "rater_id" DROP NOT NULL,
  ADD COLUMN "evidence_kind" text NOT NULL DEFAULT 'legacy_migrated',
  ADD COLUMN "workspace_id" text REFERENCES "tokenless_workspaces"("workspace_id"),
  ADD COLUMN "reviewer_account_address" text,
  ADD COLUMN "evidence_reference_hash" text,
  ADD COLUMN "qualification_value_json" text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "tokenless_reviewer_qualifications"
  ADD CONSTRAINT "tokenless_reviewer_qualifications_kind_check"
    CHECK ("qualification_kind" IN ('cohort', 'gold', 'expertise', 'practice', 'task', 'invitation', 'legacy_snapshot')),
  ADD CONSTRAINT "tokenless_reviewer_qualifications_evidence_kind_check"
    CHECK ("evidence_kind" IN ('owner_attested', 'platform_verified_credential', 'gold_derived', 'legacy_migrated')),
  ADD CONSTRAINT "tokenless_reviewer_qualifications_evidence_hash_check"
    CHECK ("evidence_reference_hash" IS NULL OR "evidence_reference_hash" ~ '^sha256:[0-9a-f]{64}$'),
  ADD CONSTRAINT "tokenless_reviewer_qualifications_subject_check" CHECK (
    ("rater_id" IS NOT NULL AND "reviewer_account_address" IS NULL)
      OR ("rater_id" IS NULL AND "reviewer_account_address" IS NOT NULL AND char_length("reviewer_account_address") BETWEEN 3 AND 320)
  ),
  ADD CONSTRAINT "tokenless_reviewer_qualifications_expertise_scope_check" CHECK (
    "qualification_kind" <> 'expertise'
    OR (
      (
        "evidence_kind" IN ('owner_attested', 'gold_derived')
        AND "workspace_id" IS NOT NULL
        AND "reviewer_source" = 'customer_invited'
        AND "reviewer_account_address" IS NOT NULL
        AND "evidence_reference_hash" IS NOT NULL
      )
      OR (
        "evidence_kind" IN ('platform_verified_credential', 'gold_derived')
        AND "workspace_id" IS NULL
        AND "reviewer_source" = 'rateloop_network'
        AND "rater_id" IS NOT NULL
        AND "evidence_reference_hash" IS NOT NULL
      )
    )
  ),
  ADD CONSTRAINT "tokenless_reviewer_qualifications_gold_scope_check" CHECK (
    "qualification_kind" <> 'gold'
    OR (
      "evidence_kind" = 'gold_derived'
      AND "workspace_id" IS NOT NULL
      AND "reviewer_source" = 'customer_invited'
      AND "reviewer_account_address" IS NOT NULL
      AND "evidence_reference_hash" IS NOT NULL
    )
  );
--> statement-breakpoint
CREATE INDEX "tokenless_reviewer_qualifications_expertise_idx"
  ON "tokenless_reviewer_qualifications" USING btree
  ("workspace_id", "reviewer_source", "qualification_kind", "evidence_kind", "status", "expires_at");
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD COLUMN "required_expertise_keys_json" text NOT NULL DEFAULT '[]';
