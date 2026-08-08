-- Widen the review response window from 24 hours to 30 days at the database
-- layer, matching MAXIMUM_REVIEW_RESPONSE_WINDOW_SECONDS in
-- lib/tokenless/reviewPanelPolicy.ts.
--
-- The application bound was raised so a named internal reviewer's deadline can
-- survive a weekend or a public holiday, but three CHECK constraints still
-- capped the stored value at 86400. That combination is worse than either bound
-- alone: the new 3-day default (259200) is accepted by every application
-- validator and then rejected on INSERT, so configuring a review profile fails
-- at the database.
--
-- Only the response-window ceiling changes. The panel bounds inside
-- `ready_check` are restated exactly as they were, including the `BETWEEN 1 AND
-- 100` lower bound that the application tightens to 2 -- widening that here
-- would be a separate decision with its own migration.
ALTER TABLE "tokenless_agent_review_request_profiles"
  DROP CONSTRAINT "tokenless_agent_review_request_profiles_response_window_check";
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_response_window_check" CHECK (
    ("response_window_seconds" IS NULL AND "configuration_status" = 'action_required')
    OR "response_window_seconds" BETWEEN 1200 AND 2592000
  );
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  DROP CONSTRAINT "tokenless_agent_review_request_profiles_ready_check";
--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_request_profiles"
  ADD CONSTRAINT "tokenless_agent_review_request_profiles_ready_check" CHECK (
    "configuration_status" = 'action_required'
    OR (
      "approved_by" IS NOT NULL
      AND "approved_at" IS NOT NULL
      AND "response_window_seconds" BETWEEN 1200 AND 2592000
      AND "panel_size" BETWEEN 1 AND 100
      AND ("audience" = 'private_invited' OR "panel_size" >= 3)
      AND (
        ("audience" = 'private_invited' AND "private_group_id" IS NOT NULL)
        OR (
          "audience" = 'public_network'
          AND "content_boundary" = 'public_or_test'
          AND "private_sensitivity" IS NULL
          AND "private_group_id" IS NULL
        )
        OR (
          "audience" = 'hybrid'
          AND "content_boundary" = 'public_or_test'
          AND "private_sensitivity" IS NULL
          AND "private_group_id" IS NOT NULL
        )
      )
      AND (
        ("compensation_mode" = 'unpaid' AND "bounty_per_seat_atomic" IS NULL)
        OR ("compensation_mode" = 'usdc' AND "bounty_per_seat_atomic" IS NOT NULL AND "bounty_per_seat_atomic" > 0)
      )
      AND ("audience" = 'private_invited' OR "compensation_mode" = 'usdc')
    )
  );
--> statement-breakpoint
ALTER TABLE "tokenless_private_review_requests"
  DROP CONSTRAINT "tokenless_private_review_requests_response_window_check";
--> statement-breakpoint
ALTER TABLE "tokenless_private_review_requests"
  ADD CONSTRAINT "tokenless_private_review_requests_response_window_check"
    CHECK ("response_window_seconds" BETWEEN 1200 AND 2592000 AND "response_deadline" > "created_at");
