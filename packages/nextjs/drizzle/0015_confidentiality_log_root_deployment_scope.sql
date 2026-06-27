ALTER TABLE "confidentiality_log_roots" ADD COLUMN "deployment_key" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" ADD COLUMN "chain_id" integer;--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" ADD COLUMN "content_registry_address" text;--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" DROP CONSTRAINT "confidentiality_log_roots_pkey";--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" ADD CONSTRAINT "confidentiality_log_roots_deployment_epoch_pk" PRIMARY KEY ("deployment_key","epoch");--> statement-breakpoint
CREATE INDEX "confidentiality_log_roots_deployment_published_idx" ON "confidentiality_log_roots" USING btree ("deployment_key","published_at");
