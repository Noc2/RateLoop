import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { listReviewerAssignments } from "~~/lib/tokenless/reviewerAssignments";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("assignment search is account-bound and returns no private rows for an empty account", async () => {
  assert.deepEqual(
    await listReviewerAssignments({
      accountAddress: "0x1111111111111111111111111111111111111111",
      query: "client secret",
    }),
    [],
  );
});

test("assignment search accepts an opaque Better Auth principal", async () => {
  assert.deepEqual(
    await listReviewerAssignments({
      accountAddress: "rlp_reviewer_assignments_test_0001",
    }),
    [],
  );
});
