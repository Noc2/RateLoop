import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const TOKENLESS_HOME_REGIONS = ["eu"] as const;
export type TokenlessHomeRegion = (typeof TOKENLESS_HOME_REGIONS)[number];

export const TOKENLESS_DATA_CLASSIFICATIONS = [
  "public",
  "synthetic",
  "redacted",
  "internal",
  "confidential",
  "restricted",
  "regulated",
] as const;
export type TokenlessDataClassification = (typeof TOKENLESS_DATA_CLASSIFICATIONS)[number];

export const TOKENLESS_DATA_USES = ["service_delivery", "security", "billing", "support", "legal_obligation"] as const;
export type TokenlessDataUse = (typeof TOKENLESS_DATA_USES)[number];

const CLASSIFICATION_RANK = new Map(TOKENLESS_DATA_CLASSIFICATIONS.map((value, index) => [value, index]));

export function parseDataClassification(value: unknown): TokenlessDataClassification {
  if (!TOKENLESS_DATA_CLASSIFICATIONS.includes(value as TokenlessDataClassification)) {
    throw new TokenlessServiceError("Data classification is unsupported.", 400, "invalid_data_classification");
  }
  return value as TokenlessDataClassification;
}

export function parseDataUses(value: unknown): TokenlessDataUse[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      throw new TokenlessServiceError("Credential data uses are invalid.", 500, "invalid_data_policy");
    }
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.some(item => !TOKENLESS_DATA_USES.includes(item as TokenlessDataUse))
  ) {
    throw new TokenlessServiceError("Credential data uses are invalid.", 500, "invalid_data_policy");
  }
  return [...new Set(parsed)] as TokenlessDataUse[];
}

export function assertDataIngressPolicy(input: {
  classification: unknown;
  confirmedNoSensitiveData?: boolean;
  homeRegion?: string;
  regulatedModeEnabled?: boolean;
  use?: TokenlessDataUse;
  visibility: "private" | "public";
}) {
  const classification = parseDataClassification(input.classification);
  const homeRegion = input.homeRegion ?? "eu";
  if (homeRegion !== "eu") {
    throw new TokenlessServiceError("The tokenless data plane is EU-only.", 409, "home_region_mismatch");
  }
  if (classification === "regulated" && input.regulatedModeEnabled !== true) {
    throw new TokenlessServiceError(
      "Regulated data requires an explicitly enabled contract mode.",
      403,
      "regulated_data_not_enabled",
    );
  }
  if (input.visibility === "public") {
    if (!["public", "synthetic", "redacted"].includes(classification)) {
      throw new TokenlessServiceError(
        "Public questions cannot carry internal, confidential, restricted, or regulated data.",
        400,
        "invalid_public_privacy",
      );
    }
    if (input.confirmedNoSensitiveData !== true) {
      throw new TokenlessServiceError(
        "Public questions require a no-sensitive-data confirmation.",
        400,
        "sensitive_data_confirmation_required",
      );
    }
  }
  return { classification, homeRegion: "eu" as const, use: input.use ?? "service_delivery" };
}

export function assertCredentialDataPolicy(input: {
  classification: unknown;
  credentialHomeRegion: string;
  homeRegion: string;
  maxClassification: unknown;
  permittedDataUses: unknown;
  use?: TokenlessDataUse;
}) {
  const classification = parseDataClassification(input.classification);
  const maxClassification = parseDataClassification(input.maxClassification);
  const permittedDataUses = parseDataUses(input.permittedDataUses);
  const use = input.use ?? "service_delivery";
  if (input.homeRegion !== "eu" || input.credentialHomeRegion !== input.homeRegion) {
    throw new TokenlessServiceError(
      "Credential region does not match the workspace.",
      403,
      "credential_region_mismatch",
    );
  }
  if ((CLASSIFICATION_RANK.get(classification) ?? Infinity) > (CLASSIFICATION_RANK.get(maxClassification) ?? -1)) {
    throw new TokenlessServiceError(
      "Credential classification does not permit this request.",
      403,
      "credential_classification_forbidden",
    );
  }
  if (!permittedDataUses.includes(use)) {
    throw new TokenlessServiceError(
      "Credential data use does not permit this request.",
      403,
      "credential_use_forbidden",
    );
  }
  return { classification, homeRegion: "eu" as const, use };
}
