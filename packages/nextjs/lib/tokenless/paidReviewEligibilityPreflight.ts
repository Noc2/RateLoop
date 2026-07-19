import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { getAddress } from "viem";
import { dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const COUNTRY = /^[A-Z]{2}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

type Row = Record<string, unknown>;

export type PaidReviewEligibilityPreflight = {
  schemaVersion: "rateloop.paid-review-eligibility-preflight.v1";
  preflightId: `pef_${string}`;
  raterId: string;
  principalId: string;
  /** @deprecated Payout snapshot retained for v1 adapter compatibility; principalId is authoritative. */
  accountAddress: string;
  identityAssertions: Array<{
    assertionId: string;
    bindingId: string;
    providerId: string;
    providerNamespace: string;
    capabilities: string[];
  }>;
  payoutAccount: string;
  checkedAt: string;
  validUntil: string;
  eligibilityCommitment: `sha256:${string}`;
};

export type PaidReviewerBinding = {
  principalId: string;
  payoutAccount: string;
};

export type PaidReviewEligibilityRequirement = {
  lane: "public_network" | "private_invited" | "hybrid";
  guaranteedCompensationMode: "unpaid" | "usdc";
  feedbackBonusMode: "off" | "usdc";
};

/**
 * Eligibility follows money, not audience visibility. Either independent USDC
 * switch requires the paid preflight; an unpaid ask with no bonus stays wallet-free.
 */
export function paidReviewRequiresEligibility(input: PaidReviewEligibilityRequirement) {
  return input.guaranteedCompensationMode === "usdc" || input.feedbackBonusMode === "usdc";
}

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function date(row: Row | undefined, key: string) {
  const value = row?.[key];
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function rejectEligibility(): never {
  throw new TokenlessServiceError(
    "Paid-task identity, tax, sanctions, and payout eligibility must be complete before paid work is offered.",
    403,
    "paid_eligibility_required",
  );
}

function parseCapabilities(value: unknown) {
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    if (!Array.isArray(parsed) || parsed.some(capability => typeof capability !== "string")) {
      return null;
    }
    return new Set(parsed);
  } catch {
    return null;
  }
}

function normalizeAddress(value: string | null) {
  if (!value) return null;
  try {
    return getAddress(value).toLowerCase();
  } catch {
    return null;
  }
}

function isOwnerProofCurrent(row: Row, accountAddress: string, now: Date) {
  const payoutVerifiedAt = date(row, "payout_verified_at");
  const payoutExpiresAt = date(row, "payout_expires_at");
  return (
    text(row, "payout_eligibility_status") === "ready" &&
    normalizeAddress(text(row, "payout_account")) === accountAddress &&
    text(row, "payout_ownership_method") === "siwe_base_account_session" &&
    payoutVerifiedAt !== null &&
    payoutVerifiedAt.getTime() <= now.getTime() + MAX_CLOCK_SKEW_MS &&
    (payoutExpiresAt === null || payoutExpiresAt > now)
  );
}

function isLegalEligibilityCurrent(row: Row, now: Date) {
  const ageVerifiedAt = date(row, "age_evidence_verified_at");
  const ageExpiresAt = date(row, "age_evidence_expires_at");
  const sanctionsConsentAt = date(row, "sanctions_consent_at");
  const sanctionsScreenedAt = date(row, "sanctions_screened_at");
  const sanctionsExpiresAt = date(row, "sanctions_expires_at");
  const declaredResidence = text(row, "declared_residence_country");
  const taxResidence = text(row, "tax_residence_country");
  const verifiedResidence = text(row, "verified_residence_country");
  const dac7Status = text(row, "dac7_status");
  const taxVaultComplete =
    typeof row.tax_vault_ciphertext === "string" &&
    row.tax_vault_ciphertext.length > 0 &&
    typeof row.tax_vault_key_version === "string" &&
    row.tax_vault_key_version.length > 0 &&
    text(row, "tax_vault_key_domain") === "tax_records";
  return (
    text(row, "legal_eligibility_status") === "eligible" &&
    Number(row.minimum_age_verified) >= 18 &&
    ageVerifiedAt !== null &&
    ageVerifiedAt.getTime() <= now.getTime() + MAX_CLOCK_SKEW_MS &&
    ageExpiresAt !== null &&
    ageExpiresAt > now &&
    declaredResidence !== null &&
    COUNTRY.test(declaredResidence) &&
    taxResidence !== null &&
    COUNTRY.test(taxResidence) &&
    declaredResidence === taxResidence &&
    (verifiedResidence === null || verifiedResidence === declaredResidence) &&
    text(row, "residence_tax_status") === "consistent" &&
    text(row, "tax_profile_status") === "complete" &&
    (dac7Status === "not_required" || (dac7Status === "complete" && taxVaultComplete)) &&
    sanctionsConsentAt !== null &&
    sanctionsConsentAt.getTime() <= now.getTime() + MAX_CLOCK_SKEW_MS &&
    text(row, "sanctions_status") === "clear" &&
    HASH.test(text(row, "sanctions_reference_hash") ?? "") &&
    sanctionsScreenedAt !== null &&
    sanctionsScreenedAt.getTime() <= now.getTime() + MAX_CLOCK_SKEW_MS &&
    sanctionsExpiresAt !== null &&
    sanctionsExpiresAt > now &&
    sanctionsExpiresAt > sanctionsScreenedAt
  );
}

function compareIdentityRows(left: Row, right: Row) {
  const verifiedAtDifference =
    (date(right, "evidence_verified_at")?.getTime() ?? 0) - (date(left, "evidence_verified_at")?.getTime() ?? 0);
  if (verifiedAtDifference !== 0) return verifiedAtDifference;
  for (const key of ["assertion_id", "binding_id", "provider_id", "provider_namespace"]) {
    const leftValue = text(left, key) ?? "";
    const rightValue = text(right, key) ?? "";
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
  }
  return 0;
}

function selectCurrentIdentityAssertions(rows: Row[], now: Date) {
  const current = rows
    .filter(row => {
      const capabilities = parseCapabilities(row.capabilities_json);
      const verifiedAt = date(row, "evidence_verified_at");
      const expiresAt = date(row, "evidence_expires_at");
      const validityModel = text(row, "assurance_validity_model");
      const lastBindingVerification = date(row, "last_verified_at");
      return (
        text(row, "assertion_status") === "active" &&
        text(row, "binding_status") === "active" &&
        (capabilities?.has("account_control") === true || capabilities?.has("minimum_age") === true) &&
        verifiedAt !== null &&
        verifiedAt.getTime() <= now.getTime() + MAX_CLOCK_SKEW_MS &&
        expiresAt !== null &&
        (validityModel === "durable_enrollment" || expiresAt > now) &&
        lastBindingVerification !== null &&
        lastBindingVerification.getTime() <= now.getTime() + MAX_CLOCK_SKEW_MS &&
        text(row, "provider_evidence_key_domain") === "provider_evidence" &&
        Boolean(text(row, "provider_evidence_ciphertext")) &&
        Boolean(text(row, "provider_evidence_key_version"))
      );
    })
    .sort(compareIdentityRows);
  const combined = current.find(row => {
    const capabilities = parseCapabilities(row.capabilities_json)!;
    return (
      capabilities.has("account_control") &&
      capabilities.has("minimum_age") &&
      Number(row.assertion_minimum_age_verified) >= 18
    );
  });
  if (combined) return [combined];
  const accountControl = current.find(row => parseCapabilities(row.capabilities_json)!.has("account_control"));
  const minimumAge = current.find(
    row =>
      parseCapabilities(row.capabilities_json)!.has("minimum_age") && Number(row.assertion_minimum_age_verified) >= 18,
  );
  if (!accountControl || !minimumAge) return null;
  return [accountControl, minimumAge].sort(compareIdentityRows);
}

function snapshot(input: { row: Row; identities: Row[]; principalId: string; checkedAt: Date; validUntil: Date }) {
  const payoutAccount = normalizeAddress(text(input.row, "active_payout_account"))!;
  return {
    schemaVersion: "rateloop.paid-review-eligibility-preflight.v1" as const,
    raterId: text(input.row, "rater_id")!,
    principalId: input.principalId,
    accountAddress: payoutAccount,
    identityAssertions: input.identities.map(identity => ({
      assertionId: text(identity, "assertion_id")!,
      bindingId: text(identity, "binding_id")!,
      providerId: text(identity, "provider_id")!,
      providerNamespace: text(identity, "provider_namespace")!,
      capabilities: [...parseCapabilities(identity.capabilities_json)!].sort((left, right) =>
        left === right ? 0 : left < right ? -1 : 1,
      ),
    })),
    payoutAccount,
    checkedAt: input.checkedAt.toISOString(),
    validUntil: input.validUntil.toISOString(),
  };
}

export async function requirePaidReviewEligibilityInTransaction(
  client: Pick<PoolClient, "query">,
  principalId: string,
  now = new Date(),
): Promise<PaidReviewEligibilityPreflight> {
  if (!principalId) rejectEligibility();
  const result = await client.query(
    `SELECT p.rater_id, p.principal_id, p.account_address, wb.wallet_address AS active_payout_account,
            p.nullifier_seed_ciphertext,
            p.nullifier_key_version, p.nullifier_key_domain, p.updated_at AS profile_updated_at,
            l.minimum_age_verified, l.age_evidence_verified_at, l.age_evidence_expires_at,
            l.verified_residence_country, l.declared_residence_country, l.tax_residence_country,
            l.residence_tax_status, l.tax_profile_status, l.dac7_status,
            l.tax_vault_ciphertext, l.tax_vault_key_version, l.tax_vault_key_domain,
            l.sanctions_consent_at, l.sanctions_status, l.sanctions_reference_hash,
            l.sanctions_screened_at, l.sanctions_expires_at,
            l.eligibility_status AS legal_eligibility_status, l.updated_at AS legal_updated_at,
            pe.payout_account, pe.payout_ownership_method, pe.payout_verified_at,
            pe.payout_expires_at, pe.eligibility_status AS payout_eligibility_status,
            pe.updated_at AS payout_updated_at
     FROM tokenless_rater_profiles p
     JOIN tokenless_legal_eligibility l ON l.rater_id = p.rater_id
     JOIN tokenless_payout_eligibility pe ON pe.rater_id = p.rater_id
     JOIN tokenless_wallet_bindings wb ON wb.principal_id = p.principal_id
       AND wb.purpose = 'payout' AND wb.revoked_at IS NULL
     WHERE p.principal_id = $1 LIMIT 1 FOR UPDATE`,
    [principalId],
  );
  const row = result.rows[0] as Row | undefined;
  const payoutAccount = normalizeAddress(text(row, "active_payout_account"));
  if (
    !row ||
    text(row, "principal_id") !== principalId ||
    !payoutAccount ||
    normalizeAddress(text(row, "account_address")) !== payoutAccount ||
    text(row, "nullifier_key_domain") !== "vote_mapping" ||
    !text(row, "nullifier_seed_ciphertext") ||
    !text(row, "nullifier_key_version") ||
    !isLegalEligibilityCurrent(row, now) ||
    !isOwnerProofCurrent(row, payoutAccount, now)
  ) {
    rejectEligibility();
  }
  const identities = await client.query(
    `SELECT a.assertion_id, a.binding_id, a.provider_id, a.provider_namespace,
            a.capabilities_json, a.minimum_age_verified AS assertion_minimum_age_verified,
            a.provider_evidence_ciphertext, a.provider_evidence_key_version,
            a.provider_evidence_key_domain, a.evidence_verified_at, a.evidence_expires_at,
            a.assurance_validity_model, a.status AS assertion_status,
            a.updated_at AS assertion_updated_at,
            b.status AS binding_status, b.last_verified_at, b.updated_at AS binding_updated_at
     FROM tokenless_assurance_assertions a
     JOIN tokenless_provider_subject_bindings b ON b.binding_id = a.binding_id AND b.rater_id = a.rater_id
     WHERE a.rater_id = $1 FOR UPDATE`,
    [text(row, "rater_id")],
  );
  const selectedIdentities = selectCurrentIdentityAssertions(identities.rows as Row[], now);
  if (!selectedIdentities) rejectEligibility();

  const expiries = [date(row, "age_evidence_expires_at")!, date(row, "sanctions_expires_at")!];
  const payoutExpiry = date(row, "payout_expires_at");
  if (payoutExpiry) expiries.push(payoutExpiry);
  for (const identity of selectedIdentities) {
    if (text(identity, "assurance_validity_model") !== "durable_enrollment") {
      expiries.push(date(identity, "evidence_expires_at")!);
    }
  }
  const validUntil = new Date(Math.min(...expiries.map(value => value.getTime())));
  if (validUntil <= now) rejectEligibility();
  const value = snapshot({ row, identities: selectedIdentities, principalId, checkedAt: now, validUntil });
  const commitmentProjection = {
    schemaVersion: value.schemaVersion,
    raterId: value.raterId,
    principalId: value.principalId,
    accountAddress: value.accountAddress,
    identityAssertions: value.identityAssertions,
    payoutAccount: value.payoutAccount,
    validUntil: value.validUntil,
    profile: {
      nullifierSeedCommitment: createHash("sha256").update(text(row, "nullifier_seed_ciphertext")!).digest("hex"),
      nullifierKeyVersion: text(row, "nullifier_key_version"),
      nullifierKeyDomain: text(row, "nullifier_key_domain"),
      updatedAt: date(row, "profile_updated_at")?.toISOString() ?? null,
    },
    legal: {
      minimumAgeVerified: Number(row.minimum_age_verified),
      ageEvidenceVerifiedAt: date(row, "age_evidence_verified_at")?.toISOString() ?? null,
      ageEvidenceExpiresAt: date(row, "age_evidence_expires_at")?.toISOString() ?? null,
      verifiedResidenceCountry: text(row, "verified_residence_country"),
      declaredResidenceCountry: text(row, "declared_residence_country"),
      taxResidenceCountry: text(row, "tax_residence_country"),
      residenceTaxStatus: text(row, "residence_tax_status"),
      taxProfileStatus: text(row, "tax_profile_status"),
      dac7Status: text(row, "dac7_status"),
      taxVaultPresent: Boolean(text(row, "tax_vault_ciphertext")),
      taxVaultKeyPresent: Boolean(text(row, "tax_vault_key_version")),
      taxVaultKeyDomain: text(row, "tax_vault_key_domain"),
      sanctionsConsentAt: date(row, "sanctions_consent_at")?.toISOString() ?? null,
      sanctionsStatus: text(row, "sanctions_status"),
      sanctionsReferenceHash: text(row, "sanctions_reference_hash"),
      sanctionsScreenedAt: date(row, "sanctions_screened_at")?.toISOString() ?? null,
      sanctionsExpiresAt: date(row, "sanctions_expires_at")?.toISOString() ?? null,
      eligibilityStatus: text(row, "legal_eligibility_status"),
      updatedAt: date(row, "legal_updated_at")?.toISOString() ?? null,
    },
    payout: {
      account: normalizeAddress(text(row, "payout_account")),
      ownershipMethod: text(row, "payout_ownership_method"),
      verifiedAt: date(row, "payout_verified_at")?.toISOString() ?? null,
      expiresAt: date(row, "payout_expires_at")?.toISOString() ?? null,
      eligibilityStatus: text(row, "payout_eligibility_status"),
      updatedAt: date(row, "payout_updated_at")?.toISOString() ?? null,
    },
    identityEvidence: selectedIdentities.map(identity => ({
      assertionId: text(identity, "assertion_id"),
      bindingId: text(identity, "binding_id"),
      providerId: text(identity, "provider_id"),
      providerNamespace: text(identity, "provider_namespace"),
      capabilities: [...parseCapabilities(identity.capabilities_json)!].sort((left, right) =>
        left === right ? 0 : left < right ? -1 : 1,
      ),
      minimumAgeVerified: Number(identity.assertion_minimum_age_verified),
      providerEvidencePresent: Boolean(text(identity, "provider_evidence_ciphertext")),
      providerEvidenceKeyPresent: Boolean(text(identity, "provider_evidence_key_version")),
      providerEvidenceKeyDomain: text(identity, "provider_evidence_key_domain"),
      verifiedAt: date(identity, "evidence_verified_at")?.toISOString() ?? null,
      expiresAt: date(identity, "evidence_expires_at")?.toISOString() ?? null,
      validityModel: text(identity, "assurance_validity_model"),
      assertionStatus: text(identity, "assertion_status"),
      assertionUpdatedAt: date(identity, "assertion_updated_at")?.toISOString() ?? null,
      bindingStatus: text(identity, "binding_status"),
      bindingLastVerifiedAt: date(identity, "last_verified_at")?.toISOString() ?? null,
      bindingUpdatedAt: date(identity, "binding_updated_at")?.toISOString() ?? null,
    })),
  };
  const digest = createHash("sha256").update(stableJson(commitmentProjection)).digest("hex");
  return {
    ...value,
    preflightId: `pef_${digest.slice(0, 48)}`,
    eligibilityCommitment: `sha256:${digest}`,
  };
}

export async function requirePaidReviewEligibility(
  principalId: string,
  now = new Date(),
): Promise<PaidReviewEligibilityPreflight> {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await requirePaidReviewEligibilityInTransaction(client, principalId, now);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
