CREATE TABLE "tokenless_rater_commits" (
  "commit_id" text PRIMARY KEY NOT NULL,
  "voucher_id" text NOT NULL REFERENCES "tokenless_paid_vouchers"("voucher_id"),
  "request_idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "deployment_key" text NOT NULL,
  "round_id" numeric(78, 0) NOT NULL,
  "vote_key" text NOT NULL,
  "sealed_commitment" text NOT NULL,
  "sealed_payload_hash" text NOT NULL,
  "payout_commitment" text NOT NULL,
  "relay_payload_json" text NOT NULL,
  "relay_nonce" numeric(78, 0),
  "transaction_hash" text,
  "state" text NOT NULL,
  "failure_code" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "confirmed_at" timestamp with time zone,
  CONSTRAINT "tokenless_rater_commits_voucher_unique" UNIQUE("voucher_id"),
  CONSTRAINT "tokenless_rater_commits_idempotency_unique" UNIQUE("request_idempotency_key"),
  CONSTRAINT "tokenless_rater_commits_tx_unique" UNIQUE("transaction_hash")
);--> statement-breakpoint
CREATE INDEX "tokenless_rater_commits_state_idx" ON "tokenless_rater_commits" USING btree ("state", "updated_at");
