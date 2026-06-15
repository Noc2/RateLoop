import { content } from "ponder:schema";

export type ContentConfidentialityState = {
  bondAmount: bigint;
  bondAsset: "LREP" | "USDC";
  disclosurePolicy: "after_settlement" | "private_forever";
  publishedAt: bigint | null;
  visibility: "public" | "gated";
};

const CONFIDENTIALITY_HELPER_FIELDS = [
  "confidentialityBondAmount",
  "confidentialityBondAsset",
  "confidentialityDisclosurePolicy",
  "confidentialityPublishedAt",
  "gated",
  "questionMetadata",
] as const;

const HOSTED_ATTACHMENT_URL_PATTERN = /^https:\/\/[^/\s]+\/api\/attachments\/(?:details|images)\//i;

export function confidentialityContentSelectFields() {
  return {
    confidentialityBondAmount: content.confidentialityBondAmount,
    confidentialityBondAsset: content.confidentialityBondAsset,
    confidentialityDisclosurePolicy: content.confidentialityDisclosurePolicy,
    confidentialityPublishedAt: content.confidentialityPublishedAt,
    gated: content.gated,
    questionMetadata: content.questionMetadata,
  };
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseStoredJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseBigIntish(value: unknown) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value.trim())) return BigInt(value.trim());
  return 0n;
}

function normalizeDisclosurePolicy(value: unknown): ContentConfidentialityState["disclosurePolicy"] {
  return value === "private_forever" ? "private_forever" : "after_settlement";
}

function normalizeBondAsset(value: unknown): ContentConfidentialityState["bondAsset"] {
  return typeof value === "string" && value.trim().toUpperCase() === "USDC" ? "USDC" : "LREP";
}

export function readQuestionMetadataConfidentiality(value: unknown): ContentConfidentialityState | null {
  if (!isJsonRecord(value) || !isJsonRecord(value.confidentiality)) return null;
  const confidentiality = value.confidentiality;
  if (confidentiality.visibility !== "gated") return null;
  const bond = isJsonRecord(confidentiality.bond) ? confidentiality.bond : {};
  return {
    visibility: "gated",
    disclosurePolicy: normalizeDisclosurePolicy(confidentiality.disclosurePolicy),
    bondAsset: normalizeBondAsset(bond.asset),
    bondAmount: parseBigIntish(bond.amount),
    publishedAt: null,
  };
}

export function rowConfidentialityState(record: Record<string, unknown>): ContentConfidentialityState {
  const metadataState = readQuestionMetadataConfidentiality(parseStoredJson(record.questionMetadata as string | null));
  const rowGated = record.gated === true || metadataState?.visibility === "gated";
  const publishedAt =
    typeof record.confidentialityPublishedAt === "bigint"
      ? record.confidentialityPublishedAt
      : metadataState?.publishedAt ?? null;

  if (!rowGated) {
    return {
      visibility: "public",
      disclosurePolicy: "after_settlement",
      bondAsset: "LREP",
      bondAmount: 0n,
      publishedAt: null,
    };
  }

  return {
    visibility: "gated",
    disclosurePolicy: normalizeDisclosurePolicy(record.confidentialityDisclosurePolicy ?? metadataState?.disclosurePolicy),
    bondAsset: normalizeBondAsset(record.confidentialityBondAsset ?? metadataState?.bondAsset),
    bondAmount: parseBigIntish(record.confidentialityBondAmount ?? metadataState?.bondAmount),
    publishedAt,
  };
}

export function isGatedUndisclosedContent(record: Record<string, unknown>) {
  const confidentiality = rowConfidentialityState(record);
  return confidentiality.visibility === "gated" && confidentiality.publishedAt === null;
}

export function formatConfidentialContent<T extends Record<string, unknown>>(
  item: T,
  options: { stripHelperFields?: boolean } = {},
): T {
  const formatted = { ...item };
  const record = formatted as Record<string, unknown>;
  const confidentiality = rowConfidentialityState(record);
  const gatedUndisclosed = confidentiality.visibility === "gated" && confidentiality.publishedAt === null;

  record.contextVisibility = confidentiality.visibility;
  record.contextAccess = gatedUndisclosed ? "gated" : "public";
  record.confidentiality = confidentiality;

  if (gatedUndisclosed) {
    record.description = "";
    record.detailsUrl = null;
    record.detailsHash = null;
    record.media = [];
    if (typeof record.url === "string" && HOSTED_ATTACHMENT_URL_PATTERN.test(record.url)) {
      record.url = "";
    }
    if (typeof record.canonicalUrl === "string" && HOSTED_ATTACHMENT_URL_PATTERN.test(record.canonicalUrl)) {
      record.canonicalUrl = "";
    }
  }

  if (options.stripHelperFields) {
    for (const field of CONFIDENTIALITY_HELPER_FIELDS) {
      delete record[field];
    }
  }

  return formatted;
}

export function formatConfidentialContentPreview<T extends Record<string, unknown>>(item: T): T {
  return formatConfidentialContent(item, { stripHelperFields: true });
}
