CREATE TABLE "tokenless_evm_transaction_versions" (
  "version_id" text PRIMARY KEY NOT NULL,
  "deployment_key" text NOT NULL,
  "signer_role" text NOT NULL,
  "signer_address" text NOT NULL,
  "business_kind" text NOT NULL,
  "business_key" text NOT NULL,
  "transaction_kind" text NOT NULL,
  "nonce" numeric(78, 0) NOT NULL,
  "generation" integer NOT NULL,
  "signed_transaction" text NOT NULL,
  "transaction_hash" text NOT NULL,
  "signature_hash" text NOT NULL,
  "max_fee_per_gas" numeric(78, 0) NOT NULL,
  "max_priority_fee_per_gas" numeric(78, 0) NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_evm_transaction_versions_business_generation_unique"
    UNIQUE("business_kind", "business_key", "transaction_kind", "generation"),
  CONSTRAINT "tokenless_evm_transaction_versions_hash_unique" UNIQUE("transaction_hash"),
  CONSTRAINT "tokenless_evm_transaction_versions_role_check"
    CHECK ("signer_role" IN ('prepaid_funder', 'gas_only_relayer', 'surprise_bonus_funder')),
  CONSTRAINT "tokenless_evm_transaction_versions_kind_check"
    CHECK (
      ("business_kind" = 'chain_execution' AND "transaction_kind" IN ('approval', 'submission'))
      OR ("business_kind" = 'rater_commit' AND "transaction_kind" = 'relay')
      OR ("business_kind" = 'surprise_bounty' AND "transaction_kind" = 'transfer')
    ),
  CONSTRAINT "tokenless_evm_transaction_versions_generation_check" CHECK ("generation" BETWEEN 0 AND 2147483647),
  CONSTRAINT "tokenless_evm_transaction_versions_signed_check"
    CHECK ("signed_transaction" ~ '^0x[0-9a-f]+$'),
  CONSTRAINT "tokenless_evm_transaction_versions_hash_check"
    CHECK ("transaction_hash" ~ '^0x[0-9a-f]{64}$' AND "signature_hash" ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT "tokenless_evm_transaction_versions_fee_check"
    CHECK ("max_fee_per_gas" > 0 AND "max_priority_fee_per_gas" > 0
      AND "max_priority_fee_per_gas" <= "max_fee_per_gas")
);--> statement-breakpoint
CREATE INDEX "tokenless_evm_transaction_versions_nonce_idx"
  ON "tokenless_evm_transaction_versions" USING btree
  ("deployment_key", "signer_address", "nonce", "generation");--> statement-breakpoint
CREATE OR REPLACE FUNCTION tokenless_reject_evm_transaction_version_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'EVM transaction version history is append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER tokenless_evm_transaction_versions_append_only
BEFORE UPDATE OR DELETE ON "tokenless_evm_transaction_versions"
FOR EACH STATEMENT EXECUTE FUNCTION tokenless_reject_evm_transaction_version_mutation();--> statement-breakpoint
CREATE TRIGGER tokenless_evm_transaction_versions_no_truncate
BEFORE TRUNCATE ON "tokenless_evm_transaction_versions"
FOR EACH STATEMENT EXECUTE FUNCTION tokenless_reject_evm_transaction_version_mutation();
