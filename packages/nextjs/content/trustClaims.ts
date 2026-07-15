export const TRUST_CLAIM_REGISTRY_VERSION = "2026-07-15.1" as const;

export type TrustClaimKind = "control" | "limitation" | "availability";
export type TrustClaimStatus = "implemented" | "limitation" | "not_available" | "verification_pending";
export type TrustClaimApproval = "approved" | "withheld";
export type TrustClaimVisibility = "public" | "internal";

export type TrustClaimEvidence = Readonly<{
  label: string;
  href: string;
}>;

export type TrustClaim = Readonly<{
  key: string;
  title: string;
  statement: string;
  kind: TrustClaimKind;
  status: TrustClaimStatus;
  approval: TrustClaimApproval;
  visibility: TrustClaimVisibility;
  effectiveDate: string;
  reviewDate: string;
  expiresDate: string | null;
  evidence: readonly TrustClaimEvidence[];
}>;

export type TrustClaimRegistry = Readonly<{
  version: typeof TRUST_CLAIM_REGISTRY_VERSION;
  updatedDate: string;
  claims: readonly TrustClaim[];
}>;

const IMPLEMENTATION_PLAN =
  "https://github.com/Noc2/RateLoop/blob/tokenless/docs/tokenless-eu-trust-and-identity-implementation-plan-2026-07-15.md";

const rawRegistry = {
  version: TRUST_CLAIM_REGISTRY_VERSION,
  updatedDate: "2026-07-15",
  claims: [
    {
      key: "private-artifact-encryption",
      title: "Private artifact encryption",
      statement: "Private artifacts are encrypted before storage.",
      kind: "control",
      status: "implemented",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-10-15",
      expiresDate: null,
      evidence: [
        { label: "Privacy notice", href: "/legal/privacy" },
        { label: "Privacy and recovery", href: "/docs/how-it-works" },
      ],
    },
    {
      key: "assigned-reviewer-leases",
      title: "Assigned reviewer access",
      statement:
        "Assigned reviewers receive short-lived access leases to the private artifacts needed for their assignment.",
      kind: "control",
      status: "implemented",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-10-15",
      expiresDate: null,
      evidence: [{ label: "Review flow", href: "/docs/how-it-works" }],
    },
    {
      key: "scoped-agent-credentials",
      title: "Scoped agent access",
      statement: "Agent connections use scoped, revocable credentials.",
      kind: "control",
      status: "implemented",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-10-15",
      expiresDate: null,
      evidence: [{ label: "Agents and MCP", href: "/docs/ai" }],
    },
    {
      key: "public-chain-limits",
      title: "Public-chain limits",
      statement: "Public-chain commitments and settlement records remain visible and cannot be erased.",
      kind: "limitation",
      status: "limitation",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-10-15",
      expiresDate: null,
      evidence: [
        { label: "Privacy notice", href: "/legal/privacy" },
        { label: "Smart contracts", href: "/docs/smart-contracts" },
      ],
    },
    {
      key: "eu-hosted-data-plane",
      title: "EU-hosted data plane",
      statement: "RateLoop does not currently claim an EU-hosted data plane.",
      kind: "availability",
      status: "verification_pending",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-08-15",
      expiresDate: null,
      evidence: [{ label: "EU implementation plan", href: IMPLEMENTATION_PLAN }],
    },
    {
      key: "soc-2-type-2",
      title: "SOC 2 Type II",
      statement: "RateLoop is not currently SOC 2 Type II attested.",
      kind: "availability",
      status: "not_available",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-10-15",
      expiresDate: null,
      evidence: [{ label: "Trust implementation plan", href: IMPLEMENTATION_PLAN }],
    },
    {
      key: "gdpr",
      title: "GDPR",
      statement: "RateLoop does not make a blanket GDPR compliance claim.",
      kind: "availability",
      status: "not_available",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-10-15",
      expiresDate: null,
      evidence: [{ label: "Privacy notice", href: "/legal/privacy" }],
    },
    {
      key: "hipaa-baa",
      title: "HIPAA via BAA",
      statement: "RateLoop does not currently offer HIPAA compliance through a BAA.",
      kind: "availability",
      status: "not_available",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-10-15",
      expiresDate: null,
      evidence: [{ label: "Trust implementation plan", href: IMPLEMENTATION_PLAN }],
    },
    {
      key: "customer-vpc",
      title: "Customer VPC deployment",
      statement: "RateLoop does not currently offer customer VPC deployment.",
      kind: "availability",
      status: "not_available",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-10-15",
      expiresDate: null,
      evidence: [{ label: "Trust implementation plan", href: IMPLEMENTATION_PLAN }],
    },
    {
      key: "saml-scim",
      title: "SAML and SCIM",
      statement: "RateLoop does not currently offer SAML or SCIM.",
      kind: "availability",
      status: "not_available",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-10-15",
      expiresDate: null,
      evidence: [{ label: "Trust implementation plan", href: IMPLEMENTATION_PLAN }],
    },
    {
      key: "independent-penetration-test",
      title: "Independent penetration testing",
      statement: "RateLoop does not currently publish an independent penetration-test report.",
      kind: "availability",
      status: "not_available",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-10-15",
      expiresDate: null,
      evidence: [{ label: "Trust implementation plan", href: IMPLEMENTATION_PLAN }],
    },
    {
      key: "contractual-no-training",
      title: "Contractual no-training commitment",
      statement: "RateLoop does not currently publish a contractual no-training commitment.",
      kind: "availability",
      status: "verification_pending",
      approval: "approved",
      visibility: "public",
      effectiveDate: "2026-07-15",
      reviewDate: "2026-08-15",
      expiresDate: null,
      evidence: [
        { label: "Privacy notice", href: "/legal/privacy" },
        { label: "Trust implementation plan", href: IMPLEMENTATION_PLAN },
      ],
    },
  ],
} satisfies TrustClaimRegistry;

function parseDate(value: string, field: string, key: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Trust claim ${key} has an invalid ${field}`);
  }

  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`Trust claim ${key} has an invalid ${field}`);
  }
  return timestamp;
}

export function validateTrustClaimRegistry(registry: TrustClaimRegistry): TrustClaimRegistry {
  if (registry.version !== TRUST_CLAIM_REGISTRY_VERSION) {
    throw new Error("Trust claim registry version is not supported");
  }

  parseDate(registry.updatedDate, "updatedDate", "registry");
  const keys = new Set<string>();
  const statements = new Set<string>();

  for (const claim of registry.claims) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(claim.key) || keys.has(claim.key)) {
      throw new Error(`Trust claim key is invalid or duplicated: ${claim.key}`);
    }
    keys.add(claim.key);

    if (
      !claim.title.trim() ||
      !claim.statement.trim() ||
      claim.statement !== claim.statement.trim() ||
      statements.has(claim.statement) ||
      claim.evidence.length === 0
    ) {
      throw new Error(`Trust claim ${claim.key} is missing exact text or evidence`);
    }
    statements.add(claim.statement);
    if (claim.visibility === "public" && claim.approval !== "approved") {
      throw new Error(`Public trust claim ${claim.key} must be approved`);
    }
    if (
      (claim.kind === "control" && claim.status !== "implemented") ||
      (claim.kind === "limitation" && claim.status !== "limitation") ||
      (claim.kind === "availability" && !["not_available", "verification_pending"].includes(claim.status))
    ) {
      throw new Error(`Trust claim ${claim.key} has an invalid kind and status combination`);
    }

    const effective = parseDate(claim.effectiveDate, "effectiveDate", claim.key);
    const review = parseDate(claim.reviewDate, "reviewDate", claim.key);
    if (review <= effective) {
      throw new Error(`Trust claim ${claim.key} must be reviewed after it becomes effective`);
    }
    if (claim.expiresDate !== null && parseDate(claim.expiresDate, "expiresDate", claim.key) <= effective) {
      throw new Error(`Trust claim ${claim.key} must expire after it becomes effective`);
    }

    for (const evidence of claim.evidence) {
      if (!evidence.label.trim() || !(evidence.href.startsWith("/") || evidence.href.startsWith("https://"))) {
        throw new Error(`Trust claim ${claim.key} has invalid evidence`);
      }
    }
  }

  return registry;
}

export const TRUST_CLAIM_REGISTRY = validateTrustClaimRegistry(rawRegistry);

export const TRUST_CLAIM_BY_KEY = Object.fromEntries(
  TRUST_CLAIM_REGISTRY.claims.map(claim => [claim.key, claim]),
) as Readonly<Record<(typeof rawRegistry.claims)[number]["key"], (typeof rawRegistry.claims)[number]>>;

export function getCurrentPublicTrustClaims(asOf = new Date()): readonly TrustClaim[] {
  const timestamp = asOf.getTime();
  return TRUST_CLAIM_REGISTRY.claims.filter(claim => {
    const effective = Date.parse(`${claim.effectiveDate}T00:00:00.000Z`);
    const reviewEnd = Date.parse(`${claim.reviewDate}T23:59:59.999Z`);
    const expires =
      claim.expiresDate === null ? Number.POSITIVE_INFINITY : Date.parse(`${claim.expiresDate}T00:00:00.000Z`);
    return (
      claim.visibility === "public" &&
      claim.approval === "approved" &&
      effective <= timestamp &&
      timestamp <= reviewEnd &&
      timestamp < expires
    );
  });
}
