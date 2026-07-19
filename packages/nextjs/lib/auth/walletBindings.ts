import { createHash, randomBytes } from "node:crypto";
import "server-only";
import { type Address, type Hex, createPublicClient, getAddress, http } from "viem";
import { baseSepolia } from "viem/chains";
import { AuthError, getAuthOrigin } from "~~/lib/auth/session";
import { consumeThirdwebWalletJti } from "~~/lib/auth/thirdwebWalletJwt";
import { dbClient, dbPool } from "~~/lib/db";
import { appendSecurityAuditEvent } from "~~/lib/privacy/audit";

const CHALLENGE_TTL_MS = 5 * 60 * 1_000;

export const WALLET_BINDING_PURPOSES = ["funding", "payout", "recovery"] as const;
export type WalletBindingPurpose = (typeof WALLET_BINDING_PURPOSES)[number];
export type WalletSource = "self_custodial" | "thirdweb";

let signatureVerifierOverride:
  | ((input: { address: Address; message: string; signature: Hex }) => Promise<boolean>)
  | null = null;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function parsePurpose(value: unknown): WalletBindingPurpose {
  if (typeof value !== "string" || !WALLET_BINDING_PURPOSES.includes(value as WalletBindingPurpose)) {
    throw new AuthError("Wallet purpose must be funding, payout, or recovery.", 400);
  }
  return value as WalletBindingPurpose;
}

function parseSource(value: unknown): WalletSource {
  if (value !== "thirdweb" && value !== "self_custodial") {
    throw new AuthError("Wallet source must be thirdweb or self_custodial.", 400);
  }
  return value;
}

function bindingMessage(input: {
  address: Address;
  chainId: number;
  expiresAt: Date;
  nonce: string;
  principalId: string;
  purpose: WalletBindingPurpose;
}) {
  const origin = new URL(getAuthOrigin());
  return [
    "RateLoop wallet binding",
    "",
    `Domain: ${origin.host}`,
    `URI: ${origin.origin}`,
    `Principal ID: ${input.principalId}`,
    `Purpose: ${input.purpose}`,
    `Wallet: ${input.address}`,
    `Chain ID: ${input.chainId}`,
    `Nonce: ${input.nonce}`,
    `Expiration Time: ${input.expiresAt.toISOString()}`,
    "",
    "This proof does not authorize general RateLoop account access.",
  ].join("\n");
}

export async function createWalletBindingChallenge(input: {
  address: string;
  principalId: string;
  purpose: unknown;
  source: unknown;
  thirdwebJti?: unknown;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const address = getAddress(input.address);
  const purpose = parsePurpose(input.purpose);
  const source = parseSource(input.source);
  const thirdwebJti = typeof input.thirdwebJti === "string" ? input.thirdwebJti : null;
  if (source === "thirdweb") {
    if (!thirdwebJti || !(await consumeThirdwebWalletJti({ jti: thirdwebJti, principalId: input.principalId, now }))) {
      throw new AuthError("The thirdweb wallet exchange expired or was already used.", 401);
    }
  } else if (thirdwebJti) {
    throw new AuthError("A thirdweb exchange cannot be attached to a self-custodial wallet.", 400);
  }
  const challengeId = `wch_${randomBytes(18).toString("base64url")}`;
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
  const message = bindingMessage({
    address,
    chainId: baseSepolia.id,
    expiresAt,
    nonce,
    principalId: input.principalId,
    purpose,
  });
  await dbClient.execute({
    sql: `INSERT INTO tokenless_wallet_binding_challenges
          (challenge_id, principal_id, purpose, wallet_address, wallet_source, chain_id, nonce_hash,
           message_hash, thirdweb_jti_hash, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      challengeId,
      input.principalId,
      purpose,
      address.toLowerCase(),
      source,
      baseSepolia.id,
      hash(nonce),
      hash(message),
      thirdwebJti ? hash(thirdwebJti) : null,
      expiresAt,
      now,
    ],
  });
  await appendSecurityAuditEvent({
    action: "wallet.binding_challenge_created",
    actorKind: "principal",
    actorReference: input.principalId,
    assuranceMethod: "rateloop_session",
    metadata: { chainId: baseSepolia.id, expiresAt: expiresAt.toISOString(), purpose, source },
    purpose: "wallet_binding",
    reason: "explicit_user_request",
    result: "success",
    scopeId: input.principalId,
    scopeKind: "identity",
    targetId: challengeId,
    targetKind: "wallet_binding_challenge",
  });
  return { challengeId, message, expiresAt };
}

async function verifySignature(input: { address: Address; message: string; signature: Hex }) {
  if (signatureVerifierOverride) return signatureVerifierOverride(input);
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL?.trim() || "https://sepolia.base.org";
  return createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) }).verifyMessage(input);
}

export async function completeWalletBinding(input: {
  challengeId: string;
  message: string;
  principalId: string;
  signature: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  if (!/^wch_[a-zA-Z0-9_-]{20,80}$/.test(input.challengeId) || !/^0x[a-fA-F0-9]+$/.test(input.signature)) {
    throw new AuthError("Malformed wallet binding proof.", 400);
  }
  const result = await dbClient.execute({
    sql: `SELECT challenge_id, purpose, wallet_address, wallet_source, chain_id, message_hash, expires_at
          FROM tokenless_wallet_binding_challenges
          WHERE challenge_id = ? AND principal_id = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1`,
    args: [input.challengeId, input.principalId, now],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || String(row.message_hash) !== hash(input.message)) {
    throw new AuthError("The wallet binding challenge expired or does not match.", 401);
  }
  const address = getAddress(String(row.wallet_address));
  const valid = await verifySignature({ address, message: input.message, signature: input.signature as Hex });
  if (!valid) throw new AuthError("The wallet signature is invalid.", 401);
  const purpose = parsePurpose(row.purpose);
  const bindingId = `wbd_${randomBytes(18).toString("base64url")}`;
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const consumed = await client.query(
      `UPDATE tokenless_wallet_binding_challenges SET consumed_at = $1
       WHERE challenge_id = $2 AND principal_id = $3 AND consumed_at IS NULL AND expires_at > $1
       RETURNING challenge_id`,
      [now, input.challengeId, input.principalId],
    );
    if (consumed.rowCount !== 1) throw new AuthError("The wallet binding challenge was already used.", 409);
    if (purpose === "payout") {
      const ownership = await client.query(
        `SELECT principal_id FROM tokenless_payout_wallet_ownership
         WHERE wallet_address = $1 FOR UPDATE`,
        [address.toLowerCase()],
      );
      const owner = ownership.rows[0] as { principal_id?: unknown } | undefined;
      if (owner && String(owner.principal_id) !== input.principalId) {
        throw new AuthError("This payout wallet belongs to another RateLoop account.", 409);
      }
    }
    await client.query(
      `UPDATE tokenless_wallet_bindings SET revoked_at = $1
       WHERE principal_id = $2 AND purpose = $3 AND revoked_at IS NULL`,
      [now, input.principalId, purpose],
    );
    await client.query(
      `INSERT INTO tokenless_wallet_bindings
       (binding_id, principal_id, purpose, wallet_address, wallet_source, chain_id,
        proof_message_hash, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [
        bindingId,
        input.principalId,
        purpose,
        address.toLowerCase(),
        parseSource(row.wallet_source),
        Number(row.chain_id),
        hash(input.message),
        now,
      ],
    );
    if (purpose === "payout") {
      await client.query(
        `INSERT INTO tokenless_payout_wallet_ownership
         (wallet_address, principal_id, first_binding_id, first_bound_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (wallet_address) DO NOTHING`,
        [address.toLowerCase(), input.principalId, bindingId, now],
      );
      const ownership = await client.query(
        `SELECT principal_id FROM tokenless_payout_wallet_ownership
         WHERE wallet_address = $1`,
        [address.toLowerCase()],
      );
      if (String((ownership.rows[0] as { principal_id?: unknown } | undefined)?.principal_id) !== input.principalId) {
        throw new AuthError("This payout wallet belongs to another RateLoop account.", 409);
      }
      // principal_id remains the rater identity. These columns only mirror the
      // newly proved destination for future work; issued vouchers and accepted
      // assignments retain their own payout snapshots.
      await client.query(
        `UPDATE tokenless_rater_profiles SET account_address = $1, updated_at = $2
         WHERE principal_id = $3`,
        [address.toLowerCase(), now, input.principalId],
      );
      await client.query(
        `UPDATE tokenless_payout_eligibility
         SET payout_account = $1, payout_ownership_method = 'siwe_base_account_session',
             payout_verified_at = $2, payout_expires_at = NULL,
             eligibility_status = 'ready', blocked_reason = NULL, updated_at = $2
         FROM tokenless_rater_profiles profile
         WHERE profile.rater_id = tokenless_payout_eligibility.rater_id AND profile.principal_id = $3`,
        [address.toLowerCase(), now, input.principalId],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof AuthError) throw error;
    throw new AuthError("This wallet is already bound to another account for that purpose.", 409);
  } finally {
    client.release();
  }
  const source = parseSource(row.wallet_source);
  await appendSecurityAuditEvent({
    action: "wallet.binding_created",
    actorKind: "principal",
    actorReference: input.principalId,
    assuranceMethod: "wallet_signature",
    metadata: { bindingId, chainId: Number(row.chain_id), purpose, source },
    purpose: "wallet_binding",
    reason: "purpose_bound_signature_verified",
    result: "success",
    scopeId: input.principalId,
    scopeKind: "identity",
    targetId: bindingId,
    targetKind: "wallet_binding",
  });
  return { bindingId, purpose, source, walletAddress: address };
}

export async function listWalletBindings(principalId: string) {
  const result = await dbClient.execute({
    sql: `SELECT binding_id, purpose, wallet_address, wallet_source, chain_id, created_at
          FROM tokenless_wallet_bindings WHERE principal_id = ? AND revoked_at IS NULL ORDER BY purpose`,
    args: [principalId],
  });
  return result.rows.map(row => ({
    bindingId: String(row.binding_id),
    purpose: parsePurpose(row.purpose),
    source: parseSource(row.wallet_source),
    walletAddress: getAddress(String(row.wallet_address)),
    chainId: Number(row.chain_id),
    createdAt: new Date(String(row.created_at)),
  }));
}

export async function getWalletBindingAddresses(principalId: string) {
  const bindings = await listWalletBindings(principalId);
  return {
    funding: bindings.find(binding => binding.purpose === "funding")?.walletAddress ?? null,
    payout: bindings.find(binding => binding.purpose === "payout")?.walletAddress ?? null,
    recovery: bindings.find(binding => binding.purpose === "recovery")?.walletAddress ?? null,
  };
}

export async function requireActiveWalletBinding(principalId: string, purpose: WalletBindingPurpose) {
  const bindings = await getWalletBindingAddresses(principalId);
  const address = bindings[purpose];
  if (!address) {
    throw new AuthError(`Add a ${purpose} wallet before continuing.`, 409);
  }
  return address;
}

export async function revokeWalletBinding(input: { bindingId: string; principalId: string; now?: Date }) {
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_wallet_bindings SET revoked_at = ?
          WHERE binding_id = ? AND principal_id = ? AND revoked_at IS NULL RETURNING binding_id`,
    args: [input.now ?? new Date(), input.bindingId, input.principalId],
  });
  if (result.rowCount !== 1) throw new AuthError("Wallet binding was not found.", 404);
  await appendSecurityAuditEvent({
    action: "wallet.binding_revoked",
    actorKind: "principal",
    actorReference: input.principalId,
    assuranceMethod: "rateloop_session",
    metadata: { bindingId: input.bindingId },
    purpose: "wallet_binding",
    reason: "user_revocation",
    result: "success",
    scopeId: input.principalId,
    scopeKind: "identity",
    targetId: input.bindingId,
    targetKind: "wallet_binding",
  });
}

export function __setWalletSignatureVerifierForTests(
  value: ((input: { address: Address; message: string; signature: Hex }) => Promise<boolean>) | null,
) {
  signatureVerifierOverride = value;
}
