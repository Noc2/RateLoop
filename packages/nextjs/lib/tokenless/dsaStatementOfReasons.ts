export const DSA_SOR_APPLICABILITY = [
  "required",
  "no_recipient_electronic_contact",
  "deceptive_high_volume_commercial_content",
  "article_9_order",
  "service_not_online_platform",
  "restriction_outside_article_17",
  "other_documented_exclusion",
] as const;

export type DsaSorApplicability = (typeof DSA_SOR_APPLICABILITY)[number];

export const DSA_TRANSPARENCY_DATABASE_SCHEMA_VERSION = "dsa-transparency-database-api-v2-2025-07-01" as const;
export const DSA_SOR_LEDGER_SCHEMA_VERSION = "rateloop.dsa-sor-ledger.v1" as const;

const PUID = /^[A-Za-z0-9_-]{1,500}$/u;
const EMAIL = /(?:^|[^A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:$|[^A-Za-z0-9.-])/u;
const IPV4 =
  /(?:^|[^0-9])(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(?:\.(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}(?:$|[^0-9])/u;
const PHONE = /(?:^|[^0-9])\+?[0-9][0-9 ()-]{6,}[0-9](?:$|[^0-9])/u;
const FREE_TEXT_KEYS = new Set([
  "decision_facts",
  "illegal_content_explanation",
  "incompatible_content_explanation",
  "other_explanation",
]);

export type DsaSorPreflightViolation = {
  path: string;
  code:
    | "invalid_puid"
    | "duplicate_puid"
    | "batch_too_large"
    | "known_personal_identifier"
    | "source_identity_forbidden"
    | "unsafe_url"
    | "residual_free_text_unconfirmed"
    | "invalid_ean13"
    | "invalid_payload";
};

function entries(value: unknown, path = "$"): Array<{ path: string; key: string; value: unknown }> {
  if (Array.isArray(value)) return value.flatMap((entry, index) => entries(entry, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => [
    { path: `${path}.${key}`, key, value: entry },
    ...entries(entry, `${path}.${key}`),
  ]);
}

function containsKnownIdentifier(value: string) {
  return EMAIL.test(` ${value} `) || IPV4.test(` ${value} `) || PHONE.test(` ${value} `);
}

function validEan13(value: string) {
  if (!/^[0-9]{13}$/u.test(value)) return false;
  const digits = [...value].map(Number);
  const checksum = digits.slice(0, 12).reduce((sum, digit, index) => sum + digit * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (checksum % 10)) % 10 === digits[12];
}

function safePublicUrl(value: string, allowedHosts: ReadonlySet<string>) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      allowedHosts.has(parsed.hostname.toLowerCase()) &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  } catch {
    return false;
  }
}

export function preflightDsaSorPayload(input: {
  puid: string;
  payload: Record<string, unknown>;
  humanConfirmedResidualFreeText: boolean;
  allowedPublicUrlHosts?: readonly string[];
}) {
  const violations: DsaSorPreflightViolation[] = [];
  if (!PUID.test(input.puid)) violations.push({ path: "$.puid", code: "invalid_puid" });
  const allowedHosts = new Set((input.allowedPublicUrlHosts ?? []).map(host => host.toLowerCase()));
  for (const entry of entries(input.payload)) {
    if (entry.key === "source_identity" && entry.value !== null && entry.value !== "") {
      violations.push({ path: entry.path, code: "source_identity_forbidden" });
    }
    if (entry.key === "content_id" && typeof entry.value === "string" && !validEan13(entry.value)) {
      violations.push({ path: entry.path, code: "invalid_ean13" });
    }
    if (typeof entry.value !== "string" || entry.value.length === 0) continue;
    // `content_id` is a DSA-defined EAN-13 field. A valid identifier is all
    // digits by design, so the generic phone-number detector must not reject it.
    if (entry.key !== "content_id" && containsKnownIdentifier(entry.value)) {
      violations.push({ path: entry.path, code: "known_personal_identifier" });
    }
    if ((entry.key.endsWith("url") || entry.key.endsWith("uri")) && !safePublicUrl(entry.value, allowedHosts)) {
      violations.push({ path: entry.path, code: "unsafe_url" });
    }
    if (FREE_TEXT_KEYS.has(entry.key) && !input.humanConfirmedResidualFreeText) {
      violations.push({ path: entry.path, code: "residual_free_text_unconfirmed" });
    }
  }
  return { valid: violations.length === 0, violations } as const;
}

export function preflightDsaSorBatch(input: {
  statements: readonly {
    puid: string;
    payload: Record<string, unknown>;
    humanConfirmedResidualFreeText: boolean;
    allowedPublicUrlHosts?: readonly string[];
  }[];
}) {
  const violations: DsaSorPreflightViolation[] = [];
  if (input.statements.length === 0 || input.statements.length > 100) {
    violations.push({ path: "$.statements", code: "batch_too_large" });
  }
  const seen = new Set<string>();
  input.statements.forEach((statement, index) => {
    if (seen.has(statement.puid)) violations.push({ path: `$.statements[${index}].puid`, code: "duplicate_puid" });
    seen.add(statement.puid);
    violations.push(
      ...preflightDsaSorPayload(statement).violations.map(violation => ({
        ...violation,
        path: `$.statements[${index}]${violation.path.slice(1)}`,
      })),
    );
  });
  return { valid: violations.length === 0, violations } as const;
}

type DsaSorCreationReceipt = {
  uuid: string;
  id: string | number;
  created_at: string;
  permalink: string;
  self: string;
};

export function classifyDsaSorSubmission(status: number, body: unknown) {
  if (status === 201 && body && typeof body === "object") {
    const value = body as Partial<DsaSorCreationReceipt>;
    if (
      typeof value.uuid === "string" &&
      (typeof value.id === "string" || typeof value.id === "number") &&
      typeof value.created_at === "string" &&
      Number.isFinite(Date.parse(value.created_at)) &&
      typeof value.permalink === "string" &&
      typeof value.self === "string"
    ) {
      return { status: "created", receipt: value as DsaSorCreationReceipt } as const;
    }
    return { status: "invalid_creation_receipt", receipt: null } as const;
  }
  if (status === 422) return { status: "validation_rejected", receipt: null } as const;
  if (status >= 500 || status === 408 || status === 429) {
    return { status: "unknown_outcome_check_puid_before_retry", receipt: null } as const;
  }
  return { status: "failed", receipt: null } as const;
}

export function classifyDsaSorPuidLookup(status: number) {
  if (status === 302) return "exists" as const;
  if (status === 404) return "absent" as const;
  return "unknown" as const;
}
