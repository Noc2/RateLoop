-- Subject exports have emitted the v3 envelope since the expanded, minimized
-- export shipped. Correct already-generated rows before enforcing the
-- persisted envelope version for new exports.
UPDATE "tokenless_subject_request_exports"
SET "schema_version" = 3
WHERE "schema_version" = 1
  AND "payload_json" LIKE '%"schemaVersion":"rateloop.subject-export.v3"%';--> statement-breakpoint

ALTER TABLE "tokenless_subject_request_exports"
  DROP CONSTRAINT "tokenless_subject_request_exports_lifetime_check";--> statement-breakpoint
ALTER TABLE "tokenless_subject_request_exports"
  ADD CONSTRAINT "tokenless_subject_request_exports_lifetime_check"
  CHECK (
    "schema_version" IN (1, 3)
    AND "delete_after" > "generated_at"
  );--> statement-breakpoint
