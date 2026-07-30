import { serializePoolClientQueries } from "./index";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PoolClient } from "pg";
import { verifySecurityAuditChain } from "~~/lib/privacy/audit";
import { processDueEvidenceRetentionEnforcement } from "~~/lib/tokenless/evidenceRetentionEnforcement";

test("serializePoolClientQueries runs overlapping calls in order and continues after a failure", async () => {
  let active = 0;
  let maximumActive = 0;
  const started: string[] = [];
  const rawClient = {
    async query(label: string) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      started.push(label);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      if (label === "fail") throw new Error("expected failure");
      return { command: "SELECT", fields: [], oid: 0, rowCount: 1, rows: [{ label }] };
    },
    release() {},
  } as unknown as PoolClient;
  const client = serializePoolClientQueries(rawClient);

  const results = await Promise.allSettled([
    client.query("first"),
    client.query("fail"),
    client.query("after-failure"),
  ]);

  assert.equal(maximumActive, 1);
  assert.deepEqual(started, ["first", "fail", "after-failure"]);
  assert.deepEqual(
    results.map(result => result.status),
    ["fulfilled", "rejected", "fulfilled"],
  );
});

test("optional and generic transaction consumers share the serialized client invariant", () => {
  assert.equal(typeof verifySecurityAuditChain, "function");
  assert.equal(typeof processDueEvidenceRetentionEnforcement, "function");

  const packageRoot = new URL("../../", import.meta.url);
  const consumers = ["lib/privacy/audit.ts", "lib/tokenless/evidenceRetentionEnforcement.ts"];
  for (const relativePath of consumers) {
    const source = readFileSync(new URL(relativePath, packageRoot), "utf8");
    assert.match(source, /serializePoolClientQueries/u);
  }
  assert.doesNotMatch(
    readFileSync(new URL("lib/privacy/audit.ts", packageRoot), "utf8"),
    /transactionClient\.query[\s\S]{0,120}transactionClient\.query/u,
  );
});
