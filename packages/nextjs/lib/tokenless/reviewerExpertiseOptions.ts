export const REVIEWER_EXPERTISE = [
  {
    definitionId: "expd_code_review_typescript",
    key: "code-review:typescript",
    label: "TypeScript code review",
    description: "Can assess TypeScript behavior, correctness, maintainability, and common runtime risks.",
    suggestionTerms: ["typescript", "javascript", "node", "react", "next.js", "code", "pull request"],
  },
  {
    definitionId: "expd_code_review_security",
    key: "code-review:security",
    label: "Application security review",
    description: "Can identify application-level security weaknesses and unsafe implementation choices.",
    suggestionTerms: ["security", "authentication", "authorization", "api", "secret", "vulnerability"],
  },
  {
    definitionId: "expd_finance_broker_dealer",
    key: "finance:broker-dealer-supervision",
    label: "Broker-dealer supervision",
    description: "Can assess work that requires broker-dealer supervisory knowledge.",
    suggestionTerms: ["broker", "dealer", "trade", "trading", "securities", "finra"],
  },
  {
    definitionId: "expd_finance_investment_advisory",
    key: "finance:investment-advisory",
    label: "Investment advisory",
    description: "Can assess investment-advisory content, recommendations, and related controls.",
    suggestionTerms: ["investment", "portfolio", "financial advice", "adviser", "advisor"],
  },
  {
    definitionId: "expd_legal_privacy_compliance",
    key: "legal:privacy-compliance",
    label: "Privacy compliance",
    description: "Can assess privacy obligations, data handling, retention, and disclosure risks.",
    suggestionTerms: ["privacy", "personal data", "gdpr", "retention", "consent", "data protection"],
  },
  {
    definitionId: "expd_operations_customer_support",
    key: "operations:customer-support",
    label: "Customer support operations",
    description: "Can assess customer-support quality, escalation handling, and operational fit.",
    suggestionTerms: ["support", "customer", "ticket", "escalation", "service desk"],
  },
] as const;

export type ReviewerExpertiseKey = (typeof REVIEWER_EXPERTISE)[number]["key"];
export const REVIEWER_EXPERTISE_KEYS = REVIEWER_EXPERTISE.map(value => value.key) as ReviewerExpertiseKey[];
const EXPERTISE_KEY_SET = new Set<string>(REVIEWER_EXPERTISE_KEYS);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DEFINITION_ID_PATTERN = /^expd_[a-z0-9_]{3,120}$/u;
const REQUIREMENT_SOURCES = new Set<ReviewerExpertiseRequirementSource>([
  "any",
  "customer_invited",
  "rateloop_network",
]);

export type ReviewerExpertiseDefinitionScope = "global" | "workspace";
export type ReviewerExpertiseRequirementSource = "any" | "customer_invited" | "rateloop_network";
export type ReviewerExpertiseDefinition = {
  definitionId: string;
  version: number;
  hash: `sha256:${string}`;
  scope: ReviewerExpertiseDefinitionScope;
  workspaceId: string | null;
  key: string;
  label: string;
  description: string;
  networkEligible: boolean;
};
export type ReviewerExpertiseRequirement = {
  definitionId: string;
  definitionVersion: number;
  definitionHash: `sha256:${string}`;
  minimumSeats: number;
  sourceScope: ReviewerExpertiseRequirementSource;
};

export function normalizeReviewerExpertiseRequirementsSelection(
  value: unknown,
  panelSize: number,
): ReviewerExpertiseRequirement[] {
  if (!Number.isSafeInteger(panelSize) || panelSize < 1 || panelSize > 100) {
    throw new Error("Reviewer count is invalid.");
  }
  if (!Array.isArray(value) || value.length > 8) throw new Error("Specialist requirements are invalid.");
  const requirements = value.map(entry => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Specialist requirement is invalid.");
    }
    const candidate = entry as Record<string, unknown>;
    const definitionId = candidate.definitionId;
    const definitionVersion = candidate.definitionVersion;
    const definitionHash = candidate.definitionHash;
    const minimumSeats = candidate.minimumSeats;
    const sourceScope = candidate.sourceScope;
    if (
      typeof definitionId !== "string" ||
      !DEFINITION_ID_PATTERN.test(definitionId) ||
      !Number.isSafeInteger(definitionVersion) ||
      (definitionVersion as number) < 1 ||
      (definitionVersion as number) > 2_147_483_647 ||
      typeof definitionHash !== "string" ||
      !HASH_PATTERN.test(definitionHash) ||
      !Number.isSafeInteger(minimumSeats) ||
      (minimumSeats as number) < 1 ||
      (minimumSeats as number) > panelSize ||
      typeof sourceScope !== "string" ||
      !REQUIREMENT_SOURCES.has(sourceScope as ReviewerExpertiseRequirementSource)
    ) {
      throw new Error("Specialist requirement is invalid.");
    }
    return {
      definitionId,
      definitionVersion: definitionVersion as number,
      definitionHash: definitionHash as `sha256:${string}`,
      minimumSeats: minimumSeats as number,
      sourceScope: sourceScope as ReviewerExpertiseRequirementSource,
    };
  });
  requirements.sort((left, right) => {
    const byId = left.definitionId.localeCompare(right.definitionId);
    return (
      byId ||
      left.definitionVersion - right.definitionVersion ||
      left.definitionHash.localeCompare(right.definitionHash)
    );
  });
  for (let index = 1; index < requirements.length; index += 1) {
    const previous = requirements[index - 1]!;
    const current = requirements[index]!;
    if (previous.definitionId === current.definitionId) {
      throw new Error("Each specialist area can be required only once.");
    }
  }
  return requirements;
}

export function suggestReviewerExpertiseKeys(value: string): ReviewerExpertiseKey[] {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (!normalized) return [];
  return REVIEWER_EXPERTISE.filter(option =>
    option.suggestionTerms.some(term => normalized.includes(term.toLocaleLowerCase("en-US"))),
  ).map(option => option.key);
}

export function normalizeReviewerExpertiseSelection(value: unknown): ReviewerExpertiseKey[] {
  if (!Array.isArray(value) || value.length > REVIEWER_EXPERTISE_KEYS.length) {
    throw new Error("Expertise requirements are invalid.");
  }
  const keys = value.map(entry => {
    if (typeof entry !== "string" || !EXPERTISE_KEY_SET.has(entry)) {
      throw new Error("Expertise requirement is unsupported.");
    }
    return entry as ReviewerExpertiseKey;
  });
  const unique = [...new Set(keys)].sort() as ReviewerExpertiseKey[];
  if (unique.length !== keys.length) throw new Error("Expertise requirements must be unique.");
  return unique;
}
