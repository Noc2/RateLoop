import { isBenignRevealError, resolveRevealReceiptRevert } from "./useManualRevealVotes";
import assert from "node:assert/strict";
import test from "node:test";
import { zeroHash } from "viem";

const ENGINE = "0x0000000000000000000000000000000000000e21" as const;
const COMMIT_KEY = `0x${"11".repeat(32)}` as `0x${string}`;
const CIPHERTEXT_HASH = `0x${"22".repeat(32)}` as `0x${string}`;

function commitRevealResult(revealed: boolean) {
  // [ciphertextHash, targetRound, drandChainHash, revealableAfter, revealed, stakeAmount]
  return [CIPHERTEXT_HASH, 100n, zeroHash, 0n, revealed, 1_000_000n] as const;
}

function roundCoreResult(state: number) {
  // [startTime, state, voteCount, revealedCount, totalStake, thresholdReachedAt, settledAt]
  return [0n, state, 3, 3, 0n, 0n, 0n] as const;
}

function stubPublicClient(handlers: { commitRevealData?: () => unknown; roundCore?: () => unknown }) {
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      const handler = handlers[functionName as keyof typeof handlers];
      if (!handler) throw new Error(`Unexpected read: ${functionName}`);
      return handler();
    },
  } as any;
}

const baseParams = {
  engineAddress: ENGINE,
  contentId: 1n,
  roundId: 2n,
  commitKey: COMMIT_KEY,
};

test("receipt-level reverts are no longer assumed benign", () => {
  assert.equal(isBenignRevealError("Transaction reverted"), false);
  assert.equal(isBenignRevealError("transaction reverted"), false);
});

test("named contract errors stay benign", () => {
  assert.equal(isBenignRevealError("AlreadyRevealed()"), true);
  assert.equal(isBenignRevealError("RoundNotOpen()"), true);
  assert.equal(isBenignRevealError("EpochNotEnded()"), true);
});

test("resolveRevealReceiptRevert reports already-revealed when the commit is revealed on-chain", async () => {
  const resolution = await resolveRevealReceiptRevert({
    ...baseParams,
    publicClient: stubPublicClient({ commitRevealData: () => commitRevealResult(true) }),
  });
  assert.equal(resolution, "already-revealed");
});

test("resolveRevealReceiptRevert reports round-closed when the round left the open state", async () => {
  const resolution = await resolveRevealReceiptRevert({
    ...baseParams,
    publicClient: stubPublicClient({
      commitRevealData: () => commitRevealResult(false),
      roundCore: () => roundCoreResult(1), // Settled
    }),
  });
  assert.equal(resolution, "round-closed");
});

test("resolveRevealReceiptRevert reports an honest revert when the round is still open and unrevealed", async () => {
  const resolution = await resolveRevealReceiptRevert({
    ...baseParams,
    publicClient: stubPublicClient({
      commitRevealData: () => commitRevealResult(false),
      roundCore: () => roundCoreResult(0), // Open
    }),
  });
  assert.equal(resolution, "reverted");
});

test("resolveRevealReceiptRevert reports an honest revert when the benign cause cannot be verified", async () => {
  const resolution = await resolveRevealReceiptRevert({
    ...baseParams,
    publicClient: stubPublicClient({
      commitRevealData: () => {
        throw new Error("rpc unavailable");
      },
      roundCore: () => {
        throw new Error("rpc unavailable");
      },
    }),
  });
  assert.equal(resolution, "reverted");
});
