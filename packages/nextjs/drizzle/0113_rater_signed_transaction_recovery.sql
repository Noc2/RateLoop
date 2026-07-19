ALTER TABLE "tokenless_rater_commits"
  ADD COLUMN "relay_signed_transaction" text;--> statement-breakpoint
ALTER TABLE "tokenless_rater_commits"
  ADD COLUMN "transaction_recovery_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_rater_commits"
  ALTER COLUMN "transaction_recovery_version" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "tokenless_rater_commits"
  ADD CONSTRAINT "tokenless_rater_commits_relay_signed_transaction_check"
  CHECK ("relay_signed_transaction" IS NULL OR "relay_signed_transaction" ~ '^0x[0-9a-f]+$');--> statement-breakpoint
ALTER TABLE "tokenless_rater_commits"
  ADD CONSTRAINT "tokenless_rater_commits_transaction_recovery_version_check"
  CHECK ("transaction_recovery_version" IN (0, 1));
