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
