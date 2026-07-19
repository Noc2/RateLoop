import { randomBytes } from "node:crypto";
import "server-only";
import { AuthError, type AuthProvider, type BrowserIdentity } from "~~/lib/auth/session";
import { dbClient, dbPool } from "~~/lib/db";

const BETTER_AUTH_PROVIDER = "better_auth";

function newPrincipalId() {
  // Lowercase is intentional while pre-production text-keyed consumers normalize subjects with toLowerCase().
  return `rlp_${randomBytes(24).toString("hex")}`;
}

function newBindingId() {
  return `idb_${randomBytes(18).toString("base64url")}`;
}

function authProvider(method: string | undefined): AuthProvider {
  if (method === "apple" || method === "google" || method === "passkey") return `better_auth:${method}`;
  if (method === "email-otp") return "better_auth:email-otp";
  if (method === "sso" || method?.startsWith("sso:")) return "better_auth:sso";
  return "better_auth";
}

export async function resolveBetterAuthPrincipal(input: {
  betterAuthUserId: string;
  displayName?: string | null;
  method?: string;
  now?: Date;
}): Promise<BrowserIdentity> {
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT b.principal_id FROM tokenless_identity_bindings b
       JOIN tokenless_principals p ON p.principal_id = b.principal_id
       WHERE b.provider = $1 AND b.provider_subject = $2
         AND b.status = 'active' AND p.status = 'active' LIMIT 1`,
      [BETTER_AUTH_PROVIDER, input.betterAuthUserId],
    );
    const existingId = existing.rows[0]?.principal_id;
    if (existingId) {
      await client.query(
        `UPDATE tokenless_identity_bindings SET last_used_at = $1
         WHERE provider = $2 AND provider_subject = $3 AND status = 'active'`,
        [now, BETTER_AUTH_PROVIDER, input.betterAuthUserId],
      );
      await client.query("COMMIT");
      return {
        principalId: String(existingId),
        authProvider: authProvider(input.method),
        displayName: input.displayName?.trim() || null,
      };
    }

    const principalId = newPrincipalId();
    await client.query(
      `INSERT INTO tokenless_principals (principal_id, status, created_at, updated_at)
       VALUES ($1, 'active', $2, $2)`,
      [principalId, now],
    );
    // Compatibility for pre-production tables whose FK still names the legacy identity relation.
    // The text value is the opaque principal ID, never a generated EVM address.
    await client.query(
      `INSERT INTO tokenless_browser_identities
       (principal_address, auth_provider, email_verified, created_at, updated_at, last_login_at)
       VALUES ($1, 'better_auth', false, $2, $2, $2)`,
      [principalId, now],
    );
    await client.query(
      `INSERT INTO tokenless_identity_bindings
       (binding_id, principal_id, provider, provider_subject, status, created_at, last_used_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $5)
       ON CONFLICT (provider, provider_subject) DO NOTHING`,
      [newBindingId(), principalId, BETTER_AUTH_PROVIDER, input.betterAuthUserId, now],
    );
    const resolved = await client.query(
      `SELECT principal_id FROM tokenless_identity_bindings
       WHERE provider = $1 AND provider_subject = $2 AND status = 'active' LIMIT 1`,
      [BETTER_AUTH_PROVIDER, input.betterAuthUserId],
    );
    const resolvedId = resolved.rows[0]?.principal_id;
    if (!resolvedId) throw new Error("Unable to create the RateLoop principal binding.");
    if (String(resolvedId) !== principalId) {
      await client.query(`DELETE FROM tokenless_browser_identities WHERE principal_address = $1`, [principalId]);
      await client.query(`DELETE FROM tokenless_principals WHERE principal_id = $1`, [principalId]);
    }
    await client.query("COMMIT");
    return {
      principalId: String(resolvedId),
      authProvider: authProvider(input.method),
      displayName: input.displayName?.trim() || null,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function welcomeCompletedAt(row: Record<string, unknown> | undefined) {
  const value = row?.welcome_completed_at;
  if (value === null || value === undefined) return null;
  const completedAt = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(completedAt.getTime())) throw new Error("Principal welcome state is invalid.");
  return completedAt;
}

export async function getPrincipalWelcomeState(principalId: string) {
  const result = await dbClient.execute({
    sql: `SELECT welcome_completed_at
          FROM tokenless_principals
          WHERE principal_id = ? AND status = 'active'
          LIMIT 1`,
    args: [principalId],
  });
  if (result.rowCount !== 1) throw new AuthError("The RateLoop principal is not active.", 403);
  const completedAt = welcomeCompletedAt(result.rows[0] as Record<string, unknown> | undefined);
  return { completedAt, required: completedAt === null };
}

export async function completePrincipalWelcome(principalId: string, now = new Date()) {
  const result = await dbClient.execute({
    sql: `UPDATE tokenless_principals
          SET welcome_completed_at = COALESCE(welcome_completed_at, ?),
              updated_at = CASE WHEN welcome_completed_at IS NULL THEN ? ELSE updated_at END
          WHERE principal_id = ? AND status = 'active'
          RETURNING welcome_completed_at`,
    args: [now, now, principalId],
  });
  if (result.rowCount !== 1) throw new AuthError("The RateLoop principal is not active.", 403);
  const completedAt = welcomeCompletedAt(result.rows[0] as Record<string, unknown> | undefined);
  if (!completedAt) throw new Error("Principal welcome completion was not recorded.");
  return { completedAt, required: false as const };
}
