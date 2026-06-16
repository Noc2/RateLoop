-- Confidential context rows are keyed by ContentRegistry-local content IDs. Keep
-- legacy rows unscoped and make new rows include the active ContentRegistry
-- deployment so redeployments can safely reuse content IDs.
ALTER TABLE "question_image_attachments" ADD COLUMN "deployment_key" text;--> statement-breakpoint
ALTER TABLE "question_image_attachments" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "question_image_attachments" ADD COLUMN "content_registry_address" text;--> statement-breakpoint
CREATE INDEX "question_image_attachments_deployment_content_idx" ON "question_image_attachments" USING btree ("deployment_key","content_id");--> statement-breakpoint

ALTER TABLE "question_details" ADD COLUMN "deployment_key" text;--> statement-breakpoint
ALTER TABLE "question_details" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "question_details" ADD COLUMN "content_registry_address" text;--> statement-breakpoint
CREATE INDEX "question_details_deployment_content_idx" ON "question_details" USING btree ("deployment_key","content_id");--> statement-breakpoint

ALTER TABLE "question_confidentiality" ADD COLUMN "deployment_key" text;--> statement-breakpoint
ALTER TABLE "question_confidentiality" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "question_confidentiality" ADD COLUMN "content_registry_address" text;--> statement-breakpoint
ALTER TABLE "question_confidentiality" DROP CONSTRAINT "question_confidentiality_pkey";--> statement-breakpoint
CREATE UNIQUE INDEX "question_confidentiality_deployment_content_unique" ON "question_confidentiality" USING btree ("deployment_key","content_id");--> statement-breakpoint
CREATE INDEX "question_confidentiality_deployment_content_idx" ON "question_confidentiality" USING btree ("deployment_key","content_id");--> statement-breakpoint
CREATE INDEX "question_confidentiality_deployment_gated_published_idx" ON "question_confidentiality" USING btree ("deployment_key","gated","published_at");--> statement-breakpoint

ALTER TABLE "confidentiality_terms_acceptances" ADD COLUMN "deployment_key" text;--> statement-breakpoint
ALTER TABLE "confidentiality_terms_acceptances" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "confidentiality_terms_acceptances" ADD COLUMN "content_registry_address" text;--> statement-breakpoint
DROP INDEX IF EXISTS "confidentiality_terms_wallet_content_terms_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "confidentiality_terms_deployment_wallet_content_terms_unique" ON "confidentiality_terms_acceptances" USING btree ("deployment_key","wallet_address","content_id","terms_version");--> statement-breakpoint
CREATE INDEX "confidentiality_terms_deployment_content_identity_idx" ON "confidentiality_terms_acceptances" USING btree ("deployment_key","content_id","identity_key");--> statement-breakpoint

ALTER TABLE "confidential_context_access_logs" ADD COLUMN "deployment_key" text;--> statement-breakpoint
ALTER TABLE "confidential_context_access_logs" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "confidential_context_access_logs" ADD COLUMN "content_registry_address" text;--> statement-breakpoint
CREATE INDEX "confidential_access_deployment_content_viewed_idx" ON "confidential_context_access_logs" USING btree ("deployment_key","content_id","viewed_at");--> statement-breakpoint
CREATE INDEX "confidential_access_deployment_identity_content_idx" ON "confidential_context_access_logs" USING btree ("deployment_key","identity_key","content_id");--> statement-breakpoint

ALTER TABLE "confidentiality_breach_reports" ADD COLUMN "deployment_key" text;--> statement-breakpoint
ALTER TABLE "confidentiality_breach_reports" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "confidentiality_breach_reports" ADD COLUMN "content_registry_address" text;--> statement-breakpoint
CREATE INDEX "confidentiality_breach_deployment_content_status_idx" ON "confidentiality_breach_reports" USING btree ("deployment_key","content_id","status");
