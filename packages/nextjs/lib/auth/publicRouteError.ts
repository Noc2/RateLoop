import { AuthError } from "~~/lib/auth/session";
import { logRedactedError } from "~~/lib/security/redactedErrorLog";

export function publicAuthRouteError(
  error: unknown,
  input: { event: string; fallbackMessage: string; fallbackStatus: number },
) {
  if (error instanceof AuthError) {
    return { message: error.message, status: error.status };
  }
  logRedactedError(input.event, error);
  return { message: input.fallbackMessage, status: input.fallbackStatus };
}
