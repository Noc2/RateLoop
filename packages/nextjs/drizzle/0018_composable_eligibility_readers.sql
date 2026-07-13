ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "assurance_snapshot_json" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ADD COLUMN "assurance_snapshot_hash" text;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ALTER COLUMN "assurance_snapshot_json" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_assurance_assignments" ALTER COLUMN "assurance_snapshot_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tokenless_paid_vouchers" ADD COLUMN "assurance_snapshot_hash" text NOT NULL;--> statement-breakpoint
CREATE TABLE "tokenless_voucher_assurance_snapshots" (
  "voucher_id" text PRIMARY KEY NOT NULL REFERENCES "tokenless_paid_vouchers"("voucher_id") ON DELETE CASCADE,
  "rater_id" text NOT NULL REFERENCES "tokenless_rater_profiles"("rater_id"),
  "reviewer_source" text NOT NULL,
  "snapshot_json" text NOT NULL,
  "snapshot_hash" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_voucher_assurance_snapshots_source_check" CHECK ("reviewer_source" IN ('customer_invited', 'rateloop_network', 'sandbox')),
  CONSTRAINT "tokenless_voucher_assurance_snapshots_hash_unique" UNIQUE("voucher_id", "snapshot_hash")
);--> statement-breakpoint
CREATE INDEX "tokenless_voucher_assurance_snapshots_rater_created_idx" ON "tokenless_voucher_assurance_snapshots" USING btree ("rater_id", "created_at");--> statement-breakpoint
DROP TABLE "tokenless_capability_eligibility";
