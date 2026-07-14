import { buildAgentConnectionMessage } from "./agentConnectionMessage";
import assert from "node:assert/strict";
import test from "node:test";

test("connection message tells a capable agent to configure, register, and continue without another prompt", () => {
  const message = buildAgentConnectionMessage({
    expiresAt: "2026-07-14T17:06:52.000Z",
    mcpUrl: "https://rateloop-tokenless.example/api/agent/v1/mcp",
    secret: "rlk_example_pairing_secret",
  });

  assert.match(message, /^Connect yourself to this RateLoop workspace now\./);
  assert.match(message, /Do not ask me what I want you to do with this endpoint/);
  assert.match(message, /Transport: Streamable HTTP/);
  assert.match(message, /Authorization header: Bearer rlk_example_pairing_secret/);
  assert.match(message, /Immediately call rateloop_register_agent exactly once/);
  assert.match(message, /rateloop_get_registration_status/);
  assert.match(message, /After approval, refresh the MCP tools and call rateloop_get_agent_context/);
  assert.match(message, /rateloop_evaluate_review_requirement/);
  assert.match(message, /single exact host-specific settings action/);
});
