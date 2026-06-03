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
import {
  buildConfiguredCorrelationSnapshotArtifactForCandidates,
  correlationSnapshotCandidateFingerprint,
  loadConfiguredCorrelationSnapshotCandidates,
  restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson,
  type CorrelationRoundCandidate,
} from "./correlation-artifact-builder.js";
import {
  readCachedCorrelationArtifact,
  runWithCorrelationSnapshotPublishLock,
  writeCachedCorrelationArtifact,
} from "./keeper-state.js";
import { writeContractAndConfirm } from "./keeper.js";
import { getRevertReason } from "./revert-utils.js";

const STATUS = {
  None: 0,
  Proposed: 1,
  Challenged: 2,
  Finalized: 3,
  Rejected: 4,
} as const;
const PAYOUT_DOMAIN_QUESTION_REWARD = 1;
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
  sourceRefs?: CorrelationEpochSourceRefArtifact[];
}

export interface CorrelationEpochSourceRefArtifact {
  domain: number;
  rewardPoolId: string | number | bigint;
  contentId: string | number | bigint;
  roundId: string | number | bigint;
}

export interface RoundPayoutSnapshotArtifact extends CorrelationEpochSourceRefArtifact {
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
    const candidates = await loadConfiguredCorrelationSnapshotCandidates(logger);
    return (await buildConfiguredCorrelationSnapshotArtifactForCandidates(candidates, logger))
      .artifact;
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
  snapshot: CorrelationEpochSourceRefArtifact,
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

async function readyCorrelationEpochSourceRefs(
  publicClient: PublicClient,
  artifact: CorrelationSnapshotArtifactFile,
  epoch: CorrelationEpochArtifact,
  logger: Logger,
) {
  const epochId = BigInt(epoch.epochId);
  const configuredRefs =
    epoch.sourceRefs ??
    (artifact.roundPayoutSnapshots ?? []).filter(
      (snapshot) => BigInt(snapshot.correlationEpochId) === epochId,
    );
  if (configuredRefs.length === 0) {
    logger.warn("Skipping correlation epoch snapshot because no covered sources are listed", {
      epochId: epochId.toString(),
    });
    return null;
  }

  const keyedRefs = await Promise.all(
    configuredRefs.map(async (sourceRef) => ({
      sourceRef,
      snapshotKey: (await publicClient.readContract({
        address: config.contracts.clusterPayoutOracle,
        abi: ClusterPayoutOracleAbi,
        functionName: "roundPayoutSnapshotKey",
        args: [
          sourceRef.domain,
          BigInt(sourceRef.rewardPoolId),
          BigInt(sourceRef.contentId),
          BigInt(sourceRef.roundId),
        ],
      })) as `0x${string}`,
    })),
  );
  keyedRefs.sort((left, right) => left.snapshotKey.localeCompare(right.snapshotKey));

  for (let i = 1; i < keyedRefs.length; i += 1) {
    if (keyedRefs[i]!.snapshotKey === keyedRefs[i - 1]!.snapshotKey) {
      logger.warn("Skipping correlation epoch snapshot because covered sources contain a duplicate", {
        epochId: epochId.toString(),
        snapshotKey: keyedRefs[i]!.snapshotKey,
      });
      return null;
    }
  }

  const sourceRefs = keyedRefs.map(({ sourceRef }) => ({
    domain: sourceRef.domain,
    rewardPoolId: BigInt(sourceRef.rewardPoolId),
    contentId: BigInt(sourceRef.contentId),
    roundId: BigInt(sourceRef.roundId),
  }));
  for (const sourceRef of sourceRefs) {
    if (!(await roundSnapshotSourceReady(publicClient, sourceRef, logger))) {
      return null;
    }
  }

  return sourceRefs;
}

export async function publishConfiguredCorrelationSnapshots(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
): Promise<CorrelationSnapshotPublisherResult> {
  return runWithCorrelationSnapshotPublishLock(logger, emptyResult(), () =>
    publishConfiguredCorrelationSnapshotsUnlocked(
      publicClient,
      walletClient,
      chain,
      account,
      logger,
    )
  );
}

async function publishConfiguredCorrelationSnapshotsUnlocked(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
): Promise<CorrelationSnapshotPublisherResult> {
  if (!config.correlationSnapshots.enabled) {
    return emptyResult();
  }

  if (config.correlationSnapshots.mode === "auto") {
    return publishAutomaticCorrelationSnapshots(
      publicClient,
      walletClient,
      chain,
      account,
      logger,
    );
  }

  const artifact = await loadConfiguredCorrelationSnapshotArtifact(logger);
  return publishCorrelationSnapshotArtifact(
    artifact,
    publicClient,
    walletClient,
    chain,
    account,
    logger,
  );
}

async function publishAutomaticCorrelationSnapshots(
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
): Promise<CorrelationSnapshotPublisherResult> {
  const candidates = await loadConfiguredCorrelationSnapshotCandidates(logger);
  if (candidates.length === 0) {
    return emptyResult();
  }

  const preflight = await preflightAutomaticCorrelationSnapshots(
    candidates,
    publicClient,
    walletClient,
    chain,
    account,
    logger,
  );
  if (!preflight.needsArtifactBuild) {
    return preflight.result;
  }

  const fingerprint = correlationSnapshotCandidateFingerprint(candidates);
  const cachedArtifact = await readCachedCorrelationArtifact(fingerprint, logger);
  let built = cachedArtifact
    ? await restoreConfiguredCorrelationSnapshotArtifactFromCanonicalJson(
        cachedArtifact.canonicalJson,
      )
    : null;
  if (
    cachedArtifact &&
    built?.artifactHash &&
    built.artifactHash !== cachedArtifact.artifactHash
  ) {
    logger.warn("Ignoring cached automatic correlation snapshot artifact with mismatched hash", {
      candidateFingerprint: fingerprint,
      cachedArtifactHash: cachedArtifact.artifactHash,
      actualArtifactHash: built.artifactHash,
    });
    built = null;
  }
  if (cachedArtifact && built) {
    logger.debug("Using cached automatic correlation snapshot artifact", {
      candidateFingerprint: fingerprint,
      artifactHash: built.artifactHash,
      roundSnapshotCount: built.roundSnapshotCount,
      epochCount: built.epochCount,
      canonicalBytes: built.canonicalBytes,
    });
  }
  if (!built) {
    built = await buildConfiguredCorrelationSnapshotArtifactForCandidates(
      candidates,
      logger,
    );
  }
  if (
    (!cachedArtifact || cachedArtifact.artifactHash !== built.artifactHash) &&
    built.artifactHash &&
    built.canonicalJson
  ) {
    await writeCachedCorrelationArtifact({
      fingerprint,
      artifactHash: built.artifactHash,
      canonicalJson: built.canonicalJson,
      candidateCount: candidates.length,
      roundSnapshotCount: built.roundSnapshotCount,
      epochCount: built.epochCount,
      logger,
    });
  }

  return publishCorrelationSnapshotArtifact(
    built.artifact,
    publicClient,
    walletClient,
    chain,
    account,
    logger,
    preflight.result,
  );
}

async function preflightAutomaticCorrelationSnapshots(
  candidates: readonly CorrelationRoundCandidate[],
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
): Promise<{
  result: CorrelationSnapshotPublisherResult;
  needsArtifactBuild: boolean;
}> {
  const result = emptyResult();
  let needsArtifactBuild = false;
  const epochFinalizedById = new Map<string, boolean>();

  for (const candidate of candidates) {
    const epochId = candidate.roundId;
    const epochKey = epochId.toString();
    let epochFinalized = epochFinalizedById.get(epochKey);

    if (epochFinalized === undefined) {
      const existingEpoch = await publicClient.readContract({
        address: config.contracts.clusterPayoutOracle,
        abi: ClusterPayoutOracleAbi,
        functionName: "correlationEpochSnapshot",
        args: [epochId],
      });
      const epochStatus = Number(existingEpoch.status);
      epochFinalized = epochStatus === STATUS.Finalized;

      if (epochStatus === STATUS.None || epochStatus === STATUS.Rejected) {
        needsArtifactBuild = true;
        epochFinalizedById.set(epochKey, false);
        continue;
      }

      if (epochStatus === STATUS.Proposed) {
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
          epochFinalized = true;
          logger.info("Finalized correlation epoch snapshot", {
            epochId: epochId.toString(),
          });
        } catch (error) {
          logger.debug("Correlation epoch snapshot not finalizable yet", {
            epochId: epochId.toString(),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else if (epochStatus === STATUS.Challenged) {
        logger.debug("Skipping challenged correlation epoch snapshot", {
          epochId: epochId.toString(),
        });
      }

      epochFinalizedById.set(epochKey, epochFinalized);
    }

    if (!epochFinalized) {
      continue;
    }

    const snapshotKey = await publicClient.readContract({
      address: config.contracts.clusterPayoutOracle,
      abi: ClusterPayoutOracleAbi,
      functionName: "roundPayoutSnapshotKey",
      args: [
        PAYOUT_DOMAIN_QUESTION_REWARD,
        candidate.rewardPoolId,
        candidate.contentId,
        candidate.roundId,
      ],
    });

    let roundStatus: number = STATUS.None;
    try {
      const existingRound = await publicClient.readContract({
        address: config.contracts.clusterPayoutOracle,
        abi: ClusterPayoutOracleAbi,
        functionName: "roundPayoutProposal",
        args: [snapshotKey],
      });
      roundStatus = Number(existingRound.snapshot.status);
    } catch {
      roundStatus = STATUS.None;
    }

    if (roundStatus === STATUS.None || roundStatus === STATUS.Rejected) {
      if (
        await roundSnapshotSourceReady(
          publicClient,
          {
            domain: PAYOUT_DOMAIN_QUESTION_REWARD,
            rewardPoolId: candidate.rewardPoolId,
            contentId: candidate.contentId,
            roundId: candidate.roundId,
          } as RoundPayoutSnapshotArtifact,
          logger,
        )
      ) {
        needsArtifactBuild = true;
      }
    } else if (roundStatus === STATUS.Proposed) {
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
    } else if (roundStatus === STATUS.Challenged) {
      logger.debug("Skipping challenged round payout snapshot", { snapshotKey });
    }
  }

  return { result, needsArtifactBuild };
}

async function publishCorrelationSnapshotArtifact(
  artifact: CorrelationSnapshotArtifactFile | null,
  publicClient: PublicClient,
  walletClient: WalletClient,
  chain: Chain,
  account: Account,
  logger: Logger,
  initialResult: CorrelationSnapshotPublisherResult = emptyResult(),
): Promise<CorrelationSnapshotPublisherResult> {
  if (!artifact) {
    return emptyResult();
  }

  const result = { ...initialResult };
  if (
    (artifact.correlationEpochs ?? []).length === 0 &&
    (artifact.roundPayoutSnapshots ?? []).length === 0
  ) {
    return result;
  }

  let snapshotProposerAuthorization: SnapshotProposerAuthorization | null = null;
  async function getSnapshotProposerAuthorization() {
    snapshotProposerAuthorization ??= await readSnapshotProposerAuthorization(
      publicClient,
      account,
      logger,
    );
    return snapshotProposerAuthorization;
  }
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
      const proposerAuthorization = await getSnapshotProposerAuthorization();
      if (!proposerAuthorization.authorized) {
        logger.debug(
          "Skipping correlation epoch proposal until keeper is authorized by an eligible frontend",
          {
            epochId: epochId.toString(),
            snapshotProposer: account.address,
            frontendOperator: proposerAuthorization.frontendOperator,
          },
        );
        continue;
      }

      const sourceRefs = await readyCorrelationEpochSourceRefs(
        publicClient,
        artifact,
        epoch,
        logger,
      );
      if (!sourceRefs) {
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
            sourceRefs,
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
      const proposerAuthorization = await getSnapshotProposerAuthorization();
      if (!proposerAuthorization.authorized) {
        logger.debug(
          "Skipping round payout snapshot proposal until keeper is authorized by an eligible frontend",
          {
            snapshotKey,
            snapshotProposer: account.address,
            frontendOperator: proposerAuthorization.frontendOperator,
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
