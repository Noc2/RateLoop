ALTER TABLE "tokenless_agent_review_opportunities"
  ADD CONSTRAINT "tokenless_agent_review_opportunities_exact_source_unique"
  UNIQUE ("workspace_id", "opportunity_id", "source_evidence_hash", "suggestion_commitment");--> statement-breakpoint

CREATE TABLE "tokenless_agent_review_opportunity_lifecycles" (
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "state" text NOT NULL,
  "state_revision" integer NOT NULL DEFAULT 1,
  "reason_codes_json" text NOT NULL DEFAULT '[]',
  "state_entered_at" timestamp with time zone NOT NULL,
  "terminal_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_review_opportunity_lifecycles_pk"
    PRIMARY KEY ("workspace_id", "opportunity_id"),
  CONSTRAINT "tokenless_agent_review_opportunity_lifecycles_opportunity_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunities" ("workspace_id", "opportunity_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_review_opportunity_lifecycles_state_check" CHECK (
    "state" IN (
      'evaluating', 'skipped', 'approval_required', 'request_ready', 'pending', 'blocked',
      'completed', 'inconclusive', 'failed_terminal', 'cancelled_before_commit'
    )
  ),
  CONSTRAINT "tokenless_agent_review_opportunity_lifecycles_revision_check"
    CHECK ("state_revision" >= 1),
  CONSTRAINT "tokenless_agent_review_opportunity_lifecycles_terminal_check" CHECK (
    (
      "state" IN ('skipped', 'completed', 'inconclusive', 'failed_terminal', 'cancelled_before_commit')
      AND "terminal_at" IS NOT NULL
    )
    OR (
      "state" IN ('evaluating', 'approval_required', 'request_ready', 'pending', 'blocked')
      AND "terminal_at" IS NULL
    )
  ),
  CONSTRAINT "tokenless_agent_review_opportunity_lifecycles_timestamps_check" CHECK (
    "state_entered_at" >= "created_at"
    AND "updated_at" >= "state_entered_at"
    AND ("terminal_at" IS NULL OR ("terminal_at" >= "state_entered_at" AND "terminal_at" <= "updated_at"))
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_opportunity_lifecycles_state_updated_idx"
  ON "tokenless_agent_review_opportunity_lifecycles" USING btree
  ("workspace_id", "state", "updated_at")
  WHERE "terminal_at" IS NULL;--> statement-breakpoint

INSERT INTO "tokenless_agent_review_opportunity_lifecycles" (
  "workspace_id", "opportunity_id", "state", "state_revision", "reason_codes_json",
  "state_entered_at", "terminal_at", "created_at", "updated_at"
)
SELECT
  "workspace_id",
  "opportunity_id",
  CASE
    WHEN "status" = 'skipped' THEN 'skipped'
    WHEN "status" = 'decided' AND "decision" = 'required' THEN 'approval_required'
    WHEN "status" = 'decided' THEN 'skipped'
    WHEN "status" = 'review_requested' THEN 'pending'
    WHEN "status" = 'completed' THEN 'completed'
    WHEN "status" = 'failed' THEN 'failed_terminal'
  END,
  1,
  "reason_codes_json",
  "updated_at",
  CASE WHEN "status" IN ('skipped', 'completed', 'failed') OR "status" = 'decided' AND "decision" <> 'required'
    THEN "updated_at" ELSE NULL END,
  "created_at",
  "updated_at"
FROM "tokenless_agent_review_opportunities";--> statement-breakpoint

CREATE TABLE "tokenless_agent_review_approval_requests" (
  "approval_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "opportunity_id" text NOT NULL,
  "revision" integer NOT NULL,
  "request_profile_id" text NOT NULL,
  "request_profile_version" integer NOT NULL,
  "request_profile_hash" text NOT NULL,
  "source_evidence_hash" text NOT NULL,
  "suggestion_commitment" text NOT NULL,
  "prepared_request_json" text NOT NULL,
  "prepared_request_hash" text NOT NULL,
  "derived_economics_json" text NOT NULL,
  "derived_economics_hash" text NOT NULL,
  "maximum_charge_atomic" numeric(78, 0) NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "owner_decision" text,
  "prepared_by" text NOT NULL,
  "decided_by" text,
  "decision_note" text,
  "decided_at" timestamp with time zone,
  "invalidated_by" text,
  "invalidated_at" timestamp with time zone,
  "expired_at" timestamp with time zone,
  "consumed_at" timestamp with time zone,
  "consumption_reference" text,
  "created_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_agent_review_approval_requests_opportunity_revision_unique"
    UNIQUE ("workspace_id", "opportunity_id", "revision"),
  CONSTRAINT "tokenless_agent_review_approval_requests_prepared_hash_unique"
    UNIQUE ("workspace_id", "prepared_request_hash"),
  CONSTRAINT "tokenless_agent_review_approval_requests_consumption_unique"
    UNIQUE ("consumption_reference"),
  CONSTRAINT "tokenless_agent_review_approval_requests_profile_fk"
    FOREIGN KEY ("workspace_id", "request_profile_id", "request_profile_version", "request_profile_hash")
    REFERENCES "tokenless_agent_review_request_profiles"
      ("workspace_id", "profile_id", "version", "profile_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_review_approval_requests_lifecycle_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_lifecycles"
      ("workspace_id", "opportunity_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_review_approval_requests_opportunity_source_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id", "source_evidence_hash", "suggestion_commitment")
    REFERENCES "tokenless_agent_review_opportunities"
      ("workspace_id", "opportunity_id", "source_evidence_hash", "suggestion_commitment") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_agent_review_approval_requests_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "tokenless_agent_review_approval_requests_hashes_check" CHECK (
    "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "source_evidence_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "suggestion_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND "prepared_request_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "derived_economics_hash" ~ '^sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_agent_review_approval_requests_charge_check"
    CHECK ("maximum_charge_atomic" >= 0),
  CONSTRAINT "tokenless_agent_review_approval_requests_status_check"
    CHECK ("status" IN ('pending', 'approved', 'denied', 'invalidated', 'expired', 'consumed')),
  CONSTRAINT "tokenless_agent_review_approval_requests_owner_decision_check"
    CHECK ("owner_decision" IS NULL OR "owner_decision" IN ('approved', 'denied')),
  CONSTRAINT "tokenless_agent_review_approval_requests_decision_tuple_check" CHECK (
    (
      "owner_decision" IS NULL AND "decided_by" IS NULL
      AND "decision_note" IS NULL AND "decided_at" IS NULL
    )
    OR (
      "owner_decision" IS NOT NULL AND "decided_by" IS NOT NULL AND "decided_at" IS NOT NULL
    )
  ),
  CONSTRAINT "tokenless_agent_review_approval_requests_invalidation_tuple_check" CHECK (
    ("invalidated_by" IS NULL AND "invalidated_at" IS NULL)
    OR ("invalidated_by" IS NOT NULL AND "invalidated_at" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_agent_review_approval_requests_consumption_tuple_check" CHECK (
    ("consumed_at" IS NULL AND "consumption_reference" IS NULL)
    OR ("consumed_at" IS NOT NULL AND "consumption_reference" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_agent_review_approval_requests_state_tuple_check" CHECK (
    (
      "status" = 'pending' AND "owner_decision" IS NULL
      AND "invalidated_at" IS NULL AND "expired_at" IS NULL AND "consumed_at" IS NULL
    )
    OR (
      "status" = 'approved' AND "owner_decision" = 'approved'
      AND "invalidated_at" IS NULL AND "expired_at" IS NULL AND "consumed_at" IS NULL
    )
    OR (
      "status" = 'denied' AND "owner_decision" = 'denied'
      AND "invalidated_at" IS NULL AND "expired_at" IS NULL AND "consumed_at" IS NULL
    )
    OR (
      "status" = 'invalidated' AND ("owner_decision" IS NULL OR "owner_decision" = 'approved')
      AND "invalidated_at" IS NOT NULL AND "expired_at" IS NULL AND "consumed_at" IS NULL
    )
    OR (
      "status" = 'expired' AND ("owner_decision" IS NULL OR "owner_decision" = 'approved')
      AND "invalidated_at" IS NULL AND "expired_at" IS NOT NULL AND "consumed_at" IS NULL
    )
    OR (
      "status" = 'consumed' AND "owner_decision" = 'approved'
      AND "invalidated_at" IS NULL AND "expired_at" IS NULL AND "consumed_at" IS NOT NULL
    )
  ),
  CONSTRAINT "tokenless_agent_review_approval_requests_timestamps_check" CHECK (
    "expires_at" > "created_at"
    AND ("decided_at" IS NULL OR ("decided_at" >= "created_at" AND "decided_at" <= "expires_at"))
    AND ("invalidated_at" IS NULL OR "invalidated_at" >= COALESCE("decided_at", "created_at"))
    AND ("expired_at" IS NULL OR "expired_at" >= "expires_at")
    AND ("consumed_at" IS NULL OR (
      "decided_at" IS NOT NULL AND "consumed_at" >= "decided_at" AND "consumed_at" <= "expires_at"
    ))
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_agent_review_approval_requests_actionable_opportunity_idx"
  ON "tokenless_agent_review_approval_requests" USING btree ("workspace_id", "opportunity_id")
  WHERE "status" IN ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_approval_requests_status_expiry_idx"
  ON "tokenless_agent_review_approval_requests" USING btree ("workspace_id", "status", "expires_at")
  WHERE "status" IN ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_approval_requests_profile_idx"
  ON "tokenless_agent_review_approval_requests" USING btree
  ("workspace_id", "request_profile_id", "request_profile_version", "created_at");
