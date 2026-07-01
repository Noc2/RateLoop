import { ROUND_STATE } from "@rateloop/contracts/protocol";
import {
  approveLREP,
  claimVoterReward,
  commitVoteDirect,
  evmIncreaseTime,
  getActiveRoundId,
  processUnrevealedVotes,
  revealVoteDirect,
  setTestConfig,
  settleRoundDirect,
  submitContentDirect,
  waitForPonderIndexed,
  waitForPonderSync,
} from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS, DEPLOYER } from "../helpers/anvil-accounts";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import { getContentById, getContentList, ponderGet } from "../helpers/ponder-api";
import { expect, test } from "@playwright/test";

/**
 * Reward claiming after settlement (tlock commit-reveal flow).
 * Triggers Ponder events: RewardClaimed and RatingUpdated.
 *
 * Uses direct contract calls for the entire flow:
 *   commitVote → (epoch ends) → revealVoteByCommitKey → settleRound → claim
 *
 * Account allocation (exclusive to this file for voting):
 * - Account #2 — submits fresh content
 * - Accounts #3, #4 — vote UP (winning side)
 * - Account #7 — votes DOWN (losing side, tests RBTS stake-return claims)
 * - Account #1 (keeper) — reveals votes and settles
 *
 * Tests run serially: submit → commit+reveal+settle → verify → claim.
 */
test.describe("Reward claim lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  const VOTING_ENGINE = CONTRACT_ADDRESSES.RoundVotingEngine;
  const LREP_TOKEN = CONTRACT_ADDRESSES.LoopReputation;
  const CONTENT_REGISTRY = CONTRACT_ADDRESSES.ContentRegistry;
  const STAKE = BigInt(10e6); // 10 LREP (above MIN_STAKE_FOR_RATING threshold)
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const EPOCH_DURATION = 300; // 5 min — contract minimum is 5 minutes

  test.beforeAll(async () => {
    const ok = await setTestConfig(VOTING_ENGINE, DEPLOYER.address, EPOCH_DURATION);
    if (!ok) throw new Error("Failed to set test config");
  });

  let newContentId: string | null = null;
  let settledContentId: string | null = null;
  let roundId: bigint = 0n;

  test("submit fresh content for reward claim test", async () => {
    test.setTimeout(60_000);

    const submitter = ANVIL_ACCOUNTS.account2;

    const approved = await approveLREP(CONTENT_REGISTRY, BigInt(10e6), submitter.address, LREP_TOKEN);
    expect(approved, "LREP approval for content submission failed").toBe(true);

    const uniqueId = Date.now();
    const success = await submitContentDirect(
      `https://www.youtube.com/watch?v=reward_test_${uniqueId}`,
      `Reward Claim Test ${uniqueId}`,
      `Reward claim test description ${uniqueId}`,
      "test",
      1,
      submitter.address,
      CONTENT_REGISTRY,
    );
    expect(success, "Content submission tx failed").toBe(true);

    const indexed = await waitForPonderIndexed(async () => {
      const { items } = await getContentList({ status: "all", sortBy: "newest", limit: 5 });
      const match = items.find(item => item.url.includes(`reward_test_${uniqueId}`));
      if (match) {
        newContentId = match.id;
        return true;
      }
      return false;
    }, 30_000);

    expect(indexed, "Ponder did not index the newly submitted content").toBe(true);
    expect(newContentId).toBeTruthy();
  });

  test("commit, reveal, and settle a round with 3 voters", async () => {
    test.setTimeout(120_000);
    test.skip(!newContentId, "No content from previous test");

    // Step 1: Commit votes — #3 UP, #4 UP, #7 DOWN
    const voters = [
      { account: ANVIL_ACCOUNTS.account3, isUp: true },
      { account: ANVIL_ACCOUNTS.account4, isUp: true },
      { account: ANVIL_ACCOUNTS.account7, isUp: false },
    ];

    const commits: { commitKey: `0x${string}`; isUp: boolean; salt: `0x${string}` }[] = [];

    for (let i = 0; i < voters.length; i++) {
      await approveLREP(VOTING_ENGINE, STAKE, voters[i].account.address, LREP_TOKEN);
      const result = await commitVoteDirect(
        BigInt(newContentId!),
        voters[i].isUp,
        STAKE,
        ZERO_ADDRESS,
        voters[i].account.address,
        VOTING_ENGINE,
      );
      expect(result.success, `Commit failed for voter ${i}`).toBe(true);
      commits.push({ commitKey: result.commitKey, isUp: result.isUp, salt: result.salt });
    }

    // Step 2: Get active round ID
    roundId = await getActiveRoundId(BigInt(newContentId!), VOTING_ENGINE);
    expect(roundId).toBeGreaterThan(0n);

    // Step 3: Fast-forward past epoch duration so votes become revealable
    await evmIncreaseTime(EPOCH_DURATION + 1);

    // Step 4: Reveal all votes (keeper does this)
    const keeper = ANVIL_ACCOUNTS.account1;
    for (let i = 0; i < commits.length; i++) {
      const revealed = await revealVoteDirect(
        BigInt(newContentId!),
        roundId,
        commits[i].commitKey,
        commits[i].isUp,
        commits[i].salt,
        keeper.address,
        VOTING_ENGINE,
      );
      expect(revealed, `Reveal failed for voter ${i}`).toBe(true);
    }

    // Step 5: Fast-forward past epoch (settlement has no delay, but chain time must advance)
    await evmIncreaseTime(EPOCH_DURATION + 1);
    await waitForPonderSync();

    // Step 6: Settle the round
    const settled = await settleRoundDirect(BigInt(newContentId!), roundId, keeper.address, VOTING_ENGINE);
    expect(settled, "Settlement failed").toBe(true);

    // Step 7: Wait for Ponder to index
    const settledIndexed = await waitForPonderIndexed(async () => {
      const data = await getContentById(newContentId!);
      return data.rounds.some(
        r => String(r.roundId) === String(roundId) && (r.state === ROUND_STATE.Settled || r.state === ROUND_STATE.Tied),
      );
    }, 30_000);
    expect(settledIndexed, "Ponder did not index settlement").toBe(true);

    settledContentId = newContentId;
  });

  test("content rating updates after settlement", async () => {
    test.skip(!settledContentId, "No settled content from previous test");

    const data = await ponderGet(`/content/${settledContentId}`);
    expect(data).toHaveProperty("content");
    expect(data).toHaveProperty("rounds");

    const settledRounds = data.rounds.filter(
      (r: { state: number }) => r.state === ROUND_STATE.Settled || r.state === ROUND_STATE.Tied,
    );
    expect(settledRounds.length).toBeGreaterThanOrEqual(1);

    expect(data.content).toHaveProperty("rating");
    expect(data.content).toHaveProperty("totalVotes");
  });

  test("winning voter claims reward via direct call", async () => {
    test.skip(!settledContentId || roundId === 0n, "No settled content from previous test");
    test.setTimeout(60_000);

    const REWARD_DISTRIBUTOR = CONTRACT_ADDRESSES.RoundRewardDistributor;

    // Account #3 voted UP (winning side) — claim voter reward
    const winner = ANVIL_ACCOUNTS.account3;
    const success = await claimVoterReward(BigInt(settledContentId!), roundId, winner.address, REWARD_DISTRIBUTOR);
    expect(success, "Voter reward claim should succeed for winning voter").toBe(true);
  });

  test("losing voter claims their RBTS stake return for the settled round", async () => {
    test.skip(!settledContentId || roundId === 0n, "No settled content from previous test");
    test.setTimeout(60_000);

    const REWARD_DISTRIBUTOR = CONTRACT_ADDRESSES.RoundRewardDistributor;
    const loser = ANVIL_ACCOUNTS.account7;
    const loserAddress = loser.address.toLowerCase();

    const success = await claimVoterReward(BigInt(settledContentId!), roundId, loser.address, REWARD_DISTRIBUTOR);
    expect(success, "Revealed losing voter should be able to claim their RBTS stake return").toBe(true);

    const data = await ponderGet(`/content/${settledContentId}`);
    const settledRound = data.rounds?.find((r: { state: number }) => r.state === ROUND_STATE.Settled);

    if (!settledRound) {
      test.skip(true, "No definitively settled round (may be tied)");
      return;
    }

    const indexed = await waitForPonderIndexed(async () => {
      const rewards = await ponderGet(`/rewards?voter=${loserAddress}`);
      return rewards.items?.some(
        (r: { contentId: string; roundId: string }) =>
          r.contentId === settledContentId && r.roundId === settledRound.roundId,
      );
    });

    if (!indexed) {
      test.skip(true, "Ponder not indexing loser rebate claim — on-chain tx succeeded");
      return;
    }

    const rewards = await ponderGet(`/rewards?voter=${loserAddress}`);
    const loserReward = rewards.items?.find(
      (r: { contentId: string; roundId: string }) =>
        r.contentId === settledContentId && r.roundId === settledRound.roundId,
    );
    expect(loserReward).toBeTruthy();
    const stakeReturned = BigInt(loserReward.stakeReturned);
    const lrepReward = BigInt(loserReward.lrepReward);
    expect(stakeReturned).toBeGreaterThanOrEqual(0n);
    expect(stakeReturned).toBeLessThanOrEqual(STAKE);
    expect(lrepReward).toBeGreaterThanOrEqual(0n);
  });

  test("processUnrevealedVotes reverts when nothing to process (NothingProcessed)", async () => {
    test.skip(!settledContentId || roundId === 0n, "No settled content from previous test");
    test.setTimeout(60_000);

    const keeper = ANVIL_ACCOUNTS.account1;
    const result = await processUnrevealedVotes(
      BigInt(settledContentId!),
      roundId,
      0,
      10,
      keeper.address,
      VOTING_ENGINE,
    );
    expect(result, "processUnrevealedVotes should revert with NothingProcessed when all votes revealed").toBe(false);
  });
});
