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

test("buildRoundVoteTransactionPlan uses permit-backed commit when allowance is low and permit is supplied", () => {
  const permitSignature = {
    deadline: 1234n,
    r: `0x${"1".repeat(64)}` as const,
    s: `0x${"2".repeat(64)}` as const,
    v: 27,
  };
  const plan = buildRoundVoteTransactionPlan({
    ...baseParams,
    currentAllowance: 1n,
    permitSignature,
    stakeWei: 10n,
  });

  assert.equal(plan.isAdvisoryVote, false);
  assert.equal(plan.needsApproval, true);
  assert.equal(plan.calls.length, 1);
  assert.equal(plan.calls[0].kind, "commitVoteWithPermit");
  assert.equal(plan.calls[0].functionName, "commitVoteWithPermit");
  assert.deepEqual(plan.calls[0].args, [
    ...plan.commitVoteArgs,
    permitSignature.deadline,
    permitSignature.v,
    permitSignature.r,
    permitSignature.s,
  ]);
  assert.equal(plan.calls[0].data, undefined);
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

test("buildRoundVoteTransactionPlan prepends openRound when includeOpenRound is true", () => {
  const plan = buildRoundVoteTransactionPlan({
    ...baseParams,
    currentAllowance: 10n,
    includeOpenRound: true,
    stakeWei: 10n,
  });

  assert.equal(plan.calls.length, 2);
  assert.equal(plan.calls[0].kind, "openRound");
  assert.equal(plan.calls[0].functionName, "openRound");
  assert.deepEqual(plan.calls[0].args, [baseParams.contentId]);
  assert.equal(plan.calls[1].kind, "commitVote");
});

test("buildRoundVoteTransactionPlan prepends openRound before approve and commit when allowance is low", () => {
  const plan = buildRoundVoteTransactionPlan({
    ...baseParams,
    currentAllowance: 1n,
    includeOpenRound: true,
    stakeWei: 10n,
  });

  assert.equal(plan.calls.length, 3);
  assert.equal(plan.calls[0].kind, "openRound");
  assert.equal(plan.calls[1].kind, "approve");
  assert.equal(plan.calls[2].kind, "commitVote");
});

test("buildRoundVoteTransactionPlan prepends openRound before commitVoteWithPermit when permit is supplied", () => {
  const permitSignature = {
    deadline: 1234n,
    r: `0x${"1".repeat(64)}` as const,
    s: `0x${"2".repeat(64)}` as const,
    v: 27,
  };
  const plan = buildRoundVoteTransactionPlan({
    ...baseParams,
    currentAllowance: 1n,
    includeOpenRound: true,
    permitSignature,
    stakeWei: 10n,
  });

  assert.equal(plan.calls.length, 2);
  assert.equal(plan.calls[0].kind, "openRound");
  assert.equal(plan.calls[1].kind, "commitVoteWithPermit");
});

test("buildRoundVoteTransactionPlan ignores permit when allowance already covers the stake", () => {
  const permitSignature = {
    deadline: 1234n,
    r: `0x${"1".repeat(64)}` as const,
    s: `0x${"2".repeat(64)}` as const,
    v: 27,
  };
  const plan = buildRoundVoteTransactionPlan({
    ...baseParams,
    currentAllowance: 10n,
    permitSignature,
    stakeWei: 10n,
  });

  assert.equal(plan.needsApproval, false);
  assert.equal(plan.calls.length, 1);
  assert.equal(plan.calls[0].kind, "commitVote");
  assert.equal(plan.calls[0].functionName, "commitVote");
});
