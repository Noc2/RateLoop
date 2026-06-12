-- Legacy rows intentionally keep deployment_key NULL because contract-local content IDs
-- cannot be mapped safely across redeploys after the fact. If feedback was written
-- against the current deployment between a contract redeploy and this migration,
-- recover it manually by filtering those NULL-key rows by created_at and setting
-- deployment_key/content_registry_address/feedback_registry_address to the known
-- deployment values before relying on the scoped read/dedupe paths.
ALTER TABLE "content_feedback" ADD COLUMN "deployment_key" text;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD COLUMN "content_registry_address" text;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD COLUMN "feedback_registry_address" text;--> statement-breakpoint
DROP INDEX IF EXISTS "content_feedback_feedback_hash_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "content_feedback_active_author_round_unique";--> statement-breakpoint
CREATE INDEX "content_feedback_deployment_content_created_at_idx" ON "content_feedback" USING btree ("deployment_key","content_id","created_at");--> statement-breakpoint
CREATE INDEX "content_feedback_deployment_content_round_idx" ON "content_feedback" USING btree ("deployment_key","content_id","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_feedback_deployment_feedback_hash_unique" ON "content_feedback" USING btree ("deployment_key","feedback_hash") WHERE "content_feedback"."deployment_key" IS NOT NULL AND "content_feedback"."feedback_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "content_feedback_deployment_active_author_round_unique" ON "content_feedback" USING btree ("deployment_key","content_id","round_id","author_address") WHERE "content_feedback"."deployment_key" IS NOT NULL AND "content_feedback"."deleted_at" IS NULL;
