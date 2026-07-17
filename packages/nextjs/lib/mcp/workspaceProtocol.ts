import "server-only";
import { TOKENLESS_MCP_PROTOCOL_VERSION, TOKENLESS_MCP_PROTOCOL_VERSIONS } from "~~/lib/mcp/protocol";
import {
  createWorkspaceMcpSession,
  enqueueOwnerApprovalElicitation,
  handleWorkspaceMcpElicitationResponse,
  requireWorkspaceMcpSession,
} from "~~/lib/mcp/workspaceElicitation";
import { getAdaptiveHumanReviewResult, waitForAdaptiveHumanReview } from "~~/lib/tokenless/adaptiveReviewOrchestration";
import {
  type AdaptiveReviewDecisionRequest,
  evaluateAdaptiveReviewRequirement,
  getAdaptiveAssuranceState,
} from "~~/lib/tokenless/adaptiveReviewService";
import { claimAgentConnectionIntent, verifyAgentConnection } from "~~/lib/tokenless/agentConnectionIntents";
import {
  type AgentMcpPrincipal,
  getAgentRegistrationStatus,
  recordOAuthAgentContextRead,
  recordOAuthMcpClientMetadata,
  recordPairingClientMetadata,
  rehydrateOAuthAgentMcpPrincipal,
  submitAgentRegistration,
} from "~~/lib/tokenless/agentIntegrations";
import { getEffectiveAgentReviewContext } from "~~/lib/tokenless/effectiveAgentReviewContext";
import { routeHumanReviewRequest } from "~~/lib/tokenless/humanReviewRequestRouter";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type JsonRecord = Record<string, unknown>;
type JsonRpcId = string | number | null;

const hashSchema = { pattern: "^sha256:[0-9a-f]{64}$", type: "string" } as const;
const identifierSchema = { maxLength: 160, minLength: 1, type: "string" } as const;
const nullableCountSchema = { maximum: 2_147_483_647, minimum: 0, type: ["integer", "null"] } as const;
const nullableTimestampSchema = { maxLength: 40, minLength: 20, type: ["string", "null"] } as const;
const generationSpanSchema = {
  additionalProperties: false,
  properties: {
    spanId: identifierSchema,
    parentSpanId: { maxLength: 160, minLength: 1, type: ["string", "null"] },
    role: { enum: ["primary", "subagent", "supporting"], type: "string" },
    provider: { maxLength: 120, minLength: 1, type: "string" },
    requestedModel: { maxLength: 200, minLength: 1, type: "string" },
    resolvedModel: { maxLength: 200, minLength: 1, type: ["string", "null"] },
    modelVersion: { maxLength: 160, minLength: 1, type: ["string", "null"] },
    reasoningEffort: { maxLength: 80, minLength: 1, type: ["string", "null"] },
    serviceTier: { maxLength: 80, minLength: 1, type: ["string", "null"] },
    startedAt: nullableTimestampSchema,
    completedAt: nullableTimestampSchema,
    timeToFirstOutputMs: nullableCountSchema,
    inputTokens: nullableCountSchema,
    cachedInputTokens: nullableCountSchema,
    outputTokens: nullableCountSchema,
    reasoningOutputTokens: nullableCountSchema,
    responseIdHash: { pattern: "^sha256:[0-9a-f]{64}$", type: ["string", "null"] },
    finishReason: { maxLength: 160, minLength: 1, type: ["string", "null"] },
  },
  required: ["spanId", "role", "provider", "requestedModel"],
  type: "object",
} as const;
const executionSchema = {
  additionalProperties: false,
  properties: {
    externalExecutionId: identifierSchema,
    status: { enum: ["completed", "failed"], type: "string" },
    startedAt: nullableTimestampSchema,
    completedAt: nullableTimestampSchema,
    toolCallCount: nullableCountSchema,
    toolDurationMs: nullableCountSchema,
    primarySpanId: identifierSchema,
    generationSpans: { items: generationSpanSchema, maxItems: 64, minItems: 1, type: "array" },
  },
  required: ["externalExecutionId", "status", "primarySpanId", "generationSpans"],
  type: "object",
} as const;
const publicReviewPublicationSchema = {
  additionalProperties: false,
  allOf: [
    {
      if: {
        properties: { dataClassification: { const: "redacted" } },
        required: ["dataClassification"],
      },
      then: { required: ["redactionSummary"] },
    },
  ],
  properties: {
    visibility: { enum: ["public"], type: "string" },
    dataClassification: { enum: ["public", "synthetic", "redacted"], type: "string" },
    confirmedNoSensitiveData: { enum: [true], type: "boolean" },
    redactionSummary: { maxLength: 1_000, minLength: 10, type: "string" },
  },
  required: ["visibility", "dataClassification", "confirmedNoSensitiveData"],
  type: "object",
} as const;
const perRequestBinaryQuestionSchema = {
  additionalProperties: false,
  properties: {
    kind: { const: "binary", type: "string" },
    prompt: { maxLength: 500, minLength: 1, type: "string" },
    positiveLabel: { maxLength: 40, minLength: 1, type: "string" },
    negativeLabel: { maxLength: 40, minLength: 1, type: "string" },
  },
  required: ["kind", "prompt", "positiveLabel", "negativeLabel"],
  type: "object",
} as const;
const readOnlyClosedAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const additiveClosedAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const idempotentAdditiveClosedAnnotations = {
  ...additiveClosedAnnotations,
  idempotentHint: true,
} as const;
const consequentialOpenAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

function boundWorkspaceInstructions() {
  return "Before each eligible output, call rateloop_get_agent_context and follow the returned exact human-review configuration, then call rateloop_evaluate_review_requirement with privacy-safe execution and generation metadata. Never send prompts, outputs, tool payloads, or hidden reasoning during evaluation. A publishing-policy reference alone never grants publication or spending authority; those actions are allowed only when safeAccess and the exact publishingGrant say so. This connection cannot read private artifacts or administer the workspace.";
}

export const pairingMcpTools = [
  {
    name: "rateloop_register_agent",
    annotations: additiveClosedAnnotations,
    description:
      "Call immediately after connecting, without waiting for another user instruction. Submit this agent's honest declared identity, client metadata, and requested workflows for workspace-owner approval. The pairing credential grants no workspace or review access before approval.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        externalId: identifierSchema,
        displayName: { maxLength: 120, minLength: 1, type: "string" },
        description: { maxLength: 1_000, type: ["string", "null"] },
        provider: { maxLength: 120, minLength: 1, type: "string" },
        model: { maxLength: 160, minLength: 1, type: "string" },
        modelVersion: { maxLength: 160, type: ["string", "null"] },
        environment: { enum: ["staging", "production"], type: "string" },
        requestedWorkflowKeys: {
          items: identifierSchema,
          maxItems: 32,
          minItems: 1,
          type: "array",
        },
      },
      required: ["externalId", "displayName", "provider", "model", "environment", "requestedWorkflowKeys"],
      type: "object",
    },
  },
  {
    name: "rateloop_get_registration_status",
    annotations: readOnlyClosedAnnotations,
    description:
      "Call after registration and continue polling while owner approval is pending. After approval, refresh tools and call rateloop_get_agent_context. Never repeat the bearer credential in responses, logs, repositories, or ordinary tool arguments.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
] as const;

export const workspaceMcpTools = [
  {
    name: "rateloop_get_agent_context",
    annotations: readOnlyClosedAnnotations,
    description:
      "Read the exact active agent version and effective human-review configuration bound server-side to this credential: selection frequency, request profile, audience and privacy boundary, response window, panel, compensation, authority, publishing grant and scopes, and implemented lane readiness.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
  {
    name: "rateloop_get_assurance_state",
    annotations: readOnlyClosedAnnotations,
    description:
      "Read this integration's workflow-version and execution-profile scope review rate with source-derived human-agreement evidence. This tool cannot read another bound agent's scope.",
    inputSchema: {
      additionalProperties: false,
      properties: { scopeId: identifierSchema },
      required: ["scopeId"],
      type: "object",
    },
  },
  {
    name: "rateloop_evaluate_review_requirement",
    annotations: idempotentAdditiveClosedAnnotations,
    description:
      "Record one idempotent agent opportunity with privacy-safe task/model provenance and receive the frozen owner-policy decision. Send model identifiers, timings, usage, commitments, and an opaque evidence reference; never send prompts, outputs, tool payloads, or hidden reasoning.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        externalOpportunityId: identifierSchema,
        workflowKey: identifierSchema,
        riskTier: { pattern: "^[a-z][a-z0-9_-]{0,63}$", type: "string" },
        audiencePolicyHash: hashSchema,
        suggestionCommitment: hashSchema,
        sourceEvidence: {
          additionalProperties: false,
          properties: {
            reference: { maxLength: 240, minLength: 1, type: "string" },
            hash: hashSchema,
          },
          required: ["reference", "hash"],
          type: "object",
        },
        declaredConfidenceBps: { maximum: 10_000, minimum: 0, type: ["integer", "null"] },
        criticalRisk: { type: "boolean" },
        metadataComplete: { type: "boolean" },
        execution: executionSchema,
      },
      required: [
        "externalOpportunityId",
        "workflowKey",
        "riskTier",
        "audiencePolicyHash",
        "suggestionCommitment",
        "sourceEvidence",
        "metadataComplete",
        "execution",
      ],
      type: "object",
    },
  },
  {
    name: "rateloop_request_review",
    annotations: consequentialOpenAnnotations,
    description:
      "Route a required frozen opportunity using its exact owner-bound authority and lane. Check-only records the requirement without preparing, publishing, assigning, reserving, or spending. Prepare-for-approval creates only an immutable owner approval. Automatic routing requires the exact active grant. The bound profile either forbids question overrides or requires one binary agent-written question for this public-network request; RateLoop always derives the panel, response window, bounty, fee, and accepted-work reserve.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        opportunityId: identifierSchema,
        sourcePayload: { maxLength: 3_000, minLength: 1, type: "string" },
        suggestionPayload: { maxLength: 3_000, minLength: 1, type: "string" },
        question: perRequestBinaryQuestionSchema,
        material: {
          oneOf: [
            {
              additionalProperties: false,
              properties: {
                kind: { const: "public", type: "string" },
                publication: publicReviewPublicationSchema,
              },
              required: ["kind", "publication"],
              type: "object",
            },
            {
              additionalProperties: false,
              properties: {
                kind: { const: "private", type: "string" },
                sourceContentType: { maxLength: 160, minLength: 1, type: "string" },
                suggestionContentType: { maxLength: 160, minLength: 1, type: "string" },
              },
              required: ["kind", "sourceContentType", "suggestionContentType"],
              type: "object",
            },
          ],
        },
      },
      required: ["opportunityId", "sourcePayload", "suggestionPayload"],
      type: "object",
    },
  },
  {
    name: "rateloop_wait_for_review",
    annotations: readOnlyClosedAnnotations,
    description: "Wait briefly for this integration's bound human review without accepting an arbitrary operation ID.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        opportunityId: identifierSchema,
        cursor: { pattern: "^[0-9]{1,16}$", type: ["string", "null"] },
        timeoutMs: { maximum: 60_000, minimum: 1, type: "integer" },
      },
      required: ["opportunityId"],
      type: "object",
    },
  },
  {
    name: "rateloop_get_review_result",
    annotations: readOnlyClosedAnnotations,
    description: "Read the terminal server-stored human result for this integration's bound opportunity.",
    inputSchema: {
      additionalProperties: false,
      properties: { opportunityId: identifierSchema },
      required: ["opportunityId"],
      type: "object",
    },
  },
] as const;

const connectionIntentMcpTools = [
  {
    name: "rateloop_connect_workspace",
    annotations: idempotentAdditiveClosedAnnotations,
    description:
      "Preferred one-call workspace connection. Idempotently claim the complete private connection URL, load the newly bound canonical agent context, and verify the safe connection. The URL is accepted only as a protected argument and is never returned.",
    inputSchema: {
      additionalProperties: false,
      properties: { connectionUrl: { maxLength: 4_096, minLength: 1, type: "string" } },
      required: ["connectionUrl"],
      type: "object",
    },
  },
  {
    name: "rateloop_claim_connection_intent",
    annotations: idempotentAdditiveClosedAnnotations,
    description:
      "Idempotently add the pre-authorized safe workspace connection requested by the user. This cannot spend, publish, read private artifacts, or administer the workspace. Pass the complete URL exactly once in this protected tool argument; never quote, log, fetch, or reproduce it elsewhere.",
    inputSchema: {
      additionalProperties: false,
      properties: { connectionUrl: { maxLength: 4_096, minLength: 1, type: "string" } },
      required: ["connectionUrl"],
      type: "object",
    },
  },
  {
    name: "rateloop_verify_connection",
    annotations: idempotentAdditiveClosedAnnotations,
    description:
      "Idempotently complete the safe connection test after loading agent context. This is non-evaluative and never creates review evidence, content, spending, or publishing state.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
] as const;

export const oauthWorkspaceMcpTools = [
  connectionIntentMcpTools[0],
  connectionIntentMcpTools[1],
  workspaceMcpTools[0],
  connectionIntentMcpTools[2],
  ...workspaceMcpTools.slice(1),
] as const;

function object(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function response(id: JsonRpcId, result: unknown) {
  return { id, jsonrpc: "2.0" as const, result };
}

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { error: { code, message, ...(data === undefined ? {} : { data }) }, id, jsonrpc: "2.0" as const };
}

function toolResult(value: unknown) {
  return { content: [{ text: JSON.stringify(value), type: "text" }], structuredContent: value };
}

function toolError(error: TokenlessServiceError) {
  const value = { code: error.code, message: error.message, retryable: error.retryable };
  return { ...toolResult(value), isError: true };
}

function requireObjectWithKeys(args: unknown, allowed: readonly string[], message: string) {
  const input = object(args);
  if (!input || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new TokenlessServiceError(message, 400, "invalid_tool_arguments");
  }
  return input;
}

function reviewMaterial(value: unknown, origin: string) {
  const material = object(value);
  if (!material) return undefined;
  if (material.kind === "public") {
    const exact = requireObjectWithKeys(material, ["kind", "publication"], "Public review material is invalid.");
    return { kind: "public" as const, publication: exact.publication as never, appOrigin: origin };
  }
  if (material.kind === "private") {
    const exact = requireObjectWithKeys(
      material,
      ["kind", "sourceContentType", "suggestionContentType"],
      "Private review material is invalid.",
    );
    if (typeof exact.sourceContentType !== "string" || typeof exact.suggestionContentType !== "string") {
      throw new TokenlessServiceError("Private review content types are required.", 400, "invalid_tool_arguments");
    }
    return {
      kind: "private" as const,
      sourceContentType: exact.sourceContentType,
      suggestionContentType: exact.suggestionContentType,
    };
  }
  throw new TokenlessServiceError("Review material lane is invalid.", 400, "invalid_tool_arguments");
}

async function callPairingTool(
  principal: Extract<AgentMcpPrincipal, { kind: "pairing" }>,
  name: string,
  args: unknown,
) {
  try {
    if (name === "rateloop_register_agent") {
      const input = requireObjectWithKeys(
        args,
        [
          "externalId",
          "displayName",
          "description",
          "provider",
          "model",
          "modelVersion",
          "environment",
          "requestedWorkflowKeys",
        ],
        "Registration arguments are invalid.",
      );
      return toolResult(await submitAgentRegistration({ pairing: principal, registration: input as never }));
    }
    if (name === "rateloop_get_registration_status") {
      requireObjectWithKeys(args, [], "Registration status arguments are invalid.");
      return toolResult(await getAgentRegistrationStatus(principal));
    }
    return null;
  } catch (error) {
    if (error instanceof TokenlessServiceError) return toolError(error);
    throw error;
  }
}

async function callIntegrationTool(
  principal: Extract<AgentMcpPrincipal, { kind: "integration" }>,
  name: string,
  args: unknown,
  context: { origin: string; signal?: AbortSignal },
) {
  try {
    const binding = principal.integration;
    if (name === "rateloop_get_registration_status") {
      requireObjectWithKeys(args, [], "Registration status arguments are invalid.");
      return toolResult({
        registration: { status: "approved" },
        integration: {
          integrationId: binding.integrationId,
          workspaceId: binding.workspaceId,
          agentId: binding.agentId,
          agentVersionId: binding.agentVersionId,
        },
        nextAction: "Refresh the MCP tool list now, then call rateloop_get_agent_context and follow its bound policy.",
      });
    }
    if (name === "rateloop_get_agent_context") {
      requireObjectWithKeys(args, [], "Agent context arguments are invalid.");
      return toolResult(await getEffectiveAgentReviewContext(principal));
    }
    if (name === "rateloop_get_assurance_state") {
      const input = requireObjectWithKeys(args, ["scopeId"], "scopeId is required.");
      if (typeof input.scopeId !== "string") {
        throw new TokenlessServiceError("scopeId is required.", 400, "invalid_assurance_state_query");
      }
      const state = await getAdaptiveAssuranceState({ principal: principal.principal, scopeId: input.scopeId });
      if (
        state.agentId !== binding.agentId ||
        state.agentVersionId !== binding.agentVersionId ||
        state.policyId !== binding.reviewPolicyId ||
        state.policyVersion !== binding.reviewPolicyVersion
      ) {
        throw new TokenlessServiceError("Assurance state not found.", 404, "assurance_state_not_found");
      }
      return toolResult(state);
    }
    if (name === "rateloop_evaluate_review_requirement") {
      const input = requireObjectWithKeys(
        args,
        [
          "externalOpportunityId",
          "workflowKey",
          "riskTier",
          "audiencePolicyHash",
          "suggestionCommitment",
          "sourceEvidence",
          "declaredConfidenceBps",
          "criticalRisk",
          "metadataComplete",
          "execution",
        ],
        "Opportunity arguments are invalid.",
      );
      if (
        typeof input.workflowKey === "string" &&
        binding.allowedWorkflowKeys.length > 0 &&
        !binding.allowedWorkflowKeys.includes(input.workflowKey)
      ) {
        throw new TokenlessServiceError(
          "This workflow is not allowed for the integration.",
          403,
          "workflow_not_allowed",
        );
      }
      return toolResult(
        await evaluateAdaptiveReviewRequirement({
          principal: principal.principal,
          integrationId: binding.integrationId,
          request: {
            ...input,
            agentId: binding.agentId,
            agentVersionId: binding.agentVersionId,
            policyId: binding.reviewPolicyId,
            policyVersion: binding.reviewPolicyVersion,
          } as unknown as AdaptiveReviewDecisionRequest,
        }),
      );
    }
    if (name === "rateloop_request_review") {
      const input = requireObjectWithKeys(
        args,
        ["opportunityId", "sourcePayload", "suggestionPayload", "question", "material"],
        "Review request arguments are invalid.",
      );
      return toolResult(
        await routeHumanReviewRequest({
          principal,
          opportunityId: input.opportunityId as string,
          sourcePayload: input.sourcePayload as string,
          suggestionPayload: input.suggestionPayload as string,
          ...(input.question === undefined ? {} : { question: input.question }),
          material: reviewMaterial(input.material, context.origin),
        }),
      );
    }
    if (name === "rateloop_wait_for_review") {
      const input = requireObjectWithKeys(
        args,
        ["opportunityId", "cursor", "timeoutMs"],
        "Review wait arguments are invalid.",
      );
      return toolResult(
        await waitForAdaptiveHumanReview({
          principal,
          opportunityId: input.opportunityId as string,
          appOrigin: context.origin,
          options: {
            ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}),
            ...(typeof input.timeoutMs === "number" ? { timeoutMs: input.timeoutMs } : {}),
            ...(context.signal ? { signal: context.signal } : {}),
          },
        }),
      );
    }
    if (name === "rateloop_get_review_result") {
      const input = requireObjectWithKeys(args, ["opportunityId"], "Review result arguments are invalid.");
      return toolResult(
        await getAdaptiveHumanReviewResult({ principal, opportunityId: input.opportunityId as string }),
      );
    }
    return null;
  } catch (error) {
    if (error instanceof TokenlessServiceError) return toolError(error);
    throw error;
  }
}

function connectionNotReady(message = "Claim the RateLoop connection URL before using workspace tools.") {
  return toolError(new TokenlessServiceError(message, 409, "connection_not_ready", true));
}

async function callOAuthTool(
  principal: Extract<AgentMcpPrincipal, { kind: "oauth" }>,
  name: string,
  args: unknown,
  context: {
    origin: string;
    mcpSessionHash?: string;
    protocolVersion?: string;
    sessionId?: string;
    signal?: AbortSignal;
  },
) {
  try {
    if (name === "rateloop_connect_workspace" || name === "rateloop_claim_connection_intent") {
      const input = requireObjectWithKeys(args, ["connectionUrl"], "connectionUrl is required.");
      if (typeof input.connectionUrl !== "string") {
        throw new TokenlessServiceError("connectionUrl is required.", 400, "invalid_tool_arguments");
      }
      if (!context.mcpSessionHash) {
        throw new TokenlessServiceError("MCP-Session-Id is required.", 400, "mcp_session_required");
      }
      const claim = await claimAgentConnectionIntent({
        connectionUrl: input.connectionUrl,
        mcpSessionHash: context.mcpSessionHash,
        origin: context.origin,
        principal: principal.oauth,
      });
      if (name === "rateloop_claim_connection_intent") return toolResult(claim);
      const rehydrated = await rehydrateOAuthAgentMcpPrincipal(principal.oauth);
      if (!rehydrated.integration || !rehydrated.principal) {
        throw new TokenlessServiceError(
          "The claimed workspace connection is not ready. Retry this same connection call.",
          409,
          "connection_not_ready",
          true,
        );
      }
      const integrationPrincipal: Extract<AgentMcpPrincipal, { kind: "integration" }> = {
        kind: "integration",
        principal: rehydrated.principal,
        integration: rehydrated.integration,
      };
      const agentContext = await getEffectiveAgentReviewContext(integrationPrincipal);
      await recordOAuthAgentContextRead(rehydrated);
      const verification = await verifyAgentConnection({
        principal: rehydrated.oauth,
        integrationId: rehydrated.integration.integrationId,
      });
      return toolResult({
        schemaVersion: "rateloop.workspace-connection.v1",
        connected: true,
        idempotent: claim.idempotent,
        connection: verification.connection,
        context: agentContext,
        verification,
        nextAction: "follow_bound_policy",
      });
    }
    if (!principal.integration || !principal.principal) return connectionNotReady();
    const integrationPrincipal: Extract<AgentMcpPrincipal, { kind: "integration" }> = {
      kind: "integration",
      principal: principal.principal,
      integration: principal.integration,
    };
    if (name === "rateloop_get_agent_context") {
      const result = await callIntegrationTool(integrationPrincipal, name, args, context);
      await recordOAuthAgentContextRead(principal);
      return result;
    }
    if (name === "rateloop_verify_connection") {
      requireObjectWithKeys(args, [], "Connection verification arguments are invalid.");
      return toolResult(
        await verifyAgentConnection({
          principal: principal.oauth,
          integrationId: principal.integration.integrationId,
        }),
      );
    }
    if (principal.connectionStatus !== "connected") {
      return connectionNotReady("Load agent context and verify this connection before using review tools.");
    }
    const result = await callIntegrationTool(integrationPrincipal, name, args, context);
    if (
      name === "rateloop_request_review" &&
      context.sessionId &&
      context.protocolVersion &&
      result?.structuredContent
    ) {
      await enqueueOwnerApprovalElicitation({
        sessionId: context.sessionId,
        principal,
        protocolVersion: context.protocolVersion,
        result: result.structuredContent as never,
      });
    }
    return result;
  } catch (error) {
    if (error instanceof TokenlessServiceError) return toolError(error);
    throw error;
  }
}

export async function dispatchWorkspaceMcp(
  value: unknown,
  principal: AgentMcpPrincipal,
  context: {
    initializeSessionId?: string;
    origin?: string;
    protocolVersion?: string;
    sessionId?: string;
    signal?: AbortSignal;
  } = {},
) {
  const request = object(value);
  if (!request || request.jsonrpc !== "2.0") {
    return errorResponse(null, -32600, "Invalid Request");
  }
  if (typeof request.method !== "string") {
    if (
      context.sessionId &&
      ("result" in request || "error" in request) &&
      (typeof request.id === "string" || typeof request.id === "number")
    ) {
      await handleWorkspaceMcpElicitationResponse({
        sessionId: context.sessionId,
        principal,
        protocolVersion: context.protocolVersion ?? "",
        response: request,
      });
      return null;
    }
    return errorResponse(null, -32600, "Invalid Request");
  }
  const notification = !("id" in request);
  const id = notification ? null : typeof request.id === "string" || typeof request.id === "number" ? request.id : null;
  if (!notification && id === null) return errorResponse(null, -32600, "Invalid Request");
  let mcpSessionHash: string | undefined;
  if (request.method !== "initialize" && principal.kind === "oauth") {
    if (!context.sessionId) {
      throw new TokenlessServiceError("MCP-Session-Id is required.", 400, "mcp_session_required");
    }
    const session = await requireWorkspaceMcpSession({
      sessionId: context.sessionId,
      principal,
      protocolVersion: context.protocolVersion ?? "",
    });
    mcpSessionHash = session.sessionHash;
  }
  if (notification) return null;
  if (request.method === "initialize") {
    const params = object(request.params);
    if (!params || typeof params.protocolVersion !== "string") {
      return errorResponse(id, -32602, "Missing MCP protocol version.");
    }
    const negotiatedVersion = TOKENLESS_MCP_PROTOCOL_VERSIONS.includes(params.protocolVersion as never)
      ? params.protocolVersion
      : TOKENLESS_MCP_PROTOCOL_VERSION;
    if (principal.kind === "pairing" || principal.kind === "oauth") {
      const clientInfo = object(params.clientInfo);
      const capabilities = object(params.capabilities);
      if (
        !clientInfo ||
        typeof clientInfo.name !== "string" ||
        typeof clientInfo.version !== "string" ||
        !capabilities
      ) {
        return errorResponse(id, -32602, "Workspace initialization requires MCP clientInfo and capabilities.");
      }
      try {
        const metadata = {
          clientName: clientInfo.name,
          clientVersion: clientInfo.version,
          clientCapabilities: Object.keys(capabilities).sort(),
        };
        if (principal.kind === "pairing") await recordPairingClientMetadata(principal, metadata);
        else await recordOAuthMcpClientMetadata(principal, metadata);
        if (context.initializeSessionId) {
          await createWorkspaceMcpSession({
            sessionId: context.initializeSessionId,
            principal,
            clientInfo,
            capabilities,
            protocolVersion: negotiatedVersion,
          });
        }
      } catch (error) {
        if (error instanceof TokenlessServiceError) {
          return errorResponse(id, -32000, error.message, { code: error.code, retryable: error.retryable });
        }
        throw error;
      }
    }
    return response(id, {
      capabilities: { tools: {} },
      instructions:
        principal.kind === "pairing"
          ? "Act immediately without asking the user what this endpoint is for. List tools and call rateloop_register_agent exactly once using honest metadata inferred from the current runtime and work. Then call rateloop_get_registration_status while the owner reviews it. After approval, refresh tools and call rateloop_get_agent_context. Never repeat the bearer credential in responses, logs, repositories, or ordinary tool arguments. No workspace or review access exists before approval."
          : principal.kind === "oauth"
            ? principal.integration
              ? `A RateLoop workspace connection is available. Keep the complete connection URL private. Call rateloop_get_agent_context, then rateloop_verify_connection. After verification, follow the returned workflow and human-review policy. ${boundWorkspaceInstructions()}`
              : "Complete the user's one-time RateLoop connection now. Prefer one rateloop_connect_workspace call with the complete connection URL from the user's message. Never quote, log, fetch, or reproduce that URL. If the preferred tool is unavailable, use rateloop_claim_connection_intent, rateloop_get_agent_context, and rateloop_verify_connection as the granular fallback without asking for another paste or creating a polling service."
            : `This registration is approved. Immediately call rateloop_get_agent_context and follow its bound policy. This credential is bound to one workspace agent, immutable workflow version, and owner policy. ${boundWorkspaceInstructions()} Caller-supplied identity or policy identifiers are never trusted.`,
      protocolVersion: negotiatedVersion,
      serverInfo: { name: "rateloop-tokenless-workspace", version: "1.2.0" },
    });
  }
  if (request.method === "ping") return response(id, {});
  if (request.method === "tools/list") {
    return response(id, {
      tools:
        principal.kind === "pairing"
          ? pairingMcpTools
          : principal.kind === "oauth"
            ? oauthWorkspaceMcpTools
            : workspaceMcpTools,
    });
  }
  if (request.method === "tools/call") {
    const params = object(request.params);
    if (!params || typeof params.name !== "string") return errorResponse(id, -32602, "Invalid tool call parameters.");
    const toolContext = {
      origin: context.origin ?? "http://localhost",
      ...(mcpSessionHash ? { mcpSessionHash } : {}),
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      ...(context.protocolVersion ? { protocolVersion: context.protocolVersion } : {}),
      ...(context.signal ? { signal: context.signal } : {}),
    };
    const result =
      principal.kind === "pairing"
        ? await callPairingTool(principal, params.name, params.arguments ?? {})
        : principal.kind === "oauth"
          ? await callOAuthTool(principal, params.name, params.arguments ?? {}, toolContext)
          : await callIntegrationTool(principal, params.name, params.arguments ?? {}, toolContext);
    return result ? response(id, result) : errorResponse(id, -32602, "Unknown RateLoop workspace tool.");
  }
  return errorResponse(id, -32601, "Method not found");
}
