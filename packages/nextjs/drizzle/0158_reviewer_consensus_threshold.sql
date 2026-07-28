ALTER TABLE "tokenless_agent_review_policies"
  ADD COLUMN "reviewer_consensus_threshold_bps" integer;--> statement-breakpoint

UPDATE "tokenless_agent_review_policies"
SET "reviewer_consensus_threshold_bps" = "agreement_threshold_bps"
WHERE "reviewer_consensus_threshold_bps" IS NULL;--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_policies"
  ALTER COLUMN "reviewer_consensus_threshold_bps" SET DEFAULT 7000;--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_policies"
  ALTER COLUMN "reviewer_consensus_threshold_bps" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "tokenless_agent_review_policies"
  ADD CONSTRAINT "tokenless_agent_review_policies_reviewer_consensus_threshold_check"
  CHECK ("reviewer_consensus_threshold_bps" BETWEEN 0 AND 10000);
