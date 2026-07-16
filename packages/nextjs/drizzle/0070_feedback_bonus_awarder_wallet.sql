ALTER TABLE "tokenless_feedback_bonus_pools"
  ADD COLUMN "awarder_wallet" text;
--> statement-breakpoint
ALTER TABLE "tokenless_feedback_bonus_pools"
  ADD CONSTRAINT "tokenless_feedback_bonus_pools_awarder_wallet_check"
  CHECK ("awarder_wallet" IS NULL OR "awarder_wallet" ~ '^0x[0-9a-f]{40}$');
