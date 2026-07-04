import "./fetch-shim";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
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
import { PAYOUT_DOMAIN_QUESTION_REWARD, PAYOUT_DOMAIN_RBTS_SETTLEMENT } from "@rateloop/node-utils/correlationScoring";
import { expect } from "@playwright/test";
import { createPublicClient, getAddress, http, parseAbiItem, type Hex } from "viem";
import { foundry } from "viem/chains";

const SNAPSHOT_STATUS_NONE = 0;
const SNAPSHOT_STATUS_PROPOSED = 1;
const SNAPSHOT_STATUS_CHALLENGED = 2;
const SNAPSHOT_STATUS_FINALIZED = 3;
export const CORRELATION_E2E_STAKE = 10_000_000n;
const FRONTEND_STAKE = 1_000_000_000n;
const E2E_CORRELATION_EPOCH_OFFSET = 1_000_000_000n;
const E2E_RBTS_CORRELATION_EPOCH_OFFSET = 1_500_000_000n;
const ROUND_STATE_SETTLED = 1;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";
const REPO_ROOT = path.resolve(process.cwd(), "../..");
const PG_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ROUND_PAYOUT_SNAPSHOT_PROPOSED_EVENT = parseAbiItem(
  "event RoundPayoutSnapshotProposed(bytes32 indexed snapshotKey,uint8 indexed domain,uint256 indexed rewardPoolId,uint256 contentId,uint256 roundId,uint64 correlationEpochId,address frontendOperator,address proposer,uint32 rawEligibleVoters,uint32 effectiveParticipantUnits,uint256 totalClaimWeight,bytes32 weightRoot,bytes32 reasonRoot,bytes32 artifactHash,string artifactURI,uint64 challengeWindowAtProposal,uint64 finalizationVetoWindowAtProposal)",
);
const ROUND_CORE_STATE_ABI = [
  {
    name: "roundCore",
    type: "function",
    inputs: [
      { name: "contentId", type: "uint256" },
      { name: "roundId", type: "uint256" },
    ],
    outputs: [
      { name: "startTime", type: "uint48" },
      { name: "state", type: "uint8" },
      { name: "voteCount", type: "uint16" },
      { name: "revealedCount", type: "uint16" },
      { name: "totalStake", type: "uint64" },
      { name: "thresholdReachedAt", type: "uint48" },
      { name: "settledAt", type: "uint48" },
      { name: "upWins", type: "uint8" },
    ],
    stateMutability: "view",
  },
] as const;

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

  const correlationEpochId = E2E_CORRELATION_EPOCH_OFFSET + contentId;
  const artifactPath = await writeTargetedCorrelationArtifact(
    PAYOUT_DOMAIN_QUESTION_REWARD,
    rewardPoolId,
    contentId,
    roundId,
    correlationEpochId,
  );
  correlationKeeper = startCorrelationSnapshotKeeper(artifactPath);
  await waitForCorrelationEpochStatus(correlationEpochId, [SNAPSHOT_STATUS_PROPOSED, SNAPSHOT_STATUS_FINALIZED]);

  await evmIncreaseTime(Number(challengeWindow) + 1);
  await waitForCorrelationEpochStatus(correlationEpochId, [SNAPSHOT_STATUS_FINALIZED]);
  await advancePastCorrelationEpochVetoDeadline(correlationEpochId);

  await waitForRoundPayoutSnapshotStatus(PAYOUT_DOMAIN_QUESTION_REWARD, rewardPoolId, contentId, roundId, [
    SNAPSHOT_STATUS_PROPOSED,
    SNAPSHOT_STATUS_FINALIZED,
  ]);

  await evmIncreaseTime(Number(challengeWindow) + 1);
  await waitForRoundPayoutSnapshotStatus(PAYOUT_DOMAIN_QUESTION_REWARD, rewardPoolId, contentId, roundId, [
    SNAPSHOT_STATUS_FINALIZED,
  ]);
  await advancePastRoundPayoutSnapshotVetoDeadline(rewardPoolId, contentId, roundId);

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

export async function publishAndFinalizeRbtsSettlementWithKeeper(contentId: bigint, roundId: bigint) {
  const challengeWindow = await correlationPublicClient.readContract({
    address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
    abi: ClusterPayoutOracleAbi,
    functionName: "challengeWindow",
    args: [],
  });

  const correlationEpochId = E2E_RBTS_CORRELATION_EPOCH_OFFSET + contentId;
  const artifactPath = await writeTargetedCorrelationArtifact(
    PAYOUT_DOMAIN_RBTS_SETTLEMENT,
    0n,
    contentId,
    roundId,
    correlationEpochId,
  );
  correlationKeeper = startCorrelationSnapshotKeeper(artifactPath);
  await waitForCorrelationEpochStatus(correlationEpochId, [SNAPSHOT_STATUS_PROPOSED, SNAPSHOT_STATUS_FINALIZED]);

  await evmIncreaseTime(Number(challengeWindow) + 1);
  await waitForCorrelationEpochStatus(correlationEpochId, [SNAPSHOT_STATUS_FINALIZED]);
  await advancePastCorrelationEpochVetoDeadline(correlationEpochId);

  await waitForRoundPayoutSnapshotStatus(PAYOUT_DOMAIN_RBTS_SETTLEMENT, 0n, contentId, roundId, [
    SNAPSHOT_STATUS_PROPOSED,
    SNAPSHOT_STATUS_FINALIZED,
  ]);

  await evmIncreaseTime(Number(challengeWindow) + 1);
  await waitForRoundPayoutSnapshotStatus(PAYOUT_DOMAIN_RBTS_SETTLEMENT, 0n, contentId, roundId, [
    SNAPSHOT_STATUS_FINALIZED,
  ]);
  await advancePastRoundPayoutSnapshotVetoDeadline(0n, contentId, roundId, PAYOUT_DOMAIN_RBTS_SETTLEMENT);

  const applied = await waitForPonderIndexed(
    async () => {
      const round = await correlationPublicClient.readContract({
        address: CONTRACT_ADDRESSES.RoundVotingEngine,
        abi: ROUND_CORE_STATE_ABI,
        functionName: "roundCore",
        args: [contentId, roundId],
      });
      return Number(round[1]) === ROUND_STATE_SETTLED;
    },
    120_000,
    2_000,
    "rbts-settlement:snapshot-applied",
  );
  expect(
    applied,
    `RBTS settlement snapshot was not applied; keeper logs:\n${correlationKeeperLogs.slice(-20).join("\n")}`,
  ).toBe(true);
}

export async function pinLocalRbtsCorrelationInputSnapshots(contentId: bigint, roundId: bigint) {
  const databaseUrl = process.env.DATABASE_URL;
  expect(databaseUrl, "DATABASE_URL must be set for RBTS correlation input snapshot e2e setup").toBeTruthy();
  const round = await correlationPublicClient.readContract({
    address: CONTRACT_ADDRESSES.RoundVotingEngine,
    abi: ROUND_CORE_STATE_ABI,
    functionName: "roundCore",
    args: [contentId, roundId],
  });
  const expectedRevealedCount = Number(round[3]);
  expect(expectedRevealedCount, "RBTS settlement fixture needs revealed votes").toBeGreaterThan(0);

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  let lastState: Record<string, unknown> | null = null;
  try {
    const ponderSchema = await resolveLocalPonderSchema(pool);
    const voteTable = `${quotePgIdentifier(ponderSchema)}.${quotePgIdentifier("vote")}`;
    const roundTable = `${quotePgIdentifier(ponderSchema)}.${quotePgIdentifier("round")}`;
    const ready = await waitForPonderIndexed(
      async () => {
        await pool.query(
          `
            update ${voteTable}
            set
              correlation_verified_human = coalesce(correlation_verified_human, true),
              correlation_historical_vote_count = coalesce(correlation_historical_vote_count, 0),
              correlation_ban_reasons = coalesce(correlation_ban_reasons, '[]')
            where content_id = $1
              and round_id = $2
              and revealed = true
              and identity_key is not null
              and identity_holder is not null
              and identity_key != $3
              and rbts_weight is not null
              and rbts_weight > 0
          `,
          [contentId.toString(), roundId.toString(), ZERO_HASH],
        );

        const voteResult = await pool.query<{
          eligible_count: number;
          missing_snapshot_count: number;
        }>(
          `
            select
              count(*)::int as eligible_count,
              count(*) filter (
                where correlation_verified_human is null
                  or correlation_historical_vote_count is null
                  or correlation_ban_reasons is null
              )::int as missing_snapshot_count
            from ${voteTable}
            where content_id = $1
              and round_id = $2
              and revealed = true
              and identity_key is not null
              and identity_holder is not null
              and identity_key != $3
              and rbts_weight is not null
              and rbts_weight > 0
          `,
          [contentId.toString(), roundId.toString(), ZERO_HASH],
        );
        const roundResult = await pool.query<{
          rbts_settlement_pending_at: string | null;
          rbts_settlement_pending_block_number: string | null;
          rbts_settlement_pending_log_index: number | null;
          rbts_settlement_pending_tx_hash: string | null;
        }>(
          `
            select
              rbts_settlement_pending_at,
              rbts_settlement_pending_block_number,
              rbts_settlement_pending_log_index,
              rbts_settlement_pending_tx_hash
            from ${roundTable}
            where content_id = $1
              and round_id = $2
              and state = 5
              and rbts_settlement_status = 'pending'
            limit 1
          `,
          [contentId.toString(), roundId.toString()],
        );
        const voteRow = voteResult.rows[0];
        const roundRow = roundResult.rows[0];
        const roundSourceReady =
          roundRow !== undefined &&
          roundRow.rbts_settlement_pending_at !== null &&
          roundRow.rbts_settlement_pending_block_number !== null &&
          roundRow.rbts_settlement_pending_log_index !== null &&
          roundRow.rbts_settlement_pending_tx_hash !== null;
        lastState = {
          eligibleCount: voteRow?.eligible_count ?? 0,
          expectedRevealedCount,
          missingSnapshotCount: voteRow?.missing_snapshot_count ?? 0,
          roundSourceReady,
        };
        return (
          (voteRow?.eligible_count ?? 0) === expectedRevealedCount &&
          (voteRow?.missing_snapshot_count ?? 0) === 0 &&
          roundSourceReady
        );
      },
      120_000,
      2_000,
      "rbts-settlement:pin-correlation-inputs",
    );

    expect(
      ready,
      `Ponder did not expose pinned RBTS correlation inputs for ${contentId.toString()}/${roundId.toString()}; last=${JSON.stringify(
        lastState,
      )}`,
    ).toBe(true);
  } finally {
    await pool.end();
  }
}

async function resolveLocalPonderSchema(pool: import("pg").Pool) {
  const configured =
    process.env.RATELOOP_PONDER_DATABASE_SCHEMA?.trim() || process.env.DATABASE_SCHEMA?.trim();
  if (configured) return configured;

  const result = await pool.query<{ table_schema: string }>(
    `
      select table_schema
      from information_schema.tables
      where table_name = 'vote'
        and table_schema not in ('pg_catalog', 'information_schema')
      order by
        case table_schema
          when 'rateloop_ponder_ci' then 0
          when 'rateloop_ponder_hardhat' then 1
          when 'rateloop_ponder' then 2
          else 3
        end,
        table_schema
      limit 1
    `,
  );
  const schema = result.rows[0]?.table_schema;
  expect(schema, "Ponder vote table schema should be discoverable for RBTS e2e setup").toBeTruthy();
  return schema;
}

function quotePgIdentifier(identifier: string) {
  if (!PG_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid Postgres identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

async function advancePastTimestamp(deadline: bigint, label: string) {
  if (deadline === 0n) {
    throw new Error(`${label} veto deadline is unavailable before finalization`);
  }

  const block = await correlationPublicClient.getBlock();
  if (block.timestamp >= deadline) return;

  await evmIncreaseTime(Number(deadline - block.timestamp) + 1);
}

export async function advancePastCorrelationEpochVetoDeadline(epochId: bigint) {
  const deadline = await correlationPublicClient.readContract({
    address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
    abi: ClusterPayoutOracleAbi,
    functionName: "correlationEpochVetoDeadline",
    args: [epochId],
  });
  await advancePastTimestamp(deadline, `Correlation epoch ${epochId.toString()}`);
}

export async function advancePastRoundPayoutSnapshotVetoDeadline(
  rewardPoolId: bigint,
  contentId: bigint,
  roundId: bigint,
  domain = PAYOUT_DOMAIN_QUESTION_REWARD,
) {
  const deadline = await correlationPublicClient.readContract({
    address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
    abi: ClusterPayoutOracleAbi,
    functionName: "roundPayoutSnapshotVetoDeadline",
    args: [domain, rewardPoolId, contentId, roundId],
  });
  await advancePastTimestamp(deadline, `Round payout snapshot ${contentId.toString()}/${roundId.toString()}`);
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
    KEEPER_CORRELATION_SNAPSHOT_PUBLIC_BASE_URL: undefined,
    KEEPER_CORRELATION_SNAPSHOT_STORAGE_DIR: undefined,
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
  domain: number,
  rewardPoolId: bigint,
  contentId: bigint,
  roundId: bigint,
  correlationEpochId: bigint,
) {
  const artifactPath = path.join(
    tmpdir(),
    `rateloop-correlation-${process.pid}-${Date.now()}-${randomUUID()}.json`,
  );
  try {
    await runKeeperArtifactBuilder(
      artifactPath,
      domain,
      rewardPoolId,
      contentId,
      roundId,
      correlationEpochId,
    );
  } catch (error) {
    await unlink(artifactPath).catch(() => {});
    throw error;
  }
  return artifactPath;
}

async function runKeeperArtifactBuilder(
  artifactPath: string,
  domain: number,
  rewardPoolId: bigint,
  contentId: bigint,
  roundId: bigint,
  correlationEpochId: bigint,
) {
  const child = spawn(
    "yarn",
    [
      "workspace",
      "@rateloop/keeper",
      "build:correlation-artifact",
      "--domain",
      String(domain),
      "--reward-pool-id",
      rewardPoolId.toString(),
      "--content-id",
      contentId.toString(),
      "--correlation-epoch-id",
      correlationEpochId.toString(),
      "--round-id",
      roundId.toString(),
      "--out",
      artifactPath,
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        ...correlationKeeperEnvOverrides(),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const collect = (chunk: Buffer) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-20_000);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Correlation artifact builder exited with code ${code ?? "null"}:\n${output}`));
    });
  });
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

async function waitForRoundPayoutSnapshotStatus(
  domain: number,
  rewardPoolId: bigint,
  contentId: bigint,
  roundId: bigint,
  acceptedStatuses: readonly number[],
) {
  let lastStatus = SNAPSHOT_STATUS_NONE;
  const ok = await waitForPonderIndexed(
    async () => {
      const snapshot = await correlationPublicClient.readContract({
        address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
        abi: ClusterPayoutOracleAbi,
        functionName: "getRoundPayoutSnapshot",
        args: [domain, rewardPoolId, contentId, roundId],
      });
      lastStatus = Number(snapshot.status);
      return acceptedStatuses.includes(lastStatus);
    },
    120_000,
    2_000,
    `correlation-bounty:round-snapshot-status-${domain}-${acceptedStatuses.join("-")}`,
  );
  expect(
    ok,
    `Round payout snapshot ${domain}/${contentId.toString()}/${roundId.toString()} did not reach status ${acceptedStatuses.join(
      "/",
    )}; last=${lastStatus}; keeper logs:\n${correlationKeeperLogs.slice(-20).join("\n")}`,
  ).toBe(true);
  expect(lastStatus, `Round payout snapshot ${domain}/${contentId.toString()}/${roundId.toString()} was challenged`).not
    .toBe(SNAPSHOT_STATUS_CHALLENGED);
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
  const events = await correlationPublicClient.getContractEvents({
    address: CONTRACT_ADDRESSES.ClusterPayoutOracle,
    abi: [ROUND_PAYOUT_SNAPSHOT_PROPOSED_EVENT],
    eventName: "RoundPayoutSnapshotProposed",
    args: { snapshotKey },
    fromBlock: 0n,
    toBlock: "latest",
  });
  const artifactUri = events.at(-1)?.args.artifactURI;
  expect(artifactUri, "round payout proposal should carry an artifact URI").toBeTruthy();
  if (!artifactUri) {
    throw new Error(`Round payout proposal ${snapshotKey} did not emit an artifact URI`);
  }
  const artifact = await readCorrelationArtifact(artifactUri);
  const snapshot = artifact.roundPayoutSnapshots?.find(
    (item: { rewardPoolId?: string; contentId?: string; roundId?: string }) =>
      item.rewardPoolId === rewardPoolId.toString() &&
      item.contentId === contentId.toString() &&
      item.roundId === roundId.toString(),
  );
  expect(snapshot, "artifact should include the finalized round payout snapshot").toBeTruthy();
  return snapshot as CorrelationRoundPayoutArtifact;
}

async function readCorrelationArtifact(artifactUri: string): Promise<{
  roundPayoutSnapshots?: Array<{ rewardPoolId?: string; contentId?: string; roundId?: string }>;
}> {
  if (artifactUri.startsWith("data:")) {
    const encoded = artifactUri.slice(artifactUri.indexOf(",") + 1);
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  }

  const response = await fetch(artifactUri, { headers: { accept: "application/json" } });
  expect(response.ok, `artifact fetch failed for ${artifactUri}`).toBe(true);
  return (await response.json()) as {
    roundPayoutSnapshots?: Array<{ rewardPoolId?: string; contentId?: string; roundId?: string }>;
  };
}
