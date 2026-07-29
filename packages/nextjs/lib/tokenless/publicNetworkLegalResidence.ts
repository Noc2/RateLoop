import { createHash } from "node:crypto";

const EEA_COUNTRY_CODES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IS",
  "IE",
  "IT",
  "LV",
  "LI",
  "LT",
  "LU",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
] as const;

const POLICY_PROJECTION = Object.freeze({
  schemaVersion: "rateloop.public-network-legal-residence-policy.v1",
  predicate: "provider_verified_legal_residence_in_eea",
  supportedCountryCodes: Object.freeze([...EEA_COUNTRY_CODES]),
  requiredEvidence: Object.freeze([
    "current_provider_verified_residence",
    "matching_declared_residence",
    "matching_tax_residence",
    "current_dac7_record_when_required",
  ]),
});

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY = Object.freeze({
  ...POLICY_PROJECTION,
  policyHash: `sha256:${createHash("sha256").update(canonicalJson(POLICY_PROJECTION)).digest("hex")}` as const,
});

const EEA_COUNTRIES = new Set<string>(PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.supportedCountryCodes);
const DAC7_RECORD_ID = /^dac7_[0-9a-f]{32}$/u;

export type PublicNetworkLegalResidenceEvidence = {
  raterId: string | null;
  scopeId: string | null;
  verifiedResidenceCountry: string | null;
  declaredResidenceCountry: string | null;
  taxResidenceCountry: string | null;
  residenceTaxStatus: string | null;
  providerAssertionId: string | null;
  providerVerifiedResidenceCountry: string | null;
  providerEvidenceVerifiedAt: Date | null;
  providerEvidenceExpiresAt: Date | null;
  dac7Status: string | null;
  dac7RecordId: string | null;
  dac7RecordRaterId: string | null;
  dac7SourceScopeReference: string | null;
  dac7ReviewerSource: string | null;
  dac7WorkspaceReference: string | null;
  dac7CollectedAt: Date | null;
  dac7RetainedUntil: Date | null;
};

export type FrozenPublicNetworkLegalResidence = {
  schemaVersion: typeof PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.schemaVersion;
  policyHash: typeof PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.policyHash;
  predicate: typeof PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.predicate;
  countryCode: string;
  providerAssertionId: string;
  evidenceVerifiedAt: string;
  validUntil: string;
  taxEvidence:
    | { kind: "paid_eligibility"; dac7Status: "not_required" }
    | {
        kind: "dac7";
        dac7Status: "complete";
        recordId: string;
        collectedAt: string;
        retainedUntil: string;
      };
};

/**
 * This is deliberately a legal-residence predicate. Its input has no IP,
 * locale, document-issuer, or nationality field, so those signals cannot
 * silently become residence evidence.
 */
export function evaluatePublicNetworkLegalResidence(
  evidence: PublicNetworkLegalResidenceEvidence,
  now: Date,
): FrozenPublicNetworkLegalResidence | null {
  const country = evidence.verifiedResidenceCountry;
  if (
    !evidence.raterId ||
    !evidence.scopeId ||
    !country ||
    !EEA_COUNTRIES.has(country) ||
    evidence.declaredResidenceCountry !== country ||
    evidence.taxResidenceCountry !== country ||
    evidence.residenceTaxStatus !== "consistent" ||
    !evidence.providerAssertionId ||
    evidence.providerVerifiedResidenceCountry !== country ||
    !evidence.providerEvidenceVerifiedAt ||
    evidence.providerEvidenceVerifiedAt > now ||
    !evidence.providerEvidenceExpiresAt ||
    evidence.providerEvidenceExpiresAt <= now ||
    evidence.providerEvidenceExpiresAt <= evidence.providerEvidenceVerifiedAt
  ) {
    return null;
  }

  let validUntil = evidence.providerEvidenceExpiresAt;
  let taxEvidence: FrozenPublicNetworkLegalResidence["taxEvidence"];
  if (evidence.dac7Status === "complete") {
    if (
      !evidence.dac7RecordId ||
      !DAC7_RECORD_ID.test(evidence.dac7RecordId) ||
      evidence.dac7RecordRaterId !== evidence.raterId ||
      evidence.dac7SourceScopeReference !== evidence.scopeId ||
      evidence.dac7ReviewerSource !== "rateloop_network" ||
      evidence.dac7WorkspaceReference !== null ||
      !evidence.dac7CollectedAt ||
      evidence.dac7CollectedAt > now ||
      !evidence.dac7RetainedUntil ||
      evidence.dac7RetainedUntil <= now ||
      evidence.dac7RetainedUntil <= evidence.dac7CollectedAt
    ) {
      return null;
    }
    validUntil = new Date(Math.min(validUntil.getTime(), evidence.dac7RetainedUntil.getTime()));
    taxEvidence = {
      kind: "dac7",
      dac7Status: "complete",
      recordId: evidence.dac7RecordId,
      collectedAt: evidence.dac7CollectedAt.toISOString(),
      retainedUntil: evidence.dac7RetainedUntil.toISOString(),
    };
  } else if (
    evidence.dac7Status === "not_required" &&
    evidence.dac7RecordId === null &&
    evidence.dac7RecordRaterId === null &&
    evidence.dac7SourceScopeReference === null &&
    evidence.dac7ReviewerSource === null &&
    evidence.dac7WorkspaceReference === null &&
    evidence.dac7CollectedAt === null &&
    evidence.dac7RetainedUntil === null
  ) {
    taxEvidence = { kind: "paid_eligibility", dac7Status: "not_required" };
  } else {
    return null;
  }

  return {
    schemaVersion: PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.schemaVersion,
    policyHash: PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.policyHash,
    predicate: PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.predicate,
    countryCode: country,
    providerAssertionId: evidence.providerAssertionId,
    evidenceVerifiedAt: evidence.providerEvidenceVerifiedAt.toISOString(),
    validUntil: validUntil.toISOString(),
    taxEvidence,
  };
}

export function isFrozenPublicNetworkLegalResidence(
  value: unknown,
  now?: Date,
): value is FrozenPublicNetworkLegalResidence {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.schemaVersion !== PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.schemaVersion ||
    snapshot.policyHash !== PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.policyHash ||
    snapshot.predicate !== PUBLIC_NETWORK_LEGAL_RESIDENCE_POLICY.predicate ||
    typeof snapshot.countryCode !== "string" ||
    !EEA_COUNTRIES.has(snapshot.countryCode) ||
    typeof snapshot.providerAssertionId !== "string" ||
    snapshot.providerAssertionId.length === 0 ||
    typeof snapshot.evidenceVerifiedAt !== "string" ||
    typeof snapshot.validUntil !== "string"
  ) {
    return false;
  }
  const verifiedAt = new Date(snapshot.evidenceVerifiedAt);
  const validUntil = new Date(snapshot.validUntil);
  if (
    !Number.isFinite(verifiedAt.getTime()) ||
    !Number.isFinite(validUntil.getTime()) ||
    validUntil <= verifiedAt ||
    (now !== undefined && (verifiedAt > now || validUntil <= now))
  ) {
    return false;
  }
  const taxEvidence = snapshot.taxEvidence;
  if (!taxEvidence || typeof taxEvidence !== "object") return false;
  const tax = taxEvidence as Record<string, unknown>;
  if (tax.kind === "paid_eligibility") {
    return tax.dac7Status === "not_required" && Object.keys(tax).length === 2;
  }
  if (
    tax.kind !== "dac7" ||
    tax.dac7Status !== "complete" ||
    typeof tax.recordId !== "string" ||
    !DAC7_RECORD_ID.test(tax.recordId) ||
    typeof tax.collectedAt !== "string" ||
    typeof tax.retainedUntil !== "string"
  ) {
    return false;
  }
  const collectedAt = new Date(tax.collectedAt);
  const retainedUntil = new Date(tax.retainedUntil);
  return (
    Number.isFinite(collectedAt.getTime()) &&
    Number.isFinite(retainedUntil.getTime()) &&
    retainedUntil > collectedAt &&
    (now === undefined || (collectedAt <= now && retainedUntil > now))
  );
}
