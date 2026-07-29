import { createHash } from "node:crypto";
import { AuthError } from "~~/lib/auth/session";

export function publicAuthRouteError(
  error: unknown,
  input: { event: string; fallbackMessage: string; fallbackStatus: number },
) {
  if (error instanceof AuthError) {
    return { message: error.message, status: error.status };
  }
  const errorCode =
    error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/u.test(error.name) ? error.name : "unknown_error";
  const errorDigest = `sha256:${createHash("sha256")
    .update(error instanceof Error ? `${error.name}:${error.message}` : typeof error)
    .digest("hex")}`;
  console.error(JSON.stringify({ event: input.event, errorCode, errorDigest }));
  return { message: input.fallbackMessage, status: input.fallbackStatus };
}
