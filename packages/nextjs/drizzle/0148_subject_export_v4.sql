ALTER TABLE "tokenless_subject_request_exports"
  DROP CONSTRAINT "tokenless_subject_request_exports_lifetime_check";--> statement-breakpoint

ALTER TABLE "tokenless_subject_request_exports"
  ADD CONSTRAINT "tokenless_subject_request_exports_lifetime_check"
  CHECK (
    "schema_version" IN (1, 3, 4)
    AND "delete_after" > "generated_at"
  );
