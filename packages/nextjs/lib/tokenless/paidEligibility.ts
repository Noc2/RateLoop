import { CredentialIssuerAbi, TokenlessPanelAbi } from "@rateloop/contracts/tokenless";
import {
  HUMAN_ASSURANCE_CAPABILITIES,
  type HumanAssuranceAudiencePolicy,
  type HumanAssuranceCapability,
  type HumanAssuranceReviewerSource,
} from "@rateloop/sdk";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  verify,
} from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { type Address, type Hex, createPublicClient, encodePacked, getAddress, http, keccak256 } from "viem";
import { type LocalAccount, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getAuthOrigin } from "~~/lib/auth/session";
import { dbClient, dbPool } from "~~/lib/db";
import {
  type CapabilityAdmissionEvidence,
  evaluateFrozenAdmissionPolicy,
  freezeAdmissionPolicy,
} from "~~/lib/tokenless/admissionPolicy";
import {
  createAwsKmsEthereumAccount,
  loadAwsKmsEthereumAccountConfiguration,
} from "~~/lib/tokenless/chain/awsKmsAccount";
import { isOpaqueSubjectReference } from "~~/lib/tokenless/opaqueReferences";
import {
  requirePaidReviewEligibility,
  requirePaidReviewEligibilityInTransaction,
} from "~~/lib/tokenless/paidReviewEligibilityPreflight";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const COUNTRY = /^[A-Z]{2}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,160}$/;
const PROVIDER_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_PROVIDER_LIFETIME_MS = 370 * 24 * 60 * 60_000;
const MAX_VOUCHER_LIFETIME_MS = 10 * 60_000;

type QueryRow = Record<string, unknown>;

export type VerifiedEligibilityAssertion = {
  providerId: string;
  assertionId: string;
  subjectId: string;
  accountAddress: Address;
  capabilities: HumanAssuranceCapability[];
  minimumAgeVerified: number | null;
  documentIssuingCountry: string | null;
  nationalityCountry: string | null;
  verifiedResidenceCountry: string | null;
  evidenceVerifiedAt: Date;
  evidenceExpiresAt: Date;
  sanctionsStatus: "clear" | "review" | "match";
  sanctionsReference: string;
  sanctionsScreenedAt: Date;
  sanctionsExpiresAt: Date;
  assertionHash: string;
};

export type EligibilityProvider = {
  verify(input: {
    provider: string;
    payload: string;
    signature: string;
    now: Date;
  }): Promise<VerifiedEligibilityAssertion>;
};

export type EligibilitySubmission = {
  providerState?: string;
  /** Development/test injection only. Production clients use providerState from the handoff. */
  providerResult?: { provider: string; payload: string; signature: string };
  sanctionsConsent: true;
  declaredResidenceCountry: string;
  taxResidenceCountry: string;
  payoutAccount: string;
  dac7?: {
    fullName: string;
    birthDate: string;
    streetAddress: string;
    city: string;
    postalCode: string;
    tin?: string;
    noTinReason?: string;
  };
};

export type VoucherRequest = {
  idempotencyKey: string;
  roundId: string;
  contentId: Hex;
  voteKey: Address;
  reviewerSource: Exclude<HumanAssuranceReviewerSource, "hybrid">;
};

type VaultConfig = { currentVersion: string; keys: Map<string, Buffer> };
type ProviderReferenceKeyring = { currentVersion: string; keys: Map<string, Buffer> };
type VaultDomain = "provider_evidence" | "tax_records" | "vote_mapping";
type VaultDomains = Record<VaultDomain, VaultConfig>;
type IssuerConfig = {
  chainId: number;
  panelAddress: Address;
  issuerAddress: Address;
  issuerEpoch: bigint;
  signerAccount: LocalAccount;
  signerAddress: Address;
  rpcUrl: string;
};

type IssuerStateVerifier = (config: IssuerConfig) => Promise<void>;
type HandoffConfig = { startUrl: string; secret: Buffer };

let providerOverride: EligibilityProvider | null = null;
let vaultOverride: VaultDomains | null = null;
let providerReferenceKeyringOverride: ProviderReferenceKeyring | null = null;
let issuerConfigOverride: IssuerConfig | null = null;
let issuerStateVerifierOverride: IssuerStateVerifier | null = null;
let dac7PolicyOverride: ((country: string) => boolean) | null = null;
let handoffConfigOverride: HandoffConfig | null = null;
let integrityEvidenceOverride:
  | ((input: {
      accountAddress: Address;
      contentId: Hex;
      policy: HumanAssuranceAudiencePolicy;
      now: Date;
    }) => Promise<CapabilityAdmissionEvidence["integrity"] | null>)
  | null = null;

function stringValue(row: QueryRow | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function hash(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function parseDate(value: unknown, name: string) {
  if (typeof value !== "string")
    throw new TokenlessServiceError(`${name} is required.`, 400, "invalid_provider_result");
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) {
    throw new TokenlessServiceError(`${name} is invalid.`, 400, "invalid_provider_result");
  }
  return result;
}

const PROVIDER_CAPABILITIES = new Set<HumanAssuranceCapability>(
  HUMAN_ASSURANCE_CAPABILITIES.filter(
    capability => capability !== "account_control" && capability !== "customer_invitation",
  ),
);

function optionalCountry(value: unknown, name: string) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !COUNTRY.test(value.toUpperCase())) {
    throw new TokenlessServiceError(`${name} is invalid.`, 400, "invalid_provider_result");
  }
  return value.toUpperCase();
}

function parseProviderPayload(payload: string, providerId: string, now: Date): VerifiedEligibilityAssertion {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new TokenlessServiceError("The eligibility provider payload is invalid.", 400, "invalid_provider_result");
  }
  const sanctions = parsed.sanctions as Record<string, unknown> | undefined;
  const assertionId = typeof parsed.assertionId === "string" ? parsed.assertionId : "";
  const subjectId = typeof parsed.subjectId === "string" ? parsed.subjectId : "";
  const capabilities = Array.isArray(parsed.capabilities) ? [...new Set(parsed.capabilities)] : [];
  const evidenceVerifiedAt = parseDate(parsed.evidenceVerifiedAt, "evidenceVerifiedAt");
  const evidenceExpiresAt = parseDate(parsed.evidenceExpiresAt, "evidenceExpiresAt");
  const minimumAgeVerified =
    parsed.minimumAgeVerified === null || parsed.minimumAgeVerified === undefined
      ? null
      : Number(parsed.minimumAgeVerified);
  const documentIssuingCountry = optionalCountry(parsed.documentIssuingCountry, "documentIssuingCountry");
  const nationalityCountry = optionalCountry(parsed.nationalityCountry, "nationalityCountry");
  const verifiedResidenceCountry = optionalCountry(parsed.verifiedResidenceCountry, "verifiedResidenceCountry");
  const sanctionsScreenedAt = parseDate(sanctions?.screenedAt, "sanctions.screenedAt");
  const sanctionsExpiresAt = parseDate(sanctions?.expiresAt, "sanctions.expiresAt");
  const sanctionsStatus = sanctions?.status;
  if (
    parsed.version !== 2 ||
    parsed.provider !== providerId ||
    assertionId.length < 8 ||
    assertionId.length > 256 ||
    subjectId.length < 8 ||
    subjectId.length > 256 ||
    typeof parsed.accountAddress !== "string" ||
    !ADDRESS.test(parsed.accountAddress) ||
    capabilities.length === 0 ||
    capabilities.some(
      capability =>
        typeof capability !== "string" || !PROVIDER_CAPABILITIES.has(capability as HumanAssuranceCapability),
    ) ||
    (minimumAgeVerified !== null &&
      (!Number.isInteger(minimumAgeVerified) || minimumAgeVerified < 0 || minimumAgeVerified > 120)) ||
    (capabilities.includes("minimum_age") && minimumAgeVerified === null) ||
    !["clear", "review", "match"].includes(String(sanctionsStatus)) ||
    typeof sanctions?.reference !== "string" ||
    sanctions.reference.length < 4 ||
    evidenceVerifiedAt.getTime() > now.getTime() + PROVIDER_CLOCK_SKEW_MS ||
    sanctionsScreenedAt.getTime() > now.getTime() + PROVIDER_CLOCK_SKEW_MS ||
    evidenceExpiresAt <= now ||
    sanctionsExpiresAt <= now ||
    evidenceExpiresAt.getTime() - evidenceVerifiedAt.getTime() > MAX_PROVIDER_LIFETIME_MS ||
    sanctionsExpiresAt.getTime() - sanctionsScreenedAt.getTime() > MAX_PROVIDER_LIFETIME_MS
  ) {
    throw new TokenlessServiceError(
      "The eligibility provider result is incomplete or expired.",
      400,
      "invalid_provider_result",
    );
  }
  return {
    providerId,
    assertionId,
    subjectId,
    accountAddress: getAddress(parsed.accountAddress),
    capabilities: capabilities as HumanAssuranceCapability[],
    minimumAgeVerified,
    documentIssuingCountry,
    nationalityCountry,
    verifiedResidenceCountry,
    evidenceVerifiedAt,
    evidenceExpiresAt,
    sanctionsStatus: sanctionsStatus as VerifiedEligibilityAssertion["sanctionsStatus"],
    sanctionsReference: sanctions.reference,
    sanctionsScreenedAt,
    sanctionsExpiresAt,
    assertionHash: hash(payload),
  };
}

const signedProvider: EligibilityProvider = {
  async verify(input) {
    const providerId = process.env.TOKENLESS_ELIGIBILITY_PROVIDER_ID?.trim();
    const publicKey = process.env.TOKENLESS_ELIGIBILITY_PROVIDER_PUBLIC_KEY?.replaceAll("\\n", "\n").trim();
    if (
      !providerId ||
      !publicKey ||
      input.provider !== providerId ||
      input.payload.length > 65_536 ||
      input.signature.length > 2_048
    ) {
      throw new TokenlessServiceError(
        "The configured eligibility provider is unavailable.",
        503,
        "provider_unavailable",
      );
    }
    let valid = false;
    try {
      valid = verify(
        null,
        Buffer.from(input.payload, "base64url"),
        publicKey,
        Buffer.from(input.signature, "base64url"),
      );
    } catch {
      valid = false;
    }
    if (!valid)
      throw new TokenlessServiceError("The eligibility provider signature is invalid.", 401, "invalid_provider_result");
    return parseProviderPayload(input.payload, providerId, input.now);
  },
};

function getProvider() {
  if (providerOverride) return providerOverride;
  return {
    async verify(input) {
      if (input.provider !== "rateloop-development") return signedProvider.verify(input);
      if (
        process.env.NODE_ENV === "production" ||
        process.env.TOKENLESS_ELIGIBILITY_TEST_PROVIDER_ENABLED !== "true" ||
        input.signature !== "development-only-unsigned"
      ) {
        throw new TokenlessServiceError(
          "The development eligibility provider is disabled.",
          503,
          "provider_unavailable",
        );
      }
      return parseProviderPayload(input.payload, "rateloop-development", input.now);
    },
  } satisfies EligibilityProvider;
}

function getVaultConfig(domain: VaultDomain): VaultConfig {
  if (vaultOverride) return vaultOverride[domain];
  const prefix =
    domain === "provider_evidence"
      ? "TOKENLESS_PROVIDER_EVIDENCE_VAULT"
      : domain === "tax_records"
        ? "TOKENLESS_TAX_VAULT"
        : "TOKENLESS_VOTE_MAPPING_VAULT";
  if (process.env[`NEXT_PUBLIC_${prefix}_KEYS`]) {
    throw new Error(`${domain} vault keys must never use a NEXT_PUBLIC_ environment variable.`);
  }
  const currentVersion = process.env[`${prefix}_KEY_VERSION`]?.trim();
  const rawKeys = process.env[`${prefix}_KEYS`]?.trim();
  if (!currentVersion || !rawKeys) throw new Error("The eligibility vault keyring is not configured.");
  let source: Record<string, string>;
  try {
    source = JSON.parse(rawKeys) as Record<string, string>;
  } catch {
    throw new Error(`${prefix}_KEYS must be a JSON object of base64 keys.`);
  }
  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(source)) {
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32) throw new Error(`Eligibility vault key ${version} must contain exactly 32 bytes.`);
    keys.set(version, key);
  }
  if (!keys.has(currentVersion)) throw new Error("The current eligibility vault key version is missing.");
  return { currentVersion, keys };
}

function getProviderReferenceKeyring(): ProviderReferenceKeyring {
  if (providerReferenceKeyringOverride) return providerReferenceKeyringOverride;
  const prefix = "TOKENLESS_PROVIDER_SUBJECT_HMAC";
  if (process.env[`NEXT_PUBLIC_${prefix}_KEYS`] || process.env[`NEXT_PUBLIC_${prefix}_KEY_VERSION`]) {
    throw new Error("Provider reference HMAC keys must never use NEXT_PUBLIC_ environment variables.");
  }
  const currentVersion = process.env[`${prefix}_KEY_VERSION`]?.trim();
  const rawKeys = process.env[`${prefix}_KEYS`]?.trim();
  if (!currentVersion || !rawKeys) throw new Error("The provider reference HMAC keyring is not configured.");
  let source: Record<string, unknown>;
  try {
    source = JSON.parse(rawKeys) as Record<string, unknown>;
  } catch {
    throw new Error(`${prefix}_KEYS must be a JSON object of base64url keys.`);
  }
  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(source)) {
    if (typeof encoded !== "string") continue;
    const key = Buffer.from(encoded, "base64url");
    if (key.length === 32) keys.set(version, key);
  }
  if (!keys.has(currentVersion)) throw new Error("The current provider reference HMAC key version is missing.");
  return { currentVersion, keys };
}

function keyedProviderReference(
  keyring: ProviderReferenceKeyring,
  version: string,
  providerId: string,
  domain: "assertion-id" | "sanctions" | "subject",
  value: string,
) {
  return `hmac-sha256:${version}:${createHmac("sha256", keyring.keys.get(version)!)
    .update(`generic-provider:v3:${providerId}:${domain}:${value}`)
    .digest("hex")}`;
}

function allProviderReferences(
  keyring: ProviderReferenceKeyring,
  providerId: string,
  domain: "assertion-id" | "sanctions" | "subject",
  value: string,
) {
  return [...keyring.keys.keys()].sort().map(version => ({
    hash: keyedProviderReference(keyring, version, providerId, domain, value),
    version,
  }));
}

function sqlPlaceholders(start: number, count: number) {
  return Array.from({ length: count }, (_, index) => `$${start + index}`).join(",");
}

function encryptVaultValue(domain: VaultDomain, value: unknown) {
  const config = getVaultConfig(domain);
  const key = config.keys.get(config.currentVersion)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(stableJson(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`,
    keyDomain: domain,
    keyVersion: config.currentVersion,
  };
}

export async function ensureAssuranceRaterProfile(
  client: Pick<PoolClient, "query">,
  input: { principalId: string; payoutAccount: string },
  now = new Date(),
) {
  const normalizedAddress = getAddress(input.payoutAccount).toLowerCase();
  const wallet = await client.query(
    `SELECT binding_id FROM tokenless_wallet_bindings
     WHERE principal_id = $1 AND purpose = 'payout' AND lower(wallet_address) = $2
       AND revoked_at IS NULL LIMIT 1 FOR UPDATE`,
    [input.principalId, normalizedAddress],
  );
  if (wallet.rowCount !== 1) {
    throw new TokenlessServiceError(
      "The active payout wallet changed. Retry with the current wallet.",
      409,
      "payout_wallet_changed",
    );
  }
  const existing = await client.query(
    `SELECT rater_id, account_address FROM tokenless_rater_profiles
     WHERE principal_id = $1 LIMIT 1 FOR UPDATE`,
    [input.principalId],
  );
  const existingRow = existing.rows[0] as QueryRow | undefined;
  const existingId = stringValue(existingRow, "rater_id");
  if (existingId) {
    if (stringValue(existingRow, "account_address") !== normalizedAddress) {
      throw new TokenlessServiceError(
        "The rater payout mirror does not match its active wallet.",
        409,
        "payout_wallet_changed",
      );
    }
    return existingId;
  }

  const raterId = `rtr_${randomUUID().replaceAll("-", "")}`;
  const seedVault = encryptVaultValue("vote_mapping", { seed: `0x${randomBytes(32).toString("hex")}` });
  const inserted = await client.query(
    `INSERT INTO tokenless_rater_profiles
     (rater_id, principal_id, account_address, nullifier_seed_ciphertext,
      nullifier_key_version, nullifier_key_domain, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
     ON CONFLICT (principal_id) DO NOTHING
     RETURNING rater_id`,
    [
      raterId,
      input.principalId,
      normalizedAddress,
      seedVault.ciphertext,
      seedVault.keyVersion,
      seedVault.keyDomain,
      now,
    ],
  );
  const insertedId = stringValue(inserted.rows[0] as QueryRow | undefined, "rater_id");
  if (insertedId) return insertedId;

  const raced = await client.query(
    `SELECT rater_id FROM tokenless_rater_profiles
     WHERE principal_id = $1 LIMIT 1 FOR UPDATE`,
    [input.principalId],
  );
  const racedId = stringValue(raced.rows[0] as QueryRow | undefined, "rater_id");
  if (!racedId) throw new Error("Unable to create the minimal RateLoop human identity record.");
  return racedId;
}

function decryptVaultValue(value: string, keyVersion: string, domain: VaultDomain) {
  const key = getVaultConfig(domain).keys.get(keyVersion);
  if (!key) throw new Error(`Eligibility vault key ${keyVersion} is unavailable.`);
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) throw new Error("Invalid eligibility ciphertext.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]);
}

function getHandoffConfig(): HandoffConfig {
  if (handoffConfigOverride) return handoffConfigOverride;
  if (process.env.NEXT_PUBLIC_TOKENLESS_ELIGIBILITY_HANDOFF_SECRET) {
    throw new Error("The eligibility handoff secret must never use a NEXT_PUBLIC_ environment variable.");
  }
  const startUrl = process.env.TOKENLESS_ELIGIBILITY_PROVIDER_START_URL?.trim();
  const encodedSecret = process.env.TOKENLESS_ELIGIBILITY_HANDOFF_SECRET?.trim();
  if (!startUrl || !encodedSecret) {
    throw new TokenlessServiceError("Eligibility provider handoff is not configured.", 503, "provider_unavailable");
  }
  const parsedUrl = new URL(startUrl);
  if (process.env.NODE_ENV === "production" && parsedUrl.protocol !== "https:") {
    throw new Error("TOKENLESS_ELIGIBILITY_PROVIDER_START_URL must use HTTPS in production.");
  }
  const secret = Buffer.from(encodedSecret, "base64");
  if (secret.length < 32) throw new Error("TOKENLESS_ELIGIBILITY_HANDOFF_SECRET must contain at least 32 bytes.");
  return { startUrl: parsedUrl.toString(), secret };
}

function signHandoffState(raw: string, secret: Buffer) {
  return createHmac("sha256", secret).update(raw).digest("base64url");
}

function validateHandoffState(state: string, secret: Buffer) {
  if (state.length > 256) return false;
  const separator = state.lastIndexOf(".");
  if (separator < 1) return false;
  const raw = state.slice(0, separator);
  const supplied = Buffer.from(state.slice(separator + 1), "base64url");
  const expected = Buffer.from(signHandoffState(raw, secret), "base64url");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function createEligibilityProviderHandoff(
  input: { principalId: string; payoutAccount: string },
  now = new Date(),
) {
  const config = getHandoffConfig();
  const providerId =
    process.env.TOKENLESS_ELIGIBILITY_PROVIDER_ID?.trim() ||
    (process.env.NODE_ENV !== "production" && process.env.TOKENLESS_ELIGIBILITY_TEST_PROVIDER_ENABLED === "true"
      ? "rateloop-development"
      : "");
  if (!providerId) throw new TokenlessServiceError("Eligibility provider is unavailable.", 503, "provider_unavailable");
  const rawState = randomBytes(32).toString("base64url");
  const state = `${rawState}.${signHandoffState(rawState, config.secret)}`;
  const expiresAt = new Date(now.getTime() + 15 * 60_000);
  const callbackUrl = `${getAuthOrigin()}/api/rater/eligibility/provider/callback`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_eligibility_provider_handoffs
          (state_hash, principal_id, account_address, provider_id, status, expires_at, created_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
    args: [hash(state), input.principalId, getAddress(input.payoutAccount).toLowerCase(), providerId, expiresAt, now],
  });
  const startUrl = new URL(config.startUrl);
  startUrl.searchParams.set("state", state);
  startUrl.searchParams.set("callback_url", callbackUrl);
  startUrl.searchParams.set(
    "return_url",
    `${getAuthOrigin()}/human?tab=profile&section=paid-work&eligibility=provider-return`,
  );
  return { providerId, startUrl: startUrl.toString(), state, expiresAt };
}

export async function completeEligibilityProviderHandoff(input: {
  state: string;
  providerResult: { provider: string; payload: string; signature: string };
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const config = getHandoffConfig();
  if (!validateHandoffState(input.state, config.secret)) {
    throw new TokenlessServiceError("Eligibility handoff state is invalid.", 401, "invalid_provider_state");
  }
  const result = await dbClient.execute({
    sql: `SELECT account_address, provider_id, status, expires_at
          FROM tokenless_eligibility_provider_handoffs WHERE state_hash = ? LIMIT 1`,
    args: [hash(input.state)],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (
    !row ||
    stringValue(row, "status") !== "pending" ||
    new Date(String(row.expires_at)) <= now ||
    stringValue(row, "provider_id") !== input.providerResult.provider
  ) {
    throw new TokenlessServiceError(
      "Eligibility handoff state expired or was already used.",
      409,
      "invalid_provider_state",
    );
  }
  const assertion = await getProvider().verify({ ...input.providerResult, now });
  if (assertion.accountAddress.toLowerCase() !== stringValue(row, "account_address")) {
    throw new TokenlessServiceError(
      "The provider result belongs to another account.",
      403,
      "provider_account_mismatch",
    );
  }
  const vaulted = encryptVaultValue("provider_evidence", input.providerResult);
  const resultExpiresAt = new Date(
    Math.min(assertion.evidenceExpiresAt.getTime(), assertion.sanctionsExpiresAt.getTime()),
  );
  const updated = await dbClient.execute({
    sql: `UPDATE tokenless_eligibility_provider_handoffs
          SET status = 'verified', provider_result_ciphertext = ?, provider_result_key_version = ?,
              provider_result_key_domain = ?, provider_result_expires_at = ?, verified_at = ?
          WHERE state_hash = ? AND status = 'pending' AND expires_at > ?
          RETURNING state_hash`,
    args: [vaulted.ciphertext, vaulted.keyVersion, vaulted.keyDomain, resultExpiresAt, now, hash(input.state), now],
  });
  if (updated.rowCount !== 1) {
    throw new TokenlessServiceError("Eligibility handoff state was already used.", 409, "invalid_provider_state");
  }
  return { status: "verified" as const, state: input.state, expiresAt: resultExpiresAt };
}

async function resolveEligibilityAssertion(
  input: EligibilitySubmission,
  principalId: string,
  payoutAccount: Address,
  now: Date,
) {
  if (input.providerState) {
    const result = await dbClient.execute({
      sql: `SELECT provider_result_ciphertext, provider_result_key_version, provider_result_key_domain,
                   provider_result_expires_at, status,
                   principal_id, account_address
            FROM tokenless_eligibility_provider_handoffs WHERE state_hash = ? LIMIT 1`,
      args: [hash(input.providerState)],
    });
    const row = result.rows[0] as QueryRow | undefined;
    if (
      !row ||
      stringValue(row, "status") !== "verified" ||
      stringValue(row, "principal_id") !== principalId ||
      stringValue(row, "account_address") !== payoutAccount.toLowerCase() ||
      new Date(String(row.provider_result_expires_at)) <= now ||
      !stringValue(row, "provider_result_ciphertext") ||
      !stringValue(row, "provider_result_key_version") ||
      stringValue(row, "provider_result_key_domain") !== "provider_evidence"
    ) {
      throw new TokenlessServiceError(
        "Complete the identity provider handoff first.",
        403,
        "provider_handoff_required",
      );
    }
    const providerResult = JSON.parse(
      decryptVaultValue(
        String(row.provider_result_ciphertext),
        String(row.provider_result_key_version),
        "provider_evidence",
      ).toString("utf8"),
    ) as { provider: string; payload: string; signature: string };
    return { assertion: await getProvider().verify({ ...providerResult, now }), stateHash: hash(input.providerState) };
  }
  if (
    input.providerResult &&
    (providerOverride ||
      (process.env.NODE_ENV !== "production" && process.env.TOKENLESS_ELIGIBILITY_TEST_PROVIDER_ENABLED === "true"))
  ) {
    return { assertion: await getProvider().verify({ ...input.providerResult, now }), stateHash: null };
  }
  throw new TokenlessServiceError("Complete the identity provider handoff first.", 403, "provider_handoff_required");
}

const EU_COUNTRIES = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
]);

function requiresDac7(country: string) {
  if (dac7PolicyOverride) return dac7PolicyOverride(country);
  const policy = process.env.TOKENLESS_DAC7_POLICY?.trim().toLowerCase();
  if (policy === "all") return true;
  if (policy === "eu") return EU_COUNTRIES.has(country);
  if (policy === "configured") {
    const configured = new Set(
      (process.env.TOKENLESS_DAC7_REQUIRED_COUNTRIES ?? "")
        .split(",")
        .map(value => value.trim().toUpperCase())
        .filter(value => COUNTRY.test(value)),
    );
    if (configured.size === 0)
      throw new TokenlessServiceError("DAC7 policy is not configured.", 503, "policy_unavailable");
    return configured.has(country);
  }
  throw new TokenlessServiceError("DAC7 policy is not configured.", 503, "policy_unavailable");
}

function validateDac7(value: EligibilitySubmission["dac7"]) {
  if (!value)
    throw new TokenlessServiceError(
      "DAC7 details are required before paid tasks can be unlocked.",
      400,
      "dac7_required",
    );
  const required = [value.fullName, value.streetAddress, value.city, value.postalCode];
  if (required.some(item => typeof item !== "string" || !item.trim() || item.length > 300)) {
    throw new TokenlessServiceError("DAC7 details are incomplete.", 400, "dac7_incomplete");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.birthDate) || (!value.tin?.trim() && !value.noTinReason?.trim())) {
    throw new TokenlessServiceError("DAC7 birth date and TIN status are required.", 400, "dac7_incomplete");
  }
}

function eligibilityState(
  assertion: VerifiedEligibilityAssertion,
  declaredResidenceCountry: string,
  taxResidenceCountry: string,
) {
  if (
    !assertion.capabilities.includes("minimum_age") ||
    assertion.minimumAgeVerified === null ||
    assertion.minimumAgeVerified < 18
  ) {
    return { status: "blocked", reason: "minimum_age_not_verified", residenceTaxStatus: "unreviewed" };
  }
  if (assertion.sanctionsStatus === "match") {
    return { status: "blocked", reason: "sanctions_match", residenceTaxStatus: "unreviewed" };
  }
  if (assertion.sanctionsStatus === "review") {
    return { status: "review", reason: "sanctions_review", residenceTaxStatus: "unreviewed" };
  }
  if (assertion.verifiedResidenceCountry && assertion.verifiedResidenceCountry !== declaredResidenceCountry) {
    return { status: "review", reason: "verified_residence_mismatch", residenceTaxStatus: "review" };
  }
  if (declaredResidenceCountry !== taxResidenceCountry) {
    return { status: "review", reason: "residence_tax_review", residenceTaxStatus: "review" };
  }
  return { status: "eligible", reason: null, residenceTaxStatus: "consistent" };
}

function publicBlockedReason(reason: string | null) {
  return reason?.startsWith("sanctions_") ? "legal_eligibility_review" : reason;
}

export async function submitPaidEligibility(input: {
  principalId: string;
  payoutAccount: string;
  submission: EligibilitySubmission;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const payoutAddress = getAddress(input.payoutAccount);
  if (input.submission.sanctionsConsent !== true) {
    throw new TokenlessServiceError(
      "Sanctions screening consent is required for paid tasks.",
      400,
      "sanctions_consent_required",
    );
  }
  const payoutAccount = getAddress(input.submission.payoutAccount);
  if (payoutAccount !== payoutAddress) {
    throw new TokenlessServiceError(
      "The payout wallet must be the signed-in account.",
      403,
      "payout_ownership_mismatch",
    );
  }
  const taxCountry = input.submission.taxResidenceCountry.toUpperCase();
  const declaredResidenceCountry = input.submission.declaredResidenceCountry.toUpperCase();
  if (!COUNTRY.test(taxCountry) || !COUNTRY.test(declaredResidenceCountry)) {
    throw new TokenlessServiceError("Residence and tax countries are invalid.", 400, "tax_profile_invalid");
  }
  const resolvedAssertion = await resolveEligibilityAssertion(input.submission, input.principalId, payoutAddress, now);
  const assertion = resolvedAssertion.assertion;
  if (assertion.accountAddress !== payoutAddress) {
    throw new TokenlessServiceError(
      "The provider result belongs to another account.",
      403,
      "provider_account_mismatch",
    );
  }
  const dac7Required = requiresDac7(taxCountry);
  if (dac7Required) validateDac7(input.submission.dac7);
  const dac7Vault =
    dac7Required && input.submission.dac7
      ? encryptVaultValue("tax_records", {
          ...input.submission.dac7,
          declaredResidenceCountry,
          taxResidenceCountry: taxCountry,
        })
      : null;
  const seedVault = encryptVaultValue("vote_mapping", { seed: `0x${randomBytes(32).toString("hex")}` });
  const providerEvidenceVault = encryptVaultValue("provider_evidence", {
    providerId: assertion.providerId,
    assertionId: assertion.assertionId,
    subjectId: assertion.subjectId,
    capabilities: assertion.capabilities,
    minimumAgeVerified: assertion.minimumAgeVerified,
    documentIssuingCountry: assertion.documentIssuingCountry,
    nationalityCountry: assertion.nationalityCountry,
    verifiedResidenceCountry: assertion.verifiedResidenceCountry,
    evidenceVerifiedAt: assertion.evidenceVerifiedAt.toISOString(),
    evidenceExpiresAt: assertion.evidenceExpiresAt.toISOString(),
  });
  const referenceKeyring = getProviderReferenceKeyring();
  const subjectReferences = allProviderReferences(
    referenceKeyring,
    assertion.providerId,
    "subject",
    assertion.subjectId,
  );
  const assertionIdReferences = allProviderReferences(
    referenceKeyring,
    assertion.providerId,
    "assertion-id",
    assertion.assertionId,
  );
  const currentSubjectReference = subjectReferences.find(
    reference => reference.version === referenceKeyring.currentVersion,
  )!;
  const currentAssertionIdReference = assertionIdReferences.find(
    reference => reference.version === referenceKeyring.currentVersion,
  )!;
  const providerNamespace = "generic:v3";
  const capabilities = [...new Set<HumanAssuranceCapability>(["account_control", ...assertion.capabilities])].sort();
  const state = eligibilityState(assertion, declaredResidenceCountry, taxCountry);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const activePayout = await client.query(
      `SELECT binding_id FROM tokenless_wallet_bindings
       WHERE principal_id = $1 AND purpose = 'payout' AND lower(wallet_address) = $2
         AND revoked_at IS NULL LIMIT 1 FOR UPDATE`,
      [input.principalId, payoutAddress.toLowerCase()],
    );
    if (activePayout.rowCount !== 1) {
      throw new TokenlessServiceError(
        "The payout wallet changed while eligibility was prepared. Retry with the current wallet.",
        409,
        "payout_wallet_changed",
      );
    }
    const existing = await client.query(
      `SELECT rater_id, account_address, nullifier_key_domain
       FROM tokenless_rater_profiles WHERE principal_id = $1 FOR UPDATE`,
      [input.principalId],
    );
    const existingRow = existing.rows[0] as QueryRow | undefined;
    if (existingRow && stringValue(existingRow, "account_address") !== payoutAddress.toLowerCase()) {
      throw new TokenlessServiceError(
        "The rater payout mirror does not match its active wallet.",
        409,
        "payout_wallet_changed",
      );
    }
    const raterId = stringValue(existingRow, "rater_id") ?? `rtr_${randomUUID().replaceAll("-", "")}`;
    const subjectHashes = subjectReferences.map(reference => reference.hash);
    const bindingResult = await client.query(
      `SELECT binding_id, rater_id, subject_reference_hash
       FROM tokenless_provider_subject_bindings
       WHERE provider_id = $1 AND provider_namespace = $2 AND status = 'active'
         AND (rater_id = $3 OR subject_reference_hash IN (${sqlPlaceholders(4, subjectHashes.length)}))
       FOR UPDATE`,
      [assertion.providerId, providerNamespace, raterId, ...subjectHashes],
    );
    const bindingRows = bindingResult.rows as QueryRow[];
    const accountBinding = bindingRows.find(row => stringValue(row, "rater_id") === raterId);
    const subjectOwner = bindingRows.find(row => subjectHashes.includes(stringValue(row, "subject_reference_hash")!));
    if (
      (subjectOwner && stringValue(subjectOwner, "rater_id") !== raterId) ||
      (accountBinding && !subjectHashes.includes(stringValue(accountBinding, "subject_reference_hash")!))
    ) {
      throw new TokenlessServiceError(
        "This account is already bound to another verified identity.",
        409,
        "identity_binding_conflict",
      );
    }
    if (!existingRow) {
      await client.query(
        `INSERT INTO tokenless_rater_profiles
         (rater_id, principal_id, account_address, nullifier_seed_ciphertext,
          nullifier_key_version, nullifier_key_domain, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [
          raterId,
          input.principalId,
          payoutAddress.toLowerCase(),
          seedVault.ciphertext,
          seedVault.keyVersion,
          seedVault.keyDomain,
          now,
        ],
      );
    } else if (stringValue(existingRow, "nullifier_key_domain") !== "vote_mapping") {
      await client.query(
        `UPDATE tokenless_rater_profiles
         SET nullifier_seed_ciphertext = $1, nullifier_key_version = $2,
             nullifier_key_domain = $3, updated_at = $4
         WHERE rater_id = $5`,
        [seedVault.ciphertext, seedVault.keyVersion, seedVault.keyDomain, now, raterId],
      );
    }
    const bindingId = stringValue(accountBinding, "binding_id") ?? `bind_${currentSubjectReference.hash.slice(-48)}`;
    if (accountBinding) {
      await client.query(
        `UPDATE tokenless_provider_subject_bindings
         SET subject_reference_hash = $1, subject_reference_scheme = 'hmac-sha256-v1',
             subject_reference_key_version = $2, last_verified_at = $3, updated_at = $4
         WHERE binding_id = $5`,
        [currentSubjectReference.hash, currentSubjectReference.version, assertion.evidenceVerifiedAt, now, bindingId],
      );
    } else {
      await client.query(
        `INSERT INTO tokenless_provider_subject_bindings
         (binding_id, rater_id, provider_id, provider_namespace, subject_reference_hash,
          subject_reference_scheme, subject_reference_key_version, status, bound_at,
          last_verified_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'hmac-sha256-v1',$6,'active',$7,$7,$8,$8)`,
        [
          bindingId,
          raterId,
          assertion.providerId,
          providerNamespace,
          currentSubjectReference.hash,
          currentSubjectReference.version,
          assertion.evidenceVerifiedAt,
          now,
        ],
      );
    }
    const assuranceAssertionId = `assert_${currentAssertionIdReference.hash.slice(-48)}`;
    const assertionHashes = assertionIdReferences.map(reference => reference.hash);
    const existingAssertionResult = await client.query(
      `SELECT assertion_id, rater_id, binding_id, provider_assertion_hash
       FROM tokenless_assurance_assertions
       WHERE provider_id = $1 AND provider_namespace = $2
         AND provider_assertion_id_hash IN (${sqlPlaceholders(3, assertionHashes.length)})
       LIMIT 1 FOR UPDATE`,
      [assertion.providerId, providerNamespace, ...assertionHashes],
    );
    const existingAssertion = existingAssertionResult.rows[0] as QueryRow | undefined;
    if (
      existingAssertion &&
      (stringValue(existingAssertion, "rater_id") !== raterId ||
        stringValue(existingAssertion, "binding_id") !== bindingId ||
        stringValue(existingAssertion, "provider_assertion_hash") !== assertion.assertionHash)
    ) {
      throw new TokenlessServiceError(
        "This provider assertion is already bound to different immutable evidence.",
        409,
        "identity_already_bound",
      );
    }
    const assertionValues = [
      JSON.stringify(capabilities),
      providerEvidenceVault.ciphertext,
      providerEvidenceVault.keyVersion,
      providerEvidenceVault.keyDomain,
      assertion.evidenceVerifiedAt,
      assertion.evidenceExpiresAt,
      assertion.minimumAgeVerified,
      assertion.documentIssuingCountry,
      assertion.nationalityCountry,
      assertion.verifiedResidenceCountry,
      now,
    ] as const;
    const assertionResult = existingAssertion
      ? await client.query(
          `UPDATE tokenless_assurance_assertions
           SET provider_assertion_id_hash = $1, provider_assertion_reference_scheme = 'hmac-sha256-v1',
               provider_assertion_key_version = $2, capabilities_json = $3,
               provider_evidence_ciphertext = $4, provider_evidence_key_version = $5,
               provider_evidence_key_domain = $6, evidence_verified_at = $7, evidence_expires_at = $8,
               minimum_age_verified = $9, document_issuing_country = $10, nationality_country = $11,
               verified_residence_country = $12, status = 'active', revoked_at = NULL, updated_at = $13
           WHERE assertion_id = $14 RETURNING assertion_id`,
          [
            currentAssertionIdReference.hash,
            currentAssertionIdReference.version,
            ...assertionValues,
            stringValue(existingAssertion, "assertion_id"),
          ],
        )
      : await client.query(
          `INSERT INTO tokenless_assurance_assertions
           (assertion_id, rater_id, binding_id, provider_id, provider_namespace,
            provider_assertion_hash, provider_assertion_id_hash, provider_assertion_reference_scheme,
            provider_assertion_key_version, capabilities_json, provider_evidence_ciphertext,
            provider_evidence_key_version, provider_evidence_key_domain, evidence_verified_at,
            evidence_expires_at, minimum_age_verified, document_issuing_country, nationality_country,
            verified_residence_country, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'hmac-sha256-v1',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'active',$19,$19)
           RETURNING assertion_id`,
          [
            assuranceAssertionId,
            raterId,
            bindingId,
            assertion.providerId,
            providerNamespace,
            assertion.assertionHash,
            currentAssertionIdReference.hash,
            currentAssertionIdReference.version,
            ...assertionValues,
          ],
        );
    if (assertionResult.rowCount !== 1) {
      throw new TokenlessServiceError(
        "This provider assertion is already bound to different immutable evidence.",
        409,
        "identity_already_bound",
      );
    }
    await client.query(
      `INSERT INTO tokenless_legal_eligibility
       (rater_id, minimum_age_verified, age_evidence_verified_at, age_evidence_expires_at,
        verified_residence_country, declared_residence_country, tax_residence_country,
        residence_tax_status, tax_profile_status, dac7_status, tax_vault_ciphertext,
        tax_vault_key_version, tax_vault_key_domain, sanctions_consent_at, sanctions_status,
        sanctions_reference_hash, sanctions_screened_at, sanctions_expires_at,
        eligibility_status, blocked_reason, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'complete',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)
       ON CONFLICT (rater_id) DO UPDATE SET
        minimum_age_verified = EXCLUDED.minimum_age_verified,
        age_evidence_verified_at = EXCLUDED.age_evidence_verified_at,
        age_evidence_expires_at = EXCLUDED.age_evidence_expires_at,
        verified_residence_country = EXCLUDED.verified_residence_country,
        declared_residence_country = EXCLUDED.declared_residence_country,
        tax_residence_country = EXCLUDED.tax_residence_country,
        residence_tax_status = EXCLUDED.residence_tax_status,
        tax_profile_status = EXCLUDED.tax_profile_status, dac7_status = EXCLUDED.dac7_status,
        tax_vault_ciphertext = EXCLUDED.tax_vault_ciphertext,
        tax_vault_key_version = EXCLUDED.tax_vault_key_version,
        tax_vault_key_domain = EXCLUDED.tax_vault_key_domain,
        sanctions_consent_at = EXCLUDED.sanctions_consent_at,
        sanctions_status = EXCLUDED.sanctions_status,
        sanctions_reference_hash = EXCLUDED.sanctions_reference_hash,
        sanctions_screened_at = EXCLUDED.sanctions_screened_at,
        sanctions_expires_at = EXCLUDED.sanctions_expires_at,
        eligibility_status = EXCLUDED.eligibility_status,
        blocked_reason = EXCLUDED.blocked_reason, updated_at = EXCLUDED.updated_at`,
      [
        raterId,
        assertion.minimumAgeVerified,
        assertion.evidenceVerifiedAt,
        assertion.evidenceExpiresAt,
        assertion.verifiedResidenceCountry,
        declaredResidenceCountry,
        taxCountry,
        state.residenceTaxStatus,
        dac7Required ? "complete" : "not_required",
        dac7Vault?.ciphertext ?? null,
        dac7Vault?.keyVersion ?? null,
        dac7Vault?.keyDomain ?? null,
        now,
        assertion.sanctionsStatus,
        keyedProviderReference(
          referenceKeyring,
          referenceKeyring.currentVersion,
          assertion.providerId,
          "sanctions",
          assertion.sanctionsReference,
        ).split(":")[2],
        assertion.sanctionsScreenedAt,
        assertion.sanctionsExpiresAt,
        state.status,
        state.reason,
        now,
      ],
    );
    await client.query(
      `INSERT INTO tokenless_payout_eligibility
       (rater_id, payout_account, payout_ownership_method, payout_verified_at,
        payout_expires_at, eligibility_status, blocked_reason, created_at, updated_at)
       VALUES ($1,$2,'siwe_base_account_session',$3,NULL,'ready',NULL,$3,$3)
       ON CONFLICT (rater_id) DO UPDATE SET payout_account = EXCLUDED.payout_account,
        payout_ownership_method = EXCLUDED.payout_ownership_method,
        payout_verified_at = EXCLUDED.payout_verified_at, payout_expires_at = NULL,
        eligibility_status = 'ready', blocked_reason = NULL, updated_at = EXCLUDED.updated_at`,
      [raterId, payoutAddress.toLowerCase(), now],
    );
    await client.query(
      `INSERT INTO tokenless_reviewer_qualifications
       (qualification_id, rater_id, reviewer_source, qualification_kind, cohort_ids_json,
        qualification_keys_json, verified_at, expires_at, status, created_at, updated_at)
       VALUES ($1,$2,'rateloop_network','legacy_snapshot','[]','[]',$3,$4,'active',$5,$5)
       ON CONFLICT (qualification_id) DO UPDATE SET verified_at = EXCLUDED.verified_at,
        expires_at = EXCLUDED.expires_at, status = 'active', revoked_at = NULL, updated_at = EXCLUDED.updated_at`,
      [`qual_legacy_${raterId}`, raterId, assertion.evidenceVerifiedAt, assertion.evidenceExpiresAt, now],
    );
    if (resolvedAssertion.stateHash) {
      const consumed = await client.query(
        `UPDATE tokenless_eligibility_provider_handoffs SET status = 'consumed', consumed_at = $1
         WHERE state_hash = $2 AND status = 'verified'`,
        [now, resolvedAssertion.stateHash],
      );
      if (consumed.rowCount !== 1) {
        throw new TokenlessServiceError("The provider handoff was already consumed.", 409, "invalid_provider_state");
      }
    }
    await client.query("COMMIT");
    return {
      status: state.status,
      blockedReason: publicBlockedReason(state.reason),
      capabilities,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new TokenlessServiceError(
        "This identity or provider result is already bound to another rater.",
        409,
        "identity_already_bound",
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getPaidEligibility(principalId: string, now = new Date()) {
  const result = await dbClient.execute({
    sql: `SELECT p.rater_id, l.minimum_age_verified, l.age_evidence_expires_at,
                 l.verified_residence_country, l.declared_residence_country,
                 l.tax_residence_country, l.residence_tax_status, l.tax_profile_status,
                 l.dac7_status, l.sanctions_status, l.sanctions_expires_at,
                 l.eligibility_status, l.blocked_reason, l.updated_at,
                 pe.payout_account, pe.payout_ownership_method, pe.payout_expires_at,
                 pe.eligibility_status AS payout_eligibility_status,
                 wb.wallet_address AS active_payout_account
          FROM tokenless_rater_profiles p
          JOIN tokenless_legal_eligibility l ON l.rater_id = p.rater_id
          JOIN tokenless_payout_eligibility pe ON pe.rater_id = p.rater_id
          LEFT JOIN tokenless_wallet_bindings wb ON wb.principal_id = p.principal_id
            AND wb.purpose = 'payout' AND wb.revoked_at IS NULL
          WHERE p.principal_id = ? LIMIT 1`,
    args: [principalId],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row) return { status: "not_started" };
  const assertionsResult = await dbClient.execute({
    sql: `SELECT provider_id, provider_namespace, capabilities_json, evidence_expires_at,
                 assurance_validity_model, document_issuing_country,
                 nationality_country, verified_residence_country
          FROM tokenless_assurance_assertions
          WHERE rater_id = ? AND status = 'active'
          ORDER BY evidence_verified_at DESC`,
    args: [stringValue(row, "rater_id")!],
  });
  const assertions = assertionsResult.rows as QueryRow[];
  const currentAssertions = assertions.filter(
    value =>
      stringValue(value, "assurance_validity_model") === "durable_enrollment" ||
      new Date(String(value.evidence_expires_at)) > now,
  );
  const capabilities = [
    ...new Set(
      currentAssertions.flatMap(value => JSON.parse(String(value.capabilities_json)) as HumanAssuranceCapability[]),
    ),
  ].sort();
  const assuranceProviders = [...new Set(currentAssertions.map(value => String(value.provider_id)))].sort();
  const latestAssertion = assertions[0];
  // Human-assurance assertions are independent from the legal age gate. A
  // short-lived World ID (or future provider) assertion must not expire an
  // otherwise-current legal eligibility record.
  const evidenceExpiresAt = new Date(String(row.age_evidence_expires_at));
  const sanctionsExpiresAt = new Date(String(row.sanctions_expires_at));
  const persisted = stringValue(row, "eligibility_status")!;
  const currentStatus =
    persisted === "eligible" &&
    (evidenceExpiresAt <= now ||
      sanctionsExpiresAt <= now ||
      (row.payout_expires_at !== null && new Date(String(row.payout_expires_at)) <= now) ||
      stringValue(row, "payout_eligibility_status") !== "ready" ||
      stringValue(row, "active_payout_account") !== stringValue(row, "payout_account"))
      ? "expired"
      : persisted;
  return {
    status: currentStatus,
    blockedReason: publicBlockedReason(stringValue(row, "blocked_reason")),
    capabilities,
    assuranceProviders,
    evidenceExpiresAt,
    minimumAgeVerified: row.minimum_age_verified === null ? null : Number(row.minimum_age_verified),
    documentIssuingCountry: stringValue(latestAssertion, "document_issuing_country"),
    nationalityCountry: stringValue(latestAssertion, "nationality_country"),
    verifiedResidenceCountry:
      stringValue(latestAssertion, "verified_residence_country") ?? stringValue(row, "verified_residence_country"),
    declaredResidenceCountry: stringValue(row, "declared_residence_country"),
    taxResidenceCountry: stringValue(row, "tax_residence_country"),
    residenceTaxStatus: stringValue(row, "residence_tax_status"),
    taxProfileStatus: stringValue(row, "tax_profile_status"),
    dac7Status: stringValue(row, "dac7_status"),
    screeningStatus: stringValue(row, "sanctions_status") === "clear" ? "clear" : "review_required",
    sanctionsExpiresAt,
    payoutAccount: getAddress(String(row.payout_account)),
    payoutOwnershipMethod: stringValue(row, "payout_ownership_method"),
    updatedAt: new Date(String(row.updated_at)),
  };
}

function getIssuerConfig(): IssuerConfig {
  if (issuerConfigOverride) return issuerConfigOverride;
  if (process.env.NEXT_PUBLIC_TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY) {
    throw new Error("The voucher signer secret must never use a NEXT_PUBLIC_ environment variable.");
  }
  const signerPrivateKey = process.env.TOKENLESS_CREDENTIAL_ISSUER_SIGNER_PRIVATE_KEY as Hex | undefined;
  const managedKeyResource = process.env.TOKENLESS_CREDENTIAL_ISSUER_KMS_KEY_RESOURCE?.trim();
  const epoch = process.env.TOKENLESS_VOUCHER_ISSUER_EPOCH;
  const panel = process.env.TOKENLESS_PANEL_ADDRESS;
  const issuer = process.env.TOKENLESS_CREDENTIAL_ISSUER_ADDRESS;
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL?.trim();
  if (
    (signerPrivateKey && managedKeyResource) ||
    (!managedKeyResource && (!signerPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(signerPrivateKey))) ||
    !epoch ||
    !panel ||
    !issuer ||
    !rpcUrl
  ) {
    throw new TokenlessServiceError("Voucher issuer configuration is incomplete.", 503, "issuer_unavailable");
  }
  const signerAccount = managedKeyResource
    ? createAwsKmsEthereumAccount({
        configuration: loadAwsKmsEthereumAccountConfiguration({ role: "CREDENTIAL_ISSUER" }),
      })
    : privateKeyToAccount(signerPrivateKey!);
  return {
    chainId: baseSepolia.id,
    panelAddress: getAddress(panel),
    issuerAddress: getAddress(issuer),
    issuerEpoch: BigInt(epoch),
    signerAccount,
    signerAddress: signerAccount.address,
    rpcUrl,
  };
}

const verifyLiveIssuerState: IssuerStateVerifier = async config => {
  const client = createPublicClient({ chain: baseSepolia, transport: http(config.rpcUrl) });
  const [panelIssuer, accepted, signer] = await Promise.all([
    client.readContract({ address: config.panelAddress, abi: TokenlessPanelAbi, functionName: "credentialIssuer" }),
    client.readContract({
      address: config.issuerAddress,
      abi: CredentialIssuerAbi,
      functionName: "isEpochAccepted",
      args: [config.issuerEpoch],
    }),
    client.readContract({
      address: config.issuerAddress,
      abi: CredentialIssuerAbi,
      functionName: "signerAtEpoch",
      args: [config.issuerEpoch],
    }),
  ]);
  if (
    getAddress(String(panelIssuer)) !== config.issuerAddress ||
    accepted !== true ||
    getAddress(String(signer)) !== config.signerAddress
  ) {
    throw new TokenlessServiceError(
      "The configured voucher signer is not accepted by this panel.",
      503,
      "issuer_mismatch",
    );
  }
};

async function loadVoucherEligibility(
  principalId: string,
  reviewerSource: VoucherRequest["reviewerSource"],
  now: Date,
) {
  const preflight = await requirePaidReviewEligibility(principalId, now);
  const result = await dbClient.execute({
    sql: `SELECT rater_id, nullifier_seed_ciphertext, nullifier_key_version, nullifier_key_domain
          FROM tokenless_rater_profiles WHERE rater_id = ? AND principal_id = ? LIMIT 1`,
    args: [preflight.raterId, principalId],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row || stringValue(row, "nullifier_key_domain") !== "vote_mapping") {
    throw new TokenlessServiceError(
      "Paid-task eligibility must be completed before a voucher can be issued.",
      403,
      "paid_eligibility_required",
    );
  }
  const raterId = stringValue(row, "rater_id")!;
  const assertionsResult = await dbClient.execute({
    sql: `SELECT a.assertion_id, a.binding_id, a.provider_id, a.provider_namespace,
                 b.subject_reference_hash, a.capabilities_json, a.evidence_verified_at,
                 a.evidence_expires_at, a.assurance_validity_model
          FROM tokenless_assurance_assertions a
          JOIN tokenless_provider_subject_bindings b ON b.binding_id = a.binding_id
          WHERE a.rater_id = ? AND a.status = 'active' AND b.status = 'active'
            AND (a.assurance_validity_model = 'durable_enrollment' OR a.evidence_expires_at > ?)`,
    args: [raterId, now],
  });
  const assertions = (assertionsResult.rows as QueryRow[]).map(assertion => ({
    assertionId: stringValue(assertion, "assertion_id")!,
    bindingId: stringValue(assertion, "binding_id")!,
    providerId: stringValue(assertion, "provider_id")!,
    providerNamespace: stringValue(assertion, "provider_namespace")!,
    subjectReferenceHash: stringValue(assertion, "subject_reference_hash")!,
    capabilities: JSON.parse(String(assertion.capabilities_json)) as HumanAssuranceCapability[],
    verifiedAt: new Date(String(assertion.evidence_verified_at)),
    expiresAt: new Date(String(assertion.evidence_expires_at)),
    validityModel: stringValue(assertion, "assurance_validity_model") as "expiring" | "durable_enrollment",
  }));
  const qualificationsResult = await dbClient.execute({
    sql: `SELECT qualification_id, reviewer_source, qualification_kind, cohort_ids_json,
                 qualification_keys_json, verified_at, expires_at
          FROM tokenless_reviewer_qualifications
          WHERE rater_id = ? AND reviewer_source = ? AND status = 'active'
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY verified_at DESC, qualification_id ASC`,
    args: [raterId, reviewerSource, now],
  });
  const qualificationRows = qualificationsResult.rows as QueryRow[];
  const qualificationRecords = qualificationRows.map(value => {
    const parsed = JSON.parse(String(value.qualification_keys_json)) as Array<
      string | { key: string; value: string | number | boolean | string[] }
    >;
    return {
      qualificationId: stringValue(value, "qualification_id")!,
      qualificationKind: stringValue(value, "qualification_kind")!,
      reviewerSource,
      cohortIds: JSON.parse(String(value.cohort_ids_json)) as string[],
      qualifications: parsed.map(entry => (typeof entry === "string" ? { key: entry, value: true } : entry)),
      verifiedAt: new Date(String(value.verified_at)),
      expiresAt: value.expires_at === null ? null : new Date(String(value.expires_at)),
    };
  });
  const cohortIds = [...new Set(qualificationRecords.flatMap(value => value.cohortIds))].sort();
  const qualifications = qualificationRecords.flatMap(value => value.qualifications);
  if (qualificationRecords.length === 0) {
    throw new TokenlessServiceError(
      "Current reviewer qualification evidence is required before a voucher can be issued.",
      403,
      "paid_eligibility_required",
    );
  }
  return { row, assertions, cohortIds, qualificationRecords, qualifications, reviewerSource, preflight };
}

async function loadVoucherIntegrityEvidence(input: {
  accountAddress: Address;
  contentId: Hex;
  policy: HumanAssuranceAudiencePolicy;
  now: Date;
}): Promise<CapabilityAdmissionEvidence["integrity"] | null> {
  if (integrityEvidenceOverride) return integrityEvidenceOverride(input);
  const constraint = input.policy.integrity;
  if (!constraint) return null;
  const result = await dbClient.execute({
    sql: `SELECT a.integrity_provenance_json
          FROM tokenless_assurance_assignments a
          JOIN tokenless_assurance_run_subpanels sp ON sp.subpanel_id = a.subpanel_id
          JOIN tokenless_assurance_run_cases rc ON rc.run_id = a.run_id
          WHERE a.reviewer_account_address = ? AND a.source = 'rateloop_network'
            AND a.paid_assignment = true AND a.status IN ('reserved', 'accepted')
            AND rc.content_id = ? AND sp.policy_hash = ?
            AND a.integrity_epoch_id = ? AND a.integrity_manifest_hash = ?
            AND a.integrity_provenance_json IS NOT NULL
            AND ((a.status = 'reserved' AND a.reservation_expires_at > ?)
              OR (a.status = 'accepted' AND a.assignment_expires_at > ?))
          ORDER BY a.created_at DESC LIMIT 1`,
    args: [
      input.accountAddress.toLowerCase(),
      input.contentId.toLowerCase(),
      freezeAdmissionPolicy(input.policy).policyHash,
      constraint.epochId,
      constraint.epochManifestHash,
      input.now,
      input.now,
    ],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row) return null;
  try {
    const provenance = JSON.parse(String(row.integrity_provenance_json)) as Record<string, unknown>;
    const providerSubjectHashes = Array.isArray(provenance.providerSubjectHashes)
      ? provenance.providerSubjectHashes.map(String)
      : [];
    const riskBand = String(provenance.riskBand);
    const recentCoassignments = Number(provenance.recentCoassignments);
    const activeCustomerAssignments = Number(provenance.activeCustomerAssignments);
    if (
      provenance.epochId !== constraint.epochId ||
      provenance.epochManifestHash !== constraint.epochManifestHash ||
      typeof provenance.reviewerLookup !== "string" ||
      typeof provenance.clusterPseudonym !== "string" ||
      !["low", "medium", "high"].includes(riskBand) ||
      providerSubjectHashes.length === 0 ||
      providerSubjectHashes.some(value => !isOpaqueSubjectReference(value)) ||
      !Number.isSafeInteger(recentCoassignments) ||
      recentCoassignments < 0 ||
      !Number.isSafeInteger(activeCustomerAssignments) ||
      activeCustomerAssignments < 0
    ) {
      return null;
    }
    return {
      epochId: constraint.epochId,
      epochManifestHash: constraint.epochManifestHash,
      reviewerLookup: provenance.reviewerLookup,
      clusterPseudonym: provenance.clusterPseudonym,
      riskBand: riskBand as "low" | "medium" | "high",
      providerSubjectHashes,
      recentCoassignments,
      activeCustomerAssignments,
    };
  } catch {
    return null;
  }
}

export async function registerVoucherRound(input: {
  chainId: number;
  panelAddress: string;
  roundId: string;
  contentId: string;
  admissionPolicy: unknown;
  maximumCommits: number;
  voucherNotBefore: Date;
  voucherDeadline: Date;
  status?: "open" | "closed" | "takedown";
}) {
  if (
    !/^\d+$/.test(input.roundId) ||
    !BYTES32.test(input.contentId) ||
    !Number.isSafeInteger(input.maximumCommits) ||
    input.maximumCommits < 1 ||
    input.voucherDeadline <= input.voucherNotBefore
  ) {
    throw new Error("Invalid voucher round.");
  }
  const frozenPolicy = freezeAdmissionPolicy(input.admissionPolicy);
  const minimumQuota = frozenPolicy.policy.cohorts.reduce((sum, cohort) => sum + cohort.minimumReviewers, 0);
  if (
    frozenPolicy.policy.compensation === "unpaid" ||
    !frozenPolicy.policy.legalEligibilityRequired ||
    input.maximumCommits < frozenPolicy.policy.buyerPrivacy.minimumAggregationSize ||
    input.maximumCommits < minimumQuota
  ) {
    throw new Error("Admission policy cannot fit this paid voucher round.");
  }
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_voucher_rounds
          (chain_id, panel_address, round_id, content_id, admission_policy_hash,
           admission_policy_json, maximum_commits, voucher_not_before, voucher_deadline,
           status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (chain_id, panel_address, round_id) DO UPDATE SET content_id = EXCLUDED.content_id,
          admission_policy_hash = EXCLUDED.admission_policy_hash,
          admission_policy_json = EXCLUDED.admission_policy_json,
          maximum_commits = EXCLUDED.maximum_commits, voucher_not_before = EXCLUDED.voucher_not_before,
          voucher_deadline = EXCLUDED.voucher_deadline, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
    args: [
      input.chainId,
      getAddress(input.panelAddress).toLowerCase(),
      input.roundId,
      input.contentId.toLowerCase(),
      frozenPolicy.admissionPolicyHash,
      frozenPolicy.policyJson,
      input.maximumCommits,
      input.voucherNotBefore,
      input.voucherDeadline,
      input.status ?? "open",
      now,
      now,
    ],
  });
}

function voucherResponse(row: QueryRow) {
  return {
    voucherId: stringValue(row, "voucher_id"),
    voucher: JSON.parse(String(row.voucher_json)) as Record<string, string | number>,
    voucherSignature: stringValue(row, "voucher_signature"),
    assuranceSnapshotHash: stringValue(row, "assurance_snapshot_hash"),
    payoutAccountSnapshot: getAddress(String(row.payout_account_snapshot)),
    issuedAt: new Date(String(row.issued_at)),
  };
}

export async function issuePaidVoucher(input: { principalId: string; request: VoucherRequest; now?: Date }) {
  const now = input.now ?? new Date();
  if (
    !IDEMPOTENCY_KEY.test(input.request.idempotencyKey) ||
    !/^\d+$/.test(input.request.roundId) ||
    !BYTES32.test(input.request.contentId) ||
    !["customer_invited", "rateloop_network"].includes(input.request.reviewerSource)
  ) {
    throw new TokenlessServiceError("Voucher request is invalid.", 400, "invalid_voucher_request");
  }
  const voteKey = getAddress(input.request.voteKey);
  const requestHash = hash(
    stableJson({ ...input.request, voteKey: voteKey.toLowerCase(), contentId: input.request.contentId.toLowerCase() }),
  );
  const issuer = getIssuerConfig();
  const roundResult = await dbClient.execute({
    sql: `SELECT content_id, admission_policy_hash, admission_policy_json, maximum_commits,
                 voucher_not_before, voucher_deadline, status
          FROM tokenless_voucher_rounds WHERE chain_id = ? AND panel_address = ? AND round_id = ? LIMIT 1`,
    args: [issuer.chainId, issuer.panelAddress.toLowerCase(), input.request.roundId],
  });
  const round = roundResult.rows[0] as QueryRow | undefined;
  if (!round || stringValue(round, "content_id")?.toLowerCase() !== input.request.contentId.toLowerCase()) {
    throw new TokenlessServiceError("This round is not accepting vouchers.", 409, "round_not_open");
  }
  const policyJson = stringValue(round, "admission_policy_json");
  const persistedPolicyHash = stringValue(round, "admission_policy_hash");
  if (!policyJson || !persistedPolicyHash) {
    throw new TokenlessServiceError(
      "This historical tier round cannot issue capability-bound vouchers.",
      409,
      "capability_policy_required",
    );
  }
  const frozenPolicy = freezeAdmissionPolicy(JSON.parse(policyJson));
  if (
    frozenPolicy.policyJson !== policyJson ||
    frozenPolicy.admissionPolicyHash.toLowerCase() !== persistedPolicyHash.toLowerCase()
  ) {
    throw new TokenlessServiceError(
      "The frozen admission policy does not match its persisted hash.",
      409,
      "admission_policy_mismatch",
    );
  }
  if (
    frozenPolicy.policy.reviewerSource === "hybrid" ||
    frozenPolicy.policy.reviewerSource !== input.request.reviewerSource
  ) {
    throw new TokenlessServiceError(
      "The requested reviewer source does not match this round's frozen admission policy.",
      409,
      "voucher_reviewer_source_mismatch",
    );
  }
  const previous = await dbClient.execute({
    sql: `SELECT v.* FROM tokenless_paid_vouchers v
          JOIN tokenless_rater_profiles p ON p.rater_id = v.rater_id
          WHERE p.principal_id = ? AND v.request_idempotency_key = ? LIMIT 1`,
    args: [input.principalId, input.request.idempotencyKey],
  });
  const priorRow = previous.rows[0] as QueryRow | undefined;
  if (priorRow) {
    if (stringValue(priorRow, "request_hash") !== requestHash) {
      throw new TokenlessServiceError(
        "The idempotency key belongs to another voucher request.",
        409,
        "voucher_conflict",
      );
    }
    return voucherResponse(priorRow);
  }
  const eligibility = await loadVoucherEligibility(input.principalId, input.request.reviewerSource, now);
  const raterId = stringValue(eligibility.row, "rater_id")!;
  if (
    stringValue(round, "status") !== "open" ||
    new Date(String(round.voucher_not_before)) > now ||
    new Date(String(round.voucher_deadline)) <= now
  ) {
    throw new TokenlessServiceError("This round is not accepting vouchers.", 409, "round_not_open");
  }
  const admission = evaluateFrozenAdmissionPolicy({
    policy: frozenPolicy.policy,
    evidence: {
      assertions: eligibility.assertions,
      reviewerSource: eligibility.reviewerSource,
      cohortIds: eligibility.cohortIds,
      qualifications: eligibility.qualifications,
      integrity:
        eligibility.reviewerSource === "rateloop_network"
          ? ((await loadVoucherIntegrityEvidence({
              accountAddress: getAddress(eligibility.preflight.payoutAccount),
              contentId: input.request.contentId,
              policy: frozenPolicy.policy,
              now,
            })) ?? undefined)
          : undefined,
    },
    maximumCommits: Number(round.maximum_commits),
    now,
  });
  if (!admission.eligible) {
    throw new TokenlessServiceError(
      "The rater does not satisfy this round's exact admission policy.",
      403,
      "admission_policy_not_satisfied",
    );
  }
  const assuranceSnapshot = {
    schemaVersion: "rateloop.voucher-assurance-snapshot.v1",
    reviewerSource: eligibility.reviewerSource,
    assertions: eligibility.assertions
      .filter(value => admission.usedAssertionIds.includes(value.assertionId))
      .map(value => ({
        assertionId: value.assertionId,
        bindingId: value.bindingId,
        providerId: value.providerId,
        providerNamespace: value.providerNamespace,
        subjectReferenceHash: value.subjectReferenceHash,
        capabilities: [...value.capabilities].sort(),
        verifiedAt: value.verifiedAt.toISOString(),
        expiresAt: value.expiresAt.toISOString(),
        validityModel: value.validityModel,
      }))
      .sort((left, right) => left.assertionId.localeCompare(right.assertionId)),
    qualifications: eligibility.qualificationRecords
      .map(value => ({
        qualificationId: value.qualificationId,
        qualificationKind: value.qualificationKind,
        reviewerSource: value.reviewerSource,
        cohortIds: [...value.cohortIds].sort(),
        qualifications: value.qualifications
          .filter(qualification => admission.usedQualificationKeys.includes(qualification.key))
          .sort((left, right) => left.key.localeCompare(right.key)),
        verifiedAt: value.verifiedAt.toISOString(),
        expiresAt: value.expiresAt?.toISOString() ?? null,
      }))
      .filter(value => value.qualifications.length > 0)
      .sort((left, right) => left.qualificationId.localeCompare(right.qualificationId)),
    cohortIds: eligibility.cohortIds,
    capturedAt: now.toISOString(),
  };
  const assuranceSnapshotJson = stableJson(assuranceSnapshot);
  const assuranceSnapshotHash = `sha256:${hash(assuranceSnapshotJson)}`;
  await (issuerStateVerifierOverride ?? verifyLiveIssuerState)(issuer);
  const seedJson = JSON.parse(
    decryptVaultValue(
      String(eligibility.row.nullifier_seed_ciphertext),
      String(eligibility.row.nullifier_key_version),
      "vote_mapping",
    ).toString("utf8"),
  ) as { seed?: Hex };
  if (!seedJson.seed || !BYTES32.test(seedJson.seed)) throw new Error("Invalid nullifier seed.");
  const roundId = BigInt(input.request.roundId);
  const nullifier = keccak256(
    encodePacked(["bytes32", "bytes32", "uint256"], [seedJson.seed, input.request.contentId, roundId]),
  );
  const expiresAt = new Date(
    Math.min(now.getTime() + MAX_VOUCHER_LIFETIME_MS, new Date(String(round.voucher_deadline)).getTime()),
  );
  if (expiresAt.getTime() - now.getTime() < 30_000) {
    throw new TokenlessServiceError("The voucher window is too close to its deadline.", 409, "round_deadline_near");
  }
  const voucher = {
    voteKey,
    contentId: input.request.contentId,
    roundId: roundId.toString(),
    nullifier,
    admissionPolicyHash: frozenPolicy.admissionPolicyHash,
    issuerEpoch: issuer.issuerEpoch.toString(),
    expiresAt: Math.floor(expiresAt.getTime() / 1000).toString(),
  };
  const voucherSignature = await issuer.signerAccount.signTypedData({
    domain: {
      name: "RateLoop Tokenless Panel",
      version: "1",
      chainId: issuer.chainId,
      verifyingContract: issuer.panelAddress,
    },
    types: {
      Voucher: [
        { name: "voteKey", type: "address" },
        { name: "contentId", type: "bytes32" },
        { name: "roundId", type: "uint256" },
        { name: "nullifier", type: "bytes32" },
        { name: "admissionPolicyHash", type: "bytes32" },
        { name: "issuerEpoch", type: "uint64" },
        { name: "expiresAt", type: "uint64" },
      ],
    },
    primaryType: "Voucher",
    message: { ...voucher, roundId, issuerEpoch: issuer.issuerEpoch, expiresAt: BigInt(voucher.expiresAt) },
  });
  const voucherId = `vch_${randomUUID().replaceAll("-", "")}`;
  const voucherJson = stableJson(voucher);
  const insertClient = await dbPool.connect();
  try {
    await insertClient.query("BEGIN");
    const finalPreflight = await requirePaidReviewEligibilityInTransaction(insertClient, input.principalId, now);
    if (
      finalPreflight.raterId !== raterId ||
      finalPreflight.eligibilityCommitment !== eligibility.preflight.eligibilityCommitment
    ) {
      throw new TokenlessServiceError(
        "Paid-task eligibility changed while the voucher was prepared. Retry with current eligibility.",
        409,
        "paid_eligibility_changed",
      );
    }
    await insertClient.query(
      `INSERT INTO tokenless_paid_vouchers
            (voucher_id, rater_id, request_idempotency_key, request_hash, chain_id,
             panel_address, issuer_address, issuer_epoch, signer_address, round_id, content_id, vote_key,
             nullifier, admission_policy_hash, assurance_snapshot_hash, expires_at,
             payout_account_snapshot, voucher_json, voucher_signature, status, issued_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'issued',$20)`,
      [
        voucherId,
        raterId,
        input.request.idempotencyKey,
        requestHash,
        issuer.chainId,
        issuer.panelAddress.toLowerCase(),
        issuer.issuerAddress.toLowerCase(),
        issuer.issuerEpoch.toString(),
        issuer.signerAddress.toLowerCase(),
        input.request.roundId,
        input.request.contentId.toLowerCase(),
        voteKey.toLowerCase(),
        nullifier.toLowerCase(),
        frozenPolicy.admissionPolicyHash,
        assuranceSnapshotHash,
        expiresAt,
        finalPreflight.payoutAccount.toLowerCase(),
        voucherJson,
        voucherSignature,
        now,
      ],
    );
    await insertClient.query(
      `INSERT INTO tokenless_voucher_assurance_snapshots
       (voucher_id, rater_id, reviewer_source, snapshot_json, snapshot_hash, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [voucherId, raterId, eligibility.reviewerSource, assuranceSnapshotJson, assuranceSnapshotHash, now],
    );
    await insertClient.query("COMMIT");
  } catch (error) {
    await insertClient.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      const replay = await dbClient.execute({
        sql: "SELECT * FROM tokenless_paid_vouchers WHERE rater_id = ? AND request_idempotency_key = ? LIMIT 1",
        args: [raterId, input.request.idempotencyKey],
      });
      const replayRow = replay.rows[0] as QueryRow | undefined;
      if (replayRow && stringValue(replayRow, "request_hash") === requestHash) return voucherResponse(replayRow);
      throw new TokenlessServiceError(
        "This identity already has a voucher for the round.",
        409,
        "voucher_already_issued",
      );
    }
    throw error;
  } finally {
    insertClient.release();
  }
  return { voucherId, voucher, voucherSignature, assuranceSnapshotHash, issuedAt: now };
}

export function __setPaidEligibilityOverridesForTests(input: {
  provider?: EligibilityProvider | null;
  vault?: VaultDomains | null;
  providerReferences?: ProviderReferenceKeyring | null;
  issuerConfig?: IssuerConfig | null;
  verifyIssuerState?: IssuerStateVerifier | null;
  requiresDac7?: ((country: string) => boolean) | null;
  handoff?: HandoffConfig | null;
  integrityEvidence?:
    | ((input: {
        accountAddress: Address;
        contentId: Hex;
        policy: HumanAssuranceAudiencePolicy;
        now: Date;
      }) => Promise<CapabilityAdmissionEvidence["integrity"] | null>)
    | null;
}) {
  providerOverride = input.provider ?? null;
  vaultOverride = input.vault ?? null;
  providerReferenceKeyringOverride = input.providerReferences ?? null;
  issuerConfigOverride = input.issuerConfig ?? null;
  issuerStateVerifierOverride = input.verifyIssuerState ?? null;
  dac7PolicyOverride = input.requiresDac7 ?? null;
  handoffConfigOverride = input.handoff ?? null;
  integrityEvidenceOverride = input.integrityEvidence ?? null;
}
