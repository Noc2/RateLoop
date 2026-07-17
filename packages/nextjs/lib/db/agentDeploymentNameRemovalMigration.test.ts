import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const migration = readFileSync(new URL("../../drizzle/0097_remove_agent_deployment_name.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ tag: string }>;
};

describe("agent deployment name removal migration", () => {
  test("drops deployment-name storage from pairings and immutable agent versions", () => {
    assert.match(migration, /ALTER TABLE "tokenless_agent_pairing_sessions"\s+DROP COLUMN "declared_deployment_name"/u);
    assert.match(migration, /ALTER TABLE "tokenless_agent_versions"\s+DROP COLUMN "declared_deployment_name"/u);
  });

  test("is present in the ordered migration journal", () => {
    assert.equal(journal.entries.at(-1)?.tag, "0097_remove_agent_deployment_name");
  });
});
