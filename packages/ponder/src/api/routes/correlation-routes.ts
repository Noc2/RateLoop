import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { evaluateTargetAudienceEligibility } from "@rateloop/node-utils/profileSelfReport";
import { and, asc, desc, eq, or, sql } from "ponder";
import { db } from "ponder:api";
import {
  content,
  correlationEpochSnapshot,
  profile,
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
const BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG = 0x80;
const BOUNTY_ELIGIBILITY_CREDENTIAL_MASK = 0x0e;
const BOUNTY_ELIGIBILITY_PROOF_OF_HUMAN = 0x08;
const ZERO_HASH = `0x${"0".repeat(64)}` as const;

// Trailing base-rate window for surprise-weighted bounty claim weights: the most recent
// settled rounds strictly preceding the requested round in lexicographic
// (settledAt, contentId, roundId) order. See docs/surprise-weighted-bounty-weights.md.
const BASE_RATE_WINDOW_ROUNDS = 100;
const BASE_RATE_MIN_BPS = 500;
const BASE_RATE_MAX_BPS = 9500;
const BASE_RATE_NEUTRAL_BPS = 5000;
const VOTE_SCAN_PAGE_SIZE = 1_000;
const MAX_VOTE_SCAN_PAGES = 50;

async function getRoundContext(contentId: bigint, roundId: bigint) {
  const [requestedRound] = await db
    .select({ settledAt: round.settledAt })
    .from(round)
    .where(
      and(
        eq(round.contentId, contentId),
        eq(round.roundId, roundId),
        eq(round.state, ROUND_STATE.Settled),
      ),
    )
    .limit(1);

  const settledAt = requestedRound?.settledAt ?? null;
  if (settledAt === null) {
    return {
      trailingBaseRateUpBps: BASE_RATE_NEUTRAL_BPS,
      baseRateWindowRounds: BASE_RATE_WINDOW_ROUNDS,
      settledRoundsInWindow: 0,
    };
  }

  const windowRounds = await db
    .select({ upPool: round.upPool, downPool: round.downPool })
    .from(round)
    .where(
      and(
        eq(round.state, ROUND_STATE.Settled),
        sql`${round.settledAt} is not null`,
        sql`(${round.settledAt}, ${round.contentId}, ${round.roundId}) < (${settledAt}, ${contentId}, ${roundId})`,
      ),
    )
    .orderBy(desc(round.settledAt), desc(round.contentId), desc(round.roundId))
    .limit(BASE_RATE_WINDOW_ROUNDS);

  let windowUpPool = 0n;
  let windowTotalPool = 0n;
  for (const windowRound of windowRounds) {
    const upPool = windowRound.upPool ?? 0n;
    const downPool = windowRound.downPool ?? 0n;
    windowUpPool += upPool;
    windowTotalPool += upPool + downPool;
  }

  let trailingBaseRateUpBps = BASE_RATE_NEUTRAL_BPS;
  if (windowRounds.length > 0 && windowTotalPool > 0n) {
    const rawUpBps = Number((windowUpPool * 10000n) / windowTotalPool);
    trailingBaseRateUpBps = Math.min(Math.max(rawUpBps, BASE_RATE_MIN_BPS), BASE_RATE_MAX_BPS);
  }

  return {
    trailingBaseRateUpBps,
    baseRateWindowRounds: BASE_RATE_WINDOW_ROUNDS,
    settledRoundsInWindow: windowRounds.length,
  };
}

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

function parseStoredTargetAudience(value: unknown) {
  if (typeof value !== "string") return value ?? null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return { invalidTargetAudienceMetadata: true };
  }
}

function stringifyOptionalBigInt(value: unknown) {
  return typeof value === "bigint" ? value.toString() : null;
}

function formatCorrelationVoteRow(row: {
  account: `0x${string}` | null;
  voter: `0x${string}`;
  identityKey: `0x${string}` | null;
  commitKey: `0x${string}`;
  isUp: boolean | null;
  stake: bigint;
  epochIndex: number;
  revealWeight: bigint | null;
  baseWeight: bigint;
  verifiedHuman: boolean;
  historicalVoteCount: number;
  profileSelfReport?: string | null;
  profileUpdatedAt?: bigint | null;
  roundStartTime?: bigint | null;
  targetAudience?: string | null;
}) {
  const account = row.account ?? row.voter;
  const identityKey = row.identityKey ?? ZERO_HASH;
  let eligibility: ReturnType<typeof evaluateTargetAudienceEligibility>;
  try {
    eligibility = evaluateTargetAudienceEligibility({
      profileUpdatedAtSeconds: row.profileUpdatedAt ?? null,
      roundOpenTimeSeconds: row.roundStartTime ?? null,
      selfReport: row.profileSelfReport ?? null,
      targetAudience: parseStoredTargetAudience(row.targetAudience),
    });
  } catch {
    eligibility = {
      cooldownSeconds: 0,
      eligible: false,
      reasons: ["target_audience_invalid"],
      targetAudience: null,
    };
  }

  const item = {
    account,
    voter: row.voter,
    identityKey,
    commitKey: row.commitKey,
    isUp: row.isUp ?? null,
    stake: row.stake,
    epochIndex: row.epochIndex,
    revealWeight: row.revealWeight ?? null,
    baseWeight: row.baseWeight,
    verifiedHuman: row.verifiedHuman,
    historicalVoteCount: row.historicalVoteCount,
    payoutEligible: eligibility.eligible,
    features: [
      row.identityKey ? `identity:${row.identityKey.toLowerCase()}` : null,
    ].filter((value): value is string => value !== null),
  };

  return {
    excludedVote: eligibility.eligible
      ? null
      : {
          account,
          identityKey,
          commitKey: row.commitKey,
          cooldownSeconds: eligibility.cooldownSeconds,
          profileUpdatedAt: stringifyOptionalBigInt(row.profileUpdatedAt),
          reasons: eligibility.reasons,
          roundOpenTime: stringifyOptionalBigInt(row.roundStartTime),
        },
    item,
  };
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
        bountyStartBy: questionRewardPool.bountyStartBy,
        bountyOpensAt: questionRewardPool.bountyOpensAt,
        bountyClosesAt: questionRewardPool.bountyClosesAt,
        bountyWindowSeconds: questionRewardPool.bountyWindowSeconds,
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
          sql`${round.revealedCount} >= ${questionRewardPool.requiredVoters}`,
          sql`(
            ${questionRewardPool.bountyWindowSeconds} = 0
            or (
              ${questionRewardPool.bountyClosesAt} != 0
              and ${questionRewardPool.bountyOpensAt} <= ${questionRewardPool.bountyClosesAt}
            )
            or (
              ${questionRewardPool.bountyClosesAt} = 0
              and ${round.startTime} is not null
              and ${round.startTime} <= ${questionRewardPool.bountyStartBy}
            )
          )`,
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

    const loadVoteRows = (scanLimit: number, scanOffset: number) =>
      db
        .select({
          account: vote.identityHolder,
          voter: vote.voter,
          identityKey: vote.identityKey,
          commitKey: vote.commitKey,
          isUp: vote.isUp,
          stake: vote.stake,
          epochIndex: vote.epochIndex,
          revealWeight: vote.rbtsWeight,
          baseWeight: sql<bigint>`10000`,
          verifiedHuman: sql<boolean>`case when ${raterHumanCredential.rater} is not null then true else false end`,
          historicalVoteCount: sql<number>`case when coalesce(${voterStats.totalSettledVotes}, 0) > 0 then coalesce(${voterStats.totalSettledVotes}, 0) - 1 else 0 end`,
          profileSelfReport: profile.selfReport,
          profileUpdatedAt: profile.updatedAt,
          roundStartTime: round.startTime,
          targetAudience: content.targetAudience,
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
            sql`(
              ${raterHumanCredential.expiresAt} = 0
              or ${raterHumanCredential.expiresAt} > coalesce(${round.settledAt}, ${round.startTime})
            )`,
          ),
        )
        .leftJoin(profile, eq(profile.address, vote.identityHolder))
        .where(
          and(
            eq(vote.contentId, contentId),
            eq(vote.roundId, roundId),
            eq(vote.revealed, true),
            eq(round.state, ROUND_STATE.Settled),
            sql`coalesce(${round.settledAt}, ${round.startTime}) is not null`,
            sql`${vote.identityKey} is not null`,
            sql`${vote.identityHolder} is not null`,
            sql`${vote.identityKey} != ${ZERO_HASH}`,
            sql`${vote.identityHolder} != ${questionRewardPool.funder}`,
            sql`${vote.identityKey} != ${questionRewardPool.funderIdentityKey}`,
            sql`${vote.identityHolder} != ${content.submitter}`,
            sql`(
              ${questionRewardPool.bountyWindowSeconds} = 0
              or (
                ${questionRewardPool.bountyClosesAt} != 0
                and ${questionRewardPool.bountyOpensAt} <= ${questionRewardPool.bountyClosesAt}
                and coalesce(${vote.committedAt}, ${vote.revealedAt}, 0) >= ${questionRewardPool.bountyOpensAt}
                and coalesce(${vote.committedAt}, ${vote.revealedAt}, 0) <= ${questionRewardPool.bountyClosesAt}
              )
              or (
                ${questionRewardPool.bountyClosesAt} = 0
                and ${round.startTime} is not null
                and ${round.startTime} <= ${questionRewardPool.bountyStartBy}
                and coalesce(${vote.committedAt}, ${vote.revealedAt}, 0) >= ${round.startTime}
                and coalesce(${vote.committedAt}, ${vote.revealedAt}, 0) <= ${round.startTime} + ${questionRewardPool.bountyWindowSeconds}
              )
            )`,
            or(
              sql`(${questionRewardPool.bountyEligibility} & ${BOUNTY_ELIGIBILITY_CREDENTIAL_MASK}) = 0`,
              sql`(
                (${questionRewardPool.bountyEligibility} & ${BOUNTY_ELIGIBILITY_CREDENTIAL_MASK}) > 0
                and (
                  ${vote.credentialMask}
                  & (${questionRewardPool.bountyEligibility} & ${BOUNTY_ELIGIBILITY_CREDENTIAL_MASK})
                ) != 0
                and (
                  (${questionRewardPool.bountyEligibility} & ${BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG}) = 0
                  or (
                    ${vote.credentialMask}
                    & ${vote.freshCredentialMask}
                    & (${questionRewardPool.bountyEligibility} & ${BOUNTY_ELIGIBILITY_CREDENTIAL_MASK})
                  ) != 0
                )
              )`,
              and(
                sql`(${questionRewardPool.bountyEligibility} & ${BOUNTY_ELIGIBILITY_PROOF_OF_HUMAN}) != 0`,
                sql`(${questionRewardPool.bountyEligibility} & ${BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG}) = 0`,
                sql`${raterHumanCredential.rater} is not null`,
              ),
            ),
          ),
        )
        .orderBy(asc(vote.commitBlockNumber), asc(vote.commitLogIndex), asc(vote.id))
        .limit(scanLimit)
        .offset(scanOffset);

    const items: ReturnType<typeof formatCorrelationVoteRow>["item"][] = [];
    const excludedVotes: NonNullable<ReturnType<typeof formatCorrelationVoteRow>["excludedVote"]>[] = [];
    let eligibleSeen = 0;
    let scanOffset = 0;
    for (let page = 0; page < MAX_VOTE_SCAN_PAGES; page += 1) {
      const rows = await loadVoteRows(VOTE_SCAN_PAGE_SIZE, scanOffset);
      for (const row of rows) {
        const formatted = formatCorrelationVoteRow(row);
        if (formatted.excludedVote) {
          excludedVotes.push(formatted.excludedVote);
          continue;
        }
        if (eligibleSeen >= offset && items.length < limit) {
          items.push(formatted.item);
        }
        eligibleSeen += 1;
      }
      scanOffset += rows.length;
      if (rows.length < VOTE_SCAN_PAGE_SIZE) break;
    }

    const roundContext = await getRoundContext(contentId, roundId);

    return jsonBig(c, {
      excludedVotes,
      items,
      roundContext,
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
