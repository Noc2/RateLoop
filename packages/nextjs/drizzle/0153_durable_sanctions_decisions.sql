CREATE TABLE "tokenless_sanctions_blocks" (
  "rater_id" text PRIMARY KEY NOT NULL
    REFERENCES "tokenless_rater_profiles"("rater_id") ON DELETE RESTRICT,
  "screening_id" text NOT NULL UNIQUE
    REFERENCES "tokenless_sanctions_screenings"("screening_id") ON DELETE RESTRICT,
  "source" text NOT NULL,
  "list_snapshot_hash" text NOT NULL,
  "screened_by" text NOT NULL,
  "matched_at" timestamp with time zone NOT NULL,
  "retained_until" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_sanctions_blocks_source_check"
    CHECK ("source" IN ('manual:v1','opensanctions:v1')),
  CONSTRAINT "tokenless_sanctions_blocks_snapshot_check"
    CHECK ("list_snapshot_hash" ~ '^sha256:[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_sanctions_blocks_retention_check"
    CHECK ("retained_until" > "matched_at")
);--> statement-breakpoint
CREATE INDEX "tokenless_sanctions_blocks_retention_idx"
  ON "tokenless_sanctions_blocks" ("retained_until", "rater_id");--> statement-breakpoint

INSERT INTO "tokenless_sanctions_blocks"
  ("rater_id","screening_id","source","list_snapshot_hash","screened_by",
   "matched_at","retained_until","created_at")
SELECT screening."rater_id",screening."screening_id",screening."source",
       screening."list_snapshot_hash",screening."screened_by",screening."screened_at",
       screening."screened_at" + INTERVAL '5 years',screening."screened_at"
FROM "tokenless_sanctions_screenings" screening
WHERE screening."status" = 'match'
ON CONFLICT ("rater_id") DO NOTHING;
