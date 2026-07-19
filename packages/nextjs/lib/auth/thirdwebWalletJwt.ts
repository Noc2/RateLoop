import { type JsonWebKey, createHash, createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import "server-only";
import { type ManagedWalletJwtSigner, createConfiguredAwsKmsWalletJwtSigner } from "~~/lib/auth/awsKmsWalletJwtSigner";
import { AuthError, getAuthOrigin } from "~~/lib/auth/session";
import { dbClient } from "~~/lib/db";
import { appendSecurityAuditEvent } from "~~/lib/privacy/audit";

const JWT_TTL_SECONDS = 5 * 60;

type LocalWalletJwtConfiguration = {
  audience: string;
  issuer: string;
  keyId: string;
  privateJwk: JsonWebKey;
};
type WalletJwtConfiguration =
  | (Omit<LocalWalletJwtConfiguration, "privateJwk"> & { kind: "aws-kms"; signer: ManagedWalletJwtSigner })
  | (LocalWalletJwtConfiguration & { kind: "local-test" });

let configurationOverride: LocalWalletJwtConfiguration | null = null;

function base64url(value: string | Uint8Array) {
  return Buffer.from(value).toString("base64url");
}

function configuredJwk(): JsonWebKey {
  const raw = process.env.TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK?.trim();
  if (!raw) throw new AuthError("The optional thirdweb wallet issuer is not configured.", 503);
  try {
    const value = JSON.parse(raw) as JsonWebKey;
    if (value.kty !== "OKP" || value.crv !== "Ed25519" || !value.d || !value.x) throw new Error("invalid key");
    return value;
  } catch {
    throw new AuthError("TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK must be a private Ed25519 JWK.", 503);
  }
}

export function getThirdwebWalletJwtConfiguration(): WalletJwtConfiguration {
  if (configurationOverride) return { ...configurationOverride, kind: "local-test" };
  if (process.env.NODE_ENV === "production") {
    throw new AuthError(
      "Managed thirdweb wallet creation is disabled until verified wallet export and recovery are available.",
      503,
    );
  }
  if (process.env.TOKENLESS_THIRDWEB_WALLET_ENABLED !== "true") {
    throw new AuthError("Optional thirdweb wallet creation is disabled.", 503);
  }
  const audience = process.env.TOKENLESS_THIRDWEB_WALLET_AUDIENCE?.trim();
  const keyId = process.env.TOKENLESS_THIRDWEB_WALLET_KEY_ID?.trim();
  if (!audience || !keyId) throw new AuthError("The thirdweb wallet JWT audience and key ID are required.", 503);
  const managedKey = process.env.TOKENLESS_THIRDWEB_WALLET_KMS_KEY_RESOURCE?.trim();
  const localKey = process.env.TOKENLESS_THIRDWEB_WALLET_PRIVATE_JWK?.trim();
  if (managedKey && localKey) throw new AuthError("The wallet issuer has conflicting key sources.", 503);
  if (managedKey) {
    return {
      audience,
      issuer: getAuthOrigin(),
      keyId,
      kind: "aws-kms",
      signer: createConfiguredAwsKmsWalletJwtSigner(),
    };
  }
  if (process.env.VERCEL_GIT_COMMIT_REF === "main") {
    throw new AuthError("Hosted wallet creation requires managed KMS signing.", 503);
  }
  return { audience, issuer: getAuthOrigin(), keyId, kind: "local-test", privateJwk: configuredJwk() };
}

export async function thirdwebWalletJwks() {
  const config = getThirdwebWalletJwtConfiguration();
  const publicJwk =
    config.kind === "aws-kms"
      ? (await config.signer.metadata()).publicJwk
      : createPublicKey(createPrivateKey({ key: config.privateJwk, format: "jwk" })).export({ format: "jwk" });
  return { keys: [{ ...publicJwk, alg: "EdDSA", kid: config.keyId, use: "sig" }] };
}

export async function issueThirdwebWalletJwt(principalId: string, now = new Date()) {
  const config = getThirdwebWalletJwtConfiguration();
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const expiresAt = issuedAt + JWT_TTL_SECONDS;
  const jti = randomBytes(24).toString("base64url");
  const header = base64url(JSON.stringify({ alg: "EdDSA", kid: config.keyId, typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      aud: config.audience,
      exp: expiresAt,
      iat: issuedAt,
      iss: config.issuer,
      jti,
      nbf: issuedAt - 5,
      sub: principalId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature =
    config.kind === "aws-kms"
      ? await config.signer.sign(Buffer.from(signingInput))
      : sign(null, Buffer.from(signingInput), createPrivateKey({ key: config.privateJwk, format: "jwk" }));
  const jtiHash = createHash("sha256").update(jti).digest("hex");
  await dbClient.execute({
    sql: `INSERT INTO tokenless_thirdweb_wallet_jtis
          (jti_hash, principal_id, audience, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    args: [jtiHash, principalId, config.audience, new Date(expiresAt * 1_000), now],
  });
  await appendSecurityAuditEvent({
    action: "wallet.thirdweb_exchange_issued",
    actorKind: "principal",
    actorReference: principalId,
    assuranceMethod: "rateloop_session",
    metadata: { expiresAt: new Date(expiresAt * 1_000).toISOString(), keyId: config.keyId },
    purpose: "wallet_creation",
    reason: "explicit_user_request",
    result: "success",
    scopeId: principalId,
    scopeKind: "identity",
    targetId: principalId,
    targetKind: "thirdweb_wallet_exchange",
  });
  return { jwt: `${signingInput}.${base64url(signature)}`, jti, expiresAt: new Date(expiresAt * 1_000) };
}

export async function consumeThirdwebWalletJti(input: { jti: string; principalId: string; now: Date }) {
  if (!/^[a-zA-Z0-9_-]{20,128}$/.test(input.jti)) return false;
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_thirdweb_wallet_jtis SET consumed_at = ?
          WHERE jti_hash = ? AND principal_id = ? AND consumed_at IS NULL AND expires_at > ? RETURNING jti_hash`,
    args: [input.now, createHash("sha256").update(input.jti).digest("hex"), input.principalId, input.now],
  });
  return result.rowCount === 1;
}

export function __setThirdwebWalletJwtConfigurationForTests(value: LocalWalletJwtConfiguration | null) {
  configurationOverride = value;
}
