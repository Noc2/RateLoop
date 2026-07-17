import { __prepaidTopupTestUtils } from "./prepaidTopups";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type Stripe from "stripe";

const originalStripeKey = process.env.STRIPE_SECRET_KEY;
const originalBankTransferType = process.env.STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE;

const row = {
  invoice_amount_minor: 10_000,
  invoice_currency: "usd",
  provider_amount_due_minor: 11_900,
  provider_customer_id: "cus_topup",
  topup_id: "topup_123",
  workspace_id: "ws_123",
};

function invoice(overrides: Partial<Stripe.Invoice> = {}) {
  return {
    amount_due: 11_900,
    amount_overpaid: 0,
    amount_paid: 11_900,
    amount_paid_off_stripe: 0,
    amount_remaining: 0,
    collection_method: "send_invoice",
    currency: "usd",
    customer: "cus_topup",
    livemode: false,
    metadata: {
      rateloop_purpose: "prepaid_topup",
      rateloop_topup_id: "topup_123",
      rateloop_workspace_id: "ws_123",
    },
    payment_settings: {
      payment_method_options: { customer_balance: { bank_transfer: { type: "us_bank_transfer" } } },
      payment_method_types: ["customer_balance"],
    },
    starting_balance: 0,
    total_excluding_tax: 10_000,
    ...overrides,
  } as unknown as Stripe.Invoice;
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  process.env.STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE = "us_bank_transfer";
});

afterEach(() => {
  if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalStripeKey;
  if (originalBankTransferType === undefined) delete process.env.STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE;
  else process.env.STRIPE_PREPAID_TOPUP_BANK_TRANSFER_TYPE = originalBankTransferType;
});

test("prepaid invoice validation keeps tax in gross while crediting the immutable net", () => {
  assert.equal(__prepaidTopupTestUtils.invoiceValidationError(invoice(), row), null);
  assert.equal(
    __prepaidTopupTestUtils.invoiceValidationError(invoice({ total_excluding_tax: 11_900 }), row),
    "invoice_net_amount_mismatch",
  );
  assert.equal(
    __prepaidTopupTestUtils.invoiceValidationError(invoice({ amount_due: 10_000, amount_paid: 10_000 }), row),
    "invoice_amount_due_mismatch",
  );
});

test("off-Stripe and existing-customer-credit invoice states fail closed", () => {
  assert.equal(
    __prepaidTopupTestUtils.invoiceValidationError(invoice({ amount_paid_off_stripe: 11_900 }), row),
    "invoice_paid_out_of_band",
  );
  assert.equal(
    __prepaidTopupTestUtils.invoiceValidationError(invoice({ starting_balance: -11_900 }), row),
    "invoice_customer_credit_applied",
  );
});

test("partial, overpaid, and wrong-rail invoices are not valid for credit", () => {
  assert.equal(
    __prepaidTopupTestUtils.invoiceValidationError(invoice({ amount_paid: 10_000, amount_remaining: 1_900 }), row),
    "invoice_amount_paid_mismatch",
  );
  assert.equal(
    __prepaidTopupTestUtils.invoiceValidationError(invoice({ amount_overpaid: 100 }), row),
    "invoice_overpaid",
  );
  assert.equal(
    __prepaidTopupTestUtils.invoiceValidationError(
      invoice({ payment_settings: { payment_method_types: ["card"] } as Stripe.Invoice.PaymentSettings }),
      row,
    ),
    "invoice_payment_method_mismatch",
  );
  assert.equal(
    __prepaidTopupTestUtils.invoiceValidationError(
      invoice({
        payment_settings: {
          payment_method_options: { customer_balance: { bank_transfer: { type: "eu_bank_transfer" } } },
          payment_method_types: ["customer_balance"],
        } as Stripe.Invoice.PaymentSettings,
      }),
      row,
    ),
    "invoice_bank_transfer_type_mismatch",
  );
});
