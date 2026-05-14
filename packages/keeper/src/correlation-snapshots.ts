import { readFile } from "node:fs/promises";
import type { Account, Chain, PublicClient, WalletClient } from "viem";
import { ClusterPayoutOracleAbi } from "@rateloop/contracts/abis";
import type { Logger } from "./logger.js";
import { config } from "./config.js";

const STATUS = {
  None: 0,
  Proposed: 1,
  Finalized: 3,
  Rejected: 4,
} as const;

interface CorrelationSnapshotPublisherResult {
  epochsProposed: number;
  epochsFinalized: number;
  roundSnapshotsProposed: number;
  roundSnapshotsFinalized: number;
}

interface CorrelationEpochArtifact {
  epochId: string | number | bigint;
  fromRoundId: string | number | bigint;
  toRoundId: string | number | bigint;
  clusterRoot: `0x${string}`;
  parameterHash: `0x${string}`;
  artifactHash: `0x${string}`;
  artifactURI: string;
}

interface RoundPayoutSnapshotArtifact {
  domain: number;
  rewardPoolId: string | number | bigint;
  contentId: string | number | bigint;
  roundId: string | number | bigint;
  correlationEpochId: string | number | bigint;
  rawEligibleVoters: number;
  effectiveParticipantUnits: number;
  totalClaimWeight: string | number | bigint;
  weightRoot: `0x${string}`;
  reasonRoot: `0x${string}`;
  artifactHash: `0x${string}`;
  artifactURI: string;
}

interface CorrelationSnapshotArtifactFile {
  correlationEpochs?: CorrelationEpochArtifact[];
  roundPayoutSnapshots?: RoundPayoutSnapshotArtifact[];
}

function emptyResult(): CorrelationSnapshotPublisherResult {
  return {
    epochsProposed: 0,
    epochsFinalized: 0,
    roundSnapshotsProposed: 0,
    roundSnapshotsFinalized: 0,
  };
}

export async function publishConfiguredCorrelationSnapshots(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
): Promise<CorrelationSnapshotPublisherResult> {
  if (
    !config.correlationSnapshots.enabled ||
    !config.correlationSnapshots.artifactPath
  ) {
    return emptyResult();
  }

  const artifact = JSON.parse(
    await readFile(config.correlationSnapshots.artifactPath, "utf8"),
  ) as CorrelationSnapshotArtifactFile;
  const result = emptyResult();
  const bond = BigInt(config.correlationSnapshots.proposalBondWei);

  for (const epoch of artifact.correlationEpochs ?? []) {
    const epochId = BigInt(epoch.epochId);
    const existing = await publicClient.readContract({
      address: config.contracts.clusterPayoutOracle,
      abi: ClusterPayoutOracleAbi,
      functionName: "correlationEpochSnapshot",
      args: [epochId],
    });
    const status = Number(existing.status);
    if (status === STATUS.None || status === STATUS.Rejected) {
      await walletClient.writeContract({
        account,
        chain,
        address: config.contracts.clusterPayoutOracle,
        abi: ClusterPayoutOracleAbi,
        functionName: "proposeCorrelationEpoch",
        args: [
          epochId,
          BigInt(epoch.fromRoundId),
          BigInt(epoch.toRoundId),
          epoch.clusterRoot,
          epoch.parameterHash,
          epoch.artifactHash,
          epoch.artifactURI,
        ],
        value: bond,
      });
      result.epochsProposed += 1;
      logger.info("Proposed correlation epoch snapshot", {
        epochId: epochId.toString(),
      });
    } else if (status === STATUS.Proposed) {
      try {
        await walletClient.writeContract({
          account,
          chain,
          address: config.contracts.clusterPayoutOracle,
          abi: ClusterPayoutOracleAbi,
          functionName: "finalizeCorrelationEpoch",
          args: [epochId],
        });
        result.epochsFinalized += 1;
        logger.info("Finalized correlation epoch snapshot", {
          epochId: epochId.toString(),
        });
      } catch (error) {
        logger.debug("Correlation epoch snapshot not finalizable yet", {
          epochId: epochId.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  for (const snapshot of artifact.roundPayoutSnapshots ?? []) {
    const snapshotKey = await publicClient.readContract({
      address: config.contracts.clusterPayoutOracle,
      abi: ClusterPayoutOracleAbi,
      functionName: "roundPayoutSnapshotKey",
      args: [
        snapshot.domain,
        BigInt(snapshot.rewardPoolId),
        BigInt(snapshot.contentId),
        BigInt(snapshot.roundId),
      ],
    });

    let status: number = STATUS.None;
    try {
      const existing = await publicClient.readContract({
        address: config.contracts.clusterPayoutOracle,
        abi: ClusterPayoutOracleAbi,
        functionName: "roundPayoutProposal",
        args: [snapshotKey],
      });
      status = Number(existing.snapshot.status);
    } catch {
      status = STATUS.None;
    }

    if (status === STATUS.None || status === STATUS.Rejected) {
      await walletClient.writeContract({
        account,
        chain,
        address: config.contracts.clusterPayoutOracle,
        abi: ClusterPayoutOracleAbi,
        functionName: "proposeRoundPayoutSnapshot",
        args: [
          {
            domain: snapshot.domain,
            rewardPoolId: BigInt(snapshot.rewardPoolId),
            contentId: BigInt(snapshot.contentId),
            roundId: BigInt(snapshot.roundId),
            correlationEpochId: BigInt(snapshot.correlationEpochId),
            rawEligibleVoters: snapshot.rawEligibleVoters,
            effectiveParticipantUnits: snapshot.effectiveParticipantUnits,
            totalClaimWeight: BigInt(snapshot.totalClaimWeight),
            weightRoot: snapshot.weightRoot,
            reasonRoot: snapshot.reasonRoot,
            artifactHash: snapshot.artifactHash,
            artifactURI: snapshot.artifactURI,
          },
        ],
        value: bond,
      });
      result.roundSnapshotsProposed += 1;
      logger.info("Proposed round payout snapshot", { snapshotKey });
    } else if (status === STATUS.Proposed) {
      try {
        await walletClient.writeContract({
          account,
          chain,
          address: config.contracts.clusterPayoutOracle,
          abi: ClusterPayoutOracleAbi,
          functionName: "finalizeRoundPayoutSnapshot",
          args: [snapshotKey],
        });
        result.roundSnapshotsFinalized += 1;
        logger.info("Finalized round payout snapshot", { snapshotKey });
      } catch (error) {
        logger.debug("Round payout snapshot not finalizable yet", {
          snapshotKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return result;
}
