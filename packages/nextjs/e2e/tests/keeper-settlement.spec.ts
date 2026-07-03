import {
  approveLREP,
  commitVoteDirect,
  evmIncreaseTime,
  evmSetTimestamp,
  getActiveRoundId,
  setTestDrandConfig,
  setTestConfig,
  submitContentDirect,
  waitForPonderIndexed,
} from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS, DEPLOYER } from "../helpers/anvil-accounts";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import "../helpers/fetch-shim";
import { RATING_REVIEW_STATUS_PENDING, getContentById, getContentList, getVotes } from "../helpers/ponder-api";
import { E2E_KEEPER_HEALTH_URL, E2E_RPC_URL } from "../helpers/service-urls";
import { deriveKeeperDecryptWaitMs } from "../helpers/tlockRuntime";
import { RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { getVoteTlockChainInfo } from "@rateloop/contracts/voting";
import { expect, test } from "@playwright/test";
import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";

/**
 * Keeper-backed settlement lifecycle.
 *
 * Unlike the direct-call settlement specs, this test does not invoke reveal or
 * settle helpers. It aligns chain time with a short tlock epoch, then waits for
 * the live keeper service to decrypt, reveal, and settle the round.
 */
test.describe("Keeper-backed settlement lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  const VOTING_ENGINE = CONTRACT_ADDRESSES.RoundVotingEngine;
  const LREP_TOKEN = CONTRACT_ADDRESSES.LoopReputation;
  const CONTENT_REGISTRY = CONTRACT_ADDRESSES.ContentRegistry;
  const STAKE = BigInt(10e6);
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const EPOCH_DURATION = 60;
  const TLOCK_EPOCH = 30;
  const CHAIN_TIME_OFFSET = EPOCH_DURATION - TLOCK_EPOCH;
  const KEEPER_INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS ?? 30_000);
  const KEEPER_DECRYPT_BUFFER_MS = 10_000;
  const MAX_KEEPER_DECRYPT_WAIT_MS = Number(process.env.E2E_KEEPER_MAX_DECRYPT_WAIT_MS ?? 360_000);
  let canonicalDrandConfig: { chainHash: `0x${string}`; genesisTime: bigint; period: bigint } | null = null;
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(E2E_RPC_URL),
  });

  test.beforeAll(async () => {
    const keeperRes = await fetch(E2E_KEEPER_HEALTH_URL).catch(() => null);
    expect(keeperRes?.ok, "Keeper health check failed. Start it with: yarn keeper:dev").toBe(true);

    const liveDrand = await getVoteTlockChainInfo();
    canonicalDrandConfig = {
      chainHash: liveDrand.drandChainHash,
      genesisTime: liveDrand.genesisTimeSeconds,
      period: liveDrand.periodSeconds,
    };

    const ok = await setTestConfig(VOTING_ENGINE, DEPLOYER.address, EPOCH_DURATION);
    if (!ok) throw new Error("Failed to set test config");
  });

  test.afterAll(async () => {
    if (!canonicalDrandConfig) return;
    await setTestDrandConfig(VOTING_ENGINE, DEPLOYER.address, canonicalDrandConfig);
  });

  test("keeper reveals and settles a short-tlock round end to end", async () => {
    test.setTimeout(780_000);

    await evmSetTimestamp(Math.floor(Date.now() / 1000) - CHAIN_TIME_OFFSET);
    expect(canonicalDrandConfig, "Live drand metadata was not loaded").toBeTruthy();

    const latestBlock = await publicClient.getBlock();
    const wallClockNowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const chainDriftSeconds =
      latestBlock.timestamp > wallClockNowSeconds ? latestBlock.timestamp - wallClockNowSeconds : 0n;
    const drandAdjusted = await setTestDrandConfig(VOTING_ENGINE, DEPLOYER.address, {
      chainHash: canonicalDrandConfig!.chainHash,
      genesisTime: canonicalDrandConfig!.genesisTime + chainDriftSeconds,
      period: canonicalDrandConfig!.period,
    });
    expect(drandAdjusted, "Failed to align local drand timing for keeper settlement").toBe(true);

    const submitter = ANVIL_ACCOUNTS.account10;
    const submitApproved = await approveLREP(CONTENT_REGISTRY, BigInt(10e6), submitter.address, LREP_TOKEN);
    expect(submitApproved, "Content submission approval failed").toBe(true);

    const uniqueId = Date.now();
    const submitted = await submitContentDirect(
      `https://www.youtube.com/watch?v=keeper_settlement_${uniqueId}`,
      `Keeper Settlement ${uniqueId}`,
      `Keeper settlement description ${uniqueId}`,
      "test",
      1,
      submitter.address,
      CONTENT_REGISTRY,
    );
    expect(submitted, "Content submission failed").toBe(true);

    let contentId: string | null = null;
    const indexedContent = await waitForPonderIndexed(async () => {
      const { items } = await getContentList({ status: "all", sortBy: "newest", limit: 5 });
      const match = items.find(item => item.url.includes(`keeper_settlement_${uniqueId}`));
      if (match) {
        contentId = match.id;
        return true;
      }
      return false;
    }, 30_000);
    expect(indexedContent, "Ponder did not index the keeper-backed test content").toBe(true);
    expect(contentId).toBeTruthy();

    const voters = [
      { account: ANVIL_ACCOUNTS.account3, isUp: true },
      { account: ANVIL_ACCOUNTS.account4, isUp: true },
      { account: ANVIL_ACCOUNTS.account7, isUp: false },
    ];

    for (const voter of voters) {
      const approved = await approveLREP(VOTING_ENGINE, STAKE, voter.account.address, LREP_TOKEN);
      expect(approved, `Vote approval failed for ${voter.account.address}`).toBe(true);

      const commit = await commitVoteDirect(
        BigInt(contentId!),
        voter.isUp,
        STAKE,
        ZERO_ADDRESS,
        voter.account.address,
        VOTING_ENGINE,
        EPOCH_DURATION,
      );
      expect(commit.success, `Vote commit failed for ${voter.account.address}`).toBe(true);
    }

    const roundId = await getActiveRoundId(BigInt(contentId!), VOTING_ENGINE);
    expect(roundId).toBeGreaterThan(0n);

    // Move chain time past the on-chain reveal window. If another suite already
    // pushed Anvil ahead of wall clock, the compensated local drand genesis above
    // keeps the stored target rounds near real quicknet time for the live keeper.
    await evmIncreaseTime(EPOCH_DURATION + 1);
    const revealBlock = await publicClient.getBlock();

    let keeperDecryptWaitMs = 0;
    for (let i = 0n; i < BigInt(voters.length); i++) {
      const commitKey = await publicClient.readContract({
        address: VOTING_ENGINE,
        abi: RoundVotingEngineAbi,
        functionName: "getRoundCommitKey",
        args: [BigInt(contentId!), roundId, i],
      });
      const commit = await publicClient.readContract({
        address: VOTING_ENGINE,
        abi: RoundVotingEngineAbi,
        functionName: "commitRevealData",
        args: [BigInt(contentId!), roundId, commitKey],
      });

      keeperDecryptWaitMs = Math.max(
        keeperDecryptWaitMs,
        deriveKeeperDecryptWaitMs({
          wallClockNowSeconds: Math.floor(Date.now() / 1000),
          chainNowSeconds: revealBlock.timestamp,
          revealableAfterSeconds: commit[3],
          targetRound: commit[1],
          drandGenesisTimeSeconds: canonicalDrandConfig!.genesisTime,
          drandPeriodSeconds: canonicalDrandConfig!.period,
          keeperIntervalMs: KEEPER_INTERVAL_MS,
          extraBufferMs: KEEPER_DECRYPT_BUFFER_MS,
        }),
      );
    }

    expect(
      keeperDecryptWaitMs,
      `Keeper decrypt target is ${Math.ceil(keeperDecryptWaitMs / 1000)}s away in this seeded chain state.`,
    ).toBeLessThanOrEqual(MAX_KEEPER_DECRYPT_WAIT_MS);

    if (keeperDecryptWaitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, keeperDecryptWaitMs));
    }

    const closedIndexed = await waitForPonderIndexed(
      async () => {
        const data = await getContentById(contentId!);
        const round = data.rounds.find(item => item.roundId === String(roundId));
        return (
          round !== undefined &&
          (round.state === ROUND_STATE.Settled || round.state === ROUND_STATE.SettlementPending)
        );
      },
      240_000,
      2_000,
      "keeper-settlement:closed",
    );
    expect(closedIndexed, "Keeper did not close the round within the timeout").toBe(true);

    const revealedVotesIndexed = await waitForPonderIndexed(
      async () => {
        const { items } = await getVotes({ contentId: contentId! });
        return items.filter(item => item.roundId === String(roundId)).length === voters.length;
      },
      60_000,
      2_000,
      "keeper-settlement:revealedVotes",
    );
    expect(revealedVotesIndexed, "Ponder did not index the keeper-revealed votes").toBe(true);

    const data = await getContentById(contentId!);
    const round = data.rounds.find(item => item.roundId === String(roundId));
    const { items: indexedVotes } = await getVotes({ contentId: contentId! });
    const roundVotes = indexedVotes.filter(item => item.roundId === String(roundId));
    const expectedUpVotes = voters.filter(voter => voter.isUp).length;
    const expectedDownVotes = voters.length - expectedUpVotes;

    expect(round).toBeTruthy();
    expect([ROUND_STATE.Settled, ROUND_STATE.SettlementPending]).toContain(round!.state);
    expect(Number(round!.voteCount)).toBe(voters.length);
    expect(roundVotes.length).toBe(voters.length);
    expect(roundVotes.filter(vote => vote.isUp).length).toBe(expectedUpVotes);
    expect(roundVotes.filter(vote => !vote.isUp).length).toBe(expectedDownVotes);
    if (round!.state === ROUND_STATE.Settled) {
      expect(round!.upWins).toBe(true);
      expect(round!.ratingReviewStatus).toBe(RATING_REVIEW_STATUS_PENDING);
      expect(BigInt(round!.ratingReviewRawUpEvidence ?? "0")).toBeGreaterThan(0n);
    } else {
      expect(round!.upWins).toBeNull();
      expect(round!.rbtsSettlementPendingAt).toBeTruthy();
    }
  });
});
