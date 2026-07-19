import {
  type TokenlessAskRequest,
  type TokenlessAskResponse,
  type TokenlessQuestionImagePreviewGrant,
  type TokenlessQuoteRequest,
  type TokenlessQuoteResponse,
  buildTokenlessQuoteIntent,
} from "@rateloop/sdk";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { getAddress } from "viem";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { AUTH_SESSION_COOKIE, findAuthSession } from "~~/lib/auth/session";
import { getWalletBindingAddresses } from "~~/lib/auth/walletBindings";
import { requireWorkspacePaidPanels } from "~~/lib/billing/entitlements";
import { dbClient, dbPool } from "~~/lib/db";
import type { TokenlessWorkspaceRole } from "~~/lib/db/productSchema";
import {
  type TokenlessDataClassification,
  type TokenlessDataUse,
  assertCredentialDataPolicy,
  assertDataIngressPolicy,
  parseDataClassification,
  parseDataUses,
} from "~~/lib/privacy/dataPolicy";
import { bindPublicQuestionMediaToQuestion } from "~~/lib/tokenless/publicQuestionMedia";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const API_KEY_PATTERN = /^rlk_([a-f0-9]{16})_([A-Za-z0-9_-]{32,128})$/;
const ATOMIC_PATTERN = /^(0|[1-9]\d*)$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;
const ASK_ROLES = new Set<TokenlessWorkspaceRole>(["owner", "admin", "member"]);

export const TOKENLESS_AGENT_SCOPES = [
  "quote:read",
  "panel:publish",
  "payment:submit",
  "result:read",
  "evaluation:read",
  "review:decide",
  "telemetry:write",
] as const;
export type TokenlessAgentScope = (typeof TOKENLESS_AGENT_SCOPES)[number];
const TOKENLESS_AGENT_SCOPE_SET = new Set<string>(TOKENLESS_AGENT_SCOPES);
const TOKENLESS_AGENT_PAYMENT_MODES = ["prepaid", "x402"] as const;
export type TokenlessAgentPaymentMode = (typeof TOKENLESS_AGENT_PAYMENT_MODES)[number];
const TOKENLESS_AGENT_REVIEWER_SOURCES = ["customer_invited", "rateloop_network", "hybrid"] as const;
const TOKENLESS_AGENT_REVIEWER_SOURCE_SET = new Set<string>(TOKENLESS_AGENT_REVIEWER_SOURCES);
const TOKENLESS_DATA_CLASSIFICATION_SET = new Set<string>([
  "public",
  "synthetic",
  "redacted",
  "internal",
  "confidential",
  "restricted",
  "regulated",
]);

export type AgentPublishingPolicyInput = {
  name: string;
  version?: number;
  effectiveAt?: Date;
  expiresAt?: Date | null;
  allowedPaymentModes: TokenlessAgentPaymentMode[];
  payerAddress?: string | null;
  maxPanelAtomic: string;
  maxDailyAtomic: string;
  maxMonthlyAtomic: string;
  maxPanelSize: number;
  maxBountyAtomic: string;
  maxFeeBps: number;
  maxAttemptReserveAtomic: string;
  allowedProjectIds?: string[];
  allowedReviewerSources: string[];
  allowedAdmissionPolicyHashes: string[];
  allowedDataClassifications?: string[];
  maxRetentionDays?: number | null;
  allowPublicUrls?: boolean;
  allowedWebhookEndpointIds?: string[];
  allowedPromptTemplates?: string[];
  onPolicyMiss?: "handoff" | "deny";
};

export type AgentPublishingPolicy = AgentPublishingPolicyInput & {
  policyId: string;
  workspaceId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductPrincipal =
  | {
      kind: "api_key";
      apiKeyId: string;
      workspaceId: string;
      role: TokenlessWorkspaceRole;
      scopes?: TokenlessAgentScope[];
      policyId?: string | null;
      walletAddress?: string | null;
      expiresAt?: string | null;
      credentialHomeRegion?: string;
      workspaceHomeRegion?: string;
      maxDataClassification?: TokenlessDataClassification;
      permittedDataUses?: TokenlessDataUse[];
    }
  | { kind: "session"; accountAddress: string; walletAddress?: string | null };

export type PreparedProductAsk = {
  amountAtomic: string;
  createdPayment: boolean;
  idempotencyKey: string;
  idempotencyScope: string;
  ownerAccountAddress: string | null;
  apiKeyId: string | null;
  paymentMode: TokenlessAskRequest["payment"]["mode"];
  paymentReference: string;
  paymentState: string;
  policyId: string | null;
  policyVersion: number | null;
  policyReservationId: string | null;
  createdPolicyReservation: boolean;
  mediaPreviews?: TokenlessQuestionImagePreviewGrant[];
  quoteId: string;
  requestHash: string;
  quoteRequest: Record<string, unknown>;
  quote: TokenlessQuoteResponse;
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

function rowBoolean(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === true || value === "t" || value === 1;
}

function parseJsonArray(value: unknown, field: string): string[] {
  if (typeof value !== "string") throw new TokenlessServiceError(`Stored ${field} is invalid.`, 500, "policy_invalid");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TokenlessServiceError(`Stored ${field} is invalid.`, 500, "policy_invalid");
  }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) {
    throw new TokenlessServiceError(`Stored ${field} is invalid.`, 500, "policy_invalid");
  }
  return parsed;
}

function normalizedScopes(value: unknown): TokenlessAgentScope[] {
  const scopes = parseJsonArray(value, "API key scopes");
  if (scopes.some(scope => !TOKENLESS_AGENT_SCOPE_SET.has(scope))) {
    throw new TokenlessServiceError("API key scopes are invalid.", 500, "invalid_api_key");
  }
  return scopes as TokenlessAgentScope[];
}

export function requireProductPrincipalScope(principal: ProductPrincipal, scope: TokenlessAgentScope) {
  if (principal.kind === "api_key" && !(principal.scopes ?? [...TOKENLESS_AGENT_SCOPES]).includes(scope)) {
    throw new TokenlessServiceError(`This credential lacks ${scope}.`, 403, "insufficient_scope");
  }
}

const assertScope = requireProductPrincipalScope;

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
      sql: `SELECT k.key_id, k.workspace_id, k.role, k.scopes_json, k.policy_id, k.wallet_address, k.expires_at,
                   k.home_region AS credential_home_region, k.max_data_classification,
                   k.permitted_data_uses_json, w.home_region AS workspace_home_region
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
    const expiresAt = row?.expires_at ? new Date(String(row.expires_at)) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new TokenlessServiceError("This API key has expired.", 401, "api_key_expired");
    }
    const scopes = normalizedScopes(row?.scopes_json ?? JSON.stringify(TOKENLESS_AGENT_SCOPES));
    assertAskRole(role);
    await dbClient.execute({
      sql: "UPDATE tokenless_workspace_api_keys SET last_used_at = ? WHERE key_id = ?",
      args: [new Date(), keyId],
    });
    return {
      kind: "api_key",
      apiKeyId: keyId,
      workspaceId,
      role,
      scopes,
      policyId: rowString(row, "policy_id"),
      walletAddress: rowString(row, "wallet_address"),
      expiresAt: expiresAt?.toISOString() ?? null,
      credentialHomeRegion: rowString(row, "credential_home_region") ?? "eu",
      workspaceHomeRegion: rowString(row, "workspace_home_region") ?? "eu",
      maxDataClassification: parseDataClassification(rowString(row, "max_data_classification") ?? "confidential"),
      permittedDataUses: parseDataUses(rowString(row, "permitted_data_uses_json") ?? '["service_delivery"]'),
    };
  }

  const session = await findAuthSession(input.sessionToken);
  if (!session) throw new TokenlessServiceError("Authentication is required.", 401, "authentication_required");
  const wallets = await getWalletBindingAddresses(session.principalId);
  return { kind: "session", accountAddress: session.principalId, walletAddress: wallets.funding };
}

export function getProductSessionToken(request: { cookies: { get(name: string): { value: string } | undefined } }) {
  return request.cookies.get(AUTH_SESSION_COOKIE)?.value;
}

export async function createWorkspace(input: { name: string; ownerAddress: string }) {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("Workspace name must be 1-120 characters.");
  const ownerAddress = normalizeAccountSubject(input.ownerAddress);
  const workspaceId = `ws_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    if (/^rlp_[0-9a-f]{48}$/.test(ownerAddress)) {
      const principal = await client.query(
        `SELECT principal_id FROM tokenless_principals
         WHERE principal_id = $1 AND status = 'active' FOR UPDATE`,
        [ownerAddress],
      );
      if (principal.rowCount !== 1) {
        throw new TokenlessServiceError("The RateLoop principal is not active.", 403, "principal_inactive");
      }
    }
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
    await client.query(
      `INSERT INTO tokenless_workspace_subscriptions
       (workspace_id, plan_key, price_version, provider_status, cancel_at_period_end, created_at, updated_at)
       VALUES ($1, 'free', 'free_2026_07', 'free', false, $2, $2)`,
      [workspaceId, now],
    );
    await client.query(
      `INSERT INTO tokenless_workspace_agent_setups
       (workspace_id, schema_version, status, current_step, review_draft_json, revision, created_at, updated_at)
       VALUES ($1, 1, 'in_progress', 'connect', '{}', 1, $2, $2)`,
      [workspaceId, now],
    );
    await client.query(
      `INSERT INTO tokenless_workspace_evidence_retention_policies
       (workspace_id, version, evidence_retention_months, audit_retention_months, basis_json,
        effective_at, created_by, created_at)
       VALUES ($1, 1, 12, 12, $2, $3, $4, $3)`,
      [
        workspaceId,
        JSON.stringify({
          floor: "six_calendar_months",
          reasons: ["eu_ai_act_article_26_6_deployer_log_minimum", "workspace_assurance_evidence_policy"],
        }),
        now,
        ownerAddress,
      ],
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
  scopes?: TokenlessAgentScope[];
  policyId?: string | null;
  walletAddress?: string | null;
  expiresAt?: Date | null;
  homeRegion?: "eu";
  maxDataClassification?: TokenlessDataClassification;
  permittedDataUses?: TokenlessDataUse[];
}) {
  const keyId = randomBytes(8).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const token = `rlk_${keyId}_${secret}`;
  const name = input.name.trim();
  if (!name || name.length > 120) throw new Error("API key name must be 1-120 characters.");
  const scopes = input.scopes ?? [...TOKENLESS_AGENT_SCOPES];
  const maxDataClassification = parseDataClassification(input.maxDataClassification ?? "confidential");
  const permittedDataUses = parseDataUses(input.permittedDataUses ?? ["service_delivery"]);
  if (scopes.length === 0 || scopes.some(scope => !TOKENLESS_AGENT_SCOPE_SET.has(scope))) {
    throw new TokenlessServiceError("API key scopes are invalid.", 400, "invalid_api_key_scopes");
  }
  const walletAddress = input.walletAddress ? getAddress(input.walletAddress).toLowerCase() : null;
  if (input.expiresAt && (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now())) {
    throw new TokenlessServiceError("API key expiry must be in the future.", 400, "invalid_api_key_expiry");
  }
  if (input.policyId) {
    const policy = await dbClient.execute({
      sql: `SELECT workspace_id, enabled, revoked_at, expires_at, payer_address
            FROM tokenless_agent_publishing_policies WHERE policy_id = ? LIMIT 1`,
      args: [input.policyId],
    });
    const row = policy.rows[0] as QueryRow | undefined;
    if (rowString(row, "workspace_id") !== input.workspaceId) {
      throw new TokenlessServiceError("Publishing policy not found.", 404, "policy_not_found");
    }
    if (!rowBoolean(row, "enabled") || row?.revoked_at) {
      throw new TokenlessServiceError("Publishing policy is not active.", 409, "policy_revoked");
    }
    if (row?.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now()) {
      throw new TokenlessServiceError("Publishing policy has expired.", 409, "policy_expired");
    }
    if (!scopes.includes("panel:publish") || !scopes.includes("payment:submit")) {
      throw new TokenlessServiceError(
        "Policy-bound keys require panel:publish and payment:submit scopes.",
        400,
        "invalid_api_key_scopes",
      );
    }
    const policyPayer = rowString(row, "payer_address");
    if (policyPayer && walletAddress !== policyPayer.toLowerCase()) {
      throw new TokenlessServiceError(
        "The API key wallet must match the publishing policy payer.",
        400,
        "wallet_binding_mismatch",
      );
    }
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_workspace_api_keys
          (key_id, workspace_id, key_hash, key_prefix, name, role, scopes_json, policy_id, wallet_address, expires_at,
           home_region, max_data_classification, permitted_data_uses_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      keyId,
      input.workspaceId,
      digest(token),
      token.slice(0, 20),
      name,
      input.role ?? "member",
      JSON.stringify(scopes),
      input.policyId ?? null,
      walletAddress,
      input.expiresAt ?? null,
      input.homeRegion ?? "eu",
      maxDataClassification,
      JSON.stringify(permittedDataUses),
      new Date(),
    ],
  });
  return { apiKeyId: keyId, token };
}

export type ProductWorkspaceSummary = {
  workspaceId: string;
  name: string;
  role: TokenlessWorkspaceRole;
  prepaid: {
    settledAtomic: string;
    reservedAtomic: string;
    availableAtomic: string;
  };
};

export async function listProductWorkspaces(accountAddress: string): Promise<ProductWorkspaceSummary[]> {
  const address = normalizeAccountSubject(accountAddress);
  const result = await dbClient.execute({
    sql: `SELECT w.workspace_id, w.name, m.role
          FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.account_address = ? AND w.status = 'active'
          ORDER BY m.created_at ASC`,
    args: [address],
  });
  return Promise.all(
    result.rows.map(async value => {
      const row = value as QueryRow;
      const workspaceId = rowString(row, "workspace_id");
      const name = rowString(row, "name");
      const role = rowString(row, "role") as TokenlessWorkspaceRole | null;
      if (!workspaceId || !name || !role) throw new Error("Workspace query returned an invalid record.");
      const [ledger, reservations] = await Promise.all([
        dbClient.execute({
          sql: `SELECT COALESCE(SUM(delta_atomic), 0) AS amount FROM tokenless_prepaid_ledger_entries
              WHERE workspace_id = ? AND settlement_status = 'settled'`,
          args: [workspaceId],
        }),
        dbClient.execute({
          sql: `SELECT COALESCE(SUM(amount_atomic), 0) AS amount FROM tokenless_prepaid_reservations
              WHERE workspace_id = ? AND status = 'reserved'`,
          args: [workspaceId],
        }),
      ]);
      const settled = BigInt(rowString(ledger.rows[0] as QueryRow | undefined, "amount") ?? "0");
      const reserved = BigInt(rowString(reservations.rows[0] as QueryRow | undefined, "amount") ?? "0");
      return {
        workspaceId,
        name,
        role,
        prepaid: {
          settledAtomic: settled.toString(),
          reservedAtomic: reserved.toString(),
          availableAtomic: (settled - reserved).toString(),
        },
      };
    }),
  );
}

async function requireWorkspaceManagement(accountAddress: string, workspaceId: string) {
  const address = normalizeAccountSubject(accountAddress);
  const result = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, address],
  });
  const role = rowString(result.rows[0] as QueryRow | undefined, "role") as TokenlessWorkspaceRole | null;
  if (role !== "owner" && role !== "admin") {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  return role;
}

function normalizePolicyInput(input: AgentPublishingPolicyInput) {
  const name = input.name.trim();
  if (!name || name.length > 120)
    throw new TokenlessServiceError("Policy name must be 1-120 characters.", 400, "invalid_policy");
  const modes = [...new Set(input.allowedPaymentModes)];
  if (modes.length === 0 || modes.some(mode => !TOKENLESS_AGENT_PAYMENT_MODES.includes(mode))) {
    throw new TokenlessServiceError("A policy must allow prepaid and/or x402 payment.", 400, "invalid_policy");
  }
  const version = input.version ?? 1;
  if (!Number.isSafeInteger(version) || version < 1)
    throw new TokenlessServiceError("Policy version is invalid.", 400, "invalid_policy");
  const maxPanelAtomic = atomic(input.maxPanelAtomic, "maxPanelAtomic");
  const maxDailyAtomic = atomic(input.maxDailyAtomic, "maxDailyAtomic");
  const maxMonthlyAtomic = atomic(input.maxMonthlyAtomic, "maxMonthlyAtomic");
  const maxBountyAtomic = atomic(input.maxBountyAtomic, "maxBountyAtomic");
  const maxAttemptReserveAtomic = atomic(input.maxAttemptReserveAtomic, "maxAttemptReserveAtomic");
  if (
    [maxPanelAtomic, maxDailyAtomic, maxMonthlyAtomic, maxBountyAtomic, maxAttemptReserveAtomic].some(
      value => value <= 0n,
    )
  ) {
    throw new TokenlessServiceError("Policy spending caps must be greater than zero.", 400, "invalid_policy");
  }
  if (!Number.isSafeInteger(input.maxPanelSize) || input.maxPanelSize < 3 || input.maxPanelSize > 500) {
    throw new TokenlessServiceError("maxPanelSize must be between 3 and 500.", 400, "invalid_policy");
  }
  if (!Number.isSafeInteger(input.maxFeeBps) || input.maxFeeBps < 0 || input.maxFeeBps > 2_000) {
    throw new TokenlessServiceError("maxFeeBps must be between 0 and 2000.", 400, "invalid_policy");
  }
  const effectiveAt = input.effectiveAt ?? new Date();
  if (!Number.isFinite(effectiveAt.getTime()))
    throw new TokenlessServiceError("effectiveAt is invalid.", 400, "invalid_policy");
  if (input.expiresAt && input.expiresAt.getTime() <= effectiveAt.getTime()) {
    throw new TokenlessServiceError("expiresAt must be after effectiveAt.", 400, "invalid_policy");
  }
  const payerAddress = input.payerAddress ? getAddress(input.payerAddress).toLowerCase() : null;
  if (modes.includes("x402") && !payerAddress) {
    throw new TokenlessServiceError("x402 policies require a bound payer address.", 400, "invalid_policy");
  }
  const admissionHashes = [...new Set(input.allowedAdmissionPolicyHashes.map(value => value.toLowerCase()))];
  if (admissionHashes.length === 0 || admissionHashes.some(value => !BYTES32_PATTERN.test(value))) {
    throw new TokenlessServiceError("Policies require exact admission-policy hashes.", 400, "invalid_policy");
  }
  const arrayField = (values: string[] | undefined, field: string) => {
    const normalized = [...new Set((values ?? []).map(value => value.trim()).filter(Boolean))];
    if (normalized.some(value => value.length > 256)) {
      throw new TokenlessServiceError(`${field} contains an oversized value.`, 400, "invalid_policy");
    }
    return normalized;
  };
  const reviewerSources = arrayField(input.allowedReviewerSources, "allowedReviewerSources");
  if (reviewerSources.length === 0 || reviewerSources.some(value => !TOKENLESS_AGENT_REVIEWER_SOURCE_SET.has(value))) {
    throw new TokenlessServiceError("Policies require at least one supported reviewer source.", 400, "invalid_policy");
  }
  const dataClassifications = arrayField(input.allowedDataClassifications, "allowedDataClassifications");
  if (dataClassifications.some(value => !TOKENLESS_DATA_CLASSIFICATION_SET.has(value))) {
    throw new TokenlessServiceError("Policy data classifications are invalid.", 400, "invalid_policy");
  }
  if (
    input.maxRetentionDays !== undefined &&
    input.maxRetentionDays !== null &&
    (!Number.isSafeInteger(input.maxRetentionDays) || input.maxRetentionDays < 1 || input.maxRetentionDays > 3650)
  ) {
    throw new TokenlessServiceError("maxRetentionDays must be between 1 and 3650.", 400, "invalid_policy");
  }
  return {
    name,
    version,
    effectiveAt,
    expiresAt: input.expiresAt ?? null,
    modes,
    payerAddress,
    maxPanelAtomic: maxPanelAtomic.toString(),
    maxDailyAtomic: maxDailyAtomic.toString(),
    maxMonthlyAtomic: maxMonthlyAtomic.toString(),
    maxPanelSize: input.maxPanelSize,
    maxBountyAtomic: maxBountyAtomic.toString(),
    maxFeeBps: input.maxFeeBps,
    maxAttemptReserveAtomic: maxAttemptReserveAtomic.toString(),
    allowedProjectIds: arrayField(input.allowedProjectIds, "allowedProjectIds"),
    allowedReviewerSources: reviewerSources,
    allowedAdmissionPolicyHashes: admissionHashes,
    allowedDataClassifications: dataClassifications,
    maxRetentionDays: input.maxRetentionDays ?? null,
    allowPublicUrls: input.allowPublicUrls ?? false,
    allowedWebhookEndpointIds: arrayField(input.allowedWebhookEndpointIds, "allowedWebhookEndpointIds"),
    allowedPromptTemplates: arrayField(input.allowedPromptTemplates, "allowedPromptTemplates"),
    onPolicyMiss: input.onPolicyMiss ?? "deny",
  };
}

export async function createAgentPublishingPolicy(input: {
  accountAddress: string;
  workspaceId: string;
  policy: AgentPublishingPolicyInput;
}): Promise<AgentPublishingPolicy> {
  const createdBy = normalizeAccountSubject(input.accountAddress);
  await requireWorkspaceManagement(createdBy, input.workspaceId);
  const policy = normalizePolicyInput(input.policy);
  const policyId = `agpol_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_agent_publishing_policies
          (policy_id, workspace_id, name, version, enabled, effective_at, expires_at,
           allowed_payment_modes_json, payer_address, max_panel_atomic, max_daily_atomic,
           max_monthly_atomic, max_panel_size, max_bounty_atomic, max_fee_bps,
           max_attempt_reserve_atomic, allowed_project_ids_json, allowed_reviewer_sources_json,
           allowed_admission_policy_hashes_json, allowed_data_classifications_json, max_retention_days,
           allow_public_urls, allowed_webhook_endpoint_ids_json, allowed_prompt_templates_json,
           on_policy_miss, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, true, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      policyId,
      input.workspaceId,
      policy.name,
      policy.version,
      policy.effectiveAt,
      policy.expiresAt,
      JSON.stringify(policy.modes),
      policy.payerAddress,
      policy.maxPanelAtomic,
      policy.maxDailyAtomic,
      policy.maxMonthlyAtomic,
      policy.maxPanelSize,
      policy.maxBountyAtomic,
      policy.maxFeeBps,
      policy.maxAttemptReserveAtomic,
      JSON.stringify(policy.allowedProjectIds),
      JSON.stringify(policy.allowedReviewerSources),
      JSON.stringify(policy.allowedAdmissionPolicyHashes),
      JSON.stringify(policy.allowedDataClassifications),
      policy.maxRetentionDays,
      policy.allowPublicUrls,
      JSON.stringify(policy.allowedWebhookEndpointIds),
      JSON.stringify(policy.allowedPromptTemplates),
      policy.onPolicyMiss,
      createdBy,
      now,
      now,
    ],
  });
  return {
    policyId,
    workspaceId: input.workspaceId,
    createdBy,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...policy,
    allowedPaymentModes: policy.modes,
  };
}

export async function listAgentPublishingPolicies(input: { accountAddress: string; workspaceId: string }) {
  await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const result = await dbClient.execute({
    sql: `SELECT policy_id, workspace_id, name, version, enabled, effective_at, expires_at, revoked_at,
                 allowed_payment_modes_json, payer_address, max_panel_atomic, max_daily_atomic,
                 max_monthly_atomic, max_panel_size, max_bounty_atomic, max_fee_bps,
                 max_attempt_reserve_atomic, allowed_project_ids_json, allowed_reviewer_sources_json,
                 allowed_admission_policy_hashes_json, allowed_data_classifications_json, max_retention_days,
                 allow_public_urls, allowed_webhook_endpoint_ids_json, allowed_prompt_templates_json,
                 on_policy_miss, created_by, created_at, updated_at
          FROM tokenless_agent_publishing_policies WHERE workspace_id = ? ORDER BY created_at DESC`,
    args: [input.workspaceId],
  });
  return result.rows.map(value => {
    const row = value as QueryRow;
    return {
      policyId: rowString(row, "policy_id"),
      workspaceId: rowString(row, "workspace_id"),
      name: rowString(row, "name"),
      version: Number(row.version),
      enabled: rowBoolean(row, "enabled"),
      effectiveAt: new Date(String(row.effective_at)).toISOString(),
      expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
      revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
      allowedPaymentModes: parseJsonArray(row.allowed_payment_modes_json, "allowed payment modes"),
      payerAddress: rowString(row, "payer_address"),
      maxPanelAtomic: rowString(row, "max_panel_atomic"),
      maxDailyAtomic: rowString(row, "max_daily_atomic"),
      maxMonthlyAtomic: rowString(row, "max_monthly_atomic"),
      maxPanelSize: Number(row.max_panel_size),
      maxBountyAtomic: rowString(row, "max_bounty_atomic"),
      maxFeeBps: Number(row.max_fee_bps),
      maxAttemptReserveAtomic: rowString(row, "max_attempt_reserve_atomic"),
      allowedProjectIds: parseJsonArray(row.allowed_project_ids_json, "allowed project IDs"),
      allowedReviewerSources: parseJsonArray(row.allowed_reviewer_sources_json, "allowed reviewer sources"),
      allowedAdmissionPolicyHashes: parseJsonArray(
        row.allowed_admission_policy_hashes_json,
        "allowed admission hashes",
      ),
      allowedDataClassifications: parseJsonArray(row.allowed_data_classifications_json, "allowed data classifications"),
      maxRetentionDays:
        row.max_retention_days === null || row.max_retention_days === undefined ? null : Number(row.max_retention_days),
      allowPublicUrls: rowBoolean(row, "allow_public_urls"),
      allowedWebhookEndpointIds: parseJsonArray(row.allowed_webhook_endpoint_ids_json, "allowed webhook endpoint IDs"),
      allowedPromptTemplates: parseJsonArray(row.allowed_prompt_templates_json, "allowed prompt templates"),
      onPolicyMiss: rowString(row, "on_policy_miss"),
      createdBy: rowString(row, "created_by"),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  });
}

export async function revokeAgentPublishingPolicy(input: {
  accountAddress: string;
  workspaceId: string;
  policyId: string;
}) {
  await requireWorkspaceManagement(input.accountAddress, input.workspaceId);
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_agent_publishing_policies SET enabled = false, revoked_at = ?, updated_at = ?
          WHERE policy_id = ? AND workspace_id = ? AND revoked_at IS NULL`,
    args: [new Date(), new Date(), input.policyId, input.workspaceId],
  });
  if (result.rowCount !== 1) throw new TokenlessServiceError("Publishing policy not found.", 404, "policy_not_found");
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

async function loadAgentPublishingPolicy(
  principal: ProductPrincipal,
  workspaceId: string,
): Promise<AgentPublishingPolicy | null> {
  if (principal.kind === "session" || !principal.policyId) return null;
  const result = await dbClient.execute({
    sql: `SELECT * FROM tokenless_agent_publishing_policies
          WHERE policy_id = ? AND workspace_id = ? LIMIT 1`,
    args: [principal.policyId, workspaceId],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row) throw new TokenlessServiceError("Publishing policy not found.", 403, "policy_not_found");
  if (!rowBoolean(row, "enabled") || row.revoked_at) {
    throw new TokenlessServiceError("Publishing policy has been revoked.", 403, "policy_revoked");
  }
  const now = Date.now();
  if (new Date(String(row.effective_at)).getTime() > now) {
    throw new TokenlessServiceError("Publishing policy is not active yet.", 403, "policy_not_active");
  }
  if (row.expires_at && new Date(String(row.expires_at)).getTime() <= now) {
    throw new TokenlessServiceError("Publishing policy has expired.", 403, "policy_expired");
  }
  const modes = parseJsonArray(row.allowed_payment_modes_json, "allowed payment modes");
  if (
    modes.length === 0 ||
    modes.some(mode => !TOKENLESS_AGENT_PAYMENT_MODES.includes(mode as TokenlessAgentPaymentMode))
  ) {
    throw new TokenlessServiceError("Publishing policy is invalid.", 500, "policy_invalid");
  }
  return {
    policyId: String(row.policy_id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    version: Number(row.version),
    effectiveAt: new Date(String(row.effective_at)),
    expiresAt: row.expires_at ? new Date(String(row.expires_at)) : null,
    allowedPaymentModes: modes as TokenlessAgentPaymentMode[],
    payerAddress: rowString(row, "payer_address"),
    maxPanelAtomic: rowString(row, "max_panel_atomic")!,
    maxDailyAtomic: rowString(row, "max_daily_atomic")!,
    maxMonthlyAtomic: rowString(row, "max_monthly_atomic")!,
    maxPanelSize: Number(row.max_panel_size),
    maxBountyAtomic: rowString(row, "max_bounty_atomic")!,
    maxFeeBps: Number(row.max_fee_bps),
    maxAttemptReserveAtomic: rowString(row, "max_attempt_reserve_atomic")!,
    allowedProjectIds: parseJsonArray(row.allowed_project_ids_json, "allowed project IDs"),
    allowedReviewerSources: parseJsonArray(row.allowed_reviewer_sources_json, "allowed reviewer sources"),
    allowedAdmissionPolicyHashes: parseJsonArray(row.allowed_admission_policy_hashes_json, "allowed admission hashes"),
    allowedDataClassifications: parseJsonArray(row.allowed_data_classifications_json, "allowed data classifications"),
    maxRetentionDays:
      row.max_retention_days === null || row.max_retention_days === undefined ? null : Number(row.max_retention_days),
    allowPublicUrls: rowBoolean(row, "allow_public_urls"),
    allowedWebhookEndpointIds: parseJsonArray(row.allowed_webhook_endpoint_ids_json, "allowed webhook endpoint IDs"),
    allowedPromptTemplates: parseJsonArray(row.allowed_prompt_templates_json, "allowed prompt templates"),
    onPolicyMiss: rowString(row, "on_policy_miss") as "handoff" | "deny",
    createdBy: String(row.created_by),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function policyMiss(policy: AgentPublishingPolicy, message: string): never {
  throw new TokenlessServiceError(message, policy.onPolicyMiss === "handoff" ? 409 : 403, "approval_required");
}

async function enforcePublishingPolicy(input: {
  principal: ProductPrincipal;
  workspaceId: string;
  quoteRequest: Record<string, unknown>;
  quote: TokenlessQuoteResponse;
  request: TokenlessAskRequest;
}) {
  const classification = input.quoteRequest.dataClassification ?? "internal";
  const visibility = input.quoteRequest.visibility === "public" ? "public" : "private";
  assertDataIngressPolicy({
    classification,
    confirmedNoSensitiveData: input.quoteRequest.confirmedNoSensitiveData === true,
    visibility,
  });
  if (input.principal.kind === "api_key") {
    assertCredentialDataPolicy({
      classification,
      credentialHomeRegion: input.principal.credentialHomeRegion ?? "eu",
      homeRegion: input.principal.workspaceHomeRegion ?? "eu",
      maxClassification: input.principal.maxDataClassification ?? "confidential",
      permittedDataUses: input.principal.permittedDataUses ?? ["service_delivery"],
    });
  }
  const policy = await loadAgentPublishingPolicy(input.principal, input.workspaceId);
  assertScope(input.principal, "panel:publish");
  if (input.request.payment.mode !== "wallet") assertScope(input.principal, "payment:submit");
  if (!policy) return null;
  if (!policy.allowedPaymentModes.includes(input.request.payment.mode as TokenlessAgentPaymentMode)) {
    policyMiss(policy, "This payment mode is outside the delegated publishing policy.");
  }
  if (input.request.payment.mode === "x402") {
    const payer = getAddress(input.request.payment.payerAddress).toLowerCase();
    const boundWallet = input.principal.kind === "api_key" ? input.principal.walletAddress?.toLowerCase() : undefined;
    if (policy.payerAddress !== payer || boundWallet !== payer) {
      throw new TokenlessServiceError(
        "The payer is not the wallet bound to this policy.",
        403,
        "wallet_binding_mismatch",
      );
    }
  }
  const quoteRequest = input.quoteRequest as {
    audience?: { admissionPolicyHash?: string; source?: string };
    budget?: { bountyAtomic?: string; attemptReserveAtomic?: string; feeBps?: number };
    dataClassification?: string;
    requestedPanelSize?: number;
  };
  if (
    !quoteRequest.audience ||
    !policy.allowedAdmissionPolicyHashes.includes(quoteRequest.audience.admissionPolicyHash?.toLowerCase() ?? "")
  ) {
    policyMiss(policy, "The audience admission policy is outside the delegated publishing policy.");
  }
  if (
    quoteRequest.audience.source &&
    policy.allowedReviewerSources.length > 0 &&
    !policy.allowedReviewerSources.includes(quoteRequest.audience.source)
  ) {
    policyMiss(policy, "The reviewer source is outside the delegated publishing policy.");
  }
  const allowedDataClassifications = policy.allowedDataClassifications ?? [];
  if (
    allowedDataClassifications.length > 0 &&
    !allowedDataClassifications.includes(quoteRequest.dataClassification ?? "internal")
  ) {
    policyMiss(policy, "The data classification is outside the delegated publishing policy.");
  }
  const bounty = atomic(quoteRequest.budget?.bountyAtomic, "budget.bountyAtomic");
  const attemptReserve = atomic(quoteRequest.budget?.attemptReserveAtomic, "budget.attemptReserveAtomic");
  const total = quoteTotal(input.quote);
  if (
    total > BigInt(policy.maxPanelAtomic) ||
    total > BigInt(policy.maxDailyAtomic) ||
    total > BigInt(policy.maxMonthlyAtomic)
  ) {
    policyMiss(policy, "The quoted panel exceeds the delegated spending cap.");
  }
  if (bounty > BigInt(policy.maxBountyAtomic) || attemptReserve > BigInt(policy.maxAttemptReserveAtomic)) {
    policyMiss(policy, "The quoted bounty or attempt reserve exceeds the delegated cap.");
  }
  if (
    (quoteRequest.budget?.feeBps ?? 0) > policy.maxFeeBps ||
    (quoteRequest.requestedPanelSize ?? 0) > policy.maxPanelSize
  ) {
    policyMiss(policy, "The panel size or fee exceeds the delegated publishing policy.");
  }
  return policy;
}

async function reserveAgentPolicyBudget(input: {
  policy: AgentPublishingPolicy;
  principal: Extract<ProductPrincipal, { kind: "api_key" }>;
  idempotencyKey: string;
  quoteId: string;
  amountAtomic: bigint;
  paymentMode: TokenlessAgentPaymentMode;
}) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const policyResult = await client.query(
      `SELECT enabled, effective_at, expires_at, revoked_at, version, max_daily_atomic, max_monthly_atomic
       FROM tokenless_agent_publishing_policies WHERE policy_id = $1 AND workspace_id = $2 FOR UPDATE`,
      [input.policy.policyId, input.principal.workspaceId],
    );
    const policyRow = policyResult.rows[0] as QueryRow | undefined;
    if (!policyRow || !rowBoolean(policyRow, "enabled") || policyRow.revoked_at) {
      throw new TokenlessServiceError("Publishing policy has been revoked.", 403, "policy_revoked");
    }
    if (new Date(String(policyRow.effective_at)).getTime() > Date.now()) {
      throw new TokenlessServiceError("Publishing policy is not active yet.", 403, "policy_not_active");
    }
    if (policyRow.expires_at && new Date(String(policyRow.expires_at)).getTime() <= Date.now()) {
      throw new TokenlessServiceError("Publishing policy has expired.", 403, "policy_expired");
    }
    const existing = await client.query(
      `SELECT reservation_id, amount_atomic, payment_mode, status FROM tokenless_agent_policy_budget_reservations
       WHERE policy_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [input.policy.policyId, input.idempotencyKey],
    );
    const existingRow = existing.rows[0] as QueryRow | undefined;
    if (existingRow && rowString(existingRow, "status") !== "released") {
      if (
        rowString(existingRow, "amount_atomic") !== input.amountAtomic.toString() ||
        rowString(existingRow, "payment_mode") !== input.paymentMode
      ) {
        throw new TokenlessServiceError("The policy budget conflicts with this ask.", 409, "policy_budget_conflict");
      }
      await client.query("COMMIT");
      return {
        reservationId: rowString(existingRow, "reservation_id")!,
        created: false,
        policyVersion: Number(policyRow.version),
      };
    }
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfMonth = new Date(Date.UTC(startOfDay.getUTCFullYear(), startOfDay.getUTCMonth(), 1));
    const dayResult = await client.query(
      `SELECT COALESCE(SUM(amount_atomic), 0) AS amount FROM tokenless_agent_policy_budget_reservations
       WHERE policy_id = $1 AND status IN ('reserved', 'spent') AND created_at >= $2`,
      [input.policy.policyId, startOfDay],
    );
    const monthResult = await client.query(
      `SELECT COALESCE(SUM(amount_atomic), 0) AS amount FROM tokenless_agent_policy_budget_reservations
       WHERE policy_id = $1 AND status IN ('reserved', 'spent') AND created_at >= $2`,
      [input.policy.policyId, startOfMonth],
    );
    if (
      BigInt(rowString(dayResult.rows[0] as QueryRow | undefined, "amount") ?? "0") + input.amountAtomic >
      BigInt(rowString(policyRow, "max_daily_atomic")!)
    ) {
      throw new TokenlessServiceError(
        "The delegated daily spending cap is exhausted.",
        403,
        "policy_daily_cap_exceeded",
      );
    }
    if (
      BigInt(rowString(monthResult.rows[0] as QueryRow | undefined, "amount") ?? "0") + input.amountAtomic >
      BigInt(rowString(policyRow, "max_monthly_atomic")!)
    ) {
      throw new TokenlessServiceError(
        "The delegated monthly spending cap is exhausted.",
        403,
        "policy_monthly_cap_exceeded",
      );
    }
    const reservationId = `agres_${randomUUID().replaceAll("-", "")}`;
    const now = new Date();
    if (existingRow) {
      await client.query(
        `UPDATE tokenless_agent_policy_budget_reservations
         SET amount_atomic = $1, quote_id = $2, payment_mode = $3, policy_version = $4, operation_key = NULL, status = 'reserved', updated_at = $5
         WHERE reservation_id = $6`,
        [
          input.amountAtomic.toString(),
          input.quoteId,
          input.paymentMode,
          Number(policyRow.version),
          now,
          rowString(existingRow, "reservation_id"),
        ],
      );
      await client.query("COMMIT");
      return {
        reservationId: rowString(existingRow, "reservation_id")!,
        created: true,
        policyVersion: Number(policyRow.version),
      };
    }
    await client.query(
      `INSERT INTO tokenless_agent_policy_budget_reservations
       (reservation_id, policy_id, workspace_id, api_key_id, idempotency_key, quote_id, amount_atomic, payment_mode, policy_version, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'reserved', $10, $10)`,
      [
        reservationId,
        input.policy.policyId,
        input.principal.workspaceId,
        input.principal.apiKeyId,
        input.idempotencyKey,
        input.quoteId,
        input.amountAtomic.toString(),
        input.paymentMode,
        Number(policyRow.version),
        now,
      ],
    );
    await client.query("COMMIT");
    return { reservationId, created: true, policyVersion: Number(policyRow.version) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function releaseAgentPolicyBudget(reservationId: string | null) {
  if (!reservationId) return;
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_policy_budget_reservations SET status = 'released', updated_at = ?
          WHERE reservation_id = ? AND status = 'reserved' AND operation_key IS NULL`,
    args: [new Date(), reservationId],
  });
}

async function createQuestionRecords(
  client: PoolClient,
  input: {
    workspaceId: string;
    quoteId: string;
    idempotencyKey: string;
    quoteRequest: Record<string, unknown>;
    quote: TokenlessQuoteResponse;
  },
) {
  const intent = buildTokenlessQuoteIntent(input.quoteRequest as unknown as TokenlessQuoteRequest, input.quote);
  const content = intent.normalizedRequest.question;
  const contentJson = stableJson(content);
  const contentHash = digest(contentJson);
  if (`0x${contentHash}` !== intent.contentId) throw new Error("Canonical tokenless content commitment drifted.");
  const contentId = `cnt_${digest(`${input.workspaceId}:${contentHash}`).slice(0, 32)}`;
  const terms = {
    audience: input.quote.audience,
    visibility: input.quoteRequest.visibility ?? "private",
    dataClassification: input.quoteRequest.dataClassification ?? "internal",
    redactionSummary: input.quoteRequest.redactionSummary ?? null,
    confirmedNoSensitiveData: input.quoteRequest.confirmedNoSensitiveData === true,
    economics: input.quote.economics,
    panel: input.quote.panel,
    questionHash: contentHash,
    responseWindowSeconds: input.quoteRequest.responseWindowSeconds,
    schemaVersion: input.quote.schemaVersion,
  };
  const termsJson = stableJson(terms);
  const termsHash = digest(termsJson);
  if (`0x${termsHash}` !== intent.termsHash) throw new Error("Canonical tokenless terms commitment drifted.");
  const questionId = `qst_${digest(`${input.workspaceId}:${input.idempotencyKey}`).slice(0, 32)}`;
  const now = new Date();
  await client.query(
    `INSERT INTO tokenless_content_records
       (content_id, workspace_id, content_hash, content_json, home_region, data_classification,
        data_use_policy_version, moderation_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'eu', $5, 'data-use-v1', 'pending', $6, $6)
       ON CONFLICT (content_id) DO NOTHING`,
    [contentId, input.workspaceId, contentHash, contentJson, input.quoteRequest.dataClassification ?? "internal", now],
  );
  await client.query(
    `INSERT INTO tokenless_question_records
       (question_id, workspace_id, content_id, quote_id, terms_hash, terms_json, visibility,
        data_classification, home_region, data_use_policy_version, redaction_summary,
        confirmed_no_sensitive_data, moderation_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'eu', 'data-use-v1', $9, $10, 'pending', $11, $11)
       ON CONFLICT (question_id) DO NOTHING`,
    [
      questionId,
      input.workspaceId,
      contentId,
      input.quoteId,
      termsHash,
      termsJson,
      input.quoteRequest.visibility ?? "private",
      input.quoteRequest.dataClassification ?? "internal",
      input.quoteRequest.redactionSummary ?? null,
      input.quoteRequest.confirmedNoSensitiveData === true,
      now,
    ],
  );
  const frozenQuestion = await client.query(
    `SELECT q.workspace_id, q.content_id, q.quote_id, q.terms_hash, q.terms_json,
              q.visibility, q.data_classification, q.redaction_summary, q.confirmed_no_sensitive_data,
              c.content_hash, c.content_json
       FROM tokenless_question_records q
       JOIN tokenless_content_records c ON c.content_id = q.content_id
       WHERE q.question_id = $1
       LIMIT 1 FOR UPDATE`,
    [questionId],
  );
  const frozen = frozenQuestion.rows[0] as QueryRow | undefined;
  if (
    rowString(frozen, "workspace_id") !== input.workspaceId ||
    rowString(frozen, "content_id") !== contentId ||
    rowString(frozen, "quote_id") !== input.quoteId ||
    rowString(frozen, "terms_hash") !== termsHash ||
    rowString(frozen, "terms_json") !== termsJson ||
    rowString(frozen, "visibility") !== (input.quoteRequest.visibility ?? "private") ||
    rowString(frozen, "data_classification") !== (input.quoteRequest.dataClassification ?? "internal") ||
    (rowString(frozen, "redaction_summary") ?? null) !== (input.quoteRequest.redactionSummary ?? null) ||
    frozen?.confirmed_no_sensitive_data !== (input.quoteRequest.confirmedNoSensitiveData === true) ||
    rowString(frozen, "content_hash") !== contentHash ||
    rowString(frozen, "content_json") !== contentJson
  ) {
    throw new TokenlessServiceError(
      "This idempotency key is already bound to a different question.",
      409,
      "idempotency_conflict",
    );
  }
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

export function normalizedX402Authorization(value: Record<string, unknown>) {
  const validAfter = typeof value.validAfter === "number" ? String(value.validAfter) : value.validAfter;
  const validBefore = typeof value.validBefore === "number" ? String(value.validBefore) : value.validBefore;
  if (
    typeof validAfter !== "string" ||
    !ATOMIC_PATTERN.test(validAfter) ||
    typeof validBefore !== "string" ||
    !ATOMIC_PATTERN.test(validBefore) ||
    BigInt(validBefore) <= BigInt(validAfter) ||
    BigInt(validBefore) - BigInt(validAfter) > 3_600n ||
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
  if (input.principal.kind === "session" && input.principal.walletAddress?.toLowerCase() !== payerAddress) {
    throw new TokenlessServiceError("The payer must match the purpose-bound funding wallet.", 403, "payer_mismatch");
  }
  const payload =
    input.payment.mode === "x402" && input.payment.authorization
      ? { ...input.payment, authorization: normalizedX402Authorization(input.payment.authorization) }
      : input.payment;
  const payloadJson = stableJson(payload);
  const payloadHash = digest(payloadJson);
  const state =
    input.payment.mode === "wallet"
      ? "pending_user_signature"
      : input.payment.mode === "x402" && !input.payment.authorization
        ? "pending_chain_authorization"
        : "pending_chain_execution";
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
  mediaPreviews?: TokenlessQuestionImagePreviewGrant[];
  principal: ProductPrincipal;
  request: TokenlessAskRequest;
}): Promise<PreparedProductAsk> {
  const requestedWorkspace = input.request.payment.mode === "prepaid" ? input.request.payment.workspaceId : undefined;
  const workspaceId = await resolveWorkspace(input.principal, requestedWorkspace);
  await requireWorkspacePaidPanels(workspaceId);
  const { quoteRequest, quote } = await loadQuote(input.request.quoteId);
  const policy = await enforcePublishingPolicy({
    principal: input.principal,
    workspaceId,
    quoteRequest,
    quote,
    request: input.request,
  });
  const amountAtomic = quoteTotal(quote);
  let policyReservation: { reservationId: string; created: boolean; policyVersion: number } | null = null;
  try {
    if (policy) {
      if (input.principal.kind !== "api_key") {
        throw new TokenlessServiceError(
          "Publishing policies require an API-key principal.",
          403,
          "policy_principal_required",
        );
      }
      policyReservation = await reserveAgentPolicyBudget({
        policy,
        principal: input.principal,
        idempotencyKey: input.request.idempotencyKey,
        quoteId: input.request.quoteId,
        amountAtomic,
        paymentMode: input.request.payment.mode as TokenlessAgentPaymentMode,
      });
    }
    const questionId = `qst_${digest(`${workspaceId}:${input.request.idempotencyKey}`).slice(0, 32)}`;
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
      idempotencyScope:
        input.principal.kind === "api_key"
          ? `workspace:${workspaceId}:api_key:${input.principal.apiKeyId}`
          : `workspace:${workspaceId}:account:${input.principal.accountAddress.toLowerCase()}`,
      ownerAccountAddress: input.principal.kind === "session" ? input.principal.accountAddress.toLowerCase() : null,
      apiKeyId: input.principal.kind === "api_key" ? input.principal.apiKeyId : null,
      paymentMode,
      paymentReference: payment.reference,
      paymentState: payment.state,
      policyId: policy?.policyId ?? null,
      policyVersion: policyReservation?.policyVersion ?? policy?.version ?? null,
      policyReservationId: policyReservation?.reservationId ?? null,
      createdPolicyReservation: policyReservation?.created ?? false,
      mediaPreviews: input.mediaPreviews,
      quoteId: input.request.quoteId,
      quote,
      quoteRequest,
      requestHash: hashJson(input.request),
      questionId,
      workspaceId,
    };
  } catch (error) {
    if (policyReservation?.created) await releaseAgentPolicyBudget(policyReservation.reservationId);
    throw error;
  }
}

export async function attachProductAsk(prepared: PreparedProductAsk, ask: TokenlessAskResponse) {
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const askResult = await client.query(
      `SELECT operation_key, idempotency_key, quote_id, request_hash
       FROM tokenless_agent_asks WHERE operation_key = $1 LIMIT 1 FOR UPDATE`,
      [ask.operationKey],
    );
    const storedAsk = askResult.rows[0] as QueryRow | undefined;
    if (
      !storedAsk ||
      rowString(storedAsk, "idempotency_key") !== prepared.idempotencyKey ||
      rowString(storedAsk, "quote_id") !== prepared.quoteId ||
      rowString(storedAsk, "request_hash") !== prepared.requestHash
    ) {
      throw new TokenlessServiceError("Ask ownership conflicts with this request.", 409, "ask_ownership_conflict");
    }
    const paymentTable =
      prepared.paymentMode === "prepaid" ? "tokenless_prepaid_reservations" : "tokenless_payment_intents";
    const paymentIdColumn = prepared.paymentMode === "prepaid" ? "reservation_id" : "payment_intent_id";
    const lockedPayment = await client.query(
      `SELECT operation_key, ${prepared.paymentMode === "prepaid" ? "status" : "state"} AS state
       FROM ${paymentTable} WHERE ${paymentIdColumn} = $1 LIMIT 1 FOR UPDATE`,
      [prepared.paymentReference],
    );
    const lockedPaymentRow = lockedPayment.rows[0] as QueryRow | undefined;
    const lockedOperation = rowString(lockedPaymentRow, "operation_key");
    if (
      !lockedPaymentRow ||
      rowString(lockedPaymentRow, "state") !== prepared.paymentState ||
      (lockedOperation && lockedOperation !== ask.operationKey)
    ) {
      throw new TokenlessServiceError("Ask payment conflicts with this request.", 409, "payment_conflict");
    }
    const questionId = await createQuestionRecords(client, {
      idempotencyKey: prepared.idempotencyKey,
      quote: prepared.quote,
      quoteId: prepared.quoteId,
      quoteRequest: prepared.quoteRequest,
      workspaceId: prepared.workspaceId,
    });
    if (questionId !== prepared.questionId) {
      throw new TokenlessServiceError("Ask question conflicts with this request.", 409, "ask_ownership_conflict");
    }
    await client.query(
      `INSERT INTO tokenless_ask_ownership
       (operation_key, workspace_id, owner_account_address, api_key_id, question_id, payment_mode,
        payment_state, payment_reference, idempotency_key, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (operation_key) DO NOTHING`,
      [
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
      ],
    );
    const ownershipResult = await client.query(
      `SELECT workspace_id, payment_reference FROM tokenless_ask_ownership WHERE operation_key = $1 LIMIT 1`,
      [ask.operationKey],
    );
    const ownership = ownershipResult.rows[0] as QueryRow | undefined;
    if (
      rowString(ownership, "workspace_id") !== prepared.workspaceId ||
      rowString(ownership, "payment_reference") !== prepared.paymentReference
    ) {
      throw new TokenlessServiceError("Ask ownership conflicts with this request.", 409, "ask_ownership_conflict");
    }

    if (prepared.policyReservationId) {
      await client.query(
        `UPDATE tokenless_agent_policy_budget_reservations
         SET operation_key = $1, updated_at = $2
         WHERE reservation_id = $3 AND policy_id = $4 AND api_key_id = $5
           AND idempotency_key = $6 AND (operation_key IS NULL OR operation_key = $1)`,
        [
          ask.operationKey,
          now,
          prepared.policyReservationId,
          prepared.policyId,
          prepared.apiKeyId,
          prepared.idempotencyKey,
        ],
      );
      const policyReservationResult = await client.query(
        `SELECT operation_key FROM tokenless_agent_policy_budget_reservations WHERE reservation_id = $1 LIMIT 1`,
        [prepared.policyReservationId],
      );
      if (rowString(policyReservationResult.rows[0] as QueryRow | undefined, "operation_key") !== ask.operationKey) {
        throw new TokenlessServiceError("Policy budget conflicts with this request.", 409, "policy_budget_conflict");
      }
      await client.query(
        `INSERT INTO tokenless_agent_policy_audit_events
         (event_id, policy_id, workspace_id, api_key_id, policy_version, event_type, quote_id,
          operation_key, idempotency_key, amount_atomic, payment_mode, request_hash, details_json, created_at)
         VALUES ($1, $2, $3, $4, $5, 'ask_prepared', $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (policy_id, idempotency_key, event_type) DO NOTHING`,
        [
          `agev_${randomUUID().replaceAll("-", "")}`,
          prepared.policyId,
          prepared.workspaceId,
          prepared.apiKeyId,
          prepared.policyVersion,
          prepared.quoteId ?? null,
          ask.operationKey,
          prepared.idempotencyKey,
          prepared.amountAtomic,
          prepared.paymentMode,
          prepared.requestHash,
          JSON.stringify({ policyReservationId: prepared.policyReservationId }),
          now,
        ],
      );
    }

    await client.query(
      `UPDATE ${paymentTable} SET operation_key = $1, updated_at = $2
       WHERE ${paymentIdColumn} = $3 AND (operation_key IS NULL OR operation_key = $1)`,
      [ask.operationKey, now, prepared.paymentReference],
    );

    const paymentResult =
      prepared.paymentMode === "prepaid"
        ? await client.query(
            `SELECT operation_key, status AS state FROM tokenless_prepaid_reservations WHERE reservation_id = $1`,
            [prepared.paymentReference],
          )
        : await client.query(
            `SELECT operation_key, state FROM tokenless_payment_intents WHERE payment_intent_id = $1`,
            [prepared.paymentReference],
          );
    const payment = paymentResult.rows[0] as QueryRow | undefined;
    if (rowString(payment, "operation_key") !== ask.operationKey) {
      throw new TokenlessServiceError("Ask payment conflicts with this request.", 409, "payment_conflict");
    }
    const preparedQuestion = prepared.quoteRequest.question as {
      media?: { kind?: unknown; items?: Array<{ assetId: string; digest: string }> };
    };
    if (preparedQuestion.media?.kind === "images" && Array.isArray(preparedQuestion.media.items)) {
      await bindPublicQuestionMediaToQuestion(client, {
        accountAddress: prepared.ownerAccountAddress,
        items: preparedQuestion.media.items,
        now,
        ownerReference: prepared.apiKeyId ? `api_key:${prepared.apiKeyId}` : prepared.ownerAccountAddress,
        previewGrants: prepared.mediaPreviews,
        questionId,
        workspaceId: prepared.workspaceId,
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function releasePreparedProductAsk(prepared: PreparedProductAsk) {
  if (prepared.createdPolicyReservation) await releaseAgentPolicyBudget(prepared.policyReservationId);
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
    sql: `SELECT o.workspace_id, o.owner_account_address, o.api_key_id, m.role
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
    assertScope(principal, "result:read");
    if (principal.policyId && rowString(row, "api_key_id") !== principal.apiKeyId) {
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

export async function authorizeAskPaymentMutation(principal: ProductPrincipal, operationKey: string) {
  const result = await dbClient.execute({
    sql: `SELECT o.workspace_id, o.owner_account_address, o.api_key_id, m.role
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
    if (workspaceId !== principal.workspaceId || rowString(row, "api_key_id") !== principal.apiKeyId) {
      throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
    }
    assertScope(principal, "payment:submit");
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
