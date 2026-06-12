import {
  SUBMISSION_REWARD_ASSET_USDC,
  readTokenBalance,
  setTestConfig,
  submitContentDirect,
  waitForPonderIndexed,
  waitForPonderSync,
} from "../helpers/admin-helpers";
import { ANVIL_ACCOUNTS, DEPLOYER } from "../helpers/anvil-accounts";
import {
  correlationPublicClient,
  ensureFrontendOperatorEligible,
  normalizePayoutWeight,
  publishAndFinalizeCorrelationSnapshotsWithKeeper,
  readRoundPayoutArtifact,
  settleRoundWithVotes,
  stopCorrelationSnapshotKeeper,
  waitForClaimCandidateWithProof,
  type CorrelationArtifactPayoutWeight,
  type PayoutWeight,
} from "../helpers/correlation";
import { CONTRACT_ADDRESSES } from "../helpers/contracts";
import { ponderGet } from "../helpers/ponder-api";
import { E2E_RPC_URL } from "../helpers/service-urls";
import { QuestionRewardPoolEscrowAbi } from "@rateloop/contracts/abis";
import { expect, test } from "@playwright/test";
import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const USDC_REWARD_AMOUNT = 10_000_000n;
const EPOCH_DURATION = 300;

test.describe("Correlation bounty payout e2e", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const ok = await setTestConfig(CONTRACT_ADDRESSES.RoundVotingEngine, DEPLOYER.address, EPOCH_DURATION);
    expect(ok, "Failed to configure short local round epoch").toBe(true);

    await ensureFrontendOperatorEligible(ANVIL_ACCOUNTS.account1.address);
  });

  test.afterEach(async () => {
    await stopCorrelationSnapshotKeeper();
  });

  test("publishes non-neutral surprise snapshots and claims weighted USDC bounties", async () => {
    test.setTimeout(520_000);

    const submitter = ANVIL_ACCOUNTS.account2;
    const uniqueId = Date.now();
    const submitted = await submitContentDirect(
      `https://www.youtube.com/watch?v=correlation_bounty_${uniqueId}`,
      `Correlation Bounty ${uniqueId}`,
      `Correlation bounty payout e2e ${uniqueId}`,
      "test",
      1,
      submitter.address,
      CONTRACT_ADDRESSES.ContentRegistry,
      undefined,
      USDC_REWARD_AMOUNT,
      { epochDuration: EPOCH_DURATION, maxDuration: EPOCH_DURATION, minVoters: 8, maxVoters: 100 },
      SUBMISSION_REWARD_ASSET_USDC,
      CONTRACT_ADDRESSES.MockERC20,
    );
    expect(submitted, "USDC bounty content submission failed").toBe(true);

    let contentId: string | null = null;
    const contentIndexed = await waitForPonderIndexed(
      async () => {
        const data = await ponderGet(`/content?status=all&sortBy=newest&limit=10`);
        const match = data.items?.find((item: { url: string }) =>
          item.url.includes(`correlation_bounty_${uniqueId}`),
        );
        if (match) contentId = match.id;
        return Boolean(match);
      },
      60_000,
      2_000,
      "correlation-bounty:content-indexed",
    );
    expect(contentIndexed, "Ponder did not index the USDC bounty content").toBe(true);
    expect(contentId).toBeTruthy();

    const bonusVoter = ANVIL_ACCOUNTS.account3;
    const floorVoter = ANVIL_ACCOUNTS.account10;
    const { roundId } = await settleRoundWithVotes(
      BigInt(contentId!),
      [
        { account: bonusVoter, isUp: true },
        { account: ANVIL_ACCOUNTS.account4, isUp: true },
        { account: ANVIL_ACCOUNTS.account5, isUp: true },
        { account: ANVIL_ACCOUNTS.account6, isUp: true },
        { account: ANVIL_ACCOUNTS.account7, isUp: true },
        { account: ANVIL_ACCOUNTS.account8, isUp: true },
        { account: ANVIL_ACCOUNTS.account9, isUp: true },
        { account: floorVoter, isUp: false },
      ],
      { epochDuration: EPOCH_DURATION },
    );

    let rewardPoolId: string | null = null;
    const candidateIndexed = await waitForPonderIndexed(
      async () => {
        await waitForPonderSync(60_000, 2_000);
        const candidates = await ponderGet(`/correlation/round-candidates?limit=200`);
        const match = candidates.items?.find(
          (item: { contentId: string; roundId: string; rewardPoolId: string }) =>
            item.contentId === contentId && item.roundId === roundId.toString(),
        );
        if (match) rewardPoolId = match.rewardPoolId;
        return Boolean(match);
      },
      120_000,
      2_000,
      "correlation-bounty:round-candidate",
    );
    expect(candidateIndexed, "Ponder did not expose the settled USDC round as a correlation candidate").toBe(true);
    expect(rewardPoolId).toBeTruthy();

    await publishAndFinalizeCorrelationSnapshotsWithKeeper(BigInt(rewardPoolId!), BigInt(contentId!), roundId);

    const bonusCandidate = await waitForClaimCandidateWithProof(
      bonusVoter.address,
      rewardPoolId!,
      contentId!,
      roundId,
    );
    const floorCandidate = await waitForClaimCandidateWithProof(
      floorVoter.address,
      rewardPoolId!,
      contentId!,
      roundId,
    );
    expect(bonusCandidate.requiresPayoutProof, "USDC bounty claim should require a payout proof").toBe(true);
    expect(floorCandidate.requiresPayoutProof, "USDC bounty claim should require a payout proof").toBe(true);

    const bonusWeight = normalizePayoutWeight(bonusCandidate.payoutWeight);
    const floorWeight = normalizePayoutWeight(floorCandidate.payoutWeight);
    expect(bonusWeight.effectiveWeight, "up-voter should receive a non-neutral surprise weight").toBeGreaterThan(
      floorWeight.effectiveWeight,
    );

    const bonusClaimable = await readClaimableQuestionRewardWithPayoutWeight(
      rewardPoolId!,
      roundId,
      bonusVoter.address,
      bonusWeight,
      (bonusCandidate.payoutProof ?? []) as Hex[],
    );
    const floorClaimable = await readClaimableQuestionRewardWithPayoutWeight(
      rewardPoolId!,
      roundId,
      floorVoter.address,
      floorWeight,
      (floorCandidate.payoutProof ?? []) as Hex[],
    );
    expect(bonusClaimable, "Bonus voter should have a positive USDC claim").toBeGreaterThan(0n);
    expect(floorClaimable, "Floor voter should have a positive USDC claim").toBeGreaterThan(0n);
    expect(Number(bonusClaimable) / Number(floorClaimable)).toBeCloseTo(
      Number(bonusWeight.effectiveWeight) / Number(floorWeight.effectiveWeight),
      2,
    );

    const artifact = await readRoundPayoutArtifact(BigInt(rewardPoolId!), BigInt(contentId!), roundId);
    const bonusArtifactWeight = findArtifactWeight(artifact.payoutWeights, bonusVoter.address);
    const floorArtifactWeight = findArtifactWeight(artifact.payoutWeights, floorVoter.address);
    expect(artifact.payoutWeights).toHaveLength(8);
    expect(bonusArtifactWeight.surpriseBps).toBeGreaterThan(10_000);
    expect(floorArtifactWeight.surpriseBps).toBe(10_000);
    expect(BigInt(bonusArtifactWeight.effectiveWeight)).toBe(bonusWeight.effectiveWeight);
    expect(BigInt(floorArtifactWeight.effectiveWeight)).toBe(floorWeight.effectiveWeight);
    expect(BigInt(bonusArtifactWeight.baseWeight)).toBeGreaterThan(BigInt(floorArtifactWeight.baseWeight));

    await claimAndExpectBalanceDelta(bonusVoter, rewardPoolId!, roundId, bonusWeight, bonusCandidate.payoutProof);
    await claimAndExpectBalanceDelta(floorVoter, rewardPoolId!, roundId, floorWeight, floorCandidate.payoutProof);

    const claimsIndexed = await waitForPonderIndexed(
      async () => {
        const [bonusCandidates, floorCandidates] = await Promise.all([
          ponderGet(`/question-reward-claim-candidates?voter=${bonusVoter.address}&limit=200`),
          ponderGet(`/question-reward-claim-candidates?voter=${floorVoter.address}&limit=200`),
        ]);
        return [bonusCandidates, floorCandidates].every(
          candidates =>
            !candidates.items?.some(
              (item: { rewardPoolId: string; contentId: string; roundId: string }) =>
                item.rewardPoolId === rewardPoolId &&
                item.contentId === contentId &&
                item.roundId === roundId.toString(),
            ),
        );
      },
      90_000,
      2_000,
      "correlation-bounty:claims-indexed",
    );
    expect(claimsIndexed, "Ponder did not index the weighted bounty claims").toBe(true);
  });
});

async function readClaimableQuestionRewardWithPayoutWeight(
  rewardPoolId: string,
  roundId: bigint,
  claimant: `0x${string}`,
  payoutWeight: PayoutWeight,
  proof: Hex[],
) {
  return correlationPublicClient.readContract({
    address: CONTRACT_ADDRESSES.QuestionRewardPoolEscrow,
    abi: QuestionRewardPoolEscrowAbi,
    functionName: "claimableQuestionRewardWithPayoutWeight",
    args: [BigInt(rewardPoolId), roundId, claimant, payoutWeight, proof],
  });
}

async function claimAndExpectBalanceDelta(
  claimant: { address: `0x${string}`; privateKey: `0x${string}` },
  rewardPoolId: string,
  roundId: bigint,
  payoutWeight: PayoutWeight,
  payoutProof: unknown,
) {
  const proof = (payoutProof ?? []) as Hex[];
  const claimable = await readClaimableQuestionRewardWithPayoutWeight(
    rewardPoolId,
    roundId,
    claimant.address,
    payoutWeight,
    proof,
  );
  const before = await readTokenBalance(claimant.address, CONTRACT_ADDRESSES.MockERC20);
  const walletClient = createWalletClient({
    account: privateKeyToAccount(claimant.privateKey),
    chain: foundry,
    transport: http(E2E_RPC_URL),
  });
  const hash = await walletClient.writeContract({
    address: CONTRACT_ADDRESSES.QuestionRewardPoolEscrow,
    abi: QuestionRewardPoolEscrowAbi,
    functionName: "claimQuestionReward",
    args: [BigInt(rewardPoolId), roundId, payoutWeight, proof],
  });
  const receipt = await correlationPublicClient.waitForTransactionReceipt({ hash });
  expect(receipt.status, `Weighted USDC bounty claim transaction failed for ${claimant.address}`).toBe("success");

  const after = await readTokenBalance(claimant.address, CONTRACT_ADDRESSES.MockERC20);
  expect(after - before, `Claimant ${claimant.address} did not receive the claimable USDC amount`).toBe(claimable);
}

function findArtifactWeight(weights: CorrelationArtifactPayoutWeight[], account: `0x${string}`) {
  const match = weights.find(weight => weight.account.toLowerCase() === account.toLowerCase());
  expect(match, `artifact should include payout weight for ${account}`).toBeTruthy();
  return match!;
}
