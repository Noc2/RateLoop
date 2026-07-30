import { serializePoolClientQueries } from "./index";
import assert from "node:assert/strict";
import test from "node:test";
import type { PoolClient } from "pg";

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
