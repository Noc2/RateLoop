CREATE TABLE "tokenless_private_review_requests" (
  "private_review_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id"),
  "project_id" text NOT NULL REFERENCES "tokenless_assurance_projects"("project_id"),
  "integration_id" text NOT NULL REFERENCES "tokenless_agent_integrations"("integration_id"),
  "caller_credential_kind" text NOT NULL,
  "caller_credential_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "request_profile_id" text NOT NULL,
  "request_profile_version" integer NOT NULL,
  "request_profile_hash" text NOT NULL,
  "private_group_id" text NOT NULL,
  "private_group_policy_version" integer NOT NULL,
  "private_group_policy_hash" text NOT NULL,
  "group_allowlist_hash" text NOT NULL,
  "group_allowlist_status" text NOT NULL,
  "cohort_id" text NOT NULL,
  "cohort_binding_hash" text NOT NULL,
  "project_binding_hash" text NOT NULL,
  "lane" text DEFAULT 'private' NOT NULL,
  "task_kind" text DEFAULT 'binary_review' NOT NULL,
  "task_commitment" text NOT NULL,
  "private_sensitivity" text NOT NULL,
  "planned_source_artifact_id" text NOT NULL,
  "planned_source_object_id" text NOT NULL,
  "planned_suggestion_artifact_id" text NOT NULL,
  "planned_suggestion_object_id" text NOT NULL,
  "source_artifact_id" text REFERENCES "tokenless_assurance_artifacts"("artifact_id"),
  "suggestion_artifact_id" text REFERENCES "tokenless_assurance_artifacts"("artifact_id"),
  "response_window_seconds" integer NOT NULL,
  "response_deadline" timestamp with time zone NOT NULL,
  "binding_hash" text NOT NULL,
  "foundation_status" text NOT NULL,
  "preparation_lease_id" text,
  "preparation_lease_expires_at" timestamp with time zone,
  "preparation_attempt_count" integer DEFAULT 1 NOT NULL,
  "preparation_upload_ids_json" text NOT NULL,
  "last_preparation_error_code" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_private_review_requests_idempotency_unique"
    UNIQUE ("integration_id", "idempotency_key"),
  CONSTRAINT "tokenless_private_review_requests_binding_unique" UNIQUE ("workspace_id", "binding_hash"),
  CONSTRAINT "tokenless_private_review_requests_profile_fk"
    FOREIGN KEY ("workspace_id", "request_profile_id", "request_profile_version")
    REFERENCES "tokenless_agent_review_request_profiles"("workspace_id", "profile_id", "version"),
  CONSTRAINT "tokenless_private_review_requests_group_policy_fk"
    FOREIGN KEY ("private_group_id", "private_group_policy_version", "private_group_policy_hash")
    REFERENCES "tokenless_private_group_policy_versions"("group_id", "version", "policy_hash"),
  CONSTRAINT "tokenless_private_review_requests_cohort_fk"
    FOREIGN KEY ("project_id", "cohort_id")
    REFERENCES "tokenless_assurance_cohorts"("project_id", "cohort_id"),
  CONSTRAINT "tokenless_private_review_requests_credential_check" CHECK (
    "caller_credential_kind" IN ('api_key', 'oauth_token_family')
    AND "caller_credential_id" <> ''
  ),
  CONSTRAINT "tokenless_private_review_requests_lane_check" CHECK ("lane" = 'private'),
  CONSTRAINT "tokenless_private_review_requests_task_check" CHECK ("task_kind" = 'binary_review'),
  CONSTRAINT "tokenless_private_review_requests_sensitivity_check"
    CHECK ("private_sensitivity" IN ('internal', 'confidential', 'restricted', 'regulated')),
  CONSTRAINT "tokenless_private_review_requests_planned_artifacts_check" CHECK (
    "planned_source_artifact_id" <> "planned_suggestion_artifact_id"
    AND "planned_source_object_id" <> "planned_suggestion_object_id"
  ),
  CONSTRAINT "tokenless_private_review_requests_artifacts_check" CHECK (
    ("source_artifact_id" IS NULL AND "suggestion_artifact_id" IS NULL)
    OR (
      "source_artifact_id" = "planned_source_artifact_id"
      AND "suggestion_artifact_id" = "planned_suggestion_artifact_id"
      AND "source_artifact_id" <> "suggestion_artifact_id"
    )
  ),
  CONSTRAINT "tokenless_private_review_requests_response_window_check"
    CHECK ("response_window_seconds" BETWEEN 1200 AND 86400 AND "response_deadline" > "created_at"),
  CONSTRAINT "tokenless_private_review_requests_allowlist_check"
    CHECK ("group_allowlist_status" IN ('allowed', 'excluded')),
  CONSTRAINT "tokenless_private_review_requests_preparation_check" CHECK (
    "preparation_attempt_count" >= 1
    AND (
      (
        "foundation_status" = 'preparing'
        AND "source_artifact_id" IS NULL
        AND "suggestion_artifact_id" IS NULL
        AND "preparation_lease_id" IS NOT NULL
        AND "preparation_lease_expires_at" IS NOT NULL
      )
      OR (
        "foundation_status" = 'failed_recoverable'
        AND "source_artifact_id" IS NULL
        AND "suggestion_artifact_id" IS NULL
        AND "preparation_lease_id" IS NULL
        AND "preparation_lease_expires_at" IS NULL
      )
      OR (
        "group_allowlist_status" = 'allowed'
        AND "foundation_status" = 'ready_for_assignment'
        AND "source_artifact_id" IS NOT NULL
        AND "suggestion_artifact_id" IS NOT NULL
        AND "preparation_lease_id" IS NULL
        AND "preparation_lease_expires_at" IS NULL
      )
      OR (
        "group_allowlist_status" = 'excluded'
        AND "foundation_status" = 'awaiting_owner_rebind'
        AND "source_artifact_id" IS NOT NULL
        AND "suggestion_artifact_id" IS NOT NULL
        AND "preparation_lease_id" IS NULL
        AND "preparation_lease_expires_at" IS NULL
      )
    )
  ),
  CONSTRAINT "tokenless_private_review_requests_hashes_check" CHECK (
    "request_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "request_profile_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "private_group_policy_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "group_allowlist_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "cohort_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "project_binding_hash" ~ '^sha256:[0-9a-f]{64}$'
    AND "task_commitment" ~ '^sha256:[0-9a-f]{64}$'
    AND "binding_hash" ~ '^sha256:[0-9a-f]{64}$'
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_private_review_requests_project_status_idx"
  ON "tokenless_private_review_requests" USING btree
  ("workspace_id", "project_id", "foundation_status", "created_at");--> statement-breakpoint
CREATE INDEX "tokenless_private_review_requests_group_status_idx"
  ON "tokenless_private_review_requests" USING btree
  ("private_group_id", "group_allowlist_status", "created_at");--> statement-breakpoint
CREATE INDEX "tokenless_private_review_requests_cohort_deadline_idx"
  ON "tokenless_private_review_requests" USING btree
  ("project_id", "cohort_id", "response_deadline");--> statement-breakpoint
CREATE INDEX "tokenless_private_review_requests_preparation_lease_idx"
  ON "tokenless_private_review_requests" USING btree
  ("foundation_status", "preparation_lease_expires_at");
