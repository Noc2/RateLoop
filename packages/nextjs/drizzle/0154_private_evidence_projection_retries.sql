-- Track retriable private evidence projections without blocking sibling work.
ALTER TABLE "tokenless_private_unpaid_review_deliveries"
  ADD COLUMN "evidence_projection_state" text NOT NULL DEFAULT 'pending',
  ADD COLUMN "evidence_projection_attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "evidence_projection_next_attempt_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "evidence_projection_last_error" text,
  ADD COLUMN "evidence_projection_claimed_at" timestamp with time zone,
  ADD COLUMN "evidence_projection_claim_generation" integer NOT NULL DEFAULT 0,
  ADD COLUMN "evidence_projection_dead_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "tokenless_private_unpaid_review_deliveries"
SET "evidence_projection_next_attempt_at"=COALESCE("completed_at","updated_at","created_at");
--> statement-breakpoint
UPDATE "tokenless_private_unpaid_review_deliveries"
SET "evidence_projection_state"='completed',
    "evidence_projection_next_attempt_at"=NULL
WHERE "workspace_id" || ':' || "opportunity_id" IN (
  SELECT opportunity."workspace_id" || ':' || opportunity."opportunity_id"
  FROM "tokenless_agent_review_opportunities" opportunity
  JOIN "tokenless_assurance_evidence_packets" packet ON packet."run_id"=opportunity."run_id"
);
--> statement-breakpoint
ALTER TABLE "tokenless_private_unpaid_review_deliveries"
  ADD CONSTRAINT "tokenless_private_review_evidence_projection_state_check" CHECK (
    "evidence_projection_state" IN ('pending','retry','processing','completed','dead')
  ),
  ADD CONSTRAINT "tokenless_private_review_evidence_projection_attempt_check" CHECK (
    "evidence_projection_attempt_count" BETWEEN 0 AND 8
    AND "evidence_projection_claim_generation" >= 0
  ),
  ADD CONSTRAINT "tokenless_private_review_evidence_projection_lifecycle_check" CHECK (
    ("evidence_projection_state" IN ('pending','retry')
      AND "evidence_projection_next_attempt_at" IS NOT NULL
      AND "evidence_projection_claimed_at" IS NULL
      AND "evidence_projection_dead_at" IS NULL)
    OR ("evidence_projection_state"='processing'
      AND "evidence_projection_next_attempt_at" IS NULL
      AND "evidence_projection_claimed_at" IS NOT NULL
      AND "evidence_projection_dead_at" IS NULL)
    OR ("evidence_projection_state"='completed'
      AND "evidence_projection_next_attempt_at" IS NULL
      AND "evidence_projection_claimed_at" IS NULL
      AND "evidence_projection_dead_at" IS NULL)
    OR ("evidence_projection_state"='dead'
      AND "evidence_projection_next_attempt_at" IS NULL
      AND "evidence_projection_claimed_at" IS NULL
      AND "evidence_projection_dead_at" IS NOT NULL)
  );
--> statement-breakpoint
CREATE INDEX "tokenless_private_review_evidence_projection_due_idx"
  ON "tokenless_private_unpaid_review_deliveries"
  ("evidence_projection_state","evidence_projection_next_attempt_at","completed_at","delivery_id");
