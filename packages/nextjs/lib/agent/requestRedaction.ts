import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type JsonObject = Record<string, unknown>;

const ENCRYPTED_WEBHOOK_SECRET_FIELD = "__rateloopEncryptedWebhookSecret";
const SENSITIVE_AGENT_REQUEST_FIELDS = new Set(["webhookSecret", ENCRYPTED_WEBHOOK_SECRET_FIELD]);

function tokenEncryptionKey(token: string) {
  return createHash("sha256").update(`rateloop-agent-request-secret:${token}`).digest();
}

function encryptWithToken(value: string, token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenEncryptionKey(token), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

function decryptWithToken(value: string, token: string) {
  const [version, iv, tag, ciphertext] = value.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext) {
    throw new Error("Unsupported encrypted agent request field.");
  }
  const decipher = createDecipheriv("aes-256-gcm", tokenEncryptionKey(token), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function redactSensitiveAgentRequestFields(value: JsonObject): JsonObject {
  const redacted = { ...value };
  for (const field of SENSITIVE_AGENT_REQUEST_FIELDS) {
    delete redacted[field];
  }
  return redacted;
}

export function sealSensitiveAgentRequestFields(
  value: JsonObject,
  token: string,
  options: { preserveEncryptedFields?: boolean } = {},
): JsonObject {
  const sealed = { ...value };
  const existingEncrypted =
    typeof sealed[ENCRYPTED_WEBHOOK_SECRET_FIELD] === "string" ? sealed[ENCRYPTED_WEBHOOK_SECRET_FIELD] : null;
  const webhookSecret = typeof sealed.webhookSecret === "string" ? sealed.webhookSecret : null;

  delete sealed.webhookSecret;
  delete sealed[ENCRYPTED_WEBHOOK_SECRET_FIELD];

  if (webhookSecret?.trim()) {
    sealed[ENCRYPTED_WEBHOOK_SECRET_FIELD] = encryptWithToken(webhookSecret, token);
  } else if (options.preserveEncryptedFields && existingEncrypted) {
    sealed[ENCRYPTED_WEBHOOK_SECRET_FIELD] = existingEncrypted;
  }

  return sealed;
}

export function unsealSensitiveAgentRequestFields(value: JsonObject, token: string): JsonObject {
  const unsealed = { ...value };
  const encryptedWebhookSecret =
    typeof unsealed[ENCRYPTED_WEBHOOK_SECRET_FIELD] === "string" ? unsealed[ENCRYPTED_WEBHOOK_SECRET_FIELD] : null;

  delete unsealed[ENCRYPTED_WEBHOOK_SECRET_FIELD];

  if (encryptedWebhookSecret && typeof unsealed.webhookSecret !== "string") {
    unsealed.webhookSecret = decryptWithToken(encryptedWebhookSecret, token);
  }

  return unsealed;
}
