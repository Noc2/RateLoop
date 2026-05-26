import assert from "node:assert/strict";
import test from "node:test";
import { buildRoundVoteTransactionPlan } from "~~/lib/vote/roundVoteTransactionPlan";

const addresses = {
  advisoryVoteRecorder: "0x0000000000000000000000000000000000000003",
  frontend: "0x0000000000000000000000000000000000000004",
  lrep: "0x0000000000000000000000000000000000000001",
  votingEngine: "0x0000000000000000000000000000000000000002",
} as const;

const baseParams = {
  advisoryVoteRecorderAddress: addresses.advisoryVoteRecorder,
  ciphertext: "0x1234",
  commitHash: "0x00000000000000000000000000000000000000000000000000000000000000aa",
  contentId: 42n,
  currentAllowance: 0n,
  drandChainHash: "0x00000000000000000000000000000000000000000000000000000000000000bb",
  frontend: addresses.frontend,
  lrepAddress: addresses.lrep,
  roundContext: 65536n,
  targetRound: 100n,
  votingEngineAddress: addresses.votingEngine,
} as const;

test("buildRoundVoteTransactionPlan builds a single advisory recorder call for zero stake", () => {
  const plan = buildRoundVoteTransactionPlan({
    ...baseParams,
    stakeWei: 0n,
  });

  assert.equal(plan.isAdvisoryVote, true);
  assert.equal(plan.needsApproval, false);
  assert.equal(plan.calls.length, 1);
  assert.equal(plan.calls[0].kind, "recordAdvisoryVote");
  assert.equal(plan.calls[0].functionName, "recordAdvisoryVote");
  assert.deepEqual(plan.calls[0].args, plan.advisoryVoteArgs);
});

test("buildRoundVoteTransactionPlan requires the advisory recorder address for zero stake", () => {
  assert.throws(
    () =>
      buildRoundVoteTransactionPlan({
        ...baseParams,
        advisoryVoteRecorderAddress: undefined,
        stakeWei: 0n,
      }),
    /Zero-stake advisory voting is unavailable/,
  );
});

test("buildRoundVoteTransactionPlan batches approval before commit when allowance is low", () => {
  const plan = buildRoundVoteTransactionPlan({
    ...baseParams,
    currentAllowance: 1n,
    stakeWei: 10n,
  });

  assert.equal(plan.isAdvisoryVote, false);
  assert.equal(plan.needsApproval, true);
  assert.equal(plan.calls.length, 2);
  assert.equal(plan.calls[0].kind, "approve");
  assert.deepEqual(plan.calls[0].args, [addresses.votingEngine, 10n]);
  assert.equal(plan.calls[1].kind, "commitVote");
  assert.deepEqual(plan.calls[1].args, plan.commitVoteArgs);
});

test("buildRoundVoteTransactionPlan skips approval when allowance covers the stake", () => {
  const plan = buildRoundVoteTransactionPlan({
    ...baseParams,
    currentAllowance: 10n,
    stakeWei: 10n,
  });

  assert.equal(plan.needsApproval, false);
  assert.equal(plan.calls.length, 1);
  assert.equal(plan.calls[0].kind, "commitVote");
});
