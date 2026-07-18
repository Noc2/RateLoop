ALTER TABLE "tokenless_scheduled_work_items"
  ADD COLUMN "claim_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_scheduled_work_items"
  ADD CONSTRAINT "tokenless_scheduled_work_items_claim_generation_check"
  CHECK ("claim_generation" BETWEEN 0 AND 2147483647);--> statement-breakpoint
CREATE INDEX "tokenless_scheduled_work_items_claim_idx"
  ON "tokenless_scheduled_work_items" USING btree
  ("state", "updated_at", "claim_generation");
