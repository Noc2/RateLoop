import { CredentialIssuerAbi, TokenlessPanelAbi } from "@rateloop/contracts/tokenless";
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
import "server-only";
import { type Address, type Hex, createPublicClient, encodePacked, getAddress, http, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getBaseAccountAuthOrigin } from "~~/lib/base-account/auth";
import { dbClient, dbPool } from "~~/lib/db";
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
  identityTierId: number;
  adultVerified: boolean;
  residenceCountry: string;
  identityVerifiedAt: Date;
  identityExpiresAt: Date;
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
};

type VaultConfig = { currentVersion: string; keys: Map<string, Buffer> };
type IssuerConfig = {
  chainId: number;
  panelAddress: Address;
  issuerAddress: Address;
  issuerEpoch: bigint;
  signerPrivateKey: Hex;
  signerAddress: Address;
  rpcUrl: string;
};

type IssuerStateVerifier = (config: IssuerConfig) => Promise<void>;
type HandoffConfig = { startUrl: string; secret: Buffer };

let providerOverride: EligibilityProvider | null = null;
let vaultOverride: VaultConfig | null = null;
let issuerConfigOverride: IssuerConfig | null = null;
let issuerStateVerifierOverride: IssuerStateVerifier | null = null;
let dac7PolicyOverride: ((country: string) => boolean) | null = null;
let handoffConfigOverride: HandoffConfig | null = null;

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
  const residenceCountry = typeof parsed.residenceCountry === "string" ? parsed.residenceCountry.toUpperCase() : "";
  const tier = Number(parsed.identityTierId);
  const identityVerifiedAt = parseDate(parsed.identityVerifiedAt, "identityVerifiedAt");
  const identityExpiresAt = parseDate(parsed.identityExpiresAt, "identityExpiresAt");
  const sanctionsScreenedAt = parseDate(sanctions?.screenedAt, "sanctions.screenedAt");
  const sanctionsExpiresAt = parseDate(sanctions?.expiresAt, "sanctions.expiresAt");
  const sanctionsStatus = sanctions?.status;
  if (
    parsed.version !== 1 ||
    parsed.provider !== providerId ||
    assertionId.length < 8 ||
    assertionId.length > 256 ||
    subjectId.length < 8 ||
    subjectId.length > 256 ||
    typeof parsed.accountAddress !== "string" ||
    !ADDRESS.test(parsed.accountAddress) ||
    !Number.isInteger(tier) ||
    tier < 1 ||
    tier > 3 ||
    typeof parsed.adultVerified !== "boolean" ||
    !COUNTRY.test(residenceCountry) ||
    !["clear", "review", "match"].includes(String(sanctionsStatus)) ||
    typeof sanctions?.reference !== "string" ||
    sanctions.reference.length < 4 ||
    identityVerifiedAt.getTime() > now.getTime() + PROVIDER_CLOCK_SKEW_MS ||
    sanctionsScreenedAt.getTime() > now.getTime() + PROVIDER_CLOCK_SKEW_MS ||
    identityExpiresAt <= now ||
    sanctionsExpiresAt <= now ||
    identityExpiresAt.getTime() - identityVerifiedAt.getTime() > MAX_PROVIDER_LIFETIME_MS ||
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
    identityTierId: tier,
    adultVerified: parsed.adultVerified,
    residenceCountry,
    identityVerifiedAt,
    identityExpiresAt,
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

function getVaultConfig(): VaultConfig {
  if (vaultOverride) return vaultOverride;
  if (process.env.NEXT_PUBLIC_TOKENLESS_ELIGIBILITY_VAULT_KEYS) {
    throw new Error("Eligibility vault keys must never use a NEXT_PUBLIC_ environment variable.");
  }
  const currentVersion = process.env.TOKENLESS_ELIGIBILITY_VAULT_KEY_VERSION?.trim();
  const rawKeys = process.env.TOKENLESS_ELIGIBILITY_VAULT_KEYS?.trim();
  if (!currentVersion || !rawKeys) throw new Error("The eligibility vault keyring is not configured.");
  let source: Record<string, string>;
  try {
    source = JSON.parse(rawKeys) as Record<string, string>;
  } catch {
    throw new Error("TOKENLESS_ELIGIBILITY_VAULT_KEYS must be a JSON object of base64 keys.");
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

function encryptVaultValue(value: unknown) {
  const config = getVaultConfig();
  const key = config.keys.get(config.currentVersion)!;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(stableJson(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`,
    keyVersion: config.currentVersion,
  };
}

function decryptVaultValue(value: string, keyVersion: string) {
  const key = getVaultConfig().keys.get(keyVersion);
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

export async function createEligibilityProviderHandoff(accountAddress: string, now = new Date()) {
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
  const callbackUrl = `${getBaseAccountAuthOrigin()}/api/rater/eligibility/provider/callback`;
  await dbClient.execute({
    sql: `INSERT INTO tokenless_eligibility_provider_handoffs
          (state_hash, account_address, provider_id, status, expires_at, created_at)
          VALUES (?, ?, ?, 'pending', ?, ?)`,
    args: [hash(state), getAddress(accountAddress).toLowerCase(), providerId, expiresAt, now],
  });
  const startUrl = new URL(config.startUrl);
  startUrl.searchParams.set("state", state);
  startUrl.searchParams.set("callback_url", callbackUrl);
  startUrl.searchParams.set("return_url", `${getBaseAccountAuthOrigin()}/settings?eligibility=provider-return`);
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
  const vaulted = encryptVaultValue(input.providerResult);
  const resultExpiresAt = new Date(
    Math.min(assertion.identityExpiresAt.getTime(), assertion.sanctionsExpiresAt.getTime()),
  );
  const updated = await dbClient.execute({
    sql: `UPDATE tokenless_eligibility_provider_handoffs
          SET status = 'verified', provider_result_ciphertext = ?, provider_result_key_version = ?,
              provider_result_expires_at = ?, verified_at = ?
          WHERE state_hash = ? AND status = 'pending' AND expires_at > ?
          RETURNING state_hash`,
    args: [vaulted.ciphertext, vaulted.keyVersion, resultExpiresAt, now, hash(input.state), now],
  });
  if (updated.rowCount !== 1) {
    throw new TokenlessServiceError("Eligibility handoff state was already used.", 409, "invalid_provider_state");
  }
  return { status: "verified" as const, state: input.state, expiresAt: resultExpiresAt };
}

async function resolveEligibilityAssertion(input: EligibilitySubmission, accountAddress: Address, now: Date) {
  if (input.providerState) {
    const result = await dbClient.execute({
      sql: `SELECT provider_result_ciphertext, provider_result_key_version, provider_result_expires_at, status,
                   account_address
            FROM tokenless_eligibility_provider_handoffs WHERE state_hash = ? LIMIT 1`,
      args: [hash(input.providerState)],
    });
    const row = result.rows[0] as QueryRow | undefined;
    if (
      !row ||
      stringValue(row, "status") !== "verified" ||
      stringValue(row, "account_address") !== accountAddress.toLowerCase() ||
      new Date(String(row.provider_result_expires_at)) <= now ||
      !stringValue(row, "provider_result_ciphertext") ||
      !stringValue(row, "provider_result_key_version")
    ) {
      throw new TokenlessServiceError(
        "Complete the identity provider handoff first.",
        403,
        "provider_handoff_required",
      );
    }
    const providerResult = JSON.parse(
      decryptVaultValue(String(row.provider_result_ciphertext), String(row.provider_result_key_version)).toString(
        "utf8",
      ),
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

function eligibilityState(assertion: VerifiedEligibilityAssertion) {
  if (!assertion.adultVerified) return { status: "blocked", reason: "age_not_verified" };
  if (assertion.sanctionsStatus === "match") return { status: "blocked", reason: "sanctions_match" };
  if (assertion.sanctionsStatus === "review") return { status: "review", reason: "sanctions_review" };
  return { status: "eligible", reason: null };
}

function publicBlockedReason(reason: string | null) {
  return reason?.startsWith("sanctions_") ? "legal_eligibility_review" : reason;
}

export async function submitPaidEligibility(input: {
  accountAddress: string;
  submission: EligibilitySubmission;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const accountAddress = getAddress(input.accountAddress);
  if (input.submission.sanctionsConsent !== true) {
    throw new TokenlessServiceError(
      "Sanctions screening consent is required for paid tasks.",
      400,
      "sanctions_consent_required",
    );
  }
  const payoutAccount = getAddress(input.submission.payoutAccount);
  if (payoutAccount !== accountAddress) {
    throw new TokenlessServiceError(
      "The payout Base Account must be the signed-in account.",
      403,
      "payout_ownership_mismatch",
    );
  }
  const taxCountry = input.submission.taxResidenceCountry.toUpperCase();
  if (!COUNTRY.test(taxCountry))
    throw new TokenlessServiceError("Tax residence country is invalid.", 400, "tax_profile_invalid");
  const resolvedAssertion = await resolveEligibilityAssertion(input.submission, accountAddress, now);
  const assertion = resolvedAssertion.assertion;
  if (assertion.accountAddress !== accountAddress) {
    throw new TokenlessServiceError(
      "The provider result belongs to another account.",
      403,
      "provider_account_mismatch",
    );
  }
  if (assertion.residenceCountry !== taxCountry) {
    throw new TokenlessServiceError(
      "Residence and tax residence require review before paid tasks.",
      409,
      "residence_mismatch",
    );
  }
  const dac7Required = requiresDac7(taxCountry);
  if (dac7Required) validateDac7(input.submission.dac7);
  const dac7Vault =
    dac7Required && input.submission.dac7
      ? encryptVaultValue({ ...input.submission.dac7, taxResidenceCountry: taxCountry })
      : null;
  const seedVault = encryptVaultValue({ seed: `0x${randomBytes(32).toString("hex")}` });
  const subjectHash = hash(`${assertion.providerId}:${assertion.subjectId}`);
  const assertionIdHash = hash(`${assertion.providerId}:${assertion.assertionId}`);
  const state = eligibilityState(assertion);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      "SELECT rater_id, identity_subject_hash FROM tokenless_rater_profiles WHERE account_address = $1 FOR UPDATE",
      [accountAddress.toLowerCase()],
    );
    const existingRow = existing.rows[0] as QueryRow | undefined;
    if (existingRow && stringValue(existingRow, "identity_subject_hash") !== subjectHash) {
      throw new TokenlessServiceError(
        "This account is already bound to another verified identity.",
        409,
        "identity_binding_conflict",
      );
    }
    const raterId = stringValue(existingRow, "rater_id") ?? `rtr_${randomUUID().replaceAll("-", "")}`;
    if (!existingRow) {
      await client.query(
        `INSERT INTO tokenless_rater_profiles
         (rater_id, account_address, identity_subject_hash, nullifier_seed_ciphertext, nullifier_key_version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [raterId, accountAddress.toLowerCase(), subjectHash, seedVault.ciphertext, seedVault.keyVersion, now],
      );
    }
    await client.query(
      `INSERT INTO tokenless_paid_eligibility
       (rater_id, provider_id, provider_assertion_hash, provider_assertion_id_hash, identity_tier_id,
        identity_verified_at, identity_expires_at, adult_verified, residence_country, tax_residence_country,
        tax_profile_status, dac7_status, dac7_vault_ciphertext, dac7_key_version, sanctions_consent_at,
        sanctions_status, sanctions_reference_hash, sanctions_screened_at, sanctions_expires_at, payout_account,
        payout_ownership_method, payout_verified_at, eligibility_status, blocked_reason, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'complete',$11,$12,$13,$14,$15,$16,$17,$18,$19,
               'siwe_base_account_session',$14,$20,$21,$14,$14)
       ON CONFLICT (rater_id) DO UPDATE SET
        provider_id = EXCLUDED.provider_id, provider_assertion_hash = EXCLUDED.provider_assertion_hash,
        provider_assertion_id_hash = EXCLUDED.provider_assertion_id_hash, identity_tier_id = EXCLUDED.identity_tier_id,
        identity_verified_at = EXCLUDED.identity_verified_at, identity_expires_at = EXCLUDED.identity_expires_at,
        adult_verified = EXCLUDED.adult_verified, residence_country = EXCLUDED.residence_country,
        tax_residence_country = EXCLUDED.tax_residence_country, tax_profile_status = EXCLUDED.tax_profile_status,
        dac7_status = EXCLUDED.dac7_status, dac7_vault_ciphertext = EXCLUDED.dac7_vault_ciphertext,
        dac7_key_version = EXCLUDED.dac7_key_version, sanctions_consent_at = EXCLUDED.sanctions_consent_at,
        sanctions_status = EXCLUDED.sanctions_status, sanctions_reference_hash = EXCLUDED.sanctions_reference_hash,
        sanctions_screened_at = EXCLUDED.sanctions_screened_at, sanctions_expires_at = EXCLUDED.sanctions_expires_at,
        payout_account = EXCLUDED.payout_account, payout_ownership_method = EXCLUDED.payout_ownership_method,
        payout_verified_at = EXCLUDED.payout_verified_at, eligibility_status = EXCLUDED.eligibility_status,
        blocked_reason = EXCLUDED.blocked_reason, updated_at = EXCLUDED.updated_at`,
      [
        raterId,
        assertion.providerId,
        assertion.assertionHash,
        assertionIdHash,
        assertion.identityTierId,
        assertion.identityVerifiedAt,
        assertion.identityExpiresAt,
        assertion.adultVerified,
        assertion.residenceCountry,
        taxCountry,
        dac7Required ? "complete" : "not_required",
        dac7Vault?.ciphertext ?? null,
        dac7Vault?.keyVersion ?? null,
        now,
        assertion.sanctionsStatus,
        hash(assertion.sanctionsReference),
        assertion.sanctionsScreenedAt,
        assertion.sanctionsExpiresAt,
        accountAddress.toLowerCase(),
        state.status,
        state.reason,
      ],
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
      identityTierId: assertion.identityTierId,
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

export async function getPaidEligibility(accountAddress: string, now = new Date()) {
  const result = await dbClient.execute({
    sql: `SELECT e.identity_tier_id, e.identity_expires_at, e.adult_verified, e.residence_country,
                 e.tax_residence_country, e.tax_profile_status, e.dac7_status, e.sanctions_status,
                 e.sanctions_expires_at, e.payout_account, e.payout_ownership_method, e.eligibility_status,
                 e.blocked_reason, e.updated_at
          FROM tokenless_rater_profiles p JOIN tokenless_paid_eligibility e ON e.rater_id = p.rater_id
          WHERE p.account_address = ? LIMIT 1`,
    args: [getAddress(accountAddress).toLowerCase()],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (!row) return { status: "not_started" };
  const identityExpiresAt = new Date(String(row.identity_expires_at));
  const sanctionsExpiresAt = new Date(String(row.sanctions_expires_at));
  const persisted = stringValue(row, "eligibility_status")!;
  const currentStatus =
    persisted === "eligible" && (identityExpiresAt <= now || sanctionsExpiresAt <= now) ? "expired" : persisted;
  return {
    status: currentStatus,
    blockedReason: publicBlockedReason(stringValue(row, "blocked_reason")),
    identityTierId: Number(row.identity_tier_id),
    identityExpiresAt,
    residenceCountry: stringValue(row, "residence_country"),
    taxResidenceCountry: stringValue(row, "tax_residence_country"),
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
  if (process.env.NEXT_PUBLIC_TOKENLESS_VOUCHER_SIGNER_PRIVATE_KEY) {
    throw new Error("The voucher signer secret must never use a NEXT_PUBLIC_ environment variable.");
  }
  const signerPrivateKey = process.env.TOKENLESS_VOUCHER_SIGNER_PRIVATE_KEY as Hex | undefined;
  const epoch = process.env.TOKENLESS_VOUCHER_ISSUER_EPOCH;
  const panel = process.env.TOKENLESS_PANEL_ADDRESS;
  const issuer = process.env.TOKENLESS_CREDENTIAL_ISSUER_ADDRESS;
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL?.trim();
  if (!signerPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(signerPrivateKey) || !epoch || !panel || !issuer || !rpcUrl) {
    throw new TokenlessServiceError("Voucher issuer configuration is incomplete.", 503, "issuer_unavailable");
  }
  const signer = privateKeyToAccount(signerPrivateKey);
  return {
    chainId: baseSepolia.id,
    panelAddress: getAddress(panel),
    issuerAddress: getAddress(issuer),
    issuerEpoch: BigInt(epoch),
    signerPrivateKey,
    signerAddress: signer.address,
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

async function loadVoucherEligibility(accountAddress: Address, now: Date) {
  const result = await dbClient.execute({
    sql: `SELECT p.rater_id, p.identity_subject_hash, p.nullifier_seed_ciphertext, p.nullifier_key_version,
                 e.identity_tier_id, e.identity_expires_at, e.adult_verified, e.tax_profile_status, e.dac7_status,
                 e.sanctions_status, e.sanctions_expires_at, e.payout_account, e.eligibility_status
          FROM tokenless_rater_profiles p JOIN tokenless_paid_eligibility e ON e.rater_id = p.rater_id
          WHERE p.account_address = ? LIMIT 1`,
    args: [accountAddress.toLowerCase()],
  });
  const row = result.rows[0] as QueryRow | undefined;
  if (
    !row ||
    stringValue(row, "eligibility_status") !== "eligible" ||
    row.adult_verified !== true ||
    stringValue(row, "tax_profile_status") !== "complete" ||
    !["complete", "not_required"].includes(stringValue(row, "dac7_status") ?? "") ||
    stringValue(row, "sanctions_status") !== "clear" ||
    new Date(String(row.identity_expires_at)) <= now ||
    new Date(String(row.sanctions_expires_at)) <= now ||
    getAddress(String(row.payout_account)) !== accountAddress
  ) {
    throw new TokenlessServiceError(
      "Paid-task eligibility must be completed before a voucher can be issued.",
      403,
      "paid_eligibility_required",
    );
  }
  return row;
}

export async function registerVoucherRound(input: {
  chainId: number;
  panelAddress: string;
  roundId: string;
  contentId: string;
  requiredTierId: number;
  voucherNotBefore: Date;
  voucherDeadline: Date;
  status?: "open" | "closed" | "takedown";
}) {
  if (
    !/^\d+$/.test(input.roundId) ||
    !BYTES32.test(input.contentId) ||
    input.voucherDeadline <= input.voucherNotBefore
  ) {
    throw new Error("Invalid voucher round.");
  }
  const now = new Date();
  await dbClient.execute({
    sql: `INSERT INTO tokenless_voucher_rounds
          (chain_id, panel_address, round_id, content_id, required_tier_id, voucher_not_before, voucher_deadline, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (chain_id, panel_address, round_id) DO UPDATE SET content_id = EXCLUDED.content_id,
          required_tier_id = EXCLUDED.required_tier_id, voucher_not_before = EXCLUDED.voucher_not_before,
          voucher_deadline = EXCLUDED.voucher_deadline, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at`,
    args: [
      input.chainId,
      getAddress(input.panelAddress).toLowerCase(),
      input.roundId,
      input.contentId.toLowerCase(),
      input.requiredTierId,
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
    issuedAt: new Date(String(row.issued_at)),
  };
}

export async function issuePaidVoucher(input: { accountAddress: string; request: VoucherRequest; now?: Date }) {
  const now = input.now ?? new Date();
  const accountAddress = getAddress(input.accountAddress);
  if (
    !IDEMPOTENCY_KEY.test(input.request.idempotencyKey) ||
    !/^\d+$/.test(input.request.roundId) ||
    !BYTES32.test(input.request.contentId)
  ) {
    throw new TokenlessServiceError("Voucher request is invalid.", 400, "invalid_voucher_request");
  }
  const voteKey = getAddress(input.request.voteKey);
  const requestHash = hash(
    stableJson({ ...input.request, voteKey: voteKey.toLowerCase(), contentId: input.request.contentId.toLowerCase() }),
  );
  const eligibility = await loadVoucherEligibility(accountAddress, now);
  const raterId = stringValue(eligibility, "rater_id")!;
  const previous = await dbClient.execute({
    sql: "SELECT * FROM tokenless_paid_vouchers WHERE rater_id = ? AND request_idempotency_key = ? LIMIT 1",
    args: [raterId, input.request.idempotencyKey],
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
  const issuer = getIssuerConfig();
  const roundResult = await dbClient.execute({
    sql: `SELECT content_id, required_tier_id, voucher_not_before, voucher_deadline, status
          FROM tokenless_voucher_rounds WHERE chain_id = ? AND panel_address = ? AND round_id = ? LIMIT 1`,
    args: [issuer.chainId, issuer.panelAddress.toLowerCase(), input.request.roundId],
  });
  const round = roundResult.rows[0] as QueryRow | undefined;
  if (
    !round ||
    stringValue(round, "status") !== "open" ||
    stringValue(round, "content_id")?.toLowerCase() !== input.request.contentId.toLowerCase() ||
    new Date(String(round.voucher_not_before)) > now ||
    new Date(String(round.voucher_deadline)) <= now
  ) {
    throw new TokenlessServiceError("This round is not accepting vouchers.", 409, "round_not_open");
  }
  const tierId = Number(eligibility.identity_tier_id);
  if (tierId < Number(round.required_tier_id)) {
    throw new TokenlessServiceError("This round requires a higher identity tier.", 403, "identity_tier_insufficient");
  }
  await (issuerStateVerifierOverride ?? verifyLiveIssuerState)(issuer);
  const seedJson = JSON.parse(
    decryptVaultValue(
      String(eligibility.nullifier_seed_ciphertext),
      String(eligibility.nullifier_key_version),
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
    tierId,
    issuerEpoch: issuer.issuerEpoch.toString(),
    expiresAt: Math.floor(expiresAt.getTime() / 1000).toString(),
  };
  const signer = privateKeyToAccount(issuer.signerPrivateKey);
  const voucherSignature = await signer.signTypedData({
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
        { name: "tierId", type: "uint32" },
        { name: "issuerEpoch", type: "uint64" },
        { name: "expiresAt", type: "uint64" },
      ],
    },
    primaryType: "Voucher",
    message: { ...voucher, roundId, issuerEpoch: issuer.issuerEpoch, expiresAt: BigInt(voucher.expiresAt) },
  });
  const voucherId = `vch_${randomUUID().replaceAll("-", "")}`;
  const voucherJson = stableJson(voucher);
  try {
    await dbClient.execute({
      sql: `INSERT INTO tokenless_paid_vouchers
            (voucher_id, rater_id, identity_subject_hash, request_idempotency_key, request_hash, chain_id,
             panel_address, issuer_address, issuer_epoch, signer_address, round_id, content_id, vote_key,
             nullifier, tier_id, expires_at, voucher_json, voucher_signature, status, issued_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?)`,
      args: [
        voucherId,
        raterId,
        String(eligibility.identity_subject_hash),
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
        tierId,
        expiresAt,
        voucherJson,
        voucherSignature,
        now,
      ],
    });
  } catch (error) {
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
  }
  return { voucherId, voucher, voucherSignature, issuedAt: now };
}

export function __setPaidEligibilityOverridesForTests(input: {
  provider?: EligibilityProvider | null;
  vault?: VaultConfig | null;
  issuerConfig?: IssuerConfig | null;
  verifyIssuerState?: IssuerStateVerifier | null;
  requiresDac7?: ((country: string) => boolean) | null;
  handoff?: HandoffConfig | null;
}) {
  providerOverride = input.provider ?? null;
  vaultOverride = input.vault ?? null;
  issuerConfigOverride = input.issuerConfig ?? null;
  issuerStateVerifierOverride = input.verifyIssuerState ?? null;
  dac7PolicyOverride = input.requiresDac7 ?? null;
  handoffConfigOverride = input.handoff ?? null;
}
