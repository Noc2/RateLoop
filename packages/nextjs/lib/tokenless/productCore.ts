import type { TokenlessAskRequest, TokenlessAskResponse, TokenlessQuoteResponse } from "@rateloop/sdk";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import "server-only";
import { getAddress } from "viem";
import { BASE_ACCOUNT_SESSION_COOKIE, findBaseAccountSession } from "~~/lib/base-account/auth";
import { dbClient, dbPool } from "~~/lib/db";
import type { TokenlessWorkspaceRole } from "~~/lib/db/productSchema";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const API_KEY_PATTERN = /^rlk_([a-f0-9]{16})_([A-Za-z0-9_-]{32,128})$/;
const ATOMIC_PATTERN = /^(0|[1-9]\d*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;
const ASK_ROLES = new Set<TokenlessWorkspaceRole>(["owner", "admin", "member"]);

export type ProductPrincipal =
  | { kind: "api_key"; apiKeyId: string; workspaceId: string; role: TokenlessWorkspaceRole }
  | { kind: "session"; accountAddress: `0x${string}` };

export type PreparedProductAsk = {
  amountAtomic: string;
  createdPayment: boolean;
  idempotencyKey: string;
  ownerAccountAddress: string | null;
  apiKeyId: string | null;
  paymentMode: TokenlessAskRequest["payment"]["mode"];
  paymentReference: string;
  paymentState: string;
  questionId: string;
  workspaceId: string;
};

type QueryRow = Record<string, unknown>;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashJson(value: unknown) {
  return digest(stableJson(value));
}

function atomic(value: unknown, name: string) {
  if (typeof value !== "string" || !ATOMIC_PATTERN.test(value)) {
    throw new TokenlessServiceError(`${name} must be an unsigned atomic amount string.`, 400, "invalid_payment");
  }
  return BigInt(value);
}

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return typeof value === "string" ? value : value === null || value === undefined ? null : String(value);
}

function assertAskRole(role: TokenlessWorkspaceRole) {
  if (!ASK_ROLES.has(role)) {
    throw new TokenlessServiceError("This credential cannot create or read asks.", 403, "insufficient_role");
  }
}

export async function authenticateProductPrincipal(input: {
  authorization: string | null;
  sessionToken: string | undefined;
}): Promise<ProductPrincipal> {
  if (input.authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(input.authorization);
    if (!match || match[1].length > 256 || !API_KEY_PATTERN.test(match[1])) {
      throw new TokenlessServiceError("Invalid API key.", 401, "invalid_api_key");
    }
    const keyHash = digest(match[1]);
    const result = await dbClient.execute({
      sql: `SELECT k.key_id, k.workspace_id, k.role
            FROM tokenless_workspace_api_keys k
            JOIN tokenless_workspaces w ON w.workspace_id = k.workspace_id
            WHERE k.key_hash = ? AND k.revoked_at IS NULL AND w.status = 'active'
            LIMIT 1`,
      args: [keyHash],
    });
    const row = result.rows[0] as QueryRow | undefined;
    const keyId = rowString(row, "key_id");
    const workspaceId = rowString(row, "workspace_id");
    const role = rowString(row, "role") as TokenlessWorkspaceRole | null;
    if (!keyId || !workspaceId || !role) {
      throw new TokenlessServiceError("Invalid API key.", 401, "invalid_api_key");
    }
    assertAskRole(role);
    await dbClient.execute({
      sql: "UPDATE tokenless_workspace_api_keys SET last_used_at = ? WHERE key_id = ?",
      args: [new Date(), keyId],
    });
    return { kind: "api_key", apiKeyId: keyId, workspaceId, role };
  }

  const session = await findBaseAccountSession(input.sessionToken);
  if (!session) throw new TokenlessServiceError("Authentication is required.", 401, "authentication_required");
  return { kind: "session", accountAddress: session.address };
}

export function getProductSessionToken(request: { cookies: { get(name: string): { value: string } | undefined } }) {
  return request.cookies.get(BASE_ACCOUNT_SESSION_COOKIE)?.value;
}

export async function createWorkspace(input: { name: string; ownerAddress: string }) {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("Workspace name must be 1-120 characters.");
  const ownerAddress = getAddress(input.ownerAddress).toLowerCase();
  const workspaceId = `ws_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO tokenless_workspaces (workspace_id, name, status, created_at, updated_at)
       VALUES ($1, $2, 'active', $3, $3)`,
      [workspaceId, name, now],
    );
    await client.query(
      `INSERT INTO tokenless_workspace_members (workspace_id, account_address, role, created_at)
       VALUES ($1, $2, 'owner', $3)`,
      [workspaceId, ownerAddress, now],
    );
    await client.query("COMMIT");
    return { workspaceId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createWorkspaceApiKey(input: {
  workspaceId: string;
  name: string;
  role?: Extract<TokenlessWorkspaceRole, "admin" | "member">;
}) {
  const keyId = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `rlk_${keyId}_${secret}`;
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("API key name must be 1-120 characters.");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_api_keys
          (key_id, workspace_id, key_hash, key_prefix, name, role, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [keyId, input.workspaceId, digest(token), token.slice(0, 20), name, input.role ?? "member", new Date()],
  });
  return { apiKeyId: keyId, token };
}

export async function recordPrepaidLedgerEntry(input: {
  workspaceId: string;
  amountAtomic: string;
  source: string;
  externalReference?: string;
  settled?: boolean;
}) {
  atomic(input.amountAtomic.replace(/^-/, ""), "amountAtomic");
  if (!/^-?(0|[1-9]\d*)$/.test(input.amountAtomic)) throw new Error("amountAtomic must be an integer.");
  const now = new Date();
  const entryId = `led_${randomUUID().replaceAll("-", "")}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_prepaid_ledger_entries
          (entry_id, workspace_id, delta_atomic, settlement_status, source, external_reference, created_at, settled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      entryId,
      input.workspaceId,
      input.amountAtomic,
      input.settled === false ? "pending" : "settled",
      input.source,
      input.externalReference ?? null,
      now,
      input.settled === false ? null : now,
    ],
  });
  return { entryId };
}

async function resolveWorkspace(principal: ProductPrincipal, requestedWorkspaceId?: string) {
  if (principal.kind === "api_key") {
    if (requestedWorkspaceId && requestedWorkspaceId !== principal.workspaceId) {
      throw new TokenlessServiceError("The API key does not belong to that workspace.", 403, "workspace_forbidden");
    }
    return principal.workspaceId;
  }
  const address = principal.accountAddress.toLowerCase();
  const result = await dbClient.execute({
    sql: `SELECT m.workspace_id, m.role
          FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.account_address = ? AND w.status = 'active'
          ${requestedWorkspaceId ? "AND m.workspace_id = ?" : ""}
          ORDER BY m.created_at ASC
          LIMIT 1`,
    args: requestedWorkspaceId ? [address, requestedWorkspaceId] : [address],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const workspaceId = rowString(row, "workspace_id");
  const role = rowString(row, "role") as TokenlessWorkspaceRole | null;
  if (!workspaceId || !role) {
    throw new TokenlessServiceError(
      "The signed-in account does not belong to that workspace.",
      403,
      "workspace_forbidden",
    );
  }
  assertAskRole(role);
  return workspaceId;
}

function quoteTotal(quote: TokenlessQuoteResponse) {
  return atomic(quote.economics.totalFundedAtomic, "quote.economics.totalFundedAtomic");
}

async function loadQuote(quoteId: string) {
  const result = await dbClient.execute({
    sql: `SELECT request_json, response_json, expires_at
          FROM tokenless_agent_quotes WHERE quote_id = ? LIMIT 1`,
    args: [quoteId],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const requestJson = rowString(row, "request_json");
  const responseJson = rowString(row, "response_json");
  const expiresAtValue = row?.expires_at;
  if (!requestJson || !responseJson || !expiresAtValue || new Date(String(expiresAtValue)).getTime() <= Date.now()) {
    throw new TokenlessServiceError("Quote is missing or expired.", 410, "quote_expired");
  }
  return {
    quoteRequest: JSON.parse(requestJson) as Record<string, unknown>,
    quote: JSON.parse(responseJson) as TokenlessQuoteResponse,
  };
}

async function createQuestionRecords(input: {
  workspaceId: string;
  quoteId: string;
  idempotencyKey: string;
  quoteRequest: Record<string, unknown>;
  quote: TokenlessQuoteResponse;
}) {
  const content = input.quoteRequest.question;
  const contentJson = stableJson(content);
  const contentHash = digest(contentJson);
  const contentId = `cnt_${digest(`${input.workspaceId}:${contentHash}`).slice(0, 32)}`;
  const terms = {
    audience: input.quote.audience,
    economics: input.quote.economics,
    panel: input.quote.panel,
    questionHash: contentHash,
    schemaVersion: input.quote.schemaVersion,
  };
  const termsJson = stableJson(terms);
  const termsHash = digest(termsJson);
  const questionId = `qst_${digest(`${input.workspaceId}:${input.idempotencyKey}`).slice(0, 32)}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_content_records
          (content_id, workspace_id, content_hash, content_json, moderation_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)
          ON CONFLICT (content_id) DO NOTHING`,
    args: [contentId, input.workspaceId, contentHash, contentJson, now, now],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_question_records
          (question_id, workspace_id, content_id, quote_id, terms_hash, terms_json, moderation_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          ON CONFLICT (question_id) DO NOTHING`,
    args: [questionId, input.workspaceId, contentId, input.quoteId, termsHash, termsJson, now, now],
  });
  return questionId;
}

async function reservePrepaid(input: {
  workspaceId: string;
  idempotencyKey: string;
  amountAtomic: bigint;
}): Promise<{ reference: string; created: boolean }> {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const workspace = await client.query(
      "SELECT workspace_id FROM tokenless_workspaces WHERE workspace_id = $1 AND status = 'active' FOR UPDATE",
      [input.workspaceId],
    );
    if (workspace.rowCount !== 1) {
      throw new TokenlessServiceError("Workspace is unavailable.", 409, "workspace_unavailable");
    }
    const existing = await client.query(
      `SELECT reservation_id, amount_atomic, status FROM tokenless_prepaid_reservations
       WHERE workspace_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [input.workspaceId, input.idempotencyKey],
    );
    const existingRow = existing.rows[0] as QueryRow | undefined;
    if (existingRow && rowString(existingRow, "status") !== "released") {
      if (BigInt(rowString(existingRow, "amount_atomic") ?? "-1") !== input.amountAtomic) {
        throw new TokenlessServiceError("The payment reservation conflicts with this ask.", 409, "payment_conflict");
      }
      await client.query("COMMIT");
      return { reference: rowString(existingRow, "reservation_id")!, created: false };
    }
    const balanceResult = await client.query(
      `SELECT COALESCE(SUM(delta_atomic), 0) AS balance
       FROM tokenless_prepaid_ledger_entries
       WHERE workspace_id = $1 AND settlement_status = 'settled'`,
      [input.workspaceId],
    );
    const reservedResult = await client.query(
      `SELECT COALESCE(SUM(amount_atomic), 0) AS reserved
       FROM tokenless_prepaid_reservations
       WHERE workspace_id = $1 AND status = 'reserved'`,
      [input.workspaceId],
    );
    const balance = BigInt(rowString(balanceResult.rows[0] as QueryRow | undefined, "balance") ?? "0");
    const reserved = BigInt(rowString(reservedResult.rows[0] as QueryRow | undefined, "reserved") ?? "0");
    if (balance - reserved < input.amountAtomic) {
      throw new TokenlessServiceError("Settled prepaid balance is insufficient.", 402, "insufficient_prepaid_balance");
    }
    const now = new Date();
    if (existingRow) {
      await client.query(
        `UPDATE tokenless_prepaid_reservations
         SET amount_atomic = $1, status = 'reserved', updated_at = $2
         WHERE reservation_id = $3`,
        [input.amountAtomic.toString(), now, rowString(existingRow, "reservation_id")],
      );
      await client.query("COMMIT");
      return { reference: rowString(existingRow, "reservation_id")!, created: true };
    }
    const reservationId = `res_${randomUUID().replaceAll("-", "")}`;
    await client.query(
      `INSERT INTO tokenless_prepaid_reservations
       (reservation_id, workspace_id, idempotency_key, amount_atomic, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'reserved', $5, $5)`,
      [reservationId, input.workspaceId, input.idempotencyKey, input.amountAtomic.toString(), now],
    );
    await client.query("COMMIT");
    return { reference: reservationId, created: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function normalizedX402Authorization(value: Record<string, unknown>) {
  const validAfter = typeof value.validAfter === "number" ? String(value.validAfter) : value.validAfter;
  const validBefore = typeof value.validBefore === "number" ? String(value.validBefore) : value.validBefore;
  if (
    typeof validAfter !== "string" ||
    !ATOMIC_PATTERN.test(validAfter) ||
    typeof validBefore !== "string" ||
    !ATOMIC_PATTERN.test(validBefore) ||
    BigInt(validBefore) <= BigInt(validAfter) ||
    BigInt(validBefore) <= BigInt(Math.floor(Date.now() / 1_000)) ||
    !BYTES32_PATTERN.test(String(value.nonce ?? "")) ||
    (value.v !== 27 && value.v !== 28) ||
    !BYTES32_PATTERN.test(String(value.r ?? "")) ||
    !BYTES32_PATTERN.test(String(value.s ?? "")) ||
    !SIGNATURE_PATTERN.test(String(value.roundAuthorizationSignature ?? ""))
  ) {
    throw new TokenlessServiceError("The x402 authorization is malformed or expired.", 400, "invalid_payment");
  }
  return {
    validAfter,
    validBefore,
    nonce: String(value.nonce),
    v: value.v,
    r: String(value.r),
    s: String(value.s),
    roundAuthorizationSignature: String(value.roundAuthorizationSignature),
  };
}

async function persistPaymentIntent(input: {
  workspaceId: string;
  idempotencyKey: string;
  payment: Extract<TokenlessAskRequest["payment"], { mode: "wallet" | "x402" }>;
  amountAtomic: bigint;
  principal: ProductPrincipal;
}) {
  const payerAddress = getAddress(input.payment.payerAddress).toLowerCase();
  if (input.principal.kind === "session" && input.principal.accountAddress.toLowerCase() !== payerAddress) {
    throw new TokenlessServiceError("The payer must match the signed-in Base Account.", 403, "payer_mismatch");
  }
  const payload =
    input.payment.mode === "x402"
      ? { ...input.payment, authorization: normalizedX402Authorization(input.payment.authorization) }
      : input.payment;
  const payloadJson = stableJson(payload);
  const payloadHash = digest(payloadJson);
  const state = input.payment.mode === "wallet" ? "pending_user_signature" : "pending_chain_execution";
  const existing = await dbClient.execute({
    sql: `SELECT payment_intent_id, amount_atomic, mode, payload_hash
          FROM tokenless_payment_intents WHERE workspace_id = ? AND idempotency_key = ? LIMIT 1`,
    args: [input.workspaceId, input.idempotencyKey],
  });
  const row = existing.rows[0] as QueryRow | undefined;
  if (row) {
    if (
      rowString(row, "amount_atomic") !== input.amountAtomic.toString() ||
      rowString(row, "mode") !== input.payment.mode ||
      rowString(row, "payload_hash") !== payloadHash
    ) {
      throw new TokenlessServiceError("The payment intent conflicts with this ask.", 409, "payment_conflict");
    }
    return { reference: rowString(row, "payment_intent_id")!, state, created: false };
  }
  const paymentIntentId = `pay_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_payment_intents
          (payment_intent_id, workspace_id, idempotency_key, mode, payer_address, amount_atomic,
           payload_hash, payload_json, state, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      paymentIntentId,
      input.workspaceId,
      input.idempotencyKey,
      input.payment.mode,
      payerAddress,
      input.amountAtomic.toString(),
      payloadHash,
      payloadJson,
      state,
      now,
      now,
    ],
  });
  return { reference: paymentIntentId, state, created: true };
}

export async function prepareProductAsk(input: {
  principal: ProductPrincipal;
  request: TokenlessAskRequest;
}): Promise<PreparedProductAsk> {
  const requestedWorkspace = input.request.payment.mode === "prepaid" ? input.request.payment.workspaceId : undefined;
  const workspaceId = await resolveWorkspace(input.principal, requestedWorkspace);
  const { quoteRequest, quote } = await loadQuote(input.request.quoteId);
  const amountAtomic = quoteTotal(quote);
  const questionId = await createQuestionRecords({
    workspaceId,
    quoteId: input.request.quoteId,
    idempotencyKey: input.request.idempotencyKey,
    quoteRequest,
    quote,
  });
  const paymentMode = input.request.payment.mode;
  const payment =
    paymentMode === "prepaid"
      ? {
          ...(await reservePrepaid({ workspaceId, idempotencyKey: input.request.idempotencyKey, amountAtomic })),
          state: "reserved",
        }
      : await persistPaymentIntent({
          workspaceId,
          idempotencyKey: input.request.idempotencyKey,
          payment: input.request.payment,
          amountAtomic,
          principal: input.principal,
        });
  return {
    amountAtomic: amountAtomic.toString(),
    createdPayment: payment.created,
    idempotencyKey: input.request.idempotencyKey,
    ownerAccountAddress: input.principal.kind === "session" ? input.principal.accountAddress.toLowerCase() : null,
    apiKeyId: input.principal.kind === "api_key" ? input.principal.apiKeyId : null,
    paymentMode,
    paymentReference: payment.reference,
    paymentState: payment.state,
    questionId,
    workspaceId,
  };
}

export async function attachProductAsk(prepared: PreparedProductAsk, ask: TokenlessAskResponse) {
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_ask_ownership
          (operation_key, workspace_id, owner_account_address, api_key_id, question_id, payment_mode,
           payment_state, payment_reference, idempotency_key, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (operation_key) DO NOTHING`,
    args: [
      ask.operationKey,
      prepared.workspaceId,
      prepared.ownerAccountAddress,
      prepared.apiKeyId,
      prepared.questionId,
      prepared.paymentMode,
      prepared.paymentState,
      prepared.paymentReference,
      prepared.idempotencyKey,
      now,
      now,
    ],
  });
  const result = await dbClient.execute({
    sql: "SELECT workspace_id, payment_reference FROM tokenless_ask_ownership WHERE operation_key = ? LIMIT 1",
    args: [ask.operationKey],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (
    rowString(row, "workspace_id") !== prepared.workspaceId ||
    rowString(row, "payment_reference") !== prepared.paymentReference
  ) {
    throw new TokenlessServiceError("Ask ownership conflicts with this request.", 409, "ask_ownership_conflict");
  }
  const table = prepared.paymentMode === "prepaid" ? "tokenless_prepaid_reservations" : "tokenless_payment_intents";
  const idColumn = prepared.paymentMode === "prepaid" ? "reservation_id" : "payment_intent_id";
  await dbClient.execute({
    sql: `UPDATE ${table} SET operation_key = ?, updated_at = ? WHERE ${idColumn} = ? AND operation_key IS NULL`,
    args: [ask.operationKey, now, prepared.paymentReference],
  });
}

export async function releasePreparedProductAsk(prepared: PreparedProductAsk) {
  if (!prepared.createdPayment) return;
  if (prepared.paymentMode === "prepaid") {
    await dbClient.execute({
      sql: `UPDATE tokenless_prepaid_reservations SET status = 'released', updated_at = ?
            WHERE reservation_id = ? AND operation_key IS NULL AND status = 'reserved'`,
      args: [new Date(), prepared.paymentReference],
    });
    return;
  }
  await dbClient.execute({
    sql: `UPDATE tokenless_payment_intents SET state = 'failed', updated_at = ?
          WHERE payment_intent_id = ? AND operation_key IS NULL`,
    args: [new Date(), prepared.paymentReference],
  });
}

export async function authorizeAskAccess(principal: ProductPrincipal, operationKey: string) {
  const result = await dbClient.execute({
    sql: `SELECT o.workspace_id, o.owner_account_address, m.role
          FROM tokenless_ask_ownership o
          LEFT JOIN tokenless_workspace_members m
            ON m.workspace_id = o.workspace_id AND m.account_address = ?
          WHERE o.operation_key = ? LIMIT 1`,
    args: [principal.kind === "session" ? principal.accountAddress.toLowerCase() : null, operationKey],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const workspaceId = rowString(row, "workspace_id");
  if (!workspaceId) throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
  if (principal.kind === "api_key") {
    if (workspaceId !== principal.workspaceId) {
      throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
    }
    assertAskRole(principal.role);
    return;
  }
  const owner = rowString(row, "owner_account_address");
  const role = rowString(row, "role") as TokenlessWorkspaceRole | null;
  if (owner !== principal.accountAddress.toLowerCase() && (!role || !ASK_ROLES.has(role))) {
    throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
  }
}

export function __productCoreTestUtils() {
  return { digest, hashJson };
}
