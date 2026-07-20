ALTER TABLE "tokenless_surprise_bounty_entitlements"
  ADD COLUMN "transfer_signed_transaction" text;--> statement-breakpoint
ALTER TABLE "tokenless_surprise_bounty_entitlements"
  ADD COLUMN "transaction_recovery_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_surprise_bounty_entitlements"
  ALTER COLUMN "transaction_recovery_version" SET DEFAULT 1;--> statement-breakpoint
ALTER TABLE "tokenless_surprise_bounty_entitlements"
  ADD CONSTRAINT "tokenless_surprise_bounty_entitlements_transfer_signed_transaction_check"
  CHECK ("transfer_signed_transaction" IS NULL OR "transfer_signed_transaction" ~ '^0x[0-9a-f]+$');--> statement-breakpoint
ALTER TABLE "tokenless_surprise_bounty_entitlements"
  ADD CONSTRAINT "tokenless_surprise_bounty_entitlements_transaction_recovery_version_check"
  CHECK ("transaction_recovery_version" IN (0, 1));
