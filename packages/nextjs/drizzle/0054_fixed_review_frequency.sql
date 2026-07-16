ALTER TABLE "tokenless_agent_review_policies"
  ADD COLUMN "fixed_rate_bps" integer;--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_policies"
  DROP CONSTRAINT "tokenless_agent_review_policies_mode_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_policies"
  ADD CONSTRAINT "tokenless_agent_review_policies_mode_check"
  CHECK ("mode" IN ('manual', 'always', 'rules', 'adaptive', 'fixed'));--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_policies"
  DROP CONSTRAINT "tokenless_agent_review_policies_threshold_check";--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_policies"
  ADD CONSTRAINT "tokenless_agent_review_policies_threshold_check"
  CHECK (
    "agreement_threshold_bps" BETWEEN 0 AND 10000
    AND "production_floor_bps" BETWEEN 0 AND 10000
    AND "maximum_unreviewed_gap" >= 1
    AND ("mode" <> 'adaptive' OR "production_floor_bps" >= 1000)
    AND ("mode" <> 'fixed' OR "production_floor_bps" = 0)
  );--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_policies"
  ADD CONSTRAINT "tokenless_agent_review_policies_fixed_rate_check"
  CHECK (
    ("mode" = 'fixed' AND "fixed_rate_bps" BETWEEN 1 AND 10000)
    OR ("mode" <> 'fixed' AND "fixed_rate_bps" IS NULL)
  );
