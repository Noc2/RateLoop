import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const POOL_CONSUMERS = [
  "packages/keeper/src/signing-ledger.ts",
  "packages/nextjs/e2e/scripts/prepare.ts",
  "packages/nextjs/lib/db/index.ts",
  "packages/nextjs/scripts/migrate-hosted-database.mjs",
  "packages/nextjs/scripts/test-postgres-invariants.mjs",
];

test("every direct Postgres pool acquisition has a bounded connection timeout", async () => {
  for (const relativePath of POOL_CONSUMERS) {
    const source = await readFile(resolve(REPOSITORY_ROOT, relativePath), "utf8");
    assert.equal([...source.matchAll(/new Pool\(/gu)].length, 1, `${relativePath} Pool inventory changed`);
    assert.match(
      source,
      /connectionTimeoutMillis\s*:\s*(?:10_000|[A-Z_]*POSTGRES_CONNECTION_TIMEOUT_MS)/u,
      relativePath,
    );
  }
});

// `connectionTimeoutMillis` bounds acquiring a connection, not running a
// statement on it. The request-serving pool is the one that must also cap
// execution: without `statement_timeout` a single slow query parks a pooled
// connection indefinitely, and if that query sits inside a transaction holding
// an advisory lock it parks the lock too.
test("the request-serving pool caps statement and idle-in-transaction time", async () => {
  const source = await readFile(resolve(REPOSITORY_ROOT, "packages/nextjs/lib/db/index.ts"), "utf8");
  assert.match(source, /statement_timeout\s*:\s*POSTGRES_STATEMENT_TIMEOUT_MS/u);
  assert.match(source, /idle_in_transaction_session_timeout\s*:\s*POSTGRES_IDLE_IN_TRANSACTION_TIMEOUT_MS/u);
  assert.match(source, /export const POSTGRES_STATEMENT_TIMEOUT_MS = 30_000;/u);
  assert.match(source, /export const POSTGRES_IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;/u);
});
