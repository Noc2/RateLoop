ALTER TABLE "tokenless_scheduled_work_items"
  ADD COLUMN "terminal_reason_code" text;--> statement-breakpoint

UPDATE "tokenless_scheduled_work_items"
SET "terminal_reason_code" = 'chain_transaction_reconciliation_required'
WHERE "state" = 'dead'
  AND "last_error" LIKE 'nonce_integrity:chain_transaction_reconciliation_required:%';--> statement-breakpoint

UPDATE "tokenless_scheduled_work_items"
SET "terminal_reason_code" = 'rater_signed_transaction_mismatch'
WHERE "state" = 'dead'
  AND "last_error" LIKE 'nonce_integrity:rater_signed_transaction_mismatch:%';--> statement-breakpoint

UPDATE "tokenless_scheduled_work_items"
SET "terminal_reason_code" = 'rater_transaction_reconciliation_required'
WHERE "state" = 'dead'
  AND "last_error" LIKE 'nonce_integrity:rater_transaction_reconciliation_required:%';--> statement-breakpoint

UPDATE "tokenless_scheduled_work_items"
SET "terminal_reason_code" = 'signed_transaction_mismatch'
WHERE "state" = 'dead'
  AND "last_error" LIKE 'nonce_integrity:signed_transaction_mismatch:%';--> statement-breakpoint

UPDATE "tokenless_scheduled_work_items"
SET "terminal_reason_code" = 'evm_transaction_fee_policy_exhausted'
WHERE "state" = 'dead'
  AND "last_error" LIKE 'operator_action:evm_transaction_fee_policy_exhausted:%';--> statement-breakpoint

UPDATE "tokenless_scheduled_work_items"
SET "terminal_reason_code" = 'x402_authorization_used_reconciliation_required'
WHERE "state" = 'dead'
  AND "kind" = 'recover_chain_execution'
  AND "subject_key" IN (
    SELECT "operation_key"
    FROM "tokenless_chain_executions"
    WHERE "failure_code" = 'x402_authorization_used_reconciliation_required'
  );--> statement-breakpoint

ALTER TABLE "tokenless_scheduled_work_items"
  ADD CONSTRAINT "tokenless_scheduled_work_items_terminal_reason_check"
  CHECK (
    "terminal_reason_code" IS NULL
    OR (
      "state" = 'dead'
      AND "terminal_reason_code" ~ '^[a-z][a-z0-9_]{0,159}$'
    )
  );
