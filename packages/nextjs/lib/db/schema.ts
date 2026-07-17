import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export * from "./humanAssuranceSchema";

export const tokenlessAgentQuotes = pgTable(
  "tokenless_agent_quotes",
  {
    quoteId: text("quote_id").primaryKey(),
    requestHash: text("request_hash").notNull(),
    requestJson: text("request_json").notNull(),
    responseJson: text("response_json").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    expiresAtIdx: index("tokenless_agent_quotes_expires_at_idx").on(table.expiresAt),
    requestHashIdx: index("tokenless_agent_quotes_request_hash_idx").on(table.requestHash),
  }),
);

export type TokenlessAgentQuote = typeof tokenlessAgentQuotes.$inferSelect;
export type NewTokenlessAgentQuote = typeof tokenlessAgentQuotes.$inferInsert;

export const tokenlessAgentAsks = pgTable(
  "tokenless_agent_asks",
  {
    operationKey: text("operation_key").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    quoteId: text("quote_id").notNull(),
    requestJson: text("request_json").notNull(),
    economicsJson: text("economics_json").notNull(),
    status: text("status").notNull(),
    verdictStatus: text("verdict_status"),
    roundId: text("round_id"),
    resultJson: text("result_json"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    idempotencyKeyUnique: uniqueIndex("tokenless_agent_asks_idempotency_key_unique").on(table.idempotencyKey),
    statusUpdatedIdx: index("tokenless_agent_asks_status_updated_idx").on(table.status, table.updatedAt),
  }),
);

export type TokenlessAgentAsk = typeof tokenlessAgentAsks.$inferSelect;
export type NewTokenlessAgentAsk = typeof tokenlessAgentAsks.$inferInsert;

export const tokenlessMcpRateLimits = pgTable(
  "tokenless_mcp_rate_limits",
  {
    clientHash: text("client_hash").primaryKey(),
    windowStartedAt: timestamp("window_started_at", { mode: "date", withTimezone: true }).notNull(),
    requestCount: integer("request_count").notNull().default(1),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    updatedAtIdx: index("tokenless_mcp_rate_limits_updated_at_idx").on(table.updatedAt),
  }),
);

export const tokenlessAuthNonces = pgTable(
  "tokenless_auth_nonces",
  {
    nonceHash: text("nonce_hash").primaryKey(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({ expiresAtIdx: index("tokenless_auth_nonces_expires_at_idx").on(table.expiresAt) }),
);

export const tokenlessAuthSessions = pgTable(
  "tokenless_auth_sessions",
  {
    sessionHash: text("session_hash").primaryKey(),
    accountAddress: text("account_address"),
    principalId: text("principal_id").references(() => tokenlessPrincipals.principalId, { onDelete: "cascade" }),
    authProvider: text("auth_provider").notNull().default("base_account"),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    accountAddressIdx: index("tokenless_auth_sessions_account_address_idx").on(table.accountAddress),
    expiresAtIdx: index("tokenless_auth_sessions_expires_at_idx").on(table.expiresAt),
    principalIdx: index("tokenless_auth_sessions_principal_idx").on(table.principalId, table.expiresAt),
  }),
);

export const tokenlessPrincipals = pgTable(
  "tokenless_principals",
  {
    principalId: text("principal_id").primaryKey(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
    disabledAt: timestamp("disabled_at", { mode: "date", withTimezone: true }),
  },
  table => ({ statusIdx: index("tokenless_principals_status_idx").on(table.status, table.updatedAt) }),
);

export const tokenlessIdentityBindings = pgTable(
  "tokenless_identity_bindings",
  {
    bindingId: text("binding_id").primaryKey(),
    principalId: text("principal_id")
      .notNull()
      .references(() => tokenlessPrincipals.principalId, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { mode: "date", withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    principalIdx: index("tokenless_identity_bindings_principal_idx").on(table.principalId, table.status),
    providerSubjectUnique: uniqueIndex("tokenless_identity_bindings_provider_subject_unique").on(
      table.provider,
      table.providerSubject,
    ),
  }),
);

export const user = pgTable("tokenless_better_auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { mode: "date", withTimezone: true }),
});

export const session = pgTable(
  "tokenless_better_auth_sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
    authenticationMethod: text("authentication_method"),
  },
  table => ({ userIdx: index("tokenless_better_auth_sessions_user_idx").on(table.userId, table.expiresAt) }),
);

export const ssoProvider = pgTable(
  "tokenless_better_auth_sso_providers",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    oidcConfig: text("oidc_config"),
    samlConfig: text("saml_config"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull().unique(),
    organizationId: text("organization_id"),
    domain: text("domain").notNull(),
    domainVerified: boolean("domain_verified").default(false),
  },
  table => ({ userIdx: index("tokenless_better_auth_sso_user_idx").on(table.userId) }),
);

export const scimProvider = pgTable(
  "tokenless_better_auth_scim_providers",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").notNull().unique(),
    scimToken: text("scim_token").notNull().unique(),
    organizationId: text("organization_id"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  table => ({ userIdx: index("tokenless_better_auth_scim_user_idx").on(table.userId) }),
);

export const account = pgTable(
  "tokenless_better_auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: "date", withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: "date", withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    providerUnique: uniqueIndex("tokenless_better_auth_accounts_provider_unique").on(table.providerId, table.accountId),
    userIdx: index("tokenless_better_auth_accounts_user_idx").on(table.userId),
  }),
);

export const verification = pgTable(
  "tokenless_better_auth_verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    identifierIdx: index("tokenless_better_auth_verifications_identifier_idx").on(table.identifier, table.expiresAt),
  }),
);

export const passkey = pgTable(
  "tokenless_better_auth_passkeys",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull().unique(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }),
    aaguid: text("aaguid"),
  },
  table => ({ userIdx: index("tokenless_better_auth_passkeys_user_idx").on(table.userId) }),
);

export const tokenlessThirdwebWalletJtis = pgTable(
  "tokenless_thirdweb_wallet_jtis",
  {
    jtiHash: text("jti_hash").primaryKey(),
    principalId: text("principal_id")
      .notNull()
      .references(() => tokenlessPrincipals.principalId, { onDelete: "cascade" }),
    audience: text("audience").notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    principalIdx: index("tokenless_thirdweb_wallet_jtis_principal_idx").on(table.principalId, table.expiresAt),
  }),
);

export const tokenlessWalletBindingChallenges = pgTable(
  "tokenless_wallet_binding_challenges",
  {
    challengeId: text("challenge_id").primaryKey(),
    principalId: text("principal_id")
      .notNull()
      .references(() => tokenlessPrincipals.principalId, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    walletAddress: text("wallet_address").notNull(),
    walletSource: text("wallet_source").notNull(),
    chainId: integer("chain_id").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    messageHash: text("message_hash").notNull(),
    thirdwebJtiHash: text("thirdweb_jti_hash").references(() => tokenlessThirdwebWalletJtis.jtiHash, {
      onDelete: "restrict",
    }),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    principalIdx: index("tokenless_wallet_binding_challenges_principal_idx").on(table.principalId, table.expiresAt),
  }),
);

export const tokenlessWalletBindings = pgTable(
  "tokenless_wallet_bindings",
  {
    bindingId: text("binding_id").primaryKey(),
    principalId: text("principal_id")
      .notNull()
      .references(() => tokenlessPrincipals.principalId, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    walletAddress: text("wallet_address").notNull(),
    walletSource: text("wallet_source").notNull(),
    chainId: integer("chain_id").notNull(),
    proofMessageHash: text("proof_message_hash").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { mode: "date", withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
  },
  table => ({ principalIdx: index("tokenless_wallet_bindings_principal_idx").on(table.principalId, table.purpose) }),
);

export const tokenlessBrowserIdentities = pgTable(
  "tokenless_browser_identities",
  {
    principalAddress: text("principal_address").primaryKey(),
    thirdwebUserId: text("thirdweb_user_id"),
    authProvider: text("auth_provider").notNull(),
    primaryEmail: text("primary_email"),
    emailVerified: boolean("email_verified").notNull().default(false),
    emailDomain: text("email_domain"),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
    lastLoginAt: timestamp("last_login_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    thirdwebUserIdUnique: uniqueIndex("tokenless_browser_identities_thirdweb_user_id_unique").on(table.thirdwebUserId),
    emailDomainIdx: index("tokenless_browser_identities_email_domain_idx").on(table.emailDomain),
  }),
);

export const tokenlessAccountProfiles = pgTable(
  "tokenless_account_profiles",
  {
    principalAddress: text("principal_address")
      .primaryKey()
      .references(() => tokenlessBrowserIdentities.principalAddress, { onDelete: "cascade" }),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({ updatedAtIdx: index("tokenless_account_profiles_updated_at_idx").on(table.updatedAt) }),
);

export type TokenlessAccountProfile = typeof tokenlessAccountProfiles.$inferSelect;
export type NewTokenlessAccountProfile = typeof tokenlessAccountProfiles.$inferInsert;

export const tokenlessNotificationPreferences = pgTable(
  "tokenless_notification_preferences",
  {
    principalAddress: text("principal_address")
      .primaryKey()
      .references(() => tokenlessBrowserIdentities.principalAddress, { onDelete: "cascade" }),
    assignmentAvailable: boolean("assignment_available").notNull().default(true),
    assignmentCompleted: boolean("assignment_completed").notNull().default(true),
    paymentUpdates: boolean("payment_updates").notNull().default(true),
    askResults: boolean("ask_results").notNull().default(true),
    accountSecurity: boolean("account_security").notNull().default(true),
    oversightAlerts: boolean("oversight_alerts").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({ updatedAtIdx: index("tokenless_notification_preferences_updated_at_idx").on(table.updatedAt) }),
);

export type TokenlessNotificationPreferences = typeof tokenlessNotificationPreferences.$inferSelect;
export type NewTokenlessNotificationPreferences = typeof tokenlessNotificationPreferences.$inferInsert;

export const tokenlessNotificationEmailSubscriptions = pgTable(
  "tokenless_notification_email_subscriptions",
  {
    principalAddress: text("principal_address")
      .primaryKey()
      .references(() => tokenlessBrowserIdentities.principalAddress, { onDelete: "cascade" }),
    email: text("email").notNull(),
    verifiedAt: timestamp("verified_at", { mode: "date", withTimezone: true }),
    verificationTokenHash: text("verification_token_hash"),
    verificationExpiresAt: timestamp("verification_expires_at", { mode: "date", withTimezone: true }),
    unsubscribeTokenHash: text("unsubscribe_token_hash"),
    assignmentAvailable: boolean("assignment_available").notNull().default(true),
    assignmentCompleted: boolean("assignment_completed").notNull().default(true),
    paymentUpdates: boolean("payment_updates").notNull().default(true),
    askResults: boolean("ask_results").notNull().default(true),
    accountSecurity: boolean("account_security").notNull().default(true),
    oversightAlerts: boolean("oversight_alerts").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    emailUnique: uniqueIndex("tokenless_notification_email_subscriptions_email_unique").on(table.email),
    verificationTokenIdx: index("tokenless_notification_email_subscriptions_verification_token_idx").on(
      table.verificationTokenHash,
    ),
    unsubscribeTokenIdx: index("tokenless_notification_email_subscriptions_unsubscribe_token_idx").on(
      table.unsubscribeTokenHash,
    ),
  }),
);

export type TokenlessNotificationEmailSubscription = typeof tokenlessNotificationEmailSubscriptions.$inferSelect;
export type NewTokenlessNotificationEmailSubscription = typeof tokenlessNotificationEmailSubscriptions.$inferInsert;

export const tokenlessNotifications = pgTable(
  "tokenless_notifications",
  {
    notificationId: text("notification_id").primaryKey(),
    principalAddress: text("principal_address")
      .notNull()
      .references(() => tokenlessBrowserIdentities.principalAddress, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    href: text("href"),
    preferenceKey: text("preference_key"),
    sourceType: text("source_type"),
    sourceKey: text("source_key"),
    readAt: timestamp("read_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    principalCreatedIdx: index("tokenless_notifications_principal_created_idx").on(
      table.principalAddress,
      table.createdAt,
    ),
    principalSourceUnique: uniqueIndex("tokenless_notifications_principal_source_unique").on(
      table.principalAddress,
      table.sourceType,
      table.sourceKey,
    ),
  }),
);

export type TokenlessNotification = typeof tokenlessNotifications.$inferSelect;

export const tokenlessNotificationEmailDeliveries = pgTable(
  "tokenless_notification_email_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey(),
    notificationId: text("notification_id")
      .notNull()
      .references(() => tokenlessNotifications.notificationId, { onDelete: "cascade" }),
    principalAddress: text("principal_address")
      .notNull()
      .references(() => tokenlessBrowserIdentities.principalAddress, { onDelete: "cascade" }),
    preferenceKey: text("preference_key").notNull(),
    state: text("state").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date", withTimezone: true }).notNull(),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { mode: "date", withTimezone: true }),
    suppressedAt: timestamp("suppressed_at", { mode: "date", withTimezone: true }),
    deadAt: timestamp("dead_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    notificationUnique: uniqueIndex("tokenless_notification_email_deliveries_notification_unique").on(
      table.notificationId,
    ),
    dueIdx: index("tokenless_notification_email_deliveries_due_idx").on(
      table.state,
      table.nextAttemptAt,
      table.createdAt,
    ),
    principalIdx: index("tokenless_notification_email_deliveries_principal_idx").on(
      table.principalAddress,
      table.createdAt,
    ),
  }),
);

export type TokenlessNotificationEmailDelivery = typeof tokenlessNotificationEmailDeliveries.$inferSelect;

export const tokenlessAgentOauthClients = pgTable(
  "tokenless_agent_oauth_clients",
  {
    clientId: text("client_id").primaryKey(),
    clientSecretHash: text("client_secret_hash"),
    clientName: text("client_name").notNull(),
    clientUri: text("client_uri"),
    logoUri: text("logo_uri"),
    redirectUrisJson: text("redirect_uris_json").notNull(),
    redirectUrisDigest: text("redirect_uris_digest").notNull(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull(),
    grantTypesJson: text("grant_types_json").notNull().default('["authorization_code","refresh_token"]'),
    responseTypesJson: text("response_types_json").notNull().default('["code"]'),
    allowedScopesJson: text("allowed_scopes_json").notNull(),
    registrationSource: text("registration_source").notNull(),
    clientIdMetadataUrl: text("client_id_metadata_url"),
    metadataDocumentDigest: text("metadata_document_digest"),
    metadataFetchedAt: timestamp("metadata_fetched_at", { mode: "date", withTimezone: true }),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    registeredByPrincipalId: text("registered_by_principal_id").references(() => tokenlessPrincipals.principalId, {
      onDelete: "restrict",
    }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    revocationReason: text("revocation_reason"),
  },
  table => ({
    metadataIdx: index("tokenless_agent_oauth_clients_metadata_idx").on(
      table.clientIdMetadataUrl,
      table.metadataFetchedAt,
    ),
    statusIdx: index("tokenless_agent_oauth_clients_status_idx").on(table.status, table.expiresAt),
  }),
);

export const tokenlessAgentOauthTokenFamilies = pgTable(
  "tokenless_agent_oauth_token_families",
  {
    tokenFamilyId: text("token_family_id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => tokenlessAgentOauthClients.clientId, { onDelete: "restrict" }),
    subjectPrincipalId: text("subject_principal_id")
      .notNull()
      .references(() => tokenlessPrincipals.principalId, { onDelete: "restrict" }),
    audience: text("audience").notNull(),
    resource: text("resource").notNull(),
    grantedScopesJson: text("granted_scopes_json").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", { mode: "date", withTimezone: true }).notNull(),
    lastRotatedAt: timestamp("last_rotated_at", { mode: "date", withTimezone: true }),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    revokedBy: text("revoked_by"),
    revocationReason: text("revocation_reason"),
  },
  table => ({
    clientSubjectIdx: index("tokenless_agent_oauth_token_families_client_subject_idx").on(
      table.clientId,
      table.subjectPrincipalId,
      table.status,
    ),
    expiryIdx: index("tokenless_agent_oauth_token_families_expiry_idx").on(table.status, table.absoluteExpiresAt),
  }),
);

export const tokenlessAgentOauthAuthorizationCodes = pgTable(
  "tokenless_agent_oauth_authorization_codes",
  {
    authorizationCodeId: text("authorization_code_id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    tokenFamilyId: text("token_family_id")
      .notNull()
      .references(() => tokenlessAgentOauthTokenFamilies.tokenFamilyId, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => tokenlessAgentOauthClients.clientId, { onDelete: "restrict" }),
    subjectPrincipalId: text("subject_principal_id")
      .notNull()
      .references(() => tokenlessPrincipals.principalId, { onDelete: "restrict" }),
    redirectUri: text("redirect_uri").notNull(),
    redirectUriDigest: text("redirect_uri_digest").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    stateHash: text("state_hash"),
    audience: text("audience").notNull(),
    resource: text("resource").notNull(),
    grantedScopesJson: text("granted_scopes_json").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true }),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    codeHashUnique: uniqueIndex("tokenless_agent_oauth_authorization_codes_hash_unique").on(table.codeHash),
    expiryIdx: index("tokenless_agent_oauth_authorization_codes_expiry_idx").on(
      table.expiresAt,
      table.consumedAt,
      table.revokedAt,
    ),
    familyUnique: uniqueIndex("tokenless_agent_oauth_authorization_codes_family_unique").on(table.tokenFamilyId),
  }),
);

export const tokenlessAgentOauthRefreshTokens = pgTable(
  "tokenless_agent_oauth_refresh_tokens",
  {
    refreshTokenId: text("refresh_token_id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    tokenFamilyId: text("token_family_id")
      .notNull()
      .references(() => tokenlessAgentOauthTokenFamilies.tokenFamilyId, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => tokenlessAgentOauthClients.clientId, { onDelete: "restrict" }),
    subjectPrincipalId: text("subject_principal_id")
      .notNull()
      .references(() => tokenlessPrincipals.principalId, { onDelete: "restrict" }),
    audience: text("audience").notNull(),
    resource: text("resource").notNull(),
    grantedScopesJson: text("granted_scopes_json").notNull(),
    generation: integer("generation").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { mode: "date", withTimezone: true }),
    replacedAt: timestamp("replaced_at", { mode: "date", withTimezone: true }),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    revocationReason: text("revocation_reason"),
  },
  table => ({
    expiryIdx: index("tokenless_agent_oauth_refresh_tokens_expiry_idx").on(table.expiresAt, table.revokedAt),
    familyStatusIdx: index("tokenless_agent_oauth_refresh_tokens_family_status_idx").on(
      table.tokenFamilyId,
      table.generation,
      table.revokedAt,
    ),
    generationUnique: uniqueIndex("tokenless_agent_oauth_refresh_tokens_generation_unique").on(
      table.tokenFamilyId,
      table.generation,
    ),
    tokenHashUnique: uniqueIndex("tokenless_agent_oauth_refresh_tokens_hash_unique").on(table.tokenHash),
  }),
);

export const tokenlessAgentOauthAccessTokens = pgTable(
  "tokenless_agent_oauth_access_tokens",
  {
    accessTokenId: text("access_token_id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    tokenFamilyId: text("token_family_id")
      .notNull()
      .references(() => tokenlessAgentOauthTokenFamilies.tokenFamilyId, { onDelete: "cascade" }),
    refreshTokenId: text("refresh_token_id").references(() => tokenlessAgentOauthRefreshTokens.refreshTokenId, {
      onDelete: "set null",
    }),
    clientId: text("client_id")
      .notNull()
      .references(() => tokenlessAgentOauthClients.clientId, { onDelete: "restrict" }),
    subjectPrincipalId: text("subject_principal_id")
      .notNull()
      .references(() => tokenlessPrincipals.principalId, { onDelete: "restrict" }),
    audience: text("audience").notNull(),
    resource: text("resource").notNull(),
    grantedScopesJson: text("granted_scopes_json").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { mode: "date", withTimezone: true }),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    revocationReason: text("revocation_reason"),
  },
  table => ({
    familyStatusIdx: index("tokenless_agent_oauth_access_tokens_family_status_idx").on(
      table.tokenFamilyId,
      table.expiresAt,
      table.revokedAt,
    ),
    refreshIdx: index("tokenless_agent_oauth_access_tokens_refresh_idx").on(table.refreshTokenId, table.expiresAt),
    tokenHashUnique: uniqueIndex("tokenless_agent_oauth_access_tokens_hash_unique").on(table.tokenHash),
  }),
);

export const tokenlessAgentOauthDeviceAuthorizations = pgTable(
  "tokenless_agent_oauth_device_authorizations",
  {
    deviceAuthorizationId: text("device_authorization_id").primaryKey(),
    deviceCodeHash: text("device_code_hash").notNull(),
    userCodeHash: text("user_code_hash").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => tokenlessAgentOauthClients.clientId, { onDelete: "restrict" }),
    audience: text("audience").notNull(),
    resource: text("resource").notNull(),
    requestedScopesJson: text("requested_scopes_json").notNull(),
    status: text("status").notNull().default("pending"),
    intervalSeconds: integer("interval_seconds").notNull().default(5),
    pollCount: integer("poll_count").notNull().default(0),
    lastPolledAt: timestamp("last_polled_at", { mode: "date", withTimezone: true }),
    approvedByPrincipalId: text("approved_by_principal_id").references(() => tokenlessPrincipals.principalId, {
      onDelete: "restrict",
    }),
    approvedAt: timestamp("approved_at", { mode: "date", withTimezone: true }),
    deniedAt: timestamp("denied_at", { mode: "date", withTimezone: true }),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true }),
    tokenFamilyId: text("token_family_id").references(() => tokenlessAgentOauthTokenFamilies.tokenFamilyId, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    clientCreatedIdx: index("tokenless_agent_oauth_device_authorizations_client_created_idx").on(
      table.clientId,
      table.createdAt,
    ),
    deviceHashUnique: uniqueIndex("tokenless_agent_oauth_device_authorizations_device_hash_unique").on(
      table.deviceCodeHash,
    ),
    familyUnique: uniqueIndex("tokenless_agent_oauth_device_authorizations_family_unique").on(table.tokenFamilyId),
    statusExpiryIdx: index("tokenless_agent_oauth_device_authorizations_status_expiry_idx").on(
      table.status,
      table.expiresAt,
    ),
    userHashUnique: uniqueIndex("tokenless_agent_oauth_device_authorizations_user_hash_unique").on(table.userCodeHash),
  }),
);

export const tokenlessAgentConnectionIntents = pgTable(
  "tokenless_agent_connection_intents",
  {
    intentId: text("intent_id").primaryKey(),
    claimNonceHash: text("claim_nonce_hash").notNull(),
    workspaceId: text("workspace_id").notNull(),
    createdBy: text("created_by").notNull(),
    status: text("status").notNull().default("issued"),
    profileKey: text("profile_key").notNull(),
    profileVersion: integer("profile_version").notNull(),
    maximumScopesJson: text("maximum_scopes_json").notNull(),
    allowedWorkflowKeysJson: text("allowed_workflow_keys_json").notNull().default("[]"),
    reviewPresetJson: text("review_preset_json").notNull().default("{}"),
    preferredHostFamily: text("preferred_host_family"),
    allowedHostFamiliesJson: text("allowed_host_families_json").notNull().default("[]"),
    autoActivate: boolean("auto_activate").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    claimExpiresAt: timestamp("claim_expires_at", { mode: "date", withTimezone: true }).notNull(),
    hardExpiresAt: timestamp("hard_expires_at", { mode: "date", withTimezone: true }).notNull(),
    claimedAt: timestamp("claimed_at", { mode: "date", withTimezone: true }),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true }),
    testedAt: timestamp("tested_at", { mode: "date", withTimezone: true }),
    connectedAt: timestamp("connected_at", { mode: "date", withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { mode: "date", withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { mode: "date", withTimezone: true }),
    claimedTokenFamilyId: text("claimed_token_family_id").references(
      () => tokenlessAgentOauthTokenFamilies.tokenFamilyId,
      { onDelete: "restrict" },
    ),
    claimedOauthClientId: text("claimed_oauth_client_id").references(() => tokenlessAgentOauthClients.clientId, {
      onDelete: "restrict",
    }),
    claimedSubjectPrincipalId: text("claimed_subject_principal_id").references(() => tokenlessPrincipals.principalId, {
      onDelete: "restrict",
    }),
    clientName: text("client_name"),
    clientVersion: text("client_version"),
    clientCapabilitiesJson: text("client_capabilities_json").notNull().default("[]"),
    lastTransitionAt: timestamp("last_transition_at", { mode: "date", withTimezone: true }).notNull(),
    lastTransitionReason: text("last_transition_reason"),
    lastDiagnosticCode: text("last_diagnostic_code"),
    lastDiagnosticAt: timestamp("last_diagnostic_at", { mode: "date", withTimezone: true }),
    recoveryAction: text("recovery_action"),
  },
  table => ({
    expiryIdx: index("tokenless_agent_connection_intents_expiry_idx").on(
      table.status,
      table.claimExpiresAt,
      table.hardExpiresAt,
    ),
    familyUnique: uniqueIndex("tokenless_agent_connection_intents_family_unique").on(table.claimedTokenFamilyId),
    nonceUnique: uniqueIndex("tokenless_agent_connection_intents_nonce_unique").on(table.claimNonceHash),
    workspaceStatusIdx: index("tokenless_agent_connection_intents_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.createdAt,
    ),
  }),
);

export const tokenlessAgentConnectionIntentEvents = pgTable(
  "tokenless_agent_connection_intent_events",
  {
    eventId: text("event_id").primaryKey(),
    intentId: text("intent_id")
      .notNull()
      .references(() => tokenlessAgentConnectionIntents.intentId, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    actorType: text("actor_type").notNull(),
    actorReference: text("actor_reference").notNull(),
    reason: text("reason").notNull(),
    diagnosticCode: text("diagnostic_code"),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    intentCreatedIdx: index("tokenless_agent_connection_intent_events_intent_created_idx").on(
      table.intentId,
      table.createdAt,
    ),
    workspaceCreatedIdx: index("tokenless_agent_connection_intent_events_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
);

export type TokenlessAgentOauthClient = typeof tokenlessAgentOauthClients.$inferSelect;
export type TokenlessAgentOauthTokenFamily = typeof tokenlessAgentOauthTokenFamilies.$inferSelect;
export type TokenlessAgentOauthDeviceAuthorization = typeof tokenlessAgentOauthDeviceAuthorizations.$inferSelect;
export type TokenlessAgentConnectionIntent = typeof tokenlessAgentConnectionIntents.$inferSelect;
export type TokenlessAgentConnectionIntentEvent = typeof tokenlessAgentConnectionIntentEvents.$inferSelect;

export const tokenlessAgentReviewPolicies = pgTable(
  "tokenless_agent_review_policies",
  {
    policyId: text("policy_id").notNull(),
    version: integer("version").notNull(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    agentVersionId: text("agent_version_id").notNull(),
    mode: text("mode").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    agreementThresholdBps: integer("agreement_threshold_bps").notNull(),
    productionFloorBps: integer("production_floor_bps").notNull(),
    maximumUnreviewedGap: integer("maximum_unreviewed_gap").notNull(),
    fixedRateBps: integer("fixed_rate_bps"),
    rulesJson: text("rules_json").notNull().default("{}"),
    audiencePolicyJson: text("audience_policy_json").notNull(),
    publishingPolicyId: text("publishing_policy_id"),
    createdBy: text("created_by").notNull(),
    approvedBy: text("approved_by").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    supersededAt: timestamp("superseded_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    pk: primaryKey({ columns: [table.policyId, table.version] }),
    workspaceAgentIdx: index("tokenless_agent_review_policies_workspace_agent_idx").on(
      table.workspaceId,
      table.agentId,
      table.agentVersionId,
      table.enabled,
    ),
    workspaceUnique: uniqueIndex("tokenless_agent_review_policies_workspace_unique").on(
      table.workspaceId,
      table.policyId,
      table.version,
    ),
  }),
);

export type TokenlessAgentReviewPolicy = typeof tokenlessAgentReviewPolicies.$inferSelect;
export type NewTokenlessAgentReviewPolicy = typeof tokenlessAgentReviewPolicies.$inferInsert;

export const tokenlessAgentReviewRequestProfiles = pgTable(
  "tokenless_agent_review_request_profiles",
  {
    profileId: text("profile_id").notNull(),
    version: integer("version").notNull(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    agentVersionId: text("agent_version_id").notNull(),
    questionAuthority: text("question_authority").notNull(),
    resultSemantics: text("result_semantics").notNull(),
    criterion: text("criterion"),
    positiveLabel: text("positive_label"),
    negativeLabel: text("negative_label"),
    rationaleMode: text("rationale_mode").notNull(),
    audience: text("audience").notNull(),
    contentBoundary: text("content_boundary").notNull(),
    privateSensitivity: text("private_sensitivity"),
    privateGroupId: text("private_group_id"),
    privateGroupPolicyVersion: integer("private_group_policy_version"),
    privateGroupPolicyHash: text("private_group_policy_hash"),
    responseWindowSeconds: integer("response_window_seconds"),
    panelSize: integer("panel_size"),
    compensationMode: text("compensation_mode").notNull(),
    bountyPerSeatAtomic: numeric("bounty_per_seat_atomic", { precision: 78, scale: 0 }),
    feedbackBonusEnabled: boolean("feedback_bonus_enabled").notNull().default(false),
    feedbackBonusPoolAtomic: numeric("feedback_bonus_pool_atomic", { precision: 78, scale: 0 }),
    feedbackBonusAwarderKind: text("feedback_bonus_awarder_kind").notNull().default("requester"),
    feedbackBonusAwarderAccount: text("feedback_bonus_awarder_account"),
    feedbackBonusAwardWindowSeconds: integer("feedback_bonus_award_window_seconds"),
    configurationStatus: text("configuration_status").notNull().default("action_required"),
    profileHash: text("profile_hash").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { mode: "date", withTimezone: true }),
    supersededAt: timestamp("superseded_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    pk: primaryKey({ columns: [table.profileId, table.version] }),
    workspaceAgentIdx: index("tokenless_agent_review_request_profiles_workspace_agent_idx").on(
      table.workspaceId,
      table.agentId,
      table.agentVersionId,
      table.configurationStatus,
      table.createdAt,
    ),
    workspaceHashUnique: uniqueIndex("tokenless_agent_review_request_profiles_hash_unique").on(
      table.workspaceId,
      table.profileHash,
    ),
    workspaceUnique: uniqueIndex("tokenless_agent_review_request_profiles_workspace_unique").on(
      table.workspaceId,
      table.profileId,
      table.version,
    ),
  }),
);

export type TokenlessAgentReviewRequestProfile = typeof tokenlessAgentReviewRequestProfiles.$inferSelect;
export type NewTokenlessAgentReviewRequestProfile = typeof tokenlessAgentReviewRequestProfiles.$inferInsert;

export const tokenlessAgentReviewOpportunityQuestions = pgTable(
  "tokenless_agent_review_opportunity_questions",
  {
    workspaceId: text("workspace_id").notNull(),
    opportunityId: text("opportunity_id").notNull(),
    schemaVersion: text("schema_version").notNull(),
    questionAuthority: text("question_authority").notNull(),
    resultSemantics: text("result_semantics").notNull(),
    questionHash: text("question_hash").notNull(),
    contentBoundary: text("content_boundary").notNull(),
    questionJson: text("question_json"),
    questionCiphertext: text("question_ciphertext"),
    questionKeyRef: text("question_key_ref"),
    submittedByIntegrationId: text("submitted_by_integration_id").notNull(),
    submittedAt: timestamp("submitted_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.workspaceId, table.opportunityId] }),
    workspaceHashIdx: index("tokenless_agent_review_opportunity_questions_hash_idx").on(
      table.workspaceId,
      table.questionHash,
      table.submittedAt,
    ),
  }),
);

export type TokenlessAgentReviewOpportunityQuestion = typeof tokenlessAgentReviewOpportunityQuestions.$inferSelect;
export type NewTokenlessAgentReviewOpportunityQuestion = typeof tokenlessAgentReviewOpportunityQuestions.$inferInsert;

export const tokenlessAgentHumanReviewBindings = pgTable(
  "tokenless_agent_human_review_bindings",
  {
    bindingId: text("binding_id").notNull(),
    version: integer("version").notNull(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    agentVersionId: text("agent_version_id").notNull(),
    selectionPolicyId: text("selection_policy_id").notNull(),
    selectionPolicyVersion: integer("selection_policy_version").notNull(),
    requestProfileId: text("request_profile_id").notNull(),
    requestProfileVersion: integer("request_profile_version").notNull(),
    requestProfileHash: text("request_profile_hash").notNull(),
    publishingPolicyId: text("publishing_policy_id"),
    publishingPolicyVersion: integer("publishing_policy_version"),
    authority: text("authority").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    canonicalHash: text("canonical_hash").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { mode: "date", withTimezone: true }),
    supersededAt: timestamp("superseded_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    pk: primaryKey({ columns: [table.bindingId, table.version] }),
    activeAgentIdx: uniqueIndex("tokenless_agent_human_review_bindings_active_agent_idx")
      .on(table.workspaceId, table.agentId, table.agentVersionId)
      .where(sql`${table.enabled} = true AND ${table.supersededAt} IS NULL`),
    workspaceCreatedIdx: index("tokenless_agent_human_review_bindings_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    workspaceHashUnique: uniqueIndex("tokenless_agent_human_review_bindings_hash_unique").on(
      table.workspaceId,
      table.canonicalHash,
    ),
    workspaceUnique: uniqueIndex("tokenless_agent_human_review_bindings_workspace_unique").on(
      table.workspaceId,
      table.bindingId,
      table.version,
    ),
  }),
);

export const tokenlessAgentHumanReviewBindingEvents = pgTable(
  "tokenless_agent_human_review_binding_events",
  {
    eventId: text("event_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    bindingId: text("binding_id").notNull(),
    bindingVersion: integer("binding_version").notNull(),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull(),
    actorReference: text("actor_reference").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
    eventHash: text("event_hash").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    bindingCreatedIdx: index("tokenless_agent_human_review_binding_events_binding_created_idx").on(
      table.bindingId,
      table.createdAt,
    ),
    bindingFk: foreignKey({
      columns: [table.workspaceId, table.bindingId, table.bindingVersion],
      foreignColumns: [
        tokenlessAgentHumanReviewBindings.workspaceId,
        tokenlessAgentHumanReviewBindings.bindingId,
        tokenlessAgentHumanReviewBindings.version,
      ],
      name: "tokenless_agent_human_review_binding_events_binding_fk",
    }).onDelete("restrict"),
  }),
);

export type TokenlessAgentHumanReviewBinding = typeof tokenlessAgentHumanReviewBindings.$inferSelect;
export type NewTokenlessAgentHumanReviewBinding = typeof tokenlessAgentHumanReviewBindings.$inferInsert;
export type TokenlessAgentHumanReviewBindingEvent = typeof tokenlessAgentHumanReviewBindingEvents.$inferSelect;
export type NewTokenlessAgentHumanReviewBindingEvent = typeof tokenlessAgentHumanReviewBindingEvents.$inferInsert;

export const tokenlessAgentReviewOpportunityLifecycles = pgTable(
  "tokenless_agent_review_opportunity_lifecycles",
  {
    workspaceId: text("workspace_id").notNull(),
    opportunityId: text("opportunity_id").notNull(),
    state: text("state").notNull(),
    stateRevision: integer("state_revision").notNull().default(1),
    reasonCodesJson: text("reason_codes_json").notNull().default("[]"),
    stateEnteredAt: timestamp("state_entered_at", { mode: "date", withTimezone: true }).notNull(),
    terminalAt: timestamp("terminal_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.workspaceId, table.opportunityId] }),
    stateUpdatedIdx: index("tokenless_agent_review_opportunity_lifecycles_state_updated_idx")
      .on(table.workspaceId, table.state, table.updatedAt)
      .where(sql`${table.terminalAt} IS NULL`),
  }),
);

export const tokenlessAgentReviewApprovalRequests = pgTable(
  "tokenless_agent_review_approval_requests",
  {
    approvalId: text("approval_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    opportunityId: text("opportunity_id").notNull(),
    revision: integer("revision").notNull(),
    requestProfileId: text("request_profile_id").notNull(),
    requestProfileVersion: integer("request_profile_version").notNull(),
    requestProfileHash: text("request_profile_hash").notNull(),
    sourceEvidenceHash: text("source_evidence_hash").notNull(),
    suggestionCommitment: text("suggestion_commitment").notNull(),
    preparedRequestJson: text("prepared_request_json").notNull(),
    preparedRequestHash: text("prepared_request_hash").notNull(),
    derivedEconomicsJson: text("derived_economics_json").notNull(),
    derivedEconomicsHash: text("derived_economics_hash").notNull(),
    maximumChargeAtomic: numeric("maximum_charge_atomic", { precision: 78, scale: 0 }).notNull(),
    feedbackBonusMaximumAtomic: numeric("feedback_bonus_maximum_atomic", { precision: 78, scale: 0 })
      .notNull()
      .default("0"),
    maximumConsentAtomic: numeric("maximum_consent_atomic", { precision: 78, scale: 0 }).notNull().default("0"),
    status: text("status").notNull().default("pending"),
    ownerDecision: text("owner_decision"),
    preparedBy: text("prepared_by").notNull(),
    decidedBy: text("decided_by"),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { mode: "date", withTimezone: true }),
    invalidatedBy: text("invalidated_by"),
    invalidatedAt: timestamp("invalidated_at", { mode: "date", withTimezone: true }),
    expiredAt: timestamp("expired_at", { mode: "date", withTimezone: true }),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true }),
    consumptionReference: text("consumption_reference"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    actionableOpportunityIdx: uniqueIndex("tokenless_agent_review_approval_requests_actionable_opportunity_idx")
      .on(table.workspaceId, table.opportunityId)
      .where(sql`${table.status} IN ('pending', 'approved')`),
    consumptionUnique: uniqueIndex("tokenless_agent_review_approval_requests_consumption_unique").on(
      table.consumptionReference,
    ),
    opportunityRevisionUnique: uniqueIndex("tokenless_agent_review_approval_requests_opportunity_revision_unique").on(
      table.workspaceId,
      table.opportunityId,
      table.revision,
    ),
    preparedHashUnique: uniqueIndex("tokenless_agent_review_approval_requests_prepared_hash_unique").on(
      table.workspaceId,
      table.preparedRequestHash,
    ),
    profileFk: foreignKey({
      columns: [table.workspaceId, table.requestProfileId, table.requestProfileVersion, table.requestProfileHash],
      foreignColumns: [
        tokenlessAgentReviewRequestProfiles.workspaceId,
        tokenlessAgentReviewRequestProfiles.profileId,
        tokenlessAgentReviewRequestProfiles.version,
        tokenlessAgentReviewRequestProfiles.profileHash,
      ],
      name: "tokenless_agent_review_approval_requests_profile_fk",
    }).onDelete("restrict"),
    lifecycleFk: foreignKey({
      columns: [table.workspaceId, table.opportunityId],
      foreignColumns: [
        tokenlessAgentReviewOpportunityLifecycles.workspaceId,
        tokenlessAgentReviewOpportunityLifecycles.opportunityId,
      ],
      name: "tokenless_agent_review_approval_requests_lifecycle_fk",
    }).onDelete("restrict"),
    profileIdx: index("tokenless_agent_review_approval_requests_profile_idx").on(
      table.workspaceId,
      table.requestProfileId,
      table.requestProfileVersion,
      table.createdAt,
    ),
    statusExpiryIdx: index("tokenless_agent_review_approval_requests_status_expiry_idx")
      .on(table.workspaceId, table.status, table.expiresAt)
      .where(sql`${table.status} IN ('pending', 'approved')`),
  }),
);

export type TokenlessAgentReviewOpportunityLifecycle = typeof tokenlessAgentReviewOpportunityLifecycles.$inferSelect;
export type NewTokenlessAgentReviewOpportunityLifecycle = typeof tokenlessAgentReviewOpportunityLifecycles.$inferInsert;

export const tokenlessAgentReviewOpportunityTransitionEvents = pgTable(
  "tokenless_agent_review_opportunity_transition_events",
  {
    eventId: text("event_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    opportunityId: text("opportunity_id").notNull(),
    transitionKey: text("transition_key").notNull(),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    fromRevision: integer("from_revision").notNull(),
    toRevision: integer("to_revision").notNull(),
    reasonCodesJson: text("reason_codes_json").notNull(),
    actorKind: text("actor_kind").notNull(),
    actorReference: text("actor_reference").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
    transitionCommitment: text("transition_commitment").notNull(),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    lifecycleFk: foreignKey({
      columns: [table.workspaceId, table.opportunityId],
      foreignColumns: [
        tokenlessAgentReviewOpportunityLifecycles.workspaceId,
        tokenlessAgentReviewOpportunityLifecycles.opportunityId,
      ],
      name: "tokenless_agent_review_opportunity_transition_events_lifecycle_fk",
    }).onDelete("restrict"),
    keyUnique: uniqueIndex("tokenless_agent_review_opportunity_transition_events_key_unique").on(
      table.workspaceId,
      table.opportunityId,
      table.transitionKey,
    ),
    revisionUnique: uniqueIndex("tokenless_agent_review_opportunity_transition_events_revision_unique").on(
      table.workspaceId,
      table.opportunityId,
      table.toRevision,
    ),
    timelineIdx: index("tokenless_agent_review_opportunity_transition_events_timeline_idx").on(
      table.workspaceId,
      table.opportunityId,
      table.toRevision,
    ),
  }),
);

export type TokenlessAgentReviewOpportunityTransitionEvent =
  typeof tokenlessAgentReviewOpportunityTransitionEvents.$inferSelect;
export type NewTokenlessAgentReviewOpportunityTransitionEvent =
  typeof tokenlessAgentReviewOpportunityTransitionEvents.$inferInsert;

export const tokenlessAgentReviewOpportunityRecoveryStates = pgTable(
  "tokenless_agent_review_opportunity_recovery_states",
  {
    workspaceId: text("workspace_id").notNull(),
    opportunityId: text("opportunity_id").notNull(),
    status: text("status").notNull(),
    resumeState: text("resume_state"),
    failureCount: integer("failure_count").notNull().default(0),
    maximumFailures: integer("maximum_failures").notNull().default(3),
    lastSignal: text("last_signal").notNull(),
    lastErrorCode: text("last_error_code"),
    firstFailureAt: timestamp("first_failure_at", { mode: "date", withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { mode: "date", withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { mode: "date", withTimezone: true }),
    terminalState: text("terminal_state"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    lifecycleFk: foreignKey({
      columns: [table.workspaceId, table.opportunityId],
      foreignColumns: [
        tokenlessAgentReviewOpportunityLifecycles.workspaceId,
        tokenlessAgentReviewOpportunityLifecycles.opportunityId,
      ],
      name: "tokenless_agent_review_opportunity_recovery_states_lifecycle_fk",
    }).onDelete("restrict"),
    pk: primaryKey({
      columns: [table.workspaceId, table.opportunityId],
      name: "tokenless_agent_review_opportunity_recovery_states_pk",
    }),
    dueIdx: index("tokenless_agent_review_opportunity_recovery_states_due_idx")
      .on(table.status, table.nextRetryAt)
      .where(sql`${table.status} = 'recovery_required'`),
  }),
);

export const tokenlessAgentReviewOpportunityRecoveryEvents = pgTable(
  "tokenless_agent_review_opportunity_recovery_events",
  {
    eventId: text("event_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    opportunityId: text("opportunity_id").notNull(),
    transitionKey: text("transition_key").notNull(),
    requestCommitment: text("request_commitment").notNull(),
    signal: text("signal").notNull(),
    action: text("action").notNull(),
    fromState: text("from_state").notNull(),
    toState: text("to_state").notNull(),
    fromRevision: integer("from_revision").notNull(),
    toRevision: integer("to_revision").notNull(),
    failureCount: integer("failure_count").notNull(),
    acceptedWorkCount: integer("accepted_work_count").notNull(),
    committedWorkCount: integer("committed_work_count").notNull(),
    responseCount: integer("response_count").notNull(),
    reasonCodesJson: text("reason_codes_json").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    stateFk: foreignKey({
      columns: [table.workspaceId, table.opportunityId],
      foreignColumns: [
        tokenlessAgentReviewOpportunityRecoveryStates.workspaceId,
        tokenlessAgentReviewOpportunityRecoveryStates.opportunityId,
      ],
      name: "tokenless_agent_review_opportunity_recovery_events_state_fk",
    }).onDelete("restrict"),
    keyUnique: uniqueIndex("tokenless_agent_review_opportunity_recovery_events_key_unique").on(
      table.workspaceId,
      table.opportunityId,
      table.transitionKey,
    ),
    timelineIdx: index("tokenless_agent_review_opportunity_recovery_events_timeline_idx").on(
      table.workspaceId,
      table.opportunityId,
      table.occurredAt,
      table.eventId,
    ),
  }),
);

export type TokenlessAgentReviewOpportunityRecoveryState =
  typeof tokenlessAgentReviewOpportunityRecoveryStates.$inferSelect;
export type NewTokenlessAgentReviewOpportunityRecoveryState =
  typeof tokenlessAgentReviewOpportunityRecoveryStates.$inferInsert;
export type TokenlessAgentReviewOpportunityRecoveryEvent =
  typeof tokenlessAgentReviewOpportunityRecoveryEvents.$inferSelect;
export type NewTokenlessAgentReviewOpportunityRecoveryEvent =
  typeof tokenlessAgentReviewOpportunityRecoveryEvents.$inferInsert;

export const tokenlessAgentReviewContinuations = pgTable(
  "tokenless_agent_review_continuations",
  {
    continuationId: text("continuation_id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    workspaceId: text("workspace_id").notNull(),
    integrationId: text("integration_id").notNull(),
    opportunityId: text("opportunity_id").notNull(),
    lifecycleRevision: integer("lifecycle_revision").notNull(),
    allowedOperation: text("allowed_operation").notNull(),
    callerCredentialKind: text("caller_credential_kind").notNull(),
    callerCredentialId: text("caller_credential_id").notNull(),
    issuanceKeyHash: text("issuance_key_hash").notNull(),
    consumptionKeyHash: text("consumption_key_hash"),
    status: text("status").notNull().default("active"),
    predecessorContinuationId: text("predecessor_continuation_id"),
    successorContinuationId: text("successor_continuation_id"),
    retryAfterMs: integer("retry_after_ms").notNull(),
    issuedAt: timestamp("issued_at", { mode: "date", withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { mode: "date", withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { mode: "date", withTimezone: true }),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    expiredAt: timestamp("expired_at", { mode: "date", withTimezone: true }),
  },
  table => ({
    activeRevisionOperationUnique: uniqueIndex("tokenless_agent_review_continuations_active_revision_operation_unique")
      .on(table.workspaceId, table.integrationId, table.opportunityId, table.lifecycleRevision, table.allowedOperation)
      .where(sql`${table.status} = 'active'`),
    bindingIdx: index("tokenless_agent_review_continuations_binding_idx").on(
      table.workspaceId,
      table.integrationId,
      table.opportunityId,
      table.issuedAt,
    ),
    expiryIdx: index("tokenless_agent_review_continuations_expiry_idx")
      .on(table.status, table.expiresAt)
      .where(sql`${table.status} = 'active'`),
    lifecycleFk: foreignKey({
      columns: [table.workspaceId, table.opportunityId],
      foreignColumns: [
        tokenlessAgentReviewOpportunityLifecycles.workspaceId,
        tokenlessAgentReviewOpportunityLifecycles.opportunityId,
      ],
      name: "tokenless_agent_review_continuations_lifecycle_fk",
    }).onDelete("restrict"),
    tokenHashUnique: uniqueIndex("tokenless_agent_review_continuations_token_hash_unique").on(table.tokenHash),
  }),
);

export const tokenlessAgentReviewContinuationEvents = pgTable(
  "tokenless_agent_review_continuation_events",
  {
    eventId: text("event_id").primaryKey(),
    continuationId: text("continuation_id").notNull(),
    workspaceId: text("workspace_id").notNull(),
    integrationId: text("integration_id").notNull(),
    opportunityId: text("opportunity_id").notNull(),
    lifecycleRevision: integer("lifecycle_revision").notNull(),
    eventType: text("event_type").notNull(),
    allowedOperation: text("allowed_operation").notNull(),
    actorCredentialKind: text("actor_credential_kind").notNull(),
    actorCredentialCommitment: text("actor_credential_commitment").notNull(),
    relatedContinuationId: text("related_continuation_id"),
    reasonCode: text("reason_code").notNull(),
    eventCommitment: text("event_commitment").notNull(),
    occurredAt: timestamp("occurred_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    lifecycleFk: foreignKey({
      columns: [table.workspaceId, table.opportunityId],
      foreignColumns: [
        tokenlessAgentReviewOpportunityLifecycles.workspaceId,
        tokenlessAgentReviewOpportunityLifecycles.opportunityId,
      ],
      name: "tokenless_agent_review_continuation_events_lifecycle_fk",
    }).onDelete("restrict"),
    timelineIdx: index("tokenless_agent_review_continuation_events_timeline_idx").on(
      table.workspaceId,
      table.opportunityId,
      table.occurredAt,
      table.eventId,
    ),
  }),
);

export type TokenlessAgentReviewContinuation = typeof tokenlessAgentReviewContinuations.$inferSelect;
export type NewTokenlessAgentReviewContinuation = typeof tokenlessAgentReviewContinuations.$inferInsert;
export type TokenlessAgentReviewContinuationEvent = typeof tokenlessAgentReviewContinuationEvents.$inferSelect;
export type NewTokenlessAgentReviewContinuationEvent = typeof tokenlessAgentReviewContinuationEvents.$inferInsert;
export type TokenlessAgentReviewApprovalRequest = typeof tokenlessAgentReviewApprovalRequests.$inferSelect;
export type NewTokenlessAgentReviewApprovalRequest = typeof tokenlessAgentReviewApprovalRequests.$inferInsert;

export const tokenlessAgentExecutions = pgTable(
  "tokenless_agent_executions",
  {
    executionId: text("execution_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    agentId: text("agent_id").notNull(),
    agentVersionId: text("agent_version_id").notNull(),
    integrationId: text("integration_id"),
    externalExecutionId: text("external_execution_id").notNull(),
    status: text("status").notNull(),
    metadataSource: text("metadata_source").notNull().default("host_reported"),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    totalDurationMs: integer("total_duration_ms"),
    toolCallCount: integer("tool_call_count"),
    toolDurationMs: integer("tool_duration_ms"),
    modelCallCount: integer("model_call_count").notNull(),
    inputTokenTotal: integer("input_token_total"),
    cachedInputTokenTotal: integer("cached_input_token_total"),
    outputTokenTotal: integer("output_token_total"),
    reasoningOutputTokenTotal: integer("reasoning_output_token_total"),
    primarySpanId: text("primary_span_id").notNull(),
    manifestCommitment: text("manifest_commitment").notNull(),
    executionProfileHash: text("execution_profile_hash").notNull(),
    executionProfileJson: text("execution_profile_json").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    externalUnique: uniqueIndex("tokenless_agent_executions_external_unique").on(
      table.workspaceId,
      table.agentId,
      table.externalExecutionId,
    ),
    profileIdx: index("tokenless_agent_executions_profile_idx").on(
      table.workspaceId,
      table.executionProfileHash,
      table.createdAt,
    ),
    workspaceAgentCreatedIdx: index("tokenless_agent_executions_workspace_agent_created_idx").on(
      table.workspaceId,
      table.agentId,
      table.agentVersionId,
      table.createdAt,
    ),
  }),
);

export const tokenlessAgentGenerationSpans = pgTable(
  "tokenless_agent_generation_spans",
  {
    executionId: text("execution_id")
      .notNull()
      .references(() => tokenlessAgentExecutions.executionId, { onDelete: "cascade" }),
    spanId: text("span_id").notNull(),
    parentSpanId: text("parent_span_id"),
    role: text("role").notNull(),
    provider: text("provider").notNull(),
    requestedModel: text("requested_model").notNull(),
    resolvedModel: text("resolved_model"),
    modelVersion: text("model_version"),
    reasoningEffort: text("reasoning_effort"),
    serviceTier: text("service_tier"),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    durationMs: integer("duration_ms"),
    timeToFirstOutputMs: integer("time_to_first_output_ms"),
    inputTokens: integer("input_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    outputTokens: integer("output_tokens"),
    reasoningOutputTokens: integer("reasoning_output_tokens"),
    responseIdHash: text("response_id_hash"),
    finishReason: text("finish_reason"),
    metadataSource: text("metadata_source").notNull().default("host_reported"),
  },
  table => ({
    executionRoleIdx: index("tokenless_agent_generation_spans_execution_role_idx").on(
      table.executionId,
      table.role,
      table.spanId,
    ),
    parentFk: foreignKey({
      columns: [table.executionId, table.parentSpanId],
      foreignColumns: [table.executionId, table.spanId],
      name: "tokenless_agent_generation_spans_parent_fk",
    }).onDelete("restrict"),
    pk: primaryKey({ columns: [table.executionId, table.spanId] }),
  }),
);

export type TokenlessAgentExecution = typeof tokenlessAgentExecutions.$inferSelect;
export type NewTokenlessAgentExecution = typeof tokenlessAgentExecutions.$inferInsert;
export type TokenlessAgentGenerationSpan = typeof tokenlessAgentGenerationSpans.$inferSelect;
export type NewTokenlessAgentGenerationSpan = typeof tokenlessAgentGenerationSpans.$inferInsert;
