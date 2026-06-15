ALTER TABLE "confidentiality_terms_acceptances" ADD COLUMN "payload_hash" text;
--> statement-breakpoint
ALTER TABLE "confidentiality_terms_acceptances" ADD COLUMN "question_metadata_hash" text;
--> statement-breakpoint
ALTER TABLE "confidentiality_terms_acceptances" ADD COLUMN "content_hash" text;
--> statement-breakpoint
ALTER TABLE "confidentiality_terms_acceptances" ADD COLUMN "details_hash" text;
--> statement-breakpoint
ALTER TABLE "confidentiality_terms_acceptances" ADD COLUMN "media_tuple_hash" text;
--> statement-breakpoint
CREATE INDEX "confidentiality_terms_payload_hash_idx" ON "confidentiality_terms_acceptances" USING btree ("payload_hash");
