import type { RateLoopFrameworkPending } from "./approvalCore";

export const MCP_FORM_ELICITATION_PROTOCOL_VERSION = "2025-06-18" as const;

export type McpClientCapabilities = {
  elicitation?: Record<string, unknown>;
};

export type RateLoopMcpElicitationRequest = {
  method: "elicitation/create";
  params: {
    message: string;
    requestedSchema: {
      type: "object";
      properties: {
        approve: {
          type: "boolean";
          title: string;
          description: string;
        };
      };
      required: ["approve"];
    };
  };
};

export type McpElicitationResult =
  | { action: "accept"; content: { approve: boolean } }
  | { action: "decline" | "cancel" };

/**
 * Builds stable MCP form elicitation without embedding source, suggestion,
 * reviewer, credential, payment, or private-artifact data. A transport must be
 * able to originate and correlate server requests before sending it.
 */
export function createRateLoopMcpElicitation(input: {
  capabilities: McpClientCapabilities;
  pending: RateLoopFrameworkPending;
  protocolVersion: string;
}): RateLoopMcpElicitationRequest | null {
  if (
    input.protocolVersion !== MCP_FORM_ELICITATION_PROTOCOL_VERSION ||
    !input.capabilities.elicitation
  ) {
    return null;
  }
  return {
    method: "elicitation/create",
    params: {
      message: `RateLoop review ${input.pending.opportunityId} requires owner approval. Review the exact terms in RateLoop before accepting.`,
      requestedSchema: {
        type: "object",
        properties: {
          approve: {
            type: "boolean",
            title: "Approve RateLoop review",
            description:
              "Confirm only after reviewing the exact audience, timing, compensation, publication, and spend terms in RateLoop.",
          },
        },
        required: ["approve"],
      },
    },
  };
}

export function parseRateLoopMcpElicitation(
  value: unknown,
): "approved" | "declined" | "cancelled" {
  if (!value || typeof value !== "object" || !("action" in value)) {
    throw new Error("MCP elicitation result is invalid.");
  }
  if (value.action === "decline") return "declined";
  if (value.action === "cancel") return "cancelled";
  if (
    value.action === "accept" &&
    "content" in value &&
    value.content &&
    typeof value.content === "object" &&
    "approve" in value.content &&
    typeof value.content.approve === "boolean"
  ) {
    return value.content.approve ? "approved" : "declined";
  }
  throw new Error("MCP elicitation result is invalid.");
}
