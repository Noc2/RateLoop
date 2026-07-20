CREATE TABLE "tokenless_evm_kms_signing_ledger" (
  "event_id" text PRIMARY KEY NOT NULL,
  "attempt_id" text NOT NULL,
  "outcome" text NOT NULL,
  "signer_role" text NOT NULL,
  "key_arn" text NOT NULL,
  "digest" text NOT NULL,
  "purpose" text NOT NULL,
  "aws_request_id" text,
  "error_class" text,
  "retryable" boolean,
  "signature_hash" text,
  "transaction_hash" text,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "recorded_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_evm_kms_signing_ledger_event_id_check" CHECK (
    "event_id" ~ '^kms_evt_[0-9a-f]{32}$'
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_attempt_id_check" CHECK (
    "attempt_id" ~ '^kms_att_[0-9a-f]{32}$'
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_outcome_check" CHECK (
    "outcome" IN ('attempted', 'succeeded', 'failed')
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_role_check" CHECK (
    "signer_role" IN (
      'credential_issuer',
      'prepaid_funder',
      'surprise_bonus_funder',
      'x402_relayer',
      'keeper'
    )
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_key_arn_check" CHECK (
    "key_arn" ~ '^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[0-9a-f-]{36}$'
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_digest_check" CHECK (
    "digest" ~ '^0x[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_purpose_check" CHECK (
    "purpose" IN ('raw_hash', 'eip191_message', 'eip712_typed_data', 'evm_transaction')
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_request_id_check" CHECK (
    "aws_request_id" IS NULL OR char_length("aws_request_id") BETWEEN 1 AND 256
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_error_class_check" CHECK (
    "error_class" IS NULL OR "error_class" IN (
      'timeout',
      'throttling',
      'access_or_key_configuration',
      'malformed_response_or_recovery',
      'outage'
    )
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_identity_check" CHECK (
    ("signature_hash" IS NULL OR "signature_hash" ~ '^0x[0-9a-f]{64}$')
    AND ("transaction_hash" IS NULL OR "transaction_hash" ~ '^0x[0-9a-f]{64}$')
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_state_check" CHECK (
    (
      "outcome" = 'attempted'
      AND "aws_request_id" IS NULL
      AND "error_class" IS NULL
      AND "retryable" IS NULL
      AND "signature_hash" IS NULL
      AND "transaction_hash" IS NULL
      AND "completed_at" IS NULL
    )
    OR (
      "outcome" = 'succeeded'
      AND "aws_request_id" IS NOT NULL
      AND "error_class" IS NULL
      AND "retryable" IS NULL
      AND "signature_hash" IS NOT NULL
      AND "completed_at" IS NOT NULL
    )
    OR (
      "outcome" = 'failed'
      AND "error_class" IS NOT NULL
      AND "retryable" IS NOT NULL
      AND "signature_hash" IS NULL
      AND "transaction_hash" IS NULL
      AND "completed_at" IS NOT NULL
    )
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_time_check" CHECK (
    "recorded_at" >= "started_at"
    AND ("completed_at" IS NULL OR "completed_at" >= "started_at")
  ),
  CONSTRAINT "tokenless_evm_kms_signing_ledger_attempt_outcome_unique"
    UNIQUE ("attempt_id", "outcome")
);
--> statement-breakpoint
CREATE INDEX "tokenless_evm_kms_signing_ledger_role_time_idx"
  ON "tokenless_evm_kms_signing_ledger" USING btree ("signer_role", "started_at", "attempt_id");
--> statement-breakpoint
CREATE INDEX "tokenless_evm_kms_signing_ledger_key_time_idx"
  ON "tokenless_evm_kms_signing_ledger" USING btree ("key_arn", "started_at", "attempt_id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tokenless_evm_kms_signing_ledger_append_only"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'EVM KMS signing ledger is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "tokenless_evm_kms_signing_ledger_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "tokenless_evm_kms_signing_ledger"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_evm_kms_signing_ledger_append_only"();
