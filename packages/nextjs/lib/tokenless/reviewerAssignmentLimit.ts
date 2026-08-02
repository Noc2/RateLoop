import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const DEFAULT_REVIEWER_ASSIGNMENT_LIMIT = 50;
export const MAX_REVIEWER_ASSIGNMENT_LIMIT = 50;

export function parseReviewerAssignmentLimit(value: string | number | null | undefined) {
  if (value === null || value === undefined) return DEFAULT_REVIEWER_ASSIGNMENT_LIMIT;
  const normalized = typeof value === "number" ? value : value.trim();
  const parsed = typeof normalized === "number" || /^[+-]?\d+$/u.test(normalized) ? Number(normalized) : Number.NaN;
  if (!Number.isSafeInteger(parsed)) {
    throw new TokenlessServiceError("Assignment limit must be a whole number.", 400, "invalid_assignment_limit");
  }
  return Math.min(Math.max(parsed, 1), MAX_REVIEWER_ASSIGNMENT_LIMIT);
}
