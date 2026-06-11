ALTER TABLE "notification_preferences" ADD COLUMN "context_now_public" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "breach_reported" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "cohort_breach_announcement" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE "question_confidentiality" (
  "content_id" text PRIMARY KEY NOT NULL,
  "gated" boolean DEFAULT false NOT NULL,
  "bond_asset" text,
  "bond_amount" text DEFAULT '0' NOT NULL,
  "disclosure_policy" text DEFAULT 'after_settlement' NOT NULL,
  "published_at" timestamp with time zone,
  "question_metadata_hash" text,
  "content_hash" text,
  "details_hash" text,
  "media_tuple_hash" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "question_confidentiality_gated_published_idx" ON "question_confidentiality" USING btree ("gated","published_at");
--> statement-breakpoint
CREATE INDEX "question_confidentiality_disclosure_idx" ON "question_confidentiality" USING btree ("disclosure_policy","published_at");
--> statement-breakpoint
CREATE TABLE "confidentiality_terms_acceptances" (
  "id" serial PRIMARY KEY NOT NULL,
  "wallet_address" text NOT NULL,
  "identity_key" text,
  "content_id" text NOT NULL,
  "terms_version" text NOT NULL,
  "terms_doc_hash" text NOT NULL,
  "signature" text NOT NULL,
  "nonce" text NOT NULL,
  "accepted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "confidentiality_terms_wallet_content_terms_unique" ON "confidentiality_terms_acceptances" USING btree ("wallet_address","content_id","terms_version");
--> statement-breakpoint
CREATE INDEX "confidentiality_terms_content_identity_idx" ON "confidentiality_terms_acceptances" USING btree ("content_id","identity_key");
--> statement-breakpoint
CREATE TABLE "confidential_context_access_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "identity_key" text,
  "wallet_address" text NOT NULL,
  "content_id" text NOT NULL,
  "resource_id" text NOT NULL,
  "resource_kind" text NOT NULL,
  "view_token" text NOT NULL,
  "ip_hash" text,
  "viewed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "confidential_access_content_viewed_idx" ON "confidential_context_access_logs" USING btree ("content_id","viewed_at");
--> statement-breakpoint
CREATE INDEX "confidential_access_identity_content_idx" ON "confidential_context_access_logs" USING btree ("identity_key","content_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "confidential_access_view_token_unique" ON "confidential_context_access_logs" USING btree ("view_token");
--> statement-breakpoint
CREATE TABLE "confidentiality_breach_reports" (
  "id" serial PRIMARY KEY NOT NULL,
  "reporter" text NOT NULL,
  "accused_identity_key" text NOT NULL,
  "content_id" text NOT NULL,
  "evidence_url" text,
  "evidence_hash" text NOT NULL,
  "access_log_id" integer,
  "epoch" text,
  "proof" text,
  "status" text DEFAULT 'reported' NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "confidentiality_breach_content_status_idx" ON "confidentiality_breach_reports" USING btree ("content_id","status");
--> statement-breakpoint
CREATE INDEX "confidentiality_breach_accused_status_idx" ON "confidentiality_breach_reports" USING btree ("accused_identity_key","status");
--> statement-breakpoint
CREATE TABLE "confidentiality_log_roots" (
  "epoch" text PRIMARY KEY NOT NULL,
  "merkle_root" text NOT NULL,
  "acceptance_count" integer DEFAULT 0 NOT NULL,
  "access_count" integer DEFAULT 0 NOT NULL,
  "artifact_url" text,
  "artifact_hash" text,
  "published_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "confidentiality_log_roots_published_idx" ON "confidentiality_log_roots" USING btree ("published_at");
