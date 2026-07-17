# Fiat review funding

**Status:** available only when `TOKENLESS_PREPAID_TOPUP_ENABLED=true`; production use remains subject to the billing and legal readiness gates.

RateLoop uses Stripe Invoicing as a bridge into the existing prepaid review ledger. It does not treat Stripe Billing credits as RateLoop review credit and it does not credit tax.

## Current funding rail

The first implementation is USD-only:

1. A workspace owner or billing member enters a USD amount in Workspace settings.
2. RateLoop creates and sends a standalone Stripe invoice with automatic tax, `collection_method=send_invoice`, and `customer_balance` / `us_bank_transfer`.
3. The invoice shows the gross amount due. The immutable RateLoop credit is the requested net USD amount; any Stripe Tax amount is tracked separately on the invoice.
4. RateLoop retrieves and validates the canonical Stripe invoice after a signed webhook or scheduled reconciliation.
5. Only a fully paid, on-Stripe bank-transfer invoice with the exact workspace, customer, currency, net amount, gross amount, live/test mode, and payment method credits `tokenless_prepaid_ledger_entries`.
6. The workspace balance, reservations, ledger entries, invoice page, and invoice PDF are visible in Workspace settings.

EUR and SEPA bank-transfer funding are not part of this version. They require an explicit FX, pricing, liquidity, and reconciliation design before implementation.
Stripe documents the customer-balance virtual-account and reconciliation model in [Bank transfer payments](https://docs.stripe.com/invoicing/bank-transfer); this implementation explicitly selects `us_bank_transfer` and must not be described as a SEPA account.

## Fail-closed settlement

Paid-out-of-band invoices and invoices paid using a pre-existing Stripe customer balance do not create review credit. Partial payment, overpayment, underpayment, currency or amount drift, wrong customer/workspace metadata, payment-method drift, and test/live-mode mismatch also do not credit the ledger. Webhook projection and scheduled reconciliation share the same validation and exactly-once ledger reference.

A voided unpaid invoice becomes failed. A credited invoice can never be silently reversed by this bridge; any later provider dispute is an operator reconciliation incident rather than a mutation of accepted review funding.

## Billing profile and tax

Invoice funding requires a structured billing address (country, line 1, city, and postal code). VAT country and VAT ID must be supplied together. RateLoop syncs those self-declared billing fields to the Stripe customer before issuing the invoice.

For German domestic B2B invoicing, a plain PDF is an unstructured “other invoice,” not a structured E-Rechnung. German businesses have needed to be able to receive structured invoices since 1 January 2025. The official transition permits other invoices through 31 December 2026 for all issuers and through 31 December 2027 when the issuer’s prior-year turnover is no more than EUR 800,000. Structured issuance therefore applies from 2027 or 2028 depending on the issuer. See the [German Federal Ministry of Finance E-Rechnung FAQ](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html).

XRechnung/ZUGFeRD generation and delivery are deferred. No marketplace partner is preselected; choose and approve one only when a German customer’s actual format and delivery requirements are known.
