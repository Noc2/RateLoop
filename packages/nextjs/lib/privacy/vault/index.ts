import tokenlessEuDeploymentManifest from "../../../../../config/tokenless-eu-deployment.json";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const MANAGED_KMS_INVENTORY = tokenlessEuDeploymentManifest.resources.kms;
const TOKENLESS_REVIEW_PROJECT_ID = "prj_H6C2pfWKEAupFroHbLfzhquaNCLm";
const TOKENLESS_REVIEW_ORIGIN = "https://rateloop-tokenless.vercel.app";

export type VaultContext = Readonly<{
  tenantId: string;
  homeRegion: "eu";
  purpose: string;
  recordId: string;
}>;

export type WrappedDataKey = Readonly<{
  ciphertext: string;
  nonce: string | null;
  authTag: string | null;
  keyResource: string;
  keyVersion: string;
  provider: string;
}>;

export type EncryptedEnvelope = Readonly<{
  algorithm: "AES-256-GCM";
  ciphertext: string;
  nonce: string;
  authTag: string;
  wrappedDataKey: WrappedDataKey;
  context: VaultContext;
  envelopeVersion: "vault-envelope-v1";
}>;

export interface KeyWrappingProvider {
  readonly keyResource: string;
  readonly keyVersion: string;
  readonly provider: string;
  wrap(dataKey: Uint8Array, aad: Uint8Array): Promise<WrappedDataKey>;
  unwrap(wrapped: WrappedDataKey, aad: Uint8Array): Promise<Uint8Array>;
}

function contextAad(context: VaultContext) {
  if (!context.tenantId.trim() || context.homeRegion !== "eu" || !context.purpose.trim() || !context.recordId.trim()) {
    throw new TokenlessServiceError(
      "Vault context is incomplete or outside the EU home region.",
      400,
      "invalid_vault_context",
    );
  }
  return Buffer.from(
    JSON.stringify({
      homeRegion: context.homeRegion,
      purpose: context.purpose,
      recordId: context.recordId,
      tenantId: context.tenantId,
    }),
  );
}

function encryptAesGcm(plaintext: Uint8Array, key: Uint8Array, aad: Uint8Array) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { authTag: cipher.getAuthTag(), ciphertext, nonce };
}

function decryptAesGcm(
  ciphertext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array,
  authTag: Uint8Array,
  aad: Uint8Array,
) {
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function createLocalKeyWrappingProvider(input: { key: Uint8Array; keyVersion: string }): KeyWrappingProvider {
  if (input.key.byteLength !== 32 || !input.keyVersion.trim()) {
    throw new TokenlessServiceError("Local vault key configuration is invalid.", 500, "invalid_local_vault_key");
  }
  return {
    keyResource: `local://${input.keyVersion}`,
    keyVersion: input.keyVersion,
    provider: "local-test",
    async wrap(dataKey, aad) {
      const wrapped = encryptAesGcm(dataKey, input.key, aad);
      return {
        authTag: wrapped.authTag.toString("base64url"),
        ciphertext: wrapped.ciphertext.toString("base64url"),
        keyResource: `local://${input.keyVersion}`,
        keyVersion: input.keyVersion,
        nonce: wrapped.nonce.toString("base64url"),
        provider: "local-test",
      };
    },
    async unwrap(wrapped, aad) {
      if (
        wrapped.provider !== "local-test" ||
        wrapped.keyVersion !== input.keyVersion ||
        wrapped.keyResource !== `local://${input.keyVersion}` ||
        !wrapped.nonce ||
        !wrapped.authTag
      ) {
        throw new TokenlessServiceError("Wrapped key is unavailable from this provider.", 503, "vault_key_unavailable");
      }
      return decryptAesGcm(
        Buffer.from(wrapped.ciphertext, "base64url"),
        input.key,
        Buffer.from(wrapped.nonce, "base64url"),
        Buffer.from(wrapped.authTag, "base64url"),
        aad,
      );
    },
  };
}

export function createManagedKeyWrappingProvider(input: {
  keyResource: string;
  keyVersion: string;
  provider: string;
  unwrap: (ciphertext: Uint8Array, aad: Uint8Array) => Promise<Uint8Array>;
  wrap: (dataKey: Uint8Array, aad: Uint8Array) => Promise<Uint8Array>;
}): KeyWrappingProvider {
  if (!input.keyResource.trim() || !input.keyVersion.trim() || !input.provider.trim()) {
    throw new TokenlessServiceError("Managed KMS configuration is invalid.", 500, "invalid_managed_kms");
  }
  return {
    keyResource: input.keyResource,
    keyVersion: input.keyVersion,
    provider: input.provider,
    async wrap(dataKey, aad) {
      return {
        authTag: null,
        ciphertext: Buffer.from(await input.wrap(dataKey, aad)).toString("base64url"),
        keyResource: input.keyResource,
        keyVersion: input.keyVersion,
        nonce: null,
        provider: input.provider,
      };
    },
    async unwrap(wrapped, aad) {
      if (
        wrapped.provider !== input.provider ||
        wrapped.keyResource !== input.keyResource ||
        wrapped.keyVersion !== input.keyVersion
      ) {
        throw new TokenlessServiceError(
          "Wrapped key is unavailable from this KMS provider.",
          503,
          "vault_key_unavailable",
        );
      }
      return input.unwrap(Buffer.from(wrapped.ciphertext, "base64url"), aad);
    },
  };
}

export function validateVaultEnvironment(env: NodeJS.ProcessEnv = process.env) {
  if (
    env.NEXT_PUBLIC_TOKENLESS_ARTIFACT_MASTER_KEY ||
    env.NEXT_PUBLIC_TOKENLESS_KMS_KEY_RESOURCE ||
    env.NEXT_PUBLIC_TOKENLESS_PSEUDONYM_KEY
  ) {
    throw new TokenlessServiceError(
      "Vault keys must never use NEXT_PUBLIC_ variables.",
      500,
      "public_vault_key_forbidden",
    );
  }
  if (env.NODE_ENV === "test") return { mode: "test" as const };
  if (env.TOKENLESS_ARTIFACT_MASTER_KEY) {
    const isolatedReviewVault =
      env.VERCEL === "1" &&
      env.VERCEL_ENV === "production" &&
      env.VERCEL_PROJECT_ID === TOKENLESS_REVIEW_PROJECT_ID &&
      env.APP_URL === TOKENLESS_REVIEW_ORIGIN &&
      env.NEXT_PUBLIC_APP_URL === TOKENLESS_REVIEW_ORIGIN &&
      (!env.VERCEL_GIT_COMMIT_REF || env.VERCEL_GIT_COMMIT_REF === "tokenless");
    if (!isolatedReviewVault) {
      throw new TokenlessServiceError(
        "Hosted runtime cannot use a local artifact master key.",
        500,
        "local_production_vault_forbidden",
      );
    }
    return { mode: "isolated-review" as const };
  }
  const provider = env[MANAGED_KMS_INVENTORY.providerEnv]?.trim();
  const keyResource = env[MANAGED_KMS_INVENTORY.resourceIdEnv]?.trim();
  if (!provider || !keyResource) {
    throw new TokenlessServiceError(
      "Hosted runtime requires a managed KMS provider and key resource.",
      503,
      "managed_kms_required",
    );
  }
  if (!MANAGED_KMS_INVENTORY.allowedProviders.includes(provider)) {
    throw new TokenlessServiceError(
      "Hosted runtime requires an approved managed KMS provider.",
      503,
      "invalid_managed_kms",
    );
  }
  if (env[MANAGED_KMS_INVENTORY.regionEnv]?.trim() !== MANAGED_KMS_INVENTORY.region) {
    throw new TokenlessServiceError(
      "The managed KMS region must match the signed EU deployment manifest.",
      503,
      "kms_region_mismatch",
    );
  }
  return { keyResource, mode: "managed" as const, provider };
}

export class EnvelopeVault {
  constructor(private readonly provider: KeyWrappingProvider) {}

  async seal(plaintext: Uint8Array, context: VaultContext): Promise<EncryptedEnvelope> {
    const aad = contextAad(context);
    const dataKey = randomBytes(32);
    const content = encryptAesGcm(plaintext, dataKey, aad);
    const wrappedDataKey = await this.provider.wrap(dataKey, aad);
    dataKey.fill(0);
    return {
      algorithm: "AES-256-GCM",
      authTag: content.authTag.toString("base64url"),
      ciphertext: content.ciphertext.toString("base64url"),
      context,
      envelopeVersion: "vault-envelope-v1",
      nonce: content.nonce.toString("base64url"),
      wrappedDataKey,
    };
  }

  async open(envelope: EncryptedEnvelope, expectedContext: VaultContext): Promise<Uint8Array> {
    if (JSON.stringify(envelope.context) !== JSON.stringify(expectedContext)) {
      throw new TokenlessServiceError(
        "Vault context does not match the encrypted record.",
        403,
        "vault_context_mismatch",
      );
    }
    const aad = contextAad(expectedContext);
    const dataKey = await this.provider.unwrap(envelope.wrappedDataKey, aad);
    try {
      return decryptAesGcm(
        Buffer.from(envelope.ciphertext, "base64url"),
        dataKey,
        Buffer.from(envelope.nonce, "base64url"),
        Buffer.from(envelope.authTag, "base64url"),
        aad,
      );
    } finally {
      dataKey.fill(0);
    }
  }

  async rewrap(envelope: EncryptedEnvelope, destination: KeyWrappingProvider): Promise<EncryptedEnvelope> {
    const aad = contextAad(envelope.context);
    const dataKey = await this.provider.unwrap(envelope.wrappedDataKey, aad);
    try {
      return { ...envelope, wrappedDataKey: await destination.wrap(dataKey, aad) };
    } finally {
      dataKey.fill(0);
    }
  }
}
