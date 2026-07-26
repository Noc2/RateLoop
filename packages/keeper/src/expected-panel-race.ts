import { toFunctionSelector } from "viem";

const EXPECTED_RACE_ERROR_NAMES = new Set([
  "AlreadyClaimed",
  "ClaimWindowOpen",
  "CursorMismatch",
  "InvalidDeadline",
  "InvalidState",
  "NotClaimable",
]);

const EXPECTED_RACE_ERROR_SELECTORS = new Set<string>(
  [
    "AlreadyClaimed()",
    "ClaimWindowOpen()",
    "CursorMismatch()",
    "InvalidDeadline()",
    "InvalidState()",
    "NotClaimable()",
  ].map((signature) => toFunctionSelector(signature)),
);

const EXPECTED_FEEDBACK_BONUS_RACE_ERROR_NAMES = new Set([
  "AwardWindowClosed",
  "InvalidPool",
  "NothingToRefund",
]);

const EXPECTED_FEEDBACK_BONUS_RACE_ERROR_SELECTORS = new Set<string>(
  ["AwardWindowClosed()", "InvalidPool()", "NothingToRefund()"].map(
    (signature) => toFunctionSelector(signature),
  ),
);

function selector(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^0x[0-9a-f]{8}/iu.exec(value);
  return match?.[0].toLowerCase() ?? null;
}

/**
 * Classifies only decoded panel errors or their exact raw selectors. Viem nests
 * reverts under `cause` and may expose RPC data as either a hex string or a
 * `{ data }` object, so walk those structured fields without trusting display
 * text that providers are free to rewrite.
 */
function isExpectedStructuredRaceError(
  error: unknown,
  names: ReadonlySet<string>,
  selectors: ReadonlySet<string>,
) {
  const pending: unknown[] = [error];
  const seen = new Set<object>();

  while (pending.length > 0) {
    const candidate = pending.pop();
    const rawSelector = selector(candidate);
    if (rawSelector && selectors.has(rawSelector)) {
      return true;
    }
    if (!candidate || typeof candidate !== "object") continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const record = candidate as Record<string, unknown>;
    if (
      typeof record.errorName === "string" &&
      names.has(record.errorName)
    ) {
      return true;
    }
    pending.push(record.cause, record.data, record.raw, record.signature);
  }

  return false;
}

export function isExpectedPanelRaceError(error: unknown) {
  return isExpectedStructuredRaceError(
    error,
    EXPECTED_RACE_ERROR_NAMES,
    EXPECTED_RACE_ERROR_SELECTORS,
  );
}

export function isExpectedFeedbackBonusRaceError(error: unknown) {
  return isExpectedStructuredRaceError(
    error,
    EXPECTED_FEEDBACK_BONUS_RACE_ERROR_NAMES,
    EXPECTED_FEEDBACK_BONUS_RACE_ERROR_SELECTORS,
  );
}
