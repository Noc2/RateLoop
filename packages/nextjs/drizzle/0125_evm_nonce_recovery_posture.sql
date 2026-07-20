UPDATE "tokenless_chain_executions"
SET "transaction_recovery_version" = 1
WHERE "transaction_recovery_version" = 0
  AND "approval_nonce" IS NULL
  AND "approval_transaction_hash" IS NULL
  AND "approval_signed_transaction" IS NULL
  AND "submission_nonce" IS NULL
  AND "submission_transaction_hash" IS NULL
  AND "submission_signed_transaction" IS NULL;--> statement-breakpoint
UPDATE "tokenless_rater_commits"
SET "transaction_recovery_version" = 1
WHERE "transaction_recovery_version" = 0
  AND "relay_nonce" IS NULL
  AND "transaction_hash" IS NULL
  AND "relay_signed_transaction" IS NULL;--> statement-breakpoint
UPDATE "tokenless_surprise_bounty_entitlements"
SET "transaction_recovery_version" = 1
WHERE "transaction_recovery_version" = 0
  AND "transfer_nonce" IS NULL
  AND "transfer_transaction_hash" IS NULL
  AND "transfer_signed_transaction" IS NULL;--> statement-breakpoint
CREATE TABLE "tokenless_evm_nonce_recovery_findings" (
  "finding_id" text PRIMARY KEY NOT NULL,
  "deployment_key" text NOT NULL,
  "signer_address" text NOT NULL,
  "signer_role" text NOT NULL,
  "reserved_nonce" numeric(78, 0) NOT NULL,
  "business_kind" text,
  "business_key" text,
  "state" text DEFAULT 'pending' NOT NULL,
  "diagnostic_code" text NOT NULL,
  "allocator_next_nonce" numeric(78, 0) NOT NULL,
  "network_pending_nonce" numeric(78, 0) NOT NULL,
  "first_detected_at" timestamp with time zone NOT NULL,
  "last_detected_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "tokenless_evm_nonce_recovery_findings_subject_unique"
    UNIQUE("deployment_key", "signer_address", "reserved_nonce"),
  CONSTRAINT "tokenless_evm_nonce_recovery_findings_role_check"
    CHECK ("signer_role" IN ('prepaid_funder', 'gas_only_relayer', 'surprise_bonus_funder')),
  CONSTRAINT "tokenless_evm_nonce_recovery_findings_business_check"
    CHECK (
      ("business_kind" IS NULL AND "business_key" IS NULL)
      OR ("business_kind" IN ('chain_execution', 'rater_commit', 'surprise_bounty') AND "business_key" IS NOT NULL)
    ),
  CONSTRAINT "tokenless_evm_nonce_recovery_findings_state_check"
    CHECK ("state" IN ('pending', 'reconciliation_required', 'resolved'))
);--> statement-breakpoint
CREATE INDEX "tokenless_evm_nonce_recovery_findings_state_idx"
  ON "tokenless_evm_nonce_recovery_findings" USING btree
  ("state", "last_detected_at", "signer_role");
