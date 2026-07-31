UPDATE "tokenless_agent_review_opportunities"
SET "sampler_commitment" = 'sha256:' || "sampler_commitment"
WHERE "sampler_commitment" ~ '^[0-9a-f]{64}$';--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_opportunities"
  ADD CONSTRAINT "tokenless_agent_review_opportunities_sampler_commitment_check"
  CHECK ("sampler_commitment" ~ '^sha256:[0-9a-f]{64}$');
