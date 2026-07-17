CREATE TABLE "tokenless_reviewer_expertise_definitions" (
  "definition_id" text NOT NULL,
  "version" integer NOT NULL,
  "scope" text NOT NULL,
  "workspace_id" text REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "slug" text NOT NULL,
  "label" text NOT NULL,
  "description" text NOT NULL,
  "network_eligible" boolean DEFAULT false NOT NULL,
  "definition_hash" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "superseded_at" timestamp with time zone,
  CONSTRAINT "tokenless_reviewer_expertise_definitions_pk"
    PRIMARY KEY ("definition_id", "version"),
  CONSTRAINT "tokenless_reviewer_expertise_definitions_hash_unique"
    UNIQUE ("definition_id", "version", "definition_hash"),
  CONSTRAINT "tokenless_reviewer_expertise_definitions_version_check"
    CHECK ("version" >= 1),
  CONSTRAINT "tokenless_reviewer_expertise_definitions_scope_check" CHECK (
    ("scope" = 'global' AND "workspace_id" IS NULL)
    OR ("scope" = 'workspace' AND "workspace_id" IS NOT NULL AND "network_eligible" = false)
  ),
  CONSTRAINT "tokenless_reviewer_expertise_definitions_text_check" CHECK (
    "definition_id" ~ '^expd_[a-z0-9_]{3,120}$'
    AND "slug" ~ '^[a-z0-9][a-z0-9:-]{2,95}$'
    AND char_length("label") BETWEEN 1 AND 80
    AND char_length("description") BETWEEN 1 AND 500
  ),
  CONSTRAINT "tokenless_reviewer_expertise_definitions_hash_check"
    CHECK ("definition_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_reviewer_expertise_definitions_status_check"
    CHECK ("status" IN ('active', 'retired')),
  CONSTRAINT "tokenless_reviewer_expertise_definitions_supersession_check"
    CHECK ("superseded_at" IS NULL OR "superseded_at" >= "created_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_reviewer_expertise_definitions_current_unique"
  ON "tokenless_reviewer_expertise_definitions" USING btree ("definition_id")
  WHERE "superseded_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_reviewer_expertise_definitions_global_slug_unique"
  ON "tokenless_reviewer_expertise_definitions" USING btree ("slug")
  WHERE "scope" = 'global' AND "superseded_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_reviewer_expertise_definitions_workspace_slug_unique"
  ON "tokenless_reviewer_expertise_definitions" USING btree ("workspace_id", "slug")
  WHERE "scope" = 'workspace' AND "superseded_at" IS NULL;--> statement-breakpoint
CREATE INDEX "tokenless_reviewer_expertise_definitions_catalog_idx"
  ON "tokenless_reviewer_expertise_definitions" USING btree
  ("scope", "workspace_id", "status", "network_eligible", "label");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_expertise_definition_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'expertise definition versions are immutable';
  END IF;
  IF OLD."superseded_at" IS NOT NULL
     OR NEW."superseded_at" IS NULL
     OR NEW."superseded_at" < OLD."created_at"
     OR NEW."definition_id" IS DISTINCT FROM OLD."definition_id"
     OR NEW."version" IS DISTINCT FROM OLD."version"
     OR NEW."scope" IS DISTINCT FROM OLD."scope"
     OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
     OR NEW."slug" IS DISTINCT FROM OLD."slug"
     OR NEW."label" IS DISTINCT FROM OLD."label"
     OR NEW."description" IS DISTINCT FROM OLD."description"
     OR NEW."network_eligible" IS DISTINCT FROM OLD."network_eligible"
     OR NEW."definition_hash" IS DISTINCT FROM OLD."definition_hash"
     OR NEW."status" IS DISTINCT FROM OLD."status"
     OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'expertise definition versions may only be superseded once';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_reviewer_expertise_definitions_immutable"
  BEFORE UPDATE OR DELETE ON "tokenless_reviewer_expertise_definitions"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_expertise_definition_version"();--> statement-breakpoint

INSERT INTO "tokenless_reviewer_expertise_definitions"
  ("definition_id", "version", "scope", "workspace_id", "slug", "label", "description",
   "network_eligible", "definition_hash", "status", "created_by", "created_at", "superseded_at")
VALUES
  ('expd_code_review_typescript', 1, 'global', NULL, 'code-review:typescript',
   'TypeScript code review',
   'Review TypeScript code for correctness, maintainability, and idiomatic use.',
   true, 'sha256:d7ce3c64d658e128cdb7b8944c4fd61360068c7e99c01a40884b14918095208f',
   'active', 'system:expertise-catalog', '2026-07-17T00:00:00Z', NULL),
  ('expd_code_review_security', 1, 'global', NULL, 'code-review:security',
   'Application security review',
   'Review application code and architecture for security risks and unsafe behavior.',
   true, 'sha256:08e3abe65ac462828efeb6a0254c4041635f692bc5be9096879dd2065e4d86c2',
   'active', 'system:expertise-catalog', '2026-07-17T00:00:00Z', NULL),
  ('expd_finance_broker_dealer', 1, 'global', NULL, 'finance:broker-dealer-supervision',
   'Broker-dealer supervision',
   'Apply broker-dealer supervisory knowledge to regulated financial workflows.',
   true, 'sha256:d6cc75487e91d3af9e4864344c5128fc4513bfa74a7cd1498e90943cdfec3d49',
   'active', 'system:expertise-catalog', '2026-07-17T00:00:00Z', NULL),
  ('expd_finance_investment_advisory', 1, 'global', NULL, 'finance:investment-advisory',
   'Investment advisory',
   'Apply investment-advisory knowledge to regulated financial workflows.',
   true, 'sha256:f367a4b9856c6900e5b54808723a9a738f4383832806d5146e3539f5aeeb6bca',
   'active', 'system:expertise-catalog', '2026-07-17T00:00:00Z', NULL),
  ('expd_legal_privacy_compliance', 1, 'global', NULL, 'legal:privacy-compliance',
   'Privacy compliance',
   'Review handling of personal data against applicable privacy requirements.',
   true, 'sha256:42ea0ecb5d8be3c1fa3da0e0dbe69f87902c6ada55d63549ac16976e779f8aac',
   'active', 'system:expertise-catalog', '2026-07-17T00:00:00Z', NULL),
  ('expd_operations_customer_support', 1, 'global', NULL, 'operations:customer-support',
   'Customer support operations',
   'Review customer-support workflows for operational correctness and service quality.',
   true, 'sha256:393434685317316748a85043bf6dc3a47c80303298fc1546051820c059bd8d2b',
   'active', 'system:expertise-catalog', '2026-07-17T00:00:00Z', NULL);--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD COLUMN "semantic_schema_version" integer DEFAULT 1 NOT NULL,
  ADD COLUMN "expertise_requirements_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_semantic_schema_check"
    CHECK ("semantic_schema_version" IN (1, 2, 3)),
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_expertise_requirements_check" CHECK (
    jsonb_typeof("expertise_requirements_json"::jsonb) = 'array'
    AND (
      ("semantic_schema_version" IN (1, 2) AND "expertise_requirements_json" = '[]')
      OR ("semantic_schema_version" = 3 AND "required_expertise_keys_json" = '[]')
    )
  );--> statement-breakpoint

ALTER TABLE "tokenless_reviewer_qualifications"
  ADD COLUMN "expertise_record_schema_version" integer,
  ADD COLUMN "expertise_definition_id" text,
  ADD COLUMN "expertise_definition_version" integer,
  ADD COLUMN "expertise_definition_hash" text,
  ADD COLUMN "source_invitation_id" text REFERENCES "tokenless_private_group_invitations"("invitation_id") ON DELETE RESTRICT,
  ADD COLUMN "asserted_by" text,
  ADD COLUMN "revoked_by" text;--> statement-breakpoint
UPDATE "tokenless_reviewer_qualifications"
SET "expertise_record_schema_version" = 1
WHERE "qualification_kind" = 'expertise';--> statement-breakpoint
ALTER TABLE "tokenless_reviewer_qualifications"
  ADD CONSTRAINT "tokenless_reviewer_qualifications_expertise_definition_fk"
    FOREIGN KEY ("expertise_definition_id", "expertise_definition_version", "expertise_definition_hash")
    REFERENCES "tokenless_reviewer_expertise_definitions"
      ("definition_id", "version", "definition_hash") ON DELETE RESTRICT,
  ADD CONSTRAINT "tokenless_reviewer_qualifications_invitation_definition_unique"
    UNIQUE ("qualification_id", "source_invitation_id", "expertise_definition_id",
      "expertise_definition_version", "expertise_definition_hash"),
  ADD CONSTRAINT "tokenless_reviewer_qualifications_expertise_record_check" CHECK (
    (
      "qualification_kind" <> 'expertise'
      AND "expertise_record_schema_version" IS NULL
      AND "expertise_definition_id" IS NULL
      AND "expertise_definition_version" IS NULL
      AND "expertise_definition_hash" IS NULL
      AND "source_invitation_id" IS NULL
      AND "asserted_by" IS NULL
      AND "revoked_by" IS NULL
    )
    OR (
      "qualification_kind" = 'expertise'
      AND "expertise_record_schema_version" = 1
      AND "expertise_definition_id" IS NULL
      AND "expertise_definition_version" IS NULL
      AND "expertise_definition_hash" IS NULL
      AND "source_invitation_id" IS NULL
      AND "asserted_by" IS NULL
      AND "revoked_by" IS NULL
    )
    OR (
      "qualification_kind" = 'expertise'
      AND "expertise_record_schema_version" = 2
      AND "expertise_definition_id" IS NOT NULL
      AND "expertise_definition_version" IS NOT NULL
      AND "expertise_definition_hash" IS NOT NULL
      AND "asserted_by" IS NOT NULL
      AND "qualification_keys_json" = '[]'
      AND "expires_at" IS NOT NULL
      AND "expires_at" > "verified_at"
      AND "expires_at" <= "verified_at" + INTERVAL '2 years'
      AND (
        ("status" = 'active' AND "revoked_at" IS NULL AND "revoked_by" IS NULL)
        OR ("status" = 'revoked' AND "revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL)
      )
    )
  );--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_reviewer_qualifications_active_invited_exact_expertise_unique"
  ON "tokenless_reviewer_qualifications" USING btree
  ("workspace_id", "reviewer_account_address", "expertise_definition_id", "expertise_definition_version")
  WHERE "qualification_kind" = 'expertise'
    AND "expertise_record_schema_version" = 2
    AND "reviewer_source" = 'customer_invited'
    AND "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_reviewer_qualifications_active_network_exact_expertise_unique"
  ON "tokenless_reviewer_qualifications" USING btree
  ("rater_id", "expertise_definition_id", "expertise_definition_version")
  WHERE "qualification_kind" = 'expertise'
    AND "expertise_record_schema_version" = 2
    AND "reviewer_source" = 'rateloop_network'
    AND "status" = 'active';--> statement-breakpoint

CREATE TABLE "tokenless_private_group_invitation_expertise_attestations" (
  "attestation_id" text PRIMARY KEY NOT NULL,
  "invitation_id" text NOT NULL REFERENCES "tokenless_private_group_invitations"("invitation_id") ON DELETE RESTRICT,
  "expertise_definition_id" text NOT NULL,
  "expertise_definition_version" integer NOT NULL,
  "expertise_definition_hash" text NOT NULL,
  "asserted_by" text NOT NULL,
  "asserted_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "evidence_reference_hash" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "materialized_qualification_id" text REFERENCES "tokenless_reviewer_qualifications"("qualification_id") ON DELETE RESTRICT,
  "materialized_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "revoked_by" text,
  CONSTRAINT "tokenless_private_group_invitation_expertise_definition_fk"
    FOREIGN KEY ("expertise_definition_id", "expertise_definition_version", "expertise_definition_hash")
    REFERENCES "tokenless_reviewer_expertise_definitions"
      ("definition_id", "version", "definition_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_private_group_invitation_expertise_materialization_fk"
    FOREIGN KEY ("materialized_qualification_id", "invitation_id", "expertise_definition_id",
      "expertise_definition_version", "expertise_definition_hash")
    REFERENCES "tokenless_reviewer_qualifications"
      ("qualification_id", "source_invitation_id", "expertise_definition_id",
       "expertise_definition_version", "expertise_definition_hash") ON DELETE RESTRICT,
  CONSTRAINT "tokenless_private_group_invitation_expertise_unique"
    UNIQUE ("invitation_id", "expertise_definition_id", "expertise_definition_version"),
  CONSTRAINT "tokenless_private_group_invitation_expertise_id_check"
    CHECK ("attestation_id" ~ '^pgiea_[a-z0-9]{16,64}$'),
  CONSTRAINT "tokenless_private_group_invitation_expertise_evidence_check"
    CHECK ("evidence_reference_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_private_group_invitation_expertise_lifetime_check" CHECK (
    "expires_at" > "asserted_at"
    AND "expires_at" <= "asserted_at" + INTERVAL '2 years'
  ),
  CONSTRAINT "tokenless_private_group_invitation_expertise_state_check" CHECK (
    (
      "status" = 'pending'
      AND "materialized_qualification_id" IS NULL
      AND "materialized_at" IS NULL
      AND "revoked_at" IS NULL
      AND "revoked_by" IS NULL
    )
    OR (
      "status" = 'materialized'
      AND "materialized_qualification_id" IS NOT NULL
      AND "materialized_at" IS NOT NULL
      AND "revoked_at" IS NULL
      AND "revoked_by" IS NULL
    )
    OR (
      "status" = 'revoked'
      AND "revoked_at" IS NOT NULL
      AND "revoked_by" IS NOT NULL
    )
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_private_group_invitation_expertise_pending_idx"
  ON "tokenless_private_group_invitation_expertise_attestations" USING btree
  ("invitation_id", "status", "expires_at");--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_validate_invitation_expertise_attestation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  invitation_record RECORD;
  definition_record RECORD;
BEGIN
  SELECT "workspace_id", "maximum_redemptions", "redemption_count",
         "intended_account_address", "intended_email_hash", "revoked_at"
    INTO invitation_record
    FROM "tokenless_private_group_invitations"
   WHERE "invitation_id" = NEW."invitation_id"
   FOR SHARE;

  IF NOT FOUND
     OR invitation_record."maximum_redemptions" <> 1
     OR (invitation_record."intended_account_address" IS NULL AND invitation_record."intended_email_hash" IS NULL)
     OR invitation_record."redemption_count" <> 0
     OR invitation_record."revoked_at" IS NOT NULL THEN
    RAISE EXCEPTION 'expertise attestations require one live, bound, single-redemption invitation';
  END IF;

  SELECT "scope", "workspace_id", "status", "superseded_at"
    INTO definition_record
    FROM "tokenless_reviewer_expertise_definitions"
   WHERE "definition_id" = NEW."expertise_definition_id"
     AND "version" = NEW."expertise_definition_version"
     AND "definition_hash" = NEW."expertise_definition_hash"
   FOR SHARE;

  IF NOT FOUND
     OR definition_record."status" <> 'active'
     OR definition_record."superseded_at" IS NOT NULL
     OR (definition_record."scope" = 'workspace'
         AND definition_record."workspace_id" <> invitation_record."workspace_id") THEN
    RAISE EXCEPTION 'expertise definition is not active in the invitation workspace';
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_private_group_invitation_expertise_validate"
  BEFORE INSERT OR UPDATE OF "invitation_id", "expertise_definition_id", "expertise_definition_version",
    "expertise_definition_hash", "expires_at"
  ON "tokenless_private_group_invitation_expertise_attestations"
  FOR EACH ROW
  WHEN (NEW."status" = 'pending')
  EXECUTE FUNCTION "tokenless_validate_invitation_expertise_attestation"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_guard_expertise_invitation_binding"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."revoked_at" IS NULL
     AND EXISTS (
       SELECT 1
         FROM "tokenless_private_group_invitation_expertise_attestations" a
        WHERE a."invitation_id" = NEW."invitation_id"
          AND a."status" = 'pending'
          AND (
            NEW."maximum_redemptions" <> 1
            OR (NEW."intended_account_address" IS NULL AND NEW."intended_email_hash" IS NULL)
            OR NEW."redemption_count" > 1
          )
     ) THEN
    RAISE EXCEPTION 'a live expertise invitation must remain bound and single-redemption';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_private_group_invitations_expertise_binding_guard"
  BEFORE UPDATE OF "maximum_redemptions", "intended_account_address", "intended_email_hash", "expires_at", "revoked_at"
  ON "tokenless_private_group_invitations"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_guard_expertise_invitation_binding"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "tokenless_validate_exact_expertise_qualification"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  definition_record RECORD;
  invitation_record RECORD;
BEGIN
  IF NEW."qualification_kind" <> 'expertise' OR NEW."expertise_record_schema_version" <> 2 THEN
    RETURN NEW;
  END IF;

  SELECT "scope", "workspace_id", "network_eligible", "status", "superseded_at"
    INTO definition_record
    FROM "tokenless_reviewer_expertise_definitions"
   WHERE "definition_id" = NEW."expertise_definition_id"
     AND "version" = NEW."expertise_definition_version"
     AND "definition_hash" = NEW."expertise_definition_hash"
   FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exact expertise definition was not found';
  END IF;

  IF NEW."status" = 'active'
     AND (definition_record."status" <> 'active' OR definition_record."superseded_at" IS NOT NULL) THEN
    RAISE EXCEPTION 'new active expertise qualifications require the current active definition';
  END IF;

  IF definition_record."scope" = 'workspace' THEN
    IF NEW."workspace_id" IS DISTINCT FROM definition_record."workspace_id"
       OR NEW."reviewer_source" <> 'customer_invited'
       OR NEW."reviewer_account_address" IS NULL
       OR NEW."rater_id" IS NOT NULL
       OR NEW."evidence_kind" <> 'owner_attested'
       OR NEW."source_invitation_id" IS NULL THEN
      RAISE EXCEPTION 'workspace expertise must remain an owner-attested invited-reviewer qualification';
    END IF;
  ELSIF NEW."reviewer_source" = 'rateloop_network' THEN
    IF definition_record."network_eligible" <> true
       OR NEW."workspace_id" IS NOT NULL
       OR NEW."rater_id" IS NULL
       OR NEW."reviewer_account_address" IS NOT NULL
       OR NEW."evidence_kind" <> 'platform_verified_credential'
       OR NEW."source_invitation_id" IS NOT NULL THEN
      RAISE EXCEPTION 'network expertise must use a platform-verified global definition';
    END IF;
  ELSE
    IF NEW."reviewer_source" <> 'customer_invited'
       OR NEW."workspace_id" IS NULL
       OR NEW."reviewer_account_address" IS NULL
       OR NEW."rater_id" IS NOT NULL
       OR NEW."evidence_kind" <> 'owner_attested'
       OR NEW."source_invitation_id" IS NULL THEN
      RAISE EXCEPTION 'global expertise for an invited reviewer must remain workspace owner-attested';
    END IF;
  END IF;

  IF NEW."reviewer_source" = 'customer_invited' THEN
    SELECT i."workspace_id", i."group_id"
      INTO invitation_record
      FROM "tokenless_private_group_invitations" i
     WHERE i."invitation_id" = NEW."source_invitation_id"
     FOR SHARE;
    IF NOT FOUND
       OR invitation_record."workspace_id" IS DISTINCT FROM NEW."workspace_id"
       OR NOT EXISTS (
         SELECT 1
           FROM "tokenless_private_group_memberships" m
          WHERE m."group_id" = invitation_record."group_id"
            AND m."principal_address" = NEW."reviewer_account_address"
            AND m."source_invitation_id" = NEW."source_invitation_id"
            AND m."status" = 'active'
            AND (m."membership_expires_at" IS NULL OR NEW."expires_at" <= m."membership_expires_at")
       ) THEN
      RAISE EXCEPTION 'invited expertise must remain bound to the redeemed active membership';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "tokenless_reviewer_qualifications_exact_expertise_validate"
  BEFORE INSERT OR UPDATE OF "reviewer_source", "qualification_kind", "evidence_kind", "workspace_id",
    "rater_id", "reviewer_account_address", "status", "expertise_record_schema_version",
    "expertise_definition_id", "expertise_definition_version", "expertise_definition_hash",
    "source_invitation_id", "asserted_by", "verified_at", "expires_at", "qualification_keys_json"
  ON "tokenless_reviewer_qualifications"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_validate_exact_expertise_qualification"();
