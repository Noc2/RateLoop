import "server-only";
import { TOKENLESS_MCP_PROTOCOL_VERSION, TOKENLESS_MCP_PROTOCOL_VERSIONS } from "~~/lib/mcp/protocol";
import {
  type AdaptiveReviewDecisionRequest,
  evaluateAdaptiveReviewRequirement,
  getAdaptiveAssuranceState,
} from "~~/lib/tokenless/adaptiveReviewService";
import type { ProductPrincipal } from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type JsonRecord = Record<string, unknown>;
type JsonRpcId = string | number | null;
type WorkspacePrincipal = Extract<ProductPrincipal, { kind: "api_key" }>;

const hashSchema = { pattern: "^sha256:[0-9a-f]{64}$", type: "string" } as const;
const identifierSchema = { maxLength: 160, minLength: 1, type: "string" } as const;

export const workspaceMcpTools = [
  {
    name: "rateloop_get_assurance_state",
    description:
      "Read the immutable agent-version scope's current review rate and source-derived human-agreement evidence. This tool cannot modify policy or evidence.",
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
        agentId: identifierSchema,
        agentVersionId: identifierSchema,
        policyId: identifierSchema,
        policyVersion: { minimum: 1, type: "integer" },
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
        "agentId",
        "agentVersionId",
        "policyId",
        "policyVersion",
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

async function callTool(principal: WorkspacePrincipal, name: string, args: unknown) {
  try {
    if (name === "rateloop_get_assurance_state") {
      const input = object(args);
      if (!input || typeof input.scopeId !== "string" || Object.keys(input).some(key => key !== "scopeId")) {
        throw new TokenlessServiceError("scopeId is required.", 400, "invalid_assurance_state_query");
      }
      return toolResult(await getAdaptiveAssuranceState({ principal, scopeId: input.scopeId }));
    }
    if (name === "rateloop_evaluate_review_requirement") {
      const input = object(args);
      if (!input)
        throw new TokenlessServiceError("Opportunity arguments are required.", 400, "invalid_review_opportunity");
      return toolResult(
        await evaluateAdaptiveReviewRequirement({
          principal,
          request: input as unknown as AdaptiveReviewDecisionRequest,
        }),
      );
    }
    return null;
  } catch (error) {
    if (error instanceof TokenlessServiceError) return toolError(error);
    throw error;
  }
}

export async function dispatchWorkspaceMcp(value: unknown, principal: WorkspacePrincipal) {
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
    const negotiatedVersion = TOKENLESS_MCP_PROTOCOL_VERSIONS.includes(params.protocolVersion as never)
      ? params.protocolVersion
      : TOKENLESS_MCP_PROTOCOL_VERSION;
    return response(id, {
      capabilities: { tools: {} },
      instructions:
        "This authenticated workspace surface reads assurance state and freezes policy decisions. It cannot mutate owner policy or source evidence.",
      protocolVersion: negotiatedVersion,
      serverInfo: { name: "rateloop-tokenless-workspace", version: "1.0.0" },
    });
  }
  if (request.method === "ping") return response(id, {});
  if (request.method === "tools/list") return response(id, { tools: workspaceMcpTools });
  if (request.method === "tools/call") {
    const params = object(request.params);
    if (!params || typeof params.name !== "string") return errorResponse(id, -32602, "Invalid tool call parameters.");
    const result = await callTool(principal, params.name, params.arguments ?? {});
    return result ? response(id, result) : errorResponse(id, -32602, "Unknown RateLoop workspace tool.");
  }
  return errorResponse(id, -32601, "Method not found");
}
