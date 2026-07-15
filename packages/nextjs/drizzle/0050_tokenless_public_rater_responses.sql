CREATE TABLE "tokenless_public_rater_responses" (
	"response_id" text PRIMARY KEY NOT NULL,
	"voucher_id" text NOT NULL,
	"operation_key" text NOT NULL,
	"question_id" text NOT NULL,
	"round_id" numeric(78, 0) NOT NULL,
	"content_id" text NOT NULL,
	"vote_key" text NOT NULL,
	"response_hash" text NOT NULL,
	"payload_digest" text NOT NULL,
	"payload_ciphertext" text NOT NULL,
	"key_ref" text NOT NULL,
	"moderation_status" text DEFAULT 'pending' NOT NULL,
	"moderation_reason" text,
	"hash_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tokenless_public_rater_responses_voucher_id_unique" UNIQUE("voucher_id"),
	CONSTRAINT "tokenless_public_rater_responses_moderation_status_check" CHECK ("moderation_status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "tokenless_public_rater_responses" ADD CONSTRAINT "tokenless_public_rater_responses_voucher_id_tokenless_paid_vouchers_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."tokenless_paid_vouchers"("voucher_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tokenless_public_rater_responses" ADD CONSTRAINT "tokenless_public_rater_responses_operation_key_tokenless_agent_asks_operation_key_fk" FOREIGN KEY ("operation_key") REFERENCES "public"."tokenless_agent_asks"("operation_key") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tokenless_public_rater_responses" ADD CONSTRAINT "tokenless_public_rater_responses_question_id_tokenless_question_records_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."tokenless_question_records"("question_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tokenless_public_rater_responses_operation_round_idx" ON "tokenless_public_rater_responses" USING btree ("operation_key", "round_id");
--> statement-breakpoint
CREATE INDEX "tokenless_public_rater_responses_verified_moderation_idx" ON "tokenless_public_rater_responses" USING btree ("operation_key", "hash_verified_at", "moderation_status");
--> statement-breakpoint
CREATE INDEX "tokenless_public_rater_responses_vote_key_idx" ON "tokenless_public_rater_responses" USING btree ("round_id", "vote_key");
