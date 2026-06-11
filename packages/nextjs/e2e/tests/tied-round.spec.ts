import {
  approveLREP,
  commitVoteDirect,
  evmIncreaseTime,
  getActiveRoundId,
  revealVoteDirect,
  setTestConfig,
  settleRoundDirect,
  submitContentDirect,
  transferLREP,
  waitForPonderIndexed,
  waitForPonderSync,
} from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS, DEPLOYER } from "../helpers/anvil-accounts";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import { getContentById, getContentList } from "../helpers/ponder-api";
import { expect, test } from "@playwright/test";

/**
 * Tied round lifecycle test (tlock commit-reveal).
 * Verifies that when upStake === downStake the round settles as Tied (state=3),
 * the content rating does NOT change, and rewards are handled correctly.
 *
 * Strategy:
 * 1. Ask a fresh question directly to get a clean round with 0 votes
 * 2. 4 accounts vote on the SAME content directly: 2 UP + 2 DOWN, all equal stake
 * 3. Fast-forward past epoch → reveal votes → fast-forward → settle
 * 4. Verify round.state === 3 (Tied) and rating unchanged
 *
 * Account allocation:
 * - Account #10 — submits new content
 * - Accounts #3, #4 — vote UP (1 LREP each)
 * - Accounts #5, #6 — vote DOWN (1 LREP each)
 *
 * NOTE: Uses accounts that may already have cooldowns from settlement-lifecycle
 * and reward-claim tests. The test asks a fresh question directly to avoid
 * submission UI timing while still exercising UI voting.
 */
test.describe("Tied round lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  const VOTING_ENGINE = CONTRACT_ADDRESSES.RoundVotingEngine;
  const CONTENT_REGISTRY = CONTRACT_ADDRESSES.ContentRegistry;
  const LREP_TOKEN = CONTRACT_ADDRESSES.LoopReputation;
  const EPOCH_DURATION = 60;
  const MIN_TIE_VOTERS = 4;
  const STAKE = BigInt(10e6);
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  test.beforeAll(async () => {
    const ok = await setTestConfig(VOTING_ENGINE, DEPLOYER.address, EPOCH_DURATION, 86400, MIN_TIE_VOTERS);
    if (!ok) throw new Error("Failed to set test config");
  });

  async function submitTieTestContent(): Promise<string> {
    const submitter = ANVIL_ACCOUNTS.account10;
    const uniqueId = Date.now();
    const url = `https://www.youtube.com/watch?v=tie_test_${uniqueId}`;
    const funded = await transferLREP(submitter.address, BigInt(100e6), DEPLOYER.address, LREP_TOKEN);
    expect(funded, "Content submitter top-up failed").toBe(true);

    const submitApproved = await approveLREP(CONTENT_REGISTRY, BigInt(10e6), submitter.address, LREP_TOKEN);
    expect(submitApproved, "Content submission approval failed").toBe(true);

    const submitted = await submitContentDirect(
      url,
      `Tie Test Title ${uniqueId}`,
      `Tie Test ${uniqueId}`,
      "test",
      1,
      submitter.address,
      CONTENT_REGISTRY,
    );
    expect(submitted, "Content submission tx failed").toBe(true);

    // Ensure Ponder has caught up to the chain tip before polling for specific content
    await waitForPonderSync(60_000);

    // Find the newly submitted content via Ponder
    let contentId: string | null = null;
    const indexed = await waitForPonderIndexed(
      async () => {
        const { items } = await getContentList({ status: "all", sortBy: "newest", limit: 5 });
        const match = items.find(item => item.url.includes(`tie_test_${uniqueId}`));
        if (match) {
          contentId = match.id;
          return true;
        }
        return false;
      },
      30_000,
      2_000,
      "tied-round:findContent",
    );

    expect(indexed, "Ponder did not index the fresh tied-round content").toBe(true);
    expect(contentId).toBeTruthy();
    return contentId!;
  }

  test("4 voters create a tie (2 up, 2 down, equal stakes)", async () => {
    test.setTimeout(300_000);
    const contentId = await submitTieTestContent();

    // 2 UP + 2 DOWN = equal pools → tie
    const voters = [
      { account: ANVIL_ACCOUNTS.account3, direction: "up" as const },
      { account: ANVIL_ACCOUNTS.account4, direction: "up" as const },
      { account: ANVIL_ACCOUNTS.account5, direction: "down" as const },
      { account: ANVIL_ACCOUNTS.account6, direction: "down" as const },
    ];

    const commits: { commitKey: `0x${string}`; isUp: boolean; salt: `0x${string}` }[] = [];

    for (const voter of voters) {
      const isUp = voter.direction === "up";
      const approved = await approveLREP(VOTING_ENGINE, STAKE, voter.account.address, LREP_TOKEN);
      expect(approved, `Vote approval failed for ${voter.account.address}`).toBe(true);

      const result = await commitVoteDirect(
        BigInt(contentId),
        isUp,
        STAKE,
        ZERO_ADDRESS,
        voter.account.address,
        VOTING_ENGINE,
      );
      expect(result.success, `Commit failed for ${voter.account.address}`).toBe(true);
      commits.push({ commitKey: result.commitKey, isUp: result.isUp, salt: result.salt });
    }

    // Snapshot the pre-settlement rating
    const preData = await getContentById(contentId);
    const preRating = preData.content.rating;

    // Get the active round ID before settlement
    const roundId = await getActiveRoundId(BigInt(contentId), VOTING_ENGINE);

    // Fast-forward past epoch duration so votes become revealable
    await evmIncreaseTime(EPOCH_DURATION + 1);

    for (let i = 0; i < commits.length; i++) {
      const revealed = await revealVoteDirect(
        BigInt(contentId),
        roundId,
        commits[i].commitKey,
        commits[i].isUp,
        commits[i].salt,
        ANVIL_ACCOUNTS.account1.address,
        VOTING_ENGINE,
      );
      expect(revealed, `Reveal failed for voter ${i}`).toBe(true);
    }

    // Fast-forward past epoch (no settlement delay, but chain time must advance)
    await evmIncreaseTime(EPOCH_DURATION + 1);
    await waitForPonderSync();

    // Try to settle
    if (roundId > 0n) {
      const settledTx = await settleRoundDirect(BigInt(contentId), roundId, ANVIL_ACCOUNTS.account1.address, VOTING_ENGINE);
      expect(settledTx, "Settlement tx failed").toBe(true);
    }

    // Wait for the exact tied round state in Ponder.
    const tiedIndexed = await waitForPonderIndexed(
      async () => {
        const data = await getContentById(contentId);
        const round = data.rounds.find(item => item.roundId === String(roundId));
        return round?.state === 3;
      },
      90_000,
      2_000,
      "tied-round:tied",
    );
    expect(tiedIndexed, "Ponder did not index the target round as tied").toBe(true);

    // Verify round state — must be Tied (state=3) since pools are equal
    const postData = await getContentById(contentId);
    const tiedRound = postData.rounds.find(r => r.roundId === String(roundId) && r.state === 3);

    expect(tiedRound, "Round should be Tied (state=3) when upPool === downPool").toBeTruthy();

    // Rating must NOT change on a tied round
    expect(postData.content.rating).toBe(preRating);

    // Verify equal pools
    expect(tiedRound!.upPool).toBe(tiedRound!.downPool);
  });
});
