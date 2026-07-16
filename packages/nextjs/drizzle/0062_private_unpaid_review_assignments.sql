CREATE TABLE "tokenless_private_unpaid_review_deliveries" (
  "delivery_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "integration_id" text NOT NULL REFERENCES "tokenless_agent_integrations"("integration_id"),
  "opportunity_id" text NOT NULL,
  "private_review_id" text NOT NULL REFERENCES "tokenless_private_review_requests"("private_review_id"),
  "operation_hash" text NOT NULL,
  "request_profile_id" text NOT NULL,
  "request_profile_version" integer NOT NULL,
  "request_profile_hash" text NOT NULL,
  "private_group_id" text NOT NULL,
  "private_group_policy_version" integer NOT NULL,
  "private_group_policy_hash" text NOT NULL,
  "cohort_id" text NOT NULL,
  "cohort_binding_hash" text NOT NULL,
  "foundation_binding_hash" text NOT NULL,
  "membership_snapshot_hash" text NOT NULL,
  "snapshot_cutoff_at" timestamp with time zone NOT NULL,
  "response_deadline" timestamp with time zone NOT NULL,
  "panel_size" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_private_unpaid_review_deliveries_opportunity_fk"
    FOREIGN KEY ("workspace_id", "opportunity_id")
    REFERENCES "tokenless_agent_review_opportunity_lifecycles"("workspace_id", "opportunity_id"),
  CONSTRAINT "tokenless_private_unpaid_review_deliveries_profile_fk"
    FOREIGN KEY ("workspace_id", "request_profile_id", "request_profile_version")
    REFERENCES "tokenless_agent_review_request_profiles"("workspace_id", "profile_id", "version"),
  CONSTRAINT "tokenless_private_unpaid_review_deliveries_group_policy_fk"
    FOREIGN KEY ("private_group_id", "private_group_policy_version", "private_group_policy_hash")
    REFERENCES "tokenless_private_group_policy_versions"("group_id", "version", "policy_hash"),
  CONSTRAINT "tokenless_private_unpaid_review_deliveries_cohort_fk"
    FOREIGN KEY ("project_id", "cohort_id")
    REFERENCES "tokenless_assurance_cohorts"("project_id", "cohort_id"),
  CONSTRAINT "tokenless_private_unpaid_review_deliveries_opportunity_unique"
    UNIQUE ("workspace_id", "opportunity_id"),
  CONSTRAINT "tokenless_private_unpaid_review_deliveries_foundation_unique"
    UNIQUE ("workspace_id", "private_review_id"),
  CONSTRAINT "tokenless_private_unpaid_review_deliveries_operation_unique"
    UNIQUE ("workspace_id", "operation_hash"),
  CONSTRAINT "tokenless_private_unpaid_review_deliveries_status_check"
    CHECK ("status" IN ('pending', 'completed', 'inconclusive', 'failed_terminal')),
  CONSTRAINT "tokenless_private_unpaid_review_deliveries_panel_check"
    CHECK ("panel_size" BETWEEN 1 AND 100),
  CONSTRAINT "tokenless_private_unpaid_review_deliveries_deadline_check"
    CHECK ("response_deadline" > "snapshot_cutoff_at"),
  CONSTRAINT "tokenless_private_unpaid_review_deliveries_hashes_check" CHECK (
    "operation_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "private_group_policy_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "cohort_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "foundation_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "membership_snapshot_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_private_unpaid_review_deliveries_state_idx"
  ON "tokenless_private_unpaid_review_deliveries" USING btree
  ("workspace_id", "status", "response_deadline");--> statement-breakpoint

CREATE TABLE "tokenless_private_unpaid_review_assignments" (
  "assignment_id" text PRIMARY KEY NOT NULL,
  "delivery_id" text NOT NULL REFERENCES "tokenless_private_unpaid_review_deliveries"("delivery_id"),
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "private_review_id" text NOT NULL REFERENCES "tokenless_private_review_requests"("private_review_id"),
  "cohort_id" text NOT NULL,
  "private_group_id" text NOT NULL REFERENCES "tokenless_private_groups"("group_id"),
  "reviewer_account_address" text NOT NULL,
  "membership_joined_at" timestamp with time zone NOT NULL,
  "membership_expires_at" timestamp with time zone,
  "membership_allowed_projects_hash" text NOT NULL,
  "qualification_snapshot_json" text NOT NULL,
  "membership_snapshot_hash" text NOT NULL,
  "snapshot_cutoff_at" timestamp with time zone NOT NULL,
  "reservation_expires_at" timestamp with time zone NOT NULL,
  "response_deadline" timestamp with time zone NOT NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "accepted_at" timestamp with time zone,
  "assignment_expires_at" timestamp with time zone,
  "lease_state" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_private_unpaid_review_assignments_cohort_reviewer_fk"
    FOREIGN KEY ("project_id", "cohort_id", "reviewer_account_address")
    REFERENCES "tokenless_assurance_cohort_reviewers"
    ("project_id", "cohort_id", "reviewer_account_address"),
  CONSTRAINT "tokenless_private_unpaid_review_assignments_membership_fk"
    FOREIGN KEY ("private_group_id", "reviewer_account_address")
    REFERENCES "tokenless_private_group_memberships"("group_id", "principal_address"),
  CONSTRAINT "tokenless_private_unpaid_review_assignments_reviewer_unique"
    UNIQUE ("delivery_id", "reviewer_account_address"),
  CONSTRAINT "tokenless_private_unpaid_review_assignments_status_check"
    CHECK ("status" IN ('reserved', 'accepted', 'expired', 'completed')),
  CONSTRAINT "tokenless_private_unpaid_review_assignments_lease_check"
    CHECK ("lease_state" IN ('pending', 'issued', 'recovery_required', 'expired')),
  CONSTRAINT "tokenless_private_unpaid_review_assignments_deadline_check" CHECK (
    "reservation_expires_at" > "snapshot_cutoff_at"
    AND "reservation_expires_at" <= "response_deadline"
    AND (
      ("status" IN ('reserved', 'expired') AND "accepted_at" IS NULL AND "assignment_expires_at" IS NULL)
      OR (
        "status" IN ('accepted', 'completed')
        AND "accepted_at" IS NOT NULL
        AND "assignment_expires_at" = "response_deadline"
        AND "accepted_at" < "assignment_expires_at"
      )
    )
  ),
  CONSTRAINT "tokenless_private_unpaid_review_assignments_membership_expiry_check"
    CHECK ("membership_expires_at" IS NULL OR "membership_expires_at" >= "response_deadline"),
  CONSTRAINT "tokenless_private_unpaid_review_assignments_hashes_check" CHECK (
    "membership_allowed_projects_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "membership_snapshot_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_private_unpaid_review_assignments_reviewer_state_idx"
  ON "tokenless_private_unpaid_review_assignments" USING btree
  ("reviewer_account_address", "status", "reservation_expires_at");--> statement-breakpoint
CREATE INDEX "tokenless_private_unpaid_review_assignments_delivery_idx"
  ON "tokenless_private_unpaid_review_assignments" USING btree
  ("delivery_id", "status", "updated_at");
