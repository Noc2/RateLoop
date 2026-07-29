import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../drizzle/0161_scheduled_processor_health.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ breakpoints: boolean; idx: number; tag: string; version: string; when: number }>;
};

test("0161 distinguishes processor configuration from execution failure without using throughput", () => {
  assert.match(migration, /tokenless_scheduled_processor_health/u);
  assert.match(migration, /"configuration_state" IN \('enabled','disabled','broken'\)/u);
  assert.match(migration, /"operator_alert_state" IN \('pending','resolved'\)/u);
  assert.match(migration, /"last_error_digest".*'\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /"configuration_state" = 'disabled'[\s\S]*"disabled_reason" IS NOT NULL/u);
  assert.match(migration, /"configuration_state" = 'broken'[\s\S]*"operator_alert_state" = 'pending'/u);
  assert.doesNotMatch(migration, /throughput|produced|processed_count/u);
  assert.deepEqual(journal.entries.at(-1), {
    idx: 161,
    version: "7",
    when: 1785229200000,
    tag: "0161_scheduled_processor_health",
    breakpoints: true,
  });
});
