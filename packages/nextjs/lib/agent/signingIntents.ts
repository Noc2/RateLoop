import { createHash, randomBytes } from "crypto";
import "server-only";
import { type Address, type Hex, isAddress } from "viem";
import {
  redactSensitiveAgentRequestFields,
  sealSensitiveAgentRequestFields,
  unsealSensitiveAgentRequestFields,
} from "~~/lib/agent/requestRedaction";
import { readAgentTransactionHashes } from "~~/lib/agent/transactionHashes";
import { dbClient } from "~~/lib/db";
import { McpToolError, callPublicRateLoopMcpTool } from "~~/lib/mcp/tools";
import { buildAppRelativeUrl } from "~~/lib/url/appRelative";
import { parseX402QuestionRequest } from "~~/lib/x402/questionPayload";

type JsonObject = Record<string, unknown>;

type AgentSigningIntentStatus = "pending" | "prepared" | "submitted" | "failed" | "expired";

type AgentSigningIntentRecord = {
  chainId: number | null;
  clientRequestId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  error: string | null;
  expiresAt: Date;
  id: string;
  operationKey: `0x${string}` | null;
  payloadHash: string | null;
  paymentMode: "wallet_calls" | "x402_authorization";
  requestBody: JsonObject;
  status: AgentSigningIntentStatus;
  tokenHash: string;
  transactionHashes: Hex[];
  transactionPlan: JsonObject | null;
  updatedAt: Date;
  walletAddress: Address | null;
  x402AuthorizationRequest: JsonObject | null;
};

const DEFAULT_SIGNING_INTENT_TTL_MS = 30 * 60 * 1000;
const MAX_SIGNING_INTENT_TTL_MS = 24 * 60 * 60 * 1000;

function nowDate() {
  return new Date();
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function randomIntentId() {
  return `asi_${randomBytes(16).toString("hex")}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function asJsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new McpToolError("Signing intent request body must be a JSON object.");
  }
  return value as JsonObject;
}

function parsePaymentMode(value: unknown): "wallet_calls" | "x402_authorization" {
  if (value === undefined || value === null || value === "" || value === "wallet_calls" || value === "agent_wallet") {
    return "wallet_calls";
  }
  if (
    value === "eip3009_usdc_authorization" ||
    value === "eip3009_authorization" ||
    value === "x402_authorization" ||
    value === "native_x402" ||
    value === "x402"
  ) {
    return "x402_authorization";
  }
  throw new McpToolError("paymentMode must be wallet_calls, eip3009_usdc_authorization, or x402_authorization.");
}

function parseOptionalAddress(value: unknown, fieldName: string): Address | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && isAddress(value)) return value as Address;
  throw new McpToolError(`${fieldName} must be an EVM address.`);
}

function parseStoredJson(value: string): JsonObject {
  try {
    return asJsonObject(JSON.parse(value));
  } catch {
    throw new McpToolError("Signing intent stored request body is invalid.", 500);
  }
}

function parseStoredHashes(value: string | null): Hex[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is Hex => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function rowToIntent(row: Record<string, unknown> | undefined): AgentSigningIntentRecord | null {
  if (!row) return null;
  return {
    chainId: row.chain_id === null || row.chain_id === undefined ? null : Number(row.chain_id),
    clientRequestId: typeof row.client_request_id === "string" ? row.client_request_id : null,
    completedAt:
      row.completed_at instanceof Date
        ? row.completed_at
        : row.completed_at
          ? new Date(String(row.completed_at))
          : null,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    error: typeof row.error === "string" ? row.error : null,
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(String(row.expires_at)),
    id: String(row.id),
    operationKey: typeof row.operation_key === "string" ? (row.operation_key as `0x${string}`) : null,
    payloadHash: typeof row.payload_hash === "string" ? row.payload_hash : null,
    paymentMode: parsePaymentMode(row.payment_mode),
    requestBody: parseStoredJson(String(row.request_body)),
    status: String(row.status) as AgentSigningIntentStatus,
    tokenHash: String(row.token_hash),
    transactionHashes: parseStoredHashes(typeof row.transaction_hashes === "string" ? row.transaction_hashes : null),
    transactionPlan: parseStoredJsonObject(typeof row.transaction_plan === "string" ? row.transaction_plan : null),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
    walletAddress:
      typeof row.wallet_address === "string" && isAddress(row.wallet_address) ? (row.wallet_address as Address) : null,
    x402AuthorizationRequest: parseStoredJsonObject(
      typeof row.x402_authorization_request === "string" ? row.x402_authorization_request : null,
    ),
  };
}

function signingUrl(params: { appBaseUrl: string; intentId: string; token: string }) {
  // C-1 (2026-05-22 audit): place the bearer token in the URL fragment instead of
  // the query string. Fragments are not sent in HTTP request lines, are not logged
  // by intermediate proxies, are not leaked through the Referer header on any
  // outbound navigation, and are not indexed by analytics that scrape query
  // parameters. The browser still retains them in history, but every other leak
  // vector goes away. The signing page reads the token from window.location.hash.
  const url = buildAppRelativeUrl(params.appBaseUrl, `/agent/sign/${params.intentId}`);
  url.hash = `token=${encodeURIComponent(params.token)}`;
  return url.toString();
}

function assertFresh(intent: AgentSigningIntentRecord) {
  if (intent.expiresAt.getTime() <= Date.now()) {
    throw new McpToolError("Signing intent has expired.", 410);
  }
}

async function markIntentExpired(intent: AgentSigningIntentRecord) {
  if (intent.status === "expired" || intent.status === "submitted") return;
  const now = nowDate();
  await dbClient.execute({
    sql: `
      UPDATE agent_signing_intents
      SET status = 'expired',
          updated_at = ?
      WHERE id = ?
    `,
    args: [now, intent.id],
  });
}

async function loadIntentByToken(params: { intentId: string; token: string }): Promise<AgentSigningIntentRecord> {
  const tokenHash = hashToken(params.token);
  const result = await dbClient.execute({
    sql: `
      SELECT *
      FROM agent_signing_intents
      WHERE id = ? AND token_hash = ?
      LIMIT 1
    `,
    args: [params.intentId, tokenHash],
  });
  const intent = rowToIntent(result.rows[0]);
  if (!intent) {
    throw new McpToolError("Signing intent was not found.", 404);
  }
  if (intent.expiresAt.getTime() <= Date.now() && intent.status !== "submitted") {
    await markIntentExpired(intent);
    return { ...intent, status: "expired" };
  }
  return intent;
}

function parseStoredJsonObject(value: string | null): JsonObject | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as JsonObject;
  } catch {
    return null;
  }
}

function readTransactionPlanFromBody(body: JsonObject) {
  const transactionPlan =
    body.transactionPlan && typeof body.transactionPlan === "object" && !Array.isArray(body.transactionPlan)
      ? (body.transactionPlan as JsonObject)
      : null;
  return {
    calls: Array.isArray(transactionPlan?.calls) ? transactionPlan.calls : [],
    transactionPlan,
  };
}

function readX402AuthorizationRequest(body: JsonObject): JsonObject | null {
  const request = body.x402AuthorizationRequest;
  return request && typeof request === "object" && !Array.isArray(request) ? (request as JsonObject) : null;
}

function isAlreadyStoredHashRepeat(storedHashes: readonly Hex[], transactionHashes: readonly Hex[]) {
  const stored = new Set(storedHashes.map(hash => hash.toLowerCase()));
  return transactionHashes.every(hash => stored.has(hash.toLowerCase()));
}

function signingIntentResponse(intent: AgentSigningIntentRecord, extras: JsonObject = {}) {
  const requestBody = redactSensitiveAgentRequestFields(intent.requestBody);
  return {
    chainId: intent.chainId,
    clientRequestId: intent.clientRequestId,
    completedAt: intent.completedAt?.toISOString() ?? null,
    createdAt: intent.createdAt.toISOString(),
    error: intent.error,
    expiresAt: intent.expiresAt.toISOString(),
    id: intent.id,
    operationKey: intent.operationKey,
    payloadHash: intent.payloadHash,
    paymentMode: intent.paymentMode,
    requestBody,
    status: intent.status,
    transactionHashes: intent.transactionHashes,
    transactionPlan: intent.transactionPlan,
    updatedAt: intent.updatedAt.toISOString(),
    walletAddress: intent.walletAddress,
    x402AuthorizationRequest: intent.x402AuthorizationRequest,
    ...extras,
  };
}

function signingIntentPrepareExtras(body: JsonObject): JsonObject {
  const extras: JsonObject = {};
  const { transactionPlan } = readTransactionPlanFromBody(body);
  const x402AuthorizationRequest = readX402AuthorizationRequest(body);
  if (transactionPlan) extras.transactionPlan = transactionPlan;
  if (x402AuthorizationRequest) extras.x402AuthorizationRequest = x402AuthorizationRequest;
  if (body.wallet && typeof body.wallet === "object" && !Array.isArray(body.wallet)) {
    extras.wallet = body.wallet;
  }
  return extras;
}

function hasPreparedSigningArtifacts(
  intent: AgentSigningIntentRecord,
  params: { paymentAuthorization?: unknown } = {},
) {
  const hasExecutablePlan = readTransactionPlanFromBody({ transactionPlan: intent.transactionPlan }).calls.length > 0;
  if (intent.paymentMode === "x402_authorization") {
    if (hasExecutablePlan) return true;
    return params.paymentAuthorization === undefined && intent.x402AuthorizationRequest !== null;
  }
  return hasExecutablePlan;
}

export async function createAgentSigningIntent(params: { appBaseUrl: string; requestBody: unknown; ttlMs?: number }) {
  const requestBody = asJsonObject(params.requestBody);
  const payload = parseX402QuestionRequest(requestBody);
  if (requestBody.maxPaymentAmount === undefined || requestBody.maxPaymentAmount === null) {
    throw new McpToolError("maxPaymentAmount is required for browser signing links.");
  }

  const paymentMode = parsePaymentMode(requestBody.paymentMode ?? requestBody.fundingMode);
  const walletAddress = parseOptionalAddress(
    requestBody.walletAddress ?? requestBody.agentWalletAddress,
    "walletAddress",
  );
  const token = randomToken();
  const id = randomIntentId();
  const now = nowDate();
  const ttlMs = Math.min(Math.max(params.ttlMs ?? DEFAULT_SIGNING_INTENT_TTL_MS, 60_000), MAX_SIGNING_INTENT_TTL_MS);
  const expiresAt = new Date(now.getTime() + ttlMs);
  const storedRequestBody = sealSensitiveAgentRequestFields(requestBody, token);

  await dbClient.execute({
    sql: `
      INSERT INTO agent_signing_intents (
        id,
        token_hash,
        status,
        chain_id,
        client_request_id,
        payment_mode,
        wallet_address,
        request_body,
        expires_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      id,
      hashToken(token),
      "pending",
      payload.chainId,
      payload.clientRequestId,
      paymentMode,
      walletAddress,
      JSON.stringify(storedRequestBody),
      expiresAt,
      now,
      now,
    ],
  });

  const intent: AgentSigningIntentRecord = {
    chainId: payload.chainId,
    clientRequestId: payload.clientRequestId,
    completedAt: null,
    createdAt: now,
    error: null,
    expiresAt,
    id,
    operationKey: null,
    payloadHash: null,
    paymentMode,
    requestBody: storedRequestBody,
    status: "pending",
    tokenHash: hashToken(token),
    transactionHashes: [],
    transactionPlan: null,
    updatedAt: now,
    walletAddress,
    x402AuthorizationRequest: null,
  };

  return signingIntentResponse(intent, {
    signingUrl: signingUrl({ appBaseUrl: params.appBaseUrl, intentId: id, token }),
  });
}

export async function getAgentSigningIntent(params: { intentId: string; token: string }) {
  const intent = await loadIntentByToken(params);
  return signingIntentResponse(intent);
}

export async function prepareAgentSigningIntent(params: {
  intentId: string;
  paymentAuthorization?: unknown;
  token: string;
  walletAddress: unknown;
}) {
  const intent = await loadIntentByToken(params);
  assertFresh(intent);
  if (intent.status === "submitted") {
    return signingIntentResponse(intent);
  }

  const walletAddress = parseOptionalAddress(params.walletAddress, "walletAddress");
  if (!walletAddress) {
    throw new McpToolError("walletAddress is required to prepare a browser signing intent.");
  }
  if (intent.walletAddress && intent.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new McpToolError("Connected wallet does not match this signing intent.", 403);
  }
  if (intent.status === "prepared" && hasPreparedSigningArtifacts(intent, params)) {
    return signingIntentResponse(intent);
  }

  try {
    const requestBody = unsealSensitiveAgentRequestFields(intent.requestBody, params.token);
    const body = (await callPublicRateLoopMcpTool({
      arguments: {
        ...requestBody,
        paymentAuthorization: params.paymentAuthorization,
        paymentMode: intent.paymentMode,
        walletAddress,
      },
      name: "rateloop_ask_humans",
    })) as JsonObject;

    const operationKey = typeof body.operationKey === "string" ? (body.operationKey as `0x${string}`) : null;
    const payloadHash = typeof body.payloadHash === "string" ? body.payloadHash : null;
    const { calls, transactionPlan } = readTransactionPlanFromBody(body);
    const x402AuthorizationRequest = readX402AuthorizationRequest(body);
    const now = nowDate();
    const prepareError =
      intent.paymentMode === "x402_authorization"
        ? x402AuthorizationRequest || calls.length > 0
          ? null
          : "RateLoop ask did not return an x402 authorization request. Review the draft and try again."
        : calls.length > 0
          ? null
          : "RateLoop ask did not return an executable transaction plan. Review the draft and try again.";
    if (prepareError) {
      await dbClient.execute({
        sql: `
          UPDATE agent_signing_intents
          SET status = 'failed',
              wallet_address = ?,
              operation_key = ?,
              payload_hash = ?,
              error = ?,
              updated_at = ?
          WHERE id = ?
        `,
        args: [walletAddress, operationKey, payloadHash, prepareError, now, intent.id],
      });
      throw new McpToolError(prepareError);
    }

    await dbClient.execute({
      sql: `
        UPDATE agent_signing_intents
        SET status = ?,
            wallet_address = ?,
            operation_key = ?,
            payload_hash = ?,
            transaction_plan = ?,
            x402_authorization_request = ?,
            error = NULL,
            updated_at = ?
        WHERE id = ?
      `,
      args: [
        "prepared",
        walletAddress,
        operationKey,
        payloadHash,
        transactionPlan ? JSON.stringify(transactionPlan) : null,
        x402AuthorizationRequest ? JSON.stringify(x402AuthorizationRequest) : null,
        now,
        intent.id,
      ],
    });

    return signingIntentResponse(
      {
        ...intent,
        operationKey,
        payloadHash,
        status: "prepared",
        transactionPlan,
        updatedAt: now,
        walletAddress,
        x402AuthorizationRequest,
      },
      signingIntentPrepareExtras(body),
    );
  } catch (error) {
    const now = nowDate();
    await dbClient.execute({
      sql: `
        UPDATE agent_signing_intents
        SET status = 'failed',
            error = ?,
            updated_at = ?
        WHERE id = ?
      `,
      args: [error instanceof Error ? error.message : String(error), now, intent.id],
    });
    throw error;
  }
}

export async function completeAgentSigningIntent(params: {
  intentId: string;
  token: string;
  transactionHashes: unknown;
}) {
  const intent = await loadIntentByToken(params);
  assertFresh(intent);
  // M-2 (2026-05-22 audit): refuse to re-complete an already-submitted intent so a
  // replayed HTTP call (client retry loop, MitM replay, browser back-forward) cannot
  // re-invoke rateloop_confirm_ask_transactions with the same (operationKey,
  // transactionHashes). Returning the existing record is idempotent and matches the
  // shape the caller saw on the first successful completion.
  if (intent.status === "submitted") {
    return signingIntentResponse(intent);
  }
  if (!intent.operationKey) {
    throw new McpToolError("Prepare this signing intent before completing it.");
  }
  const transactionHashes = readAgentTransactionHashes(params.transactionHashes, message => new McpToolError(message));

  if (isAlreadyStoredHashRepeat(intent.transactionHashes, transactionHashes)) return signingIntentResponse(intent);

  try {
    const body = (await callPublicRateLoopMcpTool({
      arguments: {
        operationKey: intent.operationKey,
        transactionHashes,
      },
      name: "rateloop_confirm_ask_transactions",
    })) as JsonObject;
    const status: AgentSigningIntentStatus = body.status === "submitted" ? "submitted" : "prepared";
    const storedTransactionHashes = transactionHashes;
    const nextTransactionPlan = status === "submitted" ? null : intent.transactionPlan;
    const now = nowDate();
    await dbClient.execute({
      sql: `
        UPDATE agent_signing_intents
        SET status = ?,
            transaction_hashes = ?,
            transaction_plan = ?,
            error = NULL,
            completed_at = CASE WHEN ? = 'submitted' THEN ? ELSE completed_at END,
            updated_at = ?
        WHERE id = ?
      `,
      args: [
        status,
        JSON.stringify(storedTransactionHashes),
        nextTransactionPlan ? JSON.stringify(nextTransactionPlan) : null,
        status,
        now,
        now,
        intent.id,
      ],
    });

    return signingIntentResponse(
      {
        ...intent,
        completedAt: status === "submitted" ? now : intent.completedAt,
        status,
        transactionHashes: storedTransactionHashes,
        transactionPlan: nextTransactionPlan,
        updatedAt: now,
      },
      {
        ...body,
        status,
        transactionPlan: status === "submitted" ? null : (body.transactionPlan ?? intent.transactionPlan),
      },
    );
  } catch (error) {
    const now = nowDate();
    await dbClient.execute({
      sql: `
        UPDATE agent_signing_intents
        SET status = 'failed',
            transaction_hashes = ?,
            error = ?,
            updated_at = ?
        WHERE id = ?
      `,
      args: [JSON.stringify(transactionHashes), error instanceof Error ? error.message : String(error), now, intent.id],
    });
    throw error;
  }
}
