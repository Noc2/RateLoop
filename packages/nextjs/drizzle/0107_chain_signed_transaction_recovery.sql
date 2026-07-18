ALTER TABLE "tokenless_chain_executions"
  ADD COLUMN "approval_signed_transaction" text;--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions"
  ADD COLUMN "submission_signed_transaction" text;--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions"
  ADD COLUMN "transaction_recovery_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions"
  ADD CONSTRAINT "tokenless_chain_executions_approval_signed_transaction_check"
  CHECK ("approval_signed_transaction" IS NULL OR "approval_signed_transaction" ~ '^0x[0-9a-f]+$');--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions"
  ADD CONSTRAINT "tokenless_chain_executions_submission_signed_transaction_check"
  CHECK ("submission_signed_transaction" IS NULL OR "submission_signed_transaction" ~ '^0x[0-9a-f]+$');--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions"
  ADD CONSTRAINT "tokenless_chain_executions_transaction_recovery_version_check"
  CHECK ("transaction_recovery_version" IN (0, 1));
