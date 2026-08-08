import { createHash } from "node:crypto";

/**
 * Logs an unexpected failure without letting the error payload reach the log.
 *
 * Driver errors carry caller data: a `pg` unique violation puts the conflicting
 * value in `detail`, and mail transport errors carry the recipient address. Only
 * the error constructor name and a stable digest of `name:message` are emitted,
 * which is enough to correlate repeated failures without retaining personal data.
 *
 * This module deliberately has no dependency beyond `node:crypto` so that every
 * error path, including ones reached from modules that must not pull in the auth
 * or database graph, can use it.
 */
export function logRedactedError(event: string, error: unknown, context: OperatorContext = {}) {
  const errorCode =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(error.name) ? error.name : "unknown_error";
  const errorDigest = `sha256:${createHash("sha256")
    .update(error instanceof Error ? `${error.name}:${error.message}` : typeof error)
    .digest("hex")}`;
  console.error(JSON.stringify({ event, errorCode, errorDigest, ...context }));
}

/**
 * Identifiers an operator needs to act on a failure — a Stripe event id, a
 * delivery id — and nothing that identifies a person. Values are the caller's
 * responsibility; the type exists to make "is this safe to log?" a question the
 * call site has to answer rather than one it can drift past.
 */
export type OperatorContext = Record<string, number | string | null | undefined>;

/**
 * Records a failure that needs a human, with no error payload to redact.
 *
 * Every operator-actionable failure carries the same `event` field so one alert
 * rule can match all of them. Before this, the eleven such sites logged bare
 * strings with three different prefix conventions, so alerting on them meant a
 * regex per message that broke the moment somebody edited the wording — which is
 * why "monitored operational failures" was unevidenced rather than merely
 * unmonitored.
 */
export function logOperatorAttention(event: string, context: OperatorContext = {}) {
  console.error(JSON.stringify({ event, operatorAttention: true, ...context }));
}
