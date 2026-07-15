import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
    sandbox: boolean("sandbox").notNull().default(false),
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
  },
  table => ({ userIdx: index("tokenless_better_auth_sessions_user_idx").on(table.userId, table.expiresAt) }),
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
export type TokenlessAgentConnectionIntent = typeof tokenlessAgentConnectionIntents.$inferSelect;
export type TokenlessAgentConnectionIntentEvent = typeof tokenlessAgentConnectionIntentEvents.$inferSelect;
