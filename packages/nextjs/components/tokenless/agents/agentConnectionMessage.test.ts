import { buildAgentConnectionMessage } from "./agentConnectionMessage";
import assert from "node:assert/strict";
import test from "node:test";

test("connection message contains one intent URL and no operational credential instructions", () => {
  const connectionUrl = "https://rateloop-tokenless.example/connect/aci_123#claim=short-lived-claim";
  const message = buildAgentConnectionMessage({ connectionUrl });

  assert.match(message, /^Use RateLoop to connect this agent to my workspace and finish automatically in this task\./);
  assert.match(message, /Preserve this link privately/);
  assert.match(message, /Only interrupt me when the host actually presents an install, trust, or OAuth action/);
  assert.match(message, /After I approve it, refresh RateLoop once and continue/);
  assert.match(message, /never ask me to paste the link or approve the same action again/);
  assert.equal(message.match(/https:\/\//g)?.length, 1);
  assert.match(message, new RegExp(connectionUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(message, /Authorization header|Bearer|rlk_|access token|refresh token|environment variable/i);
  assert.doesNotMatch(message, /poll|heartbeat|restart/i);
});
