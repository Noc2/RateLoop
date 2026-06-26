type JsonObject = Record<string, unknown>;

const SENSITIVE_AGENT_REQUEST_FIELDS = new Set(["webhookSecret"]);

export function redactSensitiveAgentRequestFields(value: JsonObject): JsonObject {
  const redacted = { ...value };
  for (const field of SENSITIVE_AGENT_REQUEST_FIELDS) {
    delete redacted[field];
  }
  return redacted;
}
