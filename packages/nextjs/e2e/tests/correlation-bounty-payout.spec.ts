import "../helpers/fetch-shim";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import {
  SUBMISSION_REWARD_ASSET_USDC,
  approveLREP,
  commitVoteDirect,
  evmIncreaseTime,
  getActiveRoundId,
  readTokenBalance,
  registerFrontend,
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
import { ponderGet } from "../helpers/ponder-api";
import { E2E_RPC_URL, PONDER_URL } from "../helpers/service-urls";
import { ClusterPayoutOracleAbi, FrontendRegistryAbi, QuestionRewardPoolEscrowAbi } from "@rateloop/contracts/abis";
import { PAYOUT_DOMAIN_QUESTION_REWARD } from "@rateloop/node-utils/correlationScoring";
import { expect, test } from "@playwright/test";
import { createPublicClient, createWalletClient, getAddress, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const SNAPSHOT_STATUS_NONE = 0;
const SNAPSHOT_STATUS_PROPOSED = 1;
const SNAPSHOT_STATUS_CHALLENGED = 2;
const SNAPSHOT_STATUS_FINALIZED = 3;
const SNAPSHOT_STATUS_REJECTED = 4;
const STAKE = 10_000_000n;
const FRONTEND_STAKE = 1_000_000_000n;
const USDC_REWARD_AMOUNT = 10_000_000n;
const EPOCH_DURATION = 300;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const REPO_ROOT = path.resolve(process.cwd(), "../..");

const publicClient = createPublicClient({
  chain: foundry,
  transport: http(E2E_RPC_URL),
});
let correlationKeeper: ChildProcess | null = null;
const correlationKeeperLogs: string[] = [];

type PayoutWeight = {
  domain: number;
  rewardPoolId: bigint;
  contentId: bigint;
  roundId: bigint;
  commitKey: Hex;
  identityKey: Hex;
  account: `0x${string}`;
  baseWeight: bigint;
  independenceBps: number;
  effectiveWeight: bigint;
  reasonHash: Hex;
};

test.describe("Correlation bounty payout e2e", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const ok = await setTestConfig(
      CONTRACT_ADDRESSES.RoundVotingEngine,
      DEPLOYER.address,
      EPOCH_DURATION,
    );
    expect(ok, "Failed to configure short local round epoch").toBe(true);

    await ensureFrontendOperatorEligible(ANVIL_ACCOUNTS.account1.address);
  });

  test.afterEach(async () => {
    await stopCorrelationSnapshotKeeper();
  });

  test("publishes correlation snapshots and claims a USDC bounty with Ponder proof", async () => {
    test.setTimeout(420_000);

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
      { epochDuration: EPOCH_DURATION, maxDuration: EPOCH_DURATION, minVoters: 3, maxVoters: 100 },
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

    const { roundId } = await settleThreeVoteRound(BigInt(contentId!));

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

    const claimant = ANVIL_ACCOUNTS.account3;
    const claimCandidate = await waitForClaimCandidateWithProof(
      claimant.address,
      rewardPoolId!,
      contentId!,
      roundId,
    );
    expect(claimCandidate.requiresPayoutProof, "USDC bounty claim should require a payout proof").toBe(true);

    const payoutWeight = normalizePayoutWeight(claimCandidate.payoutWeight);
    const proof = (claimCandidate.payoutProof ?? []) as Hex[];
    const claimable = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.QuestionRewardPoolEscrow,
      abi: QuestionRewardPoolEscrowAbi,
      functionName: "claimableQuestionRewardWithPayoutWeight",
      args: [BigInt(rewardPoolId!), roundId, claimant.address, payoutWeight, proof],
    });
    expect(claimable, "Claimable USDC amount should be positive").toBeGreaterThan(0n);

    const claimantBefore = await readTokenBalance(claimant.address, CONTRACT_ADDRESSES.MockERC20);
    const walletClient = createWalletClient({
      account: privateKeyToAccount(claimant.privateKey),
      chain: foundry,
      transport: http(E2E_RPC_URL),
    });
    const hash = await walletClient.writeContract({
      address: CONTRACT_ADDRESSES.QuestionRewardPoolEscrow,
      abi: QuestionRewardPoolEscrowAbi,
      functionName: "claimQuestionReward",
      args: [BigInt(rewardPoolId!), roundId, payoutWeight, proof],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status, "Weighted USDC bounty claim transaction failed").toBe("success");

    const claimantAfter = await readTokenBalance(claimant.address, CONTRACT_ADDRESSES.MockERC20);
    expect(claimantAfter - claimantBefore, "Claimant did not receive the claimable USDC amount").toBe(claimable);

    const claimIndexed = await waitForPonderIndexed(
      async () => {
        const candidates = await ponderGet(`/question-reward-claim-candidates?voter=${claimant.address}&limit=200`);
        return !candidates.items?.some(
          (item: { rewardPoolId: string; contentId: string; roundId: string }) =>
            item.rewardPoolId === rewardPoolId && item.contentId === contentId && item.roundId === roundId.toString(),
        );
      },
      90_000,
      2_000,
      "correlation-bounty:claim-indexed",
    );
    expect(claimIndexed, "Ponder did not index the weighted bounty claim").toBe(true);
  });
});

async function ensureFrontendOperatorEligible(operator: `0x${string}`) {
  const eligible = await publicClient.readContract({
    address: CONTRACT_ADDRESSES.FrontendRegistry,
    abi: FrontendRegistryAbi,
    functionName: "isEligible",
    args: [operator],
  });
  if (eligible) return;

  const funded = await transferLREP(
    operator,
    FRONTEND_STAKE,
    DEPLOYER.address,
    CONTRACT_ADDRESSES.LoopReputation,
  );
  expect(funded, "Failed to fund the local correlation snapshot operator with LREP").toBe(true);

  const approved = await approveLREP(
    CONTRACT_ADDRESSES.FrontendRegistry,
    FRONTEND_STAKE,
    operator,
    CONTRACT_ADDRESSES.LoopReputation,
  );
  expect(approved, "Frontend operator LREP approval failed").toBe(true);

  const registered = await registerFrontend(operator, CONTRACT_ADDRESSES.FrontendRegistry);
  expect(registered, "Frontend operator registration failed").toBe(true);

  const nowEligible = await publicClient.readContract({
    address: CONTRACT_ADDRESSES.FrontendRegistry,
    abi: FrontendRegistryAbi,
    functionName: "isEligible",
    args: [operator],
  });
  expect(nowEligible, "Frontend operator is not eligible after registration").toBe(true);
}

async function settleThreeVoteRound(contentId: bigint) {
  const voters = [
    { account: ANVIL_ACCOUNTS.account3, isUp: true },
    { account: ANVIL_ACCOUNTS.account4, isUp: true },
    { account: ANVIL_ACCOUNTS.account7, isUp: false },
  ];
  const commits: { commitKey: Hex; isUp: boolean; salt: Hex }[] = [];

  for (const voter of voters) {
    const approved = await approveLREP(
      CONTRACT_ADDRESSES.RoundVotingEngine,
      STAKE,
      voter.account.address,
      CONTRACT_ADDRESSES.LoopReputation,
    );
    expect(approved, `Vote approval failed for ${voter.account.address}`).toBe(true);

    const commit = await commitVoteDirect(
      contentId,
      voter.isUp,
      STAKE,
      ZERO_ADDRESS,
      voter.account.address,
      CONTRACT_ADDRESSES.RoundVotingEngine,
    );
    expect(commit.success, `Vote commit failed for ${voter.account.address}`).toBe(true);
    commits.push({ commitKey: commit.commitKey, isUp: commit.isUp, salt: commit.salt });
  }

  const roundId = await getActiveRoundId(contentId, CONTRACT_ADDRESSES.RoundVotingEngine);
  expect(roundId, "Active round id should be present after USDC bounty votes").toBeGreaterThan(0n);

  await evmIncreaseTime(EPOCH_DURATION + 1);

  for (const commit of commits) {
    const revealed = await revealVoteDirect(
      contentId,
      roundId,
      commit.commitKey,
      commit.isUp,
      commit.salt,
      ANVIL_ACCOUNTS.account1.address,
      CONTRACT_ADDRESSES.RoundVotingEngine,
    );
    expect(revealed, "Vote reveal failed").toBe(true);
  }

  await evmIncreaseTime(EPOCH_DURATION + 1);
  const settled = await settleRoundDirect(
    contentId,
    roundId,
    ANVIL_ACCOUNTS.account1.address,
    CONTRACT_ADDRESSES.RoundVotingEngine,
  );
  expect(settled, "USDC bounty round did not settle").toBe(true);

  return { roundId };
}

async function publishAndFinalizeCorrelationSnapshotsWithKeeper(
  rewardPoolId: bigint,
  contentId: bigint,
  roundId: bigint,
) {
  const challengeWindow = await publicClient.readContract({
    address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
    abi: ClusterPayoutOracleAbi,
    functionName: "challengeWindow",
    args: [],
  });

  correlationKeeper = startCorrelationSnapshotKeeper();
  await waitForCorrelationEpochStatus(roundId, [SNAPSHOT_STATUS_PROPOSED, SNAPSHOT_STATUS_FINALIZED]);

  await evmIncreaseTime(Number(challengeWindow) + 1);
  await waitForCorrelationEpochStatus(roundId, [SNAPSHOT_STATUS_FINALIZED]);

  const snapshotKey = await publicClient.readContract({
    address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
    abi: ClusterPayoutOracleAbi,
    functionName: "roundPayoutSnapshotKey",
    args: [PAYOUT_DOMAIN_QUESTION_REWARD, rewardPoolId, contentId, roundId],
  });
  await waitForRoundPayoutSnapshotStatus(snapshotKey, [SNAPSHOT_STATUS_PROPOSED, SNAPSHOT_STATUS_FINALIZED]);

  await evmIncreaseTime(Number(challengeWindow) + 1);
  await waitForRoundPayoutSnapshotStatus(snapshotKey, [SNAPSHOT_STATUS_FINALIZED]);

  const snapshotIndexed = await waitForPonderIndexed(
    async () => {
      const snapshots = await ponderGet(
        `/correlation/snapshots?domain=${PAYOUT_DOMAIN_QUESTION_REWARD}&rewardPoolId=${rewardPoolId.toString()}&contentId=${contentId.toString()}&roundId=${roundId.toString()}`,
      );
      return snapshots.roundSnapshots?.some(
        (snapshot: { status: number | string }) => Number(snapshot.status) === SNAPSHOT_STATUS_FINALIZED,
      );
    },
    120_000,
    2_000,
    "correlation-bounty:snapshot-indexed",
  );
  expect(snapshotIndexed, "Ponder did not index the finalized round payout snapshot").toBe(true);
}

async function waitForClaimCandidateWithProof(
  voter: string,
  rewardPoolId: string,
  contentId: string,
  roundId: bigint,
) {
  let candidate: any;
  const found = await waitForPonderIndexed(
    async () => {
      const data = await ponderGet(`/question-reward-claim-candidates?voter=${voter}&limit=200`);
      candidate = data.items?.find(
        (item: { rewardPoolId: string; contentId: string; roundId: string; payoutWeight: unknown }) =>
          item.rewardPoolId === rewardPoolId &&
          item.contentId === contentId &&
          item.roundId === roundId.toString() &&
          item.payoutWeight,
      );
      return Boolean(candidate?.payoutWeight && Array.isArray(candidate?.payoutProof));
    },
    120_000,
    2_000,
    "correlation-bounty:claim-candidate-proof",
  );
  expect(found, "Ponder did not return a payout proof for the bounty claimant").toBe(true);
  return candidate;
}

function normalizePayoutWeight(value: any): PayoutWeight {
  return {
    domain: Number(value.domain),
    rewardPoolId: BigInt(value.rewardPoolId),
    contentId: BigInt(value.contentId),
    roundId: BigInt(value.roundId),
    commitKey: value.commitKey as Hex,
    identityKey: value.identityKey as Hex,
    account: getAddress(value.account) as `0x${string}`,
    baseWeight: BigInt(value.baseWeight),
    independenceBps: Number(value.independenceBps),
    effectiveWeight: BigInt(value.effectiveWeight),
    reasonHash: value.reasonHash as Hex,
  };
}

function startCorrelationSnapshotKeeper(): ChildProcess {
  correlationKeeperLogs.length = 0;
  const child = spawn("yarn", ["workspace", "@rateloop/keeper", "start"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CHAIN_ID: "31337",
      RPC_URL: E2E_RPC_URL,
      PONDER_BASE_URL: PONDER_URL,
      KEEPER_PRIVATE_KEY: ANVIL_ACCOUNTS.account1.privateKey,
      KEEPER_INTERVAL_MS: "1000",
      KEEPER_STARTUP_JITTER_MS: "0",
      KEEPER_CLEANUP_BATCH_SIZE: "1",
      KEEPER_FRONTEND_FEE_ENABLED: "false",
      KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
      KEEPER_CORRELATION_SNAPSHOTS_MODE: "auto",
      KEEPER_CORRELATION_ARTIFACT_STORAGE: "data-uri",
      KEEPER_CORRELATION_SNAPSHOT_MAX_ROUNDS_PER_TICK: "200",
      METRICS_ENABLED: "false",
      LOG_FORMAT: "json",
      MAX_GAS_PER_TX: "10000000",
      ADVISORY_VOTE_RECORDER_ADDRESS: CONTRACT_ADDRESSES.AdvisoryVoteRecorder,
      CONTENT_REGISTRY_ADDRESS: CONTRACT_ADDRESSES.ContentRegistry,
      VOTING_ENGINE_ADDRESS: CONTRACT_ADDRESSES.RoundVotingEngine,
      CLUSTER_PAYOUT_ORACLE_ADDRESS: CONTRACT_ADDRESSES.ClusterPayoutOracle,
      FRONTEND_REGISTRY_ADDRESS: CONTRACT_ADDRESSES.FrontendRegistry,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", chunk => collectKeeperOutput(chunk));
  child.stderr?.on("data", chunk => collectKeeperOutput(chunk));
  child.on("exit", (code, signal) => {
    correlationKeeperLogs.push(`[keeper exit] code=${code ?? "null"} signal=${signal ?? "null"}`);
  });
  return child;
}

function collectKeeperOutput(chunk: Buffer) {
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) correlationKeeperLogs.push(trimmed);
  }
  if (correlationKeeperLogs.length > 80) {
    correlationKeeperLogs.splice(0, correlationKeeperLogs.length - 80);
  }
}

async function stopCorrelationSnapshotKeeper() {
  const child = correlationKeeper;
  correlationKeeper = null;
  if (!child || child.exitCode !== null || child.killed) return;

  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function waitForCorrelationEpochStatus(epochId: bigint, acceptedStatuses: readonly number[]) {
  let lastStatus = SNAPSHOT_STATUS_NONE;
  const ok = await waitForPonderIndexed(
    async () => {
      const snapshot = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
        abi: ClusterPayoutOracleAbi,
        functionName: "correlationEpochSnapshot",
        args: [epochId],
      });
      lastStatus = Number(snapshot.status);
      return acceptedStatuses.includes(lastStatus);
    },
    120_000,
    2_000,
    `correlation-bounty:epoch-status-${acceptedStatuses.join("-")}`,
  );
  expect(
    ok,
    `Correlation epoch ${epochId.toString()} did not reach status ${acceptedStatuses.join(
      "/",
    )}; last=${lastStatus}; keeper logs:\n${correlationKeeperLogs.slice(-20).join("\n")}`,
  ).toBe(true);
  expect(lastStatus, `Correlation epoch ${epochId.toString()} was challenged`).not.toBe(SNAPSHOT_STATUS_CHALLENGED);
}

async function waitForRoundPayoutSnapshotStatus(snapshotKey: Hex, acceptedStatuses: readonly number[]) {
  let lastStatus = SNAPSHOT_STATUS_NONE;
  const ok = await waitForPonderIndexed(
    async () => {
      const proposal = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
        abi: ClusterPayoutOracleAbi,
        functionName: "roundPayoutProposal",
        args: [snapshotKey],
      });
      lastStatus = Number(proposal.snapshot.status);
      return acceptedStatuses.includes(lastStatus);
    },
    120_000,
    2_000,
    `correlation-bounty:round-snapshot-status-${acceptedStatuses.join("-")}`,
  );
  expect(
    ok,
    `Round payout snapshot ${snapshotKey} did not reach status ${acceptedStatuses.join(
      "/",
    )}; last=${lastStatus}; keeper logs:\n${correlationKeeperLogs.slice(-20).join("\n")}`,
  ).toBe(true);
  expect(lastStatus, `Round payout snapshot ${snapshotKey} was challenged`).not.toBe(SNAPSHOT_STATUS_CHALLENGED);
}
