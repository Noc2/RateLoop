import "./fetch-shim";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  approveLREP,
  commitVoteDirect,
  evmIncreaseTime,
  getActiveRoundId,
  registerFrontend,
  revealVoteDirect,
  settleRoundDirect,
  transferLREP,
  waitForPonderIndexed,
} from "./admin-helpers";
import { ANVIL_ACCOUNTS, DEPLOYER } from "./anvil-accounts";
import { CONTRACT_ADDRESSES } from "./contracts";
import { ponderGet } from "./ponder-api";
import { E2E_RPC_URL, PONDER_URL } from "./service-urls";
import { ClusterPayoutOracleAbi, FrontendRegistryAbi } from "@rateloop/contracts/abis";
import { PAYOUT_DOMAIN_QUESTION_REWARD } from "@rateloop/node-utils/correlationScoring";
import { expect } from "@playwright/test";
import { createPublicClient, getAddress, http, type Hex } from "viem";
import { foundry } from "viem/chains";

const SNAPSHOT_STATUS_NONE = 0;
const SNAPSHOT_STATUS_PROPOSED = 1;
const SNAPSHOT_STATUS_CHALLENGED = 2;
const SNAPSHOT_STATUS_FINALIZED = 3;
export const CORRELATION_E2E_STAKE = 10_000_000n;
const FRONTEND_STAKE = 1_000_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const REPO_ROOT = path.resolve(process.cwd(), "../..");

export const correlationPublicClient = createPublicClient({
  chain: foundry,
  transport: http(E2E_RPC_URL),
});

let correlationKeeper: ChildProcess | null = null;
let correlationKeeperArtifactPath: string | null = null;
const correlationKeeperLogs: string[] = [];

type AnvilAccount = (typeof ANVIL_ACCOUNTS)[keyof typeof ANVIL_ACCOUNTS];

export type CorrelationVoteInput = {
  account: AnvilAccount;
  isUp: boolean;
  stake?: bigint;
};

export type PayoutWeight = {
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

export type CorrelationArtifactPayoutWeight = {
  account: `0x${string}`;
  baseWeight: string;
  commitKey: Hex;
  effectiveWeight: string;
  identityKey: Hex;
  independenceBps: number;
  surpriseBps: number;
};

export type CorrelationRoundPayoutArtifact = {
  payoutWeights: CorrelationArtifactPayoutWeight[];
  totalClaimWeight: string;
  trailingBaseRateUpBps?: number;
};

export async function ensureFrontendOperatorEligible(operator: `0x${string}`) {
  const eligible = await correlationPublicClient.readContract({
    address: CONTRACT_ADDRESSES.FrontendRegistry,
    abi: FrontendRegistryAbi,
    functionName: "isEligible",
    args: [operator],
  });
  if (eligible) return;

  const funded = await transferLREP(operator, FRONTEND_STAKE, DEPLOYER.address, CONTRACT_ADDRESSES.LoopReputation);
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

  const nowEligible = await correlationPublicClient.readContract({
    address: CONTRACT_ADDRESSES.FrontendRegistry,
    abi: FrontendRegistryAbi,
    functionName: "isEligible",
    args: [operator],
  });
  expect(nowEligible, "Frontend operator is not eligible after registration").toBe(true);
}

export async function settleRoundWithVotes(
  contentId: bigint,
  votes: readonly CorrelationVoteInput[],
  { epochDuration, revealer = ANVIL_ACCOUNTS.account1 }: { epochDuration: number; revealer?: AnvilAccount },
) {
  const commits: { commitKey: Hex; isUp: boolean; salt: Hex }[] = [];

  for (const voter of votes) {
    const stake = voter.stake ?? CORRELATION_E2E_STAKE;
    const funded = await transferLREP(
      voter.account.address,
      stake,
      DEPLOYER.address,
      CONTRACT_ADDRESSES.LoopReputation,
    );
    expect(funded, `Vote funding failed for ${voter.account.address}`).toBe(true);

    const approved = await approveLREP(
      CONTRACT_ADDRESSES.RoundVotingEngine,
      stake,
      voter.account.address,
      CONTRACT_ADDRESSES.LoopReputation,
    );
    expect(approved, `Vote approval failed for ${voter.account.address}`).toBe(true);

    const commit = await commitVoteDirect(
      contentId,
      voter.isUp,
      stake,
      ZERO_ADDRESS,
      voter.account.address,
      CONTRACT_ADDRESSES.RoundVotingEngine,
      epochDuration,
    );
    expect(commit.success, `Vote commit failed for ${voter.account.address}`).toBe(true);
    commits.push({ commitKey: commit.commitKey, isUp: commit.isUp, salt: commit.salt });
  }

  const roundId = await getActiveRoundId(contentId, CONTRACT_ADDRESSES.RoundVotingEngine);
  expect(roundId, "Active round id should be present after correlation votes").toBeGreaterThan(0n);

  await evmIncreaseTime(epochDuration + 1);

  for (const commit of commits) {
    const revealed = await revealVoteDirect(
      contentId,
      roundId,
      commit.commitKey,
      commit.isUp,
      commit.salt,
      revealer.address,
      CONTRACT_ADDRESSES.RoundVotingEngine,
    );
    expect(revealed, "Vote reveal failed").toBe(true);
  }

  await evmIncreaseTime(epochDuration + 1);
  const settled = await settleRoundDirect(
    contentId,
    roundId,
    revealer.address,
    CONTRACT_ADDRESSES.RoundVotingEngine,
  );
  expect(settled, "Correlation bounty round did not settle").toBe(true);

  return { roundId };
}

export async function publishAndFinalizeCorrelationSnapshotsWithKeeper(
  rewardPoolId: bigint,
  contentId: bigint,
  roundId: bigint,
) {
  const challengeWindow = await correlationPublicClient.readContract({
    address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
    abi: ClusterPayoutOracleAbi,
    functionName: "challengeWindow",
    args: [],
  });

  const artifactPath = await writeTargetedCorrelationArtifact(rewardPoolId, contentId, roundId);
  correlationKeeper = startCorrelationSnapshotKeeper(artifactPath);
  await waitForCorrelationEpochStatus(roundId, [SNAPSHOT_STATUS_PROPOSED, SNAPSHOT_STATUS_FINALIZED]);

  await evmIncreaseTime(Number(challengeWindow) + 1);
  await waitForCorrelationEpochStatus(roundId, [SNAPSHOT_STATUS_FINALIZED]);

  const snapshotKey = await getRoundPayoutSnapshotKey(rewardPoolId, contentId, roundId);
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

export async function waitForClaimCandidateWithProof(
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

export function normalizePayoutWeight(value: any): PayoutWeight {
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

export function startCorrelationSnapshotKeeper(artifactPath?: string): ChildProcess {
  correlationKeeperLogs.length = 0;
  correlationKeeperArtifactPath = artifactPath ?? null;
  const child = spawn("yarn", ["workspace", "@rateloop/keeper", "start"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...correlationKeeperEnvOverrides(artifactPath),
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

export async function stopCorrelationSnapshotKeeper() {
  const child = correlationKeeper;
  const artifactPath = correlationKeeperArtifactPath;
  correlationKeeper = null;
  correlationKeeperArtifactPath = null;

  if (child && child.exitCode === null && !child.killed) {
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
  if (artifactPath) await unlink(artifactPath).catch(() => {});
}

function correlationKeeperEnvOverrides(artifactPath?: string) {
  return {
    CHAIN_ID: "31337",
    RPC_URL: E2E_RPC_URL,
    PONDER_BASE_URL: PONDER_URL,
    KEEPER_PRIVATE_KEY: ANVIL_ACCOUNTS.account1.privateKey,
    KEEPER_INTERVAL_MS: "1000",
    KEEPER_STARTUP_JITTER_MS: "0",
    KEEPER_CLEANUP_BATCH_SIZE: "1",
    KEEPER_FRONTEND_FEE_ENABLED: "false",
    KEEPER_CORRELATION_SNAPSHOTS_ENABLED: "true",
    KEEPER_CORRELATION_SNAPSHOTS_MODE: artifactPath ? "file" : "auto",
    KEEPER_CORRELATION_SNAPSHOT_ARTIFACT_PATH: artifactPath,
    KEEPER_CORRELATION_ARTIFACT_STORAGE: "data-uri",
    KEEPER_CORRELATION_SNAPSHOT_MAX_ROUNDS_PER_TICK: "20",
    METRICS_ENABLED: "false",
    LOG_FORMAT: "json",
    MAX_GAS_PER_TX: "30000000",
    ADVISORY_VOTE_RECORDER_ADDRESS: CONTRACT_ADDRESSES.AdvisoryVoteRecorder,
    CONTENT_REGISTRY_ADDRESS: CONTRACT_ADDRESSES.ContentRegistry,
    VOTING_ENGINE_ADDRESS: CONTRACT_ADDRESSES.RoundVotingEngine,
    CLUSTER_PAYOUT_ORACLE_ADDRESS: CONTRACT_ADDRESSES.ClusterPayoutOracle,
    FRONTEND_REGISTRY_ADDRESS: CONTRACT_ADDRESSES.FrontendRegistry,
  };
}

async function writeTargetedCorrelationArtifact(
  rewardPoolId: bigint,
  contentId: bigint,
  roundId: bigint,
) {
  const envOverrides = correlationKeeperEnvOverrides();
  const previousEnv = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(envOverrides)) {
    previousEnv.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    const { buildConfiguredCorrelationSnapshotArtifactForCandidates } = await import(
      "../../../keeper/src/correlation-artifact-builder"
    );
    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    const built = await buildConfiguredCorrelationSnapshotArtifactForCandidates(
      [
        {
          domain: PAYOUT_DOMAIN_QUESTION_REWARD,
          rewardPoolId,
          contentId,
          roundId,
        },
      ],
      logger,
    );
    expect(built.roundSnapshotCount, "Targeted correlation artifact should contain one round snapshot").toBe(1);
    expect(built.epochCount, "Targeted correlation artifact should contain one epoch").toBe(1);

    const artifactPath = path.join(
      tmpdir(),
      `rateloop-correlation-${process.pid}-${Date.now()}-${randomUUID()}.json`,
    );
    await writeFile(artifactPath, JSON.stringify(built.artifact), "utf8");
    return artifactPath;
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function waitForCorrelationEpochStatus(epochId: bigint, acceptedStatuses: readonly number[]) {
  let lastStatus = SNAPSHOT_STATUS_NONE;
  const ok = await waitForPonderIndexed(
    async () => {
      const snapshot = await correlationPublicClient.readContract({
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
      const proposal = await correlationPublicClient.readContract({
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

export async function getRoundPayoutSnapshotKey(rewardPoolId: bigint, contentId: bigint, roundId: bigint) {
  return correlationPublicClient.readContract({
    address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
    abi: ClusterPayoutOracleAbi,
    functionName: "roundPayoutSnapshotKey",
    args: [PAYOUT_DOMAIN_QUESTION_REWARD, rewardPoolId, contentId, roundId],
  });
}

export async function readRoundPayoutArtifact(rewardPoolId: bigint, contentId: bigint, roundId: bigint) {
  const snapshotKey = await getRoundPayoutSnapshotKey(rewardPoolId, contentId, roundId);
  const proposal = await correlationPublicClient.readContract({
    address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
    abi: ClusterPayoutOracleAbi,
    functionName: "roundPayoutProposal",
    args: [snapshotKey],
  });
  const artifactUri = proposal.artifactURI;
  expect(artifactUri, "round payout proposal should carry an artifact URI").toMatch(
    /^data:application\/json;base64,/,
  );

  const encoded = artifactUri.slice("data:application/json;base64,".length);
  const artifact = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  const snapshot = artifact.roundPayoutSnapshots?.find(
    (item: { rewardPoolId?: string; contentId?: string; roundId?: string }) =>
      item.rewardPoolId === rewardPoolId.toString() &&
      item.contentId === contentId.toString() &&
      item.roundId === roundId.toString(),
  );
  expect(snapshot, "artifact should include the finalized round payout snapshot").toBeTruthy();
  return snapshot as CorrelationRoundPayoutArtifact;
}
