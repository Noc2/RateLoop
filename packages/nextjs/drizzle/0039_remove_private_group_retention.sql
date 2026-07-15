ALTER TABLE "tokenless_private_group_policy_versions"
  DROP CONSTRAINT "tokenless_private_group_policy_retention_check";--> statement-breakpoint
ALTER TABLE "tokenless_private_group_policy_versions"
  DROP COLUMN "retention_days";
