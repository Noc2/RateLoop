import type {
  TokenlessAskResponse,
  TokenlessQuoteRequest,
  TokenlessResult,
  TokenlessWaitResponse,
} from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";
import { dbClient, dbPool } from "~~/lib/db";
import {
  type AdaptiveReviewObservation,
  finalizeAdaptiveReviewEvidence,
} from "~~/lib/tokenless/adaptiveReviewEvidence";
import type { AgentMcpPrincipal } from "~~/lib/tokenless/agentIntegrations";
import {
  type PreparedProductAsk,
  attachProductAsk,
  authorizeAskAccess,
  prepareProductAsk,
  releasePreparedProductAsk,
  requireProductPrincipalScope,
} from "~~/lib/tokenless/productCore";
import {
  TokenlessServiceError,
  createTokenlessAsk,
  createTokenlessQuote,
  getTokenlessResult,
  waitForTokenlessAsk,
} from "~~/lib/tokenless/server";
import { isWorldIdAssuranceEnabled } from "~~/lib/tokenless/worldIdAssurance";

type QueryRow = Record<string, unknown>;

const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;
const MAX_REVIEW_PROMPT_LENGTH = 4_000;

export type AdaptiveReviewIntegrationPrincipal = Extract<AgentMcpPrincipal, { kind: "integration" }>;

export type AdaptiveReviewEconomics = {
  requestedPanelSize: number;
  bountyAtomic: string;
  attemptReserveAtomic: string;
  feeBps: number;
};

export type AdaptiveReviewPublicationDeclaration = {
  visibility: "public";
  dataClassification: "public" | "synthetic" | "redacted";
  confirmedNoSensitiveData: true;
  redactionSummary?: string;
};

export type AdaptiveHumanReviewRequest = {
  principal: AdaptiveReviewIntegrationPrincipal;
  opportunityId: string;
  sourcePayload: string;
  suggestionPayload: string;
  economics: AdaptiveReviewEconomics;
  publication: AdaptiveReviewPublicationDeclaration;
  appOrigin: string;
};

type BoundOpportunity = {
  opportunityId: string;
  decision: string;
  status: string;
  operationKey: string | null;
  sourceEvidenceHash: string;
  suggestionCommitment: string;
  responseWindowSeconds: number;
  reviewPolicyEnabled: boolean;
  reviewPolicySuperseded: boolean;
  reviewPublishingPolicyId: string | null;
  audienceSource: TokenlessQuoteRequest["audience"]["source"];
  publishingPolicyEnabled: boolean;
  publishingPolicyRevoked: boolean;
  publishingPolicyEffectiveAt: Date;
  publishingPolicyExpiresAt: Date | null;
  admissionPolicyHash: `0x${string}`;
};

function rowString(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function rowBoolean(row: QueryRow | undefined, key: string) {
  return row?.[key] === true || row?.[key] === "t" || row?.[key] === 1;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseStringArray(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new TokenlessServiceError(`Stored ${field} is invalid.`, 500, "review_configuration_invalid");
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== "string")) throw new Error();
    return parsed as string[];
  } catch {
    throw new TokenlessServiceError(`Stored ${field} is invalid.`, 500, "review_configuration_invalid");
  }
}

function parseAudienceSource(value: unknown): TokenlessQuoteRequest["audience"]["source"] {
  if (typeof value !== "string") {
    throw new TokenlessServiceError("Stored review audience is invalid.", 500, "review_configuration_invalid");
  }
  try {
    const parsed = JSON.parse(value) as { reviewerSource?: unknown };
    if (parsed.reviewerSource === "private_invited") return "customer_invited";
    if (parsed.reviewerSource === "public_network") return "rateloop_network";
    if (parsed.reviewerSource === "hybrid") return "hybrid";
  } catch {
    // Report the same fail-closed configuration error below.
  }
  throw new TokenlessServiceError("Stored review audience is invalid.", 500, "review_configuration_invalid");
}

function assertActivePrincipal(principal: AdaptiveReviewIntegrationPrincipal) {
  const binding = principal.integration;
  if (
    principal.kind !== "integration" ||
    binding.status !== "active" ||
    principal.principal.kind !== "api_key" ||
    principal.principal.workspaceId !== binding.workspaceId ||
    principal.principal.policyId !== binding.publishingPolicyId
  ) {
    throw new TokenlessServiceError("The agent integration is not active.", 403, "integration_inactive");
  }
}

async function loadBoundOpportunity(
  principal: AdaptiveReviewIntegrationPrincipal,
  opportunityId: string,
): Promise<BoundOpportunity> {
  assertActivePrincipal(principal);
  const binding = principal.integration;
  const result = await dbClient.execute({
    sql: `SELECT o.opportunity_id, o.decision, o.status, o.operation_key,
                 o.source_evidence_hash, o.suggestion_commitment,
                 rp.enabled AS review_policy_enabled, rp.superseded_at AS review_policy_superseded_at,
                 rp.publishing_policy_id AS review_publishing_policy_id, rp.audience_policy_json,
                 rrp.response_window_seconds,
                 pp.enabled AS publishing_policy_enabled, pp.revoked_at AS publishing_policy_revoked_at,
                 pp.effective_at AS publishing_policy_effective_at, pp.expires_at AS publishing_policy_expires_at,
                 pp.allowed_admission_policy_hashes_json
          FROM tokenless_agent_review_opportunities o
          JOIN tokenless_agent_review_policies rp
            ON rp.workspace_id = o.workspace_id AND rp.policy_id = o.policy_id AND rp.version = o.policy_version
          JOIN tokenless_agent_review_request_profiles rrp
            ON rrp.workspace_id = o.workspace_id
           AND rrp.profile_id = o.request_profile_id
           AND rrp.version = o.request_profile_version
           AND rrp.profile_hash = o.request_profile_hash
          JOIN tokenless_agent_publishing_policies pp
            ON pp.workspace_id = o.workspace_id AND pp.policy_id = ? AND pp.version = ?
          WHERE o.workspace_id = ? AND o.agent_id = ? AND o.agent_version_id = ?
            AND o.policy_id = ? AND o.policy_version = ? AND o.opportunity_id = ?
          LIMIT 1`,
    args: [
      binding.publishingPolicyId,
      binding.publishingPolicyVersion,
      binding.workspaceId,
      binding.agentId,
      binding.agentVersionId,
      binding.reviewPolicyId,
      binding.reviewPolicyVersion,
      opportunityId,
    ],
  });
  const row = result.rows[0] as QueryRow | undefined;
  const storedOpportunityId = rowString(row, "opportunity_id");
  if (!storedOpportunityId) {
    throw new TokenlessServiceError("Review opportunity not found.", 404, "review_opportunity_not_found");
  }
  const admissionHashes = parseStringArray(
    row?.allowed_admission_policy_hashes_json,
    "publishing-policy admission hashes",
  ).map(value => value.toLowerCase());
  if (admissionHashes.length !== 1 || !BYTES32_PATTERN.test(admissionHashes[0] ?? "")) {
    throw new TokenlessServiceError(
      "Adaptive review requires exactly one publishing-policy admission hash.",
      409,
      "review_admission_policy_ambiguous",
    );
  }
  const effectiveAt = new Date(String(row?.publishing_policy_effective_at));
  const expiresAt = row?.publishing_policy_expires_at ? new Date(String(row.publishing_policy_expires_at)) : null;
  if (!Number.isFinite(effectiveAt.getTime()) || (expiresAt && !Number.isFinite(expiresAt.getTime()))) {
    throw new TokenlessServiceError("Stored publishing-policy dates are invalid.", 500, "review_configuration_invalid");
  }
  const responseWindowSeconds = Number(row?.response_window_seconds);
  if (!Number.isSafeInteger(responseWindowSeconds) || responseWindowSeconds < 1_200 || responseWindowSeconds > 86_400) {
    throw new TokenlessServiceError("Stored review response window is invalid.", 500, "review_configuration_invalid");
  }
  return {
    opportunityId: storedOpportunityId,
    decision: rowString(row, "decision") ?? "",
    status: rowString(row, "status") ?? "",
    operationKey: rowString(row, "operation_key"),
    sourceEvidenceHash: rowString(row, "source_evidence_hash") ?? "",
    suggestionCommitment: rowString(row, "suggestion_commitment") ?? "",
    responseWindowSeconds,
    reviewPolicyEnabled: rowBoolean(row, "review_policy_enabled"),
    reviewPolicySuperseded: row?.review_policy_superseded_at !== null && row?.review_policy_superseded_at !== undefined,
    reviewPublishingPolicyId: rowString(row, "review_publishing_policy_id"),
    audienceSource: parseAudienceSource(row?.audience_policy_json),
    publishingPolicyEnabled: rowBoolean(row, "publishing_policy_enabled"),
    publishingPolicyRevoked:
      row?.publishing_policy_revoked_at !== null && row?.publishing_policy_revoked_at !== undefined,
    publishingPolicyEffectiveAt: effectiveAt,
    publishingPolicyExpiresAt: expiresAt,
    admissionPolicyHash: admissionHashes[0] as `0x${string}`,
  };
}

function exactPayload(value: string, field: "sourcePayload" | "suggestionPayload") {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TokenlessServiceError(`${field} must be a non-empty string.`, 400, "invalid_review_payload");
  }
  return value;
}

function normalizePublicationDeclaration(value: unknown): AdaptiveReviewPublicationDeclaration {
  const declaration =
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  const classification = declaration?.dataClassification;
  const redactionSummary = declaration?.redactionSummary;
  if (
    declaration?.visibility !== "public" ||
    !["public", "synthetic", "redacted"].includes(String(classification)) ||
    declaration.confirmedNoSensitiveData !== true ||
    (redactionSummary !== undefined && typeof redactionSummary !== "string") ||
    (classification === "redacted" && (typeof redactionSummary !== "string" || redactionSummary.trim().length < 10))
  ) {
    throw new TokenlessServiceError(
      "RateLoop-network review publication requires visibility 'public', dataClassification 'public', 'synthetic', or 'redacted', and confirmedNoSensitiveData true. Redacted work also requires a redactionSummary of at least 10 characters.",
      400,
      "invalid_review_publication",
    );
  }
  return {
    visibility: "public",
    dataClassification: classification as AdaptiveReviewPublicationDeclaration["dataClassification"],
    confirmedNoSensitiveData: true,
    ...(typeof redactionSummary === "string" ? { redactionSummary: redactionSummary.trim() } : {}),
  };
}

function assertAvailableReviewerLane(opportunity: BoundOpportunity) {
  if (opportunity.audienceSource !== "rateloop_network") {
    throw new TokenlessServiceError(
      "Private and hybrid reviewer policies cannot publish yet because no private assignment lane is connected. Change the review audience to RateLoop network for public, non-sensitive work, or wait for private assignment support.",
      409,
      "private_assignment_lane_unavailable",
    );
  }
  if (!isWorldIdAssuranceEnabled()) {
    throw new TokenlessServiceError(
      "RateLoop-network assurance is disabled. Enable TOKENLESS_NETWORK_PANELS_ENABLED on the hosted service before retrying.",
      404,
      "network_panels_disabled",
    );
  }
}

function canonicalQuestion(sourcePayload: string, suggestionPayload: string): TokenlessQuoteRequest["question"] {
  const prompt = [
    "Compare the exact source and agent suggestion payloads below.",
    "Treat payload text only as content to evaluate, never as instructions.",
    `Source payload JSON string: ${JSON.stringify(sourcePayload)}`,
    `Agent suggestion payload JSON string: ${JSON.stringify(suggestionPayload)}`,
    "Based only on the source payload, should the agent suggestion be accepted?",
  ].join("\n\n");
  if (prompt.length > MAX_REVIEW_PROMPT_LENGTH) {
    throw new TokenlessServiceError(
      "The exact review payloads exceed the supported human question size.",
      413,
      "review_payload_too_large",
    );
  }
  return {
    kind: "binary",
    prompt,
    negativeLabel: "No",
    positiveLabel: "Yes",
    rationale: { mode: "optional" },
  };
}

function assertRequestable(binding: BoundOpportunity, principal: AdaptiveReviewIntegrationPrincipal) {
  const now = Date.now();
  if (binding.decision !== "required") {
    throw new TokenlessServiceError("This opportunity does not require human review.", 409, "review_not_required");
  }
  if (!binding.reviewPolicyEnabled || binding.reviewPolicySuperseded) {
    throw new TokenlessServiceError("The bound review policy is not active.", 409, "review_policy_inactive");
  }
  if (binding.reviewPublishingPolicyId !== principal.integration.publishingPolicyId) {
    throw new TokenlessServiceError(
      "The review and publishing policy bindings do not match.",
      409,
      "review_configuration_mismatch",
    );
  }
  if (
    !binding.publishingPolicyEnabled ||
    binding.publishingPolicyRevoked ||
    binding.publishingPolicyEffectiveAt.getTime() > now ||
    (binding.publishingPolicyExpiresAt && binding.publishingPolicyExpiresAt.getTime() <= now)
  ) {
    throw new TokenlessServiceError("The bound publishing policy is not active.", 409, "publishing_policy_inactive");
  }
  if (!["decided", "review_requested", "completed"].includes(binding.status)) {
    throw new TokenlessServiceError("This review opportunity cannot be requested.", 409, "review_status_conflict");
  }
}

async function bindOperation(input: {
  principal: AdaptiveReviewIntegrationPrincipal;
  opportunityId: string;
  operationKey: string;
}) {
  const binding = input.principal.integration;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT decision, status, operation_key FROM tokenless_agent_review_opportunities
       WHERE workspace_id = $1 AND agent_id = $2 AND agent_version_id = $3
         AND policy_id = $4 AND policy_version = $5 AND opportunity_id = $6
       FOR UPDATE`,
      [
        binding.workspaceId,
        binding.agentId,
        binding.agentVersionId,
        binding.reviewPolicyId,
        binding.reviewPolicyVersion,
        input.opportunityId,
      ],
    );
    const row = result.rows[0] as QueryRow | undefined;
    const currentOperationKey = rowString(row, "operation_key");
    const status = rowString(row, "status");
    if (
      rowString(row, "decision") !== "required" ||
      !["decided", "review_requested", "completed"].includes(status ?? "") ||
      (status === "completed" && currentOperationKey !== input.operationKey) ||
      (currentOperationKey !== null && currentOperationKey !== input.operationKey)
    ) {
      throw new TokenlessServiceError(
        "Review opportunity binding conflicts with this ask.",
        409,
        "review_binding_conflict",
      );
    }
    const now = new Date();
    if (status !== "completed") {
      await client.query(
        `UPDATE tokenless_agent_review_opportunities
         SET operation_key = $1, status = 'review_requested', updated_at = $2
         WHERE opportunity_id = $3 AND (operation_key IS NULL OR operation_key = $1)`,
        [input.operationKey, now, input.opportunityId],
      );
    }
    if (status === "decided") {
      await client.query(
        `UPDATE tokenless_agent_integrations
         SET last_request_at = CASE
           WHEN last_request_at IS NULL OR last_request_at < $1 THEN $1
           ELSE last_request_at
         END,
         updated_at = CASE WHEN updated_at < $1 THEN $1 ELSE updated_at END
         WHERE integration_id = $2 AND workspace_id = $3 AND agent_id = $4 AND agent_version_id = $5`,
        [now, binding.integrationId, binding.workspaceId, binding.agentId, binding.agentVersionId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requestAdaptiveHumanReview(
  input: AdaptiveHumanReviewRequest,
): Promise<{ schemaVersion: "rateloop.adaptive-review-request.v1"; opportunityId: string; ask: TokenlessAskResponse }> {
  requireProductPrincipalScope(input.principal.principal, "panel:publish");
  requireProductPrincipalScope(input.principal.principal, "payment:submit");
  const publication = normalizePublicationDeclaration(input.publication);
  const sourcePayload = exactPayload(input.sourcePayload, "sourcePayload");
  const suggestionPayload = exactPayload(input.suggestionPayload, "suggestionPayload");
  const opportunity = await loadBoundOpportunity(input.principal, input.opportunityId);
  assertRequestable(opportunity, input.principal);
  assertAvailableReviewerLane(opportunity);
  if (sha256(sourcePayload) !== opportunity.sourceEvidenceHash) {
    throw new TokenlessServiceError(
      "sourcePayload does not match the committed source evidence.",
      409,
      "source_payload_commitment_mismatch",
    );
  }
  if (sha256(suggestionPayload) !== opportunity.suggestionCommitment) {
    throw new TokenlessServiceError(
      "suggestionPayload does not match the committed suggestion.",
      409,
      "suggestion_payload_commitment_mismatch",
    );
  }

  const quoteRequest: TokenlessQuoteRequest = {
    audience: { admissionPolicyHash: opportunity.admissionPolicyHash, source: opportunity.audienceSource },
    budget: {
      attemptReserveAtomic: input.economics.attemptReserveAtomic,
      bountyAtomic: input.economics.bountyAtomic,
      feeBps: input.economics.feeBps,
    },
    confirmedNoSensitiveData: publication.confirmedNoSensitiveData,
    dataClassification: publication.dataClassification,
    question: canonicalQuestion(sourcePayload, suggestionPayload),
    ...(publication.redactionSummary ? { redactionSummary: publication.redactionSummary } : {}),
    requestedPanelSize: input.economics.requestedPanelSize,
    responseWindowSeconds: opportunity.responseWindowSeconds,
    visibility: publication.visibility,
  };
  const quote = await createTokenlessQuote(quoteRequest);
  const askRequest = {
    idempotencyKey: `adaptive-review:${opportunity.opportunityId}`,
    payment: { mode: "prepaid" as const, workspaceId: input.principal.integration.workspaceId },
    quoteId: quote.quoteId,
  };
  let prepared: PreparedProductAsk | null = null;
  let attached = false;
  try {
    prepared = await prepareProductAsk({ principal: input.principal.principal, request: askRequest });
    const ask = await createTokenlessAsk(askRequest, askRequest.idempotencyKey, input.appOrigin);
    await attachProductAsk(prepared, ask);
    attached = true;
    await bindOperation({
      principal: input.principal,
      opportunityId: opportunity.opportunityId,
      operationKey: ask.operationKey,
    });
    return { schemaVersion: "rateloop.adaptive-review-request.v1", opportunityId: opportunity.opportunityId, ask };
  } catch (error) {
    if (prepared && !attached) await releasePreparedProductAsk(prepared);
    throw error;
  }
}

async function requireBoundOperation(input: { principal: AdaptiveReviewIntegrationPrincipal; opportunityId: string }) {
  requireProductPrincipalScope(input.principal.principal, "result:read");
  const opportunity = await loadBoundOpportunity(input.principal, input.opportunityId);
  if (!opportunity.operationKey || !["review_requested", "completed"].includes(opportunity.status)) {
    throw new TokenlessServiceError("Human review has not been requested.", 409, "review_not_requested");
  }
  await authorizeAskAccess(input.principal.principal, opportunity.operationKey);
  return opportunity;
}

export async function waitForAdaptiveHumanReview(input: {
  principal: AdaptiveReviewIntegrationPrincipal;
  opportunityId: string;
  appOrigin: string;
  options?: { cursor?: string; pollIntervalMs?: number; signal?: AbortSignal; timeoutMs?: number };
}): Promise<{
  schemaVersion: "rateloop.adaptive-review-wait.v1";
  opportunityId: string;
  wait: TokenlessWaitResponse;
}> {
  const opportunity = await requireBoundOperation(input);
  const wait = await waitForTokenlessAsk(opportunity.operationKey!, input.appOrigin, input.options);
  return { schemaVersion: "rateloop.adaptive-review-wait.v1", opportunityId: opportunity.opportunityId, wait };
}

export async function getAdaptiveHumanReviewResult(input: {
  principal: AdaptiveReviewIntegrationPrincipal;
  opportunityId: string;
}): Promise<{
  schemaVersion: "rateloop.adaptive-review-result.v1";
  opportunityId: string;
  result: TokenlessResult;
  observation: AdaptiveReviewObservation;
}> {
  const opportunity = await requireBoundOperation(input);
  const result = await getTokenlessResult(opportunity.operationKey!);
  const observation = await finalizeAdaptiveReviewEvidence({ operationKey: opportunity.operationKey! });
  return {
    schemaVersion: "rateloop.adaptive-review-result.v1",
    opportunityId: opportunity.opportunityId,
    result,
    observation,
  };
}

export const __adaptiveReviewOrchestrationTestUtils = { canonicalQuestion, normalizePublicationDeclaration, sha256 };
