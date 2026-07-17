ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD COLUMN "expected_effort_seconds" integer;
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_expected_effort_check"
  CHECK ("expected_effort_seconds" IS NULL OR "expected_effort_seconds" BETWEEN 60 AND 14400);
