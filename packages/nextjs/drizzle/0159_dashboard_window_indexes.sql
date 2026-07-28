CREATE INDEX "tokenless_agent_evaluation_observations_workspace_finalized_idx"
  ON "tokenless_agent_evaluation_observations" ("workspace_id","finalized_at");--> statement-breakpoint

CREATE INDEX "tokenless_agent_review_transition_events_workspace_occurred_idx"
  ON "tokenless_agent_review_opportunity_transition_events" ("workspace_id","occurred_at");--> statement-breakpoint

CREATE INDEX "tokenless_agent_review_opportunities_workspace_created_idx"
  ON "tokenless_agent_review_opportunities" ("workspace_id","created_at");
