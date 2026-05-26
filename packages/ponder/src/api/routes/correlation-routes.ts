import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { and, asc, desc, eq, or, sql } from "ponder";
import { db } from "ponder:api";
import {
  content,
  correlationEpochSnapshot,
  questionRewardPool,
  round,
  roundPayoutSnapshot,
  raterHumanCredential,
  vote,
  voterStats,
} from "ponder:schema";
import type { ApiApp } from "../shared.js";
import { jsonBig } from "../shared.js";
import { safeBigInt, safeLimit, safeOffset } from "../utils.js";

const REWARD_ASSET_USDC = 1;
const PAYOUT_DOMAIN_QUESTION_REWARD = 1;
const SNAPSHOT_STATUS_PROPOSED = 1;
const SNAPSHOT_STATUS_REJECTED = 4;
const ZERO_HASH = `0x${"0".repeat(64)}` as const;

function validPositiveBigIntParam(value: string | undefined): bigint | null {
  if (!value) return null;
  const parsed = safeBigInt(value);
  return parsed !== null && parsed > 0n ? parsed : null;
}

function optionalNonNegativeNumberParam(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

export function registerCorrelationRoutes(app: ApiApp) {
  app.get("/correlation/round-candidates", async (c) => {
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const rows = await db
      .select({
        rewardPoolId: questionRewardPool.id,
        contentId: questionRewardPool.contentId,
        roundId: round.roundId,
        requiredVoters: questionRewardPool.requiredVoters,
        requiredSettledRounds: questionRewardPool.requiredSettledRounds,
        qualifiedRounds: questionRewardPool.qualifiedRounds,
        bountyEligibility: questionRewardPool.bountyEligibility,
        bountyClosesAt: questionRewardPool.bountyClosesAt,
        settledAt: round.settledAt,
        revealedCount: round.revealedCount,
        snapshotStatus: roundPayoutSnapshot.status,
      })
      .from(questionRewardPool)
      .innerJoin(round, eq(round.contentId, questionRewardPool.contentId))
      .leftJoin(
        roundPayoutSnapshot,
        and(
          eq(roundPayoutSnapshot.domain, PAYOUT_DOMAIN_QUESTION_REWARD),
          eq(roundPayoutSnapshot.rewardPoolId, questionRewardPool.id),
          eq(roundPayoutSnapshot.contentId, questionRewardPool.contentId),
          eq(roundPayoutSnapshot.roundId, round.roundId),
        ),
      )
      .where(
        and(
          eq(questionRewardPool.asset, REWARD_ASSET_USDC),
          eq(questionRewardPool.refunded, false),
          sql`${questionRewardPool.qualifiedRounds} < ${questionRewardPool.requiredSettledRounds}`,
          eq(round.state, ROUND_STATE.Settled),
          sql`${round.roundId} >= ${questionRewardPool.startRoundId}`,
          or(
            sql`${roundPayoutSnapshot.id} is null`,
            eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS_PROPOSED),
            eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS_REJECTED),
          ),
        ),
      )
      .orderBy(desc(round.roundId), asc(questionRewardPool.id))
      .limit(limit)
      .offset(offset);

    return jsonBig(c, { items: rows });
  });

  app.get("/correlation/round-votes", async (c) => {
    const rewardPoolId = validPositiveBigIntParam(c.req.query("rewardPoolId"));
    const contentId = validPositiveBigIntParam(c.req.query("contentId"));
    const roundId = validPositiveBigIntParam(c.req.query("roundId"));
    const limit = safeLimit(c.req.query("limit"), 500, 1000);
    const offset = safeOffset(c.req.query("offset"));

    if (rewardPoolId === null || contentId === null || roundId === null) {
      return c.json({ error: "rewardPoolId, contentId, and roundId must be positive integers" }, 400);
    }
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const currentUnixSeconds = BigInt(Math.floor(Date.now() / 1000));
    const rows = await db
      .select({
        account: vote.identityHolder,
        voter: vote.voter,
        identityKey: vote.identityKey,
        commitKey: vote.commitKey,
        baseWeight: sql<bigint>`10000`,
        verifiedHuman: sql<boolean>`case when ${raterHumanCredential.rater} is not null then true else false end`,
        historicalVoteCount: sql<number>`case when coalesce(${voterStats.totalSettledVotes}, 0) > 0 then coalesce(${voterStats.totalSettledVotes}, 0) - 1 else 0 end`,
        features: sql<string>`''`,
      })
      .from(vote)
      .innerJoin(
        questionRewardPool,
        and(
          eq(questionRewardPool.id, rewardPoolId),
          eq(questionRewardPool.contentId, contentId),
        ),
      )
      .innerJoin(
        round,
        and(
          eq(round.contentId, vote.contentId),
          eq(round.roundId, vote.roundId),
        ),
      )
      .innerJoin(content, eq(content.id, vote.contentId))
      .leftJoin(
        voterStats,
        eq(voterStats.voter, vote.identityHolder),
      )
      .leftJoin(
        raterHumanCredential,
        and(
          eq(raterHumanCredential.rater, vote.identityHolder),
          eq(raterHumanCredential.verified, true),
          eq(raterHumanCredential.revoked, false),
          sql`(${raterHumanCredential.expiresAt} = 0 or ${raterHumanCredential.expiresAt} > ${currentUnixSeconds})`,
        ),
      )
      .where(
        and(
          eq(vote.contentId, contentId),
          eq(vote.roundId, roundId),
          eq(vote.revealed, true),
          eq(round.state, ROUND_STATE.Settled),
          sql`${vote.identityKey} is not null`,
          sql`${vote.identityHolder} is not null`,
          sql`${vote.identityKey} != ${ZERO_HASH}`,
          sql`${vote.identityHolder} != ${questionRewardPool.funder}`,
          sql`${vote.identityKey} != ${questionRewardPool.funderIdentityKey}`,
          sql`${vote.identityHolder} != ${content.submitter}`,
          sql`(${questionRewardPool.bountyClosesAt} = 0 or coalesce(${vote.committedAt}, ${vote.revealedAt}, 0) <= ${questionRewardPool.bountyClosesAt})`,
          or(
            eq(questionRewardPool.bountyEligibility, 0),
            and(
              eq(questionRewardPool.bountyEligibility, 1),
              sql`${raterHumanCredential.rater} is not null`,
            ),
          ),
        ),
      )
      .orderBy(asc(vote.commitBlockNumber), asc(vote.commitLogIndex), asc(vote.id))
      .limit(limit)
      .offset(offset);

    return jsonBig(c, {
      items: rows.map((row) => ({
        ...row,
        account: row.account ?? row.voter,
        identityKey: row.identityKey ?? ZERO_HASH,
        features: [
          row.identityKey ? `identity:${row.identityKey.toLowerCase()}` : null,
        ].filter((value): value is string => value !== null),
      })),
    });
  });

  app.get("/correlation/snapshots", async (c) => {
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const domain = c.req.query("domain");
    const status = c.req.query("status");
    const rewardPoolId = c.req.query("rewardPoolId");
    const contentId = c.req.query("contentId");
    const roundId = c.req.query("roundId");
    const epochId = c.req.query("epochId");

    const roundFilters = [];
    const parsedDomain = optionalNonNegativeNumberParam(domain);
    const parsedStatus = optionalNonNegativeNumberParam(status);
    if (Number.isNaN(parsedDomain)) return c.json({ error: "Invalid domain" }, 400);
    if (Number.isNaN(parsedStatus)) return c.json({ error: "Invalid status" }, 400);
    if (parsedDomain !== null) roundFilters.push(eq(roundPayoutSnapshot.domain, parsedDomain));
    if (parsedStatus !== null) roundFilters.push(eq(roundPayoutSnapshot.status, parsedStatus));
    const parsedRewardPoolId = rewardPoolId ? safeBigInt(rewardPoolId) : null;
    const parsedContentId = contentId ? safeBigInt(contentId) : null;
    const parsedRoundId = roundId ? safeBigInt(roundId) : null;
    if (rewardPoolId && parsedRewardPoolId === null) return c.json({ error: "Invalid rewardPoolId" }, 400);
    if (contentId && parsedContentId === null) return c.json({ error: "Invalid contentId" }, 400);
    if (roundId && parsedRoundId === null) return c.json({ error: "Invalid roundId" }, 400);
    if (parsedRewardPoolId !== null) roundFilters.push(eq(roundPayoutSnapshot.rewardPoolId, parsedRewardPoolId));
    if (parsedContentId !== null) roundFilters.push(eq(roundPayoutSnapshot.contentId, parsedContentId));
    if (parsedRoundId !== null) roundFilters.push(eq(roundPayoutSnapshot.roundId, parsedRoundId));

    const parsedEpochId = epochId ? safeBigInt(epochId) : null;
    if (epochId && parsedEpochId === null) return c.json({ error: "Invalid epochId" }, 400);

    const [roundSnapshots, epochSnapshots] = await Promise.all([
      db
        .select()
        .from(roundPayoutSnapshot)
        .where(roundFilters.length > 0 ? and(...roundFilters) : sql`true`)
        .orderBy(desc(roundPayoutSnapshot.updatedAt))
        .limit(limit)
        .offset(offset),
      db
        .select()
        .from(correlationEpochSnapshot)
        .where(parsedEpochId !== null ? eq(correlationEpochSnapshot.id, parsedEpochId) : sql`true`)
        .orderBy(desc(correlationEpochSnapshot.updatedAt))
        .limit(limit)
        .offset(offset),
    ]);

    return jsonBig(c, { roundSnapshots, epochSnapshots });
  });
}
