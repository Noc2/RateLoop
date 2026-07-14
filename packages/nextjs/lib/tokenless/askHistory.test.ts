import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { listAccountAskHistory } from "~~/lib/tokenless/askHistory";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("ask history is empty without an ownership row", async () => {
  assert.deepEqual(await listAccountAskHistory({ accountAddress: "0x1111111111111111111111111111111111111111" }), []);
});
