import { readFile } from "node:fs/promises";
import type { Account, Chain, PublicClient, WalletClient } from "viem";
import {
  ClusterPayoutOracleAbi,
  FrontendRegistryAbi,
} from "@rateloop/contracts/abis";
import type { Logger } from "./logger.js";
import { config } from "./config.js";
import { writeContractAndConfirm } from "./keeper.js";
import { getRevertReason } from "./revert-utils.js";

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

async function readFrontendEligibility(
  publicClient: PublicClient,
  account: Account,
  logger: Logger,
): Promise<boolean> {
  const frontendRegistry = config.correlationSnapshots.frontendRegistry;
  if (!frontendRegistry) {
    logger.warn(
      "Skipping correlation snapshot proposals because no frontend registry is configured",
      {
        frontendOperator: account.address,
      },
    );
    return false;
  }

  try {
    const eligible = (await publicClient.readContract({
      address: frontendRegistry,
      abi: FrontendRegistryAbi,
      functionName: "isEligible",
      args: [account.address],
    })) as boolean;

    const data = {
      frontendOperator: account.address,
      frontendRegistry,
      eligible,
    };
    if (eligible) {
      logger.info("Correlation snapshot frontend eligibility confirmed", data);
    } else {
      logger.warn(
        "Skipping correlation snapshot proposals because frontend operator is not eligible",
        data,
      );
    }
    return eligible;
  } catch (error: unknown) {
    logger.warn(
      "Skipping correlation snapshot proposals because frontend eligibility could not be read",
      {
        frontendOperator: account.address,
        frontendRegistry,
        error: getRevertReason(error),
      },
    );
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
  const frontendEligible = await readFrontendEligibility(
    publicClient,
    account,
    logger,
  );

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
      if (!frontendEligible) {
        logger.debug(
          "Skipping correlation epoch proposal until frontend operator is eligible",
          {
            epochId: epochId.toString(),
            frontendOperator: account.address,
          },
        );
        continue;
      }

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
      if (!frontendEligible) {
        logger.debug(
          "Skipping round payout snapshot proposal until frontend operator is eligible",
          {
            snapshotKey,
            frontendOperator: account.address,
          },
        );
        continue;
      }

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
      });
      result.roundSnapshotsProposed += 1;
      logger.info("Proposed round payout snapshot", { snapshotKey });
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
    }
  }

  return result;
}
