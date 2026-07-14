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
    accountAddress: text("account_address").notNull(),
    authProvider: text("auth_provider").notNull().default("base_account"),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    accountAddressIdx: index("tokenless_auth_sessions_account_address_idx").on(table.accountAddress),
    expiresAtIdx: index("tokenless_auth_sessions_expires_at_idx").on(table.expiresAt),
  }),
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
    readAt: timestamp("read_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    principalCreatedIdx: index("tokenless_notifications_principal_created_idx").on(
      table.principalAddress,
      table.createdAt,
    ),
  }),
);

export type TokenlessNotification = typeof tokenlessNotifications.$inferSelect;
