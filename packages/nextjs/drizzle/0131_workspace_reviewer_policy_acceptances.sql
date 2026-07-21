ALTER TABLE "tokenless_workspace_agent_setups"
  DROP CONSTRAINT "tokenless_workspace_agent_setups_people_invitation_id_fkey";--> statement-breakpoint

UPDATE "tokenless_workspace_agent_setups" setup
SET "people_invitation_id" = NULL
WHERE "people_invitation_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "tokenless_workspace_reviewer_invitations" invitation
    WHERE invitation."workspace_id" = setup."workspace_id"
      AND invitation."invitation_id" = setup."people_invitation_id"
  );--> statement-breakpoint

ALTER TABLE "tokenless_workspace_agent_setups"
  ADD CONSTRAINT "tokenless_workspace_agent_setups_people_invitation_id_fk"
  FOREIGN KEY ("people_invitation_id", "workspace_id")
  REFERENCES "tokenless_workspace_reviewer_invitations"("invitation_id", "workspace_id")
  ON DELETE RESTRICT;--> statement-breakpoint

ALTER TABLE "tokenless_private_unpaid_review_assignments"
  DROP CONSTRAINT "tokenless_private_unpaid_review_assignments_membership_fk";--> statement-breakpoint

ALTER TABLE "tokenless_private_group_policy_acceptances"
  DROP CONSTRAINT "tokenless_private_group_policy_acceptances_membership_fk",
  ADD COLUMN "workspace_id" text,
  ADD COLUMN "workspace_reviewer_access_grant_id" text,
  ADD COLUMN "workspace_reviewer_access_grant_hash" text,
  ADD CONSTRAINT "tokenless_private_group_policy_acceptances_workspace_grant_check" CHECK (
    ("workspace_reviewer_access_grant_id" IS NULL AND "workspace_reviewer_access_grant_hash" IS NULL)
    OR ("workspace_reviewer_access_grant_id" IS NOT NULL AND "workspace_reviewer_access_grant_hash" IS NOT NULL)
  ),
  ADD CONSTRAINT "tokenless_private_group_policy_acceptances_workspace_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT;--> statement-breakpoint

UPDATE "tokenless_private_group_policy_acceptances" acceptance
SET "workspace_id" = private_group."workspace_id"
FROM "tokenless_private_groups" private_group
WHERE private_group."group_id" = acceptance."group_id";--> statement-breakpoint

ALTER TABLE "tokenless_private_group_policy_acceptances"
  ALTER COLUMN "workspace_id" SET NOT NULL,
  ADD CONSTRAINT "tokenless_private_group_policy_acceptances_workspace_grant_fk"
    FOREIGN KEY ("workspace_id", "workspace_reviewer_access_grant_id", "workspace_reviewer_access_grant_hash")
    REFERENCES "tokenless_workspace_reviewer_access_grants"("workspace_id", "grant_id", "grant_hash")
    ON DELETE RESTRICT;--> statement-breakpoint

UPDATE "tokenless_private_group_policy_acceptances" acceptance
SET "workspace_reviewer_access_grant_id" = assignment."workspace_reviewer_access_grant_id",
    "workspace_reviewer_access_grant_hash" = assignment."workspace_reviewer_access_grant_hash"
FROM "tokenless_private_unpaid_review_assignments" assignment
WHERE assignment."assignment_id" = acceptance."accepted_from_assignment_id"
  AND assignment."workspace_reviewer_access_grant_id" IS NOT NULL
  AND assignment."workspace_reviewer_access_grant_hash" IS NOT NULL;
