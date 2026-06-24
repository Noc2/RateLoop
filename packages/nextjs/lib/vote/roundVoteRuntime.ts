import { parseRound, parseVotingConfig } from "../contracts/roundVotingEngine";
import { getBlockWithRetry } from "../transactions/blockWait";
import { deriveCommitVoteRuntimeNowMs } from "./tlockCommitTiming";
import { ProtocolConfigAbi, RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { type Hex, type PublicClient, zeroHash } from "viem";

const roundCommitPreviewAbi = [
  {
    type: "function",
    name: "previewCommitContext",
    stateMutability: "view",
    inputs: [{ name: "contentId", type: "uint256" }],
    outputs: [
      { name: "openRoundId", type: "uint256" },
      { name: "referenceRatingBps", type: "uint16" },
    ],
  },
] as const;

type PreviewBlock = { blockTag: "pending" } | { blockNumber: bigint };

type RoundDrandRuntime = {
  drandChainHash: `0x${string}`;
  drandGenesisTimeSeconds: bigint;
  drandPeriodSeconds: bigint;
};

function roundAtOrAfterSeconds(timestampSeconds: bigint, genesisTimeSeconds: bigint, periodSeconds: bigint): bigint {
  if (periodSeconds <= 0n || timestampSeconds < genesisTimeSeconds) return 0n;
  const elapsed = timestampSeconds - genesisTimeSeconds;
  return (elapsed + periodSeconds - 1n) / periodSeconds + 1n;
}

function deriveContractAcceptedTargetRound(params: {
  drandGenesisTimeSeconds: bigint;
  drandPeriodSeconds: bigint;
  epochDurationSeconds: number;
  roundStartTimeSeconds: number | null;
  runtimeTimestampSeconds: number;
}): bigint | undefined {
  if (params.roundStartTimeSeconds == null || params.roundStartTimeSeconds <= 0) return undefined;
  if (params.drandGenesisTimeSeconds <= 0n || params.drandPeriodSeconds <= 0n) return undefined;

  const epochDurationSeconds = BigInt(Math.max(1, Math.floor(params.epochDurationSeconds)));
  const roundStartTimeSeconds = BigInt(Math.floor(params.roundStartTimeSeconds));
  const commitTimestampSeconds = BigInt(Math.max(0, Math.floor(params.runtimeTimestampSeconds)) + 1);
  const elapsedSeconds =
    commitTimestampSeconds > roundStartTimeSeconds ? commitTimestampSeconds - roundStartTimeSeconds : 0n;
  const epochIndex = elapsedSeconds / epochDurationSeconds;
  const revealableAfterSeconds = roundStartTimeSeconds + (epochIndex + 1n) * epochDurationSeconds;
  const targetRound = roundAtOrAfterSeconds(
    revealableAfterSeconds,
    params.drandGenesisTimeSeconds,
    params.drandPeriodSeconds,
  );

  return targetRound > 0n ? targetRound : undefined;
}

function hasUsableDrandConfig(config: RoundDrandRuntime) {
  return (
    config.drandChainHash.toLowerCase() !== zeroHash &&
    config.drandGenesisTimeSeconds > 0n &&
    config.drandPeriodSeconds > 0n
  );
}

async function readLiveDrandRuntime(params: {
  publicClient: PublicClient;
  votingEngineAddress: `0x${string}`;
  block: PreviewBlock;
}): Promise<RoundDrandRuntime> {
  const protocolConfigAddress = (await params.publicClient.readContract({
    address: params.votingEngineAddress,
    abi: RoundVotingEngineAbi,
    functionName: "protocolConfig",
    ...params.block,
  })) as `0x${string}`;

  const [drandChainHash, drandGenesisTimeSeconds, drandPeriodSeconds] = await Promise.all([
    params.publicClient.readContract({
      address: protocolConfigAddress,
      abi: ProtocolConfigAbi,
      functionName: "drandChainHash",
      ...params.block,
    }),
    params.publicClient.readContract({
      address: protocolConfigAddress,
      abi: ProtocolConfigAbi,
      functionName: "drandGenesisTime",
      ...params.block,
    }),
    params.publicClient.readContract({
      address: protocolConfigAddress,
      abi: ProtocolConfigAbi,
      functionName: "drandPeriod",
      ...params.block,
    }),
  ]);

  return {
    drandChainHash: (drandChainHash as Hex).toLowerCase() as `0x${string}`,
    drandGenesisTimeSeconds: BigInt(drandGenesisTimeSeconds as bigint),
    drandPeriodSeconds: BigInt(drandPeriodSeconds as bigint),
  };
}

async function readRoundDrandRuntime(params: {
  publicClient: PublicClient;
  votingEngineAddress: `0x${string}`;
  contentId: bigint;
  roundId: bigint;
  block: PreviewBlock;
}): Promise<RoundDrandRuntime> {
  if (params.roundId > 0n) {
    const [, , chainHash, genesisTime, period] = (await params.publicClient.readContract({
      address: params.votingEngineAddress,
      abi: RoundVotingEngineAbi,
      functionName: "advisoryRoundContext",
      args: [params.contentId, params.roundId, 0n],
      ...params.block,
    })) as readonly [number, bigint, Hex, bigint, bigint, boolean, `0x${string}`];

    const snapshot = {
      drandChainHash: chainHash.toLowerCase() as `0x${string}`,
      drandGenesisTimeSeconds: BigInt(genesisTime),
      drandPeriodSeconds: BigInt(period),
    };
    if (hasUsableDrandConfig(snapshot)) {
      return snapshot;
    }
  }

  return readLiveDrandRuntime(params);
}

function isRoundClosed(params: {
  parsedConfig: ReturnType<typeof parseVotingConfig>;
  parsedRound: NonNullable<ReturnType<typeof parseRound>>;
  runtimeTimestampSeconds: number;
}) {
  const revealQuorum = Math.max(params.parsedConfig.minVoters, 3);
  return (
    params.parsedRound.thresholdReachedAt > 0n ||
    Number(params.parsedRound.revealedCount) >= revealQuorum ||
    params.parsedRound.voteCount >= BigInt(params.parsedConfig.maxVoters) ||
    params.runtimeTimestampSeconds >= Number(params.parsedRound.startTime) + params.parsedConfig.maxDuration
  );
}

export async function resolveRoundVoteRuntime(params: {
  publicClient: PublicClient;
  votingEngineAddress: `0x${string}`;
  contentId: bigint;
  fallbackEpochDuration: number;
}) {
  const latestBlock = await getBlockWithRetry(params.publicClient, { blockTag: "latest" });
  let pendingTimestampSeconds = Number(latestBlock.timestamp);
  let canReadPendingBlock = false;
  try {
    const pendingBlock = await params.publicClient.getBlock({ blockTag: "pending" });
    pendingTimestampSeconds = Number(pendingBlock.timestamp);
    canReadPendingBlock = true;
  } catch {
    pendingTimestampSeconds = Number(latestBlock.timestamp);
  }

  if (latestBlock.number === null) {
    throw new Error("Latest block number unavailable.");
  }

  const snapshotBlockNumber = latestBlock.number;
  const runtimeTimestampSeconds = Math.max(Number(latestBlock.timestamp), pendingTimestampSeconds);
  const previewBlock = canReadPendingBlock ? { blockTag: "pending" as const } : { blockNumber: snapshotBlockNumber };

  const [roundId, roundReferenceRatingBps] = (await params.publicClient.readContract({
    address: params.votingEngineAddress,
    abi: roundCommitPreviewAbi,
    functionName: "previewCommitContext",
    args: [params.contentId],
    ...previewBlock,
  })) as readonly [bigint, number];

  let roundStartTimeSeconds: number | null = null;
  let baseTotalStake = 0n;
  let baseVoteCount = 0n;
  let epochDuration = params.fallbackEpochDuration;
  let resolvedRoundId = roundId;
  let resolvedRoundReferenceRatingBps = roundReferenceRatingBps as number;
  if (roundId > 0n) {
    const [round, roundConfig] = await Promise.all([
      params.publicClient.readContract({
        address: params.votingEngineAddress,
        abi: RoundVotingEngineAbi,
        functionName: "roundCore",
        args: [params.contentId, roundId],
        ...previewBlock,
      }),
      params.publicClient.readContract({
        address: params.votingEngineAddress,
        abi: RoundVotingEngineAbi,
        functionName: "roundConfigSnapshot",
        args: [params.contentId, roundId],
        ...previewBlock,
      }),
    ]);
    const parsedRound = parseRound(round);
    const parsedConfig = parseVotingConfig(roundConfig);

    if (parsedRound?.state === 0 && parsedRound.startTime > 0n) {
      if (isRoundClosed({ parsedConfig, parsedRound, runtimeTimestampSeconds })) {
        throw new Error("RoundNotOpen");
      }

      baseTotalStake = parsedRound.totalStake;
      baseVoteCount = parsedRound.voteCount;
      epochDuration = parsedConfig.epochDuration;
      roundStartTimeSeconds = Number(parsedRound.startTime);
    } else {
      const currentRoundId = await params.publicClient.readContract({
        address: params.votingEngineAddress,
        abi: RoundVotingEngineAbi,
        functionName: "currentRoundId",
        args: [params.contentId],
        ...previewBlock,
      });

      if (currentRoundId > 0n && currentRoundId !== roundId) {
        const [currentRound, currentRoundConfig] = await Promise.all([
          params.publicClient.readContract({
            address: params.votingEngineAddress,
            abi: RoundVotingEngineAbi,
            functionName: "roundCore",
            args: [params.contentId, currentRoundId],
            ...previewBlock,
          }),
          params.publicClient.readContract({
            address: params.votingEngineAddress,
            abi: RoundVotingEngineAbi,
            functionName: "roundConfigSnapshot",
            args: [params.contentId, currentRoundId],
            ...previewBlock,
          }),
        ]);
        const parsedCurrentRound = parseRound(currentRound);
        const parsedCurrentConfig = parseVotingConfig(currentRoundConfig);

        if (
          parsedCurrentRound?.state === 0 &&
          parsedCurrentRound.startTime > 0n &&
          !isRoundClosed({
            parsedConfig: parsedCurrentConfig,
            parsedRound: parsedCurrentRound,
            runtimeTimestampSeconds,
          })
        ) {
          baseTotalStake = parsedCurrentRound.totalStake;
          baseVoteCount = parsedCurrentRound.voteCount;
          epochDuration = parsedCurrentConfig.epochDuration;
          resolvedRoundId = currentRoundId;
          // `commitVote` binds to the current round id. If preview already advanced to
          // the next unopened slot, the best available public reference is the live
          // preview reference, which matches the just-opened round's snapshot.
          resolvedRoundReferenceRatingBps = roundReferenceRatingBps as number;
          roundStartTimeSeconds = Number(parsedCurrentRound.startTime);
        }
      }
    }
  }

  const runtimeNowMs = deriveCommitVoteRuntimeNowMs({
    latestBlockTimestampSeconds: runtimeTimestampSeconds,
    epochDurationSeconds: epochDuration,
    roundStartTimeSeconds,
  });
  const drandRuntime = await readRoundDrandRuntime({
    publicClient: params.publicClient,
    votingEngineAddress: params.votingEngineAddress,
    contentId: params.contentId,
    roundId: resolvedRoundId,
    block: previewBlock,
  });
  const targetRound = deriveContractAcceptedTargetRound({
    ...drandRuntime,
    epochDurationSeconds: epochDuration,
    roundStartTimeSeconds,
    runtimeTimestampSeconds,
  });

  return {
    epochDuration,
    baseTotalStake,
    baseVoteCount,
    now: () => runtimeNowMs,
    requiresOpenRound: roundStartTimeSeconds == null,
    roundStartTimeSeconds,
    roundId: resolvedRoundId,
    roundReferenceRatingBps: resolvedRoundReferenceRatingBps,
    ...(targetRound != null ? { targetRound } : {}),
    ...drandRuntime,
  };
}
