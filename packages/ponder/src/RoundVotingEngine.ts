import { ponder } from "ponder:registry";
import { asc, eq, and } from "ponder";
import { encodePacked, keccak256 } from "viem";
import {
  DEFAULT_ROUND_CONFIG,
  ROUND_STATE,
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
} from "ponder:schema";
import {
  formatUtcDateKey,
  getPreviousUtcDateKey,
  normalizeUtcDateKey,
} from "./streak-utils.js";

const RBTS_SCORE_SCALE_BPS = 10_000;
const RBTS_SCORE_SCALE = 10_000n;
const ZERO_SCORE_SEED = `0x${"00".repeat(32)}` as `0x${string}`;

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

function roundReferenceFields(referenceRatingBps: number) {
  return {
    referenceRatingBps,
    ratingBps: referenceRatingBps,
    conservativeRatingBps: referenceRatingBps,
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

function weightByRbtsScore(amount: bigint, scoreBps: number): bigint {
  if (scoreBps <= 0 || amount <= 0n) return 0n;
  return (amount * BigInt(scoreBps)) / RBTS_SCORE_SCALE;
}

function rbtsCommitKey(voter: `0x${string}`, commitHash: `0x${string}`) {
  return keccak256(encodePacked(["address", "bytes32"], [voter, commitHash]));
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
  const voteKey = `${contentId}-${roundId}-${voter}`;
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
    await context.db.update(round, { id: roundKey }).set((row) => ({
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
  } = event.args as {
    contentId: bigint;
    roundId: bigint;
    voter: `0x${string}`;
    commitHash: `0x${string}`;
    roundReferenceRatingBps: number;
    targetRound: bigint;
    drandChainHash: `0x${string}`;
    stake: bigint;
  };
  const roundKey = `${contentId}-${roundId}`;
  const voteKey = `${contentId}-${roundId}-${voter}`;
  const referenceRatingBps = Number(roundReferenceRatingBps);

  // Upsert round record — VoteCommitted is the first event for a new round
  const existingRound = await context.db.find(round, { id: roundKey });
  const epochIndex = existingRound
    ? computeVoteEpochIndex(
        event.block.timestamp,
        existingRound.startTime ?? event.block.timestamp,
        existingRound.epochDuration,
      )
    : 0;

  if (!existingRound) {
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
      settledRounds: 0,
      lowSince: 0n,
      startTime: event.block.timestamp,
      ...defaultRoundConfigFields(),
    });
  } else {
    await context.db.update(round, { id: roundKey }).set((row) => ({
      voteCount: row.voteCount + 1,
      totalStake: row.totalStake + stake,
      ...roundReferenceFields(referenceRatingBps),
    }));
  }

  // Create vote record (direction hidden until revealed)
  await context.db
    .insert(vote)
    .values({
      id: voteKey,
      contentId,
      roundId,
      voter,
      commitHash,
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
      commitBlockNumber: event.block.number,
      commitLogIndex: Number(event.log?.logIndex ?? 0),
      revealedAt: null,
    })
    .onConflictDoNothing();

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
  const existingProfile = await context.db.find(profile, { address: voter });
  if (existingProfile) {
    await context.db
      .update(profile, { address: voter })
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
      totalProfiles: 0,
      totalVoterIds: 0,
    })
    .onConflictDoUpdate((row) => ({
      totalVotes: row.totalVotes + 1,
    }));

  // --- Daily streak tracking ---
  const date = new Date(Number(event.block.timestamp) * 1000);
  const dateStr = formatUtcDateKey(date);
  const activityKey = `${voter}-${dateStr}`;

  // Upsert daily activity
  await context.db
    .insert(dailyVoteActivity)
    .values({
      id: activityKey,
      voter,
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
  const existingStreak = await context.db.find(voterStreak, { voter });
  if (!existingStreak) {
    await context.db.insert(voterStreak).values({
      voter,
      currentDailyStreak: 1,
      bestDailyStreak: 1,
      lastActiveDate: dateStr,
      totalActiveDays: 1,
      lastMilestoneDay: 0,
    });
  } else if (normalizeUtcDateKey(existingStreak.lastActiveDate) === dateStr) {
    // Already active today — no streak change
    if (existingStreak.lastActiveDate !== dateStr) {
      await context.db.update(voterStreak, { voter }).set({
        lastActiveDate: dateStr,
      });
    }
  } else if (
    yesterdayStr !== null &&
    normalizeUtcDateKey(existingStreak.lastActiveDate) === yesterdayStr
  ) {
    // Consecutive day — increment streak
    const newStreak = existingStreak.currentDailyStreak + 1;
    await context.db.update(voterStreak, { voter }).set({
      currentDailyStreak: newStreak,
      bestDailyStreak: Math.max(existingStreak.bestDailyStreak, newStreak),
      lastActiveDate: dateStr,
      totalActiveDays: existingStreak.totalActiveDays + 1,
    });
  } else {
    // Gap — reset streak to 1 (also reset milestones to match on-chain)
    await context.db.update(voterStreak, { voter }).set({
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

ponder.on("RoundVotingEngine:RbtsRewardsScored", async ({ event, context }) => {
  const {
    contentId,
    roundId,
    rewardWeight,
    rewardClaimants,
    scoreSeed = ZERO_SCORE_SEED,
    forfeitedPool,
    forfeitClaimants,
  } = event.args as {
    contentId: bigint;
    roundId: bigint;
    rewardWeight: bigint;
    rewardClaimants: bigint;
    scoreSeed?: `0x${string}`;
    forfeitedPool: bigint;
    forfeitClaimants: bigint;
  };
  const roundKey = `${contentId}-${roundId}`;

  const existingRound = await context.db.find(round, { id: roundKey });
  if (existingRound) {
    await context.db.update(round, { id: roundKey }).set({
      rbtsRewardWeight: rewardWeight,
      rbtsRewardClaimants: Number(rewardClaimants),
      rbtsScoreSeed: scoreSeed,
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

    const economicVotes = roundVotes.filter(
      (roundVote) => (roundVote.rbtsWeight ?? 0n) > 0n,
    );

    for (let index = 0; index < roundVotes.length; index += 1) {
      const roundVote = roundVotes[index];
      if (
        roundVote.isUp === null ||
        roundVote.predictedUpBps === null ||
        roundVote.commitHash === null ||
        roundVote.voter === null
      ) {
        continue;
      }

      const ownWeight = roundVote.rbtsWeight ?? 0n;
      const stake = roundVote.stake ?? 0n;

      const commitKey = rbtsCommitKey(roundVote.voter, roundVote.commitHash);
      const referenceIndex = rbtsOtherIndex({
        scoreSeed,
        commitKey,
        ownIndex: index,
        count: roundVotes.length,
        domain: 1,
      });
      const peerIndex = rbtsPeerIndex({
        scoreSeed,
        commitKey,
        ownIndex: index,
        referenceIndex,
        count: roundVotes.length,
      });
      const referenceVote = roundVotes[referenceIndex];
      const peerVote = roundVotes[peerIndex];
      if (referenceVote.predictedUpBps === null || peerVote.isUp === null) {
        continue;
      }

      const scoreBps = rbtsScoreBps({
        ownSignalIsUp: roundVote.isUp,
        ownPredictionBps: roundVote.predictedUpBps,
        referencePredictionBps: referenceVote.predictedUpBps,
        peerSignalIsUp: peerVote.isUp,
      });

      if (ownWeight === 0n || economicVotes.length < 3) {
        await context.db.update(vote, { id: roundVote.id }).set({
          rbtsScoreBps: scoreBps,
          rbtsRewardWeight: 0n,
          rbtsStakeReturned: ownWeight > 0n ? stake : 0n,
          rbtsForfeitedStake: 0n,
        });
        continue;
      }

      await context.db.update(vote, { id: roundVote.id }).set({
        rbtsScoreBps: scoreBps,
        rbtsRewardWeight: weightByRbtsScore(ownWeight, scoreBps),
        rbtsStakeReturned: weightByRbtsScore(stake, scoreBps),
        rbtsForfeitedStake: stake - weightByRbtsScore(stake, scoreBps),
      });
    }
  }
});

ponder.on("RoundVotingEngine:RoundSettled", async ({ event, context }) => {
  const { contentId, roundId, upWins, losingPool } = event.args;
  const roundKey = `${contentId}-${roundId}`;

  const existingRound = await context.db.find(round, { id: roundKey });
  if (existingRound) {
    await context.db.update(round, { id: roundKey }).set({
      state: ROUND_STATE.Settled,
      upWins,
      losingPool,
      settledAt: event.block.timestamp,
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
      settledRounds: 0,
      lowSince: 0n,
      upWins,
      losingPool,
      settledAt: event.block.timestamp,
    });
  }

  // Increment content round count
  const contentRecord = await context.db.find(content, { id: contentId });
  if (contentRecord) {
    await context.db
      .update(content, { id: contentId })
      .set((row) => ({ totalRounds: row.totalRounds + 1 }));
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

  for (const v of roundVotes) {
    if (v.isUp === null) continue; // skip unrevealed
    const won = rbtsRound ? (v.rbtsRewardWeight ?? 0n) > 0n : v.isUp === upWins;
    const stakeWon = rbtsRound
      ? (v.rbtsStakeReturned ?? 0n)
      : won
        ? v.stake
        : 0n;
    const stakeLost = rbtsRound
      ? (v.rbtsForfeitedStake ?? v.stake)
      : won
        ? 0n
        : v.stake;

    await context.db
      .insert(voterStats)
      .values({
        voter: v.voter,
        totalSettledVotes: 1,
        totalWins: won ? 1 : 0,
        totalLosses: won ? 0 : 1,
        totalStakeWon: stakeWon,
        totalStakeLost: stakeLost,
        currentStreak: won ? 1 : -1,
        bestWinStreak: won ? 1 : 0,
      })
      .onConflictDoUpdate((row) => {
        const newStreak = won
          ? row.currentStreak > 0
            ? row.currentStreak + 1
            : 1
          : row.currentStreak < 0
            ? row.currentStreak - 1
            : -1;
        return {
          totalSettledVotes: row.totalSettledVotes + 1,
          totalWins: row.totalWins + (won ? 1 : 0),
          totalLosses: row.totalLosses + (won ? 0 : 1),
          totalStakeWon: row.totalStakeWon + stakeWon,
          totalStakeLost: row.totalStakeLost + stakeLost,
          currentStreak: newStreak,
          bestWinStreak: Math.max(row.bestWinStreak, won ? newStreak : 0),
        };
      });

    if (categoryId > 0n) {
      const catStatsId = `${v.voter}-${categoryId}`;
      await context.db
        .insert(voterCategoryStats)
        .values({
          id: catStatsId,
          voter: v.voter,
          categoryId,
          totalSettledVotes: 1,
          totalWins: won ? 1 : 0,
          totalLosses: won ? 0 : 1,
          totalStakeWon: stakeWon,
          totalStakeLost: stakeLost,
        })
        .onConflictDoUpdate((row) => ({
          totalSettledVotes: row.totalSettledVotes + 1,
          totalWins: row.totalWins + (won ? 1 : 0),
          totalLosses: row.totalLosses + (won ? 0 : 1),
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
      settledRounds: 0,
      lowSince: 0n,
    });
  }
});

ponder.on("RoundVotingEngine:RoundTied", async ({ event, context }) => {
  const { contentId, roundId } = event.args;
  const roundKey = `${contentId}-${roundId}`;

  const existingRound = await context.db.find(round, { id: roundKey });
  if (existingRound) {
    await context.db.update(round, { id: roundKey }).set((row) => ({
      state: ROUND_STATE.Tied,
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
      settledRounds: 0,
      lowSince: 0n,
    });
  }
});

ponder.on("RoundVotingEngine:RoundRevealFailed", async ({ event, context }) => {
  const { contentId, roundId } = event.args;
  const roundKey = `${contentId}-${roundId}`;

  const existingRound = await context.db.find(round, { id: roundKey });
  if (existingRound) {
    await context.db.update(round, { id: roundKey }).set((row) => ({
      state: ROUND_STATE.RevealFailed,
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
      settledRounds: 0,
      lowSince: 0n,
    });
  }
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
        hrepReward: 0n,
        claimedAt: event.block.timestamp,
      })
      .onConflictDoNothing();
  },
);
