import {
  REVIEWER_EXPERTISE,
  REVIEWER_EXPERTISE_KEYS,
  type ReviewerExpertiseKey,
} from "~~/lib/tokenless/reviewerExpertiseOptions";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export { REVIEWER_EXPERTISE, REVIEWER_EXPERTISE_KEYS, type ReviewerExpertiseKey };
const EXPERTISE_KEY_SET = new Set<string>(REVIEWER_EXPERTISE_KEYS);

export function normalizeReviewerExpertiseKeys(value: unknown): ReviewerExpertiseKey[] {
  if (!Array.isArray(value) || value.length > REVIEWER_EXPERTISE_KEYS.length) {
    throw new TokenlessServiceError("Expertise requirements are invalid.", 400, "invalid_reviewer_expertise");
  }
  const keys = value.map(entry => {
    if (typeof entry !== "string" || !EXPERTISE_KEY_SET.has(entry)) {
      throw new TokenlessServiceError("Expertise requirement is unsupported.", 400, "invalid_reviewer_expertise");
    }
    return entry as ReviewerExpertiseKey;
  });
  const unique = [...new Set(keys)].sort() as ReviewerExpertiseKey[];
  if (unique.length !== keys.length) {
    throw new TokenlessServiceError("Expertise requirements must be unique.", 400, "invalid_reviewer_expertise");
  }
  return unique;
}

export function expertiseQualificationKey(key: ReviewerExpertiseKey) {
  return `expertise:${key}`;
}

export function expertiseQualificationRules(keys: readonly ReviewerExpertiseKey[]) {
  return keys.map(key => ({ key: expertiseQualificationKey(key), operator: "attested" as const, value: true }));
}
