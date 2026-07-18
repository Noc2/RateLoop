ALTER TABLE "tokenless_surprise_bounty_rounds"
  ADD COLUMN "reservation_expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "tokenless_surprise_bounty_rounds"
  SET "reservation_expires_at" = "updated_at" + INTERVAL '24 hours'
  WHERE "state" = 'reserved';--> statement-breakpoint
ALTER TABLE "tokenless_surprise_bounty_rounds"
  DROP CONSTRAINT "tokenless_surprise_bounty_rounds_state_check";--> statement-breakpoint
ALTER TABLE "tokenless_surprise_bounty_rounds"
  ADD CONSTRAINT "tokenless_surprise_bounty_rounds_state_check" CHECK (
    "state" IN ('reserved', 'funded', 'expired', 'insufficient_sample', 'no_qualifying_outcome', 'allocated', 'complete')
  );--> statement-breakpoint
ALTER TABLE "tokenless_surprise_bounty_rounds"
  ADD CONSTRAINT "tokenless_surprise_bounty_rounds_reservation_expiry_check" CHECK (
    ("state" = 'reserved' AND "reservation_expires_at" IS NOT NULL AND "reservation_expires_at" > "created_at")
    OR ("state" <> 'reserved' AND "reservation_expires_at" IS NULL)
  );--> statement-breakpoint
CREATE INDEX "tokenless_surprise_bounty_rounds_reservation_expiry_idx"
  ON "tokenless_surprise_bounty_rounds" USING btree
  ("deployment_key", "state", "reservation_expires_at");
