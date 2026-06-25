import assert from "node:assert/strict";
import test from "node:test";
import { hasRoundOpenPostcondition, hasRoundVoteCommitPostcondition } from "~~/lib/vote/roundVotePostconditions";

const addresses = {
  advisoryVoteRecorder: "0x0000000000000000000000000000000000000003",
  voter: "0x0000000000000000000000000000000000000004",
  votingEngine: "0x0000000000000000000000000000000000000002",
} as const;

const commitHash = "0x00000000000000000000000000000000000000000000000000000000000000aa" as const;
const advisoryCommitKey = "0x00000000000000000000000000000000000000000000000000000000000000bb" as const;

function makeClient(readContract: (request: { functionName?: string }) => unknown, timestamp = 1_000n) {
  return {
    getBlock: async () => ({ timestamp }),
    readContract: async (request: unknown) => readContract(request as { functionName?: string }),
  } as any;
}

test("staked vote postcondition matches voterCommitKey commit hash", async () => {
  const client = makeClient(request => {
    assert.equal(request.functionName, "voterCommitKey");
    return [commitHash, "0x1234"];
  });

  const satisfied = await hasRoundVoteCommitPostcondition({
    client,
    commitHash,
    contentId: 1n,
    isAdvisoryVote: false,
    roundId: 2n,
    voter: addresses.voter,
    votingEngineAddress: addresses.votingEngine,
  });

  assert.equal(satisfied, true);
});

test("advisory vote postcondition matches the recorder commit hash", async () => {
  const client = makeClient(request => {
    if (request.functionName === "advisoryCommitKeyByRater") {
      return advisoryCommitKey;
    }
    if (request.functionName === "advisoryCommitCore") {
      return [addresses.voter, 1n, 2n, commitHash];
    }
    throw new Error(`Unexpected function ${request.functionName}`);
  });

  const satisfied = await hasRoundVoteCommitPostcondition({
    advisoryVoteRecorderAddress: addresses.advisoryVoteRecorder,
    client,
    commitHash,
    contentId: 1n,
    isAdvisoryVote: true,
    roundId: 2n,
    voter: addresses.voter,
    votingEngineAddress: addresses.votingEngine,
  });

  assert.equal(satisfied, true);
});

test("advisory vote postcondition is false before a key exists", async () => {
  const client = makeClient(request => {
    assert.equal(request.functionName, "advisoryCommitKeyByRater");
    return "0x0000000000000000000000000000000000000000000000000000000000000000";
  });

  const satisfied = await hasRoundVoteCommitPostcondition({
    advisoryVoteRecorderAddress: addresses.advisoryVoteRecorder,
    client,
    commitHash,
    contentId: 1n,
    isAdvisoryVote: true,
    roundId: 2n,
    voter: addresses.voter,
    votingEngineAddress: addresses.votingEngine,
  });

  assert.equal(satisfied, false);
});

test("round open postcondition requires the current round to accept votes", async () => {
  const client = makeClient(request => {
    if (request.functionName === "currentRoundId") {
      return 3n;
    }
    if (request.functionName === "roundCore") {
      return [900n, 0, 1n, 0n, 1n, 0n, 0n, 0n, 0n, false, 0n, 0n, 0n, 0n];
    }
    if (request.functionName === "roundConfigSnapshot") {
      return [1_200, 3_600, 3, 100];
    }
    throw new Error(`Unexpected function ${request.functionName}`);
  });

  const satisfied = await hasRoundOpenPostcondition({
    client,
    contentId: 1n,
    votingEngineAddress: addresses.votingEngine,
  });

  assert.equal(satisfied, true);
});

test("round open postcondition rejects expired historical round ids", async () => {
  const client = makeClient(request => {
    if (request.functionName === "currentRoundId") {
      return 3n;
    }
    if (request.functionName === "roundCore") {
      return [900n, 0, 1n, 0n, 1n, 0n, 0n, 0n, 0n, false, 0n, 0n, 0n, 0n];
    }
    if (request.functionName === "roundConfigSnapshot") {
      return [1_200, 50, 3, 100];
    }
    throw new Error(`Unexpected function ${request.functionName}`);
  }, 1_000n);

  const satisfied = await hasRoundOpenPostcondition({
    client,
    contentId: 1n,
    votingEngineAddress: addresses.votingEngine,
  });

  assert.equal(satisfied, false);
});

test("round open postcondition rejects terminal historical round ids", async () => {
  const client = makeClient(request => {
    if (request.functionName === "currentRoundId") {
      return 3n;
    }
    if (request.functionName === "roundCore") {
      return [900n, 1, 1n, 0n, 1n, 0n, 0n, 0n, 0n, false, 950n, 0n, 0n, 0n];
    }
    if (request.functionName === "roundConfigSnapshot") {
      return [1_200, 3_600, 3, 100];
    }
    throw new Error(`Unexpected function ${request.functionName}`);
  });

  const satisfied = await hasRoundOpenPostcondition({
    client,
    contentId: 1n,
    votingEngineAddress: addresses.votingEngine,
  });

  assert.equal(satisfied, false);
});
