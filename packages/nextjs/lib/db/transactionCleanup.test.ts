import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";
import type { PoolClient } from "pg";
import { DatabaseRollbackError, releasePoolClient, rollbackAndReleasePoolClient } from "~~/lib/db/transactionCleanup";
import { createWorkspaceMcpSession } from "~~/lib/mcp/workspaceElicitation";
import { exportAdaptiveCoverage } from "~~/lib/tokenless/adaptiveCoverageExport";
import { processDueAssuranceWormExports } from "~~/lib/tokenless/assuranceWormExports";
import { persistInitialEvmTransaction } from "~~/lib/tokenless/chain/evmTransactionReplacement";
import { reconcileChainPayment } from "~~/lib/tokenless/chain/payments";
import { engageWorkspaceStop } from "~~/lib/tokenless/workspaceStopControl";

function transactionClient(rollback: "succeeds" | "fails") {
  const releases: (Error | undefined)[] = [];
  const client = {
    async query(sql: string) {
      assert.equal(sql, "ROLLBACK");
      if (rollback === "fails") throw new Error("rollback transport failed");
      return { rows: [] };
    },
    release(error?: Error) {
      releases.push(error);
    },
  } as unknown as PoolClient;
  return { client, releases };
}

test("successful rollback releases once and preserves the operation failure", async () => {
  const operationError = new Error("operation failed");
  const value = transactionClient("succeeds");
  await assert.rejects(rollbackAndReleasePoolClient(value.client, operationError), operationError);
  releasePoolClient(value.client);
  assert.deepEqual(value.releases, [undefined]);
});

test("failed rollback destroys once and reports both failures", async () => {
  const operationError = new Error("operation failed");
  const value = transactionClient("fails");
  await assert.rejects(
    rollbackAndReleasePoolClient(value.client, operationError),
    (error: unknown) =>
      error instanceof DatabaseRollbackError &&
      error.operationError === operationError &&
      error.cause instanceof Error &&
      error.cause.message === "rollback transport failed",
  );
  releasePoolClient(value.client);
  assert.equal(value.releases.length, 1);
  assert.equal(value.releases[0]?.message, "rollback transport failed");
});

test("every swallowed rollback consumer shares the destructive cleanup boundary", () => {
  const consumers = [
    createWorkspaceMcpSession,
    engageWorkspaceStop,
    processDueAssuranceWormExports,
    exportAdaptiveCoverage,
    persistInitialEvmTransaction,
    reconcileChainPayment,
  ];
  assert.ok(consumers.every(consumer => typeof consumer === "function"));

  const packageRoot = new URL("../../", import.meta.url);
  const productionFiles = sourceFiles(packageRoot);
  const swallowedRollbacks = productionFiles
    .filter(path => /query\("ROLLBACK"\)\.catch/u.test(readFileSync(path, "utf8")))
    .map(path => path.split("/packages/nextjs/")[1])
    .sort();
  assert.deepEqual(swallowedRollbacks, []);

  const expectedConsumers = [
    "lib/mcp/workspaceElicitation.ts",
    "lib/tokenless/adaptiveCoverageExport.ts",
    "lib/tokenless/assuranceWormExports.ts",
    "lib/tokenless/chain/evmTransactionReplacement.ts",
    "lib/tokenless/chain/payments.ts",
    "lib/tokenless/workspaceStopControl.ts",
  ];
  for (const relativePath of expectedConsumers) {
    const source = readFileSync(new URL(relativePath, packageRoot), "utf8");
    assert.match(source, /from "~~\/lib\/db\/transactionCleanup"/u);
    assert.match(source, /\brollbackAndReleasePoolClient\b/u);
    assert.match(source, /\breleasePoolClient\b/u);
  }
});

function sourceFiles(rootUrl: URL): string[] {
  const root = rootUrl.pathname;
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if ([".next", "dist", "node_modules", "out"].includes(entry.name)) return [];
      return sourceFiles(new URL(`${entry.name}/`, rootUrl));
    }
    if (![".js", ".mjs", ".ts", ".tsx"].includes(extname(entry.name))) return [];
    if (/\.(?:interaction|property|test)\.[cm]?[jt]sx?$/u.test(entry.name)) return [];
    return [path];
  });
}
