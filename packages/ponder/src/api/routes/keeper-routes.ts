import type { Context } from "hono";
import {
  PAYOUT_DOMAIN,
  REVEAL_FAILED_GRACE_MULTIPLIER,
  ROUND_STATE,
} from "@rateloop/contracts/protocol";
import { and, asc, desc, eq, inArray, or, sql } from "ponder";
import { db } from "ponder:api";
import {
  content,
  feedbackBonusPool,
  questionBundleQuestion,
  questionBundleReward,
  questionRewardPool,
  questionRewardPoolPreQualificationSkip,
  questionRewardPoolRound,
  round,
  roundPayoutSnapshot,
  vote,
} from "ponder:schema";
import { buildCorrelationFinalitySla } from "../correlation-finality-sla.js";
import { inspectHumanVerifiedCommitCountHealth } from "../human-verified-commit-health.js";
import type { ApiApp } from "../shared.js";
import {
  jsonBig,
  questionRewardPoolHasValidBountyWindowExpression,
} from "../shared.js";
import { parseStrictUnsignedBigInt, safeLimit } from "../utils.js";

const DEFAULT_KEEPER_WORK_LIMIT = 500;
const MAX_KEEPER_WORK_LIMIT = 2_000;
const MAX_DORMANT_CANDIDATE_LIMIT = 500;
const MAX_ROUND_OPEN_CANDIDATE_LIMIT = 25;
const SNAPSHOT_STATUS_FINALIZED = 3;

function standaloneContentPredicate() {
  return sql<boolean>`(${content.bundleId} is null or ${content.bundleId} = 0)`;
}

function safeNonNegativeBigIntParam(value: string | undefined): bigint | null {
  if (value === undefined) return null;
  return parseStrictUnsignedBigInt(value);
}

function authorizeKeeperWork(c: Context) {
  const token = process.env.PONDER_KEEPER_WORK_TOKEN?.trim() || null;
  if (!token) {
    return process.env.NODE_ENV === "production"
      ? "PONDER_KEEPER_WORK_TOKEN is required in production."
      : null;
  }
  return c.req.header("authorization") === `Bearer ${token}` ? null : "Invalid keeper work token.";
}

export function registerKeeperRoutes(app: ApiApp) {
  app.get("/keeper/work", async (c) => {
    const authError = authorizeKeeperWork(c);
    if (authError) {
      return c.json({ error: authError }, authError.includes("required") ? 503 : 401);
    }

    const now = safeNonNegativeBigIntParam(c.req.query("now"));
    const dormancyPeriod = safeNonNegativeBigIntParam(
      c.req.query("dormancyPeriod"),
    );
    const feedbackBonusForfeitMinAge = safeNonNegativeBigIntParam(
      c.req.query("feedbackBonusForfeitMinAge"),
    ) ?? 0n;
    const roundOpenLimit = safeLimit(c.req.query("roundOpenLimit"), 0, MAX_ROUND_OPEN_CANDIDATE_LIMIT);
    const roundOpenRecentSeconds = safeNonNegativeBigIntParam(c.req.query("roundOpenRecentSeconds")) ?? 0n;
    const limit = safeLimit(
      c.req.query("limit"),
      DEFAULT_KEEPER_WORK_LIMIT,
      MAX_KEEPER_WORK_LIMIT,
    );

    if (now === null || dormancyPeriod === null) {
      return c.json(
        { error: "now and dormancyPeriod must be non-negative integer seconds" },
        400,
      );
    }

    const revealQuorum = sql<number>`greatest(${round.minVoters}, 3)`;
    // Dormancy blocking mirrors RoundVotingReadLib.isDormancyBlocked (minVoters, not revealQuorum).
    const roundExpired = sql<boolean>`
      ${round.startTime} is not null
      and ${round.startTime} > 0
      and ${now} >= ${round.startTime} + ${round.maxDuration}
    `;
    const revealFailedDeadlinePassed = sql<boolean>`
      ${round.lastCommitRevealableAfter} is not null
      and ${round.lastCommitRevealableAfter} > 0
      and ${round.revealGracePeriod} is not null
      and ${now} >= greatest(
        ${round.lastCommitRevealableAfter},
        coalesce(${round.startTime}, 0) + ${round.maxDuration}
      ) + ${round.revealGracePeriod} * ${REVEAL_FAILED_GRACE_MULTIPLIER}
    `;

    const openRounds = await db
      .select({
        contentId: round.contentId,
        roundId: round.roundId,
        reason: sql<string>`case
          when ${round.revealedCount} >= ${revealQuorum} then 'settle'
          when ${round.voteCount} >= ${revealQuorum}
            and ${round.revealedCount} < ${revealQuorum}
            and ${revealFailedDeadlinePassed}
            then 'reveal_failed'
          when ${roundExpired} then 'cancel'
          when ${round.voteCount} > ${round.revealedCount} then 'reveal'
          else 'open'
        end`,
        settlementReadyAt: sql<bigint | null>`case
          when ${round.revealedCount} >= ${revealQuorum} then (
            select max(${vote.revealedAt})
            from ${vote}
            where ${vote.contentId} = ${round.contentId}
              and ${vote.roundId} = ${round.roundId}
              and ${vote.revealed} = true
          )
          else null
        end`,
      })
      .from(round)
      .where(
        and(
          eq(round.state, ROUND_STATE.Open),
          or(
            sql`${round.voteCount} > ${round.revealedCount}`,
            sql`${round.revealedCount} >= ${revealQuorum}`,
            roundExpired,
            revealFailedDeadlinePassed,
          ),
        ),
      )
      .orderBy(asc(round.contentId), asc(round.roundId))
      .limit(limit);

    const roundOpenRequests =
      roundOpenLimit > 0 && roundOpenRecentSeconds > 0n
        ? await db
            .select({
              contentId: content.id,
              reason: sql<string>`'proactive_open'`,
            })
            .from(content)
            .where(
              and(
                eq(content.status, 0),
                eq(content.gated, false),
                standaloneContentPredicate(),
                sql`${content.lastActivityAt} > 0`,
                sql`${content.lastActivityAt} + ${roundOpenRecentSeconds} >= ${now}`,
                sql`not exists (
                  select 1 from ${round}
                  where ${round.contentId} = ${content.id}
                    and ${round.state} = ${ROUND_STATE.Open}
                )`,
                sql`not exists (
                  select 1 from ${round}
                  where ${round.contentId} = ${content.id}
                    and ${round.voteCount} = 0
                )`,
              ),
            )
            .orderBy(desc(content.lastActivityAt), desc(content.id))
            .limit(roundOpenLimit)
        : [];

    const cleanupRounds = await db
      .select({
        contentId: round.contentId,
        roundId: round.roundId,
        reason: sql<string>`'cleanup'`,
      })
      .from(round)
      .where(
        and(
          inArray(round.state, [
            ROUND_STATE.Settled,
            ROUND_STATE.Tied,
            ROUND_STATE.RevealFailed,
            ROUND_STATE.SettlementPending,
          ]),
          sql`${round.voteCount} > ${round.revealedCount}`,
        ),
      )
      .orderBy(asc(round.contentId), asc(round.roundId))
      .limit(limit);

    const dormantContent = await db
      .select({
        contentId: content.id,
        reason: sql<string>`'dormant'`,
      })
      .from(content)
      .where(
        and(
          eq(content.status, 0),
          standaloneContentPredicate(),
          sql`${content.lastActivityAt} > 0`,
          sql`${now} > ${content.lastActivityAt} + ${dormancyPeriod}`,
          sql`not exists (
            select 1 from ${round}
            where ${round.contentId} = ${content.id}
              and ${round.state} = ${ROUND_STATE.Open}
              and ${round.voteCount} > 0
              and ${round.totalStake} > 0
              and (
                ${round.revealedCount} >= ${round.minVoters}
                or (
                  ${round.voteCount} >= ${round.minVoters}
                  and ${round.humanVerifiedCommitCount} >= ${round.minVoters}
                )
              )
          )`,
        ),
      )
      .orderBy(asc(content.lastActivityAt), asc(content.id))
      .limit(Math.min(limit, MAX_DORMANT_CANDIDATE_LIMIT));

    const feedbackBonusForfeits = await db
      .select({
        poolId: feedbackBonusPool.id,
        contentId: feedbackBonusPool.contentId,
        roundId: feedbackBonusPool.roundId,
        awardDeadline: feedbackBonusPool.awardDeadline,
        remainingAmount: feedbackBonusPool.remainingAmount,
        reason: sql<string>`'feedback_bonus_forfeit'`,
      })
      .from(feedbackBonusPool)
      .leftJoin(
        round,
        and(
          eq(round.contentId, feedbackBonusPool.contentId),
          eq(round.roundId, feedbackBonusPool.roundId),
        ),
      )
      .where(
        and(
          eq(feedbackBonusPool.forfeited, false),
          sql`${feedbackBonusPool.remainingAmount} > 0`,
          or(
            sql`${round.contentId} is null`,
            sql`not (
              (
                ${round.state} = ${ROUND_STATE.Open}
                or ${round.state} = ${ROUND_STATE.SettlementPending}
              )
              and ${round.startTime} is not null
              and ${round.startTime} > 0
            )`,
          ),
          sql`${feedbackBonusPool.awardDeadline} + ${feedbackBonusForfeitMinAge} < ${now}`,
        ),
      )
      .orderBy(asc(feedbackBonusPool.awardDeadline), asc(feedbackBonusPool.id))
      .limit(limit);

    const humanVerifiedCommitCount = await inspectHumanVerifiedCommitCountHealth();
    const rewardPoolQualifications = await db
      .select({
        rewardPoolId: questionRewardPool.id,
        contentId: questionRewardPool.contentId,
        roundId: round.roundId,
        requiredVoters: questionRewardPool.requiredVoters,
        snapshotRawEligibleVoters: roundPayoutSnapshot.rawEligibleVoters,
        snapshotEffectiveParticipantUnits:
          roundPayoutSnapshot.effectiveParticipantUnits,
        snapshotTotalClaimWeight: roundPayoutSnapshot.totalClaimWeight,
        reason: sql<string>`'reward_pool_qualification'`,
      })
      .from(questionRewardPool)
      .innerJoin(
        round,
        and(
          eq(round.contentId, questionRewardPool.contentId),
          eq(round.state, ROUND_STATE.Settled),
          sql`${round.roundId} >= ${questionRewardPool.startRoundId}`,
        ),
      )
      .leftJoin(
        questionRewardPoolRound,
        and(
          eq(questionRewardPoolRound.rewardPoolId, questionRewardPool.id),
          eq(questionRewardPoolRound.roundId, round.roundId),
        ),
      )
      .leftJoin(
        questionRewardPoolPreQualificationSkip,
        and(
          eq(
            questionRewardPoolPreQualificationSkip.rewardPoolId,
            questionRewardPool.id,
          ),
          eq(questionRewardPoolPreQualificationSkip.roundId, round.roundId),
        ),
      )
      .leftJoin(
        roundPayoutSnapshot,
        and(
          eq(roundPayoutSnapshot.domain, PAYOUT_DOMAIN.QuestionReward),
          eq(roundPayoutSnapshot.rewardPoolId, questionRewardPool.id),
          eq(roundPayoutSnapshot.contentId, questionRewardPool.contentId),
          eq(roundPayoutSnapshot.roundId, round.roundId),
          eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS_FINALIZED),
        ),
      )
      .where(
        and(
          eq(questionRewardPool.refunded, false),
          sql`${questionRewardPool.qualifiedRounds} < ${questionRewardPool.requiredSettledRounds}`,
          sql`${questionRewardPool.unallocatedAmount} > 0`,
          sql`${questionRewardPool.bountyOpensAt} <= ${now}`,
          questionRewardPoolHasValidBountyWindowExpression(),
          sql`${round.settledAt} is not null`,
          sql`${round.settledAt} > 0`,
          sql`${questionRewardPoolRound.id} is null`,
          or(
            sql`${questionRewardPoolPreQualificationSkip.id} is null`,
            sql`${roundPayoutSnapshot.id} is not null`,
          ),
          sql`(
            ${questionRewardPool.bountyClosesAt} = 0
            or ${round.startTime} <= ${questionRewardPool.bountyClosesAt}
          )`,
        ),
      )
      .orderBy(
        asc(questionRewardPool.bountyClosesAt),
        asc(questionRewardPool.id),
        asc(round.roundId),
      )
      .limit(limit);

    const bundleTerminalSyncs = await db
      .select({
        bundleId: questionBundleReward.id,
        reason: sql<string>`'bundle_terminal_sync'`,
      })
      .from(questionBundleReward)
      .where(
        and(
          eq(questionBundleReward.failed, false),
          eq(questionBundleReward.refunded, false),
          sql`${questionBundleReward.completedRoundSetCount} < ${questionBundleReward.requiredSettledRounds}`,
          sql`${questionBundleReward.bountyOpensAt} <= ${now}`,
          sql`exists (
            select 1
            from ${questionBundleQuestion}
            join ${round} on ${round.contentId} = ${questionBundleQuestion.contentId}
            where ${questionBundleQuestion.bundleId} = ${questionBundleReward.id}
              and ${round.state} in (
                ${ROUND_STATE.Settled},
                ${ROUND_STATE.Cancelled},
                ${ROUND_STATE.Tied},
                ${ROUND_STATE.RevealFailed}
              )
          )`,
        ),
      )
      .orderBy(
        asc(questionBundleReward.bountyClosesAt),
        asc(questionBundleReward.id),
      )
      .limit(limit);

    const correlationFinality = await buildCorrelationFinalitySla(now);

    return jsonBig(c, {
      now,
      limit,
      source: "ponder",
      health: {
        humanVerifiedCommitCount,
        correlationFinality,
      },
      roundOpenRequests,
      openRounds,
      cleanupRounds,
      dormantContent,
      feedbackBonusForfeits,
      rewardPoolQualifications,
      bundleTerminalSyncs,
    });
  });
}
