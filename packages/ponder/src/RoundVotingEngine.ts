import { ponder } from "ponder:registry";
import { asc, eq, and } from "ponder";
import {
  encodePacked,
  isAddress,
  keccak256,
  zeroAddress,
} from "viem";
import { RoundVotingEngineAbi } from "@rateloop/contracts/abis";
import { buildCommitKey } from "@rateloop/contracts/votingCore";
import {
  DEFAULT_ROUND_CONFIG,
  ROUND_STATE,
  SCORE_SPREAD_POLICY,
} from "@rateloop/contracts/protocol";
import {
  round,
  vote,
  content,
  category,
  profile,
  rewardClaim,
  globalStats,
  voterStats,
  voterCategoryStats,
  dailyVoteActivity,
  voterStreak,
  roundPayoutSnapshot,
} from "ponder:schema";
import {
  formatUtcDateKey,
  getPreviousUtcDateKey,
  normalizeUtcDateKey,
} from "./streak-utils.js";
import { extendFeedbackBonusAwardDeadlinesForTerminalRound } from "./feedback-bonus-deadlines.js";
import { tryContractRead } from "./contract-read.js";
import { addressIdentityKey } from "@rateloop/node-utils/identityKeys";
import {
  loadCorrelationBanStateAt,
  snapshotCorrelationInputForAccount,
} from "./correlation-input-snapshot.js";
import { roundPayoutSnapshotKey } from "./correlation-snapshot-key.js";

const RBTS_SCORE_SCALE_BPS = 10_000;
const RBTS_SCORE_SCALE = 10_000n;
const HUMAN_CREDENTIAL_MASK = 1 << 3;
const ZERO_SCORE_SEED = `0x${"00".repeat(32)}` as `0x${string}`;
const ZERO_BYTES32 = `0x${"00".repeat(32)}` as `0x${string}`;

function normalizeAddress(
  address: string | null | undefined,
): `0x${string}` | null {
  if (!address || !isAddress(address)) return null;
  return address.toLowerCase() as `0x${string}`;
}

function firstContractAddress(address: unknown): `0x${string}` | null {
  const value = Array.isArray(address) ? address[0] : address;
  return typeof value === "string" ? normalizeAddress(value) : null;
}

function normalizeBytes32(value: unknown): `0x${string}` | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return null;
  }
  return value.toLowerCase() as `0x${string}`;
}

function nonZeroIdentityKey(
  identityKey: unknown,
  fallbackVoter: `0x${string}`,
) {
  const normalized = normalizeBytes32(identityKey);
  return normalized && normalized !== ZERO_BYTES32
    ? normalized
    : addressIdentityKey(fallbackVoter);
}

async function resolveCommitIdentityAtCommit(params: {
  context: any;
  contentId: bigint;
  roundId: bigint;
  voter: `0x${string}`;
  commitKey: `0x${string}`;
}) {
  const rawVoter = normalizeAddress(params.voter) ?? params.voter;
  const engineAddress = firstContractAddress(
    params.context.contracts?.RoundVotingEngine?.address,
  );
  if (!params.context.client?.readContract || !engineAddress) {
    return {
      identityKey: addressIdentityKey(rawVoter),
      identityHolder: rawVoter,
      credentialMask: 0,
      freshCredentialMask: 0,
      hasHumanCredential: false,
    };
  }

  // Only a deterministic call failure (revert / missing code / zero data) may fall back to the
  // address-derived identity: the indexed identityKey feeds the RBTS sampler replication and
  // voterStats attribution, so persisting the fallback after a transient RPC failure would
  // silently corrupt the whole round. tryContractRead retries transient failures and then
  // throws so Ponder retries the handler instead.
  const result = await tryContractRead(
    () =>
      params.context.client.readContract({
        abi: RoundVotingEngineAbi,
        address: engineAddress,
        functionName: "commitIdentityState",
        args: [params.contentId, params.roundId, params.commitKey],
      }) as Promise<
        | readonly [unknown, unknown, unknown, unknown, unknown, unknown]
        | {
            identityKey?: unknown;
            holder?: unknown;
            credentialMask?: unknown;
            freshCredentialMask?: unknown;
          }
      >,
  );
  if (!result.ok) {
    return {
      identityKey: addressIdentityKey(rawVoter),
      identityHolder: rawVoter,
      credentialMask: 0,
      freshCredentialMask: 0,
      hasHumanCredential: false,
    };
  }

  const state = result.value;
  const identityKey = Array.isArray(state) ? state[0] : state.identityKey;
  const holder = Array.isArray(state) ? state[1] : state.holder;
  const credentialMask =
    Number(Array.isArray(state) ? state[3] : state.credentialMask) || 0;
  const freshCredentialMask =
    Number(Array.isArray(state) ? state[4] : state.freshCredentialMask) || 0;
  const holderAddress = normalizeAddress(String(holder));
  const identityHolder =
    holderAddress && holderAddress !== zeroAddress ? holderAddress : rawVoter;
  return {
    identityKey: nonZeroIdentityKey(identityKey, rawVoter),
    identityHolder,
    credentialMask,
    freshCredentialMask,
    hasHumanCredential: (credentialMask & HUMAN_CREDENTIAL_MASK) !== 0,
  };
}

function voteIdentity(voteRow: {
  voter: `0x${string}`;
  identityHolder?: `0x${string}` | null;
}) {
  return voteRow.identityHolder ?? voteRow.voter;
}

function defaultRoundConfigFields() {
  return {
    epochDuration: DEFAULT_ROUND_CONFIG.epochDurationSeconds,
    maxDuration: DEFAULT_ROUND_CONFIG.maxDurationSeconds,
    minVoters: DEFAULT_ROUND_CONFIG.minVoters,
    maxVoters: DEFAULT_ROUND_CONFIG.maxVoters,
  };
}

function computeVoteEpochIndex(
  committedAt: bigint,
  roundStartTime: bigint,
  epochDurationSeconds: number,
): number {
  const epochDuration = Math.trunc(epochDurationSeconds);
  if (
    !Number.isFinite(epochDuration) ||
    epochDuration <= 0 ||
    committedAt <= roundStartTime
  ) {
    return 0;
  }

  return committedAt - roundStartTime < BigInt(epochDuration) ? 0 : 1;
}

function computeVoteEpochEnd(
  committedAt: bigint,
  roundStartTime: bigint,
  epochDurationSeconds: number,
): bigint {
  const epochDuration = Math.trunc(epochDurationSeconds);
  if (!Number.isFinite(epochDuration) || epochDuration <= 0) {
    return committedAt;
  }

  const epochDurationBigInt = BigInt(epochDuration);
  if (committedAt < roundStartTime) {
    return roundStartTime + epochDurationBigInt;
  }

  const epochIndex = (committedAt - roundStartTime) / epochDurationBigInt;
  return roundStartTime + (epochIndex + 1n) * epochDurationBigInt;
}

function roundReferenceFields(referenceRatingBps: number) {
  return {
    referenceRatingBps,
    ratingBps: referenceRatingBps,
    conservativeRatingBps: referenceRatingBps,
  };
}

function shouldPublishConfidentiality(contentRecord: Record<string, any> | null | undefined) {
  return (
    contentRecord?.gated === true &&
    contentRecord.confidentialityPublishedAt == null &&
    contentRecord.confidentialityDisclosurePolicy === "after_settlement"
  );
}

async function publishConfidentialityAfterSettlement(params: {
  context: any;
  contentId: bigint;
  publishedAt: bigint;
  contentRecord?: Record<string, any> | null;
}) {
  const contentRecord =
    params.contentRecord ??
    (await params.context.db.find(content, { id: params.contentId }));
  if (!shouldPublishConfidentiality(contentRecord)) return;

  await params.context.db.update(content, { id: params.contentId }).set({
    confidentialityPublishedAt: params.publishedAt,
  });
}

function positiveBigIntOrNull(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = typeof value === "bigint" ? value : BigInt(String(value));
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

async function resolveRoundLifecycleState(params: {
  context: any;
  contentId: bigint;
  roundId: bigint;
}) {
  const engineAddress = firstContractAddress(
    params.context.contracts?.RoundVotingEngine?.address,
  );
  if (!params.context.client?.readContract || !engineAddress) {
    return null;
  }

  const lifecycleResult = await tryContractRead(() =>
    params.context.client.readContract({
      abi: RoundVotingEngineAbi,
      address: engineAddress,
      functionName: "roundLifecycleState",
      args: [params.contentId, params.roundId],
    }),
  );
  if (!lifecycleResult.ok) return null;
  const lifecycle = lifecycleResult.value as Record<string, unknown> | unknown[];
  if (Array.isArray(lifecycle)) {
    return {
      revealGracePeriod: positiveBigIntOrNull(lifecycle[0]),
      lastCommitRevealableAfter: positiveBigIntOrNull(lifecycle[1]),
      cleanupRemaining: positiveBigIntOrNull(lifecycle[2]) ?? 0n,
      clusterPayoutReadyAt: positiveBigIntOrNull(lifecycle[3]),
    };
  }
  return {
    revealGracePeriod: positiveBigIntOrNull(lifecycle?.revealGracePeriod),
    lastCommitRevealableAfter: positiveBigIntOrNull(
      lifecycle?.lastRevealableAfter,
    ),
    cleanupRemaining: positiveBigIntOrNull(lifecycle?.cleanupRemaining) ?? 0n,
    clusterPayoutReadyAt: positiveBigIntOrNull(lifecycle?.clusterPayoutReadyAt),
  };
}

async function resolveRoundVoteabilityStateAtCommit(params: {
  context: any;
  contentId: bigint;
  roundId: bigint;
  targetRound: bigint;
  epochEnd: bigint;
  commitHasHumanCredential?: boolean;
  indexedRound?: {
    hasHumanVerifiedCommit?: boolean | null;
    revealGracePeriod?: bigint | number | string | null;
  } | null;
}) {
  const engineAddress = firstContractAddress(
    params.context.contracts?.RoundVotingEngine?.address,
  );
  const indexedHasHumanVerifiedCommit =
    params.indexedRound?.hasHumanVerifiedCommit === true;
  const indexedRevealGracePeriod = positiveBigIntOrNull(
    params.indexedRound?.revealGracePeriod,
  );

  if (!params.context.client?.readContract || !engineAddress) {
    return {
      hasHumanVerifiedCommit: indexedHasHumanVerifiedCommit,
      lastCommitRevealableAfter: params.epochEnd,
      revealGracePeriod: indexedRevealGracePeriod,
    };
  }

  const advisoryResult = await tryContractRead(() =>
    params.context.client.readContract({
      abi: RoundVotingEngineAbi,
      address: engineAddress,
      functionName: "advisoryRoundContext",
      args: [params.contentId, params.roundId, params.targetRound],
    }),
  );
  if (!advisoryResult.ok) {
    return {
      hasHumanVerifiedCommit: indexedHasHumanVerifiedCommit,
      lastCommitRevealableAfter: params.epochEnd,
      revealGracePeriod: indexedRevealGracePeriod,
    };
  }

  let grace = indexedRevealGracePeriod;
  if (grace === null) {
    const lifecycleResult = await tryContractRead(() =>
      params.context.client.readContract({
        abi: RoundVotingEngineAbi,
        address: engineAddress,
        functionName: "roundLifecycleState",
        args: [params.contentId, params.roundId],
      }),
    );
    if (!lifecycleResult.ok) {
      return {
        hasHumanVerifiedCommit: indexedHasHumanVerifiedCommit,
        lastCommitRevealableAfter: params.epochEnd,
        revealGracePeriod: indexedRevealGracePeriod,
      };
    }

    const lifecycleState = lifecycleResult.value;
    const rawGrace = Array.isArray(lifecycleState)
      ? lifecycleState[0]
      : lifecycleState;
    grace =
      typeof rawGrace === "bigint"
        ? rawGrace
        : rawGrace === null || rawGrace === undefined
          ? null
          : BigInt(String(rawGrace));
    if (grace !== null && grace <= 0n) {
      grace = null;
    }
  }

  const advisoryRoundContext = advisoryResult.value;
  const targetRoundRevealableAt = Array.isArray(advisoryRoundContext)
    ? advisoryRoundContext[1]
    : params.epochEnd;
  const revealableAt =
    typeof targetRoundRevealableAt === "bigint"
      ? targetRoundRevealableAt
      : BigInt(String(targetRoundRevealableAt));

  return {
    hasHumanVerifiedCommit:
      indexedHasHumanVerifiedCommit ||
      params.commitHasHumanCredential === true,
    lastCommitRevealableAfter:
      revealableAt > params.epochEnd ? revealableAt : params.epochEnd,
    revealGracePeriod: grace,
  };
}

function shadowPredictionBps(
  referencePredictionBps: number,
  signalIsUp: boolean,
): number {
  const delta = Math.min(
    referencePredictionBps,
    RBTS_SCORE_SCALE_BPS - referencePredictionBps,
  );
  return signalIsUp
    ? referencePredictionBps + delta
    : referencePredictionBps - delta;
}

function quadraticScoreBps(predictionBps: number, actualIsUp: boolean): number {
  const y = Math.max(
    0,
    Math.min(RBTS_SCORE_SCALE_BPS, Math.trunc(predictionBps)),
  );
  const ySquared = y * y;
  if (actualIsUp) {
    return Math.floor(
      (2 * RBTS_SCORE_SCALE_BPS * y - ySquared) / RBTS_SCORE_SCALE_BPS,
    );
  }
  return Math.floor(RBTS_SCORE_SCALE_BPS - ySquared / RBTS_SCORE_SCALE_BPS);
}

function rbtsScoreBps({
  ownSignalIsUp,
  ownPredictionBps,
  referencePredictionBps,
  peerSignalIsUp,
}: {
  ownSignalIsUp: boolean;
  ownPredictionBps: number;
  referencePredictionBps: number;
  peerSignalIsUp: boolean;
}) {
  const shadow = shadowPredictionBps(referencePredictionBps, ownSignalIsUp);
  const informationScore = quadraticScoreBps(shadow, peerSignalIsUp);
  const predictionScore = quadraticScoreBps(ownPredictionBps, peerSignalIsUp);
  return Math.floor((informationScore + predictionScore) / 2);
}

function rbtsPositiveSpreadRewardWeight(
  rbtsWeight: bigint,
  positiveDeltaBps: bigint,
): bigint {
  if (rbtsWeight <= 0n || positiveDeltaBps <= 0n) return 0n;
  return (rbtsWeight * positiveDeltaBps) / RBTS_SCORE_SCALE;
}

function rbtsNegativeSpreadForfeiture(
  stake: bigint,
  negativeDeltaBps: bigint,
  scoringParticipantCount: number,
): bigint {
  if (stake <= 0n || negativeDeltaBps <= 0n) return 0n;
  if (scoringParticipantCount < SCORE_SPREAD_POLICY.forfeitMinReveals) {
    return 0n;
  }
  const forfeiture =
    (stake * BigInt(SCORE_SPREAD_POLICY.intensityBps) * negativeDeltaBps) /
    RBTS_SCORE_SCALE /
    RBTS_SCORE_SCALE;
  const maxForfeiture =
    (stake * BigInt(SCORE_SPREAD_POLICY.maxForfeitBps)) / RBTS_SCORE_SCALE;
  return forfeiture > maxForfeiture ? maxForfeiture : forfeiture;
}

function rbtsLeaveOneOutMeanScoreBps({
  weightedScoreSum,
  totalScoreWeight,
  ownWeight,
  ownScoreBps,
}: {
  weightedScoreSum: bigint;
  totalScoreWeight: bigint;
  ownWeight: bigint;
  ownScoreBps: number;
}): bigint {
  if (ownWeight <= 0n) {
    return totalScoreWeight > 0n ? weightedScoreSum / totalScoreWeight : 0n;
  }
  const remainingWeight = totalScoreWeight - ownWeight;
  if (remainingWeight <= 0n) return 0n;
  return (weightedScoreSum - ownWeight * BigInt(ownScoreBps)) / remainingWeight;
}

async function resolveRbtsScoringWeights(params: {
  context: any;
  contentId: bigint;
  roundId: bigint;
  roundVotes: {
    id: string;
    commitKey: `0x${string}`;
    rbtsWeight?: bigint | null;
  }[];
}) {
  const weights = new Map<string, bigint>();
  const engineAddress = firstContractAddress(
    params.context.contracts?.RoundVotingEngine?.address,
  );
  if (!params.context.client?.readContract || !engineAddress) {
    for (const roundVote of params.roundVotes) {
      weights.set(roundVote.id, roundVote.rbtsWeight ?? 0n);
    }
    return weights;
  }

  await Promise.all(
    params.roundVotes.map(async (roundVote) => {
      // Weight 0 silently drops the vote from the indexed scoring set, so only a
      // deterministic call failure may map to it. Transient RPC failures throw (after the
      // bounded retry in tryContractRead) so the handler fails loudly and Ponder retries it.
      const result = await tryContractRead(() =>
        params.context.client.readContract({
          abi: RoundVotingEngineAbi,
          address: engineAddress,
          functionName: "rbtsCommitState",
          args: [params.contentId, params.roundId, roundVote.commitKey],
        }),
      );
      if (!result.ok) {
        weights.set(roundVote.id, 0n);
        return;
      }
      const state = result.value;
      const weight = Array.isArray(state) ? state[2] : 0n;
      weights.set(roundVote.id, BigInt(String(weight)));
    }),
  );

  return weights;
}

function rbtsOtherIndex({
  scoreSeed,
  commitKey,
  ownIndex,
  count,
  domain,
}: {
  scoreSeed: `0x${string}`;
  commitKey: `0x${string}`;
  ownIndex: number;
  count: number;
  domain: number;
}) {
  const drawn =
    BigInt(
      keccak256(
        encodePacked(
          ["bytes32", "bytes32", "uint256", "uint8"],
          [scoreSeed, commitKey, BigInt(ownIndex), domain],
        ),
      ),
    ) % BigInt(count - 1);
  const drawnNumber = Number(drawn);
  return drawnNumber >= ownIndex ? drawnNumber + 1 : drawnNumber;
}

function rbtsPeerIndex({
  scoreSeed,
  commitKey,
  ownIndex,
  referenceIndex,
  count,
}: {
  scoreSeed: `0x${string}`;
  commitKey: `0x${string}`;
  ownIndex: number;
  referenceIndex: number;
  count: number;
}) {
  const drawn =
    BigInt(
      keccak256(
        encodePacked(
          ["bytes32", "bytes32", "uint256", "uint8"],
          [scoreSeed, commitKey, BigInt(ownIndex), 2],
        ),
      ),
    ) % BigInt(count - 2);
  let index = Number(drawn);
  const firstExcluded = Math.min(ownIndex, referenceIndex);
  const secondExcluded = Math.max(ownIndex, referenceIndex);
  if (index >= firstExcluded) index += 1;
  if (index >= secondExcluded) index += 1;
  return index;
}

async function recordVoteReveal({
  context,
  contentId,
  roundId,
  voter,
  isUp,
  predictedUpBps = null,
  rbtsWeight = null,
  revealedAt,
}: {
  context: any;
  contentId: bigint;
  roundId: bigint;
  voter: `0x${string}`;
  isUp: boolean;
  predictedUpBps?: number | null;
  rbtsWeight?: bigint | null;
  revealedAt: bigint;
}) {
  const roundKey = `${contentId}-${roundId}`;
  const normalizedVoter = normalizeAddress(voter) ?? voter;
  const voteKey = `${contentId}-${roundId}-${normalizedVoter}`;
  const existingVote = await context.db.find(vote, { id: voteKey });
  const shouldCountReveal = existingVote?.revealed !== true;

  if (existingVote) {
    await context.db.update(vote, { id: voteKey }).set({
      isUp,
      predictedUpBps,
      rbtsWeight,
      revealed: true,
      revealedAt,
      // epochIndex is not available from reveal events; keep existing
    });
  }

  const existingRound = await context.db.find(round, { id: roundKey });
  if (existingRound && shouldCountReveal) {
    await context.db
      .update(round, { id: roundKey })
      .set((row: NonNullable<typeof existingRound>) => ({
        revealedCount: row.revealedCount + 1,
        upPool: isUp ? row.upPool + (existingVote?.stake ?? 0n) : row.upPool,
        downPool: isUp
          ? row.downPool
          : row.downPool + (existingVote?.stake ?? 0n),
        upCount: isUp ? row.upCount + 1 : row.upCount,
        downCount: isUp ? row.downCount : row.downCount + 1,
      }));
  }
}

ponder.on(
  "RoundVotingEngine:RoundConfigSnapshotted",
  async ({ event, context }) => {
    const {
      contentId,
      roundId,
      epochDuration,
      maxDuration,
      minVoters,
      maxVoters,
    } = event.args;
    const roundKey = `${contentId}-${roundId}`;
    const contentRecord = await context.db.find(content, { id: contentId });
    const referenceRatingBps = contentRecord
      ? contentRecord.ratingBps > 0
        ? contentRecord.ratingBps
        : contentRecord.rating * 100
      : 5000;
    const roundConfigFields = {
      epochDuration: Number(epochDuration),
      maxDuration: Number(maxDuration),
      minVoters: Number(minVoters),
      maxVoters: Number(maxVoters),
    };

    const existingRound = await context.db.find(round, { id: roundKey });
    if (existingRound) {
      await context.db.update(round, { id: roundKey }).set(roundConfigFields);
      return;
    }

    await context.db.insert(round).values({
      id: roundKey,
      contentId,
      roundId,
      state: ROUND_STATE.Open,
      voteCount: 0,
      revealedCount: 0,
      totalStake: 0n,
      upPool: 0n,
      downPool: 0n,
      upCount: 0,
      downCount: 0,
      referenceRatingBps,
      ratingBps: referenceRatingBps,
      conservativeRatingBps: referenceRatingBps,
      confidenceMass: 0n,
      effectiveEvidence: 0n,
      upEvidence: 0n,
      downEvidence: 0n,
      settledRounds: 0,
      lowSince: 0n,
      startTime: event.block.timestamp,
      ...roundConfigFields,
    });
  },
);

ponder.on(
  "RoundVotingEngine:RoundReferenceSnapshotted",
  async ({ event, context }) => {
    const { contentId, roundId, roundReferenceRatingBps } = event.args as {
      contentId: bigint;
      roundId: bigint;
      roundReferenceRatingBps: number;
    };
    const roundKey = `${contentId}-${roundId}`;
    const referenceRatingBps = Number(roundReferenceRatingBps);
    const existingRound = await context.db.find(round, { id: roundKey });
    if (existingRound) {
      await context.db
        .update(round, { id: roundKey })
        .set(roundReferenceFields(referenceRatingBps));
      return;
    }

    await context.db.insert(round).values({
      id: roundKey,
      contentId,
      roundId,
      state: ROUND_STATE.Open,
      voteCount: 0,
      revealedCount: 0,
      totalStake: 0n,
      upPool: 0n,
      downPool: 0n,
      upCount: 0,
      downCount: 0,
      ...roundReferenceFields(referenceRatingBps),
      confidenceMass: 0n,
      effectiveEvidence: 0n,
      upEvidence: 0n,
      downEvidence: 0n,
      settledRounds: 0,
      lowSince: 0n,
      startTime: event.block.timestamp,
      ...defaultRoundConfigFields(),
    });
  },
);

ponder.on("RoundVotingEngine:VoteCommitted", async ({ event, context }) => {
  const {
    contentId,
    roundId,
    voter,
    commitHash,
    roundReferenceRatingBps,
    targetRound,
    drandChainHash,
    stake,
    ciphertextHash,
    ciphertext,
  } = event.args as {
    contentId: bigint;
    roundId: bigint;
    voter: `0x${string}`;
    commitHash: `0x${string}`;
    roundReferenceRatingBps: number;
    targetRound: bigint;
    drandChainHash: `0x${string}`;
    stake: bigint;
    ciphertextHash: `0x${string}`;
    ciphertext: `0x${string}`;
  };
  if (keccak256(ciphertext) !== ciphertextHash) {
    throw new Error(
      `VoteCommitted ciphertext hash mismatch for tx ${event.transaction.hash}`,
    );
  }
  const roundKey = `${contentId}-${roundId}`;
  const rawVoter = normalizeAddress(voter) ?? voter;
  const voteKey = `${contentId}-${roundId}-${rawVoter}`;
  const commitKey = buildCommitKey(rawVoter, commitHash);
  const existingVote = await context.db.find(vote, { id: voteKey });
  if (existingVote) {
    return;
  }
  const {
    identityKey,
    identityHolder,
    credentialMask,
    freshCredentialMask,
    hasHumanCredential,
  } = await resolveCommitIdentityAtCommit({
    context,
    contentId,
    roundId,
    voter: rawVoter,
    commitKey,
  });
  const referenceRatingBps = Number(roundReferenceRatingBps);

  // Upsert round record — VoteCommitted is the first event for a new round
  const existingRound = await context.db.find(round, { id: roundKey });
  const roundStartTime = existingRound?.startTime ?? event.block.timestamp;
  const epochDuration =
    existingRound?.epochDuration ?? DEFAULT_ROUND_CONFIG.epochDurationSeconds;
  const epochIndex = existingRound
    ? computeVoteEpochIndex(
        event.block.timestamp,
        roundStartTime,
        epochDuration,
      )
    : 0;
  const epochEnd = computeVoteEpochEnd(
    event.block.timestamp,
    roundStartTime,
    epochDuration,
  );
  const roundVoteabilityState = await resolveRoundVoteabilityStateAtCommit({
    context,
    contentId,
    roundId,
    targetRound,
    epochEnd,
    commitHasHumanCredential: hasHumanCredential,
    indexedRound: existingRound,
  });

  // Persist the vote row before mutating round counters so crash recovery cannot inflate quorum fields.
  await context.db
    .insert(vote)
    .values({
      id: voteKey,
      contentId,
      roundId,
      voter: rawVoter,
      identityKey,
      identityHolder,
      credentialMask,
      freshCredentialMask,
      commitKey,
      commitHash,
      ciphertextHash,
      ciphertext,
      ciphertextSource: "event",
      targetRound,
      drandChainHash,
      isUp: null,
      predictedUpBps: null,
      rbtsWeight: null,
      rbtsScoreBps: null,
      rbtsRewardWeight: null,
      rbtsStakeReturned: null,
      rbtsForfeitedStake: null,
      stake,
      epochIndex,
      revealed: false,
      committedAt: event.block.timestamp,
      commitTxHash: event.transaction.hash,
      commitBlockNumber: event.block.number,
      commitLogIndex: Number(event.log?.logIndex ?? 0),
      revealedAt: null,
    })
    .onConflictDoNothing();

  const persistedVote = await context.db.find(vote, { id: voteKey });
  if (
    !persistedVote ||
    String(persistedVote.commitTxHash).toLowerCase() !== event.transaction.hash.toLowerCase()
  ) {
    return;
  }

  if (!existingRound) {
    const humanVerifiedCommitCount = hasHumanCredential ? 1 : 0;
    await context.db.insert(round).values({
      id: roundKey,
      contentId,
      roundId,
      state: ROUND_STATE.Open,
      voteCount: 1,
      revealedCount: 0,
      totalStake: stake,
      upPool: 0n,
      downPool: 0n,
      upCount: 0,
      downCount: 0,
      ...roundReferenceFields(referenceRatingBps),
      confidenceMass: 0n,
      effectiveEvidence: 0n,
      upEvidence: 0n,
      downEvidence: 0n,
      settledRounds: 0,
      lowSince: 0n,
      startTime: event.block.timestamp,
      hasHumanVerifiedCommit: humanVerifiedCommitCount > 0,
      humanVerifiedCommitCount,
      lastCommitRevealableAfter: roundVoteabilityState.lastCommitRevealableAfter,
      revealGracePeriod: roundVoteabilityState.revealGracePeriod,
      ...defaultRoundConfigFields(),
    });
  } else {
    await context.db.update(round, { id: roundKey }).set((row) => {
      const humanVerifiedCommitCount =
        row.humanVerifiedCommitCount + (hasHumanCredential ? 1 : 0);
      return {
        voteCount: row.voteCount + 1,
        totalStake: row.totalStake + stake,
        hasHumanVerifiedCommit: humanVerifiedCommitCount > 0,
        humanVerifiedCommitCount,
        lastCommitRevealableAfter:
          row.lastCommitRevealableAfter === null ||
          roundVoteabilityState.lastCommitRevealableAfter >
            row.lastCommitRevealableAfter
            ? roundVoteabilityState.lastCommitRevealableAfter
            : row.lastCommitRevealableAfter,
        revealGracePeriod:
          roundVoteabilityState.revealGracePeriod ?? row.revealGracePeriod,
        ...roundReferenceFields(referenceRatingBps),
      };
    });
  }

  // Update content aggregate and lastActivityAt
  const contentRecord = await context.db.find(content, { id: contentId });
  if (contentRecord) {
    await context.db.update(content, { id: contentId }).set((row) => ({
      totalVotes: row.totalVotes + 1,
      lastActivityAt: event.block.timestamp,
    }));

    // Update category aggregate
    if (contentRecord.categoryId > 0n) {
      const existingCategory = await context.db.find(category, {
        id: contentRecord.categoryId,
      });
      if (existingCategory) {
        await context.db
          .update(category, { id: contentRecord.categoryId })
          .set((row) => ({ totalVotes: row.totalVotes + 1 }));
      }
    }
  }

  // Update voter profile aggregate
  const existingProfile = await context.db.find(profile, {
    address: identityHolder,
  });
  if (existingProfile) {
    await context.db
      .update(profile, { address: identityHolder })
      .set((row) => ({ totalVotes: row.totalVotes + 1 }));
  }

  // Update global stats
  await context.db
    .insert(globalStats)
    .values({
      id: "global",
      totalContent: 0,
      totalVotes: 1,
      totalRoundsSettled: 0,
      totalRewardsClaimed: 0n,
      totalFrontendFeesClaimed: 0n,
      totalProfiles: 0,
      totalVoterIds: 0,
    })
    .onConflictDoUpdate((row) => ({
      totalVotes: row.totalVotes + 1,
    }));

  // --- Daily streak tracking ---
  const date = new Date(Number(event.block.timestamp) * 1000);
  const dateStr = formatUtcDateKey(date);
  const activityKey = `${identityHolder}-${dateStr}`;

  // Upsert daily activity
  await context.db
    .insert(dailyVoteActivity)
    .values({
      id: activityKey,
      voter: identityHolder,
      date: dateStr,
      voteCount: 1,
      firstVoteAt: event.block.timestamp,
    })
    .onConflictDoUpdate((row) => ({
      voteCount: row.voteCount + 1,
    }));

  // Compute yesterday's date string
  const yesterdayStr = getPreviousUtcDateKey(dateStr);

  // Upsert voter streak
  const existingStreak = await context.db.find(voterStreak, {
    voter: identityHolder,
  });
  if (!existingStreak) {
    await context.db.insert(voterStreak).values({
      voter: identityHolder,
      currentDailyStreak: 1,
      bestDailyStreak: 1,
      lastActiveDate: dateStr,
      totalActiveDays: 1,
      lastMilestoneDay: 0,
    });
  } else if (normalizeUtcDateKey(existingStreak.lastActiveDate) === dateStr) {
    // Already active today — no streak change
    if (existingStreak.lastActiveDate !== dateStr) {
      await context.db.update(voterStreak, { voter: identityHolder }).set({
        lastActiveDate: dateStr,
      });
    }
  } else if (
    yesterdayStr !== null &&
    normalizeUtcDateKey(existingStreak.lastActiveDate) === yesterdayStr
  ) {
    // Consecutive day — increment streak
    const newStreak = existingStreak.currentDailyStreak + 1;
    await context.db.update(voterStreak, { voter: identityHolder }).set({
      currentDailyStreak: newStreak,
      bestDailyStreak: Math.max(existingStreak.bestDailyStreak, newStreak),
      lastActiveDate: dateStr,
      totalActiveDays: existingStreak.totalActiveDays + 1,
    });
  } else {
    // Gap — reset streak to 1 (also reset milestones to match on-chain)
    await context.db.update(voterStreak, { voter: identityHolder }).set({
      currentDailyStreak: 1,
      lastActiveDate: dateStr,
      totalActiveDays: existingStreak.totalActiveDays + 1,
      lastMilestoneDay: 0,
    });
  }
});

ponder.on("RoundVotingEngine:RbtsVoteRevealed", async ({ event, context }) => {
  const {
    contentId,
    roundId,
    voter,
    isUp,
    predictedUpBps,
    effectiveWeight = null,
  } = event.args as {
    contentId: bigint;
    roundId: bigint;
    voter: `0x${string}`;
    isUp: boolean;
    predictedUpBps: number;
    effectiveWeight?: bigint | null;
  };

  await recordVoteReveal({
    context,
    contentId,
    roundId,
    voter,
    isUp,
    predictedUpBps: Number(predictedUpBps),
    rbtsWeight: effectiveWeight,
    revealedAt: event.block.timestamp,
  });
});

ponder.on(
  "RoundVotingEngine:RbtsSettlementPending",
  async ({ event, context }) => {
    const { contentId, roundId, oracle } = event.args as {
      contentId: bigint;
      roundId: bigint;
      oracle: `0x${string}`;
    };
    const roundKey = `${contentId}-${roundId}`;
    const lifecycle = await resolveRoundLifecycleState({
      context,
      contentId,
      roundId,
    });

    const update: Record<string, unknown> = {
      state: ROUND_STATE.SettlementPending,
      rbtsSettlementStatus: "pending",
      rbtsSettlementOracle: normalizeAddress(oracle) ?? oracle,
      rbtsSettlementPendingAt: event.block.timestamp,
      rbtsSettlementReadyAt: lifecycle?.clusterPayoutReadyAt ?? null,
      rbtsSettlementPendingBlockNumber: event.block.number,
      rbtsSettlementPendingTxHash: event.transaction.hash,
      rbtsSettlementPendingLogIndex: Number(event.log?.logIndex ?? 0),
    };
    if (lifecycle?.lastCommitRevealableAfter !== null && lifecycle?.lastCommitRevealableAfter !== undefined) {
      update.lastCommitRevealableAfter = lifecycle.lastCommitRevealableAfter;
    }
    if (lifecycle?.revealGracePeriod !== null && lifecycle?.revealGracePeriod !== undefined) {
      update.revealGracePeriod = lifecycle.revealGracePeriod;
    }
    const existingRound = await context.db.find(round, { id: roundKey });
    if (existingRound) {
      await context.db.update(round, { id: roundKey }).set(update);
      return;
    }

    await context.db.insert(round).values({
      id: roundKey,
      contentId,
      roundId,
      state: ROUND_STATE.SettlementPending,
      voteCount: 0,
      revealedCount: 0,
      totalStake: 0n,
      upPool: 0n,
      downPool: 0n,
      upCount: 0,
      downCount: 0,
      referenceRatingBps: 5000,
      ratingBps: 5000,
      conservativeRatingBps: 5000,
      confidenceMass: 0n,
      effectiveEvidence: 0n,
      upEvidence: 0n,
      downEvidence: 0n,
      settledRounds: 0,
      lowSince: 0n,
      ...defaultRoundConfigFields(),
      ...update,
    });
  },
);

ponder.on(
  "RoundVotingEngine:RbtsSettlementSnapshotApplied",
  async ({ event, context }) => {
    const { contentId, roundId, snapshotDigest } = event.args as {
      contentId: bigint;
      roundId: bigint;
      snapshotDigest: `0x${string}`;
    };
    const roundKey = `${contentId}-${roundId}`;
    await context.db
      .update(roundPayoutSnapshot, {
        id: roundPayoutSnapshotKey({
          domain: 5,
          rewardPoolId: 0n,
          contentId,
          roundId,
        }),
      })
      .set({
        consumedAt: event.block.timestamp,
        updatedAt: event.block.timestamp,
      });
    const existingRound = await context.db.find(round, { id: roundKey });
    if (existingRound) {
      await context.db.update(round, { id: roundKey }).set({
        rbtsSettlementStatus: "applied",
        rbtsSettlementSnapshotDigest: snapshotDigest,
        rbtsSettlementAppliedAt: event.block.timestamp,
      });
    }
  },
);

ponder.on(
  "RoundVotingEngine:RbtsSettlementSnapshotTimedOut",
  async ({ event, context }) => {
    const { contentId, roundId } = event.args as {
      contentId: bigint;
      roundId: bigint;
    };
    const roundKey = `${contentId}-${roundId}`;
    const existingRound = await context.db.find(round, { id: roundKey });
    if (existingRound) {
      await context.db.update(round, { id: roundKey }).set({
        rbtsSettlementStatus: "timed_out",
        rbtsSettlementTimedOutAt: event.block.timestamp,
      });
    }
  },
);

ponder.on("RoundVotingEngine:RbtsRewardsScored", async ({ event, context }) => {
  const {
    contentId,
    roundId,
    rewardWeight,
    rewardClaimants,
    scoreSeed = ZERO_SCORE_SEED,
    forfeitedPool,
    forfeitClaimants,
    meanScoreBps = 0,
  } = event.args as {
    contentId: bigint;
    roundId: bigint;
    rewardWeight: bigint;
    rewardClaimants: bigint;
    scoreSeed?: `0x${string}`;
    forfeitedPool: bigint;
    forfeitClaimants: bigint;
    meanScoreBps?: number;
  };
  const roundKey = `${contentId}-${roundId}`;

  const existingRound = await context.db.find(round, { id: roundKey });
  if (existingRound) {
    await context.db.update(round, { id: roundKey }).set({
      rbtsRewardWeight: rewardWeight,
      rbtsRewardClaimants: Number(rewardClaimants),
      rbtsScoreSeed: scoreSeed,
      rbtsMeanScoreBps: Number(meanScoreBps),
      rbtsForfeitedPool: forfeitedPool,
      rbtsForfeitClaimants: Number(forfeitClaimants),
    });

    const roundVotes = await context.db.sql
      .select()
      .from(vote)
      .where(
        and(
          eq(vote.contentId, contentId),
          eq(vote.roundId, roundId),
          eq(vote.revealed, true),
        ),
      )
      .orderBy(
        asc(vote.commitBlockNumber),
        asc(vote.commitLogIndex),
        asc(vote.id),
      );

    // On-chain scoreless settlement returns RBTS stakes before sampling, so
    // keep revealed votes economically settled but unscored.
    if (scoreSeed === ZERO_SCORE_SEED) {
      for (const roundVote of roundVotes) {
        await context.db.update(vote, { id: roundVote.id }).set({
          rbtsScoreBps: null,
          rbtsRewardWeight: 0n,
          rbtsStakeReturned:
            (roundVote.stake ?? 0n) > 0n ? (roundVote.stake ?? 0n) : 0n,
          rbtsForfeitedStake: 0n,
        });
      }
      return;
    }

    const scoringWeights = await resolveRbtsScoringWeights({
      context,
      contentId,
      roundId,
      roundVotes,
    });

    const scoringSet = roundVotes.filter(
      (roundVote) => (scoringWeights.get(roundVote.id) ?? 0n) > 0n,
    );
    if (scoringSet.length < 3) {
      for (const roundVote of roundVotes) {
        await context.db.update(vote, { id: roundVote.id }).set({
          rbtsRewardWeight: 0n,
          rbtsStakeReturned:
            (roundVote.stake ?? 0n) > 0n ? (roundVote.stake ?? 0n) : 0n,
          rbtsForfeitedStake: 0n,
        });
      }
      return;
    }

    const scoredVotes: {
      id: string;
      scoreBps: number;
      rbtsWeight: bigint;
      stake: bigint;
    }[] = [];

    for (let index = 0; index < scoringSet.length; index += 1) {
      const roundVote = scoringSet[index];
      if (
        roundVote.isUp === null ||
        roundVote.predictedUpBps === null ||
        roundVote.commitHash === null ||
        roundVote.voter === null
      ) {
        continue;
      }

      const ownWeight = scoringWeights.get(roundVote.id) ?? 0n;
      const stake = roundVote.stake ?? 0n;

      const drawKey = nonZeroIdentityKey(
        roundVote.identityKey,
        roundVote.voter,
      );
      const referenceIndex = rbtsOtherIndex({
        scoreSeed,
        commitKey: drawKey,
        ownIndex: index,
        count: scoringSet.length,
        domain: 1,
      });
      const peerIndex = rbtsPeerIndex({
        scoreSeed,
        commitKey: drawKey,
        ownIndex: index,
        referenceIndex,
        count: scoringSet.length,
      });
      const referenceVote = scoringSet[referenceIndex];
      const peerVote = scoringSet[peerIndex];
      if (referenceVote.predictedUpBps === null || peerVote.isUp === null) {
        continue;
      }

      const scoreBps = rbtsScoreBps({
        ownSignalIsUp: roundVote.isUp,
        ownPredictionBps: roundVote.predictedUpBps,
        referencePredictionBps: referenceVote.predictedUpBps,
        peerSignalIsUp: peerVote.isUp,
      });

      scoredVotes.push({
        id: roundVote.id,
        scoreBps,
        rbtsWeight: ownWeight,
        stake,
      });
    }

    if (scoredVotes.length < 3) {
      for (const roundVote of roundVotes) {
        await context.db.update(vote, { id: roundVote.id }).set({
          rbtsRewardWeight: 0n,
          rbtsStakeReturned:
            (roundVote.stake ?? 0n) > 0n ? (roundVote.stake ?? 0n) : 0n,
          rbtsForfeitedStake: 0n,
        });
      }
      return;
    }

    const totalScoreWeight = scoredVotes.reduce(
      (sum, scoredVote) => sum + scoredVote.rbtsWeight,
      0n,
    );
    const weightedScoreSum = scoredVotes.reduce(
      (sum, scoredVote) =>
        sum + scoredVote.rbtsWeight * BigInt(scoredVote.scoreBps),
      0n,
    );
    const positiveSpreadWeight = scoredVotes.reduce((sum, scoredVote) => {
      const benchmarkScoreBps = rbtsLeaveOneOutMeanScoreBps({
        weightedScoreSum,
        totalScoreWeight,
        ownWeight: scoredVote.rbtsWeight,
        ownScoreBps: scoredVote.scoreBps,
      });
      const deltaBps = BigInt(scoredVote.scoreBps) - benchmarkScoreBps;
      return deltaBps > 0n
        ? sum + rbtsPositiveSpreadRewardWeight(scoredVote.rbtsWeight, deltaBps)
        : sum;
    }, 0n);

    for (const scoredVote of scoredVotes) {
      if (scoredVote.stake <= 0n) {
        await context.db.update(vote, { id: scoredVote.id }).set({
          rbtsScoreBps: scoredVote.scoreBps,
          rbtsRewardWeight: 0n,
          rbtsStakeReturned: 0n,
          rbtsForfeitedStake: 0n,
        });
        continue;
      }

      const benchmarkScoreBps = rbtsLeaveOneOutMeanScoreBps({
        weightedScoreSum,
        totalScoreWeight,
        ownWeight: scoredVote.rbtsWeight,
        ownScoreBps: scoredVote.scoreBps,
      });
      const deltaBps = BigInt(scoredVote.scoreBps) - benchmarkScoreBps;
      const forfeitedStake =
        positiveSpreadWeight > 0n && deltaBps < 0n
          ? rbtsNegativeSpreadForfeiture(
              scoredVote.stake,
              -deltaBps,
              scoredVotes.length,
            )
          : 0n;
      await context.db.update(vote, { id: scoredVote.id }).set({
        rbtsScoreBps: scoredVote.scoreBps,
        rbtsRewardWeight:
          deltaBps > 0n
            ? rbtsPositiveSpreadRewardWeight(scoredVote.rbtsWeight, deltaBps)
            : 0n,
        rbtsStakeReturned: scoredVote.stake - forfeitedStake,
        rbtsForfeitedStake: forfeitedStake,
      });
    }

    for (const roundVote of roundVotes) {
      if ((scoringWeights.get(roundVote.id) ?? 0n) > 0n) continue;
      await context.db.update(vote, { id: roundVote.id }).set({
        rbtsRewardWeight: 0n,
        rbtsStakeReturned:
          (roundVote.stake ?? 0n) > 0n ? (roundVote.stake ?? 0n) : 0n,
        rbtsForfeitedStake: 0n,
      });
    }
  }
});

ponder.on("RoundVotingEngine:RoundSettled", async ({ event, context }) => {
  const { contentId, roundId, upWins, losingPool } = event.args;
  const roundKey = `${contentId}-${roundId}`;
  const settledLogIndex = Number(event.log?.logIndex ?? 0);
  const settledTxHash = event.transaction?.hash ?? ZERO_BYTES32;

  const existingRound = await context.db.find(round, { id: roundKey });
  if (existingRound) {
    await context.db.update(round, { id: roundKey }).set({
      state: ROUND_STATE.Settled,
      upWins,
      losingPool,
      settledAt: event.block.timestamp,
      settledBlockNumber: event.block.number,
      settledTxHash,
      settledLogIndex,
    });
  } else {
    await context.db.insert(round).values({
      id: roundKey,
      contentId,
      roundId,
      state: ROUND_STATE.Settled,
      voteCount: 0,
      revealedCount: 0,
      totalStake: 0n,
      upPool: 0n,
      downPool: 0n,
      upCount: 0,
      downCount: 0,
      referenceRatingBps: 5000,
      ratingBps: 5000,
      conservativeRatingBps: 5000,
      confidenceMass: 0n,
      effectiveEvidence: 0n,
      upEvidence: 0n,
      downEvidence: 0n,
      settledRounds: 0,
      lowSince: 0n,
      upWins,
      losingPool,
      settledAt: event.block.timestamp,
      settledBlockNumber: event.block.number,
      settledTxHash,
      settledLogIndex,
      ...defaultRoundConfigFields(),
    });
  }

  await extendFeedbackBonusAwardDeadlinesForTerminalRound(context, {
    contentId,
    roundId,
    settledAt: event.block.timestamp,
  });

  // Increment content round count
  const contentRecord = await context.db.find(content, { id: contentId });
  if (contentRecord) {
    await context.db
      .update(content, { id: contentId })
      .set((row) => ({ totalRounds: row.totalRounds + 1 }));
    await publishConfidentialityAfterSettlement({
      context,
      contentId,
      publishedAt: event.block.timestamp,
      contentRecord,
    });
  }

  // Update global stats
  await context.db
    .insert(globalStats)
    .values({
      id: "global",
      totalContent: 0,
      totalVotes: 0,
      totalRoundsSettled: 1,
      totalRewardsClaimed: 0n,
      totalFrontendFeesClaimed: 0n,
      totalProfiles: 0,
      totalVoterIds: 0,
    })
    .onConflictDoUpdate((row) => ({
      totalRoundsSettled: row.totalRoundsSettled + 1,
    }));

  // Accuracy tracking — only for revealed votes
  const roundVotes = await context.db.sql
    .select()
    .from(vote)
    .where(
      and(
        eq(vote.contentId, contentId),
        eq(vote.roundId, roundId),
        eq(vote.revealed, true),
      ),
    );
  const rbtsRound = roundVotes.some(
    (v) =>
      v.rbtsScoreBps !== null ||
      v.rbtsRewardWeight !== null ||
      v.rbtsStakeReturned !== null ||
      v.rbtsForfeitedStake !== null,
  );

  const categoryId = contentRecord?.categoryId ?? 0n;
  const banState = await loadCorrelationBanStateAt(
    context,
    event.block.timestamp,
  );
  const preSettlementStatsByIdentity = new Map<string, any | null>();
  const loadPreSettlementVoterStats = async (identityHolder: `0x${string}`) => {
    const key = identityHolder.toLowerCase();
    if (!preSettlementStatsByIdentity.has(key)) {
      preSettlementStatsByIdentity.set(
        key,
        await context.db.find(voterStats, { voter: identityHolder }),
      );
    }
    return preSettlementStatsByIdentity.get(key) ?? null;
  };

  for (const v of roundVotes) {
    const identityHolder = voteIdentity(v);
    const existingVoterStats =
      await loadPreSettlementVoterStats(identityHolder);
    const correlationSnapshot = await snapshotCorrelationInputForAccount({
      account: identityHolder,
      banState,
      context,
      historicalVotes: existingVoterStats?.totalSettledVotes ?? 0,
      identityKey: v.identityKey,
      timestamp: event.block.timestamp,
      voter: v.voter,
    });
    await context.db.update(vote, { id: v.id }).set({
      correlationVerifiedHuman: correlationSnapshot.verifiedHuman,
      correlationHistoricalVoteCount:
        correlationSnapshot.historicalVoteCount,
      correlationCredentialProvider: correlationSnapshot.credentialProvider,
      correlationCredentialNullifierHash:
        correlationSnapshot.credentialNullifierHash,
      correlationCredentialVerifiedAt: correlationSnapshot.credentialVerifiedAt,
      correlationCredentialExpiresAt: correlationSnapshot.credentialExpiresAt,
      correlationBanReasons: JSON.stringify(correlationSnapshot.banReasons),
    });

    if (v.isUp === null) continue; // skip unrevealed
    const won = rbtsRound ? (v.rbtsRewardWeight ?? 0n) > 0n : v.isUp === upWins;
    const stakeWon = rbtsRound
      ? (v.rbtsStakeReturned ?? 0n)
      : won
        ? v.stake
        : 0n;
    // Fail safe to 0n (not v.stake) when an RBTS vote has no recorded forfeited
    // stake. In RBTS rounds the forfeited amount is computed and written by the
    // RbtsRewardsScored handler for every scored vote; a null here means that vote
    // was skipped during scoring, so the true forfeited amount is unknown. Falling
    // back to the full stake would overstate voterStats.totalStakeLost, so we treat
    // an unknown forfeiture as zero rather than inflating losses.
    const stakeLost = rbtsRound
      ? (v.rbtsForfeitedStake ?? 0n)
      : won
        ? 0n
        : v.stake;
    // A revealed RBTS vote only counts as a loss when it was actually scored
    // against. On-chain (RoundRevealLib RBTS scoring + RewardMath
    // negativeSpreadForfeiture) the only penalty is forfeited stake: voters
    // scoring below the round mean forfeit part of their stake, while voters
    // at the mean, voters in degraded rounds (scoring set < 3 — full stake
    // returned, weight 0), and post-threshold reveals that were never scored
    // get their entire stake back. We mirror that by treating
    // rbtsForfeitedStake > 0 as the loss criterion; unscored/unpenalized
    // voters are neutral — neither a win nor a loss, and their streak is
    // left untouched. Legacy (non-RBTS) rounds keep the binary outcome.
    const lost = rbtsRound ? !won && stakeLost > 0n : !won;

    // globalStats.totalVoterIds counts distinct voter identities with at
    // least one settled vote. A voterStats row is created exactly once per
    // identity (here, on its first settled vote), so increment when the row
    // does not exist yet.
    if (!existingVoterStats) {
      await context.db
        .insert(globalStats)
        .values({
          id: "global",
          totalContent: 0,
          totalVotes: 0,
          totalRoundsSettled: 0,
          totalRewardsClaimed: 0n,
          totalFrontendFeesClaimed: 0n,
          totalProfiles: 0,
          totalVoterIds: 1,
        })
        .onConflictDoUpdate((row) => ({
          totalVoterIds: row.totalVoterIds + 1,
        }));
    }

    await context.db
      .insert(voterStats)
      .values({
        voter: identityHolder,
        totalSettledVotes: 1,
        totalWins: won ? 1 : 0,
        totalLosses: lost ? 1 : 0,
        totalStakeWon: stakeWon,
        totalStakeLost: stakeLost,
        currentStreak: won ? 1 : lost ? -1 : 0,
        bestWinStreak: won ? 1 : 0,
      })
      .onConflictDoUpdate((row) => {
        // Neutral outcomes (revealed but never scored against) leave the
        // win/loss streak untouched.
        const newStreak = won
          ? row.currentStreak > 0
            ? row.currentStreak + 1
            : 1
          : lost
            ? row.currentStreak < 0
              ? row.currentStreak - 1
              : -1
            : row.currentStreak;
        return {
          totalSettledVotes: row.totalSettledVotes + 1,
          totalWins: row.totalWins + (won ? 1 : 0),
          totalLosses: row.totalLosses + (lost ? 1 : 0),
          totalStakeWon: row.totalStakeWon + stakeWon,
          totalStakeLost: row.totalStakeLost + stakeLost,
          currentStreak: newStreak,
          bestWinStreak: Math.max(row.bestWinStreak, won ? newStreak : 0),
        };
      });

    if (categoryId > 0n) {
      const catStatsId = `${identityHolder}-${categoryId}`;
      await context.db
        .insert(voterCategoryStats)
        .values({
          id: catStatsId,
          voter: identityHolder,
          categoryId,
          totalSettledVotes: 1,
          totalWins: won ? 1 : 0,
          totalLosses: lost ? 1 : 0,
          totalStakeWon: stakeWon,
          totalStakeLost: stakeLost,
        })
        .onConflictDoUpdate((row) => ({
          totalSettledVotes: row.totalSettledVotes + 1,
          totalWins: row.totalWins + (won ? 1 : 0),
          totalLosses: row.totalLosses + (lost ? 1 : 0),
          totalStakeWon: row.totalStakeWon + stakeWon,
          totalStakeLost: row.totalStakeLost + stakeLost,
        }));
    }
  }
});

ponder.on("RoundVotingEngine:RoundCancelled", async ({ event, context }) => {
  const { contentId, roundId } = event.args;
  const roundKey = `${contentId}-${roundId}`;

  const existingRound = await context.db.find(round, { id: roundKey });
  if (existingRound) {
    await context.db.update(round, { id: roundKey }).set((row) => ({
      state: ROUND_STATE.Cancelled,
      referenceRatingBps:
        row.referenceRatingBps > 0 ? row.referenceRatingBps : 5000,
      ratingBps: row.ratingBps > 0 ? row.ratingBps : 5000,
      conservativeRatingBps:
        row.conservativeRatingBps > 0 ? row.conservativeRatingBps : 5000,
    }));
  } else {
    await context.db.insert(round).values({
      id: roundKey,
      contentId,
      roundId,
      state: ROUND_STATE.Cancelled,
      voteCount: 0,
      revealedCount: 0,
      totalStake: 0n,
      upPool: 0n,
      downPool: 0n,
      upCount: 0,
      downCount: 0,
      referenceRatingBps: 5000,
      ratingBps: 5000,
      conservativeRatingBps: 5000,
      confidenceMass: 0n,
      effectiveEvidence: 0n,
      upEvidence: 0n,
      downEvidence: 0n,
      settledRounds: 0,
      lowSince: 0n,
      ...defaultRoundConfigFields(),
    });
  }

  // Cancelled rounds get no feedback-bonus award-deadline extension: on-chain
  // _markRoundCancelled never sets round.settledAt, so FeedbackBonusEscrow's
  // _feedbackBonusAwardDeadline skips the 24h extension and keeps
  // feedbackClosesAt. Extending here would diverge from the contract and
  // surface cancelled pools as awardable (awards on Cancelled rounds revert).
});

ponder.on("RoundVotingEngine:RoundTied", async ({ event, context }) => {
  const { contentId, roundId } = event.args;
  const roundKey = `${contentId}-${roundId}`;

  const existingRound = await context.db.find(round, { id: roundKey });
  if (existingRound) {
    await context.db.update(round, { id: roundKey }).set((row) => ({
      state: ROUND_STATE.Tied,
      settledAt: event.block.timestamp,
      referenceRatingBps:
        row.referenceRatingBps > 0 ? row.referenceRatingBps : 5000,
      ratingBps: row.ratingBps > 0 ? row.ratingBps : 5000,
      conservativeRatingBps:
        row.conservativeRatingBps > 0 ? row.conservativeRatingBps : 5000,
    }));
  } else {
    await context.db.insert(round).values({
      id: roundKey,
      contentId,
      roundId,
      state: ROUND_STATE.Tied,
      voteCount: 0,
      revealedCount: 0,
      totalStake: 0n,
      upPool: 0n,
      downPool: 0n,
      upCount: 0,
      downCount: 0,
      referenceRatingBps: 5000,
      ratingBps: 5000,
      conservativeRatingBps: 5000,
      confidenceMass: 0n,
      effectiveEvidence: 0n,
      upEvidence: 0n,
      downEvidence: 0n,
      settledRounds: 0,
      lowSince: 0n,
      settledAt: event.block.timestamp,
      ...defaultRoundConfigFields(),
    });
  }

  await extendFeedbackBonusAwardDeadlinesForTerminalRound(context, {
    contentId,
    roundId,
    settledAt: event.block.timestamp,
  });
  await publishConfidentialityAfterSettlement({
    context,
    contentId,
    publishedAt: event.block.timestamp,
  });
});

ponder.on("RoundVotingEngine:RoundRevealFailed", async ({ event, context }) => {
  const { contentId, roundId } = event.args;
  const roundKey = `${contentId}-${roundId}`;

  const existingRound = await context.db.find(round, { id: roundKey });
  if (existingRound) {
    await context.db.update(round, { id: roundKey }).set((row) => ({
      state: ROUND_STATE.RevealFailed,
      settledAt: event.block.timestamp,
      referenceRatingBps:
        row.referenceRatingBps > 0 ? row.referenceRatingBps : 5000,
      ratingBps: row.ratingBps > 0 ? row.ratingBps : 5000,
      conservativeRatingBps:
        row.conservativeRatingBps > 0 ? row.conservativeRatingBps : 5000,
    }));
  } else {
    await context.db.insert(round).values({
      id: roundKey,
      contentId,
      roundId,
      state: ROUND_STATE.RevealFailed,
      voteCount: 0,
      revealedCount: 0,
      totalStake: 0n,
      upPool: 0n,
      downPool: 0n,
      upCount: 0,
      downCount: 0,
      referenceRatingBps: 5000,
      ratingBps: 5000,
      conservativeRatingBps: 5000,
      confidenceMass: 0n,
      effectiveEvidence: 0n,
      upEvidence: 0n,
      downEvidence: 0n,
      settledRounds: 0,
      lowSince: 0n,
      settledAt: event.block.timestamp,
      ...defaultRoundConfigFields(),
    });
  }

  await extendFeedbackBonusAwardDeadlinesForTerminalRound(context, {
    contentId,
    roundId,
    settledAt: event.block.timestamp,
  });
  await publishConfidentialityAfterSettlement({
    context,
    contentId,
    publishedAt: event.block.timestamp,
  });
});

ponder.on(
  "RoundVotingEngine:CancelledRoundRefundClaimed",
  async ({ event, context }) => {
    const { contentId, roundId, voter, amount } = event.args;

    // Record refund as a reward claim with source "refund". The cancelled-round refund pays
    // the original `commit.voter`, so voter and stakePayer collapse to the same address here.
    await context.db
      .insert(rewardClaim)
      .values({
        id: `refund-${contentId}-${roundId}-${voter}`,
        contentId,
        roundId,
        epochId: null,
        source: "refund",
        voter,
        stakePayer: voter,
        stakeReturned: amount,
        lrepReward: 0n,
        claimedAt: event.block.timestamp,
      })
      .onConflictDoNothing();
  },
);
