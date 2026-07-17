UPDATE "tokenless_agent_review_request_profiles"
SET "configuration_status" = 'action_required'
WHERE "superseded_at" IS NULL
  AND "configuration_status" = 'ready'
  AND "expected_effort_seconds" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  DROP CONSTRAINT IF EXISTS "tokenless_agent_review_request_profiles_expected_effort_check";
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  DROP COLUMN IF EXISTS "expected_effort_seconds";
