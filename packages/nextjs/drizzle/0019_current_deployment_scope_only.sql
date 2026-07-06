DELETE FROM "watched_content"
WHERE "deployment_key" IS NULL
   OR "chain_id" IS NULL
   OR "content_registry_address" IS NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "watched_content_legacy_wallet_content_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "watched_content_deployment_wallet_content_unique";--> statement-breakpoint
ALTER TABLE "watched_content" ALTER COLUMN "deployment_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "watched_content" ALTER COLUMN "chain_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "watched_content" ALTER COLUMN "content_registry_address" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "watched_content_deployment_wallet_content_unique" ON "watched_content" USING btree ("deployment_key","wallet_address","content_id");--> statement-breakpoint
DELETE FROM "question_confidentiality"
WHERE "deployment_key" IS NULL
   OR "frontend_address" = '0x0000000000000000000000000000000000000000';--> statement-breakpoint
ALTER TABLE "question_confidentiality" ALTER COLUMN "deployment_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "question_confidentiality" ALTER COLUMN "frontend_address" DROP DEFAULT;--> statement-breakpoint
DELETE FROM "confidentiality_terms_acceptances"
WHERE "deployment_key" IS NULL
   OR "frontend_address" = '0x0000000000000000000000000000000000000000';--> statement-breakpoint
ALTER TABLE "confidentiality_terms_acceptances" ALTER COLUMN "deployment_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "confidentiality_terms_acceptances" ALTER COLUMN "frontend_address" DROP DEFAULT;--> statement-breakpoint
DELETE FROM "confidential_context_access_logs"
WHERE "deployment_key" IS NULL
   OR "frontend_address" = '0x0000000000000000000000000000000000000000';--> statement-breakpoint
ALTER TABLE "confidential_context_access_logs" ALTER COLUMN "deployment_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "confidential_context_access_logs" ALTER COLUMN "frontend_address" DROP DEFAULT;--> statement-breakpoint
DELETE FROM "confidentiality_breach_reports"
WHERE "deployment_key" IS NULL
   OR "frontend_address" = '0x0000000000000000000000000000000000000000';--> statement-breakpoint
ALTER TABLE "confidentiality_breach_reports" ALTER COLUMN "deployment_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "confidentiality_breach_reports" ALTER COLUMN "frontend_address" DROP DEFAULT;--> statement-breakpoint
DELETE FROM "confidentiality_log_roots"
WHERE "deployment_key" = 'legacy'
   OR "frontend_address" = '0x0000000000000000000000000000000000000000';--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" ALTER COLUMN "deployment_key" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" ALTER COLUMN "frontend_address" DROP DEFAULT;
