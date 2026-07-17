import "server-only";
import { TokenlessMcpToolError } from "~~/lib/mcp/errors";
import {
  TOKENLESS_HANDOFF_VERSION,
  createMcpHandoff,
  getMcpHandoffResult,
  getMcpHandoffStatus,
} from "~~/lib/mcp/handoff";

export const TOKENLESS_MCP_PROTOCOL_VERSION = "2025-11-25" as const;
export const TOKENLESS_MCP_STABLE_PROTOCOL_VERSION = "2025-06-18" as const;
export const TOKENLESS_MCP_COMPAT_PROTOCOL_VERSION = "2025-03-26" as const;
export const TOKENLESS_MCP_PROTOCOL_VERSIONS = [
  TOKENLESS_MCP_PROTOCOL_VERSION,
  TOKENLESS_MCP_STABLE_PROTOCOL_VERSION,
  TOKENLESS_MCP_COMPAT_PROTOCOL_VERSION,
] as const;

type JsonRpcId = string | number | null;
type JsonRecord = Record<string, unknown>;

const emptyInputSchema = { additionalProperties: false, properties: {}, type: "object" } as const;
const readOnlyClosedAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
  readOnlyHint: true,
} as const;
const createHandoffAnnotations = {
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
  readOnlyHint: false,
} as const;
const bearerInputSchema = {
  additionalProperties: false,
  properties: {
    handoffId: { description: "Handoff identifier returned by rateloop_create_handoff.", type: "string" },
    handoffToken: {
      description: "Secret bearer capability returned by rateloop_create_handoff. Do not log or share it.",
      type: "string",
    },
  },
  required: ["handoffId", "handoffToken"],
  type: "object",
} as const;

const rationaleSchema = {
  oneOf: [
    {
      additionalProperties: false,
      properties: { mode: { const: "optional", type: "string" } },
      required: ["mode"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        maxLength: { maximum: 2_000, minimum: 1, type: "integer" },
        minLength: { minimum: 0, type: "integer" },
        mode: { const: "required", type: "string" },
      },
      required: ["mode", "maxLength"],
      type: "object",
    },
  ],
} as const;

const questionMediaSchema = {
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        items: {
          items: {
            additionalProperties: false,
            properties: {
              alt: { maxLength: 500, minLength: 1, type: "string" },
              assetId: { pattern: "^pqm_[A-Za-z0-9_-]{24,80}$", type: "string" },
              digest: { pattern: "^sha256:[0-9a-f]{64}$", type: "string" },
            },
            required: ["assetId", "digest", "alt"],
            type: "object",
          },
          maxItems: 4,
          minItems: 1,
          type: "array",
        },
        kind: { const: "images", type: "string" },
      },
      required: ["kind", "items"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        kind: { const: "youtube", type: "string" },
        videoId: { pattern: "^[A-Za-z0-9_-]{11}$", type: "string" },
      },
      required: ["kind", "videoId"],
      type: "object",
    },
  ],
} as const;

const questionSchema = {
  oneOf: [
    {
      additionalProperties: false,
      properties: {
        kind: { const: "binary", type: "string" },
        media: questionMediaSchema,
        negativeLabel: { maxLength: 200, minLength: 1, type: "string" },
        positiveLabel: { maxLength: 200, minLength: 1, type: "string" },
        prompt: { maxLength: 4_000, minLength: 1, type: "string" },
        rationale: rationaleSchema,
      },
      required: ["kind", "prompt", "rationale"],
      type: "object",
    },
    {
      additionalProperties: false,
      properties: {
        kind: { const: "head_to_head", type: "string" },
        media: questionMediaSchema,
        optionA: {
          additionalProperties: false,
          properties: {
            key: { maxLength: 200, minLength: 1, type: "string" },
            label: { maxLength: 200, minLength: 1, type: "string" },
          },
          required: ["key", "label"],
          type: "object",
        },
        optionB: {
          additionalProperties: false,
          properties: {
            key: { maxLength: 200, minLength: 1, type: "string" },
            label: { maxLength: 200, minLength: 1, type: "string" },
          },
          required: ["key", "label"],
          type: "object",
        },
        prompt: { maxLength: 4_000, minLength: 1, type: "string" },
        rationale: rationaleSchema,
      },
      required: ["kind", "prompt", "optionA", "optionB", "rationale"],
      type: "object",
    },
  ],
} as const;

export const tokenlessMcpTools = [
  {
    annotations: readOnlyClosedAnnotations,
    description:
      "Report the public RateLoop human-assurance handoff boundary, environment, and audience sources. This adapter does not expose quote, ask, upload, or payment APIs.",
    inputSchema: emptyInputSchema,
    name: "rateloop_capabilities",
    title: "Get RateLoop capabilities",
  },
  {
    annotations: createHandoffAnnotations,
    description:
      "Prepare a 24-hour browser handoff for public, synthetic, or safely redacted content. The returned URL and token are secret bearer capabilities; do not log, persist, or share them beyond the intended approver.",
    inputSchema: {
      additionalProperties: false,
      properties: {
        confirmedNoSensitiveData: {
          const: true,
          description:
            "Explicit confirmation that the handoff contains no secrets, personal data, or confidential material.",
          type: "boolean",
        },
        dataClassification: { enum: ["public", "synthetic", "redacted"], type: "string" },
        redactionSummary: { maxLength: 1_000, minLength: 10, type: "string" },
        request: {
          additionalProperties: false,
          properties: {
            audience: {
              additionalProperties: false,
              properties: {
                admissionPolicyHash: { pattern: "^0x[0-9a-fA-F]{64}$", type: "string" },
                source: {
                  enum: ["customer_invited", "rateloop_network", "hybrid"],
                  type: "string",
                },
              },
              required: ["admissionPolicyHash", "source"],
              type: "object",
            },
            budget: {
              additionalProperties: false,
              properties: {
                attemptReserveAtomic: { pattern: "^(0|[1-9][0-9]*)$", type: "string" },
                bountyAtomic: { pattern: "^[1-9][0-9]*$", type: "string" },
                feeBps: { maximum: 2_000, minimum: 0, type: "integer" },
              },
              required: ["attemptReserveAtomic", "bountyAtomic", "feeBps"],
              type: "object",
            },
            question: questionSchema,
            requestedPanelSize: { maximum: 500, minimum: 3, type: "integer" },
          },
          required: ["audience", "budget", "question", "requestedPanelSize"],
          type: "object",
        },
      },
      required: ["request", "dataClassification", "redactionSummary", "confirmedNoSensitiveData"],
      type: "object",
    },
    name: "rateloop_create_handoff",
    title: "Create human-assurance handoff",
  },
  {
    annotations: readOnlyClosedAnnotations,
    description:
      "Read handoff progress without starting or reconciling work. Requires the secret bearer token returned by rateloop_create_handoff.",
    inputSchema: bearerInputSchema,
    name: "rateloop_get_handoff_status",
    title: "Get handoff status",
  },
  {
    annotations: readOnlyClosedAnnotations,
    description:
      "Read the completed assurance result without starting or reconciling work. Requires the secret bearer token returned by rateloop_create_handoff.",
    inputSchema: bearerInputSchema,
    name: "rateloop_get_result",
    title: "Get assurance result",
  },
] as const;

function object(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function response(id: JsonRpcId, result: unknown) {
  return { id, jsonrpc: "2.0" as const, result };
}

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return {
    error: { code, ...(data === undefined ? {} : { data }), message },
    id,
    jsonrpc: "2.0" as const,
  };
}

function toolResult(value: unknown) {
  return {
    content: [{ text: JSON.stringify(value), type: "text" }],
    structuredContent: value,
  };
}

function toolErrorResult(error: TokenlessMcpToolError) {
  const value = { code: error.code, message: error.message };
  return { ...toolResult(value), isError: true };
}

export function tokenlessMcpCapabilities() {
  return {
    allowedAudienceSources: ["customer_invited", "rateloop_network", "hybrid"] as const,
    bodyLimitBytes: 64 * 1_024,
    handoffFragmentLimitBytes: 16 * 1_024,
    handoffTtlSeconds: 24 * 60 * 60,
    handoffVersion: TOKENLESS_HANDOFF_VERSION,
    note: "Only browser handoffs are exposed. Quote, ask, upload, payment, and legacy protocol tools are not available here.",
    protocolVersion: TOKENLESS_MCP_PROTOCOL_VERSION,
  };
}

async function callTool(name: unknown, args: unknown, origin: string) {
  try {
    if (name === "rateloop_capabilities") {
      const input = object(args);
      if (!input || Object.keys(input).length > 0) {
        throw new TokenlessMcpToolError("rateloop_capabilities accepts no arguments.", "invalid_params");
      }
      return toolResult(tokenlessMcpCapabilities());
    }
    if (name === "rateloop_create_handoff") return toolResult(createMcpHandoff(args, origin));
    if (name === "rateloop_get_handoff_status") return toolResult(await getMcpHandoffStatus(args));
    if (name === "rateloop_get_result") return toolResult(await getMcpHandoffResult(args));
    return null;
  } catch (error) {
    if (error instanceof TokenlessMcpToolError) return toolErrorResult(error);
    throw error;
  }
}

export async function dispatchTokenlessMcp(value: unknown, origin: string) {
  const request = object(value);
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
    return errorResponse(null, -32600, "Invalid Request");
  }

  const isNotification = !("id" in request);
  const id = isNotification
    ? null
    : typeof request.id === "string" || typeof request.id === "number" || request.id === null
      ? request.id
      : null;
  if (!isNotification && id === null && request.id !== null) return errorResponse(null, -32600, "Invalid Request");
  if (isNotification) return null;

  if (request.method === "initialize") {
    const params = object(request.params);
    if (!params || typeof params.protocolVersion !== "string")
      return errorResponse(id, -32602, "Missing MCP protocol version.");
    const negotiatedVersion = TOKENLESS_MCP_PROTOCOL_VERSIONS.includes(params.protocolVersion as never)
      ? params.protocolVersion
      : TOKENLESS_MCP_PROTOCOL_VERSION;
    return response(id, {
      capabilities: { tools: {} },
      instructions:
        "Use the four handoff tools only for public, synthetic, or safely redacted non-urgent human assurance. Handoff URLs and tokens are bearer capabilities.",
      protocolVersion: negotiatedVersion,
      serverInfo: { name: "rateloop-tokenless-handoff", version: "1.0.0" },
    });
  }
  if (request.method === "ping") return response(id, {});
  if (request.method === "tools/list") return response(id, { tools: tokenlessMcpTools });
  if (request.method === "tools/call") {
    const params = object(request.params);
    if (!params || typeof params.name !== "string") return errorResponse(id, -32602, "Invalid tool call parameters.");
    const result = await callTool(params.name, params.arguments ?? {}, origin);
    return result ? response(id, result) : errorResponse(id, -32602, "Unknown RateLoop tool.");
  }
  return errorResponse(id, -32601, "Method not found");
}
