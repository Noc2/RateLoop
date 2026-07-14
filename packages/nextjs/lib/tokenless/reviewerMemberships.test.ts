import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { listReviewerMemberships } from "~~/lib/tokenless/audienceAssignments";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("reviewer membership reads are account-scoped and safe when empty", async () => {
  const result = await listReviewerMemberships({
    accountAddress: "0x1111111111111111111111111111111111111111",
  });
  assert.deepEqual(result, { memberships: [], invitations: [] });
});
