import type { Context } from "hono";
import { REVEAL_FAILED_GRACE_MULTIPLIER, ROUND_STATE } from "@rateloop/contracts/protocol";
import { and, asc, eq, inArray, or, sql } from "ponder";
import { db } from "ponder:api";
import { content, feedbackBonusPool, round } from "ponder:schema";
import type { ApiApp } from "../shared.js";
import { jsonBig } from "../shared.js";
import { safeBigInt, safeLimit } from "../utils.js";

const DEFAULT_KEEPER_WORK_LIMIT = 500;
const MAX_KEEPER_WORK_LIMIT = 2_000;
const MAX_DORMANT_CANDIDATE_LIMIT = 500;

function safeNonNegativeBigIntParam(value: string | undefined): bigint | null {
  if (value === undefined) return null;
  const parsed = safeBigInt(value);
  return parsed !== null && parsed >= 0n ? parsed : null;
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
          when ${round.voteCount} > ${round.revealedCount} then 'reveal'
          when ${round.voteCount} >= ${revealQuorum}
            and ${round.revealedCount} < ${revealQuorum}
            and ${round.humanVerifiedCommitCount} >= ${revealQuorum}
            and ${revealFailedDeadlinePassed}
            then 'reveal_failed'
          when ${roundExpired} then 'cancel'
          else 'open'
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
          sql`${content.bundleId} = 0`,
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
              ${round.state} = ${ROUND_STATE.Open}
              and ${round.startTime} is not null
              and ${round.startTime} > 0
            )`,
          ),
          sql`${feedbackBonusPool.awardDeadline} + ${feedbackBonusForfeitMinAge} < ${now}`,
        ),
      )
      .orderBy(asc(feedbackBonusPool.awardDeadline), asc(feedbackBonusPool.id))
      .limit(limit);

    return jsonBig(c, {
      now,
      limit,
      source: "ponder",
      openRounds,
      cleanupRounds,
      dormantContent,
      feedbackBonusForfeits,
    });
  });
}
