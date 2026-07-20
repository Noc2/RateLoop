DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "tokenless_evm_kms_signing_ledger"
    WHERE "outcome" IN ('succeeded', 'failed')
    GROUP BY "attempt_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'EVM KMS signing ledger contains contradictory terminal outcomes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "tokenless_evm_kms_signing_ledger" AS terminal
    LEFT JOIN "tokenless_evm_kms_signing_ledger" AS attempted
      ON attempted."attempt_id" = terminal."attempt_id"
      AND attempted."outcome" = 'attempted'
    WHERE terminal."outcome" IN ('succeeded', 'failed')
      AND (
        attempted."event_id" IS NULL
        OR attempted."signer_role" IS DISTINCT FROM terminal."signer_role"
        OR attempted."key_arn" IS DISTINCT FROM terminal."key_arn"
        OR attempted."digest" IS DISTINCT FROM terminal."digest"
        OR attempted."purpose" IS DISTINCT FROM terminal."purpose"
        OR attempted."started_at" IS DISTINCT FROM terminal."started_at"
      )
  ) THEN
    RAISE EXCEPTION 'EVM KMS signing ledger contains an inconsistent attempt identity';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX "tokenless_evm_kms_signing_ledger_terminal_unique"
  ON "tokenless_evm_kms_signing_ledger" USING btree ("attempt_id")
  WHERE "outcome" IN ('succeeded', 'failed');
--> statement-breakpoint
ALTER TABLE "tokenless_evm_kms_signing_ledger"
  ADD CONSTRAINT "tokenless_evm_kms_signing_ledger_transaction_identity_check" CHECK (
    "outcome" <> 'succeeded'
    OR (
      ("purpose" = 'evm_transaction' AND "transaction_hash" IS NOT NULL)
      OR ("purpose" <> 'evm_transaction' AND "transaction_hash" IS NULL)
    )
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "tokenless_evm_kms_signing_ledger"
  VALIDATE CONSTRAINT "tokenless_evm_kms_signing_ledger_transaction_identity_check";
--> statement-breakpoint
ALTER TABLE "tokenless_evm_kms_signing_ledger"
  ADD CONSTRAINT "tokenless_evm_kms_signing_ledger_completion_recorded_check" CHECK (
    "completed_at" IS NULL OR "recorded_at" >= "completed_at"
  ) NOT VALID;
--> statement-breakpoint
ALTER TABLE "tokenless_evm_kms_signing_ledger"
  VALIDATE CONSTRAINT "tokenless_evm_kms_signing_ledger_completion_recorded_check";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "tokenless_evm_kms_signing_ledger_consistent_insert"()
RETURNS trigger AS $$
DECLARE
  attempted "tokenless_evm_kms_signing_ledger"%ROWTYPE;
BEGIN
  IF NEW."outcome" = 'attempted' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO attempted
  FROM "tokenless_evm_kms_signing_ledger"
  WHERE "attempt_id" = NEW."attempt_id" AND "outcome" = 'attempted';

  IF NOT FOUND
    OR attempted."signer_role" IS DISTINCT FROM NEW."signer_role"
    OR attempted."key_arn" IS DISTINCT FROM NEW."key_arn"
    OR attempted."digest" IS DISTINCT FROM NEW."digest"
    OR attempted."purpose" IS DISTINCT FROM NEW."purpose"
    OR attempted."started_at" IS DISTINCT FROM NEW."started_at"
  THEN
    RAISE EXCEPTION 'EVM KMS signing terminal event does not match its attempted event';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "tokenless_evm_kms_signing_ledger_consistent_insert_trigger"
  BEFORE INSERT ON "tokenless_evm_kms_signing_ledger"
  FOR EACH ROW EXECUTE FUNCTION "tokenless_evm_kms_signing_ledger_consistent_insert"();
--> statement-breakpoint
CREATE TRIGGER "tokenless_evm_kms_signing_ledger_append_only_truncate_trigger"
  BEFORE TRUNCATE ON "tokenless_evm_kms_signing_ledger"
  FOR EACH STATEMENT EXECUTE FUNCTION "tokenless_evm_kms_signing_ledger_append_only"();
