import type { KeyWrappingProvider, WrappedDataKey } from "./index";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const PROVIDER = "platform-secret";
const KEY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const ARTIFACT_AAD_PATTERN =
  /^customer_artifact:(?<workspaceId>[A-Za-z0-9_-]{1,160}):(?<projectId>[A-Za-z0-9_-]{1,160}):(?<artifactId>[A-Za-z0-9_-]{1,160}):(?<keyVersion>[A-Za-z0-9][A-Za-z0-9._:-]{0,119})$/u;
const HKDF_SALT = createHash("sha256").update("rateloop:artifact-wrapping:v1").digest();

export type PlatformSecretKeyringConfiguration = Readonly<{
  activeVersion: string;
  keys: ReadonlyMap<string, Uint8Array>;
}>;

function unavailable(message = "Artifact wrapping key is unavailable.") {
  return new TokenlessServiceError(message, 503, "vault_key_unavailable", true);
}

function decodeRootKey(encoded: string, version: string) {
  const normalized = encoded.trim();
  const key = /^[0-9a-fA-F]{64}$/u.test(normalized)
    ? Buffer.from(normalized, "hex")
    : Buffer.from(normalized, "base64url");
  if (key.byteLength !== 32) {
    throw new TokenlessServiceError(
      `Artifact wrapping key ${version} must encode exactly 32 bytes.`,
      500,
      "invalid_artifact_key",
    );
  }
  return key;
}

function parseKeyring(encoded: string) {
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new TokenlessServiceError(
      "TOKENLESS_ARTIFACT_WRAPPING_KEYS must be a JSON object.",
      500,
      "invalid_artifact_key",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TokenlessServiceError(
      "TOKENLESS_ARTIFACT_WRAPPING_KEYS must be a JSON object.",
      500,
      "invalid_artifact_key",
    );
  }
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 32) {
    throw new TokenlessServiceError(
      "Artifact wrapping keyring must contain between 1 and 32 versions.",
      500,
      "invalid_artifact_key",
    );
  }
  return new Map(
    entries.map(([version, encodedKey]) => {
      if (!KEY_VERSION.test(version) || typeof encodedKey !== "string") {
        throw new TokenlessServiceError("Artifact wrapping keyring is invalid.", 500, "invalid_artifact_key");
      }
      return [version, decodeRootKey(encodedKey, version)] as const;
    }),
  );
}

export function loadPlatformSecretKeyringConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): PlatformSecretKeyringConfiguration {
  if (
    env.NEXT_PUBLIC_TOKENLESS_ARTIFACT_WRAPPING_KEYS ||
    env.NEXT_PUBLIC_TOKENLESS_ARTIFACT_WRAPPING_KEY_VERSION ||
    env.NEXT_PUBLIC_TOKENLESS_ARTIFACT_MASTER_KEY
  ) {
    throw new TokenlessServiceError(
      "Artifact wrapping keys must never use NEXT_PUBLIC_ variables.",
      500,
      "public_vault_key_forbidden",
    );
  }
  const encodedKeyring = env.TOKENLESS_ARTIFACT_WRAPPING_KEYS?.trim();
  const configuredVersion = env.TOKENLESS_ARTIFACT_WRAPPING_KEY_VERSION?.trim();
  if (Boolean(encodedKeyring) !== Boolean(configuredVersion)) {
    throw new TokenlessServiceError(
      "Artifact wrapping keyring and active version must be configured together.",
      500,
      "invalid_artifact_key",
    );
  }
  if (encodedKeyring && configuredVersion) {
    if (!KEY_VERSION.test(configuredVersion)) {
      throw new TokenlessServiceError("Artifact wrapping key version is invalid.", 500, "invalid_artifact_key");
    }
    const keys = parseKeyring(encodedKeyring);
    if (!keys.has(configuredVersion)) {
      throw new TokenlessServiceError(
        "Active artifact wrapping key version is absent from the keyring.",
        500,
        "invalid_artifact_key",
      );
    }
    return { activeVersion: configuredVersion, keys };
  }

  // Transitional compatibility lets the existing sealed platform value decrypt
  // legacy envelopes until operators copy it into the versioned keyring.
  const legacyKey = env.TOKENLESS_ARTIFACT_MASTER_KEY?.trim();
  if (!legacyKey) {
    throw new TokenlessServiceError(
      "Artifact wrapping keyring is unavailable.",
      503,
      "artifact_vault_unavailable",
      true,
    );
  }
  const legacyVersion = env.TOKENLESS_ARTIFACT_KEY_VERSION?.trim() || "artifact-v1";
  if (!KEY_VERSION.test(legacyVersion)) {
    throw new TokenlessServiceError("Artifact wrapping key version is invalid.", 500, "invalid_artifact_key");
  }
  return {
    activeVersion: legacyVersion,
    keys: new Map([[legacyVersion, decodeRootKey(legacyKey, legacyVersion)]]),
  };
}

function parseArtifactAad(aad: Uint8Array) {
  const match = ARTIFACT_AAD_PATTERN.exec(Buffer.from(aad).toString("utf8"));
  if (!match?.groups) {
    throw new TokenlessServiceError("Artifact key context is invalid.", 500, "invalid_artifact_key_metadata");
  }
  return {
    artifactId: match.groups.artifactId!,
    keyVersion: match.groups.keyVersion!,
    projectId: match.groups.projectId!,
    workspaceId: match.groups.workspaceId!,
  };
}

function keyResource(version: string) {
  return `${PROVIDER}://artifact-wrapping/${version}`;
}

function tenantWrappingKey(rootKey: Uint8Array, context: ReturnType<typeof parseArtifactAad>) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      rootKey,
      HKDF_SALT,
      Buffer.from(
        JSON.stringify({
          domain: "customer_artifact",
          projectId: context.projectId,
          workspaceId: context.workspaceId,
        }),
      ),
      32,
    ),
  );
}

function encrypt(dataKey: Uint8Array, wrappingKey: Uint8Array, aad: Uint8Array) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return { authTag: cipher.getAuthTag(), ciphertext, nonce };
}

function decrypt(wrapped: WrappedDataKey, wrappingKey: Uint8Array, aad: Uint8Array) {
  if (!wrapped.nonce || !wrapped.authTag) throw unavailable();
  try {
    const decipher = createDecipheriv("aes-256-gcm", wrappingKey, Buffer.from(wrapped.nonce, "base64url"));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(wrapped.authTag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(wrapped.ciphertext, "base64url")), decipher.final()]);
  } catch {
    throw unavailable();
  }
}

export function createPlatformSecretKeyWrappingProvider(
  configuration: PlatformSecretKeyringConfiguration,
): KeyWrappingProvider {
  const activeRoot = configuration.keys.get(configuration.activeVersion);
  if (!activeRoot || activeRoot.byteLength !== 32 || !KEY_VERSION.test(configuration.activeVersion)) {
    throw new TokenlessServiceError("Artifact wrapping keyring is invalid.", 500, "invalid_artifact_key");
  }
  return {
    keyResource: keyResource(configuration.activeVersion),
    keyResourceForVersion: keyResource,
    keyVersion: configuration.activeVersion,
    provider: PROVIDER,
    async wrap(dataKey, aad) {
      if (dataKey.byteLength !== 32) {
        throw new TokenlessServiceError("Artifact data key is invalid.", 500, "invalid_artifact_key_metadata");
      }
      const context = parseArtifactAad(aad);
      if (context.keyVersion !== configuration.activeVersion) {
        throw new TokenlessServiceError("Artifact key version is invalid.", 500, "invalid_artifact_key_metadata");
      }
      const derivedKey = tenantWrappingKey(activeRoot, context);
      try {
        const wrapped = encrypt(dataKey, derivedKey, aad);
        return {
          authTag: wrapped.authTag.toString("base64url"),
          ciphertext: wrapped.ciphertext.toString("base64url"),
          keyResource: keyResource(configuration.activeVersion),
          keyVersion: configuration.activeVersion,
          nonce: wrapped.nonce.toString("base64url"),
          provider: PROVIDER,
        };
      } finally {
        derivedKey.fill(0);
      }
    },
    async unwrap(wrapped, aad) {
      const rootKey = configuration.keys.get(wrapped.keyVersion);
      if (!rootKey) throw unavailable();
      const context = parseArtifactAad(aad);
      if (context.keyVersion !== wrapped.keyVersion) throw unavailable();
      // Every envelope this provider opens is unwrapped with the per-tenant derived key. The
      // stored provider name is untrusted input and must never select a weaker key derivation.
      if (wrapped.provider !== PROVIDER || wrapped.keyResource !== keyResource(wrapped.keyVersion)) {
        throw unavailable();
      }
      const derivedKey = tenantWrappingKey(rootKey, context);
      try {
        return decrypt(wrapped, derivedKey, aad);
      } finally {
        derivedKey.fill(0);
      }
    },
  };
}

export function createConfiguredPlatformSecretKeyWrappingProvider(env: NodeJS.ProcessEnv = process.env) {
  return createPlatformSecretKeyWrappingProvider(loadPlatformSecretKeyringConfiguration(env));
}

export const __platformSecretVaultTestUtils = { keyResource, parseArtifactAad, tenantWrappingKey };
