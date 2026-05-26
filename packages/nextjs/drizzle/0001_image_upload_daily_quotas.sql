CREATE TABLE "image_upload_daily_quotas" (
	"quota_key" text PRIMARY KEY NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" text NOT NULL,
	"quota_date" text NOT NULL,
	"image_count" integer DEFAULT 0 NOT NULL,
	"byte_count" numeric(78, 0) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "image_upload_daily_quotas_subject_day_idx" ON "image_upload_daily_quotas" USING btree ("subject_kind","subject_id","quota_date");
