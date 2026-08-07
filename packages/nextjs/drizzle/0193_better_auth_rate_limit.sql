-- Better Auth's rate limiter defaults to in-memory storage, which on Vercel means
-- one counter per lambda instance: the effective limit multiplies by however many
-- instances are warm. Its default rules are real (sign-in 3 per 10s, email code 3
-- per 60s) and this table is what makes them hold across the fleet.
--
-- The shape is fixed by @better-auth/core get-tables.mjs: key unique, count, and
-- lastRequest as an epoch milliseconds bigint. The adapter upserts by key and
-- increments count, so the unique index is load-bearing rather than decorative.
CREATE TABLE IF NOT EXISTS "tokenless_better_auth_rate_limits" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL,
  "count" integer NOT NULL,
  "last_request" bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "tokenless_better_auth_rate_limits_key_idx"
  ON "tokenless_better_auth_rate_limits" ("key");
