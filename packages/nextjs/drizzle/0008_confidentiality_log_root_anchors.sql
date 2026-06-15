ALTER TABLE "confidentiality_log_roots" ADD COLUMN "artifact_json" text;
--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" ADD COLUMN "anchor_chain_id" integer;
--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" ADD COLUMN "anchor_contract" text;
--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" ADD COLUMN "anchor_tx_hash" text;
--> statement-breakpoint
ALTER TABLE "confidentiality_log_roots" ADD COLUMN "anchor_published_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "confidentiality_log_roots_anchor_tx_idx" ON "confidentiality_log_roots" USING btree ("anchor_tx_hash");
