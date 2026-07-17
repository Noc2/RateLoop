export const REVIEWER_EXPERTISE = [
  { key: "code-review:typescript", label: "TypeScript code review" },
  { key: "code-review:security", label: "Application security review" },
  { key: "finance:broker-dealer-supervision", label: "Broker-dealer supervision" },
  { key: "finance:investment-advisory", label: "Investment advisory" },
  { key: "legal:privacy-compliance", label: "Privacy compliance" },
  { key: "operations:customer-support", label: "Customer support operations" },
] as const;

export type ReviewerExpertiseKey = (typeof REVIEWER_EXPERTISE)[number]["key"];
export const REVIEWER_EXPERTISE_KEYS = REVIEWER_EXPERTISE.map(value => value.key) as ReviewerExpertiseKey[];
const EXPERTISE_KEY_SET = new Set<string>(REVIEWER_EXPERTISE_KEYS);

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
