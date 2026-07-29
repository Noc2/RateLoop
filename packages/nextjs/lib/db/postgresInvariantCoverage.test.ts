import { runPostgresInvariantTests } from "../../scripts/test-postgres-invariants.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const memoryHarness = readFileSync(new URL("./testing/testMemory.ts", import.meta.url), "utf8");
const harnessGuide = readFileSync(new URL("./testing/README.md", import.meta.url), "utf8");
const invariantScript = readFileSync(new URL("../../scripts/test-postgres-invariants.mjs", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};
const workflow = readFileSync(new URL("../../../../.github/workflows/unit-tests.yaml", import.meta.url), "utf8");

test("memory harness warns test authors that rollback and database constraints need PostgreSQL", () => {
  for (const source of [memoryHarness, harnessGuide]) {
    assert.match(source, /transaction\(\).*passthrough|calls the callback directly/su);
    assert.match(source, /ROLLBACK/u);
    assert.match(source, /CHECK/u);
    assert.match(source, /partial unique/u);
    assert.match(source, /test-postgres-invariants\.mjs/u);
  }
});

test("the focused PostgreSQL suite covers refund rollback, CHECK, and partial uniqueness boundaries", () => {
  assert.match(invariantScript, /tokenless_prepaid_ledger_entries/u);
  assert.match(invariantScript, /stripe_reversal:unique_probe/u);
  assert.match(invariantScript, /ROLLBACK TO SAVEPOINT rollback_probe/u);
  assert.match(invariantScript, /tokenless_project_access_assignments/u);
  assert.match(invariantScript, /tokenless_evm_signing_ledger_terminal_unique|terminal_uniqueness_probe/u);
  assert.match(invariantScript, /"23505"/u);
  assert.match(invariantScript, /"23514"/u);
  assert.equal(packageJson.scripts["test:postgres-invariants"], "node scripts/test-postgres-invariants.mjs");
});

test("the existing migrated MCP Postgres job runs invariants before starting the server", () => {
  const jobStart = workflow.indexOf("mcp-conformance:");
  const migrate = workflow.indexOf("Migrate the isolated MCP database", jobStart);
  const invariants = workflow.indexOf("Verify PostgreSQL rollback and uniqueness invariants", jobStart);
  const server = workflow.indexOf("Start the public MCP server", jobStart);
  assert.ok(jobStart >= 0);
  assert.ok(migrate > jobStart);
  assert.ok(invariants > migrate);
  assert.ok(server > invariants);
  assert.equal(workflow.match(/test:postgres-invariants/gu)?.length, 1);
});

test("the real-Postgres suite refuses memory and remote databases", async () => {
  await assert.rejects(() => runPostgresInvariantTests("memory:"), /migrated local PostgreSQL test database/u);
  await assert.rejects(
    () => runPostgresInvariantTests("postgresql://user:secret@db.example/rateloop_ci_bad"),
    /refuse non-local database hosts/u,
  );
});
