ALTER TABLE "tokenless_chain_executions"
  ADD COLUMN "claim_owner" text;--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions"
  ADD COLUMN "claim_token" text;--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions"
  ADD COLUMN "claim_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions"
  ADD COLUMN "claim_fencing_token" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_chain_executions"
  ADD CONSTRAINT "tokenless_chain_executions_claim_fencing_token_check"
  CHECK ("claim_fencing_token" BETWEEN 0 AND 2147483647);--> statement-breakpoint
CREATE INDEX "tokenless_chain_executions_claim_idx"
  ON "tokenless_chain_executions" USING btree ("claim_owner", "claim_expires_at");
