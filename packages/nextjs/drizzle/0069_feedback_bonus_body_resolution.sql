ALTER TABLE "tokenless_assurance_responses"
  ADD COLUMN "rationale_digest" text;
--> statement-breakpoint
ALTER TABLE "tokenless_assurance_responses"
  ADD CONSTRAINT "tokenless_assurance_responses_rationale_digest_check"
  CHECK (
    "rationale_digest" IS NULL
    OR "rationale_digest" ~ '^sha256:[0-9a-f]{64}$'
  );
