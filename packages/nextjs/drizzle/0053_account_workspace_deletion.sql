ALTER TABLE "tokenless_workspaces"
  ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "tokenless_public_question_media"
  ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "tokenless_public_question_media_deletion_idx"
  ON "tokenless_public_question_media" USING btree ("technical_status", "deletion_requested_at");--> statement-breakpoint

CREATE TABLE "tokenless_deletion_jobs" (
  "job_id" text PRIMARY KEY NOT NULL,
  "scope_kind" text NOT NULL,
  "scope_id" text NOT NULL,
  "subject_request_id" text REFERENCES "tokenless_subject_requests"("request_id") ON DELETE RESTRICT,
  "requested_by" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "due_at" timestamp with time zone NOT NULL,
  "requested_at" timestamp with time zone NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "last_error_code" text,
  "receipt_digest" text,
  CONSTRAINT "tokenless_deletion_jobs_scope_kind_check"
    CHECK ("scope_kind" IN ('account','workspace')),
  CONSTRAINT "tokenless_deletion_jobs_scope_id_check"
    CHECK ("scope_id" ~ '^[A-Za-z0-9:_-]{1,160}$'),
  CONSTRAINT "tokenless_deletion_jobs_requested_by_check"
    CHECK ("requested_by" ~ '^[A-Za-z0-9:_-]{1,160}$'),
  CONSTRAINT "tokenless_deletion_jobs_status_check"
    CHECK ("status" IN ('pending','running','blocked','completed','failed')),
  CONSTRAINT "tokenless_deletion_jobs_due_check"
    CHECK ("due_at" >= "requested_at"),
  CONSTRAINT "tokenless_deletion_jobs_started_check"
    CHECK ("started_at" IS NULL OR "started_at" >= "requested_at"),
  CONSTRAINT "tokenless_deletion_jobs_completed_check"
    CHECK ("completed_at" IS NULL OR ("started_at" IS NOT NULL AND "completed_at" >= "started_at")),
  CONSTRAINT "tokenless_deletion_jobs_error_code_check"
    CHECK (
      "last_error_code" IS NULL
      OR "last_error_code" ~ '^[a-z0-9][a-z0-9_]{0,79}$'
    ),
  CONSTRAINT "tokenless_deletion_jobs_receipt_digest_check"
    CHECK (
      "receipt_digest" IS NULL
      OR "receipt_digest" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "tokenless_deletion_jobs_lifecycle_check" CHECK (
    ("status" = 'pending' AND "started_at" IS NULL AND "completed_at" IS NULL
      AND "last_error_code" IS NULL AND "receipt_digest" IS NULL)
    OR ("status" = 'running' AND "started_at" IS NOT NULL AND "completed_at" IS NULL
      AND "last_error_code" IS NULL AND "receipt_digest" IS NULL)
    OR ("status" = 'blocked' AND "completed_at" IS NULL
      AND "last_error_code" IS NOT NULL AND "receipt_digest" IS NULL)
    OR ("status" = 'completed' AND "started_at" IS NOT NULL AND "completed_at" IS NOT NULL
      AND "last_error_code" IS NULL AND "receipt_digest" IS NOT NULL)
    OR ("status" = 'failed' AND "started_at" IS NOT NULL AND "completed_at" IS NOT NULL
      AND "last_error_code" IS NOT NULL AND "receipt_digest" IS NULL)
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_deletion_jobs_active_scope_unique"
  ON "tokenless_deletion_jobs" USING btree ("scope_kind", "scope_id")
  WHERE "status" IN ('pending','running','blocked');--> statement-breakpoint
CREATE INDEX "tokenless_deletion_jobs_due_status_idx"
  ON "tokenless_deletion_jobs" USING btree ("status", "due_at", "requested_at");--> statement-breakpoint
CREATE INDEX "tokenless_deletion_jobs_scope_idx"
  ON "tokenless_deletion_jobs" USING btree ("scope_kind", "scope_id", "requested_at");--> statement-breakpoint
CREATE INDEX "tokenless_deletion_jobs_subject_request_idx"
  ON "tokenless_deletion_jobs" USING btree ("subject_request_id");--> statement-breakpoint

CREATE TABLE "tokenless_deletion_job_categories" (
  "job_id" text NOT NULL REFERENCES "tokenless_deletion_jobs"("job_id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "disposition" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "basis_code" text,
  "retention_deadline" timestamp with time zone,
  "evidence_digest" text,
  "created_at" timestamp with time zone NOT NULL,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  PRIMARY KEY ("job_id", "category"),
  CONSTRAINT "tokenless_deletion_job_categories_category_check"
    CHECK ("category" ~ '^[a-z0-9][a-z0-9_]{0,79}$'),
  CONSTRAINT "tokenless_deletion_job_categories_disposition_check"
    CHECK ("disposition" IN ('erase','anonymize','retain','public_chain')),
  CONSTRAINT "tokenless_deletion_job_categories_status_check"
    CHECK ("status" IN ('pending','in_progress','completed','retained','blocked')),
  CONSTRAINT "tokenless_deletion_job_categories_basis_check"
    CHECK (
      "basis_code" IS NULL
      OR "basis_code" ~ '^[a-z0-9][a-z0-9_]{0,79}$'
    ),
  CONSTRAINT "tokenless_deletion_job_categories_retention_check"
    CHECK (
      ("disposition" = 'retain' AND "basis_code" IS NOT NULL)
      OR ("disposition" = 'public_chain' AND "basis_code" IS NOT NULL AND "retention_deadline" IS NULL)
      OR ("disposition" IN ('erase','anonymize') AND "retention_deadline" IS NULL)
    ),
  CONSTRAINT "tokenless_deletion_job_categories_evidence_digest_check"
    CHECK (
      "evidence_digest" IS NULL
      OR "evidence_digest" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "tokenless_deletion_job_categories_started_check"
    CHECK ("started_at" IS NULL OR "started_at" >= "created_at"),
  CONSTRAINT "tokenless_deletion_job_categories_completed_check"
    CHECK ("completed_at" IS NULL OR ("started_at" IS NOT NULL AND "completed_at" >= "started_at")),
  CONSTRAINT "tokenless_deletion_job_categories_lifecycle_check" CHECK (
    ("status" = 'pending' AND "started_at" IS NULL AND "completed_at" IS NULL
      AND "evidence_digest" IS NULL)
    OR ("status" = 'in_progress' AND "started_at" IS NOT NULL AND "completed_at" IS NULL
      AND "evidence_digest" IS NULL)
    OR ("status" = 'blocked' AND "completed_at" IS NULL AND "basis_code" IS NOT NULL
      AND "evidence_digest" IS NULL)
    OR ("status" = 'completed' AND "disposition" IN ('erase','anonymize')
      AND "started_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "evidence_digest" IS NOT NULL)
    OR ("status" = 'retained' AND "disposition" IN ('retain','public_chain')
      AND "started_at" IS NOT NULL AND "completed_at" IS NOT NULL AND "evidence_digest" IS NOT NULL)
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_deletion_job_categories_status_idx"
  ON "tokenless_deletion_job_categories" USING btree ("status", "retention_deadline", "created_at");--> statement-breakpoint
CREATE INDEX "tokenless_deletion_job_categories_job_status_idx"
  ON "tokenless_deletion_job_categories" USING btree ("job_id", "status", "category");
