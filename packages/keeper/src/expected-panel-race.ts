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
export function isExpectedPanelRaceError(error: unknown) {
  const pending: unknown[] = [error];
  const seen = new Set<object>();

  while (pending.length > 0) {
    const candidate = pending.pop();
    const rawSelector = selector(candidate);
    if (rawSelector && EXPECTED_RACE_ERROR_SELECTORS.has(rawSelector)) {
      return true;
    }
    if (!candidate || typeof candidate !== "object") continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    const record = candidate as Record<string, unknown>;
    if (
      typeof record.errorName === "string" &&
      EXPECTED_RACE_ERROR_NAMES.has(record.errorName)
    ) {
      return true;
    }
    pending.push(record.cause, record.data, record.raw, record.signature);
  }

  return false;
}
