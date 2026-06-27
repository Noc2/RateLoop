import {
  redactSensitiveAgentRequestFields,
  sealSensitiveAgentRequestFields,
  unsealSensitiveAgentRequestFields,
} from "./requestRedaction";
import assert from "node:assert/strict";
import test from "node:test";

test("agent request field sealing removes plaintext webhook secrets at rest", () => {
  const sealed = sealSensitiveAgentRequestFields(
    {
      clientRequestId: "client-1",
      webhookSecret: "super-secret-callback-key",
      webhookUrl: "https://agent.example/callback",
    },
    "handoff-token",
  );

  const storedText = JSON.stringify(sealed);
  assert.equal("webhookSecret" in sealed, false);
  assert.equal(storedText.includes("super-secret-callback-key"), false);

  const unsealed = unsealSensitiveAgentRequestFields(sealed, "handoff-token");
  assert.equal(unsealed.webhookSecret, "super-secret-callback-key");
  assert.equal(unsealed.webhookUrl, "https://agent.example/callback");

  const redacted = redactSensitiveAgentRequestFields(sealed);
  assert.equal(JSON.stringify(redacted).includes("super-secret-callback-key"), false);
  assert.equal(
    Object.keys(redacted).some(key => key.toLowerCase().includes("webhooksecret")),
    false,
  );
});
