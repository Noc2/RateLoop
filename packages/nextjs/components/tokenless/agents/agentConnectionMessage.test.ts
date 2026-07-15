import { buildAgentConnectionMessage } from "./agentConnectionMessage";
import assert from "node:assert/strict";
import test from "node:test";

test("connection message contains one intent URL and no operational credential instructions", () => {
  const connectionUrl = "https://rateloop-tokenless.example/connect/aci_123#claim=short-lived-claim";
  const message = buildAgentConnectionMessage({ connectionUrl });

  assert.match(message, /^Use RateLoop to connect yourself to my workspace and finish automatically\./);
  assert.match(message, /Open and preserve this connection link through any installation or authorization/);
  assert.match(message, /do not ask me to paste it again/);
  assert.match(message, /Only interrupt me for a host-native install, trust, or authorization prompt/);
  assert.equal(message.match(/https:\/\//g)?.length, 1);
  assert.match(message, new RegExp(connectionUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(message, /Authorization header|Bearer|rlk_|access token|refresh token|environment variable/i);
  assert.doesNotMatch(message, /poll|heartbeat|restart/i);
});
