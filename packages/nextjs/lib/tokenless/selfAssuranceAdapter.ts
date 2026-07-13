import type { HumanAssuranceCapability } from "@rateloop/sdk";
import { createHash } from "node:crypto";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const SELF_DOCUMENT_ADAPTER_VERSION = "rateloop-self-document-v0-disabled" as const;

export type SelfDocumentPredicateConfiguration = {
  minimumAge?: number;
  allowedDocumentIssuingCountries?: string[];
  allowedNationalities?: string[];
};

export type NormalizedSelfDocumentResult = {
  valid: boolean;
  providerSubjectReference: string;
  configuration: SelfDocumentPredicateConfiguration;
  disclosed: {
    minimumAgeVerified?: number;
    documentIssuingCountry?: string;
    nationality?: string;
  };
};

export type SelfDocumentVerifier = {
  verify(proof: unknown): Promise<NormalizedSelfDocumentResult>;
};

type SelfReleaseGates = {
  enabled: boolean;
  providerAccessApproved: boolean;
  dataProcessingApproved: boolean;
  conversionApproved: boolean;
  errorHandlingApproved: boolean;
};

type SelfAdapterEnvironment = Record<string, string | undefined>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Self predicate configuration must be JSON serializable.");
  return encoded;
}

function country(value: string, field: string) {
  const normalized = value.toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) throw new Error(`${field} contains an invalid country code.`);
  return normalized;
}

export function normalizeSelfDocumentConfiguration(
  input: SelfDocumentPredicateConfiguration,
): SelfDocumentPredicateConfiguration {
  const minimumAge = input.minimumAge;
  if (minimumAge !== undefined && (!Number.isSafeInteger(minimumAge) || minimumAge < 18 || minimumAge > 120)) {
    throw new Error("Self minimumAge must be an integer from 18 to 120.");
  }
  const issuingCountries = [
    ...new Set(
      (input.allowedDocumentIssuingCountries ?? []).map(value => country(value, "allowedDocumentIssuingCountries")),
    ),
  ].sort();
  const nationalities = [
    ...new Set((input.allowedNationalities ?? []).map(value => country(value, "allowedNationalities"))),
  ].sort();
  return {
    ...(minimumAge === undefined ? {} : { minimumAge }),
    ...(issuingCountries.length === 0 ? {} : { allowedDocumentIssuingCountries: issuingCountries }),
    ...(nationalities.length === 0 ? {} : { allowedNationalities: nationalities }),
  };
}

export function selfDocumentConfigurationHash(input: SelfDocumentPredicateConfiguration) {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(normalizeSelfDocumentConfiguration(input)))
    .digest("hex")}`;
}

function releaseGates(env: SelfAdapterEnvironment = process.env): SelfReleaseGates {
  const enabled = env.TOKENLESS_SELF_ASSURANCE_ENABLED === "true";
  return {
    enabled,
    providerAccessApproved: env.TOKENLESS_SELF_PROVIDER_ACCESS_APPROVED === "true",
    dataProcessingApproved: env.TOKENLESS_SELF_DPA_APPROVED === "true",
    conversionApproved: env.TOKENLESS_SELF_CONVERSION_GATE_APPROVED === "true",
    errorHandlingApproved: env.TOKENLESS_SELF_ERROR_HANDLING_GATE_APPROVED === "true",
  };
}

export function selfDocumentAdapterStatus(env: SelfAdapterEnvironment = process.env) {
  const gates = releaseGates(env);
  const missingGates = Object.entries(gates)
    .filter(([name, satisfied]) => name !== "enabled" && !satisfied)
    .map(([name]) => name)
    .sort();
  return {
    version: SELF_DOCUMENT_ADAPTER_VERSION,
    enabled: gates.enabled && missingGates.length === 0,
    missingGates,
    capabilityBoundary: ["document_holder", "minimum_age", "issuing_country", "nationality"] as const,
    limitationCodes: ["does_not_replace_world_unique_human", "cross_provider_deduplication_unsolved"],
  };
}

export async function verifySelfDocumentPredicates(input: {
  requestedConfiguration: SelfDocumentPredicateConfiguration;
  proof: unknown;
  verifier: SelfDocumentVerifier;
  env?: SelfAdapterEnvironment;
}) {
  const status = selfDocumentAdapterStatus(input.env);
  if (!status.enabled) {
    throw new TokenlessServiceError(
      "The optional Self document adapter is not enabled for production use.",
      503,
      "self_provider_disabled",
    );
  }
  const requestedConfiguration = normalizeSelfDocumentConfiguration(input.requestedConfiguration);
  const result = await input.verifier.verify(input.proof);
  const verifiedConfiguration = normalizeSelfDocumentConfiguration(result.configuration);
  if (
    !result.valid ||
    selfDocumentConfigurationHash(verifiedConfiguration) !== selfDocumentConfigurationHash(requestedConfiguration)
  ) {
    throw new TokenlessServiceError(
      "The Self proof does not match the exact requested predicates.",
      403,
      "self_configuration_mismatch",
    );
  }
  if (!result.providerSubjectReference.trim()) {
    throw new TokenlessServiceError("The Self proof subject is missing.", 403, "self_subject_missing");
  }

  const capabilities = new Set<HumanAssuranceCapability>(["document_holder"]);
  if (requestedConfiguration.minimumAge !== undefined) {
    if ((result.disclosed.minimumAgeVerified ?? 0) < requestedConfiguration.minimumAge) {
      throw new TokenlessServiceError("The requested Self age predicate was not met.", 403, "self_predicate_failed");
    }
    capabilities.add("minimum_age");
  }
  if (requestedConfiguration.allowedDocumentIssuingCountries?.length) {
    const issuingCountry = result.disclosed.documentIssuingCountry?.toUpperCase();
    if (!issuingCountry || !requestedConfiguration.allowedDocumentIssuingCountries.includes(issuingCountry)) {
      throw new TokenlessServiceError("The requested Self issuer predicate was not met.", 403, "self_predicate_failed");
    }
    capabilities.add("issuing_country");
  }
  if (requestedConfiguration.allowedNationalities?.length) {
    const nationality = result.disclosed.nationality?.toUpperCase();
    if (!nationality || !requestedConfiguration.allowedNationalities.includes(nationality)) {
      throw new TokenlessServiceError(
        "The requested Self nationality predicate was not met.",
        403,
        "self_predicate_failed",
      );
    }
    capabilities.add("nationality");
  }
  return {
    providerId: "self:document" as const,
    providerNamespace: selfDocumentConfigurationHash(requestedConfiguration),
    providerSubjectReference: result.providerSubjectReference,
    capabilities: [...capabilities].sort(),
    configuration: requestedConfiguration,
    configurationHash: selfDocumentConfigurationHash(requestedConfiguration),
    limitationCodes: status.limitationCodes,
  };
}
