ALTER TABLE "tokenless_agent_review_opportunities"
  ADD COLUMN "source_evidence_reference" text NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_agent_review_opportunities"
  ADD COLUMN "source_evidence_hash" text NOT NULL;--> statement-breakpoint
CREATE INDEX "tokenless_agent_review_opportunities_source_evidence_idx"
  ON "tokenless_agent_review_opportunities" USING btree
  ("workspace_id", "agent_id", "agent_version_id", "source_evidence_hash");
