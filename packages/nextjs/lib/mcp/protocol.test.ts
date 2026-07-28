import assert from "node:assert/strict";
import { test } from "node:test";
import { TokenlessMcpToolError } from "~~/lib/mcp/errors";
import { dispatchTokenlessMcp, tokenlessMcpToolErrorResult } from "~~/lib/mcp/protocol";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

test("semantic service failures reach the agent with their exact status and code", () => {
  const mapped = tokenlessMcpToolErrorResult(
    new TokenlessServiceError("Result is not ready.", 409, "result_not_ready", true),
  );
  assert.equal(mapped?.isError, true);
  assert.deepEqual(mapped?.structuredContent, {
    code: "result_not_ready",
    message: "Result is not ready.",
    retryable: true,
    status: 409,
  });
});

test("tool errors keep their shape and unexpected failures stay internal", () => {
  const mapped = tokenlessMcpToolErrorResult(
    new TokenlessMcpToolError("The handoff bearer capability expired.", "handoff_expired"),
  );
  assert.equal(mapped?.isError, true);
  assert.deepEqual(mapped?.structuredContent, {
    code: "handoff_expired",
    message: "The handoff bearer capability expired.",
  });
  assert.equal(tokenlessMcpToolErrorResult(new Error("Unmapped failure.")), null);
});

test("an expired handoff status call is answered as a tool error, not a protocol error", async () => {
  const expiredSeconds = Math.floor(Date.now() / 1_000) - 3_600;
  const response = (await dispatchTokenlessMcp(
    {
      id: 7,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "rateloop_get_handoff_status",
        arguments: {
          handoffId: `rhl_${"a".repeat(32)}`,
          handoffToken: `rht_${"b".repeat(43)}_${expiredSeconds.toString(36)}`,
        },
      },
    },
    "https://rateloop-tokenless.vercel.app",
  )) as { result?: { isError?: boolean; structuredContent?: { code?: string } }; error?: unknown };
  assert.equal(response.error, undefined);
  assert.equal(response.result?.isError, true);
  assert.equal(response.result?.structuredContent?.code, "handoff_expired");
});
