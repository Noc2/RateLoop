import { evidenceVerificationKeyId, parseEvidenceVerificationKeyring } from "./evidenceVerificationKeyring.mjs";
import { X509Certificate, createHash, createPrivateKey, createPublicKey } from "node:crypto";

export const MANAGED_ATTESTATION_CORE_ENV_NAMES = Object.freeze([
  "TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY",
  "TOKENLESS_ATTESTATION_SIGNING_KEY_ID",
  "TOKENLESS_ATTESTATION_REKOR_URL",
  "TOKENLESS_ATTESTATION_REKOR_PUBLIC_KEY_PEM",
  "TOKENLESS_ATTESTATION_VERIFICATION_KEYS",
]);

export const MANAGED_ATTESTATION_TSA_ENV_NAMES = Object.freeze([
  "TOKENLESS_ATTESTATION_TSA_URL",
  "TOKENLESS_ATTESTATION_TSA_CA_PEM",
  "TOKENLESS_ATTESTATION_TSA_UNTRUSTED_PEM",
]);

const REQUIRED_TSA_ENV_NAMES = MANAGED_ATTESTATION_TSA_ENV_NAMES.filter(
  name => name !== "TOKENLESS_ATTESTATION_TSA_UNTRUSTED_PEM",
);
const PRIVATE_ENV_NAMES = Object.freeze([
  ...MANAGED_ATTESTATION_CORE_ENV_NAMES.filter(name => name !== "TOKENLESS_ATTESTATION_VERIFICATION_KEYS"),
  ...MANAGED_ATTESTATION_TSA_ENV_NAMES,
]);

function value(env, name) {
  return env[name]?.trim() ?? "";
}

export function managedAssuranceAttestationConfigurationState(env) {
  const publicNames = PRIVATE_ENV_NAMES.map(name => `NEXT_PUBLIC_${name}`);
  if (publicNames.some(name => value(env, name))) {
    return {
      configured: false,
      timestampingConfigured: false,
      error: "Attestation trust material must never use NEXT_PUBLIC_ variables.",
    };
  }
  const corePresent = MANAGED_ATTESTATION_CORE_ENV_NAMES.filter(name => value(env, name));
  const tsaPresent = MANAGED_ATTESTATION_TSA_ENV_NAMES.filter(name => value(env, name));
  if (corePresent.length === 0 && tsaPresent.length === 0) {
    return { configured: false, timestampingConfigured: false, error: null };
  }
  if (
    corePresent.length !== MANAGED_ATTESTATION_CORE_ENV_NAMES.length ||
    (tsaPresent.length > 0 && REQUIRED_TSA_ENV_NAMES.some(name => !value(env, name)))
  ) {
    return {
      configured: false,
      timestampingConfigured: false,
      error: "Managed attestation runtime configuration is incomplete.",
    };
  }
  return { configured: true, timestampingConfigured: tsaPresent.length > 0, error: null };
}

export function parseAttestationVerificationKeyring(encoded) {
  const verificationKeys = parseEvidenceVerificationKeyring(encoded);
  if (verificationKeys.filter(entry => entry.status === "current").length !== 1) {
    throw new Error("Managed attestation verification keyring must contain exactly one current key.");
  }
  return verificationKeys;
}

export function validateRequiredManagedAssuranceAttestationConfiguration(env) {
  const state = managedAssuranceAttestationConfigurationState(env);
  if (state.error) return [state.error];
  if (!state.configured) {
    return [
      "Managed attestation signing, Rekor trust, and the published verification key are required for a hosted deployment.",
    ];
  }
  try {
    resolveManagedAssuranceAttestationConfiguration(env);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : "Managed attestation runtime configuration is invalid."];
  }
}

function httpsProviderUrl(encoded, kind, originOnly) {
  let url;
  try {
    url = new URL(encoded);
  } catch {
    throw new Error(`${kind} URL must be a public HTTPS URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.hostname === "localhost" ||
    /^(?:127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?$)/u.test(url.hostname) ||
    (originOnly && (url.pathname !== "/" || url.search))
  ) {
    throw new Error(`${kind} URL must be a public HTTPS URL.`);
  }
  return url.toString();
}

function certificateBundle(encoded, kind) {
  const blocks = encoded.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/gu) ?? [];
  if (blocks.length === 0) throw new Error(`${kind} certificate bundle is invalid.`);
  const remaining = blocks.reduce((value, block) => value.replace(block, ""), encoded);
  if (remaining.trim()) throw new Error(`${kind} certificate bundle is invalid.`);
  try {
    for (const block of blocks) new X509Certificate(block);
  } catch {
    throw new Error(`${kind} certificate bundle is invalid.`);
  }
  return blocks.join("\n");
}

export function resolveManagedAssuranceAttestationConfiguration(env) {
  const state = managedAssuranceAttestationConfigurationState(env);
  if (state.error) throw new Error(state.error);
  if (!state.configured) {
    throw new Error(
      "Managed attestation signing, Rekor trust, and the published verification key are required for a hosted deployment.",
    );
  }
  let privateKey;
  let publicKeyDer;
  try {
    const encoded = value(env, "TOKENLESS_ATTESTATION_SIGNING_PRIVATE_KEY");
    privateKey = createPrivateKey(
      encoded.includes("BEGIN PRIVATE KEY")
        ? encoded.replaceAll("\\n", "\n")
        : { key: Buffer.from(encoded, "base64url"), format: "der", type: "pkcs8" },
    );
    if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    publicKeyDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  } catch {
    throw new Error("Managed attestation signing key must be a private Ed25519 PKCS#8 key.");
  }
  const keyId = evidenceVerificationKeyId(publicKeyDer);
  if (value(env, "TOKENLESS_ATTESTATION_SIGNING_KEY_ID") !== keyId) {
    throw new Error("Managed attestation signing key ID must match its public-key fingerprint.");
  }
  let verificationKeys;
  try {
    verificationKeys = parseAttestationVerificationKeyring(value(env, "TOKENLESS_ATTESTATION_VERIFICATION_KEYS"));
  } catch {
    throw new Error("The evidence verification keyring is invalid.");
  }
  const matchingCurrent = verificationKeys.filter(
    entry => entry.status === "current" && entry.keyId === keyId && entry.publicKeyDer.equals(publicKeyDer),
  );
  if (matchingCurrent.length !== 1) {
    throw new Error("Managed attestation signer must be the one current published verification key.");
  }
  let rekorPublicKey;
  try {
    rekorPublicKey = createPublicKey(value(env, "TOKENLESS_ATTESTATION_REKOR_PUBLIC_KEY_PEM").replaceAll("\\n", "\n"));
  } catch {
    throw new Error("Rekor public trust key is invalid.");
  }
  const tsa = state.timestampingConfigured
    ? {
        authorityUrl: httpsProviderUrl(value(env, "TOKENLESS_ATTESTATION_TSA_URL"), "RFC 3161", false),
        trustedCaPem: certificateBundle(
          value(env, "TOKENLESS_ATTESTATION_TSA_CA_PEM").replaceAll("\\n", "\n"),
          "RFC 3161 CA",
        ),
        untrustedChainPem: value(env, "TOKENLESS_ATTESTATION_TSA_UNTRUSTED_PEM").replaceAll("\\n", "\n")
          ? certificateBundle(
              value(env, "TOKENLESS_ATTESTATION_TSA_UNTRUSTED_PEM").replaceAll("\\n", "\n"),
              "RFC 3161 untrusted chain",
            )
          : undefined,
      }
    : undefined;
  return {
    signer: {
      privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64url"),
      keyId,
      publicKeyDer,
      privateKeyFingerprint: createHash("sha256")
        .update(privateKey.export({ format: "der", type: "pkcs8" }))
        .digest(),
    },
    rekor: {
      logOrigin: httpsProviderUrl(value(env, "TOKENLESS_ATTESTATION_REKOR_URL"), "Rekor", true),
      trustedPublicKeyPem: rekorPublicKey.export({ format: "pem", type: "spki" }).toString(),
    },
    tsa,
  };
}
