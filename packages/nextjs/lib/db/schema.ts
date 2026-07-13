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
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true }).notNull(),
  },
  table => ({
    accountAddressIdx: index("tokenless_auth_sessions_account_address_idx").on(table.accountAddress),
    expiresAtIdx: index("tokenless_auth_sessions_expires_at_idx").on(table.expiresAt),
  }),
);
