ALTER TABLE "question_details" ADD COLUMN "requires_gated_access" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "question_image_attachments" ADD COLUMN "requires_gated_access" boolean DEFAULT false NOT NULL;
