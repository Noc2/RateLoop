import assert from "node:assert/strict";
import test from "node:test";
import { hasRewardPoolFundedPostcondition } from "~~/lib/rewardPool/postconditions";

const addresses = {
  escrow: "0x0000000000000000000000000000000000000002",
  funder: "0x0000000000000000000000000000000000000003",
} as const;

function makeClient(
  getContractEvents: (request: {
    args?: { contentId?: bigint; funder?: string };
    eventName?: string;
    fromBlock?: bigint;
  }) => unknown,
) {
  return {
    getContractEvents: async (request: unknown) =>
      getContractEvents(
        request as {
          args?: { contentId?: bigint; funder?: string };
          eventName?: string;
          fromBlock?: bigint;
        },
      ),
  } as any;
}

test("reward pool funded postcondition matches RewardPoolCreated event", async () => {
  const client = makeClient(request => {
    assert.equal(request.eventName, "RewardPoolCreated");
    assert.deepEqual(request.args, { contentId: 7n, funder: addresses.funder });
    assert.equal(request.fromBlock, 100n);
    return [{ args: { amount: 5_000_000n, contentId: 7n, funder: addresses.funder, rewardPoolId: 11n } }];
  });

  const satisfied = await hasRewardPoolFundedPostcondition({
    amount: 5_000_000n,
    client,
    contentId: 7n,
    escrowAddress: addresses.escrow,
    funder: addresses.funder,
    startBlock: 100n,
  });

  assert.equal(satisfied, true);
});

test("reward pool funded postcondition rejects mismatched amounts", async () => {
  const client = makeClient(() => [
    { args: { amount: 4_000_000n, contentId: 7n, funder: addresses.funder, rewardPoolId: 11n } },
  ]);

  const satisfied = await hasRewardPoolFundedPostcondition({
    amount: 5_000_000n,
    client,
    contentId: 7n,
    escrowAddress: addresses.escrow,
    funder: addresses.funder,
    startBlock: 100n,
  });

  assert.equal(satisfied, false);
});

test("reward pool funded postcondition requires a matching event", async () => {
  const client = makeClient(() => []);

  const satisfied = await hasRewardPoolFundedPostcondition({
    amount: 5_000_000n,
    client,
    contentId: 7n,
    escrowAddress: addresses.escrow,
    funder: addresses.funder,
    startBlock: 100n,
  });

  assert.equal(satisfied, false);
});
