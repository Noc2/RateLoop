import { type Hex, keccak256, stringToHex } from "viem";

export const PUBLIC_RATER_RESPONSE_SCHEMA_VERSION = "rateloop.public-rater-response.v1" as const;
export const PUBLIC_RATER_RESPONSE_BODY_MAX_LENGTH = 1_500;
export const PUBLIC_RATER_RESPONSE_SOURCE_URL_MAX_LENGTH = 2_048;
export const PUBLIC_RATER_RESPONSE_CATEGORIES = [
  "opinion",
  "evidence",
  "clarification",
  "concern",
  "bug_report",
  "other",
] as const;

export type PublicRaterResponseCategory = (typeof PUBLIC_RATER_RESPONSE_CATEGORIES)[number];
export type PublicRaterRationaleRequirement = {
  mode: "optional" | "required";
  minLength?: number;
  maxLength?: number;
};

export type PublicRaterResponseInput = {
  schemaVersion: typeof PUBLIC_RATER_RESPONSE_SCHEMA_VERSION;
  category: PublicRaterResponseCategory | null;
  body: string;
  sourceUrl?: string | null;
  nonce: Hex;
  responseHash: Hex;
};

export type PublicRaterResponseBinding = {
  operationKey: string;
  roundId: string;
  contentId: Hex;
  rationale?: PublicRaterRationaleRequirement;
};

export type CanonicalPublicRaterResponse = {
  schemaVersion: typeof PUBLIC_RATER_RESPONSE_SCHEMA_VERSION;
  operationKey: string;
  roundId: string;
  contentId: Hex;
  feedback: { category: PublicRaterResponseCategory; body: string; sourceUrl: string | null } | null;
  nonce: Hex;
};

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

function invalid(message: string): never {
  throw new Error(message);
}

export function hashCanonicalPublicRaterResponse(value: CanonicalPublicRaterResponse): Hex {
  return keccak256(stringToHex(canonicalJson(value)));
}

export function normalizePublicRaterResponse(
  binding: PublicRaterResponseBinding,
  input: PublicRaterResponseInput,
): { canonical: CanonicalPublicRaterResponse; responseHash: Hex } {
  if (!input || input.schemaVersion !== PUBLIC_RATER_RESPONSE_SCHEMA_VERSION) {
    invalid("Feedback schema version is invalid.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.nonce)) invalid("Feedback nonce must contain 32 random bytes.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.responseHash)) invalid("Feedback response hash is invalid.");

  const body = typeof input.body === "string" ? input.body.trim() : invalid("Feedback body is invalid.");
  const rationale = binding.rationale ?? { mode: "optional" as const };
  const maximum = Math.min(
    rationale.maxLength ?? PUBLIC_RATER_RESPONSE_BODY_MAX_LENGTH,
    PUBLIC_RATER_RESPONSE_BODY_MAX_LENGTH,
  );
  const minimum = rationale.mode === "required" ? Math.max(1, rationale.minLength ?? 1) : 0;
  if (body.length < minimum || body.length > maximum) {
    invalid(
      rationale.mode === "required"
        ? `Feedback must contain ${minimum}-${maximum} characters.`
        : `Feedback must contain at most ${maximum} characters.`,
    );
  }

  let feedback: CanonicalPublicRaterResponse["feedback"] = null;
  if (body) {
    if (!PUBLIC_RATER_RESPONSE_CATEGORIES.includes(input.category as PublicRaterResponseCategory)) {
      invalid("Choose a valid feedback category.");
    }
    let sourceUrl: string | null = null;
    if (input.sourceUrl?.trim()) {
      const rawSourceUrl = input.sourceUrl.trim();
      if (rawSourceUrl.length > PUBLIC_RATER_RESPONSE_SOURCE_URL_MAX_LENGTH) invalid("Source URL is too long.");
      let parsed: URL;
      try {
        parsed = new URL(rawSourceUrl);
      } catch {
        invalid("Source URL must be a valid HTTPS URL.");
      }
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
        invalid("Source URL must use HTTPS and must not contain credentials.");
      }
      sourceUrl = parsed.toString();
    }
    feedback = { category: input.category as PublicRaterResponseCategory, body, sourceUrl };
  } else if (input.category !== null || input.sourceUrl?.trim()) {
    invalid("Add feedback before choosing a category or source URL.");
  }

  const canonical: CanonicalPublicRaterResponse = {
    schemaVersion: PUBLIC_RATER_RESPONSE_SCHEMA_VERSION,
    operationKey: binding.operationKey,
    roundId: binding.roundId,
    contentId: binding.contentId.toLowerCase() as Hex,
    feedback,
    nonce: input.nonce.toLowerCase() as Hex,
  };
  const responseHash = hashCanonicalPublicRaterResponse(canonical);
  if (responseHash !== input.responseHash.toLowerCase()) invalid("Feedback response hash does not match its contents.");
  return { canonical, responseHash };
}

export function createPublicRaterResponse(
  binding: PublicRaterResponseBinding,
  input: Omit<PublicRaterResponseInput, "schemaVersion" | "responseHash">,
): PublicRaterResponseInput {
  const provisional = {
    schemaVersion: PUBLIC_RATER_RESPONSE_SCHEMA_VERSION,
    ...input,
    responseHash: `0x${"0".repeat(64)}` as Hex,
  };
  const normalized = normalizePublicRaterResponse(binding, {
    ...provisional,
    responseHash: hashCanonicalPublicRaterResponse({
      schemaVersion: PUBLIC_RATER_RESPONSE_SCHEMA_VERSION,
      operationKey: binding.operationKey,
      roundId: binding.roundId,
      contentId: binding.contentId.toLowerCase() as Hex,
      feedback: input.body.trim()
        ? {
            category: input.category as PublicRaterResponseCategory,
            body: input.body.trim(),
            sourceUrl: input.sourceUrl?.trim() ? new URL(input.sourceUrl.trim()).toString() : null,
          }
        : null,
      nonce: input.nonce.toLowerCase() as Hex,
    }),
  });
  return { ...provisional, responseHash: normalized.responseHash };
}
