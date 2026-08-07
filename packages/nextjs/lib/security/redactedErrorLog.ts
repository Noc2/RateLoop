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
export function logRedactedError(event: string, error: unknown) {
  const errorCode =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(error.name) ? error.name : "unknown_error";
  const errorDigest = `sha256:${createHash("sha256")
    .update(error instanceof Error ? `${error.name}:${error.message}` : typeof error)
    .digest("hex")}`;
  console.error(JSON.stringify({ event, errorCode, errorDigest }));
}
