import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export function enterpriseIdentityEnabled(env: Record<string, string | undefined> = process.env) {
  const raw = env.TOKENLESS_ENTERPRISE_IDENTITY_ENABLED?.trim().toLowerCase();
  if (!raw || raw === "false") return false;
  if (raw === "true") return true;
  throw new TokenlessServiceError(
    "TOKENLESS_ENTERPRISE_IDENTITY_ENABLED must be exactly true or false.",
    500,
    "invalid_identity_configuration",
  );
}
