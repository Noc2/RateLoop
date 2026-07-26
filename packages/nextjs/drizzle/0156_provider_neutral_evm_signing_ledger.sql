CREATE TABLE "tokenless_evm_signing_ledger" (
  "event_id" text PRIMARY KEY NOT NULL,
  "attempt_id" text NOT NULL,
  "outcome" text NOT NULL,
  "signer_role" text NOT NULL,
  "provider" text NOT NULL,
  "key_id" text NOT NULL,
  "digest" text NOT NULL,
  "purpose" text NOT NULL,
  "provider_request_id" text,
  "error_class" text,
  "retryable" boolean,
  "signature_hash" text,
  "transaction_hash" text,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "recorded_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_evm_signing_ledger_event_id_check" CHECK (
    "event_id" ~ '^(kms|sig)_evt_[0-9a-f]{32}$'
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_attempt_id_check" CHECK (
    "attempt_id" ~ '^(kms|sig)_att_[0-9a-f]{32}$'
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_outcome_check" CHECK (
    "outcome" IN ('attempted', 'succeeded', 'failed')
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_role_check" CHECK (
    "signer_role" IN (
      'credential_issuer',
      'prepaid_funder',
      'surprise_bonus_funder',
      'x402_relayer',
      'keeper'
    )
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_provider_check" CHECK (
    "provider" ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_key_id_check" CHECK (
    char_length("key_id") BETWEEN 1 AND 256
    AND "key_id" ~ '^[A-Za-z0-9:._/-]+$'
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_digest_check" CHECK (
    "digest" ~ '^0x[0-9a-f]{64}$'
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_purpose_check" CHECK (
    "purpose" IN ('raw_hash', 'eip191_message', 'eip712_typed_data', 'evm_transaction')
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_request_id_check" CHECK (
    "provider_request_id" IS NULL OR char_length("provider_request_id") BETWEEN 1 AND 256
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_error_class_check" CHECK (
    "error_class" IS NULL OR "error_class" IN (
      'timeout',
      'throttling',
      'access_or_key_configuration',
      'malformed_response_or_recovery',
      'outage'
    )
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_identity_check" CHECK (
    ("signature_hash" IS NULL OR "signature_hash" ~ '^0x[0-9a-f]{64}$')
    AND ("transaction_hash" IS NULL OR "transaction_hash" ~ '^0x[0-9a-f]{64}$')
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_state_check" CHECK (
    (
      "outcome" = 'attempted'
      AND "provider_request_id" IS NULL
      AND "error_class" IS NULL
      AND "retryable" IS NULL
      AND "signature_hash" IS NULL
      AND "transaction_hash" IS NULL
      AND "completed_at" IS NULL
    )
    OR (
      "outcome" = 'succeeded'
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
  CONSTRAINT "tokenless_evm_signing_ledger_transaction_identity_check" CHECK (
    "outcome" <> 'succeeded'
    OR (
      ("purpose" = 'evm_transaction' AND "transaction_hash" IS NOT NULL)
      OR ("purpose" <> 'evm_transaction' AND "transaction_hash" IS NULL)
    )
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_time_check" CHECK (
    "recorded_at" >= "started_at"
    AND ("completed_at" IS NULL OR "completed_at" >= "started_at")
    AND ("completed_at" IS NULL OR "recorded_at" >= "completed_at")
  ),
  CONSTRAINT "tokenless_evm_signing_ledger_attempt_outcome_unique"
    UNIQUE ("attempt_id", "outcome")
);
--> statement-breakpoint
CREATE INDEX "tokenless_evm_signing_ledger_role_time_idx"
  ON "tokenless_evm_signing_ledger" USING btree ("signer_role", "started_at", "attempt_id");
--> statement-breakpoint
CREATE INDEX "tokenless_evm_signing_ledger_key_time_idx"
  ON "tokenless_evm_signing_ledger" USING btree ("provider", "key_id", "started_at", "attempt_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_evm_signing_ledger_terminal_unique"
  ON "tokenless_evm_signing_ledger" USING btree ("attempt_id")
  WHERE "outcome" IN ('succeeded', 'failed');
--> statement-breakpoint
INSERT INTO "tokenless_evm_signing_ledger" (
  "event_id", "attempt_id", "outcome", "signer_role", "provider", "key_id",
  "digest", "purpose", "provider_request_id", "error_class", "retryable",
  "signature_hash", "transaction_hash", "started_at", "completed_at", "recorded_at"
)
SELECT
  "event_id", "attempt_id", "outcome", "signer_role", 'aws-kms', "key_arn",
  "digest", "purpose", "aws_request_id", "error_class", "retryable",
  "signature_hash", "transaction_hash", "started_at", "completed_at", "recorded_at"
FROM "tokenless_evm_kms_signing_ledger";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tokenless_evm_signing_ledger_append_only"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'EVM signing ledger is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "tokenless_evm_signing_ledger_append_only_trigger"
  BEFORE UPDATE OR DELETE ON "tokenless_evm_signing_ledger"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_evm_signing_ledger_append_only"();
--> statement-breakpoint
CREATE TRIGGER "tokenless_evm_signing_ledger_append_only_truncate_trigger"
  BEFORE TRUNCATE ON "tokenless_evm_signing_ledger"
  FOR EACH STATEMENT EXECUTE FUNCTION "tokenless_evm_signing_ledger_append_only"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tokenless_evm_signing_ledger_consistent_insert"()
RETURNS trigger AS $$
DECLARE
  attempted "tokenless_evm_signing_ledger"%ROWTYPE;
BEGIN
  IF NEW."outcome" = 'attempted' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO attempted
  FROM "tokenless_evm_signing_ledger"
  WHERE "attempt_id" = NEW."attempt_id" AND "outcome" = 'attempted';

  IF NOT FOUND
    OR attempted."signer_role" IS DISTINCT FROM NEW."signer_role"
    OR attempted."provider" IS DISTINCT FROM NEW."provider"
    OR attempted."key_id" IS DISTINCT FROM NEW."key_id"
    OR attempted."digest" IS DISTINCT FROM NEW."digest"
    OR attempted."purpose" IS DISTINCT FROM NEW."purpose"
    OR attempted."started_at" IS DISTINCT FROM NEW."started_at"
  THEN
    RAISE EXCEPTION 'EVM signing terminal event does not match its attempted event';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "tokenless_evm_signing_ledger_consistent_insert_trigger"
  BEFORE INSERT ON "tokenless_evm_signing_ledger"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_evm_signing_ledger_consistent_insert"();
