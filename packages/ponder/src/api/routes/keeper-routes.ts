import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { and, asc, eq, inArray, or, sql } from "ponder";
import { db } from "ponder:api";
import { content, round } from "ponder:schema";
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

export function registerKeeperRoutes(app: ApiApp) {
  app.get("/keeper/work", async (c) => {
    const now = safeNonNegativeBigIntParam(c.req.query("now"));
    const dormancyPeriod = safeNonNegativeBigIntParam(
      c.req.query("dormancyPeriod"),
    );
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
      ) + ${round.revealGracePeriod}
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
            and ${round.hasHumanVerifiedCommit} = true
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
          sql`${content.lastActivityAt} > 0`,
          sql`${now} > ${content.lastActivityAt} + ${dormancyPeriod}`,
        ),
      )
      .orderBy(asc(content.lastActivityAt), asc(content.id))
      .limit(Math.min(limit, MAX_DORMANT_CANDIDATE_LIMIT));

    return jsonBig(c, {
      now,
      limit,
      source: "ponder",
      openRounds,
      cleanupRounds,
      dormantContent,
    });
  });
}
