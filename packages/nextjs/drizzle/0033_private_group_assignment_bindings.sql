ALTER TABLE "tokenless_assurance_cohorts"
  ADD COLUMN "private_group_id" text REFERENCES "tokenless_private_groups"("group_id");--> statement-breakpoint
CREATE INDEX "tokenless_assurance_cohorts_private_group_idx"
  ON "tokenless_assurance_cohorts" USING btree ("project_id", "private_group_id", "status");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels"
  ADD COLUMN "private_group_id" text REFERENCES "tokenless_private_groups"("group_id");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels"
  ADD COLUMN "private_group_policy_version" integer;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels"
  ADD COLUMN "private_group_policy_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels"
  ADD CONSTRAINT "tokenless_assurance_run_subpanels_private_group_policy_fk"
  FOREIGN KEY ("private_group_id", "private_group_policy_version")
  REFERENCES "tokenless_private_group_policy_versions"("group_id", "version");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_run_subpanels"
  ADD CONSTRAINT "tokenless_assurance_run_subpanels_private_group_binding_check" CHECK (
    ("private_group_id" IS NULL AND "private_group_policy_version" IS NULL AND "private_group_policy_hash" IS NULL)
    OR ("private_group_id" IS NOT NULL AND "private_group_policy_version" IS NOT NULL AND "private_group_policy_hash" IS NOT NULL)
  );--> statement-breakpoint
CREATE INDEX "tokenless_assurance_run_subpanels_private_group_idx"
  ON "tokenless_assurance_run_subpanels" USING btree ("private_group_id", "run_id");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments"
  ADD COLUMN "private_group_id" text REFERENCES "tokenless_private_groups"("group_id");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments"
  ADD COLUMN "private_group_policy_version" integer;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments"
  ADD COLUMN "private_group_policy_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments"
  ADD COLUMN "private_group_membership_joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments"
  ADD CONSTRAINT "tokenless_assurance_assignments_private_group_policy_fk"
  FOREIGN KEY ("private_group_id", "private_group_policy_version")
  REFERENCES "tokenless_private_group_policy_versions"("group_id", "version");--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments"
  ADD CONSTRAINT "tokenless_assurance_assignments_private_group_binding_check" CHECK (
    ("private_group_id" IS NULL AND "private_group_policy_version" IS NULL
      AND "private_group_policy_hash" IS NULL AND "private_group_membership_joined_at" IS NULL)
    OR ("private_group_id" IS NOT NULL AND "private_group_policy_version" IS NOT NULL
      AND "private_group_policy_hash" IS NOT NULL AND "private_group_membership_joined_at" IS NOT NULL)
  );--> statement-breakpoint
CREATE INDEX "tokenless_assurance_assignments_private_group_reviewer_idx"
  ON "tokenless_assurance_assignments" USING btree
  ("private_group_id", "reviewer_account_address", "status", "created_at");
