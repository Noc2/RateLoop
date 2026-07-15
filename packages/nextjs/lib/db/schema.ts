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
