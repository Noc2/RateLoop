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
import {
  authenticateAgentMcpPrincipal,
  getAgentRegistrationStatus,
  recordPairingClientMetadata,
  submitAgentRegistration,
} from "~~/lib/tokenless/agentIntegrations";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type JsonRecord = Record<string, unknown>;
type JsonRpcId = string | number | null;
type AgentMcpPrincipal = Awaited<ReturnType<typeof authenticateAgentMcpPrincipal>>;

const hashSchema = { pattern: "^sha256:[0-9a-f]{64}$", type: "string" } as const;
const identifierSchema = { maxLength: 160, minLength: 1, type: "string" } as const;

export const pairingMcpTools = [
  {
    name: "rateloop_register_agent",
    description:
      "Submit this agent's declared identity, client metadata, and requested workflows for workspace-owner approval. The pairing credential grants no workspace or review access before approval.",
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
        environment: { enum: ["sandbox", "staging", "production"], type: "string" },
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
      "Read only this pairing request's approval status. Keep the bearer secret in MCP host configuration; never include it in prompts or tool arguments.",
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
        publishingPolicy: { policyId: binding.publishingPolicyId, version: binding.publishingPolicyVersion },
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
    if (principal.kind === "pairing") {
      const clientInfo = object(params.clientInfo);
      const capabilities = object(params.capabilities);
      if (
        !clientInfo ||
        typeof clientInfo.name !== "string" ||
        typeof clientInfo.version !== "string" ||
        !capabilities
      ) {
        return errorResponse(id, -32602, "Pairing initialization requires MCP clientInfo and capabilities.");
      }
      try {
        await recordPairingClientMetadata(principal, {
          clientName: clientInfo.name,
          clientVersion: clientInfo.version,
          clientCapabilities: Object.keys(capabilities).sort(),
        });
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
          ? "Submit declared agent metadata, then poll registration status while the workspace owner reviews it. Keep the bearer secret in MCP host configuration, never prompts or tool arguments. No workspace or review access exists before approval."
          : "This credential is bound to one workspace agent, immutable version, and owner policy. Ask RateLoop for a decision before each eligible output; caller-supplied identity or policy identifiers are never trusted.",
      protocolVersion: negotiatedVersion,
      serverInfo: { name: "rateloop-tokenless-workspace", version: "1.0.0" },
    });
  }
  if (request.method === "ping") return response(id, {});
  if (request.method === "tools/list") {
    return response(id, { tools: principal.kind === "pairing" ? pairingMcpTools : workspaceMcpTools });
  }
  if (request.method === "tools/call") {
    const params = object(request.params);
    if (!params || typeof params.name !== "string") return errorResponse(id, -32602, "Invalid tool call parameters.");
    const result =
      principal.kind === "pairing"
        ? await callPairingTool(principal, params.name, params.arguments ?? {})
        : await callIntegrationTool(principal, params.name, params.arguments ?? {}, {
            origin: context.origin ?? "http://localhost",
            ...(context.signal ? { signal: context.signal } : {}),
          });
    return result ? response(id, result) : errorResponse(id, -32602, "Unknown RateLoop workspace tool.");
  }
  return errorResponse(id, -32601, "Method not found");
}
