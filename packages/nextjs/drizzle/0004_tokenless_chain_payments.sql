CREATE TABLE "tokenless_chain_executions" (
  "execution_id" text PRIMARY KEY NOT NULL,
  "operation_key" text NOT NULL REFERENCES "tokenless_agent_asks"("operation_key"),
  "payment_mode" text NOT NULL,
  "payment_reference" text NOT NULL,
  "deployment_key" text NOT NULL,
  "chain_id" integer NOT NULL,
  "deployment_block" numeric(78, 0) NOT NULL,
  "panel_address" text NOT NULL,
  "issuer_address" text NOT NULL,
  "x402_submitter_address" text NOT NULL,
  "usdc_address" text NOT NULL,
  "funder_address" text NOT NULL,
  "content_id" text NOT NULL,
  "terms_hash" text NOT NULL,
  "round_terms_json" text NOT NULL,
  "total_funded_atomic" numeric(78, 0) NOT NULL,
  "state" text NOT NULL,
  "approval_nonce" numeric(78, 0),
  "approval_transaction_hash" text,
  "submission_nonce" numeric(78, 0),
  "submission_transaction_hash" text,
  "round_id" numeric(78, 0),
  "receipt_block_number" numeric(78, 0),
  "receipt_block_hash" text,
  "failure_code" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "confirmed_at" timestamp with time zone,
  CONSTRAINT "tokenless_chain_executions_operation_unique" UNIQUE("operation_key"),
  CONSTRAINT "tokenless_chain_executions_payment_unique" UNIQUE("payment_mode", "payment_reference"),
  CONSTRAINT "tokenless_chain_executions_submission_tx_unique" UNIQUE("submission_transaction_hash")
);--> statement-breakpoint
CREATE INDEX "tokenless_chain_executions_state_idx" ON "tokenless_chain_executions" USING btree ("state", "updated_at");--> statement-breakpoint
CREATE INDEX "tokenless_chain_executions_round_idx" ON "tokenless_chain_executions" USING btree ("deployment_key", "round_id");--> statement-breakpoint
CREATE TABLE "tokenless_chain_signer_nonces" (
  "deployment_key" text NOT NULL,
  "signer_address" text NOT NULL,
  "next_nonce" numeric(78, 0) NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  PRIMARY KEY ("deployment_key", "signer_address")
);
