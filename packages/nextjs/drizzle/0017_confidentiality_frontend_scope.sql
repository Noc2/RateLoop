ALTER TABLE "question_confidentiality" ADD COLUMN "frontend_address" text NOT NULL;--> statement-breakpoint
ALTER TABLE "confidentiality_terms_acceptances" ADD COLUMN "frontend_address" text NOT NULL;--> statement-breakpoint
ALTER TABLE "confidential_context_access_logs" ADD COLUMN "frontend_address" text NOT NULL;--> statement-breakpoint
ALTER TABLE "confidentiality_breach_reports" ADD COLUMN "frontend_address" text NOT NULL;--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" ADD COLUMN "frontend_address" text NOT NULL;--> statement-breakpoint
DROP INDEX "question_confidentiality_deployment_content_unique";--> statement-breakpoint
DROP INDEX "question_confidentiality_deployment_content_idx";--> statement-breakpoint
DROP INDEX "question_confidentiality_deployment_gated_published_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "question_confidentiality_deployment_content_unique" ON "question_confidentiality" USING btree ("deployment_key","frontend_address","content_id");--> statement-breakpoint
CREATE INDEX "question_confidentiality_deployment_content_idx" ON "question_confidentiality" USING btree ("deployment_key","frontend_address","content_id");--> statement-breakpoint
CREATE INDEX "question_confidentiality_deployment_gated_published_idx" ON "question_confidentiality" USING btree ("deployment_key","frontend_address","gated","published_at");--> statement-breakpoint
DROP INDEX "confidentiality_terms_deployment_wallet_content_terms_unique";--> statement-breakpoint
DROP INDEX "confidentiality_terms_deployment_content_identity_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "confidentiality_terms_deployment_wallet_content_terms_unique" ON "confidentiality_terms_acceptances" USING btree ("deployment_key","frontend_address","wallet_address","content_id","terms_version");--> statement-breakpoint
CREATE INDEX "confidentiality_terms_deployment_content_identity_idx" ON "confidentiality_terms_acceptances" USING btree ("deployment_key","frontend_address","content_id","identity_key");--> statement-breakpoint
DROP INDEX "confidential_access_deployment_content_viewed_idx";--> statement-breakpoint
DROP INDEX "confidential_access_deployment_identity_content_idx";--> statement-breakpoint
CREATE INDEX "confidential_access_deployment_content_viewed_idx" ON "confidential_context_access_logs" USING btree ("deployment_key","frontend_address","content_id","viewed_at");--> statement-breakpoint
CREATE INDEX "confidential_access_deployment_identity_content_idx" ON "confidential_context_access_logs" USING btree ("deployment_key","frontend_address","identity_key","content_id");--> statement-breakpoint
DROP INDEX "confidentiality_breach_deployment_content_status_idx";--> statement-breakpoint
CREATE INDEX "confidentiality_breach_deployment_content_status_idx" ON "confidentiality_breach_reports" USING btree ("deployment_key","frontend_address","content_id","status");--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" DROP CONSTRAINT "confidentiality_log_roots_deployment_epoch_pk";--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" ADD CONSTRAINT "confidentiality_log_roots_deployment_frontend_epoch_pk" PRIMARY KEY ("deployment_key","frontend_address","epoch");--> statement-breakpoint
DROP INDEX "confidentiality_log_roots_deployment_published_idx";--> statement-breakpoint
CREATE INDEX "confidentiality_log_roots_deployment_published_idx" ON "confidentiality_log_roots" USING btree ("deployment_key","frontend_address","published_at");
