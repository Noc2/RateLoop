import { readFile } from "node:fs/promises";
import type { Account, Chain, PublicClient, WalletClient } from "viem";
import {
  ClusterPayoutOracleAbi,
  FrontendRegistryAbi,
  QuestionRewardPoolEscrowAbi,
} from "@rateloop/contracts/abis";
import type { Address } from "viem";
import type { Logger } from "./logger.js";
import { config } from "./config.js";
import { buildConfiguredCorrelationSnapshotArtifact } from "./correlation-artifact-builder.js";
import { writeContractAndConfirm } from "./keeper.js";
import { getRevertReason } from "./revert-utils.js";

const STATUS = {
  None: 0,
  Proposed: 1,
  Challenged: 2,
  Finalized: 3,
  Rejected: 4,
} as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

interface CorrelationSnapshotPublisherResult {
  epochsProposed: number;
  epochsFinalized: number;
  roundSnapshotsProposed: number;
  roundSnapshotsFinalized: number;
}

export interface CorrelationEpochArtifact {
  epochId: string | number | bigint;
  fromRoundId: string | number | bigint;
  toRoundId: string | number | bigint;
  clusterRoot: `0x${string}`;
  parameterHash: `0x${string}`;
  artifactHash: `0x${string}`;
  artifactURI: string;
}

export interface RoundPayoutSnapshotArtifact {
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

export interface CorrelationSnapshotArtifactFile {
  correlationEpochs?: CorrelationEpochArtifact[];
  roundPayoutSnapshots?: RoundPayoutSnapshotArtifact[];
}

interface SnapshotProposerAuthorization {
  authorized: boolean;
  frontendOperator?: Address;
}

function emptyResult(): CorrelationSnapshotPublisherResult {
  return {
    epochsProposed: 0,
    epochsFinalized: 0,
    roundSnapshotsProposed: 0,
    roundSnapshotsFinalized: 0,
  };
}

async function readSnapshotProposerAuthorization(
  publicClient: PublicClient,
  account: Account,
  logger: Logger,
): Promise<SnapshotProposerAuthorization> {
  const frontendRegistry = config.correlationSnapshots.frontendRegistry;
  if (!frontendRegistry) {
    logger.warn(
      "Skipping correlation snapshot proposals because no frontend registry is configured",
      {
        snapshotProposer: account.address,
      },
    );
    return { authorized: false };
  }

  try {
    const frontendOperator = (await publicClient.readContract({
      address: frontendRegistry,
      abi: FrontendRegistryAbi,
      functionName: "authorizedSnapshotFrontend",
      args: [account.address],
    })) as Address;
    const authorized = frontendOperator !== ZERO_ADDRESS;

    const data = {
      snapshotProposer: account.address,
      frontendOperator,
      frontendRegistry,
      eligible: authorized,
    };
    if (authorized) {
      logger.debug("Correlation snapshot proposer authorization confirmed", data);
    } else {
      logger.warn(
        "Skipping correlation snapshot proposals because keeper is not authorized by an eligible frontend",
        data,
      );
    }
    return { authorized, frontendOperator: authorized ? frontendOperator : undefined };
  } catch (error: unknown) {
    logger.warn(
      "Skipping correlation snapshot proposals because frontend proposer authorization could not be read",
      {
        snapshotProposer: account.address,
        frontendRegistry,
        error: getRevertReason(error),
      },
    );
    return { authorized: false };
  }
}

async function loadConfiguredCorrelationSnapshotArtifact(
  logger: Logger,
): Promise<CorrelationSnapshotArtifactFile | null> {
  if (!config.correlationSnapshots.enabled) {
    return null;
  }

  if (config.correlationSnapshots.mode === "auto") {
    return buildConfiguredCorrelationSnapshotArtifact(logger);
  }

  if (!config.correlationSnapshots.artifactPath) {
    return null;
  }

  return JSON.parse(
    await readFile(config.correlationSnapshots.artifactPath, "utf8"),
  ) as CorrelationSnapshotArtifactFile;
}

async function roundSnapshotSourceReady(
  publicClient: PublicClient,
  snapshot: RoundPayoutSnapshotArtifact,
  logger: Logger,
): Promise<boolean> {
  try {
    const consumer = (await publicClient.readContract({
      address: config.contracts.clusterPayoutOracle,
      abi: ClusterPayoutOracleAbi,
      functionName: "roundPayoutSnapshotConsumer",
      args: [snapshot.domain],
    })) as Address;
    if (consumer === "0x0000000000000000000000000000000000000000") {
      logger.warn("Skipping round payout snapshot because no consumer is configured", {
        domain: snapshot.domain,
        rewardPoolId: snapshot.rewardPoolId.toString(),
        contentId: snapshot.contentId.toString(),
        roundId: snapshot.roundId.toString(),
      });
      return false;
    }

    const sourceReadyAt = (await publicClient.readContract({
      address: consumer,
      abi: QuestionRewardPoolEscrowAbi,
      functionName: "roundPayoutSnapshotSourceReadyAt",
      args: [
        snapshot.domain,
        BigInt(snapshot.rewardPoolId),
        BigInt(snapshot.contentId),
        BigInt(snapshot.roundId),
      ],
    })) as bigint;
    if (sourceReadyAt === 0n) {
      logger.debug("Skipping round payout snapshot until source is ready", {
        domain: snapshot.domain,
        rewardPoolId: snapshot.rewardPoolId.toString(),
        contentId: snapshot.contentId.toString(),
        roundId: snapshot.roundId.toString(),
      });
      return false;
    }

    const block = await publicClient.getBlock();
    if (sourceReadyAt > block.timestamp) {
      logger.debug("Skipping round payout snapshot until source timestamp is reached", {
        domain: snapshot.domain,
        rewardPoolId: snapshot.rewardPoolId.toString(),
        contentId: snapshot.contentId.toString(),
        roundId: snapshot.roundId.toString(),
        sourceReadyAt: sourceReadyAt.toString(),
        blockTimestamp: block.timestamp.toString(),
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.warn("Skipping round payout snapshot because source readiness could not be read", {
      domain: snapshot.domain,
      rewardPoolId: snapshot.rewardPoolId.toString(),
      contentId: snapshot.contentId.toString(),
      roundId: snapshot.roundId.toString(),
      error: getRevertReason(error),
    });
    return false;
  }
}

export async function publishConfiguredCorrelationSnapshots(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
): Promise<CorrelationSnapshotPublisherResult> {
  const artifact = await loadConfiguredCorrelationSnapshotArtifact(logger);
  if (!artifact) {
    return emptyResult();
  }

  const result = emptyResult();
  if (
    (artifact.correlationEpochs ?? []).length === 0 &&
    (artifact.roundPayoutSnapshots ?? []).length === 0
  ) {
    return result;
  }

  const snapshotProposerAuthorization = await readSnapshotProposerAuthorization(
    publicClient,
    account,
    logger,
  );
  const finalizedEpochIds = new Set<string>();

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
      if (!snapshotProposerAuthorization.authorized) {
        logger.debug(
          "Skipping correlation epoch proposal until keeper is authorized by an eligible frontend",
          {
            epochId: epochId.toString(),
            snapshotProposer: account.address,
            frontendOperator: snapshotProposerAuthorization.frontendOperator,
          },
        );
        continue;
      }

      try {
        await writeContractAndConfirm(publicClient, walletClient, {
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
        });
        result.epochsProposed += 1;
        logger.info("Proposed correlation epoch snapshot", {
          epochId: epochId.toString(),
        });
      } catch (error) {
        logger.warn("Correlation epoch snapshot proposal failed", {
          epochId: epochId.toString(),
          error: getRevertReason(error),
        });
      }
    } else if (status === STATUS.Proposed) {
      try {
        await writeContractAndConfirm(publicClient, walletClient, {
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
        finalizedEpochIds.add(epochId.toString());
      } catch (error) {
        logger.debug("Correlation epoch snapshot not finalizable yet", {
          epochId: epochId.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (status === STATUS.Finalized) {
      finalizedEpochIds.add(epochId.toString());
    } else if (status === STATUS.Challenged) {
      logger.debug("Skipping challenged correlation epoch snapshot", {
        epochId: epochId.toString(),
      });
    }
  }

  for (const snapshot of artifact.roundPayoutSnapshots ?? []) {
    const correlationEpochId = BigInt(snapshot.correlationEpochId);
    if (!finalizedEpochIds.has(correlationEpochId.toString())) {
      logger.debug("Skipping round payout snapshot until correlation epoch is finalized", {
        correlationEpochId: correlationEpochId.toString(),
        rewardPoolId: snapshot.rewardPoolId.toString(),
        contentId: snapshot.contentId.toString(),
        roundId: snapshot.roundId.toString(),
      });
      continue;
    }

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
      if (!snapshotProposerAuthorization.authorized) {
        logger.debug(
          "Skipping round payout snapshot proposal until keeper is authorized by an eligible frontend",
          {
            snapshotKey,
            snapshotProposer: account.address,
            frontendOperator: snapshotProposerAuthorization.frontendOperator,
          },
        );
        continue;
      }

      if (!(await roundSnapshotSourceReady(publicClient, snapshot, logger))) {
        continue;
      }

      try {
        await writeContractAndConfirm(publicClient, walletClient, {
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
              correlationEpochId,
              rawEligibleVoters: snapshot.rawEligibleVoters,
              effectiveParticipantUnits: snapshot.effectiveParticipantUnits,
              totalClaimWeight: BigInt(snapshot.totalClaimWeight),
              weightRoot: snapshot.weightRoot,
              reasonRoot: snapshot.reasonRoot,
              artifactHash: snapshot.artifactHash,
              artifactURI: snapshot.artifactURI,
            },
          ],
        });
        result.roundSnapshotsProposed += 1;
        logger.info("Proposed round payout snapshot", { snapshotKey });
      } catch (error) {
        logger.warn("Round payout snapshot proposal failed", {
          snapshotKey,
          error: getRevertReason(error),
        });
      }
    } else if (status === STATUS.Proposed) {
      try {
        await writeContractAndConfirm(publicClient, walletClient, {
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
    } else if (status === STATUS.Challenged) {
      logger.debug("Skipping challenged round payout snapshot", { snapshotKey });
    }
  }

  return result;
}
