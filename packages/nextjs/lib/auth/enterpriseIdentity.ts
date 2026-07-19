import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { getBetterAuth, getConfiguredSsoIssuerOrigins } from "~~/lib/auth/betterAuth";
import {
  activateEnterpriseIdentityAudit,
  drainEnterpriseIdentityAuditOutbox,
  enqueueEnterpriseIdentityAudit,
  enterpriseIdentityAuditReservation,
  enterpriseIdentityAuditState,
  recordEnterpriseIdentityReservationFailure,
  reserveEnterpriseIdentityAudit,
} from "~~/lib/auth/enterpriseIdentityAudit";
import { enterpriseIdentityEnabled } from "~~/lib/auth/enterpriseIdentityConfig";
import { normalizeEnterpriseDomain } from "~~/lib/auth/enterpriseIdentityPolicy";
import { getAuthOrigin } from "~~/lib/auth/session";
import { dbClient, dbPool } from "~~/lib/db";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type QueryRow = Record<string, unknown> | undefined;
type EnterpriseIdentityAuth = ReturnType<typeof getBetterAuth>;

let enterpriseIdentityAuthForTests: EnterpriseIdentityAuth | null = null;

function identityAuth() {
  return enterpriseIdentityAuthForTests ?? getBetterAuth();
}

function text(row: QueryRow, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function bool(row: QueryRow, key: string) {
  const value = row?.[key];
  return value === true || value === 1 || value === "true" || value === "1";
}

function iso(row: QueryRow, key: string) {
  const value = text(row, key);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function requiredString(value: unknown, field: string, maxLength = 2_000) {
  if (typeof value !== "string") {
    throw new TokenlessServiceError(`${field} is required.`, 400, "invalid_identity_provider");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new TokenlessServiceError(`${field} is invalid.`, 400, "invalid_identity_provider");
  }
  return normalized;
}

function httpsUrl(value: unknown, field: string) {
  const raw = requiredString(value, field, 2_048);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("not https");
    return url.toString().replace(/\/$/u, "");
  } catch {
    throw new TokenlessServiceError(`${field} must be an HTTPS URL.`, 400, "invalid_identity_provider");
  }
}

function trustedIdentityUrl(value: unknown, field: string) {
  const normalized = httpsUrl(value, field);
  let trusted: string[];
  try {
    trusted = getConfiguredSsoIssuerOrigins();
  } catch {
    throw new TokenlessServiceError(
      "Enterprise identity issuer configuration is invalid.",
      503,
      "invalid_identity_configuration",
    );
  }
  if (!trusted.includes(new URL(normalized).origin)) {
    throw new TokenlessServiceError(
      `${field} must use a configured trusted identity-provider origin.`,
      400,
      "untrusted_identity_provider",
    );
  }
  return normalized;
}

function deterministicProviderId(prefix: "rlsso" | "rlscim", workspaceId: string, domain?: string) {
  return `${prefix}_${createHash("sha256")
    .update(`${workspaceId}\n${domain ?? prefix}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function canonicalJson(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function identityOperationEventKey(input: {
  action: string;
  body?: Record<string, unknown>;
  providerId: string;
  providerVersion?: string | null;
  workspaceId: string;
}) {
  const digest = createHash("sha256")
    .update(
      canonicalJson({
        body: input.body ? canonicalJson(input.body) : null,
        providerVersion: input.providerVersion ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return `identity-admin:${input.action}:${input.workspaceId}:${input.providerId}:${digest}`;
}

async function identityTransaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function requireEnterpriseIdentityEnabled() {
  if (!enterpriseIdentityEnabled()) {
    throw new TokenlessServiceError("Enterprise identity is not enabled yet.", 503, "enterprise_identity_unavailable");
  }
}

export { enterpriseIdentityEnabled } from "~~/lib/auth/enterpriseIdentityConfig";

async function requireIdentityAdmin(input: { accountAddress: string; headers: Headers; workspaceId: string }) {
  requireEnterpriseIdentityEnabled();
  const principalId = normalizeAccountSubject(input.accountAddress);
  const membership = await dbClient.execute({
    sql: `SELECT role FROM tokenless_workspace_members m
          JOIN tokenless_workspaces w ON w.workspace_id=m.workspace_id
          WHERE m.workspace_id=? AND m.account_address=? AND m.role IN ('owner','admin')
            AND w.status='active' LIMIT 1`,
    args: [input.workspaceId, principalId],
  });
  if (membership.rowCount !== 1) {
    throw new TokenlessServiceError("Workspace not found.", 404, "workspace_not_found");
  }
  const betterSession = await identityAuth().api.getSession({ headers: input.headers });
  if (!betterSession?.user?.id) {
    throw new TokenlessServiceError(
      "Reauthenticate before changing enterprise identity.",
      401,
      "reauthentication_required",
    );
  }
  const binding = await dbClient.execute({
    sql: `SELECT principal_id FROM tokenless_identity_bindings
          WHERE provider='better_auth' AND provider_subject=? AND principal_id=? AND status='active' LIMIT 1`,
    args: [betterSession.user.id, principalId],
  });
  if (binding.rowCount !== 1) {
    throw new TokenlessServiceError("Reauthentication identity mismatch.", 403, "reauthentication_mismatch");
  }
  return { betterUserId: betterSession.user.id, principalId };
}

type IdentityAdminAudit = {
  action: string;
  principalId: string;
  providerId: string;
  reason: string;
  workspaceId: string;
  metadata?: Record<string, unknown>;
  eventKey?: string;
};

function identityAdminAuditInput(input: IdentityAdminAudit) {
  return {
    action: input.action,
    actorKind: "principal",
    actorReference: input.principalId,
    assuranceMethod: "better_auth_session",
    metadata: input.metadata,
    eventKey: input.eventKey ?? `identity-admin:${randomUUID()}`,
    purpose: "enterprise_identity_administration",
    reason: input.reason,
    result: "success",
    targetId: input.providerId,
    targetKind: "enterprise_identity_provider",
    workspaceId: input.workspaceId,
  } as const;
}

async function auditIdentityAdmin(input: IdentityAdminAudit, client?: PoolClient) {
  await enqueueEnterpriseIdentityAudit(identityAdminAuditInput(input), client);
  if (!client) await drainEnterpriseIdentityAuditOutbox(new Date(), 1);
}

async function reserveIdentityAdminAudit(input: IdentityAdminAudit, client?: PoolClient) {
  const audit = identityAdminAuditInput(input);
  await reserveEnterpriseIdentityAudit(audit, client);
  return audit.eventKey;
}

async function activateAndDrainIdentityAdminAudit(eventKey: string, client?: PoolClient) {
  await activateEnterpriseIdentityAudit(eventKey, client);
  if (!client) await drainEnterpriseIdentityAuditOutbox(new Date(), 1);
}

export async function registerWorkspaceIdentityProvider(input: {
  accountAddress: string;
  body: Record<string, unknown>;
  headers: Headers;
  workspaceId: string;
}) {
  const admin = await requireIdentityAdmin(input);
  const domain = normalizeEnterpriseDomain(requiredString(input.body.domain, "domain", 253));
  const issuer = trustedIdentityUrl(input.body.issuer, "issuer");
  const protocol = input.body.protocol;
  if (protocol !== "oidc" && protocol !== "saml") {
    throw new TokenlessServiceError("protocol must be oidc or saml.", 400, "invalid_identity_provider");
  }
  const providerId = deterministicProviderId("rlsso", input.workspaceId, domain);
  const existing = await dbClient.execute({
    sql: `SELECT provider_id,workspace_id FROM tokenless_enterprise_identity_providers
          WHERE provider_id=? OR domain=? LIMIT 1`,
    args: [providerId, domain],
  });
  if ((existing.rowCount ?? 0) > 0) {
    if (text(existing.rows[0] as QueryRow, "workspace_id") !== input.workspaceId) {
      throw new TokenlessServiceError("This domain is already reserved.", 409, "identity_domain_conflict");
    }
    throw new TokenlessServiceError(
      "An identity provider already exists for this workspace domain.",
      409,
      "identity_provider_exists",
    );
  }

  const origin = getAuthOrigin();
  const registration =
    protocol === "oidc"
      ? await identityAuth().api.registerSSOProvider({
          body: {
            domain,
            issuer,
            oidcConfig: {
              clientId: requiredString(input.body.clientId, "clientId", 500),
              clientSecret: requiredString(input.body.clientSecret, "clientSecret", 2_000),
              pkce: true,
              scopes: ["openid", "email", "profile"],
            },
            providerId,
          },
          headers: input.headers,
        })
      : await identityAuth().api.registerSSOProvider({
          body: {
            domain,
            issuer,
            providerId,
            samlConfig: {
              audience: origin,
              authnRequestsSigned: false,
              callbackUrl: `${origin}/api/auth/better/sso/saml2/sp/acs/${providerId}`,
              cert: requiredString(input.body.certificate, "certificate", 20_000),
              digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
              entryPoint: trustedIdentityUrl(input.body.entryPoint, "entryPoint"),
              identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
              signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
              spMetadata: { binding: "post", entityID: origin },
              wantAssertionsSigned: true,
            },
          },
          headers: input.headers,
        });
  const now = new Date();
  const eventKey = `identity-admin:${randomUUID()}`;
  try {
    await identityTransaction(async client => {
      await client.query(
        `INSERT INTO tokenless_enterprise_identity_providers
            (provider_id,workspace_id,protocol,domain,enforce_sso,status,created_by,last_sso_at,created_at,updated_at)
            VALUES ($1, $2, $3, $4, false, 'active', $5, NULL, $6, $6)`,
        [providerId, input.workspaceId, protocol, domain, admin.principalId, now],
      );
      await auditIdentityAdmin(
        {
          action: "identity.provider.registered",
          eventKey,
          metadata: { domain, protocol },
          principalId: admin.principalId,
          providerId,
          reason: "workspace_admin_registered_provider",
          workspaceId: input.workspaceId,
        },
        client,
      );
    });
  } catch (error) {
    await identityAuth()
      .api.deleteSSOProvider({ body: { providerId }, headers: input.headers })
      .catch(() => undefined);
    throw error;
  }
  await drainEnterpriseIdentityAuditOutbox(new Date(), 1);
  return {
    providerId,
    domain,
    domainVerified: registration.domainVerified,
    domainVerificationToken: registration.domainVerificationToken,
    redirectUri: registration.redirectURI,
  };
}

async function requireMappedProvider(workspaceId: string, providerId: string) {
  const result = await dbClient.execute({
    sql: `SELECT p.provider_id,p.protocol,p.domain,p.enforce_sso,p.updated_at,s.domain_verified
          FROM tokenless_enterprise_identity_providers p
          JOIN tokenless_better_auth_sso_providers s ON s.provider_id=p.provider_id
          WHERE p.workspace_id=? AND p.provider_id=? AND p.status='active' LIMIT 1`,
    args: [workspaceId, providerId],
  });
  if (result.rowCount !== 1)
    throw new TokenlessServiceError("Identity provider not found.", 404, "identity_provider_not_found");
  return result.rows[0] as QueryRow;
}

export async function updateWorkspaceIdentityProvider(input: {
  accountAddress: string;
  body: Record<string, unknown>;
  headers: Headers;
  providerId: string;
  workspaceId: string;
}) {
  const provider = await requireMappedProvider(input.workspaceId, input.providerId);
  const admin = await requireIdentityAdmin(input);
  const protocol = text(provider, "protocol");
  const update: {
    providerId: string;
    domain?: string;
    issuer?: string;
    oidcConfig?: { clientId?: string; clientSecret?: string; pkce?: boolean; scopes?: string[] };
    samlConfig?: { cert?: string; entryPoint?: string };
  } = { providerId: input.providerId };
  if (input.body.domain !== undefined) {
    const nextDomain = normalizeEnterpriseDomain(requiredString(input.body.domain, "domain", 253));
    if (nextDomain !== text(provider, "domain")) update.domain = nextDomain;
  }
  if (input.body.issuer !== undefined) update.issuer = trustedIdentityUrl(input.body.issuer, "issuer");
  if (protocol === "oidc" && (input.body.clientId !== undefined || input.body.clientSecret !== undefined)) {
    update.oidcConfig = {
      ...(input.body.clientId !== undefined ? { clientId: requiredString(input.body.clientId, "clientId", 500) } : {}),
      ...(input.body.clientSecret !== undefined
        ? { clientSecret: requiredString(input.body.clientSecret, "clientSecret", 2_000) }
        : {}),
      pkce: true,
      scopes: ["openid", "email", "profile"],
    };
  }
  if (protocol === "saml" && (input.body.entryPoint !== undefined || input.body.certificate !== undefined)) {
    update.samlConfig = {
      ...(input.body.entryPoint !== undefined
        ? { entryPoint: trustedIdentityUrl(input.body.entryPoint, "entryPoint") }
        : {}),
      ...(input.body.certificate !== undefined
        ? { cert: requiredString(input.body.certificate, "certificate", 20_000) }
        : {}),
    };
  }
  const requiresDomainVerification = update.domain !== undefined;
  const wasEnforced = bool(provider, "enforce_sso");
  const eventKey = identityOperationEventKey({
    action: "provider-updated",
    body: input.body,
    providerId: input.providerId,
    providerVersion: iso(provider, "updated_at"),
    workspaceId: input.workspaceId,
  });
  const prior = await enterpriseIdentityAuditReservation(eventKey);
  if (Object.keys(update).length === 1) {
    if (prior?.state !== "reserved") {
      throw new TokenlessServiceError("No identity provider changes were supplied.", 400, "invalid_identity_provider");
    }
    const reservedDomainVerification = prior.metadata.requiresDomainVerification === true;
    await identityTransaction(async client => {
      await client.query(
        `UPDATE tokenless_enterprise_identity_providers
         SET enforce_sso=CASE WHEN $1 THEN false ELSE enforce_sso END,updated_at=$2 WHERE provider_id=$3`,
        [reservedDomainVerification, new Date(), input.providerId],
      );
      if (reservedDomainVerification) {
        await client.query(
          "UPDATE tokenless_better_auth_sso_providers SET domain_verified=false WHERE provider_id=$1",
          [input.providerId],
        );
      }
      await activateAndDrainIdentityAdminAudit(eventKey, client);
    });
    await drainEnterpriseIdentityAuditOutbox(new Date(), 1);
    return {
      providerId: input.providerId,
      enforceSso: reservedDomainVerification ? false : bool(provider, "enforce_sso"),
      requiresDomainVerification: reservedDomainVerification,
    };
  }
  if (!prior) {
    await identityTransaction(async client => {
      await reserveIdentityAdminAudit(
        {
          action: "identity.provider.updated",
          eventKey,
          metadata: { protocol, requiresDomainVerification, wasEnforced },
          principalId: admin.principalId,
          providerId: input.providerId,
          reason: "workspace_admin_updated_provider",
          workspaceId: input.workspaceId,
        },
        client,
      );
      if (wasEnforced && requiresDomainVerification) {
        await client.query(
          "UPDATE tokenless_enterprise_identity_providers SET enforce_sso=false WHERE provider_id=$1",
          [input.providerId],
        );
      }
    });
  }
  try {
    await identityAuth().api.updateSSOProvider({ body: update, headers: input.headers });
  } catch (error) {
    const reservedWasEnforced = prior?.metadata.wasEnforced === true || wasEnforced;
    if (reservedWasEnforced && requiresDomainVerification) {
      await dbClient.execute({
        sql: "UPDATE tokenless_enterprise_identity_providers SET enforce_sso=true,updated_at=? WHERE provider_id=?",
        args: [new Date(), input.providerId],
      });
    }
    await recordEnterpriseIdentityReservationFailure(eventKey, error);
    throw error;
  }
  await identityTransaction(async client => {
    await client.query(
      `UPDATE tokenless_enterprise_identity_providers
       SET enforce_sso=CASE WHEN $1 THEN false ELSE enforce_sso END,updated_at=$2 WHERE provider_id=$3`,
      [requiresDomainVerification, new Date(), input.providerId],
    );
    if (requiresDomainVerification) {
      await client.query("UPDATE tokenless_better_auth_sso_providers SET domain_verified=false WHERE provider_id=$1", [
        input.providerId,
      ]);
    }
    await activateAndDrainIdentityAdminAudit(eventKey, client);
  });
  await drainEnterpriseIdentityAuditOutbox(new Date(), 1);
  return {
    providerId: input.providerId,
    enforceSso: requiresDomainVerification ? false : wasEnforced,
    requiresDomainVerification,
  };
}

export async function requestWorkspaceDomainVerification(input: {
  accountAddress: string;
  headers: Headers;
  providerId: string;
  workspaceId: string;
}) {
  const provider = await requireMappedProvider(input.workspaceId, input.providerId);
  const admin = await requireIdentityAdmin(input);
  const eventKey = identityOperationEventKey({
    action: "domain-verification-requested",
    providerId: input.providerId,
    providerVersion: iso(provider, "updated_at"),
    workspaceId: input.workspaceId,
  });
  await reserveIdentityAdminAudit({
    action: "identity.provider.domain_verification_requested",
    eventKey,
    principalId: admin.principalId,
    providerId: input.providerId,
    reason: "workspace_admin_requested_domain_verification",
    workspaceId: input.workspaceId,
  });
  let result;
  try {
    result = await identityAuth().api.requestDomainVerification({
      body: { providerId: input.providerId },
      headers: input.headers,
    });
  } catch (error) {
    await recordEnterpriseIdentityReservationFailure(eventKey, error);
    throw error;
  }
  await identityTransaction(async client => {
    await client.query("UPDATE tokenless_enterprise_identity_providers SET updated_at=$1 WHERE provider_id=$2", [
      new Date(),
      input.providerId,
    ]);
    await activateAndDrainIdentityAdminAudit(eventKey, client);
  });
  await drainEnterpriseIdentityAuditOutbox(new Date(), 1);
  return result;
}

export async function verifyWorkspaceIdentityDomain(input: {
  accountAddress: string;
  headers: Headers;
  providerId: string;
  workspaceId: string;
}) {
  const provider = await requireMappedProvider(input.workspaceId, input.providerId);
  const admin = await requireIdentityAdmin(input);
  const eventKey = identityOperationEventKey({
    action: "domain-verified",
    providerId: input.providerId,
    providerVersion: iso(provider, "updated_at"),
    workspaceId: input.workspaceId,
  });
  await reserveIdentityAdminAudit({
    action: "identity.provider.domain_verified",
    eventKey,
    principalId: admin.principalId,
    providerId: input.providerId,
    reason: "dns_domain_proof_verified",
    workspaceId: input.workspaceId,
  });
  try {
    await identityAuth().api.verifyDomain({ body: { providerId: input.providerId }, headers: input.headers });
  } catch (error) {
    await recordEnterpriseIdentityReservationFailure(eventKey, error);
    throw error;
  }
  await identityTransaction(async client => {
    await client.query("UPDATE tokenless_enterprise_identity_providers SET updated_at=$1 WHERE provider_id=$2", [
      new Date(),
      input.providerId,
    ]);
    await activateAndDrainIdentityAdminAudit(eventKey, client);
  });
  await drainEnterpriseIdentityAuditOutbox(new Date(), 1);
  return { verified: true };
}

export async function setWorkspaceSsoEnforcement(input: {
  accountAddress: string;
  enabled: unknown;
  headers: Headers;
  providerId: string;
  workspaceId: string;
}) {
  if (typeof input.enabled !== "boolean") {
    throw new TokenlessServiceError("enabled must be boolean.", 400, "invalid_identity_provider");
  }
  const provider = await requireMappedProvider(input.workspaceId, input.providerId);
  const admin = await requireIdentityAdmin(input);
  if (input.enabled && !bool(provider, "domain_verified")) {
    throw new TokenlessServiceError(
      "Verify the provider domain before enforcing SSO.",
      409,
      "identity_domain_unverified",
    );
  }
  const eventKey = `identity-admin:${randomUUID()}`;
  await identityTransaction(async client => {
    await client.query(
      "UPDATE tokenless_enterprise_identity_providers SET enforce_sso=$1,updated_at=$2 WHERE provider_id=$3",
      [input.enabled, new Date(), input.providerId],
    );
    await auditIdentityAdmin(
      {
        action: input.enabled ? "identity.provider.sso_enforced" : "identity.provider.sso_enforcement_disabled",
        eventKey,
        principalId: admin.principalId,
        providerId: input.providerId,
        reason: input.enabled ? "workspace_admin_enabled_sso_only" : "workspace_admin_disabled_sso_only",
        workspaceId: input.workspaceId,
      },
      client,
    );
  });
  await drainEnterpriseIdentityAuditOutbox(new Date(), 1);
  return { enforced: input.enabled };
}

export async function deleteWorkspaceIdentityProvider(input: {
  accountAddress: string;
  headers: Headers;
  providerId: string;
  workspaceId: string;
}) {
  const admin = await requireIdentityAdmin(input);
  const eventKey = `identity-provider-deleted:${input.workspaceId}:${input.providerId}`;
  const auditState = await enterpriseIdentityAuditState(eventKey);
  const mapping = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_enterprise_identity_providers
          WHERE workspace_id=? AND provider_id=? AND status='active' LIMIT 1`,
    args: [input.workspaceId, input.providerId],
  });
  if (mapping.rowCount !== 1) {
    if (auditState) {
      await activateAndDrainIdentityAdminAudit(eventKey);
      return { deleted: true };
    }
    throw new TokenlessServiceError("Identity provider not found.", 404, "identity_provider_not_found");
  }
  if (!auditState) {
    await reserveIdentityAdminAudit({
      action: "identity.provider.deleted",
      eventKey,
      principalId: admin.principalId,
      providerId: input.providerId,
      reason: "workspace_admin_deleted_provider",
      workspaceId: input.workspaceId,
    });
  }
  try {
    await identityAuth().api.deleteSSOProvider({ body: { providerId: input.providerId }, headers: input.headers });
  } catch (error) {
    const remaining = await dbClient.execute({
      sql: `SELECT 1 FROM tokenless_enterprise_identity_providers
            WHERE workspace_id=? AND provider_id=? AND status='active' LIMIT 1`,
      args: [input.workspaceId, input.providerId],
    });
    if (remaining.rowCount === 1) {
      await recordEnterpriseIdentityReservationFailure(eventKey, error);
      throw error;
    }
  }
  const remaining = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_enterprise_identity_providers
          WHERE workspace_id=? AND provider_id=? AND status='active' LIMIT 1`,
    args: [input.workspaceId, input.providerId],
  });
  if (remaining.rowCount === 1) {
    const error = new Error("Identity provider deletion did not remove the workspace mapping.");
    await recordEnterpriseIdentityReservationFailure(eventKey, error);
    throw error;
  }
  await activateAndDrainIdentityAdminAudit(eventKey);
  return { deleted: true };
}

export async function createWorkspaceScimConnection(input: {
  accountAddress: string;
  headers: Headers;
  workspaceId: string;
}) {
  const admin = await requireIdentityAdmin(input);
  const providerId = deterministicProviderId("rlscim", input.workspaceId);
  const existing = await dbClient.execute({
    sql: "SELECT provider_id FROM tokenless_enterprise_scim_connections WHERE workspace_id=? AND status='active' LIMIT 1",
    args: [input.workspaceId],
  });
  if ((existing.rowCount ?? 0) > 0) {
    throw new TokenlessServiceError(
      "Revoke the existing SCIM token before creating another.",
      409,
      "scim_connection_exists",
    );
  }
  const generated = await identityAuth().api.generateSCIMToken({ body: { providerId }, headers: input.headers });
  const now = new Date();
  const eventKey = `identity-admin:${randomUUID()}`;
  try {
    await identityTransaction(async client => {
      await client.query(
        `INSERT INTO tokenless_enterprise_scim_connections
            (provider_id,workspace_id,status,created_by,last_sync_at,last_sync_result,created_at,updated_at)
            VALUES ($1,$2,'active',$3,NULL,NULL,$4,$4)`,
        [providerId, input.workspaceId, admin.principalId, now],
      );
      await auditIdentityAdmin(
        {
          action: "identity.scim.token_created",
          eventKey,
          principalId: admin.principalId,
          providerId,
          reason: "workspace_admin_created_scim_token",
          workspaceId: input.workspaceId,
        },
        client,
      );
    });
  } catch (error) {
    await identityAuth()
      .api.deleteSCIMProviderConnection({ body: { providerId }, headers: input.headers })
      .catch(() => undefined);
    throw error;
  }
  await drainEnterpriseIdentityAuditOutbox(new Date(), 1);
  return {
    providerId,
    scimToken: generated.scimToken,
    endpoint: `${getAuthOrigin()}/api/auth/better/scim/v2/Users`,
  };
}

export async function revokeWorkspaceScimConnection(input: {
  accountAddress: string;
  headers: Headers;
  providerId: string;
  workspaceId: string;
}) {
  const admin = await requireIdentityAdmin(input);
  const eventKey = `identity-scim-revoked:${input.workspaceId}:${input.providerId}`;
  const auditState = await enterpriseIdentityAuditState(eventKey);
  const mapping = await dbClient.execute({
    sql: `SELECT provider_id FROM tokenless_enterprise_scim_connections
          WHERE workspace_id=? AND provider_id=? AND status='active' LIMIT 1`,
    args: [input.workspaceId, input.providerId],
  });
  if (mapping.rowCount !== 1) {
    if (auditState) {
      await activateAndDrainIdentityAdminAudit(eventKey);
      return { revoked: true };
    }
    throw new TokenlessServiceError("SCIM connection not found.", 404, "scim_not_found");
  }
  if (!auditState) {
    await reserveIdentityAdminAudit({
      action: "identity.scim.token_revoked",
      eventKey,
      principalId: admin.principalId,
      providerId: input.providerId,
      reason: "workspace_admin_revoked_scim_token",
      workspaceId: input.workspaceId,
    });
  }
  try {
    await identityAuth().api.deleteSCIMProviderConnection({
      body: { providerId: input.providerId },
      headers: input.headers,
    });
  } catch (error) {
    const remaining = await dbClient.execute({
      sql: `SELECT 1 FROM tokenless_enterprise_scim_connections
            WHERE workspace_id=? AND provider_id=? AND status='active' LIMIT 1`,
      args: [input.workspaceId, input.providerId],
    });
    if (remaining.rowCount === 1) {
      await recordEnterpriseIdentityReservationFailure(eventKey, error);
      throw error;
    }
  }
  const remaining = await dbClient.execute({
    sql: `SELECT 1 FROM tokenless_enterprise_scim_connections
          WHERE workspace_id=? AND provider_id=? AND status='active' LIMIT 1`,
    args: [input.workspaceId, input.providerId],
  });
  if (remaining.rowCount === 1) {
    const error = new Error("SCIM revocation did not remove the workspace mapping.");
    await recordEnterpriseIdentityReservationFailure(eventKey, error);
    throw error;
  }
  await activateAndDrainIdentityAdminAudit(eventKey);
  return { revoked: true };
}

export async function listWorkspaceIdentity(input: { accountAddress: string; headers: Headers; workspaceId: string }) {
  await requireIdentityAdmin(input);
  const [providers, scim] = await Promise.all([
    dbClient.execute({
      sql: `SELECT p.provider_id,p.protocol,p.domain,p.enforce_sso,p.last_sso_at,p.created_at,
                   s.domain_verified
            FROM tokenless_enterprise_identity_providers p
            JOIN tokenless_better_auth_sso_providers s ON s.provider_id=p.provider_id
            WHERE p.workspace_id=? AND p.status='active' ORDER BY p.created_at ASC`,
      args: [input.workspaceId],
    }),
    dbClient.execute({
      sql: `SELECT provider_id,last_sync_at,last_sync_result,created_at
            FROM tokenless_enterprise_scim_connections
            WHERE workspace_id=? AND status='active' ORDER BY created_at ASC`,
      args: [input.workspaceId],
    }),
  ]);
  return {
    canManage: true,
    enabled: enterpriseIdentityEnabled(),
    providers: providers.rows.map(value => ({
      providerId: text(value as QueryRow, "provider_id"),
      protocol: text(value as QueryRow, "protocol"),
      domain: text(value as QueryRow, "domain"),
      domainVerified: bool(value as QueryRow, "domain_verified"),
      enforceSso: bool(value as QueryRow, "enforce_sso"),
      lastSsoAt: iso(value as QueryRow, "last_sso_at"),
      createdAt: iso(value as QueryRow, "created_at"),
    })),
    scim: scim.rows.map(value => ({
      providerId: text(value as QueryRow, "provider_id"),
      lastSyncAt: iso(value as QueryRow, "last_sync_at"),
      lastSyncResult: text(value as QueryRow, "last_sync_result"),
      createdAt: iso(value as QueryRow, "created_at"),
    })),
    limitations: { scimGroups: false },
  };
}

export function __setEnterpriseIdentityAuthForTests(auth: EnterpriseIdentityAuth | null) {
  enterpriseIdentityAuthForTests = auth;
}
