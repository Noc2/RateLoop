import { requireVerifiedBusinessCustomer } from "./businessCustomerEligibility";
import {
  assertPrepaidTopupConfiguration,
  createAndSendPrepaidInvoice,
  getPrepaidTopupBankTransferType,
  getStripe,
  prepaidTopupsEnabled,
  preparePrepaidInvoiceCustomer,
  stripeLivemode,
} from "./stripe";
import { getOrCreateBillingCustomer, requireWorkspaceTopupAccess } from "./workspaceBilling";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import type Stripe from "stripe";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbClient, dbPool } from "~~/lib/db";
import { releaseSessionAdvisoryLocksAndConnection, tryAcquireSessionAdvisoryLock } from "~~/lib/db/advisoryLocks";
import { appendAuditEvent } from "~~/lib/privacy/audit";
import { maintenanceCancellationRequested } from "~~/lib/tokenless/maintenanceCancellation";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type QueryRow = Record<string, unknown> | undefined;
type TopupState = "draft" | "sent" | "paid" | "credited" | "failed";
type TopupAuditType = "requested" | "issued" | "paid" | "credited" | "failed";

const MIN_TOPUP_ATOMIC = 1_000_000n;
const MAX_TOPUP_ATOMIC = 100_000_000_000n;
const USD_CENT_ATOMIC = 10_000n;
const RECONCILE_DELAY_MS = 15 * 60_000;

function text(row: QueryRow, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: QueryRow, key: string) {
  const value = Number(row?.[key]);
  if (!Number.isSafeInteger(value)) throw new Error(`Database returned an invalid ${key}.`);
  return value;
}

function dateIso(row: QueryRow, key: string) {
  const raw = text(row, key);
  if (!raw) return null;
  const value = new Date(raw);
  if (!Number.isFinite(value.getTime())) throw new Error(`Database returned an invalid ${key}.`);
  return value.toISOString();
}

function normalizeIdempotencyKey(value: unknown) {
  if (typeof value !== "string") {
    throw new TokenlessServiceError("idempotencyKey is required.", 400, "invalid_topup_request");
  }
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/u.test(normalized)) {
    throw new TokenlessServiceError("idempotencyKey must contain 8-160 safe characters.", 400, "invalid_topup_request");
  }
  return normalized;
}

function normalizeAmountAtomic(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{0,20}$/u.test(value)) {
    throw new TokenlessServiceError("amountAtomic must be a positive integer string.", 400, "invalid_topup_amount");
  }
  const amount = BigInt(value);
  if (amount < MIN_TOPUP_ATOMIC || amount > MAX_TOPUP_ATOMIC || amount % USD_CENT_ATOMIC !== 0n) {
    throw new TokenlessServiceError(
      "Top-ups must be whole USD cents from $1 to $100,000.",
      400,
      "invalid_topup_amount",
    );
  }
  return amount;
}

function deterministicId(prefix: string, ...parts: string[]) {
  return `${prefix}_${createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 32)}`;
}

function topupFromRow(row: QueryRow) {
  const topupId = text(row, "topup_id");
  const workspaceId = text(row, "workspace_id");
  const amountAtomic = text(row, "amount_atomic");
  const state = text(row, "state") as TopupState | null;
  if (!topupId || !workspaceId || !amountAtomic || !state) throw new Error("Database returned an invalid top-up.");
  return {
    topupId,
    workspaceId,
    amountAtomic,
    amountUsd: (Number(BigInt(amountAtomic)) / 1_000_000).toFixed(2),
    state,
    hostedInvoiceUrl: text(row, "hosted_invoice_url"),
    invoicePdfUrl: text(row, "invoice_pdf_url"),
    invoiceNumber: text(row, "provider_invoice_number"),
    failureCode: text(row, "failure_code"),
    requestedAt: dateIso(row, "requested_at"),
    issuedAt: dateIso(row, "issued_at"),
    paidAt: dateIso(row, "paid_at"),
    creditedAt: dateIso(row, "credited_at"),
  };
}

async function enqueueAudit(
  client: PoolClient,
  input: {
    actorReference: string;
    eventType: TopupAuditType;
    occurredAt: Date;
    topupId: string;
    workspaceId: string;
  },
) {
  const eventSequence: Record<TopupAuditType, number> = { requested: 1, issued: 2, paid: 3, credited: 4, failed: 5 };
  await client.query(
    `INSERT INTO tokenless_prepaid_topup_audit_outbox
       (outbox_id,workspace_id,topup_id,event_type,event_sequence,actor_reference,event_occurred_at,state,
        attempt_count,next_attempt_at,last_error_code,audit_event_id,audit_event_digest,created_at,delivered_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',0,$7,NULL,NULL,NULL,$7,NULL,$7)
     ON CONFLICT (topup_id,event_type) DO NOTHING`,
    [
      deterministicId("topup_audit", input.topupId, input.eventType),
      input.workspaceId,
      input.topupId,
      input.eventType,
      eventSequence[input.eventType],
      input.actorReference,
      input.occurredAt,
    ],
  );
}

async function insertDraft(input: {
  accountAddress: string;
  amountAtomic: bigint;
  idempotencyKey: string;
  now: Date;
  workspaceId: string;
}) {
  const topupId = deterministicId("topup", input.workspaceId, input.idempotencyKey);
  const actor = normalizeAccountSubject(input.accountAddress);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_prepaid_topup_intents
         (topup_id,workspace_id,requested_by,idempotency_key,amount_atomic,invoice_currency,
          invoice_amount_minor,provider,state,reconciliation_attempts,next_reconcile_at,requested_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'usd',$6,'stripe','draft',0,$7,$7,$7)
       ON CONFLICT (workspace_id,idempotency_key) DO NOTHING`,
      [
        topupId,
        input.workspaceId,
        actor,
        input.idempotencyKey,
        input.amountAtomic.toString(),
        Number(input.amountAtomic / USD_CENT_ATOMIC),
        input.now,
      ],
    );
    const stored = await client.query(
      `SELECT topup_id,workspace_id,requested_by,idempotency_key,amount_atomic,state,provider_invoice_id,
              hosted_invoice_url,invoice_pdf_url,provider_invoice_number,failure_code,requested_at,issued_at,paid_at,credited_at
       FROM tokenless_prepaid_topup_intents WHERE workspace_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [input.workspaceId, input.idempotencyKey],
    );
    const row = stored.rows[0] as QueryRow;
    if (
      text(row, "topup_id") !== topupId ||
      text(row, "requested_by") !== actor ||
      text(row, "amount_atomic") !== input.amountAtomic.toString()
    ) {
      throw new TokenlessServiceError(
        "The idempotency key is already bound to a different top-up.",
        409,
        "topup_idempotency_conflict",
      );
    }
    await enqueueAudit(client, {
      actorReference: actor,
      eventType: "requested",
      occurredAt: input.now,
      topupId,
      workspaceId: input.workspaceId,
    });
    await client.query("COMMIT");
    return row;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createPrepaidTopup(input: {
  accountAddress: string;
  amountAtomic: unknown;
  idempotencyKey: unknown;
  workspaceId: string;
  now?: Date;
}) {
  assertPrepaidTopupConfiguration();
  const amountAtomic = normalizeAmountAtomic(input.amountAtomic);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const now = input.now ?? new Date();
  const { profile } = await requireWorkspaceTopupAccess(input);
  await requireVerifiedBusinessCustomer({ workspaceId: input.workspaceId, now });
  if (!profile.complete || !profile.legalName) {
    throw new TokenlessServiceError(
      "Complete the business billing profile before requesting an invoice.",
      409,
      "billing_profile_required",
    );
  }
  const address = profile.billingAddress;
  if (!address.country || !address.line1 || !address.city || !address.postalCode) {
    throw new TokenlessServiceError(
      "Add a structured invoice address before requesting a top-up.",
      409,
      "billing_address_required",
    );
  }
  const draft = await insertDraft({
    accountAddress: input.accountAddress,
    amountAtomic,
    idempotencyKey,
    now,
    workspaceId: input.workspaceId,
  });
  if (text(draft, "state") !== "draft") {
    await drainPrepaidTopupAuditOutbox({ topupId: text(draft, "topup_id")! });
    return topupFromRow(draft);
  }

  const customerId = await getOrCreateBillingCustomer({ legalName: profile.legalName, workspaceId: input.workspaceId });
  await preparePrepaidInvoiceCustomer({
    address: {
      city: address.city,
      country: address.country,
      line1: address.line1,
      line2: address.line2,
      postalCode: address.postalCode,
      state: address.state,
    },
    customerId,
    legalName: profile.legalName,
    vatId: profile.vatId?.replace(/\s+/gu, "").toUpperCase() ?? null,
    workspaceId: input.workspaceId,
  });
  const invoice = await createAndSendPrepaidInvoice({
    amountMinor: Number(amountAtomic / USD_CENT_ATOMIC),
    customerId,
    legalName: profile.legalName,
    topupId: text(draft, "topup_id")!,
    workspaceId: input.workspaceId,
  });
  const client = await dbPool.connect();
  let stored: QueryRow;
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE tokenless_prepaid_topup_intents SET
         provider_customer_id=$1,provider_invoice_id=$2,provider_invoice_number=$3,
         hosted_invoice_url=$4,invoice_pdf_url=$5,provider_amount_due_minor=$6,provider_tax_amount_minor=$7,
         state='sent',failure_code=NULL,issued_at=$8,next_reconcile_at=$9,updated_at=$8
       WHERE topup_id=$10 AND state='draft'
       RETURNING *`,
      [
        customerId,
        invoice.id,
        invoice.number,
        invoice.hosted_invoice_url,
        invoice.invoice_pdf,
        invoice.amount_due,
        invoice.amount_due - Number(amountAtomic / USD_CENT_ATOMIC),
        now,
        new Date(now.getTime() + RECONCILE_DELAY_MS),
        text(draft, "topup_id"),
      ],
    );
    stored = updated.rows[0] as QueryRow;
    if (!stored) {
      const existing = await client.query(
        "SELECT * FROM tokenless_prepaid_topup_intents WHERE topup_id=$1 FOR UPDATE",
        [text(draft, "topup_id")],
      );
      stored = existing.rows[0] as QueryRow;
      if (text(stored, "provider_invoice_id") !== invoice.id) throw new Error("topup_invoice_binding_conflict");
    }
    await enqueueAudit(client, {
      actorReference: normalizeAccountSubject(input.accountAddress),
      eventType: "issued",
      occurredAt: now,
      topupId: text(draft, "topup_id")!,
      workspaceId: input.workspaceId,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await drainPrepaidTopupAuditOutbox({ topupId: text(draft, "topup_id")! });
  return topupFromRow(stored);
}

function invoiceCustomerId(invoice: Stripe.Invoice) {
  return typeof invoice.customer === "string" ? invoice.customer : (invoice.customer?.id ?? null);
}

function invoiceValidationError(invoice: Stripe.Invoice, row: QueryRow) {
  const expectedNetMinor = integer(row, "invoice_amount_minor");
  const expectedGrossMinor = integer(row, "provider_amount_due_minor");
  const expectedLivemode = stripeLivemode();
  if (invoice.livemode !== expectedLivemode) return "invoice_mode_mismatch";
  if (invoice.metadata?.rateloop_purpose !== "prepaid_topup") return "invoice_purpose_mismatch";
  if (invoice.metadata?.rateloop_topup_id !== text(row, "topup_id")) return "invoice_topup_mismatch";
  if (invoice.metadata?.rateloop_workspace_id !== text(row, "workspace_id")) return "invoice_workspace_mismatch";
  if (invoiceCustomerId(invoice) !== text(row, "provider_customer_id")) return "invoice_customer_mismatch";
  if (invoice.currency !== "usd" || invoice.currency !== text(row, "invoice_currency"))
    return "invoice_currency_mismatch";
  if (invoice.collection_method !== "send_invoice") return "invoice_collection_method_mismatch";
  if (invoice.amount_paid_off_stripe && invoice.amount_paid_off_stripe !== 0) return "invoice_paid_out_of_band";
  if (invoice.starting_balance !== 0) return "invoice_customer_credit_applied";
  if (invoice.total_excluding_tax !== expectedNetMinor) return "invoice_net_amount_mismatch";
  if (invoice.amount_due !== expectedGrossMinor) return "invoice_amount_due_mismatch";
  if (invoice.amount_paid !== expectedGrossMinor) return "invoice_amount_paid_mismatch";
  if (invoice.amount_overpaid !== 0) return "invoice_overpaid";
  if (invoice.amount_remaining !== 0) return "invoice_underpaid";
  const paymentTypes = invoice.payment_settings.payment_method_types ?? [];
  if (paymentTypes.length !== 1 || paymentTypes[0] !== "customer_balance") return "invoice_payment_method_mismatch";
  const paymentOptions = invoice.payment_settings.payment_method_options as
    | { customer_balance?: { bank_transfer?: { type?: string } } }
    | null
    | undefined;
  if (paymentOptions?.customer_balance?.bank_transfer?.type !== getPrepaidTopupBankTransferType()) {
    return "invoice_bank_transfer_type_mismatch";
  }
  return null;
}

const TERMINAL_INVOICE_ERRORS = new Set([
  "invoice_mode_mismatch",
  "invoice_purpose_mismatch",
  "invoice_topup_mismatch",
  "invoice_workspace_mismatch",
  "invoice_customer_mismatch",
  "invoice_currency_mismatch",
  "invoice_collection_method_mismatch",
  "invoice_paid_out_of_band",
  "invoice_customer_credit_applied",
  "invoice_net_amount_mismatch",
  "invoice_amount_due_mismatch",
  "invoice_payment_method_mismatch",
  "invoice_bank_transfer_type_mismatch",
]);

async function failTopup(
  client: PoolClient,
  input: { code: string; eventCreatedAt: Date; eventId: string; now: Date; row: QueryRow },
) {
  await client.query(
    `UPDATE tokenless_prepaid_topup_intents SET state='failed',failure_code=$1,
       provider_event_id=$2,provider_event_created_at=$3,failed_at=$4,next_reconcile_at=NULL,updated_at=$4
     WHERE topup_id=$5 AND state IN ('sent','paid')`,
    [input.code, input.eventId, input.eventCreatedAt, input.now, text(input.row, "topup_id")],
  );
  await enqueueAudit(client, {
    actorReference: "system:stripe",
    eventType: "failed",
    occurredAt: input.now,
    topupId: text(input.row, "topup_id")!,
    workspaceId: text(input.row, "workspace_id")!,
  });
}

/**
 * Bind an invoice that Stripe already issued to the `draft` intent it was created for.
 *
 * `createPrepaidTopup` cannot record `provider_invoice_id` before Stripe makes the invoice
 * payable: `tokenless_prepaid_topup_issue_check` forbids a `draft` row from carrying an invoice
 * id, and `tokenless_prepaid_topup_provider_amount_check` needs the finalized gross amount, which
 * only exists once Stripe has computed tax. Widening those constraints needs a migration, so the
 * orphan window is closed from the other end instead: an invoice that names a draft intent in its
 * metadata is adopted when its first event arrives, which lets the payment credit normally.
 */
async function adoptOrphanedInvoice(client: PoolClient, invoice: Stripe.Invoice) {
  const topupId = invoice.metadata?.rateloop_topup_id;
  const workspaceId = invoice.metadata?.rateloop_workspace_id;
  const customerId = invoiceCustomerId(invoice);
  if (
    invoice.metadata?.rateloop_purpose !== "prepaid_topup" ||
    !topupId ||
    !workspaceId ||
    !customerId ||
    !invoice.id ||
    invoice.livemode !== stripeLivemode() ||
    invoice.currency !== "usd" ||
    invoice.collection_method !== "send_invoice"
  ) {
    return null;
  }
  const candidate = await client.query(
    `SELECT * FROM tokenless_prepaid_topup_intents
     WHERE topup_id=$1 AND workspace_id=$2 AND provider='stripe' AND state='draft' AND provider_invoice_id IS NULL
     FOR UPDATE`,
    [topupId, workspaceId],
  );
  const row = candidate.rows[0] as QueryRow;
  if (!row) return null;
  const netMinor = integer(row, "invoice_amount_minor");
  const grossMinor = invoice.amount_due;
  if (invoice.total_excluding_tax !== netMinor || !Number.isSafeInteger(grossMinor) || grossMinor < netMinor) {
    return null;
  }
  const now = new Date();
  const adopted = await client.query(
    `UPDATE tokenless_prepaid_topup_intents SET
       provider_customer_id=$1,provider_invoice_id=$2,provider_invoice_number=$3,
       hosted_invoice_url=$4,invoice_pdf_url=$5,provider_amount_due_minor=$6,provider_tax_amount_minor=$7,
       state='sent',failure_code=NULL,issued_at=$8,next_reconcile_at=$9,updated_at=$8
     WHERE topup_id=$10 AND state='draft'
     RETURNING *`,
    [
      customerId,
      invoice.id,
      invoice.number ?? null,
      invoice.hosted_invoice_url ?? null,
      invoice.invoice_pdf ?? null,
      grossMinor,
      grossMinor - netMinor,
      now,
      new Date(now.getTime() + RECONCILE_DELAY_MS),
      topupId,
    ],
  );
  const stored = adopted.rows[0] as QueryRow;
  if (!stored) return null;
  await enqueueAudit(client, {
    actorReference: "system:stripe",
    eventType: "issued",
    occurredAt: now,
    topupId,
    workspaceId,
  });
  return stored;
}

export type PrepaidInvoiceProjection = { matched: boolean; credited: boolean; attention?: string };

function projection(matched: boolean, credited: boolean, attention?: string): PrepaidInvoiceProjection {
  return attention ? { attention, credited, matched } : { credited, matched };
}

export async function projectPrepaidInvoice(
  client: PoolClient,
  input: { eventCreatedAt: Date; eventId: string; invoice: Stripe.Invoice },
): Promise<PrepaidInvoiceProjection> {
  const invoice = input.invoice;
  const result = await client.query(
    `SELECT * FROM tokenless_prepaid_topup_intents
     WHERE provider='stripe' AND provider_invoice_id=$1 FOR UPDATE`,
    [invoice.id],
  );
  const row = (result.rows[0] as QueryRow) ?? (await adoptOrphanedInvoice(client, invoice));
  if (!row) return projection(false, false, "unmatched_prepaid_invoice");
  const state = text(row, "state") as TopupState;
  if (invoice.status === "void") {
    // A credited invoice cannot be unpaid by voiding it. Record it for an operator instead of
    // throwing: this is the shared endpoint for every billing event.
    if (state === "credited") return projection(true, true, "credited_invoice_voided");
    if (state !== "failed") {
      const now = new Date();
      await client.query(
        `UPDATE tokenless_prepaid_topup_intents SET state='failed',failure_code='invoice_voided',
           provider_event_id=$1,provider_event_created_at=$2,failed_at=$3,next_reconcile_at=NULL,updated_at=$3
         WHERE topup_id=$4`,
        [input.eventId, input.eventCreatedAt, now, text(row, "topup_id")],
      );
      await enqueueAudit(client, {
        actorReference: "system:stripe",
        eventType: "failed",
        occurredAt: now,
        topupId: text(row, "topup_id")!,
        workspaceId: text(row, "workspace_id")!,
      });
    }
    return projection(true, false);
  }
  if (invoice.status === "uncollectible") {
    if (state === "credited") {
      const reversed = await debitPrepaidReversal(client, {
        grossMinor: integer(row, "provider_amount_due_minor"),
        invoiceId: invoice.id!,
        reversalId: `uncollectible:${input.eventId}`,
        row,
      });
      return projection(true, true, reversed.attention ?? "credited_invoice_uncollectible");
    }
    if (state !== "failed") {
      await failTopup(client, {
        code: "invoice_uncollectible",
        eventCreatedAt: input.eventCreatedAt,
        eventId: input.eventId,
        now: new Date(),
        row,
      });
    }
    return projection(true, false);
  }
  if (state === "failed") {
    // The top-up already failed a terminal validation check. Never credit it, but do not throw
    // either: Stripe would retry the shared billing endpoint for days. Money that arrived after
    // the failure is recorded on the row and raised for an operator.
    if (invoice.status !== "paid") return projection(true, false);
    const now = new Date();
    await client.query(
      `UPDATE tokenless_prepaid_topup_intents SET paid_at=COALESCE(paid_at,$1),updated_at=$1
       WHERE topup_id=$2 AND state='failed'`,
      [now, text(row, "topup_id")],
    );
    return projection(true, false, "paid_invoice_for_failed_topup");
  }
  if (state === "credited") return projection(true, true);
  const validationError = invoiceValidationError(invoice, row);
  if (validationError && TERMINAL_INVOICE_ERRORS.has(validationError)) {
    await failTopup(client, {
      code: validationError,
      eventCreatedAt: input.eventCreatedAt,
      eventId: input.eventId,
      now: new Date(),
      row,
    });
    return projection(true, false);
  }
  if (invoice.status !== "paid" || validationError) {
    const code = validationError ?? `invoice_status_${invoice.status ?? "unknown"}`;
    await client.query(
      `UPDATE tokenless_prepaid_topup_intents SET failure_code=$1,
         reconciliation_attempts=reconciliation_attempts+1,last_reconciled_at=$2,
         next_reconcile_at=$3,updated_at=$2 WHERE topup_id=$4 AND state IN ('sent','paid')`,
      [code, new Date(), new Date(Date.now() + RECONCILE_DELAY_MS), text(row, "topup_id")],
    );
    return projection(true, false);
  }

  const now = new Date();
  await client.query(
    `UPDATE tokenless_prepaid_topup_intents SET state='paid',failure_code=NULL,paid_at=COALESCE(paid_at,$1),
       provider_event_id=$2,provider_event_created_at=$3,last_reconciled_at=$1,updated_at=$1
     WHERE topup_id=$4 AND state='sent'`,
    [now, input.eventId, input.eventCreatedAt, text(row, "topup_id")],
  );
  await enqueueAudit(client, {
    actorReference: "system:stripe",
    eventType: "paid",
    occurredAt: now,
    topupId: text(row, "topup_id")!,
    workspaceId: text(row, "workspace_id")!,
  });
  const externalReference = `stripe_invoice:${invoice.id}`;
  await client.query(
    `INSERT INTO tokenless_prepaid_ledger_entries
       (entry_id,workspace_id,delta_atomic,settlement_status,source,external_reference,created_at,settled_at)
     VALUES ($1,$2,$3,'settled','fiat_topup',$4,$5,$5)
     ON CONFLICT (external_reference) DO NOTHING`,
    [
      deterministicId("ledger", invoice.id),
      text(row, "workspace_id"),
      text(row, "amount_atomic"),
      externalReference,
      now,
    ],
  );
  const ledger = await client.query(
    `SELECT workspace_id,delta_atomic,settlement_status,source FROM tokenless_prepaid_ledger_entries
     WHERE external_reference=$1`,
    [externalReference],
  );
  const ledgerRow = ledger.rows[0] as QueryRow;
  if (
    text(ledgerRow, "workspace_id") !== text(row, "workspace_id") ||
    text(ledgerRow, "delta_atomic") !== text(row, "amount_atomic") ||
    text(ledgerRow, "settlement_status") !== "settled" ||
    text(ledgerRow, "source") !== "fiat_topup"
  ) {
    throw new Error("topup_ledger_binding_conflict");
  }
  await client.query(
    `UPDATE tokenless_prepaid_topup_intents SET state='credited',failure_code=NULL,credited_at=COALESCE(credited_at,$1),
       next_reconcile_at=NULL,last_reconciled_at=$1,updated_at=$1 WHERE topup_id=$2 AND state IN ('sent','paid')`,
    [now, text(row, "topup_id")],
  );
  await enqueueAudit(client, {
    actorReference: "system:stripe",
    eventType: "credited",
    occurredAt: now,
    topupId: text(row, "topup_id")!,
    workspaceId: text(row, "workspace_id")!,
  });
  return projection(true, true);
}

export type PrepaidReversalResult = { matched: boolean; reversedAtomic: string; attention?: string };

function reversalReference(invoiceId: string, reversalId: string) {
  return `stripe_reversal:${invoiceId}:${reversalId}`;
}

/** Net effect of every reversal already written for one invoice, as a non-negative magnitude. */
async function reversedAtomicForInvoice(client: PoolClient, workspaceId: string, invoiceId: string) {
  const result = await client.query(
    `SELECT delta_atomic,external_reference FROM tokenless_prepaid_ledger_entries
     WHERE workspace_id=$1 AND source IN ('fiat_topup_reversal','fiat_topup_reversal_reinstated')`,
    [workspaceId],
  );
  const prefix = reversalReference(invoiceId, "");
  const reversed = (result.rows as Record<string, unknown>[])
    .filter(row => (text(row, "external_reference") ?? "").startsWith(prefix))
    .reduce((total, row) => total + BigInt(text(row, "delta_atomic") ?? "0"), 0n);
  return reversed < 0n ? -reversed : 0n;
}

async function settledPrepaidBalance(client: PoolClient, workspaceId: string) {
  const result = await client.query(
    `SELECT COALESCE(SUM(delta_atomic),0) AS balance FROM tokenless_prepaid_ledger_entries
     WHERE workspace_id=$1 AND settlement_status='settled'`,
    [workspaceId],
  );
  return BigInt(text(result.rows[0] as QueryRow, "balance") ?? "0");
}

/**
 * Write the debiting ledger entry for a reversal of an already credited top-up.
 *
 * Exactly-once mirrors the credit path: the webhook event table refuses to reprocess a processed
 * event, and `external_reference` is unique, so a replay of the same credit note, refund, dispute
 * or uncollectible invoice cannot debit twice. A dashboard refund additionally emits both
 * `credit_note.created` and `charge.refunded` for the same money; those carry different reference
 * keys, so the per-invoice cap below — never reverse more than was credited for that invoice — is
 * what stops the second one from double-debiting.
 *
 * The debit is never trimmed to keep the balance non-negative: if the workspace already spent the
 * money, the balance goes negative, `reservePrepaid` then refuses all further paid work, and the
 * caller is told to raise it for an operator.
 */
async function debitPrepaidReversal(
  client: PoolClient,
  input: { grossMinor: number; invoiceId: string; reversalId: string; row: QueryRow },
): Promise<PrepaidReversalResult> {
  const workspaceId = text(input.row, "workspace_id")!;
  const creditedAtomic = BigInt(text(input.row, "amount_atomic")!);
  const netMinor = integer(input.row, "invoice_amount_minor");
  const grossTotalMinor = integer(input.row, "provider_amount_due_minor");
  if (!Number.isSafeInteger(input.grossMinor) || input.grossMinor <= 0 || grossTotalMinor <= 0) {
    return { attention: "prepaid_reversal_amount_invalid", matched: true, reversedAtomic: "0" };
  }
  // Only the net amount was ever credited, so only the net share of a reversal is debited.
  const reversedGrossMinor = Math.min(input.grossMinor, grossTotalMinor);
  const requestedAtomic = BigInt(Math.floor((reversedGrossMinor * netMinor) / grossTotalMinor)) * USD_CENT_ATOMIC;
  const remainingAtomic = creditedAtomic - (await reversedAtomicForInvoice(client, workspaceId, input.invoiceId));
  const debitAtomic = requestedAtomic > remainingAtomic ? remainingAtomic : requestedAtomic;
  if (debitAtomic <= 0n) return { matched: true, reversedAtomic: "0" };
  const now = new Date();
  const externalReference = reversalReference(input.invoiceId, input.reversalId);
  await client.query(
    `INSERT INTO tokenless_prepaid_ledger_entries
       (entry_id,workspace_id,delta_atomic,settlement_status,source,external_reference,created_at,settled_at)
     VALUES ($1,$2,$3,'settled','fiat_topup_reversal',$4,$5,$5)
     ON CONFLICT (external_reference) DO NOTHING`,
    [
      deterministicId("ledger_reversal", input.invoiceId, input.reversalId),
      workspaceId,
      (-debitAtomic).toString(),
      externalReference,
      now,
    ],
  );
  const ledger = await client.query(
    `SELECT workspace_id,delta_atomic,settlement_status,source FROM tokenless_prepaid_ledger_entries
     WHERE external_reference=$1`,
    [externalReference],
  );
  const ledgerRow = ledger.rows[0] as QueryRow;
  const storedDelta = BigInt(text(ledgerRow, "delta_atomic") ?? "0");
  if (
    text(ledgerRow, "workspace_id") !== workspaceId ||
    text(ledgerRow, "settlement_status") !== "settled" ||
    text(ledgerRow, "source") !== "fiat_topup_reversal" ||
    storedDelta >= 0n
  ) {
    throw new Error("topup_reversal_binding_conflict");
  }
  const balance = await settledPrepaidBalance(client, workspaceId);
  // The insert is a no-op when this reference was already written. That is the ordinary redelivery
  // case and the stored magnitude matches, but a smaller one means two distinct reversals shared a
  // reference and this one was swallowed. Report it rather than answer with the earlier amount.
  if (-storedDelta < debitAtomic) {
    return {
      attention: "prepaid_reversal_reference_collision",
      matched: true,
      reversedAtomic: (-storedDelta).toString(),
    };
  }
  return {
    matched: true,
    reversedAtomic: (-storedDelta).toString(),
    ...(balance < 0n ? { attention: "prepaid_balance_negative_after_reversal" } : {}),
  };
}

/** Debit a credited top-up because Stripe reversed the money behind it. */
export async function projectPrepaidReversal(
  client: PoolClient,
  input: { grossMinor: number; invoiceId: string; reversalId: string },
): Promise<PrepaidReversalResult> {
  const result = await client.query(
    `SELECT * FROM tokenless_prepaid_topup_intents
     WHERE provider='stripe' AND provider_invoice_id=$1 FOR UPDATE`,
    [input.invoiceId],
  );
  const row = result.rows[0] as QueryRow;
  if (!row) return { matched: false, reversedAtomic: "0" };
  if (text(row, "state") !== "credited") {
    // Nothing was credited for this invoice, so there is no balance to debit. Stripe and the
    // ledger still disagree about the invoice, which an operator should see.
    return { attention: "prepaid_reversal_without_credit", matched: true, reversedAtomic: "0" };
  }
  return debitPrepaidReversal(client, { ...input, row });
}

/** Put back a reversal that Stripe itself undid, such as a dispute closed in our favour. */
export async function reinstatePrepaidReversal(
  client: PoolClient,
  input: { invoiceId: string; reversalId: string },
): Promise<PrepaidReversalResult> {
  const result = await client.query(
    `SELECT * FROM tokenless_prepaid_topup_intents
     WHERE provider='stripe' AND provider_invoice_id=$1 FOR UPDATE`,
    [input.invoiceId],
  );
  const row = result.rows[0] as QueryRow;
  if (!row) return { matched: false, reversedAtomic: "0" };
  const externalReference = reversalReference(input.invoiceId, input.reversalId);
  const original = await client.query(
    "SELECT delta_atomic FROM tokenless_prepaid_ledger_entries WHERE external_reference=$1 AND source='fiat_topup_reversal'",
    [externalReference],
  );
  const debited = BigInt(text(original.rows[0] as QueryRow, "delta_atomic") ?? "0");
  if (debited >= 0n) return { matched: true, reversedAtomic: "0" };
  const now = new Date();
  await client.query(
    `INSERT INTO tokenless_prepaid_ledger_entries
       (entry_id,workspace_id,delta_atomic,settlement_status,source,external_reference,created_at,settled_at)
     VALUES ($1,$2,$3,'settled','fiat_topup_reversal_reinstated',$4,$5,$5)
     ON CONFLICT (external_reference) DO NOTHING`,
    [
      deterministicId("ledger_reinstated", input.invoiceId, input.reversalId),
      text(row, "workspace_id"),
      (-debited).toString(),
      `${externalReference}:reinstated`,
      now,
    ],
  );
  return { matched: true, reversedAtomic: "0" };
}

export async function reconcilePrepaidTopups(input: { limit?: number; now?: Date; signal?: AbortSignal } = {}) {
  if (!prepaidTopupsEnabled()) return { attempted: 0, credited: 0, failed: 0 };
  assertPrepaidTopupConfiguration();
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const candidates = await dbClient.execute({
    sql: `SELECT topup_id,provider_invoice_id FROM tokenless_prepaid_topup_intents
          WHERE state IN ('sent','paid') AND next_reconcile_at <= ?
          ORDER BY next_reconcile_at ASC LIMIT ?`,
    args: [now, limit],
  });
  let credited = 0;
  let failed = 0;
  for (const candidate of candidates.rows as Record<string, unknown>[]) {
    if (maintenanceCancellationRequested(input.signal)) break;
    const invoiceId = text(candidate, "provider_invoice_id");
    if (!invoiceId) continue;
    try {
      const invoice = await getStripe().invoices.retrieve(invoiceId);
      const client = await dbPool.connect();
      try {
        await client.query("BEGIN");
        const projected = await projectPrepaidInvoice(client, {
          eventCreatedAt: now,
          eventId: `reconcile:${invoiceId}:${now.toISOString()}`,
          invoice,
        });
        await client.query("COMMIT");
        if (projected.credited) credited += 1;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      await drainPrepaidTopupAuditOutbox({ topupId: text(candidate, "topup_id")! });
    } catch {
      failed += 1;
      await dbClient.execute({
        sql: `UPDATE tokenless_prepaid_topup_intents SET reconciliation_attempts=reconciliation_attempts+1,
              failure_code='reconciliation_failed',last_reconciled_at=?,next_reconcile_at=?,updated_at=?
              WHERE topup_id=? AND state IN ('sent','paid')`,
        args: [now, new Date(now.getTime() + RECONCILE_DELAY_MS), now, text(candidate, "topup_id")],
      });
    }
  }
  return { attempted: candidates.rowCount, credited, failed };
}

export async function listPrepaidTopups(input: { accountAddress: string; workspaceId: string }) {
  await requireWorkspaceTopupAccess(input);
  const [topups, ledger, reservations] = await Promise.all([
    dbClient.execute({
      sql: `SELECT * FROM tokenless_prepaid_topup_intents WHERE workspace_id=? ORDER BY requested_at DESC LIMIT 100`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT entry_id,delta_atomic,source,external_reference,created_at,settled_at
            FROM tokenless_prepaid_ledger_entries WHERE workspace_id=? AND settlement_status='settled'
            ORDER BY created_at DESC LIMIT 100`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT reservation_id,amount_atomic,status,operation_key,created_at,updated_at
            FROM tokenless_prepaid_reservations WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100`,
      args: [input.workspaceId],
    }),
  ]);
  return {
    enabled: prepaidTopupsEnabled(),
    topups: topups.rows.map(value => topupFromRow(value as QueryRow)),
    ledger: ledger.rows.map(value => ({
      entryId: text(value as QueryRow, "entry_id"),
      amountAtomic: text(value as QueryRow, "delta_atomic"),
      source: text(value as QueryRow, "source"),
      reference: text(value as QueryRow, "external_reference"),
      createdAt: dateIso(value as QueryRow, "created_at"),
      settledAt: dateIso(value as QueryRow, "settled_at"),
    })),
    reservations: reservations.rows.map(value => ({
      reservationId: text(value as QueryRow, "reservation_id"),
      amountAtomic: text(value as QueryRow, "amount_atomic"),
      status: text(value as QueryRow, "status"),
      operationKey: text(value as QueryRow, "operation_key"),
      createdAt: dateIso(value as QueryRow, "created_at"),
      updatedAt: dateIso(value as QueryRow, "updated_at"),
    })),
  };
}

function boundedAuditError(error: unknown) {
  const message = error instanceof Error ? error.message : "audit_delivery_failed";
  return /^[a-z0-9_]{1,80}$/u.test(message) ? message : "audit_delivery_failed";
}

export async function drainPrepaidTopupAuditOutbox(
  input: { limit?: number; topupId?: string; signal?: AbortSignal } = {},
) {
  const limit = Math.max(1, Math.min(input.limit ?? 25, 100));
  const candidates = await dbClient.execute({
    sql: `SELECT topup_id,MIN(event_sequence) AS first_sequence
          FROM tokenless_prepaid_topup_audit_outbox
          WHERE state='pending' AND next_attempt_at <= ? ${input.topupId ? "AND topup_id = ?" : ""}
          GROUP BY topup_id ORDER BY first_sequence ASC,topup_id ASC LIMIT ?`,
    args: input.topupId ? [new Date(), input.topupId, limit] : [new Date(), limit],
  });
  let attempted = 0;
  let delivered = 0;
  for (const candidate of candidates.rows as Record<string, unknown>[]) {
    if (maintenanceCancellationRequested(input.signal)) break;
    const topupId = text(candidate, "topup_id")!;
    const lockKey = `prepaid-topup-audit:${topupId}`;
    const lock = await dbPool.connect();
    const acquiredLockKeys: string[] = [];
    try {
      if (!(await tryAcquireSessionAdvisoryLock(lock, lockKey))) continue;
      acquiredLockKeys.push(lockKey);
      while (attempted < limit) {
        const pending = await lock.query(
          `SELECT outbox_id,workspace_id,topup_id,event_type,event_sequence,actor_reference,event_occurred_at
           FROM tokenless_prepaid_topup_audit_outbox
           WHERE topup_id=$1 AND state='pending' AND next_attempt_at <= $2
           ORDER BY event_sequence ASC LIMIT 1`,
          [topupId, new Date()],
        );
        const row = pending.rows[0] as QueryRow;
        if (!row) break;
        attempted += 1;
        const occurredAt = new Date(text(row, "event_occurred_at")!);
        try {
          const audit = await appendAuditEvent({
            action: `billing.prepaid_topup.${text(row, "event_type")}`,
            actorKind: text(row, "actor_reference")!.startsWith("system:") ? "system" : "principal",
            actorReference: text(row, "actor_reference")!,
            assuranceMethod: text(row, "actor_reference")!.startsWith("system:") ? "stripe_webhook" : "browser_session",
            idempotencyKey: `prepaid_topup:${text(row, "topup_id")}:${text(row, "event_type")}`,
            metadata: { currency: "usd", eventType: text(row, "event_type") },
            occurredAt,
            purpose: "workspace_funding",
            reason: `prepaid_topup_${text(row, "event_type")}`,
            result: text(row, "event_type") === "failed" ? "failure" : "success",
            targetId: text(row, "topup_id")!,
            targetKind: "prepaid_topup",
            workspaceId: text(row, "workspace_id")!,
          });
          const deliveredAt = new Date();
          await lock.query(
            `UPDATE tokenless_prepaid_topup_audit_outbox SET state='delivered',attempt_count=attempt_count+1,
             last_error_code=NULL,audit_event_id=$1,audit_event_digest=$2,delivered_at=$3,updated_at=$3
             WHERE outbox_id=$4 AND state='pending'`,
            [audit.eventId, audit.eventDigest, deliveredAt, text(row, "outbox_id")],
          );
          delivered += 1;
        } catch (error) {
          const retryAt = new Date(Date.now() + RECONCILE_DELAY_MS);
          await lock.query(
            `UPDATE tokenless_prepaid_topup_audit_outbox SET attempt_count=attempt_count+1,
             last_error_code=$1,next_attempt_at=$2,updated_at=$3 WHERE outbox_id=$4 AND state='pending'`,
            [boundedAuditError(error), retryAt, new Date(), text(row, "outbox_id")],
          );
          break;
        }
      }
    } finally {
      await releaseSessionAdvisoryLocksAndConnection(lock, acquiredLockKeys);
    }
  }
  return { attempted, delivered };
}

export const __prepaidTopupTestUtils = { invoiceValidationError, normalizeAmountAtomic, normalizeIdempotencyKey };
