import "server-only";
import { TOKENLESS_MCP_PROTOCOL_VERSION, TOKENLESS_MCP_PROTOCOL_VERSIONS } from "~~/lib/mcp/protocol";
import {
  getAdaptiveHumanReviewResult,
  requestAdaptiveHumanReview,
  waitForAdaptiveHumanReview,
} from "~~/lib/tokenless/adaptiveReviewOrchestration";
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
  submitAgentRegistration,
} from "~~/lib/tokenless/agentIntegrations";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type JsonRecord = Record<string, unknown>;
type JsonRpcId = string | number | null;

const hashSchema = { pattern: "^sha256:[0-9a-f]{64}$", type: "string" } as const;
const identifierSchema = { maxLength: 160, minLength: 1, type: "string" } as const;

export const pairingMcpTools = [
  {
    name: "rateloop_register_agent",
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
        deploymentName: { maxLength: 160, type: ["string", "null"] },
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
    description:
      "Call after registration and continue polling while owner approval is pending. After approval, refresh tools and call rateloop_get_agent_context. Never repeat the bearer credential in responses, logs, repositories, or ordinary tool arguments.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
] as const;

export const workspaceMcpTools = [
  {
    name: "rateloop_get_agent_context",
    description:
      "Read the agent, immutable version, review policy, enforcement mode, and workflows bound to this credential. Identity and policy are always derived server-side.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
  {
    name: "rateloop_get_assurance_state",
    description:
      "Read this integration's immutable agent-version scope review rate and source-derived human-agreement evidence. This tool cannot read another bound agent's scope.",
    inputSchema: {
      additionalProperties: false,
      properties: { scopeId: identifierSchema },
      required: ["scopeId"],
      type: "object",
    },
  },
  {
    name: "rateloop_evaluate_review_requirement",
    description:
      "Record one idempotent agent opportunity and receive the frozen owner-policy decision. Send commitments and an opaque evidence reference, never raw private content.",
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
      },
      required: [
        "externalOpportunityId",
        "workflowKey",
        "riskTier",
        "audiencePolicyHash",
        "suggestionCommitment",
        "sourceEvidence",
        "metadataComplete",
      ],
      type: "object",
    },
  },
  {
    name: "rateloop_request_review",
    description:
      "Create the canonical human yes/no review for a required frozen opportunity. Exact payload strings must match the earlier commitments.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        opportunityId: identifierSchema,
        sourcePayload: { maxLength: 3_000, minLength: 1, type: "string" },
        suggestionPayload: { maxLength: 3_000, minLength: 1, type: "string" },
        economics: {
          additionalProperties: false,
          properties: {
            requestedPanelSize: { maximum: 500, minimum: 3, type: "integer" },
            bountyAtomic: { pattern: "^[1-9][0-9]*$", type: "string" },
            attemptReserveAtomic: { pattern: "^(0|[1-9][0-9]*)$", type: "string" },
            feeBps: { maximum: 2_000, minimum: 0, type: "integer" },
          },
          required: ["requestedPanelSize", "bountyAtomic", "attemptReserveAtomic", "feeBps"],
          type: "object",
        },
      },
      required: ["opportunityId", "sourcePayload", "suggestionPayload", "economics"],
      type: "object",
    },
  },
  {
    name: "rateloop_wait_for_review",
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
    name: "rateloop_claim_connection_intent",
    description:
      "Claim the one-time RateLoop workspace connection URL supplied by the user. Pass the complete URL exactly once in this protected tool argument; never quote, log, fetch, or reproduce it elsewhere.",
    inputSchema: {
      additionalProperties: false,
      properties: { connectionUrl: { maxLength: 4_096, minLength: 1, type: "string" } },
      required: ["connectionUrl"],
      type: "object",
    },
  },
  {
    name: "rateloop_verify_connection",
    description:
      "Complete the safe connection test after loading agent context. This is non-evaluative and never creates review evidence.",
    inputSchema: { additionalProperties: false, properties: {}, type: "object" },
  },
] as const;

export const oauthWorkspaceMcpTools = [
  connectionIntentMcpTools[0],
  workspaceMcpTools[0],
  connectionIntentMcpTools[1],
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
          "deploymentName",
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
      return toolResult({
        schemaVersion: "rateloop.agent-context.v1",
        integrationId: binding.integrationId,
        workspaceId: binding.workspaceId,
        agentId: binding.agentId,
        agentVersionId: binding.agentVersionId,
        status: binding.status,
        enforcementMode: binding.enforcementMode,
        allowedWorkflowKeys: binding.allowedWorkflowKeys,
        reviewPolicy: { policyId: binding.reviewPolicyId, version: binding.reviewPolicyVersion },
        publishingPolicy:
          binding.publishingPolicyId && binding.publishingPolicyVersion
            ? { policyId: binding.publishingPolicyId, version: binding.publishingPolicyVersion }
            : null,
        safeAccess: {
          canCheckReviewRequirement: true,
          canSpend: binding.publishingPolicyId !== null,
          canPublish: binding.publishingPolicyId !== null,
          canReadPrivateArtifacts: false,
          canAdministerWorkspace: false,
        },
      });
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
        ["opportunityId", "sourcePayload", "suggestionPayload", "economics"],
        "Review request arguments are invalid.",
      );
      return toolResult(
        await requestAdaptiveHumanReview({
          principal,
          opportunityId: input.opportunityId as string,
          sourcePayload: input.sourcePayload as string,
          suggestionPayload: input.suggestionPayload as string,
          economics: input.economics as never,
          appOrigin: context.origin,
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
  context: { origin: string; signal?: AbortSignal },
) {
  try {
    if (name === "rateloop_claim_connection_intent") {
      const input = requireObjectWithKeys(args, ["connectionUrl"], "connectionUrl is required.");
      if (typeof input.connectionUrl !== "string") {
        throw new TokenlessServiceError("connectionUrl is required.", 400, "invalid_tool_arguments");
      }
      return toolResult(
        await claimAgentConnectionIntent({
          connectionUrl: input.connectionUrl,
          origin: context.origin,
          principal: principal.oauth,
        }),
      );
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
    if (name === "rateloop_request_review" && principal.integration.publishingPolicyId === null) {
      return toolError(
        new TokenlessServiceError(
          "This safe connection cannot publish or spend. A workspace administrator must grant a publishing policy first.",
          403,
          "publishing_not_enabled",
        ),
      );
    }
    return callIntegrationTool(integrationPrincipal, name, args, context);
  } catch (error) {
    if (error instanceof TokenlessServiceError) return toolError(error);
    throw error;
  }
}

export async function dispatchWorkspaceMcp(
  value: unknown,
  principal: AgentMcpPrincipal,
  context: { origin?: string; signal?: AbortSignal } = {},
) {
  const request = object(value);
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return errorResponse(null, -32600, "Invalid Request");
  }
  const notification = !("id" in request);
  const id = notification
    ? null
    : typeof request.id === "string" || typeof request.id === "number" || request.id === null
      ? request.id
      : null;
  if (!notification && id === null && request.id !== null) return errorResponse(null, -32600, "Invalid Request");
  if (notification) return null;
  if (request.method === "initialize") {
    const params = object(request.params);
    if (!params || typeof params.protocolVersion !== "string") {
      return errorResponse(id, -32602, "Missing MCP protocol version.");
    }
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
      } catch (error) {
        if (error instanceof TokenlessServiceError) {
          return errorResponse(id, -32000, error.message, { code: error.code, retryable: error.retryable });
        }
        throw error;
      }
    }
    const negotiatedVersion = TOKENLESS_MCP_PROTOCOL_VERSIONS.includes(params.protocolVersion as never)
      ? params.protocolVersion
      : TOKENLESS_MCP_PROTOCOL_VERSION;
    return response(id, {
      capabilities: { tools: {} },
      instructions:
        principal.kind === "pairing"
          ? "Act immediately without asking the user what this endpoint is for. List tools and call rateloop_register_agent exactly once using honest metadata inferred from the current runtime and work. Then call rateloop_get_registration_status while the owner reviews it. After approval, refresh tools and call rateloop_get_agent_context. Never repeat the bearer credential in responses, logs, repositories, or ordinary tool arguments. No workspace or review access exists before approval."
          : principal.kind === "oauth"
            ? principal.integration
              ? "A RateLoop workspace connection is available. Keep the complete connection URL private. Call rateloop_get_agent_context, then rateloop_verify_connection. After verification, follow the returned workflow and human-review policy. This safe connection cannot publish, spend, read private artifacts, or administer the workspace."
              : "Complete the user's one-time RateLoop connection now. Call rateloop_claim_connection_intent exactly once with the complete connection URL from the user's message. Never quote, log, fetch, or reproduce that URL. Then call rateloop_get_agent_context and rateloop_verify_connection without asking for another paste or creating a polling service."
            : "This registration is approved. Immediately call rateloop_get_agent_context and follow its bound policy. This credential is bound to one workspace agent, immutable version, and owner policy. Before each eligible output, call rateloop_evaluate_review_requirement and complete the review flow whenever it returns required; caller-supplied identity or policy identifiers are never trusted.",
      protocolVersion: negotiatedVersion,
      serverInfo: { name: "rateloop-tokenless-workspace", version: "1.0.0" },
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
