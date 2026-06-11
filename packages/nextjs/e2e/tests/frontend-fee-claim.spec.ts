import {
  approveLREP,
  claimFrontendFee,
  commitVoteDirect,
  completeFrontendFeeWithdrawal,
  confiscateFrontendFee,
  evmIncreaseTime,
  getActiveRoundId,
  getFrontendAccumulatedFees,
  getPendingFrontendFeeWithdrawalAmount,
  getPendingFrontendFeeWithdrawalReleaseAt,
  readTokenBalance,
  registerFrontend,
  requestFrontendFeeWithdrawal,
  revealVoteDirect,
  setTestConfig,
  settleRoundDirect,
  slashFrontend,
  submitContentDirect,
  transferLREP,
  waitForPonderIndexed,
} from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS, DEPLOYER } from "../helpers/anvil-accounts";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import "../helpers/fetch-shim";
import { getContentList } from "../helpers/ponder-api";
import { E2E_RPC_URL } from "../helpers/service-urls";
import { expect, test } from "@playwright/test";

/**
 * Frontend fee claims after settlement.
 *
 * Uses fresh impersonated frontend addresses per test run so the suite does not
 * depend on the frontend lifecycle spec's registration state or unbonding flow.
 */
test.describe("Frontend fee claim lifecycle", () => {
  test.describe.configure({ mode: "serial" });

  const VOTING_ENGINE = CONTRACT_ADDRESSES.RoundVotingEngine;
  const REWARD_DISTRIBUTOR = CONTRACT_ADDRESSES.RoundRewardDistributor;
  const FRONTEND_REGISTRY = CONTRACT_ADDRESSES.FrontendRegistry;
  const CONTENT_REGISTRY = CONTRACT_ADDRESSES.ContentRegistry;
  const LREP_TOKEN = CONTRACT_ADDRESSES.LoopReputation;
  const STAKE = BigInt(10e6);
  const FRONTEND_STAKE = BigInt(1000e6);
  const EPOCH_DURATION = 300;
  const FEE_WITHDRAWAL_DELAY = 21 * 86400;

  // Shared across serial tests — set by test 1, consumed by test 3.
  let withdrawableFrontend: `0x${string}` | null = null;

  test.beforeAll(async () => {
    const ok = await setTestConfig(VOTING_ENGINE, DEPLOYER.address, EPOCH_DURATION);
    if (!ok) throw new Error("Failed to set test config");
  });

  function frontendAddressFor(seed: number): `0x${string}` {
    return `0x${seed.toString(16).padStart(40, "0")}` as `0x${string}`;
  }

  async function setupFrontend(frontendAddress: `0x${string}`): Promise<void> {
    // Fund the impersonated frontend address with ETH for gas
    await fetch(E2E_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "anvil_setBalance",
        params: [frontendAddress, "0x21E19E0C9BAB2400000"], // 10,000 ETH
        id: Date.now(),
      }),
    });

    const funded = await transferLREP(frontendAddress, FRONTEND_STAKE, DEPLOYER.address, LREP_TOKEN);
    expect(funded, `Failed to fund frontend ${frontendAddress}`).toBe(true);

    const approved = await approveLREP(FRONTEND_REGISTRY, FRONTEND_STAKE, frontendAddress, LREP_TOKEN);
    expect(approved, `Failed to approve LREP for frontend ${frontendAddress}`).toBe(true);

    const registered = await registerFrontend(frontendAddress, FRONTEND_REGISTRY);
    expect(registered, `Failed to register frontend ${frontendAddress}`).toBe(true);
  }

  async function settleRoundWithFrontend(
    frontendAddress: `0x${string}`,
    uniqueId: number,
  ): Promise<{
    contentId: string;
    roundId: bigint;
  }> {
    const submitter = ANVIL_ACCOUNTS.account10;
    const submitApproved = await approveLREP(CONTENT_REGISTRY, BigInt(10e6), submitter.address, LREP_TOKEN);
    expect(submitApproved, "Content submission approval failed").toBe(true);

    const submitted = await submitContentDirect(
      `https://www.youtube.com/watch?v=frontend_fee_${uniqueId}`,
      `Frontend Fee ${uniqueId}`,
      `Frontend fee test description ${uniqueId}`,
      "test",
      1,
      submitter.address,
      CONTENT_REGISTRY,
    );
    expect(submitted, "Content submission failed").toBe(true);

    let contentId: string | null = null;
    const indexedContent = await waitForPonderIndexed(async () => {
      const { items } = await getContentList({ status: "all", sortBy: "newest", limit: 5 });
      const match = items.find(item => item.url.includes(`frontend_fee_${uniqueId}`));
      if (match) {
        contentId = match.id;
        return true;
      }
      return false;
    }, 30_000);
    expect(indexedContent, "Ponder did not index the frontend-fee test content").toBe(true);
    expect(contentId).toBeTruthy();

    const voters = [
      { account: ANVIL_ACCOUNTS.account2, isUp: true },
      { account: ANVIL_ACCOUNTS.account3, isUp: true },
      { account: ANVIL_ACCOUNTS.account4, isUp: true },
      { account: ANVIL_ACCOUNTS.account5, isUp: true },
      { account: ANVIL_ACCOUNTS.account6, isUp: true },
      { account: ANVIL_ACCOUNTS.account7, isUp: false },
      { account: ANVIL_ACCOUNTS.account8, isUp: false },
      { account: ANVIL_ACCOUNTS.account9, isUp: false },
    ];

    const commits: { commitKey: `0x${string}`; isUp: boolean; salt: `0x${string}` }[] = [];

    for (const voter of voters) {
      const approved = await approveLREP(VOTING_ENGINE, STAKE, voter.account.address, LREP_TOKEN);
      expect(approved, `Vote approval failed for ${voter.account.address}`).toBe(true);

      const commit = await commitVoteDirect(
        BigInt(contentId!),
        voter.isUp,
        STAKE,
        frontendAddress,
        voter.account.address,
        VOTING_ENGINE,
      );
      expect(commit.success, `Vote commit failed for ${voter.account.address}`).toBe(true);
      commits.push({ commitKey: commit.commitKey, isUp: commit.isUp, salt: commit.salt });
    }

    const roundId = await getActiveRoundId(BigInt(contentId!), VOTING_ENGINE);
    expect(roundId).toBeGreaterThan(0n);

    await evmIncreaseTime(EPOCH_DURATION + 1);

    for (const commit of commits) {
      const revealed = await revealVoteDirect(
        BigInt(contentId!),
        roundId,
        commit.commitKey,
        commit.isUp,
        commit.salt,
        ANVIL_ACCOUNTS.account1.address,
        VOTING_ENGINE,
      );
      expect(revealed).toBe(true);
    }

    await evmIncreaseTime(EPOCH_DURATION + 1);
    const settled = await settleRoundDirect(
      BigInt(contentId!),
      roundId,
      ANVIL_ACCOUNTS.account1.address,
      VOTING_ENGINE,
    );
    expect(settled, "Frontend-fee round did not settle").toBe(true);

    return { contentId: contentId!, roundId };
  }

  test("registered frontend accrues claimable fees after settlement", async () => {
    test.setTimeout(180_000);

    const uniqueId = Date.now();
    const frontendAddress = frontendAddressFor(uniqueId);
    await setupFrontend(frontendAddress);

    const { contentId, roundId } = await settleRoundWithFrontend(frontendAddress, uniqueId);

    const feesBefore = await getFrontendAccumulatedFees(frontendAddress, FRONTEND_REGISTRY);
    const claimed = await claimFrontendFee(
      BigInt(contentId),
      roundId,
      frontendAddress,
      frontendAddress,
      REWARD_DISTRIBUTOR,
    );
    expect(claimed, "Frontend fee claim should succeed for an eligible frontend").toBe(true);

    const feesAfter = await getFrontendAccumulatedFees(frontendAddress, FRONTEND_REGISTRY);
    expect(feesAfter).toBeGreaterThan(feesBefore);

    // Save for the two-step fee withdrawal test
    withdrawableFrontend = frontendAddress;

    const doubleClaim = await claimFrontendFee(
      BigInt(contentId),
      roundId,
      frontendAddress,
      frontendAddress,
      REWARD_DISTRIBUTOR,
    );
    expect(doubleClaim, "Frontend fee should not be claimable twice").toBe(false);
  });

  test("slashed frontends route historical frontend fees to protocol", async () => {
    test.setTimeout(180_000);

    const uniqueId = Date.now() + 1;
    const frontendAddress = frontendAddressFor(uniqueId);
    await setupFrontend(frontendAddress);

    const { contentId, roundId } = await settleRoundWithFrontend(frontendAddress, uniqueId);

    const slashOk = await slashFrontend(
      frontendAddress,
      BigInt(100e6),
      "E2E test: slash before fee claim",
      DEPLOYER.address,
      FRONTEND_REGISTRY,
    );
    expect(slashOk, "Frontend slash should succeed").toBe(true);

    const feesBefore = await getFrontendAccumulatedFees(frontendAddress, FRONTEND_REGISTRY);
    const confiscated = await confiscateFrontendFee(
      BigInt(contentId),
      roundId,
      frontendAddress,
      DEPLOYER.address,
      REWARD_DISTRIBUTOR,
    );
    expect(confiscated, "Historical frontend fee should be confiscatable while slashed").toBe(true);
    expect(await getFrontendAccumulatedFees(frontendAddress, FRONTEND_REGISTRY)).toBe(feesBefore);
  });

  test("operator withdraws accumulated fees via delayed fee withdrawal", async () => {
    test.setTimeout(60_000);

    // Uses the frontend from test 1 which already has credited fees.
    expect(withdrawableFrontend, "No frontend with credited fees from prior test").toBeTruthy();
    const frontendAddress = withdrawableFrontend!;

    const accumulatedBefore = await getFrontendAccumulatedFees(frontendAddress, FRONTEND_REGISTRY);
    expect(accumulatedBefore, "Frontend should have accumulated fees to withdraw").toBeGreaterThan(0n);

    const walletBefore = await readTokenBalance(frontendAddress, LREP_TOKEN);

    const requested = await requestFrontendFeeWithdrawal(frontendAddress, FRONTEND_REGISTRY);
    expect(requested, "requestFeeWithdrawal() should move accumulated fees into the pending bucket").toBe(true);

    const accumulatedAfterRequest = await getFrontendAccumulatedFees(frontendAddress, FRONTEND_REGISTRY);
    expect(accumulatedAfterRequest).toBe(0n);

    const pendingAmount = await getPendingFrontendFeeWithdrawalAmount(frontendAddress, FRONTEND_REGISTRY);
    expect(pendingAmount).toBe(accumulatedBefore);

    const releaseAt = await getPendingFrontendFeeWithdrawalReleaseAt(frontendAddress, FRONTEND_REGISTRY);
    expect(releaseAt).toBeGreaterThan(0n);

    const earlyWithdraw = await completeFrontendFeeWithdrawal(frontendAddress, FRONTEND_REGISTRY);
    expect(earlyWithdraw, "completeFeeWithdrawal() should revert before the review window matures").toBe(false);
    expect(await readTokenBalance(frontendAddress, LREP_TOKEN)).toBe(walletBefore);

    await evmIncreaseTime(FEE_WITHDRAWAL_DELAY + 1);

    const withdrawn = await completeFrontendFeeWithdrawal(frontendAddress, FRONTEND_REGISTRY);
    expect(withdrawn, "completeFeeWithdrawal() should succeed after the review window").toBe(true);

    expect(await getPendingFrontendFeeWithdrawalAmount(frontendAddress, FRONTEND_REGISTRY)).toBe(0n);
    expect(await getPendingFrontendFeeWithdrawalReleaseAt(frontendAddress, FRONTEND_REGISTRY)).toBe(0n);

    const walletAfter = await readTokenBalance(frontendAddress, LREP_TOKEN);
    expect(walletAfter - walletBefore).toBe(accumulatedBefore);

    const doubleWithdraw = await completeFrontendFeeWithdrawal(frontendAddress, FRONTEND_REGISTRY);
    expect(doubleWithdraw, "completeFeeWithdrawal() should revert when no withdrawal is pending").toBe(false);
  });
});
