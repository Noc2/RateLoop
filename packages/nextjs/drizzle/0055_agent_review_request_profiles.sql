ALTER TABLE "tokenless_private_groups"
  ADD CONSTRAINT "tokenless_private_groups_workspace_group_unique"
  UNIQUE ("workspace_id", "group_id");--> statement-breakpoint
ALTER TABLE "tokenless_private_group_policy_versions"
  ADD CONSTRAINT "tokenless_private_group_policy_versions_exact_tuple_unique"
  UNIQUE ("group_id", "version", "policy_hash");--> statement-breakpoint
CREATE TABLE "tokenless_agent_review_request_profiles" (
  "profile_id" text NOT NULL,
  "version" integer NOT NULL,
  "workspace_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "agent_version_id" text NOT NULL,
  "criterion" text NOT NULL,
  "positive_label" text NOT NULL,
  "negative_label" text NOT NULL,
  "rationale_mode" text NOT NULL,
  "audience" text NOT NULL,
  "content_boundary" text NOT NULL,
  "private_sensitivity" text,
  "private_group_id" text,
  "private_group_policy_version" integer,
  "private_group_policy_hash" text,
  "response_window_seconds" integer NOT NULL,
  "panel_size" integer NOT NULL,
  "compensation_mode" text NOT NULL,
  "bounty_per_seat_atomic" numeric(78, 0),
  "configuration_status" text DEFAULT 'action_required' NOT NULL,
  "profile_hash" text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "approved_by" text,
  "approved_at" timestamp with time zone,
  "superseded_at" timestamp with time zone,
  CONSTRAINT "tokenless_agent_review_request_profiles_pk" PRIMARY KEY ("profile_id", "version"),
  CONSTRAINT "tokenless_agent_review_request_profiles_workspace_unique"
    UNIQUE ("workspace_id", "profile_id", "version"),
  CONSTRAINT "tokenless_agent_review_request_profiles_hash_unique" UNIQUE ("workspace_id", "profile_hash"),
  CONSTRAINT "tokenless_agent_review_request_profiles_version_check" CHECK ("version" >= 1),
  CONSTRAINT "tokenless_agent_review_request_profiles_criterion_check"
    CHECK (char_length("criterion") BETWEEN 1 AND 500),
  CONSTRAINT "tokenless_agent_review_request_profiles_labels_check" CHECK (
    "positive_label" ~ '^.{1,40}$'
    AND "negative_label" ~ '^.{1,40}$'
    AND "positive_label" <> "negative_label"
  ),
  CONSTRAINT "tokenless_agent_review_request_profiles_rationale_check"
    CHECK ("rationale_mode" IN ('off', 'optional', 'required')),
  CONSTRAINT "tokenless_agent_review_request_profiles_audience_check"
    CHECK ("audience" IN ('private_invited', 'public_network', 'hybrid')),
  CONSTRAINT "tokenless_agent_review_request_profiles_content_check" CHECK (
    ("content_boundary" = 'public_or_test' AND "private_sensitivity" IS NULL)
    OR (
      "content_boundary" = 'private_workspace'
      AND "audience" = 'private_invited'
      AND "private_sensitivity" IS NOT NULL
      AND "private_sensitivity" IN ('internal', 'confidential', 'restricted', 'regulated')
    )
  ),
  CONSTRAINT "tokenless_agent_review_request_profiles_group_tuple_check" CHECK (
    ("private_group_id" IS NULL AND "private_group_policy_version" IS NULL AND "private_group_policy_hash" IS NULL)
    OR (
      "private_group_id" IS NOT NULL
      AND "private_group_policy_version" IS NOT NULL
      AND "private_group_policy_hash" IS NOT NULL
    )
  ),
  CONSTRAINT "tokenless_agent_review_request_profiles_response_window_check"
    CHECK ("response_window_seconds" BETWEEN 1200 AND 86400),
  CONSTRAINT "tokenless_agent_review_request_profiles_panel_check" CHECK ("panel_size" BETWEEN 1 AND 100),
  CONSTRAINT "tokenless_agent_review_request_profiles_compensation_check" CHECK (
    ("compensation_mode" = 'unpaid' AND "bounty_per_seat_atomic" IS NULL)
    OR (
      "compensation_mode" = 'usdc'
      AND (
        (
          "audience" = 'private_invited'
          AND "bounty_per_seat_atomic" IS NOT NULL
          AND "bounty_per_seat_atomic" > 0
        )
        OR (
          "audience" IN ('public_network', 'hybrid')
          AND ("bounty_per_seat_atomic" IS NULL OR "bounty_per_seat_atomic" > 0)
        )
      )
    )
  ),
  CONSTRAINT "tokenless_agent_review_request_profiles_configuration_check"
    CHECK ("configuration_status" IN ('ready', 'action_required')),
  CONSTRAINT "tokenless_agent_review_request_profiles_ready_check" CHECK (
    "configuration_status" = 'action_required'
    OR (
      "approved_by" IS NOT NULL
      AND "approved_at" IS NOT NULL
      AND (
        (
          "audience" = 'private_invited'
          AND "private_group_id" IS NOT NULL
          AND (
            ("compensation_mode" = 'unpaid' AND "bounty_per_seat_atomic" IS NULL)
            OR (
              "compensation_mode" = 'usdc'
              AND "bounty_per_seat_atomic" IS NOT NULL
              AND "bounty_per_seat_atomic" > 0
            )
          )
        )
        OR (
          "audience" = 'public_network'
          AND "content_boundary" = 'public_or_test'
          AND "private_sensitivity" IS NULL
          AND "private_group_id" IS NULL
          AND "compensation_mode" = 'usdc'
          AND "bounty_per_seat_atomic" IS NOT NULL
          AND "bounty_per_seat_atomic" > 0
          AND "panel_size" >= 3
        )
        OR (
          "audience" = 'hybrid'
          AND "content_boundary" = 'public_or_test'
          AND "private_sensitivity" IS NULL
          AND "private_group_id" IS NOT NULL
          AND "compensation_mode" = 'usdc'
          AND "bounty_per_seat_atomic" IS NOT NULL
          AND "bounty_per_seat_atomic" > 0
          AND "panel_size" >= 3
        )
      )
    )
  ),
  CONSTRAINT "tokenless_agent_review_request_profiles_hash_check"
    CHECK ("profile_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_agent_review_request_profiles_approval_tuple_check" CHECK (
    ("approved_by" IS NULL AND "approved_at" IS NULL)
    OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_agent_review_request_profiles_lifecycle_check" CHECK (
    ("approved_at" IS NULL OR "approved_at" >= "created_at")
    AND ("superseded_at" IS NULL OR "superseded_at" >= COALESCE("approved_at", "created_at"))
  ),
  CONSTRAINT "tokenless_agent_review_request_profiles_agent_version_fk"
    FOREIGN KEY ("workspace_id", "agent_id", "agent_version_id")
    REFERENCES "tokenless_agent_versions" ("workspace_id", "agent_id", "version_id"),
  CONSTRAINT "tokenless_agent_review_request_profiles_workspace_group_fk"
    FOREIGN KEY ("workspace_id", "private_group_id")
    REFERENCES "tokenless_private_groups" ("workspace_id", "group_id"),
  CONSTRAINT "tokenless_agent_review_request_profiles_group_policy_fk"
    FOREIGN KEY ("private_group_id", "private_group_policy_version", "private_group_policy_hash")
    REFERENCES "tokenless_private_group_policy_versions" ("group_id", "version", "policy_hash")
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_agent_review_request_profiles_active_idx"
  ON "tokenless_agent_review_request_profiles" USING btree ("profile_id")
  WHERE "superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_request_profiles_workspace_agent_idx"
  ON "tokenless_agent_review_request_profiles" USING btree
  ("workspace_id", "agent_id", "agent_version_id", "configuration_status", "created_at");
