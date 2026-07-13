import { TOKENLESS_SCHEMA_VERSION, type TokenlessResult, parseTokenlessResult } from "@rateloop/sdk";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import "server-only";
import { dbClient } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const WEBHOOK_EVENTS = new Set(["result.ready", "result.updated"]);
const MAX_DELIVERY_ATTEMPTS = 8;
const BPS_MAX = 10_000;
const MAX_PONDER_COMMITS = 500;
const FINALIZED_ROUND_STATE = 4;
const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

type Row = Record<string, unknown>;
type ResolveHostname = (hostname: string) => Promise<string[]>;

export type IndexedFinalizedEvidence = {
  deploymentKey: string;
  roundId: string;
  revealCount: number;
  upVotes: number;
  economics: TokenlessResult["economics"];
  tierMix: Record<string, number>;
  diversity: {
    independentClusters: number;
    largestClusterBps: number;
    uniqueVoteKeys: number;
  };
  analytics: AnalyticsMetrics;
  provenance: {
    assignmentCount: number;
    issuedVoucherCount: number;
    matchedAssignmentCount: number;
    validResponseCount: number;
    verifiedIdentityCount: number;
  };
  roundTerms: {
    admissionPolicyHash: string;
    contentId: string;
    termsHash: string;
  };
  chain: { blockNumber: string; blockHash: string; transactionHash: string; timestamp: string };
};

export type AnalyticsMetrics = {
  answerFingerprintRiskBps: number;
  correlationRiskBps: number;
  issuedVoucherCount: number;
  verifiedIdentityCount: number;
};

type PonderDeployment = {
  adapterAddress: string;
  chainId: number;
  deploymentKey: string;
  issuerAddress: string;
  panelAddress: string;
  startBlock: number;
};

type PonderRound = Record<string, unknown>;
type PonderCommit = Record<string, unknown>;

function rowString(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

export function stableTransparencyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableTransparencyJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableTransparencyJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function bps(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > BPS_MAX) {
    throw new TokenlessServiceError(`${name} must be an integer from 0 to 10000.`, 400, "invalid_analytics");
  }
  return value;
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError(`${name} is malformed.`, 409, "indexed_evidence_invalid");
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, name: string, pattern?: RegExp) {
  if (typeof value !== "string" || value.length === 0 || (pattern && !pattern.test(value))) {
    throw new TokenlessServiceError(`${name} is malformed.`, 409, "indexed_evidence_invalid");
  }
  return value;
}

function integerValue(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TokenlessServiceError(`${name} is malformed.`, 409, "indexed_evidence_invalid");
  }
  return value;
}

function unsignedValue(value: unknown, name: string) {
  return stringValue(value, name, UNSIGNED_INTEGER);
}

function exactAddress(value: unknown, name: string) {
  return stringValue(value, name, ADDRESS).toLowerCase();
}

function exactBytes32(value: unknown, name: string) {
  return stringValue(value, name, BYTES32).toLowerCase();
}

function ratioBps(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Math.floor((numerator * BPS_MAX) / denominator);
}

function duplicateRiskBps(values: string[]) {
  return ratioBps(values.length - new Set(values).size, values.length);
}

function configuredPonderUrl(raw = process.env.TOKENLESS_PONDER_URL ?? process.env.NEXT_PUBLIC_PONDER_URL) {
  const value = raw?.trim() || (process.env.NODE_ENV === "production" ? "" : "http://127.0.0.1:42069");
  if (!value)
    throw new TokenlessServiceError("Ponder evidence source is not configured.", 503, "ponder_unavailable", true);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TokenlessServiceError("Ponder evidence source is invalid.", 503, "ponder_unavailable", true);
  }
  if (url.username || url.password || url.hash || !["http:", "https:"].includes(url.protocol)) {
    throw new TokenlessServiceError("Ponder evidence source is invalid.", 503, "ponder_unavailable", true);
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new TokenlessServiceError("Ponder evidence source must use HTTPS.", 503, "ponder_unavailable", true);
  }
  return url;
}

function ponderEndpoint(base: URL, path: string) {
  const url = new URL(base.toString());
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  url.search = "";
  return url;
}

async function fetchPonderJson(fetchImpl: typeof fetch, url: URL, name: string) {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TokenlessServiceError(`${name} is not available.`, 409, "indexed_evidence_pending", true);
  }
  if (!response.ok) {
    throw new TokenlessServiceError(`${name} is not available.`, 409, "indexed_evidence_pending", true);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new TokenlessServiceError(`${name} returned malformed JSON.`, 409, "indexed_evidence_invalid");
  }
}

function webhookKey(raw = process.env.TOKENLESS_WEBHOOK_ENCRYPTION_KEY) {
  if (!raw) throw new Error("TOKENLESS_WEBHOOK_ENCRYPTION_KEY is required.");
  const key = Buffer.from(raw, "base64url");
  if (key.length !== 32) throw new Error("TOKENLESS_WEBHOOK_ENCRYPTION_KEY must encode exactly 32 bytes.");
  return key;
}

function encryptSecret(secret: string, rawKey?: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", webhookKey(rawKey), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(value => value.toString("base64url")).join(".");
}

function decryptSecret(value: string, rawKey?: string) {
  const parts = value.split(".").map(part => Buffer.from(part, "base64url"));
  if (parts.length !== 3 || parts[0].length !== 12 || parts[1].length !== 16) {
    throw new Error("Stored webhook signing secret is malformed.");
  }
  const decipher = createDecipheriv("aes-256-gcm", webhookKey(rawKey), parts[0]);
  decipher.setAuthTag(parts[1]);
  return Buffer.concat([decipher.update(parts[2]), decipher.final()]).toString("utf8");
}

function isPrivateHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(normalized) === 6)
    return (
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  return false;
}

export function validateWebhookUrl(value: string, production = process.env.NODE_ENV === "production") {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TokenlessServiceError("Webhook URL is invalid.", 400, "invalid_webhook_url");
  }
  if (url.username || url.password || url.hash || url.protocol !== "https:") {
    throw new TokenlessServiceError(
      "Webhook URL must be a credential-free HTTPS URL without a fragment.",
      400,
      "invalid_webhook_url",
    );
  }
  if (isPrivateHost(url.hostname)) {
    throw new TokenlessServiceError("Webhook URL cannot target a private or local host.", 400, "invalid_webhook_url");
  }
  if (production && url.port && url.port !== "443") {
    throw new TokenlessServiceError(
      "Production webhook URLs must use the standard HTTPS port.",
      400,
      "invalid_webhook_url",
    );
  }
  return url.toString();
}

async function defaultResolveHostname(hostname: string) {
  return (await lookup(hostname, { all: true, verbatim: true })).map(result => result.address);
}

async function assertPublicWebhookDestination(url: string, resolver: ResolveHostname = defaultResolveHostname) {
  let addresses: string[];
  try {
    addresses = await resolver(new URL(url).hostname);
  } catch {
    throw new TokenlessServiceError("Webhook hostname could not be resolved.", 400, "invalid_webhook_url");
  }
  if (addresses.length === 0 || addresses.some(isPrivateHost)) {
    throw new TokenlessServiceError(
      "Webhook hostname cannot resolve to a private or local address.",
      400,
      "invalid_webhook_url",
    );
  }
}

function parseEventTypes(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some(item => typeof item !== "string" || !WEBHOOK_EVENTS.has(item))
  ) {
    throw new TokenlessServiceError(
      "eventTypes must contain supported webhook event names.",
      400,
      "invalid_webhook_events",
    );
  }
  return [...new Set(value as string[])].sort();
}

async function requireWorkspaceMember(accountAddress: string, workspaceId: string, management = false) {
  const result = await dbClient.execute({
    sql: `SELECT m.role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id = m.workspace_id
          WHERE m.workspace_id = ? AND m.account_address = ? AND w.status = 'active' LIMIT 1`,
    args: [workspaceId, accountAddress.toLowerCase()],
  });
  const role = rowString(result.rows[0] as Row | undefined, "role");
  if (!role || (management && role !== "owner" && role !== "admin")) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
}

export async function createWorkspaceWebhook(input: {
  accountAddress: string;
  workspaceId: string;
  url: string;
  eventTypes: string[];
  encryptionKey?: string;
  resolveHostname?: ResolveHostname;
}) {
  await requireWorkspaceMember(input.accountAddress, input.workspaceId, true);
  const url = validateWebhookUrl(input.url);
  await assertPublicWebhookDestination(url, input.resolveHostname);
  const eventTypes = parseEventTypes(input.eventTypes);
  const signingSecret = `rlwhsec_${randomBytes(32).toString("base64url")}`;
  const endpointId = `whe_${randomUUID().replaceAll("-", "")}`;
  const now = new Date();
  try {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_webhook_endpoints
            (endpoint_id, workspace_id, url, event_types_json, secret_ciphertext, secret_key_version, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'v1', true, ?, ?)`,
      args: [
        endpointId,
        input.workspaceId,
        url,
        JSON.stringify(eventTypes),
        encryptSecret(signingSecret, input.encryptionKey),
        now,
        now,
      ],
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new TokenlessServiceError("That webhook URL is already configured.", 409, "webhook_exists");
    }
    throw error;
  }
  return { endpointId, eventTypes, signingSecret, url };
}

export async function listWorkspaceWebhooks(input: { accountAddress: string; workspaceId: string }) {
  await requireWorkspaceMember(input.accountAddress, input.workspaceId, true);
  const result = await dbClient.execute({
    sql: `SELECT endpoint_id, url, event_types_json, active, created_at, updated_at
          FROM tokenless_webhook_endpoints WHERE workspace_id = ? ORDER BY created_at DESC`,
    args: [input.workspaceId],
  });
  return result.rows.map(value => {
    const row = value as Row;
    return {
      endpointId: rowString(row, "endpoint_id"),
      url: rowString(row, "url"),
      eventTypes: JSON.parse(rowString(row, "event_types_json") ?? "[]"),
      active: Boolean(row.active),
      createdAt: new Date(String(row.created_at)).toISOString(),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  });
}

export async function deactivateWorkspaceWebhook(input: {
  accountAddress: string;
  workspaceId: string;
  endpointId: string;
}) {
  await requireWorkspaceMember(input.accountAddress, input.workspaceId, true);
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_webhook_endpoints SET active = false, updated_at = ?
          WHERE endpoint_id = ? AND workspace_id = ? AND active = true`,
    args: [new Date(), input.endpointId, input.workspaceId],
  });
  if (result.rowCount !== 1) throw new TokenlessServiceError("Webhook not found.", 404, "webhook_not_found");
}

export async function subscribeAskWebhook(input: {
  operationKey: string;
  workspaceId: string;
  registration?: { url: string; eventTypes: string[] };
}) {
  if (!input.registration) return false;
  const url = validateWebhookUrl(input.registration.url);
  const eventTypes = parseEventTypes(input.registration.eventTypes);
  const endpoint = await dbClient.execute({
    sql: `SELECT endpoint_id, event_types_json FROM tokenless_webhook_endpoints
          WHERE workspace_id = ? AND url = ? AND active = true LIMIT 1`,
    args: [input.workspaceId, url],
  });
  const row = endpoint.rows[0] as Row | undefined;
  const endpointId = rowString(row, "endpoint_id");
  const configured = new Set<string>(JSON.parse(rowString(row, "event_types_json") ?? "[]"));
  if (!endpointId || eventTypes.some(eventType => !configured.has(eventType))) {
    throw new TokenlessServiceError(
      "Configure this webhook URL and event set in workspace settings first.",
      409,
      "webhook_not_configured",
    );
  }
  await dbClient.execute({
    sql: `INSERT INTO tokenless_ask_webhook_subscriptions
          (subscription_id, operation_key, endpoint_id, event_types_json, created_at)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT (operation_key, endpoint_id) DO NOTHING`,
    args: [
      `whs_${digest(`${input.operationKey}:${endpointId}`).slice(0, 32)}`,
      input.operationKey,
      endpointId,
      JSON.stringify(eventTypes),
      new Date(),
    ],
  });
  return true;
}

function validateFinalizedEvidence(value: IndexedFinalizedEvidence) {
  if (
    !UNSIGNED_INTEGER.test(value.roundId) ||
    !value.deploymentKey ||
    !Number.isSafeInteger(value.revealCount) ||
    value.revealCount < 1 ||
    !Number.isSafeInteger(value.upVotes) ||
    value.upVotes < 0 ||
    value.upVotes > value.revealCount
  ) {
    throw new TokenlessServiceError("Indexed round evidence is invalid.", 400, "invalid_round_evidence");
  }
  if (
    Object.values(value.tierMix).some(count => !Number.isSafeInteger(count) || count < 0) ||
    Object.values(value.tierMix).reduce((sum, count) => sum + count, 0) !== value.revealCount
  ) {
    throw new TokenlessServiceError("Tier mix must account for every reveal.", 400, "invalid_round_evidence");
  }
  bps(value.diversity.largestClusterBps, "diversity.largestClusterBps");
  if (value.diversity.uniqueVoteKeys !== value.revealCount || value.diversity.independentClusters < 1) {
    throw new TokenlessServiceError(
      "Diversity metadata does not match the indexed reveal set.",
      400,
      "invalid_round_evidence",
    );
  }
  if (
    !UNSIGNED_INTEGER.test(value.chain.blockNumber) ||
    !BYTES32.test(value.chain.blockHash) ||
    !BYTES32.test(value.chain.transactionHash) ||
    !UNSIGNED_INTEGER.test(value.chain.timestamp)
  ) {
    throw new TokenlessServiceError("Chain finality evidence is malformed.", 400, "invalid_round_evidence");
  }
  const fundedAmounts = [
    value.economics.bounty.fundedAtomic,
    value.economics.fee.fundedAtomic,
    value.economics.attemptReserve.fundedAtomic,
    value.economics.totalFundedAtomic,
  ];
  if (fundedAmounts.some(amount => !UNSIGNED_INTEGER.test(amount))) {
    throw new TokenlessServiceError("Round evidence funding is malformed.", 400, "invalid_round_evidence");
  }
  const funded = BigInt(fundedAmounts[0]) + BigInt(fundedAmounts[1]) + BigInt(fundedAmounts[2]);
  if (funded !== BigInt(value.economics.totalFundedAtomic)) {
    throw new TokenlessServiceError("Round evidence funding does not conserve.", 400, "invalid_round_evidence");
  }
  if (
    !BYTES32.test(value.roundTerms.admissionPolicyHash) ||
    !BYTES32.test(value.roundTerms.contentId) ||
    !BYTES32.test(value.roundTerms.termsHash)
  ) {
    throw new TokenlessServiceError("Frozen round terms are malformed.", 400, "invalid_round_evidence");
  }
  evaluateAnalytics(value.analytics, value.diversity);
}

function exactIndexedIdentity(input: { deployment: PonderDeployment; execution: Row; round: PonderRound; terms: Row }) {
  const expected = {
    deploymentKey: rowString(input.execution, "deployment_key")!,
    chainId: Number(input.execution.chain_id),
    deploymentBlock: rowString(input.execution, "deployment_block")!,
    panelAddress: rowString(input.execution, "panel_address")!.toLowerCase(),
    issuerAddress: rowString(input.execution, "issuer_address")!.toLowerCase(),
    adapterAddress: rowString(input.execution, "x402_submitter_address")!.toLowerCase(),
    roundId: rowString(input.execution, "round_id")!,
    funder: rowString(input.execution, "funder_address")!.toLowerCase(),
  };
  if (
    input.deployment.deploymentKey.toLowerCase() !== expected.deploymentKey.toLowerCase() ||
    input.deployment.chainId !== expected.chainId ||
    input.deployment.startBlock !== Number(expected.deploymentBlock) ||
    exactAddress(input.deployment.panelAddress, "Ponder panel address") !== expected.panelAddress ||
    exactAddress(input.deployment.issuerAddress, "Ponder issuer address") !== expected.issuerAddress ||
    exactAddress(input.deployment.adapterAddress, "Ponder adapter address") !== expected.adapterAddress ||
    stringValue(input.round.deploymentKey, "Indexed deployment key").toLowerCase() !==
      expected.deploymentKey.toLowerCase() ||
    unsignedValue(input.round.roundId, "Indexed round id") !== expected.roundId ||
    exactAddress(input.round.funder, "Indexed funder") !== expected.funder
  ) {
    throw new TokenlessServiceError(
      "Indexed evidence does not match the deployment-pinned execution.",
      409,
      "evidence_identity_mismatch",
    );
  }
  const exactTerms: Array<[unknown, unknown, string, (value: unknown, name: string) => string]> = [
    [input.round.contentId, input.terms.contentId, "contentId", exactBytes32],
    [input.round.termsHash, input.terms.termsHash, "termsHash", exactBytes32],
    [input.round.beaconNetworkHash, input.terms.beaconNetworkHash, "beaconNetworkHash", exactBytes32],
    [input.round.admissionPolicyHash, input.terms.admissionPolicyHash, "admissionPolicyHash", exactBytes32],
    [input.round.feeRecipient, input.terms.feeRecipient, "feeRecipient", exactAddress],
    [input.round.bountyAmount, input.terms.bountyAmount, "bountyAmount", unsignedValue],
    [input.round.feeAmount, input.terms.feeAmount, "feeAmount", unsignedValue],
    [input.round.attemptReserve, input.terms.attemptReserve, "attemptReserve", unsignedValue],
    [input.round.attemptCompensation, input.terms.attemptCompensation, "attemptCompensation", unsignedValue],
    [input.round.commitDeadline, input.terms.commitDeadline, "commitDeadline", unsignedValue],
    [input.round.revealDeadline, input.terms.revealDeadline, "revealDeadline", unsignedValue],
    [input.round.beaconFailureDeadline, input.terms.beaconFailureDeadline, "beaconFailureDeadline", unsignedValue],
    [input.round.beaconRound, input.terms.beaconRound, "beaconRound", unsignedValue],
    [input.round.claimGracePeriod, input.terms.claimGracePeriod, "claimGracePeriod", unsignedValue],
  ];
  if (
    exactTerms.some(
      ([indexed, frozen, name, parse]) => parse(indexed, `Indexed ${name}`) !== parse(frozen, `Frozen ${name}`),
    )
  ) {
    throw new TokenlessServiceError("Indexed round terms do not match the frozen terms.", 409, "round_terms_mismatch");
  }
  if (
    integerValue(input.round.minimumReveals, "Indexed minimum reveals") !==
      integerValue(input.terms.minimumReveals, "Frozen minimum reveals") ||
    integerValue(input.round.maximumCommits, "Indexed maximum commits") !==
      integerValue(input.terms.maximumCommits, "Frozen maximum commits")
  ) {
    throw new TokenlessServiceError("Indexed round terms do not match the frozen terms.", 409, "round_terms_mismatch");
  }
}

async function assuranceProvenance(input: {
  roundId: string;
  contentId: string;
  admissionPolicyHash: string;
  revealCount: number;
  revealedAccounts: Set<string>;
}) {
  const cases = await dbClient.execute({
    sql: `SELECT run_id, case_id FROM tokenless_assurance_run_cases
          WHERE round_id = ? AND lower(content_id) = ? AND lower(admission_policy_hash) = ? LIMIT 2`,
    args: [input.roundId, input.contentId.toLowerCase(), input.admissionPolicyHash.toLowerCase()],
  });
  if (cases.rows.length > 1) {
    throw new TokenlessServiceError(
      "Indexed round maps to multiple assurance cases.",
      409,
      "evidence_identity_mismatch",
    );
  }
  const linked = cases.rows[0] as Row | undefined;
  if (!linked) return { assignmentCount: 0, matchedAssignmentCount: 0, validResponseCount: 0, correlationRiskBps: 0 };
  const runId = rowString(linked, "run_id")!;
  const caseId = rowString(linked, "case_id")!;
  const [assignments, responses] = await Promise.all([
    dbClient.execute({
      sql: `SELECT reviewer_account_address FROM tokenless_assurance_assignments
            WHERE run_id = ? AND status IN ('accepted', 'completed')`,
      args: [runId],
    }),
    dbClient.execute({
      sql: `SELECT reviewer_key, response_digest FROM tokenless_assurance_responses
            WHERE run_id = ? AND case_id = ? AND validity = 'valid'`,
      args: [runId, caseId],
    }),
  ]);
  const matchedAssignmentCount = assignments.rows.filter(value =>
    input.revealedAccounts.has(rowString(value as Row, "reviewer_account_address")?.toLowerCase() ?? ""),
  ).length;
  const mismatch = Math.max(
    Math.abs(input.revealCount - matchedAssignmentCount),
    Math.abs(input.revealCount - responses.rows.length),
  );
  return {
    assignmentCount: assignments.rows.length,
    matchedAssignmentCount,
    validResponseCount: responses.rows.length,
    correlationRiskBps: ratioBps(Math.min(mismatch, input.revealCount), input.revealCount),
  };
}

export async function deriveFinalizedRoundEvidence(input: {
  operationKey: string;
  fetchImpl?: typeof fetch;
  ponderUrl?: string;
}) {
  const source = await dbClient.execute({
    sql: `SELECT o.workspace_id, e.*, a.economics_json
          FROM tokenless_ask_ownership o
          JOIN tokenless_chain_executions e ON e.operation_key = o.operation_key
          JOIN tokenless_agent_asks a ON a.operation_key = o.operation_key
          WHERE o.operation_key = ? LIMIT 1`,
    args: [input.operationKey],
  });
  const execution = source.rows[0] as Row | undefined;
  if (!execution || !rowString(execution, "workspace_id") || !rowString(execution, "round_id")) {
    throw new TokenlessServiceError("Ask chain execution was not found.", 404, "ask_not_found");
  }
  if (rowString(execution, "state") !== "confirmed") {
    throw new TokenlessServiceError("Ask chain execution is not confirmed.", 409, "indexed_evidence_pending", true);
  }
  const terms = objectValue(JSON.parse(rowString(execution, "round_terms_json")!), "Frozen round terms") as Row;
  const base = configuredPonderUrl(input.ponderUrl);
  const roundUrl = ponderEndpoint(base, `/rounds/${encodeURIComponent(rowString(execution, "round_id")!)}`);
  const commitsUrl = ponderEndpoint(base, `/rounds/${encodeURIComponent(rowString(execution, "round_id")!)}/commits`);
  commitsUrl.searchParams.set("limit", String(MAX_PONDER_COMMITS));
  const fetchImpl = input.fetchImpl ?? fetch;
  const [rawDeployment, rawRound, rawCommits] = await Promise.all([
    fetchPonderJson(fetchImpl, ponderEndpoint(base, "/deployment"), "Ponder deployment"),
    fetchPonderJson(fetchImpl, roundUrl, "Indexed round"),
    fetchPonderJson(fetchImpl, commitsUrl, "Indexed commits"),
  ]);
  const deployment = objectValue(rawDeployment, "Ponder deployment") as unknown as PonderDeployment;
  const round = objectValue(rawRound, "Indexed round") as PonderRound;
  if (!Array.isArray(rawCommits)) {
    throw new TokenlessServiceError("Indexed commits are malformed.", 409, "indexed_evidence_invalid");
  }
  exactIndexedIdentity({ deployment, execution, round, terms });
  const state = integerValue(round.state, "Indexed round state");
  const revealCount = integerValue(round.revealCount, "Indexed reveal count");
  const frozenRevealCount = integerValue(round.frozenRevealCount, "Indexed frozen reveal count");
  const commitCount = integerValue(round.commitCount, "Indexed commit count");
  const upVotes = integerValue(round.upVotes, "Indexed up vote count");
  if (
    state !== FINALIZED_ROUND_STATE ||
    revealCount < 1 ||
    frozenRevealCount !== revealCount ||
    upVotes > revealCount ||
    commitCount > MAX_PONDER_COMMITS ||
    rawCommits.length !== commitCount
  ) {
    throw new TokenlessServiceError(
      "Indexed round is not completely finalized.",
      409,
      "indexed_evidence_pending",
      true,
    );
  }
  const finalizedBlock = unsignedValue(round.finalizedBlock, "Finalized block");
  const finalizedAt = unsignedValue(round.finalizedAt, "Finalized timestamp");
  if (
    BigInt(finalizedBlock) < BigInt(rowString(execution, "deployment_block")!) ||
    BigInt(finalizedBlock) < BigInt(unsignedValue(round.createdBlock, "Created block"))
  ) {
    throw new TokenlessServiceError("Finalization predates the pinned deployment.", 409, "evidence_identity_mismatch");
  }
  const commits = rawCommits.map((value, index) => objectValue(value, `Indexed commit ${index}`) as PonderCommit);
  const revealed = commits.filter(commit => commit.revealed === true);
  if (revealed.length !== revealCount) {
    throw new TokenlessServiceError(
      "Indexed reveal count does not match the commit projection.",
      409,
      "indexed_evidence_invalid",
    );
  }
  const voteKeys = revealed.map((commit, index) => exactAddress(commit.voteKey, `Reveal ${index} vote key`));
  const nullifiers = revealed.map((commit, index) => exactBytes32(commit.nullifier, `Reveal ${index} nullifier`));
  const responseHashes = revealed.map((commit, index) =>
    exactBytes32(commit.responseHash, `Reveal ${index} response hash`),
  );
  if (new Set(voteKeys).size !== revealCount || new Set(nullifiers).size !== revealCount) {
    throw new TokenlessServiceError("Indexed reveal identities are not unique.", 409, "indexed_evidence_invalid");
  }
  const indexedUpVotes = revealed.reduce((sum, commit, index) => {
    const vote = integerValue(commit.vote, `Reveal ${index} vote`);
    if (vote !== 0 && vote !== 1)
      throw new TokenlessServiceError("Indexed vote is invalid.", 409, "indexed_evidence_invalid");
    return sum + vote;
  }, 0);
  if (indexedUpVotes !== upVotes) {
    throw new TokenlessServiceError(
      "Indexed votes do not match the finalized aggregate.",
      409,
      "indexed_evidence_invalid",
    );
  }
  const vouchersResult = await dbClient.execute({
    sql: `SELECT v.vote_key, v.admission_policy_hash, v.content_id, v.issuer_address,
                 p.account_address, e.provider_subject_hash, e.provider_id, e.reviewer_source
          FROM tokenless_paid_vouchers v
          JOIN tokenless_rater_profiles p ON p.rater_id = v.rater_id
          JOIN tokenless_capability_eligibility e ON e.rater_id = v.rater_id
          WHERE v.chain_id = ? AND lower(v.panel_address) = ? AND v.round_id = ?`,
    args: [
      Number(execution.chain_id),
      rowString(execution, "panel_address")!.toLowerCase(),
      rowString(execution, "round_id")!,
    ],
  });
  const vouchers = new Map(
    vouchersResult.rows.map(value => {
      const voucher = value as Row;
      return [rowString(voucher, "vote_key")!.toLowerCase(), voucher] as const;
    }),
  );
  const revealedVouchers = voteKeys.map(voteKey => vouchers.get(voteKey));
  if (
    revealedVouchers.some(value => !value) ||
    revealedVouchers.some(
      value =>
        rowString(value, "content_id")?.toLowerCase() !== exactBytes32(round.contentId, "Indexed content id") ||
        rowString(value, "issuer_address")?.toLowerCase() !== rowString(execution, "issuer_address")?.toLowerCase() ||
        rowString(value, "admission_policy_hash")?.toLowerCase() !==
          exactBytes32(round.admissionPolicyHash, "Indexed admission policy hash"),
    )
  ) {
    throw new TokenlessServiceError("Indexed reveals do not match issued vouchers.", 409, "evidence_source_mismatch");
  }
  const tierMix: Record<string, number> = {};
  const identityCounts = new Map<string, number>();
  const revealedAccounts = new Set<string>();
  for (const voucher of revealedVouchers as Row[]) {
    const tier = `provider:${stringValue(voucher.provider_id, "Voucher provider")}`;
    tierMix[tier] = (tierMix[tier] ?? 0) + 1;
    const identity = stringValue(voucher.provider_subject_hash, "Voucher identity subject");
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
    revealedAccounts.add(exactAddress(voucher.account_address, "Voucher account"));
  }
  const assurance = await assuranceProvenance({
    roundId: rowString(execution, "round_id")!,
    contentId: exactBytes32(round.contentId, "Indexed content id"),
    admissionPolicyHash: exactBytes32(round.admissionPolicyHash, "Indexed admission policy hash"),
    revealCount,
    revealedAccounts,
  });
  const issuedIdentities = new Set(vouchersResult.rows.map(value => rowString(value as Row, "provider_subject_hash")!));
  const largestIdentityCluster = Math.max(...identityCounts.values());
  const quoteEconomics = objectValue(JSON.parse(rowString(execution, "economics_json")!), "Stored economics");
  const fee = objectValue(quoteEconomics.fee, "Stored fee economics");
  const bountyAmount = unsignedValue(round.bountyAmount, "Indexed bounty amount");
  const feeAmount = unsignedValue(round.feeAmount, "Indexed fee amount");
  const attemptReserve = unsignedValue(round.attemptReserve, "Indexed attempt reserve");
  const totalFundedAtomic = (BigInt(bountyAmount) + BigInt(feeAmount) + BigInt(attemptReserve)).toString();
  if (totalFundedAtomic !== rowString(execution, "total_funded_atomic")) {
    throw new TokenlessServiceError(
      "Indexed funding does not match the pinned execution.",
      409,
      "round_terms_mismatch",
    );
  }
  const evidence: IndexedFinalizedEvidence = {
    deploymentKey: rowString(execution, "deployment_key")!,
    roundId: rowString(execution, "round_id")!,
    revealCount,
    upVotes,
    economics: {
      asset: "USDC",
      decimals: 6,
      bounty: { fundedAtomic: bountyAmount, paidAtomic: bountyAmount, refundedAtomic: "0" },
      fee: {
        bps: integerValue(fee.bps, "Stored fee bps"),
        fundedAtomic: feeAmount,
        paidAtomic: feeAmount,
        refundedAtomic: "0",
      },
      attemptReserve: { fundedAtomic: attemptReserve, compensatedAtomic: "0", refundedAtomic: attemptReserve },
      refund: { bountyAtomic: "0", feeAtomic: "0", attemptReserveAtomic: attemptReserve, totalAtomic: attemptReserve },
      compensation: {
        perAcceptedRevealCapAtomic: unsignedValue(round.attemptCompensation, "Indexed attempt compensation"),
        recipientCount: 0,
        totalAtomic: "0",
      },
      totalFundedAtomic,
    },
    tierMix,
    diversity: {
      independentClusters: identityCounts.size,
      largestClusterBps: ratioBps(largestIdentityCluster, revealCount),
      uniqueVoteKeys: new Set(voteKeys).size,
    },
    analytics: {
      answerFingerprintRiskBps: duplicateRiskBps(responseHashes),
      correlationRiskBps: assurance.correlationRiskBps,
      issuedVoucherCount: vouchersResult.rows.length,
      verifiedIdentityCount: issuedIdentities.size,
    },
    provenance: {
      assignmentCount: assurance.assignmentCount,
      issuedVoucherCount: vouchersResult.rows.length,
      matchedAssignmentCount: assurance.matchedAssignmentCount,
      validResponseCount: assurance.validResponseCount,
      verifiedIdentityCount: issuedIdentities.size,
    },
    roundTerms: {
      admissionPolicyHash: exactBytes32(round.admissionPolicyHash, "Indexed admission policy hash"),
      contentId: exactBytes32(round.contentId, "Indexed content id"),
      termsHash: exactBytes32(round.termsHash, "Indexed terms hash"),
    },
    chain: {
      blockNumber: finalizedBlock,
      blockHash: exactBytes32(round.finalizedBlockHash, "Finalized block hash"),
      transactionHash: exactBytes32(round.finalizedTxHash, "Finalized transaction hash"),
      timestamp: finalizedAt,
    },
  };
  validateFinalizedEvidence(evidence);
  return evidence;
}

export async function appendFinalizedRoundEvidence(input: {
  operationKey: string;
  fetchImpl?: typeof fetch;
  ponderUrl?: string;
}) {
  const evidence = await deriveFinalizedRoundEvidence(input);
  const ownership = await dbClient.execute({
    sql: "SELECT workspace_id FROM tokenless_ask_ownership WHERE operation_key = ? LIMIT 1",
    args: [input.operationKey],
  });
  const workspaceId = rowString(ownership.rows[0] as Row | undefined, "workspace_id");
  if (!workspaceId) throw new TokenlessServiceError("Ask chain execution was not found.", 404, "ask_not_found");
  if (
    !UNSIGNED_INTEGER.test(evidence.chain.timestamp) ||
    BigInt(evidence.chain.timestamp) > BigInt(Math.floor(Date.now() / 1_000) + 300)
  ) {
    throw new TokenlessServiceError("Finalization timestamp is invalid.", 409, "indexed_evidence_invalid");
  }
  const evidenceJson = stableTransparencyJson(evidence);
  const evidenceHash = digest(`round.finalized:${evidenceJson}`);
  const eventId = `tpe_${digest(`${input.operationKey}:${evidenceHash}`).slice(0, 32)}`;
  const existingEvidence = await dbClient.execute({
    sql: "SELECT evidence_hash FROM tokenless_transparency_events WHERE operation_key = ? AND event_type = 'round.finalized' LIMIT 1",
    args: [input.operationKey],
  });
  const existingHash = rowString(existingEvidence.rows[0] as Row | undefined, "evidence_hash");
  if (existingHash) {
    if (existingHash !== evidenceHash) {
      throw new TokenlessServiceError("Finalized evidence is immutable for this ask.", 409, "evidence_conflict");
    }
    return { eventId, evidenceHash };
  }
  const sequenceResult = await dbClient.execute({
    sql: "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM tokenless_transparency_events WHERE operation_key = ?",
    args: [input.operationKey],
  });
  const sequence = Number(rowString(sequenceResult.rows[0] as Row | undefined, "sequence") ?? "1");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_transparency_events
          (event_id, operation_key, workspace_id, deployment_key, round_id, sequence, event_type, evidence_hash, evidence_json, occurred_at, recorded_at)
          VALUES (?, ?, ?, ?, ?, ?, 'round.finalized', ?, ?, ?, ?)
          ON CONFLICT (operation_key, evidence_hash) DO NOTHING`,
    args: [
      eventId,
      input.operationKey,
      workspaceId,
      evidence.deploymentKey,
      evidence.roundId,
      sequence,
      evidenceHash,
      evidenceJson,
      new Date(Number(evidence.chain.timestamp) * 1_000),
      new Date(),
    ],
  });
  await dbClient.execute({
    sql: `UPDATE tokenless_agent_asks SET status = 'submitted', verdict_status = 'pending_analytics', updated_at = ?
          WHERE operation_key = ? AND result_json IS NULL`,
    args: [new Date(), input.operationKey],
  });
  return { eventId, evidenceHash };
}

export function evaluateAnalytics(metrics: AnalyticsMetrics, diversity: IndexedFinalizedEvidence["diversity"]) {
  bps(metrics.answerFingerprintRiskBps, "answerFingerprintRiskBps");
  bps(metrics.correlationRiskBps, "correlationRiskBps");
  if (
    !Number.isSafeInteger(metrics.issuedVoucherCount) ||
    metrics.issuedVoucherCount < 0 ||
    !Number.isSafeInteger(metrics.verifiedIdentityCount) ||
    metrics.verifiedIdentityCount < 0
  ) {
    throw new TokenlessServiceError(
      "Issuance analytics counts must be non-negative integers.",
      400,
      "invalid_analytics",
    );
  }
  const reasonCodes: string[] = [];
  if (metrics.issuedVoucherCount > metrics.verifiedIdentityCount)
    reasonCodes.push("issuance_exceeds_verified_identities");
  if (metrics.correlationRiskBps >= 4_000) reasonCodes.push("high_correlation_risk");
  if (metrics.answerFingerprintRiskBps >= 4_000) reasonCodes.push("high_answer_fingerprint_risk");
  if (diversity.largestClusterBps > 5_000) reasonCodes.push("dominant_identity_cluster");
  return { decision: reasonCodes.length === 0 ? ("published" as const) : ("delisted" as const), reasonCodes };
}

function evidenceRoot(hashes: string[]) {
  return digest(`rateloop-transparency-v1:${hashes.join(":")}`);
}

function selectedChoice(request: Row, scoreBps: number) {
  const question = request.question as Row | undefined;
  if (question?.kind === "head_to_head") {
    const option = scoreBps >= 5_000 ? (question.optionA as Row | undefined) : (question.optionB as Row | undefined);
    return typeof option?.key === "string" ? option.key : null;
  }
  return scoreBps >= 5_000 ? "yes" : "no";
}

export function wilsonIntervalBps(successes: number, sampleSize: number) {
  if (
    !Number.isSafeInteger(successes) ||
    !Number.isSafeInteger(sampleSize) ||
    sampleSize <= 0 ||
    successes < 0 ||
    successes > sampleSize
  ) {
    throw new TokenlessServiceError("Wilson interval inputs are invalid.", 400, "invalid_analytics");
  }
  const z = 1.959963984540054;
  const p = successes / sampleSize;
  const zSquared = z * z;
  const denominator = 1 + zSquared / sampleSize;
  const center = (p + zSquared / (2 * sampleSize)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / sampleSize + zSquared / (4 * sampleSize * sampleSize))) / denominator;
  return {
    lower: Math.max(0, Math.floor((center - margin) * BPS_MAX)),
    upper: Math.min(BPS_MAX, Math.ceil((center + margin) * BPS_MAX)),
  };
}

export async function reviewAndPublishResult(input: { operationKey: string; appOrigin: string; now?: Date }) {
  const now = input.now ?? new Date();
  const eventResult = await dbClient.execute({
    sql: `SELECT evidence_json, evidence_hash FROM tokenless_transparency_events
          WHERE operation_key = ? AND event_type = 'round.finalized' ORDER BY sequence ASC`,
    args: [input.operationKey],
  });
  if (eventResult.rows.length === 0)
    throw new TokenlessServiceError("Finalized round evidence is not indexed.", 409, "evidence_pending");
  const evidence = JSON.parse(
    rowString(eventResult.rows.at(-1) as Row | undefined, "evidence_json")!,
  ) as IndexedFinalizedEvidence;
  validateFinalizedEvidence(evidence);
  const root = evidenceRoot(eventResult.rows.map(value => rowString(value as Row, "evidence_hash")!));
  const evaluation = evaluateAnalytics(evidence.analytics, evidence.diversity);
  const existingPublication = await dbClient.execute({
    sql: "SELECT publication_id, evidence_root, result_json FROM tokenless_result_publications WHERE operation_key = ? AND publication_version = 1 LIMIT 1",
    args: [input.operationKey],
  });
  const existing = existingPublication.rows[0] as Row | undefined;
  if (existing) {
    if (rowString(existing, "evidence_root") !== root) {
      throw new TokenlessServiceError("Published result evidence is immutable.", 409, "publication_conflict");
    }
    const review = await dbClient.execute({
      sql: "SELECT reason_codes_json FROM tokenless_analytics_reviews WHERE operation_key = ? AND review_version = 1 LIMIT 1",
      args: [input.operationKey],
    });
    return {
      evidenceRoot: root,
      publicationId: rowString(existing, "publication_id")!,
      reasonCodes: JSON.parse(rowString(review.rows[0] as Row | undefined, "reason_codes_json") ?? "[]") as string[],
      result: parseTokenlessResult(JSON.parse(rowString(existing, "result_json")!)),
    };
  }
  const askResult = await dbClient.execute({
    sql: `SELECT a.economics_json, q.request_json, q.response_json
          FROM tokenless_agent_asks a JOIN tokenless_agent_quotes q ON q.quote_id = a.quote_id
          WHERE a.operation_key = ? LIMIT 1`,
    args: [input.operationKey],
  });
  const ask = askResult.rows[0] as Row | undefined;
  if (!ask) throw new TokenlessServiceError("Ask not found.", 404, "ask_not_found");
  const quote = JSON.parse(rowString(ask, "response_json")!) as Row;
  const request = JSON.parse(rowString(ask, "request_json")!) as Row;
  const audience = quote.audience as Row;
  const preferenceShareBps = Math.floor((evidence.upVotes * BPS_MAX) / evidence.revealCount);
  const intervalBps = wilsonIntervalBps(evidence.upVotes, evidence.revealCount);
  const result = parseTokenlessResult({
    schemaVersion: TOKENLESS_SCHEMA_VERSION,
    operationKey: input.operationKey,
    roundId: evidence.roundId,
    verdictStatus: evaluation.decision,
    terminal: true,
    economics: evidence.economics,
    audience: {
      admissionPolicyHash: audience.admissionPolicyHash,
      label: audience.label,
      participantCount: evidence.revealCount,
      source: audience.source,
    },
    verdict:
      evaluation.decision === "published"
        ? {
            intervalBps,
            preferenceShareBps,
            selected: selectedChoice(request, preferenceShareBps),
          }
        : null,
    methodologyUrl: `${input.appOrigin.replace(/\/$/, "")}/docs/how-it-works`,
    updatedAt: now.toISOString(),
  });
  const reviewId = `anr_${digest(`${input.operationKey}:${root}:v1`).slice(0, 32)}`;
  const publicationId = `pub_${digest(`${input.operationKey}:${root}:${evaluation.decision}:v1`).slice(0, 32)}`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_analytics_reviews
          (review_id, operation_key, review_version, decision, evidence_root, tier_mix_json, diversity_json, metrics_json, reason_codes_json, reviewed_at)
          VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (operation_key, review_version) DO NOTHING`,
    args: [
      reviewId,
      input.operationKey,
      evaluation.decision,
      root,
      stableTransparencyJson(evidence.tierMix),
      stableTransparencyJson(evidence.diversity),
      stableTransparencyJson(evidence.analytics),
      JSON.stringify(evaluation.reasonCodes),
      now,
    ],
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_result_publications
          (publication_id, operation_key, publication_version, verdict_status, evidence_root, result_json, published_at)
          VALUES (?, ?, 1, ?, ?, ?, ?) ON CONFLICT (operation_key, publication_version) DO NOTHING`,
    args: [publicationId, input.operationKey, evaluation.decision, root, JSON.stringify(result), now],
  });
  await dbClient.execute({
    sql: "UPDATE tokenless_agent_asks SET status = 'submitted', verdict_status = ?, result_json = ?, updated_at = ? WHERE operation_key = ?",
    args: [evaluation.decision, JSON.stringify(result), now, input.operationKey],
  });
  await enqueuePublicationWebhooks({
    publicationId,
    operationKey: input.operationKey,
    result,
    appOrigin: input.appOrigin,
    now,
  });
  return { evidenceRoot: root, publicationId, reasonCodes: evaluation.reasonCodes, result };
}

async function enqueuePublicationWebhooks(input: {
  publicationId: string;
  operationKey: string;
  result: TokenlessResult;
  appOrigin: string;
  now: Date;
}) {
  const subscriptions = await dbClient.execute({
    sql: `SELECT s.endpoint_id, s.event_types_json FROM tokenless_ask_webhook_subscriptions s
          JOIN tokenless_webhook_endpoints e ON e.endpoint_id = s.endpoint_id
          WHERE s.operation_key = ? AND e.active = true`,
    args: [input.operationKey],
  });
  for (const value of subscriptions.rows) {
    const row = value as Row;
    const events = new Set<string>(JSON.parse(rowString(row, "event_types_json") ?? "[]"));
    if (!events.has("result.ready")) continue;
    const endpointId = rowString(row, "endpoint_id")!;
    const idempotencyKey = `whd_${digest(`${endpointId}:${input.publicationId}:result.ready`).slice(0, 40)}`;
    const payload = {
      schemaVersion: TOKENLESS_SCHEMA_VERSION,
      eventId: input.publicationId,
      eventType: "result.ready",
      occurredAt: input.now.toISOString(),
      operationKey: input.operationKey,
      verdictStatus: input.result.verdictStatus,
      resultUrl: `${input.appOrigin.replace(/\/$/, "")}/api/agent/v1/results/${encodeURIComponent(input.operationKey)}`,
    };
    await dbClient.execute({
      sql: `INSERT INTO tokenless_webhook_deliveries
            (delivery_id, publication_id, endpoint_id, event_type, idempotency_key, payload_json, attempt_count, state, next_attempt_at, created_at, updated_at)
            VALUES (?, ?, ?, 'result.ready', ?, ?, 0, 'pending', ?, ?, ?)
            ON CONFLICT (idempotency_key) DO NOTHING`,
      args: [
        idempotencyKey,
        input.publicationId,
        endpointId,
        idempotencyKey,
        stableTransparencyJson(payload),
        input.now,
        input.now,
        input.now,
      ],
    });
  }
}

export async function deliverPendingWebhooks(
  input: {
    fetchImpl?: typeof fetch;
    now?: Date;
    limit?: number;
    encryptionKey?: string;
    resolveHostname?: ResolveHostname;
    operationKey?: string;
  } = {},
) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  const operationFilter = input.operationKey ? "AND p.operation_key = ?" : "";
  const due = await dbClient.execute({
    sql: `SELECT d.delivery_id, d.idempotency_key, d.payload_json, d.attempt_count,
                 e.url, e.secret_ciphertext
          FROM tokenless_webhook_deliveries d
          JOIN tokenless_webhook_endpoints e ON e.endpoint_id = d.endpoint_id
          JOIN tokenless_result_publications p ON p.publication_id = d.publication_id
          WHERE d.state IN ('pending', 'retry') AND d.next_attempt_at <= ? AND e.active = true
          ${operationFilter}
          ORDER BY d.next_attempt_at ASC LIMIT ?`,
    args: [now, ...(input.operationKey ? [input.operationKey] : []), Math.min(Math.max(input.limit ?? 25, 1), 100)],
  });
  const outcomes = [];
  for (const value of due.rows) {
    const row = value as Row;
    const deliveryId = rowString(row, "delivery_id")!;
    const claimed = await dbClient.execute({
      sql: `UPDATE tokenless_webhook_deliveries SET state = 'delivering', updated_at = ?
            WHERE delivery_id = ? AND state IN ('pending', 'retry')`,
      args: [now, deliveryId],
    });
    if (claimed.rowCount !== 1) continue;
    const payload = rowString(row, "payload_json")!;
    const timestamp = String(Math.floor(now.getTime() / 1_000));
    const signature = `v1=${createHmac(
      "sha256",
      decryptSecret(rowString(row, "secret_ciphertext")!, input.encryptionKey),
    )
      .update(`${timestamp}.${payload}`)
      .digest("hex")}`;
    const attempt = Number(row.attempt_count) + 1;
    try {
      await assertPublicWebhookDestination(rowString(row, "url")!, input.resolveHostname);
      const response = await fetchImpl(rowString(row, "url")!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "rateloop-delivery-id": rowString(row, "idempotency_key")!,
          "rateloop-signature": signature,
          "rateloop-timestamp": timestamp,
        },
        body: payload,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        await dbClient.execute({
          sql: `UPDATE tokenless_webhook_deliveries SET state = 'delivered', attempt_count = ?, response_status = ?, last_error = NULL, delivered_at = ?, updated_at = ? WHERE delivery_id = ?`,
          args: [attempt, response.status, now, now, deliveryId],
        });
        outcomes.push({ deliveryId, state: "delivered" });
        continue;
      }
      throw Object.assign(new Error(`HTTP ${response.status}`), { responseStatus: response.status });
    } catch (error) {
      const dead = attempt >= MAX_DELIVERY_ATTEMPTS;
      const delayMs = Math.min(30_000 * 2 ** (attempt - 1), 3_600_000);
      const message = error instanceof Error ? error.message.slice(0, 500) : "Delivery failed";
      const responseStatus = (error as { responseStatus?: number }).responseStatus ?? null;
      await dbClient.execute({
        sql: `UPDATE tokenless_webhook_deliveries SET state = ?, attempt_count = ?, response_status = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE delivery_id = ?`,
        args: [
          dead ? "dead" : "retry",
          attempt,
          responseStatus,
          message,
          new Date(now.getTime() + delayMs),
          now,
          deliveryId,
        ],
      });
      outcomes.push({ deliveryId, state: dead ? "dead" : "retry" });
    }
  }
  return outcomes;
}

export async function inspectWorkspaceTransparency(input: {
  accountAddress: string;
  workspaceId: string;
  operationKey: string;
}) {
  await requireWorkspaceMember(input.accountAddress, input.workspaceId);
  const ownership = await dbClient.execute({
    sql: "SELECT operation_key FROM tokenless_ask_ownership WHERE operation_key = ? AND workspace_id = ? LIMIT 1",
    args: [input.operationKey, input.workspaceId],
  });
  if (ownership.rows.length === 0) throw new TokenlessServiceError("Result not found.", 404, "result_not_found");
  const [events, reviews, publications, deliveries] = await Promise.all([
    dbClient.execute({
      sql: "SELECT event_id, sequence, event_type, deployment_key, round_id, evidence_hash, evidence_json, occurred_at, recorded_at FROM tokenless_transparency_events WHERE operation_key = ? ORDER BY sequence ASC",
      args: [input.operationKey],
    }),
    dbClient.execute({
      sql: "SELECT review_id, review_version, decision, evidence_root, tier_mix_json, diversity_json, metrics_json, reason_codes_json, reviewed_at FROM tokenless_analytics_reviews WHERE operation_key = ? ORDER BY review_version ASC",
      args: [input.operationKey],
    }),
    dbClient.execute({
      sql: "SELECT publication_id, publication_version, verdict_status, evidence_root, result_json, published_at FROM tokenless_result_publications WHERE operation_key = ? ORDER BY publication_version ASC",
      args: [input.operationKey],
    }),
    dbClient.execute({
      sql: `SELECT d.delivery_id, d.event_type, d.idempotency_key, d.attempt_count, d.state, d.next_attempt_at, d.response_status, d.last_error, d.delivered_at, e.url
                            FROM tokenless_webhook_deliveries d JOIN tokenless_result_publications p ON p.publication_id = d.publication_id
                            JOIN tokenless_webhook_endpoints e ON e.endpoint_id = d.endpoint_id
                            WHERE p.operation_key = ? ORDER BY d.created_at ASC`,
      args: [input.operationKey],
    }),
  ]);
  const parseJsonColumns = (rows: readonly Row[], columns: string[]) =>
    rows.map(row =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          columns.includes(key) && typeof value === "string"
            ? JSON.parse(value)
            : value instanceof Date
              ? value.toISOString()
              : value,
        ]),
      ),
    );
  return {
    operationKey: input.operationKey,
    events: parseJsonColumns(events.rows as Row[], ["evidence_json"]),
    analyticsReviews: parseJsonColumns(reviews.rows as Row[], [
      "tier_mix_json",
      "diversity_json",
      "metrics_json",
      "reason_codes_json",
    ]),
    publications: parseJsonColumns(publications.rows as Row[], ["result_json"]),
    webhookDeliveries: parseJsonColumns(deliveries.rows as Row[], []),
  };
}

export const __transparencyTestUtils = { decryptSecret, digest, encryptSecret, evidenceRoot };
