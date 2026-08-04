import { createHash } from "node:crypto";
import "server-only";

export type AgentProtocolFailure = {
  event: "agent_protocol_request_failed";
  endpoint: "oauth_token" | "workspace_mcp";
  method: "DELETE" | "GET" | "OPTIONS" | "POST";
  status: number;
  errorCode: string;
  errorDigest?: string;
};

const SAFE_ERROR_CODE = /^[A-Za-z][A-Za-z0-9_]{0,79}$/u;

/**
 * Emit one credential-free diagnostic for an OAuth or MCP failure.
 *
 * Request fields, bearer tokens, authorization codes, session IDs, and raw
 * exception messages are deliberately excluded. Unexpected failures receive
 * only a one-way digest so repeated infrastructure errors can be correlated.
 */
export function reportAgentProtocolFailure(
  input: Omit<AgentProtocolFailure, "errorCode" | "event" | "errorDigest"> & {
    errorCode: string;
    error?: unknown;
  },
  runtime: { report?: (failure: AgentProtocolFailure) => void } = {},
) {
  const errorCode = SAFE_ERROR_CODE.test(input.errorCode) ? input.errorCode : "invalid_error_code";
  const failure: AgentProtocolFailure = {
    event: "agent_protocol_request_failed",
    endpoint: input.endpoint,
    method: input.method,
    status: input.status,
    errorCode,
    ...(input.error === undefined
      ? {}
      : {
          errorDigest: `sha256:${createHash("sha256")
            .update(input.error instanceof Error ? `${input.error.name}:${input.error.message}` : typeof input.error)
            .digest("hex")}`,
        }),
  };
  (
    runtime.report ??
    (value => {
      const line = JSON.stringify(value);
      if (value.status >= 500) console.error(line);
      else console.info(line);
    })
  )(failure);
  return failure;
}
