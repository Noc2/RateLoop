ALTER TABLE "tokenless_workspace_governance"
  ADD COLUMN "billing_country_code" text,
  ADD COLUMN "billing_address_line1" text,
  ADD COLUMN "billing_address_line2" text,
  ADD COLUMN "billing_city" text,
  ADD COLUMN "billing_postal_code" text,
  ADD COLUMN "billing_state" text;--> statement-breakpoint

ALTER TABLE "tokenless_workspace_governance"
  ADD CONSTRAINT "tokenless_workspace_governance_billing_address_check" CHECK (
    (
      "billing_country_code" IS NULL AND "billing_address_line1" IS NULL
      AND "billing_address_line2" IS NULL AND "billing_city" IS NULL
      AND "billing_postal_code" IS NULL AND "billing_state" IS NULL
    ) OR (
      "billing_country_code" ~ '^[A-Z]{2}$'
      AND char_length("billing_address_line1") BETWEEN 1 AND 200
      AND char_length("billing_city") BETWEEN 1 AND 120
      AND char_length("billing_postal_code") BETWEEN 1 AND 32
      AND ("billing_address_line2" IS NULL OR char_length("billing_address_line2") BETWEEN 1 AND 200)
      AND ("billing_state" IS NULL OR char_length("billing_state") BETWEEN 1 AND 120)
    )
  );--> statement-breakpoint

CREATE TABLE "tokenless_prepaid_topup_intents" (
  "topup_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL REFERENCES "tokenless_workspaces"("workspace_id") ON DELETE RESTRICT,
  "requested_by" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "amount_atomic" numeric(78, 0) NOT NULL,
  "invoice_currency" text DEFAULT 'usd' NOT NULL,
  "invoice_amount_minor" bigint NOT NULL,
  "provider_amount_due_minor" bigint,
  "provider_tax_amount_minor" bigint,
  "provider" text DEFAULT 'stripe' NOT NULL,
  "provider_customer_id" text,
  "provider_invoice_id" text,
  "provider_invoice_number" text,
  "hosted_invoice_url" text,
  "invoice_pdf_url" text,
  "state" text DEFAULT 'draft' NOT NULL,
  "failure_code" text,
  "provider_event_id" text,
  "provider_event_created_at" timestamp with time zone,
  "reconciliation_attempts" integer DEFAULT 0 NOT NULL,
  "next_reconcile_at" timestamp with time zone,
  "last_reconciled_at" timestamp with time zone,
  "requested_at" timestamp with time zone NOT NULL,
  "issued_at" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "credited_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "updated_at" timestamp with time zone NOT NULL,
  CONSTRAINT "tokenless_prepaid_topup_workspace_idempotency_unique" UNIQUE ("workspace_id", "idempotency_key"),
  CONSTRAINT "tokenless_prepaid_topup_provider_invoice_unique" UNIQUE ("provider_invoice_id"),
  CONSTRAINT "tokenless_prepaid_topup_provider_event_unique" UNIQUE ("provider_event_id"),
  CONSTRAINT "tokenless_prepaid_topup_amount_check" CHECK (
    "amount_atomic" BETWEEN 1000000 AND 100000000000
    AND mod("amount_atomic", 10000) = 0
    AND "invoice_amount_minor" = ("amount_atomic" / 10000)
  ),
  CONSTRAINT "tokenless_prepaid_topup_provider_amount_check" CHECK (
    ("state" = 'draft' AND "provider_amount_due_minor" IS NULL AND "provider_tax_amount_minor" IS NULL)
    OR (
      "state" <> 'draft' AND "provider_amount_due_minor" IS NOT NULL
      AND "provider_amount_due_minor" >= "invoice_amount_minor"
      AND "provider_tax_amount_minor" = ("provider_amount_due_minor" - "invoice_amount_minor")
    )
  ),
  CONSTRAINT "tokenless_prepaid_topup_currency_check" CHECK ("invoice_currency" = 'usd'),
  CONSTRAINT "tokenless_prepaid_topup_provider_check" CHECK ("provider" = 'stripe'),
  CONSTRAINT "tokenless_prepaid_topup_state_check" CHECK ("state" IN ('draft','sent','paid','credited','failed')),
  CONSTRAINT "tokenless_prepaid_topup_issue_check" CHECK (
    ("state" = 'draft' AND "provider_customer_id" IS NULL AND "provider_invoice_id" IS NULL AND "issued_at" IS NULL)
    OR ("state" <> 'draft' AND "provider_customer_id" IS NOT NULL AND "provider_invoice_id" IS NOT NULL AND "issued_at" IS NOT NULL)
  ),
  CONSTRAINT "tokenless_prepaid_topup_terminal_check" CHECK (
    (
      "state" = 'draft' AND "paid_at" IS NULL AND "credited_at" IS NULL AND "failed_at" IS NULL
      AND "failure_code" IS NULL AND "provider_event_id" IS NULL AND "provider_event_created_at" IS NULL
      AND "next_reconcile_at" IS NOT NULL
    ) OR (
      "state" = 'sent' AND "paid_at" IS NULL AND "credited_at" IS NULL AND "failed_at" IS NULL
      AND "next_reconcile_at" IS NOT NULL
    ) OR (
      "state" = 'paid' AND "paid_at" IS NOT NULL AND "credited_at" IS NULL AND "failed_at" IS NULL
      AND "provider_event_id" IS NOT NULL AND "provider_event_created_at" IS NOT NULL
      AND "next_reconcile_at" IS NOT NULL
    ) OR (
      "state" = 'credited' AND "paid_at" IS NOT NULL AND "credited_at" IS NOT NULL AND "failed_at" IS NULL
      AND "failure_code" IS NULL AND "provider_event_id" IS NOT NULL AND "provider_event_created_at" IS NOT NULL
      AND "next_reconcile_at" IS NULL
    ) OR (
      "state" = 'failed' AND "failed_at" IS NOT NULL AND "failure_code" IS NOT NULL
      AND "credited_at" IS NULL AND "next_reconcile_at" IS NULL
    )
  ),
  CONSTRAINT "tokenless_prepaid_topup_reconciliation_check" CHECK (
    "reconciliation_attempts" >= 0
    AND (("provider_event_id" IS NULL) = ("provider_event_created_at" IS NULL))
  )
);--> statement-breakpoint
CREATE INDEX "tokenless_prepaid_topup_workspace_created_idx"
  ON "tokenless_prepaid_topup_intents" ("workspace_id", "requested_at" DESC);--> statement-breakpoint
CREATE INDEX "tokenless_prepaid_topup_reconcile_idx"
  ON "tokenless_prepaid_topup_intents" ("state", "next_reconcile_at")
  WHERE "state" IN ('draft','sent','paid');--> statement-breakpoint
