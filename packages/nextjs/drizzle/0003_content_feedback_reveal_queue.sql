ALTER TABLE "content_feedback" ADD COLUMN "commit_key" text;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD COLUMN "onchain_reveal_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD COLUMN "onchain_reveal_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD COLUMN "onchain_reveal_next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD COLUMN "onchain_reveal_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD COLUMN "onchain_reveal_tx_hash" text;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD COLUMN "onchain_reveal_error" text;--> statement-breakpoint
ALTER TABLE "content_feedback" ADD COLUMN "onchain_revealed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "content_feedback_commit_key_idx" ON "content_feedback" USING btree ("commit_key");--> statement-breakpoint
CREATE INDEX "content_feedback_onchain_reveal_queue_idx" ON "content_feedback" USING btree ("onchain_reveal_status","onchain_reveal_next_attempt_at","onchain_reveal_lease_until","created_at");
