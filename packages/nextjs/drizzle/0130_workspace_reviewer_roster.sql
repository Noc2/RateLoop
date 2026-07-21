ALTER TABLE "tokenless_workspace_member_invites"
  ALTER COLUMN "governance_role" DROP NOT NULL,
  DROP CONSTRAINT "tokenless_workspace_member_invites_governance_role_check",
  ADD COLUMN "token_prefix" text,
  ADD COLUMN "intended_email_hash" text,
  ADD CONSTRAINT "tokenless_workspace_member_invites_governance_role_check"
    CHECK (
      "governance_role" IS NULL
      OR "governance_role" IN ('consultant', 'end_client', 'decision_owner', 'billing')
    ),
  ADD CONSTRAINT "tokenless_workspace_member_invites_token_prefix_check"
    CHECK ("token_prefix" IS NULL OR "token_prefix" ~ '^[a-f0-9]{16}$'),
  ADD CONSTRAINT "tokenless_workspace_member_invites_email_hash_check"
    CHECK ("intended_email_hash" IS NULL OR "intended_email_hash" ~ '^[a-f0-9]{64}$');--> statement-breakpoint

CREATE TABLE "tokenless_workspace_reviewers" (
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "principal_address" text NOT NULL REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "status" text DEFAULT 'active' NOT NULL,
  "activated_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "end_reason" text,
  "created_by" text NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("workspace_id", "principal_address"),
  CONSTRAINT "tokenless_workspace_reviewers_status_check"
    CHECK ("status" IN ('active', 'removed', 'left', 'expired')),
  CONSTRAINT "tokenless_workspace_reviewers_terminal_check" CHECK (
    ("status" = 'active' AND "ended_at" IS NULL AND "end_reason" IS NULL)
    OR ("status" <> 'active' AND "ended_at" IS NOT NULL AND "end_reason" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_reviewers_principal_status_idx"
  ON "tokenless_workspace_reviewers" USING btree
  ("principal_address", "status", "updated_at");--> statement-breakpoint

CREATE TABLE "tokenless_workspace_reviewer_invitations" (
  "invitation_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "token_hash" text NOT NULL,
  "token_prefix" text NOT NULL,
  "project_scope" text NOT NULL,
  "max_private_sensitivity" text NOT NULL,
  "intended_account_address" text,
  "intended_email_hash" text,
  "intended_email_domain" text,
  "access_expires_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  "maximum_redemptions" integer DEFAULT 1 NOT NULL,
  "redemption_count" integer DEFAULT 0 NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_reviewer_invitations_token_unique" UNIQUE ("token_hash"),
  CONSTRAINT "tokenless_workspace_reviewer_invitations_workspace_unique"
    UNIQUE ("invitation_id", "workspace_id"),
  CONSTRAINT "tokenless_workspace_reviewer_invitations_prefix_check"
    CHECK ("token_prefix" ~ '^[a-f0-9]{16}$'),
  CONSTRAINT "tokenless_workspace_reviewer_invitations_scope_check"
    CHECK ("project_scope" IN ('all', 'selected')),
  CONSTRAINT "tokenless_workspace_reviewer_invitations_sensitivity_check"
    CHECK ("max_private_sensitivity" IN ('internal', 'confidential', 'restricted', 'regulated')),
  CONSTRAINT "tokenless_workspace_reviewer_invitations_email_hash_check"
    CHECK ("intended_email_hash" IS NULL OR "intended_email_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "tokenless_workspace_reviewer_invitations_redemption_check" CHECK (
    "maximum_redemptions" BETWEEN 1 AND 1000
    AND "redemption_count" BETWEEN 0 AND "maximum_redemptions"
  ),
  CONSTRAINT "tokenless_workspace_reviewer_invitations_lifetime_check" CHECK (
    "expires_at" > "created_at"
    AND ("access_expires_at" IS NULL OR "access_expires_at" > "created_at")
  ),
  CONSTRAINT "tokenless_workspace_reviewer_invitations_revocation_check" CHECK (
    ("revoked_at" IS NULL AND "revoked_by" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_reviewer_invitations_workspace_state_idx"
  ON "tokenless_workspace_reviewer_invitations" USING btree
  ("workspace_id", "expires_at", "revoked_at", "created_at");--> statement-breakpoint
CREATE INDEX "tokenless_workspace_reviewer_invitations_prefix_idx"
  ON "tokenless_workspace_reviewer_invitations" USING btree ("token_prefix");--> statement-breakpoint

CREATE TABLE "tokenless_workspace_reviewer_invitation_projects" (
  "invitation_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  PRIMARY KEY ("invitation_id", "project_id"),
  FOREIGN KEY ("invitation_id", "workspace_id")
    REFERENCES "tokenless_workspace_reviewer_invitations"("invitation_id", "workspace_id") ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects"("workspace_id", "project_id") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_reviewer_invitation_projects_workspace_idx"
  ON "tokenless_workspace_reviewer_invitation_projects" USING btree
  ("workspace_id", "project_id", "invitation_id");--> statement-breakpoint

CREATE TABLE "tokenless_workspace_reviewer_access_grants" (
  "grant_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "principal_address" text NOT NULL,
  "project_scope" text NOT NULL,
  "max_private_sensitivity" text NOT NULL,
  "valid_from" timestamp with time zone NOT NULL,
  "valid_until" timestamp with time zone,
  "source_invitation_id" text,
  "grant_hash" text NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  FOREIGN KEY ("workspace_id", "principal_address")
    REFERENCES "tokenless_workspace_reviewers"("workspace_id", "principal_address") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_workspace_reviewer_access_grants_exact_unique"
    UNIQUE ("workspace_id", "grant_id", "grant_hash"),
  CONSTRAINT "tokenless_workspace_reviewer_access_grants_workspace_unique"
    UNIQUE ("grant_id", "workspace_id"),
  CONSTRAINT "tokenless_workspace_reviewer_access_grants_invitation_unique"
    UNIQUE ("source_invitation_id", "grant_id"),
  FOREIGN KEY ("source_invitation_id", "workspace_id")
    REFERENCES "tokenless_workspace_reviewer_invitations"("invitation_id", "workspace_id") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_workspace_reviewer_access_grants_scope_check"
    CHECK ("project_scope" IN ('all', 'selected')),
  CONSTRAINT "tokenless_workspace_reviewer_access_grants_sensitivity_check"
    CHECK ("max_private_sensitivity" IN ('internal', 'confidential', 'restricted', 'regulated')),
  CONSTRAINT "tokenless_workspace_reviewer_access_grants_hash_check"
    CHECK ("grant_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_workspace_reviewer_access_grants_lifetime_check"
    CHECK ("valid_until" IS NULL OR "valid_until" > "valid_from"),
  CONSTRAINT "tokenless_workspace_reviewer_access_grants_revocation_check" CHECK (
    ("revoked_at" IS NULL AND "revoked_by" IS NULL)
    OR ("revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_reviewer_access_grants_candidate_idx"
  ON "tokenless_workspace_reviewer_access_grants" USING btree
  ("workspace_id", "principal_address", "revoked_at", "valid_until", "max_private_sensitivity");--> statement-breakpoint
CREATE INDEX "tokenless_workspace_reviewer_access_grants_invitation_idx"
  ON "tokenless_workspace_reviewer_access_grants" USING btree
  ("source_invitation_id", "principal_address");--> statement-breakpoint

CREATE TABLE "tokenless_workspace_reviewer_access_grant_projects" (
  "grant_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "project_id" text NOT NULL,
  PRIMARY KEY ("grant_id", "project_id"),
  FOREIGN KEY ("grant_id", "workspace_id")
    REFERENCES "tokenless_workspace_reviewer_access_grants"("grant_id", "workspace_id") ON DELETE RESTRICT,
  FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "tokenless_assurance_projects"("workspace_id", "project_id") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX "tokenless_reviewer_grant_projects_candidate_idx"
  ON "tokenless_workspace_reviewer_access_grant_projects" USING btree
  ("workspace_id", "project_id", "grant_id");--> statement-breakpoint

-- Preserve every existing reviewer entitlement as an independent immutable grant.
-- Keeping one grant per legacy membership avoids widening access when a reviewer
-- previously belonged to groups with different project or sensitivity limits.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "tokenless_private_group_memberships" membership
    JOIN "tokenless_private_groups" legacy_group ON legacy_group."group_id" = membership."group_id"
    LEFT JOIN "tokenless_principals" principal ON principal."principal_id" = membership."principal_address"
    WHERE membership."status" = 'active' AND legacy_group."status" = 'active' AND principal."principal_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate an active legacy reviewer without an opaque RateLoop principal; resolve legacy identities first.';
  END IF;
END $$;--> statement-breakpoint

WITH "legacy_reviewers" AS (
  SELECT DISTINCT ON (g."workspace_id", m."principal_address")
    g."workspace_id", m."principal_address", m."joined_at", m."created_by", m."updated_at"
  FROM "tokenless_private_group_memberships" m
  JOIN "tokenless_private_groups" g ON g."group_id" = m."group_id"
  JOIN "tokenless_principals" principal ON principal."principal_id" = m."principal_address"
  WHERE m."status" = 'active' AND g."status" = 'active' AND principal."status" = 'active'
  ORDER BY g."workspace_id", m."principal_address", m."joined_at", m."group_id"
)
INSERT INTO "tokenless_workspace_reviewers"
  ("workspace_id", "principal_address", "status", "activated_at", "created_by", "updated_at")
SELECT "workspace_id", "principal_address", 'active', "joined_at", "created_by", "updated_at"
FROM "legacy_reviewers"
ON CONFLICT ("workspace_id", "principal_address") DO NOTHING;--> statement-breakpoint

WITH "legacy_grants" AS (
  SELECT
    g."workspace_id", g."group_id", m."principal_address", m."joined_at", m."membership_expires_at",
    m."created_by", m."allowed_project_ids_json"::jsonb AS "member_projects",
    p."allowed_project_ids_json"::jsonb AS "policy_projects",
    p."max_private_sensitivity"
  FROM "tokenless_private_group_memberships" m
  JOIN "tokenless_private_groups" g ON g."group_id" = m."group_id"
  JOIN "tokenless_private_group_policy_versions" p
    ON p."group_id" = g."group_id" AND p."version" = g."current_policy_version"
  JOIN "tokenless_principals" principal ON principal."principal_id" = m."principal_address"
  WHERE m."status" = 'active' AND g."status" = 'active' AND principal."status" = 'active'
)
INSERT INTO "tokenless_workspace_reviewer_access_grants"
  ("grant_id", "workspace_id", "principal_address", "project_scope", "max_private_sensitivity",
   "valid_from", "valid_until", "source_invitation_id", "grant_hash", "created_by", "created_at")
SELECT
  'wrg_legacy_' || substr(encode(digest(convert_to(
    "workspace_id" || '|' || "group_id" || '|' || "principal_address" || '|' || "joined_at"::text,
    'UTF8'), 'sha256'), 'hex'), 1, 40),
  "workspace_id", "principal_address",
  CASE
    WHEN jsonb_array_length("member_projects") > 0 OR jsonb_array_length("policy_projects") > 0
      THEN 'selected'
    ELSE 'all'
  END,
  "max_private_sensitivity", "joined_at", "membership_expires_at", NULL,
  'sha256:' || encode(digest(convert_to(
    "workspace_id" || '|' || "group_id" || '|' || "principal_address" || '|' || "joined_at"::text || '|' ||
    COALESCE("membership_expires_at"::text, '') || '|' || "member_projects"::text || '|' ||
    "policy_projects"::text || '|' || "max_private_sensitivity",
    'UTF8'), 'sha256'), 'hex'),
  "created_by", "joined_at"
FROM "legacy_grants";--> statement-breakpoint

WITH "legacy_grants" AS (
  SELECT
    g."workspace_id", g."group_id", m."principal_address", m."joined_at",
    m."allowed_project_ids_json"::jsonb AS "member_projects",
    p."allowed_project_ids_json"::jsonb AS "policy_projects"
  FROM "tokenless_private_group_memberships" m
  JOIN "tokenless_private_groups" g ON g."group_id" = m."group_id"
  JOIN "tokenless_private_group_policy_versions" p
    ON p."group_id" = g."group_id" AND p."version" = g."current_policy_version"
  JOIN "tokenless_principals" principal ON principal."principal_id" = m."principal_address"
  WHERE m."status" = 'active' AND g."status" = 'active' AND principal."status" = 'active'
), "effective_projects" AS (
  SELECT DISTINCT
    'wrg_legacy_' || substr(encode(digest(convert_to(
      l."workspace_id" || '|' || l."group_id" || '|' || l."principal_address" || '|' || l."joined_at"::text,
      'UTF8'), 'sha256'), 'hex'), 1, 40) AS "grant_id",
    l."workspace_id", project."project_id"
  FROM "legacy_grants" l
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE
      WHEN jsonb_array_length(l."member_projects") = 0 THEN l."policy_projects"
      WHEN jsonb_array_length(l."policy_projects") = 0 THEN l."member_projects"
      ELSE (
        SELECT COALESCE(jsonb_agg(member_project."value"), '[]'::jsonb)
        FROM jsonb_array_elements_text(l."member_projects") member_project("value")
        WHERE l."policy_projects" ? member_project."value"
      )
    END
  ) project("project_id")
  JOIN "tokenless_assurance_projects" assurance_project
    ON assurance_project."workspace_id" = l."workspace_id"
   AND assurance_project."project_id" = project."project_id"
)
INSERT INTO "tokenless_workspace_reviewer_access_grant_projects" ("grant_id", "workspace_id", "project_id")
SELECT "grant_id", "workspace_id", "project_id" FROM "effective_projects";--> statement-breakpoint

CREATE TABLE "tokenless_workspace_reviewer_invitation_redemptions" (
  "invitation_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "principal_address" text NOT NULL
    REFERENCES "tokenless_principals"("principal_id") ON DELETE RESTRICT,
  "grant_id" text NOT NULL,
  "redeemed_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("invitation_id", "principal_address"),
  FOREIGN KEY ("invitation_id", "workspace_id")
    REFERENCES "tokenless_workspace_reviewer_invitations"("invitation_id", "workspace_id") ON DELETE RESTRICT,
  FOREIGN KEY ("grant_id", "workspace_id")
    REFERENCES "tokenless_workspace_reviewer_access_grants"("grant_id", "workspace_id") ON DELETE RESTRICT,
  FOREIGN KEY ("invitation_id", "grant_id")
    REFERENCES "tokenless_workspace_reviewer_access_grants"("source_invitation_id", "grant_id") ON DELETE RESTRICT
);--> statement-breakpoint
CREATE INDEX "tokenless_reviewer_redemptions_principal_idx"
  ON "tokenless_workspace_reviewer_invitation_redemptions" USING btree
  ("principal_address", "redeemed_at");--> statement-breakpoint

CREATE TABLE "tokenless_workspace_reviewer_terms_versions" (
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "version" integer NOT NULL,
  "terms_hash" text NOT NULL,
  "terms_json" text NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("workspace_id", "version"),
  CONSTRAINT "tokenless_workspace_reviewer_terms_versions_exact_unique"
    UNIQUE ("workspace_id", "version", "terms_hash"),
  CONSTRAINT "tokenless_workspace_reviewer_terms_versions_hash_unique"
    UNIQUE ("workspace_id", "terms_hash"),
  CONSTRAINT "tokenless_workspace_reviewer_terms_versions_version_check"
    CHECK ("version" >= 1 AND "schema_version" >= 1),
  CONSTRAINT "tokenless_workspace_reviewer_terms_versions_hash_check"
    CHECK ("terms_hash" ~ '^sha256:[0-9a-f]{64}$')
);--> statement-breakpoint

CREATE TABLE "tokenless_workspace_reviewer_terms_acceptances" (
  "workspace_id" text NOT NULL,
  "terms_version" integer NOT NULL,
  "terms_hash" text NOT NULL,
  "principal_address" text NOT NULL,
  "accepted_from_assignment_id" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("workspace_id", "terms_version", "principal_address"),
  FOREIGN KEY ("workspace_id", "terms_version", "terms_hash")
    REFERENCES "tokenless_workspace_reviewer_terms_versions"("workspace_id", "version", "terms_hash")
    ON DELETE RESTRICT,
  CONSTRAINT "tokenless_workspace_reviewer_terms_acceptances_hash_check"
    CHECK ("terms_hash" ~ '^sha256:[0-9a-f]{64}$')
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_reviewer_terms_acceptances_principal_idx"
  ON "tokenless_workspace_reviewer_terms_acceptances" USING btree
  ("principal_address", "workspace_id", "terms_version");--> statement-breakpoint

CREATE TABLE "tokenless_workspace_reviewer_events" (
  "event_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "principal_address" text,
  "invitation_id" text,
  "grant_id" text,
  "event_type" text NOT NULL,
  "actor_reference" text NOT NULL,
  "details_json" text DEFAULT '{}' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_workspace_reviewer_events_type_check" CHECK (
    "event_type" IN ('invitation_created', 'invitation_redeemed', 'invitation_revoked',
      'reviewer_removed', 'reviewer_left', 'grant_revoked', 'terms_version_created', 'terms_accepted')
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_workspace_reviewer_events_workspace_created_idx"
  ON "tokenless_workspace_reviewer_events" USING btree
  ("workspace_id", "created_at", "event_id");--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD COLUMN "workspace_reviewer_terms_version" integer,
  ADD COLUMN "workspace_reviewer_terms_hash" text,
  ADD COLUMN "workspace_reviewer_world_id_required" boolean,
  ADD CONSTRAINT "tokenless_review_profiles_reviewer_terms_check" CHECK (
    ("workspace_reviewer_terms_version" IS NULL AND "workspace_reviewer_terms_hash" IS NULL)
    OR ("workspace_reviewer_terms_version" IS NOT NULL AND "workspace_reviewer_terms_hash" IS NOT NULL)
  ),
  ADD CONSTRAINT "tokenless_review_profiles_reviewer_terms_fk"
    FOREIGN KEY ("workspace_id", "workspace_reviewer_terms_version", "workspace_reviewer_terms_hash")
    REFERENCES "tokenless_workspace_reviewer_terms_versions"("workspace_id", "version", "terms_hash")
    ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_assurance_run_subpanels"
  ADD COLUMN "workspace_reviewer_terms_version" integer,
  ADD COLUMN "workspace_reviewer_terms_hash" text,
  ADD CONSTRAINT "tokenless_run_subpanels_reviewer_terms_check" CHECK (
    ("workspace_reviewer_terms_version" IS NULL AND "workspace_reviewer_terms_hash" IS NULL)
    OR ("workspace_reviewer_terms_version" IS NOT NULL AND "workspace_reviewer_terms_hash" IS NOT NULL)
  ),
  ADD CONSTRAINT "tokenless_run_subpanels_reviewer_terms_fk"
    FOREIGN KEY ("workspace_id", "workspace_reviewer_terms_version", "workspace_reviewer_terms_hash")
    REFERENCES "tokenless_workspace_reviewer_terms_versions"("workspace_id", "version", "terms_hash")
    ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_assurance_assignments"
  ADD COLUMN "workspace_reviewer_access_grant_id" text,
  ADD COLUMN "workspace_reviewer_access_grant_hash" text,
  ADD COLUMN "workspace_reviewer_terms_version" integer,
  ADD COLUMN "workspace_reviewer_terms_hash" text,
  ADD CONSTRAINT "tokenless_assurance_assignments_workspace_reviewer_grant_check" CHECK (
    ("workspace_reviewer_access_grant_id" IS NULL AND "workspace_reviewer_access_grant_hash" IS NULL)
    OR ("workspace_reviewer_access_grant_id" IS NOT NULL AND "workspace_reviewer_access_grant_hash" IS NOT NULL)
  ),
  ADD CONSTRAINT "tokenless_assurance_assignments_workspace_reviewer_grant_fk"
    FOREIGN KEY ("workspace_id", "workspace_reviewer_access_grant_id", "workspace_reviewer_access_grant_hash")
    REFERENCES "tokenless_workspace_reviewer_access_grants"("workspace_id", "grant_id", "grant_hash")
    ON DELETE RESTRICT,
  ADD CONSTRAINT "tokenless_assurance_assignments_workspace_reviewer_terms_check" CHECK (
    ("workspace_reviewer_terms_version" IS NULL AND "workspace_reviewer_terms_hash" IS NULL)
    OR ("workspace_reviewer_terms_version" IS NOT NULL AND "workspace_reviewer_terms_hash" IS NOT NULL)
  ),
  ADD CONSTRAINT "tokenless_assurance_assignments_workspace_reviewer_terms_fk"
    FOREIGN KEY ("workspace_id", "workspace_reviewer_terms_version", "workspace_reviewer_terms_hash")
    REFERENCES "tokenless_workspace_reviewer_terms_versions"("workspace_id", "version", "terms_hash")
    ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_private_review_requests"
  ADD COLUMN "workspace_reviewer_terms_version" integer,
  ADD COLUMN "workspace_reviewer_terms_hash" text,
  ADD CONSTRAINT "tokenless_private_reviews_reviewer_terms_check" CHECK (
    ("workspace_reviewer_terms_version" IS NULL AND "workspace_reviewer_terms_hash" IS NULL)
    OR ("workspace_reviewer_terms_version" IS NOT NULL AND "workspace_reviewer_terms_hash" IS NOT NULL)
  ),
  ADD CONSTRAINT "tokenless_private_reviews_reviewer_terms_fk"
    FOREIGN KEY ("workspace_id", "workspace_reviewer_terms_version", "workspace_reviewer_terms_hash")
    REFERENCES "tokenless_workspace_reviewer_terms_versions"("workspace_id", "version", "terms_hash")
    ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_private_unpaid_review_deliveries"
  ADD COLUMN "workspace_reviewer_terms_version" integer,
  ADD COLUMN "workspace_reviewer_terms_hash" text,
  ADD CONSTRAINT "tokenless_private_deliveries_reviewer_terms_check" CHECK (
    ("workspace_reviewer_terms_version" IS NULL AND "workspace_reviewer_terms_hash" IS NULL)
    OR ("workspace_reviewer_terms_version" IS NOT NULL AND "workspace_reviewer_terms_hash" IS NOT NULL)
  ),
  ADD CONSTRAINT "tokenless_private_deliveries_reviewer_terms_fk"
    FOREIGN KEY ("workspace_id", "workspace_reviewer_terms_version", "workspace_reviewer_terms_hash")
    REFERENCES "tokenless_workspace_reviewer_terms_versions"("workspace_id", "version", "terms_hash")
    ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_private_unpaid_review_assignments"
  ADD COLUMN "workspace_reviewer_access_grant_id" text,
  ADD COLUMN "workspace_reviewer_access_grant_hash" text,
  ADD CONSTRAINT "tokenless_private_assignments_reviewer_grant_check" CHECK (
    ("workspace_reviewer_access_grant_id" IS NULL AND "workspace_reviewer_access_grant_hash" IS NULL)
    OR ("workspace_reviewer_access_grant_id" IS NOT NULL AND "workspace_reviewer_access_grant_hash" IS NOT NULL)
  ),
  ADD CONSTRAINT "tokenless_private_assignments_reviewer_grant_fk"
    FOREIGN KEY ("workspace_id", "workspace_reviewer_access_grant_id", "workspace_reviewer_access_grant_hash")
    REFERENCES "tokenless_workspace_reviewer_access_grants"("workspace_id", "grant_id", "grant_hash")
    ON DELETE RESTRICT;
