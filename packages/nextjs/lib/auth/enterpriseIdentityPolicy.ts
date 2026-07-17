import "server-only";
import { enqueueEnterpriseIdentityAudit } from "~~/lib/auth/enterpriseIdentityAudit";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AuthError } from "~~/lib/auth/session";
import { dbClient, dbPool } from "~~/lib/db";

type QueryRow = Record<string, unknown> | undefined;

function text(row: QueryRow, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

export function normalizeEnterpriseDomain(value: string) {
  const domain = value.trim().toLowerCase().replace(/\.$/u, "");
  if (
    domain.length < 3 ||
    domain.length > 253 ||
    !domain.includes(".") ||
    !domain.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  ) {
    throw new AuthError("Enter a valid bare email domain.", 400);
  }
  return domain;
}

export function emailDomain(email: string) {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0 || at === normalized.length - 1) return null;
  try {
    return normalizeEnterpriseDomain(normalized.slice(at + 1));
  } catch {
    return null;
  }
}

export async function enforcedSsoProviderForEmail(email: string) {
  const domain = emailDomain(email);
  if (!domain) return null;
  const result = await dbClient.execute({
    sql: `SELECT p.provider_id,p.workspace_id,p.domain
          FROM tokenless_enterprise_identity_providers p
          JOIN tokenless_better_auth_sso_providers s ON s.provider_id=p.provider_id
          WHERE p.domain=? AND p.status='active' AND p.enforce_sso=true AND s.domain_verified=true LIMIT 1`,
    args: [domain],
  });
  const row = result.rows[0] as QueryRow;
  const providerId = text(row, "provider_id");
  return providerId ? { providerId, workspaceId: text(row, "workspace_id")!, domain: text(row, "domain")! } : null;
}

export async function assertEnterpriseSignInAllowed(email: string, authenticationMethod: string | null | undefined) {
  const enforced = await enforcedSsoProviderForEmail(email);
  if (!enforced) return null;
  if (authenticationMethod !== `sso:${enforced.providerId}`) {
    throw new AuthError(`Sign in through your organization's SSO provider for ${enforced.domain}.`, 403);
  }
  return enforced;
}

export function authenticationMethodFromContext(context: { path?: string; params?: Record<string, unknown> } | null) {
  const path = context?.path ?? "";
  const ssoMatch = path.match(/^\/sso\/(?:callback|saml2\/sp\/acs)\/([^/]+)$/u);
  if (ssoMatch) {
    const providerId =
      typeof context?.params?.providerId === "string" ? context.params.providerId : decodeURIComponent(ssoMatch[1]!);
    return providerId ? `sso:${providerId}` : "sso:unknown";
  }
  if (path === "/sign-in/email-otp") return "email-otp";
  if (path.includes("/passkey/verify-authentication")) return "passkey";
  if (path.startsWith("/callback/")) return `social:${path.split("/").pop() ?? "unknown"}`;
  return "unknown";
}

export async function canGenerateScimToken(input: { providerId: string; userId: string }) {
  const result = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_identity_bindings b
          JOIN tokenless_workspace_members m ON m.account_address=b.principal_id
          WHERE b.provider='better_auth' AND b.provider_subject=? AND b.status='active'
            AND m.role IN ('owner','admin')
            AND ? = ('rlscim_' || substr(encode(digest(convert_to(m.workspace_id,'UTF8'),'sha256'),'hex'),1,24))
          LIMIT 1`,
    args: [input.userId, input.providerId],
  });
  return result.rowCount === 1;
}

export async function ssoProviderLimitForUser(userId: string) {
  const result = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_identity_bindings b
          JOIN tokenless_workspace_members m ON m.account_address=b.principal_id
          WHERE b.provider='better_auth' AND b.provider_subject=? AND b.status='active'
            AND m.role IN ('owner','admin') LIMIT 1`,
    args: [userId],
  });
  return result.rowCount === 1 ? 5 : 0;
}

export async function provisionEnterpriseSsoUser(input: {
  provider: { domain: string; providerId: string };
  user: { id: string; email: string; name: string };
}) {
  const domain = emailDomain(input.user.email);
  const mapping = await dbClient.execute({
    sql: `SELECT p.workspace_id,p.domain FROM tokenless_enterprise_identity_providers p
          JOIN tokenless_better_auth_sso_providers s ON s.provider_id=p.provider_id
          WHERE p.provider_id=? AND p.status='active' AND s.domain_verified=true LIMIT 1`,
    args: [input.provider.providerId],
  });
  const row = mapping.rows[0] as QueryRow;
  const workspaceId = text(row, "workspace_id");
  if (!workspaceId || domain !== text(row, "domain")) throw new AuthError("SSO provider mapping is invalid.", 403);
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: input.user.id,
    displayName: input.user.name,
    method: "sso",
  });
  const now = new Date();
  const client = await dbPool.connect();
  let provisioned = false;
  try {
    await client.query("BEGIN");
    const member = await client.query(
      "SELECT role FROM tokenless_workspace_members WHERE workspace_id=$1 AND account_address=$2 FOR UPDATE",
      [workspaceId, identity.principalId],
    );
    if (member.rowCount === 0) {
      await client.query(
        `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
         VALUES ($1,$2,'member',$3)`,
        [workspaceId, identity.principalId, now],
      );
      provisioned = true;
    }
    const managed = await client.query(
      `INSERT INTO tokenless_enterprise_managed_members
         (workspace_id,provider_id,better_auth_user_id,principal_id,source,status,created_at,last_synced_at,deactivated_at)
       VALUES ($1,$2,$3,$4,'sso','active',$5,$5,NULL)
       ON CONFLICT (workspace_id,principal_id) DO UPDATE SET
         last_synced_at=EXCLUDED.last_synced_at,
         status=CASE WHEN tokenless_enterprise_managed_members.source='sso' THEN 'active'
                     ELSE tokenless_enterprise_managed_members.status END,
         deactivated_at=CASE WHEN tokenless_enterprise_managed_members.source='sso' THEN NULL
                             ELSE tokenless_enterprise_managed_members.deactivated_at END
       RETURNING created_at`,
      [workspaceId, input.provider.providerId, input.user.id, identity.principalId, now],
    );
    await client.query(
      "UPDATE tokenless_enterprise_identity_providers SET last_sso_at=$1,updated_at=$1 WHERE provider_id=$2",
      [now, input.provider.providerId],
    );
    if (provisioned) {
      await enqueueEnterpriseIdentityAudit(
        {
          action: "identity.sso.member_provisioned",
          actorKind: "system",
          actorReference: "system:better_auth_sso",
          assuranceMethod: "verified_sso_assertion",
          eventKey: `sso-provision:${input.provider.providerId}:${input.user.id}`,
          occurredAt: new Date(String(managed.rows[0]?.created_at ?? now)),
          purpose: "workspace_access",
          reason: "verified_enterprise_sso_login",
          result: "success",
          targetId: identity.principalId,
          targetKind: "workspace_member",
          workspaceId,
        },
        client,
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type ScimUserProjection = Readonly<{
  betterAuthUserId: string;
  displayName: string | null;
  principalId: string;
  providerId: string;
  workspaceId: string;
}>;

export async function captureScimUserProjection(betterAuthUserId: string, providerId?: string | null) {
  const result = await dbClient.execute({
    sql: `SELECT e.better_auth_user_id,e.principal_id,e.provider_id,e.workspace_id,u.name
          FROM tokenless_enterprise_managed_members e
          LEFT JOIN tokenless_better_auth_users u ON u.id=e.better_auth_user_id
          WHERE e.better_auth_user_id=? AND e.source='scim' AND e.status='active'
            AND (? IS NULL OR e.provider_id=?)
          ORDER BY e.created_at ASC LIMIT 1`,
    args: [betterAuthUserId, providerId ?? null, providerId ?? null],
  });
  const row = result.rows[0] as QueryRow;
  const capturedProviderId = text(row, "provider_id");
  const workspaceId = text(row, "workspace_id");
  const principalId = text(row, "principal_id");
  return capturedProviderId && workspaceId && principalId
    ? {
        betterAuthUserId,
        displayName: text(row, "name"),
        principalId,
        providerId: capturedProviderId,
        workspaceId,
      }
    : null;
}

export async function synchronizeScimUser(input: {
  active: boolean;
  betterAuthUserId: string;
  providerId?: string;
  projection?: ScimUserProjection | null;
}) {
  if (!input.active && !input.projection) {
    throw new AuthError("SCIM deprovision projection is unavailable.", 409);
  }
  if (!input.active && input.projection) {
    const now = new Date();
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE tokenless_enterprise_managed_members SET status='deactivated',deactivated_at=$1,last_synced_at=$1
         WHERE workspace_id=$2 AND provider_id=$3 AND better_auth_user_id=$4 AND principal_id=$5
           AND source='scim' AND status='active'`,
        [
          now,
          input.projection.workspaceId,
          input.projection.providerId,
          input.projection.betterAuthUserId,
          input.projection.principalId,
        ],
      );
      await client.query(
        "DELETE FROM tokenless_workspace_member_clients WHERE workspace_id=$1 AND account_address=$2",
        [input.projection.workspaceId, input.projection.principalId],
      );
      await client.query(
        "DELETE FROM tokenless_workspace_member_governance WHERE workspace_id=$1 AND account_address=$2",
        [input.projection.workspaceId, input.projection.principalId],
      );
      await client.query("DELETE FROM tokenless_workspace_members WHERE workspace_id=$1 AND account_address=$2", [
        input.projection.workspaceId,
        input.projection.principalId,
      ]);
      await client.query(
        "UPDATE tokenless_auth_sessions SET revoked_at=$1 WHERE principal_id=$2 AND revoked_at IS NULL",
        [now, input.projection.principalId],
      );
      const revokedFamilies = await client.query(
        `UPDATE tokenless_agent_oauth_token_families
         SET status='revoked',revoked_at=$1,revoked_by='system:better_auth_scim',
             revocation_reason='enterprise_scim_deprovision'
         WHERE subject_principal_id=$2 AND status='active'
         RETURNING token_family_id`,
        [now, input.projection.principalId],
      );
      await client.query(
        `UPDATE tokenless_agent_oauth_authorization_codes
         SET revoked_at=COALESCE(revoked_at,$1)
         WHERE subject_principal_id=$2 AND revoked_at IS NULL`,
        [now, input.projection.principalId],
      );
      await client.query(
        `UPDATE tokenless_agent_oauth_refresh_tokens
         SET revoked_at=COALESCE(revoked_at,$1),
             revocation_reason=COALESCE(revocation_reason,'enterprise_scim_deprovision')
         WHERE subject_principal_id=$2`,
        [now, input.projection.principalId],
      );
      await client.query(
        `UPDATE tokenless_agent_oauth_access_tokens
         SET revoked_at=COALESCE(revoked_at,$1),
             revocation_reason=COALESCE(revocation_reason,'enterprise_scim_deprovision')
         WHERE subject_principal_id=$2`,
        [now, input.projection.principalId],
      );
      await client.query(
        `UPDATE tokenless_mcp_sessions
         SET status='revoked',last_seen_at=$1
         WHERE subject_principal_id=$2 AND status='active'`,
        [now, input.projection.principalId],
      );
      await client.query(
        `UPDATE tokenless_enterprise_scim_connections
         SET last_sync_at=$1,last_sync_result='success',updated_at=$1 WHERE provider_id=$2`,
        [now, input.projection.providerId],
      );
      await enqueueEnterpriseIdentityAudit(
        {
          action: "identity.scim.member_deactivated",
          actorKind: "system",
          actorReference: "system:better_auth_scim",
          assuranceMethod: "scim_bearer_token",
          eventKey: `scim-deactivate:${input.projection.providerId}:${input.projection.betterAuthUserId}:${now.toISOString()}`,
          occurredAt: now,
          purpose: "workspace_access",
          reason: "scim_user_inactive",
          result: "success",
          targetId: input.projection.principalId,
          targetKind: "workspace_member",
          workspaceId: input.projection.workspaceId,
          metadata: { revokedAgentOauthFamilyCount: revokedFamilies.rowCount ?? 0 },
        },
        client,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      await dbClient.execute({
        sql: `UPDATE tokenless_enterprise_scim_connections
              SET last_sync_at=?,last_sync_result='failure',updated_at=? WHERE provider_id=?`,
        args: [now, now, input.projection.providerId],
      });
      throw error;
    } finally {
      client.release();
    }
    return true;
  }
  const provider = input.providerId
    ? await dbClient.execute({
        sql: `SELECT c.provider_id,c.workspace_id,u.email,u.name
              FROM tokenless_enterprise_scim_connections c
              LEFT JOIN tokenless_better_auth_users u ON u.id=?
              WHERE c.provider_id=? AND c.status='active' LIMIT 1`,
        args: [input.betterAuthUserId, input.providerId],
      })
    : await dbClient.execute({
        sql: `SELECT c.provider_id,c.workspace_id,u.email,u.name
              FROM tokenless_enterprise_scim_connections c
              JOIN tokenless_better_auth_accounts a ON a.provider_id=c.provider_id
              JOIN tokenless_better_auth_users u ON u.id=a.user_id
              WHERE a.user_id=? AND c.status='active' ORDER BY c.created_at ASC LIMIT 1`,
        args: [input.betterAuthUserId],
      });
  const row = provider.rows[0] as QueryRow;
  const providerId = text(row, "provider_id");
  const workspaceId = text(row, "workspace_id");
  if (!providerId || !workspaceId) return false;
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: input.betterAuthUserId,
    displayName: text(row, "name"),
    method: "scim",
  });
  const now = new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    if (input.active) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `enterprise-scim-principal:${identity.principalId}`,
      ]);
      const outside = await client.query(
        `SELECT workspace_id FROM tokenless_workspace_members
         WHERE account_address=$1 AND workspace_id<>$2 FOR UPDATE`,
        [identity.principalId, workspaceId],
      );
      if ((outside.rowCount ?? 0) > 0) {
        throw new AuthError(
          "SCIM provisioning is blocked because this identity has access outside the provider workspace.",
          409,
        );
      }
      await client.query(
        `INSERT INTO tokenless_enterprise_managed_members
           (workspace_id,provider_id,better_auth_user_id,principal_id,source,status,created_at,last_synced_at,deactivated_at)
         VALUES ($1,$2,$3,$4,'scim','active',$5,$5,NULL)
         ON CONFLICT (workspace_id,principal_id) DO UPDATE SET
           provider_id=EXCLUDED.provider_id,better_auth_user_id=EXCLUDED.better_auth_user_id,
           source='scim',status='active',last_synced_at=EXCLUDED.last_synced_at,deactivated_at=NULL`,
        [workspaceId, providerId, input.betterAuthUserId, identity.principalId, now],
      );
      await client.query(
        `INSERT INTO tokenless_workspace_members (workspace_id,account_address,role,created_at)
         VALUES ($1,$2,'member',$3) ON CONFLICT (workspace_id,account_address) DO NOTHING`,
        [workspaceId, identity.principalId, now],
      );
    }
    await client.query(
      `UPDATE tokenless_enterprise_scim_connections
       SET last_sync_at=$1,last_sync_result='success',updated_at=$1 WHERE provider_id=$2`,
      [now, providerId],
    );
    await enqueueEnterpriseIdentityAudit(
      {
        action: "identity.scim.member_provisioned",
        actorKind: "system",
        actorReference: "system:better_auth_scim",
        assuranceMethod: "scim_bearer_token",
        eventKey: `scim-activate:${providerId}:${input.betterAuthUserId}:${now.toISOString()}`,
        occurredAt: now,
        purpose: "workspace_access",
        reason: "scim_user_active",
        result: "success",
        targetId: identity.principalId,
        targetKind: "workspace_member",
        workspaceId,
      },
      client,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    await dbClient.execute({
      sql: `UPDATE tokenless_enterprise_scim_connections
            SET last_sync_at=?,last_sync_result='failure',updated_at=? WHERE provider_id=?`,
      args: [now, now, providerId],
    });
    throw error;
  } finally {
    client.release();
  }
  return true;
}

export async function scimProviderIdForUser(betterAuthUserId: string) {
  const result = await dbClient.execute({
    sql: `SELECT c.provider_id FROM tokenless_enterprise_scim_connections c
          JOIN tokenless_better_auth_accounts a ON a.provider_id=c.provider_id
          WHERE a.user_id=? AND c.status='active' ORDER BY c.created_at ASC LIMIT 1`,
    args: [betterAuthUserId],
  });
  return text(result.rows[0] as QueryRow, "provider_id");
}

export async function assertScimDeprovisionScope(
  betterAuthUserId: string,
  providerId?: string | null,
): Promise<ScimUserProjection> {
  const projection = await captureScimUserProjection(betterAuthUserId, providerId);
  if (!projection) throw new AuthError("SCIM managed member was not found.", 404);
  const result = await dbClient.execute({
    sql: `SELECT COUNT(*)::integer AS outside_count FROM (
            SELECT DISTINCT workspace_id FROM tokenless_workspace_members
            WHERE account_address=? AND workspace_id<>?
          ) outside_memberships`,
    args: [projection.principalId, projection.workspaceId],
  });
  const row = result.rows[0] as QueryRow;
  if (Number(row?.outside_count ?? 0) > 0) {
    throw new AuthError(
      "SCIM deprovisioning is blocked because this managed identity has access outside the provider workspace.",
      409,
    );
  }
  return projection;
}
