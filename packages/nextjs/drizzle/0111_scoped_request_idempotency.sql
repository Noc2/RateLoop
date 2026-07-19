ALTER TABLE "tokenless_agent_asks"
  ADD COLUMN "idempotency_scope" text;--> statement-breakpoint
UPDATE "tokenless_agent_asks"
SET "idempotency_scope" = CASE
  WHEN ownership."api_key_id" IS NOT NULL THEN
    'workspace:' || ownership."workspace_id" || ':api_key:' || ownership."api_key_id"
  WHEN ownership."owner_account_address" IS NOT NULL THEN
    'workspace:' || ownership."workspace_id" || ':account:' || lower(ownership."owner_account_address")
  ELSE 'legacy:' || "tokenless_agent_asks"."operation_key"
END
FROM "tokenless_ask_ownership" ownership
WHERE ownership."operation_key" = "tokenless_agent_asks"."operation_key";--> statement-breakpoint
UPDATE "tokenless_agent_asks"
SET "idempotency_scope" = 'legacy:' || "operation_key"
WHERE "idempotency_scope" IS NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_asks"
  ALTER COLUMN "idempotency_scope" SET NOT NULL,
  ALTER COLUMN "idempotency_scope" SET DEFAULT 'legacy:global';--> statement-breakpoint
ALTER TABLE "tokenless_agent_asks"
  DROP CONSTRAINT "tokenless_agent_asks_idempotency_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_agent_asks_scope_idempotency_unique"
  ON "tokenless_agent_asks" USING btree ("idempotency_scope", "idempotency_key");--> statement-breakpoint
CREATE INDEX "tokenless_agent_asks_idempotency_key_idx"
  ON "tokenless_agent_asks" USING btree ("idempotency_key");--> statement-breakpoint

ALTER TABLE "tokenless_rater_commits"
  DROP CONSTRAINT "tokenless_rater_commits_idempotency_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_rater_commits_voucher_idempotency_unique"
  ON "tokenless_rater_commits" USING btree ("voucher_id", "request_idempotency_key");
