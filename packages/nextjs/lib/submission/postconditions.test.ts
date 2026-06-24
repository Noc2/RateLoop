import assert from "node:assert/strict";
import test from "node:test";
import { hasQuestionSubmittedPostcondition } from "~~/lib/submission/postconditions";

const contentRegistryAddress = "0x0000000000000000000000000000000000000001" as const;

function makeClient(nextContentId: unknown) {
  return {
    readContract: async (request: unknown) => {
      assert.equal((request as { functionName?: string }).functionName, "nextContentId");
      return nextContentId;
    },
  } as any;
}

test("question submitted postcondition requires nextContentId >= expected", async () => {
  const satisfied = await hasQuestionSubmittedPostcondition({
    client: makeClient(42n),
    contentRegistryAddress,
    expectedNextContentId: 42n,
  });
  assert.equal(satisfied, true);

  const notYetSubmitted = await hasQuestionSubmittedPostcondition({
    client: makeClient(41n),
    contentRegistryAddress,
    expectedNextContentId: 42n,
  });
  assert.equal(notYetSubmitted, false);
});

test("question submitted postcondition accepts a higher nextContentId", async () => {
  const satisfied = await hasQuestionSubmittedPostcondition({
    client: makeClient(45n),
    contentRegistryAddress,
    expectedNextContentId: 42n,
  });
  assert.equal(satisfied, true);
});
