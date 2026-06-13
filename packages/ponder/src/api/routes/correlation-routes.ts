import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { PAYOUT_DOMAIN_QUESTION_REWARD } from "@rateloop/node-utils/correlationScoring";
import { encodeAbiParameters, keccak256, zeroHash } from "viem";
import { and, asc, desc, eq, inArray, or, sql } from "ponder";
import { db } from "ponder:api";
import {
  content,
  correlationEpochSnapshot,
  questionBundleRound,
  questionBundleReward,
  questionRewardPool,
  round,
  roundPayoutSnapshot,
  raterHumanCredential,
  raterIdentityBan,
  vote,
  voterStats,
} from "ponder:schema";
import type { ApiApp } from "../shared.js";
import { jsonBig } from "../shared.js";
import { safeBigInt, safeLimit, safeOffset } from "../utils.js";
import { addressIdentityKey } from "../../identity-keys.js";

const PAYOUT_DOMAIN_PUBLIC_RATING = 3;
const PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD = 4;
const SNAPSHOT_STATUS_PROPOSED = 1;
const SNAPSHOT_STATUS_FINALIZED = 3;
const SNAPSHOT_STATUS_REJECTED = 4;
const RATING_REVIEW_STATUS_PENDING = 1;
const BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG = 0x80;
const BOUNTY_ELIGIBILITY_CREDENTIAL_MASK = 0x0e;
const BOUNTY_ELIGIBILITY_PROOF_OF_HUMAN = 0x08;
const HUMAN_CREDENTIAL_PROVIDER_NONE = 0;

// Trailing base-rate window for surprise-weighted bounty claim weights: the most recent
// settled rounds strictly preceding the requested round in lexicographic
// (settledAt, contentId, roundId) order.
const BASE_RATE_WINDOW_ROUNDS = 100;
const BASE_RATE_MIN_BPS = 500;
const BASE_RATE_MAX_BPS = 9500;
const BASE_RATE_NEUTRAL_BPS = 5000;
const VOTE_SCAN_PAGE_SIZE = 1_000;
const MAX_VOTE_SCAN_PAGES = 50;

const HEX32_PATTERN = /^0x[a-fA-F0-9]{64}$/;

function normalizeHex32(value: unknown): `0x${string}` | null {
  return typeof value === "string" && HEX32_PATTERN.test(value)
    ? (value.toLowerCase() as `0x${string}`)
    : null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function credentialIdentityKey(provider: number, nullifierHash: `0x${string}`) {
  if (
    provider === HUMAN_CREDENTIAL_PROVIDER_NONE ||
    nullifierHash === zeroHash
  )
    return zeroHash;
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint8" }, { type: "bytes32" }],
      ["rateloop.human-identity-v1", provider, nullifierHash],
    ),
  );
}

function identityBanSourceKey(provider: number, nullifierHash: `0x${string}`) {
  return `${provider}:${nullifierHash.toLowerCase()}`;
}

type ActiveCorrelationIdentityBanState = {
  addressIdentityKeys: Set<string>;
  identityKeys: Set<string>;
};

async function loadActiveCorrelationIdentityBanState(
  nowSeconds: bigint,
): Promise<ActiveCorrelationIdentityBanState> {
  const activeBans = await db
    .select({
      provider: raterIdentityBan.provider,
      nullifierHash: raterIdentityBan.nullifierHash,
    })
    .from(raterIdentityBan)
    .where(
      and(
        eq(raterIdentityBan.active, true),
        or(
          eq(raterIdentityBan.permanent, true),
          sql`${raterIdentityBan.expiresAt} > ${nowSeconds}`,
        ),
      ),
    );

  const identityKeys = new Set<string>();
  const sourceKeys = new Set<string>();
  const nullifierHashes: `0x${string}`[] = [];
  const seenNullifierHashes = new Set<string>();
  for (const ban of activeBans) {
    const nullifierHash = normalizeHex32(ban.nullifierHash);
    if (nullifierHash === null) continue;
    const provider = Number(ban.provider);
    const identityKey = credentialIdentityKey(provider, nullifierHash);
    if (identityKey !== zeroHash) identityKeys.add(identityKey.toLowerCase());
    sourceKeys.add(identityBanSourceKey(provider, nullifierHash));
    if (!seenNullifierHashes.has(nullifierHash)) {
      seenNullifierHashes.add(nullifierHash);
      nullifierHashes.push(nullifierHash);
    }
  }

  const addressIdentityKeys = new Set<string>();
  if (nullifierHashes.length > 0) {
    const credentialRows = await db
      .select({
        rater: raterHumanCredential.rater,
        provider: raterHumanCredential.provider,
        nullifierHash: raterHumanCredential.nullifierHash,
      })
      .from(raterHumanCredential)
      .where(inArray(raterHumanCredential.nullifierHash, nullifierHashes));

    for (const credential of credentialRows) {
      const nullifierHash = normalizeHex32(credential.nullifierHash);
      if (nullifierHash === null) continue;
      if (
        !sourceKeys.has(
          identityBanSourceKey(Number(credential.provider), nullifierHash),
        )
      )
        continue;
      addressIdentityKeys.add(
        addressIdentityKey(credential.rater).toLowerCase(),
      );
    }
  }

  return { addressIdentityKeys, identityKeys };
}

function questionMetadataRef(
  row: {
    questionMetadataHash?: string | null;
    questionMetadataUri?: string | null;
    resultSpecHash?: string | null;
  } | null,
) {
  return {
    questionMetadataHash: normalizeHex32(row?.questionMetadataHash),
    questionMetadataUri: normalizeString(row?.questionMetadataUri),
    resultSpecHash: normalizeHex32(row?.resultSpecHash),
    // Target audience is stored from a best-effort metadata push, not an
    // indexer-derived chain event, so it must not affect payout artifacts.
    targetAudienceHash: null,
  };
}

async function getRoundContext(contentId: bigint, roundId: bigint) {
  const [requestedRound] = await db
    .select({
      questionMetadataHash: content.questionMetadataHash,
      questionMetadataUri: content.questionMetadataUri,
      resultSpecHash: content.resultSpecHash,
      settledAt: round.settledAt,
    })
    .from(round)
    .innerJoin(content, eq(content.id, round.contentId))
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
      questionMetadataRef: questionMetadataRef(requestedRound ?? null),
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
    trailingBaseRateUpBps = Math.min(
      Math.max(rawUpBps, BASE_RATE_MIN_BPS),
      BASE_RATE_MAX_BPS,
    );
  }

  return {
    trailingBaseRateUpBps,
    baseRateWindowRounds: BASE_RATE_WINDOW_ROUNDS,
    questionMetadataRef: questionMetadataRef(requestedRound),
    settledRoundsInWindow: windowRounds.length,
  };
}

function validPositiveBigIntParam(value: string | undefined): bigint | null {
  if (!value) return null;
  const parsed = safeBigInt(value);
  return parsed !== null && parsed > 0n ? parsed : null;
}

function optionalNonNegativeNumberParam(
  value: string | undefined,
): number | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function formatCorrelationVoteRow(
  row: {
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
  },
  banState?: ActiveCorrelationIdentityBanState,
) {
  const account = row.account ?? row.voter;
  const identityKey = row.identityKey ?? zeroHash;
  const excludedReasons: string[] = [];
  if (banState?.identityKeys.has(identityKey.toLowerCase())) {
    excludedReasons.push("identity_banned");
  }
  if (
    banState?.addressIdentityKeys.has(
      addressIdentityKey(row.voter).toLowerCase(),
    )
  ) {
    excludedReasons.push("voter_address_banned");
  }
  if (
    account.toLowerCase() !== row.voter.toLowerCase() &&
    banState?.addressIdentityKeys.has(addressIdentityKey(account).toLowerCase())
  ) {
    excludedReasons.push("holder_address_banned");
  }

  if (excludedReasons.length > 0) {
    return {
      excludedVote: {
        account,
        identityKey,
        commitKey: row.commitKey,
        cooldownSeconds: null,
        profileUpdatedAt: null,
        reasons: excludedReasons,
        roundOpenTime: null,
      },
      item: null,
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
    payoutEligible: true,
    features: [
      row.identityKey ? `identity:${row.identityKey.toLowerCase()}` : null,
    ].filter((value): value is string => value !== null),
  };

  return {
    excludedVote: null,
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

  app.get("/correlation/bundle-round-candidates", async (c) => {
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const rows = await db
      .select({
        domain: sql<number>`${PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD}`,
        rewardPoolId: questionBundleReward.id,
        contentId: questionBundleReward.id,
        roundId: sql<number>`${questionBundleRound.roundSetIndex} + 1`,
        requiredCompleters: questionBundleReward.requiredCompleters,
        requiredSettledRounds: questionBundleReward.requiredSettledRounds,
        completedRoundSetCount: questionBundleReward.completedRoundSetCount,
        questionCount: questionBundleReward.questionCount,
        recordedQuestionRounds: sql<number>`count(distinct ${questionBundleRound.bundleIndex})`,
        bountyEligibility: questionBundleReward.bountyEligibility,
        bountyStartBy: questionBundleReward.bountyStartBy,
        bountyOpensAt: questionBundleReward.bountyOpensAt,
        bountyClosesAt: questionBundleReward.bountyClosesAt,
        bountyWindowSeconds: questionBundleReward.bountyWindowSeconds,
        snapshotStatus: roundPayoutSnapshot.status,
      })
      .from(questionBundleRound)
      .innerJoin(
        questionBundleReward,
        eq(questionBundleReward.id, questionBundleRound.bundleId),
      )
      .leftJoin(
        roundPayoutSnapshot,
        and(
          eq(roundPayoutSnapshot.domain, PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD),
          eq(roundPayoutSnapshot.rewardPoolId, questionBundleReward.id),
          eq(roundPayoutSnapshot.contentId, questionBundleReward.id),
          sql`${roundPayoutSnapshot.roundId} = ${questionBundleRound.roundSetIndex} + 1`,
        ),
      )
      .where(
        and(
          eq(questionBundleReward.failed, false),
          eq(questionBundleReward.refunded, false),
          sql`${questionBundleReward.completedRoundSetCount} < ${questionBundleReward.requiredSettledRounds}`,
          sql`${questionBundleRound.roundSetIndex} < ${questionBundleReward.requiredSettledRounds}`,
          sql`(
            ${questionBundleReward.bountyWindowSeconds} = 0
            or (
              ${questionBundleReward.bountyClosesAt} != 0
              and ${questionBundleReward.bountyOpensAt} <= ${questionBundleReward.bountyClosesAt}
            )
          )`,
          or(
            sql`${roundPayoutSnapshot.id} is null`,
            eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS_PROPOSED),
            eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS_REJECTED),
          ),
        ),
      )
      .groupBy(
        questionBundleReward.id,
        questionBundleRound.roundSetIndex,
        questionBundleReward.requiredCompleters,
        questionBundleReward.requiredSettledRounds,
        questionBundleReward.completedRoundSetCount,
        questionBundleReward.questionCount,
        questionBundleReward.bountyEligibility,
        questionBundleReward.bountyStartBy,
        questionBundleReward.bountyOpensAt,
        questionBundleReward.bountyClosesAt,
        questionBundleReward.bountyWindowSeconds,
        roundPayoutSnapshot.status,
      )
      .having(
        sql`count(distinct ${questionBundleRound.bundleIndex}) >= ${questionBundleReward.questionCount}`,
      )
      .orderBy(
        desc(questionBundleRound.roundSetIndex),
        asc(questionBundleReward.id),
      )
      .limit(limit)
      .offset(offset);

    return jsonBig(c, { items: rows });
  });

  app.get("/correlation/rating-round-candidates", async (c) => {
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const rows = await db
      .select({
        domain: sql<number>`${PAYOUT_DOMAIN_PUBLIC_RATING}`,
        rewardPoolId: sql<bigint>`0`,
        contentId: round.contentId,
        roundId: round.roundId,
        settledAt: round.settledAt,
        revealedCount: round.revealedCount,
        ratingReviewStatus: round.ratingReviewStatus,
        snapshotStatus: roundPayoutSnapshot.status,
      })
      .from(round)
      .leftJoin(
        roundPayoutSnapshot,
        and(
          eq(roundPayoutSnapshot.domain, PAYOUT_DOMAIN_PUBLIC_RATING),
          eq(roundPayoutSnapshot.rewardPoolId, 0n),
          eq(roundPayoutSnapshot.contentId, round.contentId),
          eq(roundPayoutSnapshot.roundId, round.roundId),
        ),
      )
      .where(
        and(
          eq(round.state, ROUND_STATE.Settled),
          eq(round.ratingReviewStatus, RATING_REVIEW_STATUS_PENDING),
          sql`${round.revealedCount} > 0`,
          or(
            sql`${roundPayoutSnapshot.id} is null`,
            eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS_PROPOSED),
            eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS_FINALIZED),
            eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS_REJECTED),
          ),
        ),
      )
      .orderBy(desc(round.roundId), asc(round.contentId))
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
      return c.json(
        {
          error:
            "rewardPoolId, contentId, and roundId must be positive integers",
        },
        400,
      );
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
        .leftJoin(voterStats, eq(voterStats.voter, vote.identityHolder))
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
        .where(
          and(
            eq(vote.contentId, contentId),
            eq(vote.roundId, roundId),
            eq(vote.revealed, true),
            eq(round.state, ROUND_STATE.Settled),
            sql`coalesce(${round.settledAt}, ${round.startTime}) is not null`,
            sql`${vote.identityKey} is not null`,
            sql`${vote.identityHolder} is not null`,
            sql`${vote.identityKey} != ${zeroHash}`,
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
        .orderBy(
          asc(vote.commitBlockNumber),
          asc(vote.commitLogIndex),
          asc(vote.id),
        )
        .limit(scanLimit)
        .offset(scanOffset);

    const items: ReturnType<typeof formatCorrelationVoteRow>["item"][] = [];
    const excludedVotes: NonNullable<
      ReturnType<typeof formatCorrelationVoteRow>["excludedVote"]
    >[] = [];
    let eligibleSeen = 0;
    let scanOffset = 0;
    let banState: ActiveCorrelationIdentityBanState | null = null;
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    for (let page = 0; page < MAX_VOTE_SCAN_PAGES; page += 1) {
      const rows = await loadVoteRows(VOTE_SCAN_PAGE_SIZE, scanOffset);
      if (banState === null && rows.length > 0) {
        banState = await loadActiveCorrelationIdentityBanState(nowSeconds);
      }
      for (const row of rows) {
        const formatted = formatCorrelationVoteRow(row, banState ?? undefined);
        if (formatted.excludedVote) {
          excludedVotes.push(formatted.excludedVote);
          continue;
        }
        if (formatted.item && eligibleSeen >= offset && items.length < limit) {
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

  app.get("/correlation/bundle-round-votes", async (c) => {
    const rewardPoolId = validPositiveBigIntParam(c.req.query("rewardPoolId"));
    const contentId = validPositiveBigIntParam(c.req.query("contentId"));
    const roundId = validPositiveBigIntParam(c.req.query("roundId"));
    const limit = safeLimit(c.req.query("limit"), 500, 1000);
    const offset = safeOffset(c.req.query("offset"));

    if (rewardPoolId === null || contentId === null || roundId === null) {
      return c.json(
        {
          error:
            "rewardPoolId, contentId, and roundId must be positive integers",
        },
        400,
      );
    }
    if (contentId !== rewardPoolId) {
      return c.json(
        { error: "bundle snapshot contentId must equal rewardPoolId" },
        400,
      );
    }
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);
    if (roundId > BigInt(Number.MAX_SAFE_INTEGER)) {
      return c.json({ error: "roundId is too large" }, 400);
    }

    const roundSetIndex = Number(roundId - 1n);
    const [bundle] = await db
      .select({
        id: questionBundleReward.id,
        funder: questionBundleReward.funder,
        funderIdentityKey: questionBundleReward.funderIdentityKey,
        questionCount: questionBundleReward.questionCount,
        bountyEligibility: questionBundleReward.bountyEligibility,
        bountyOpensAt: questionBundleReward.bountyOpensAt,
        bountyClosesAt: questionBundleReward.bountyClosesAt,
        bountyWindowSeconds: questionBundleReward.bountyWindowSeconds,
        failed: questionBundleReward.failed,
        refunded: questionBundleReward.refunded,
      })
      .from(questionBundleReward)
      .where(eq(questionBundleReward.id, rewardPoolId))
      .limit(1);

    if (!bundle || bundle.failed || bundle.refunded) {
      return jsonBig(c, { excludedVotes: [], items: [], roundContext: null });
    }

    const bundleRounds = await db
      .select({
        contentId: questionBundleRound.contentId,
        roundId: questionBundleRound.roundId,
        bundleIndex: questionBundleRound.bundleIndex,
      })
      .from(questionBundleRound)
      .where(
        and(
          eq(questionBundleRound.bundleId, rewardPoolId),
          eq(questionBundleRound.roundSetIndex, roundSetIndex),
        ),
      )
      .orderBy(asc(questionBundleRound.bundleIndex));

    if (bundleRounds.length < bundle.questionCount) {
      return jsonBig(c, { excludedVotes: [], items: [], roundContext: null });
    }

    const firstBundleRound =
      bundleRounds.find((row) => row.bundleIndex === 0) ?? bundleRounds[0]!;
    const roundContext = await getRoundContext(
      firstBundleRound.contentId,
      firstBundleRound.roundId,
    );
    const roundKeyToBundleIndex = new Map(
      bundleRounds.map((row) => [
        `${row.contentId.toString()}-${row.roundId.toString()}`,
        row.bundleIndex,
      ]),
    );
    const roundConditions = bundleRounds.map((row) =>
      and(eq(vote.contentId, row.contentId), eq(vote.roundId, row.roundId)),
    );
    const roundFilter =
      roundConditions.length === 1
        ? roundConditions[0]!
        : or(...roundConditions);

    const rows = await db
      .select({
        contentId: vote.contentId,
        roundId: vote.roundId,
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
        commitBlockNumber: vote.commitBlockNumber,
        commitLogIndex: vote.commitLogIndex,
        voteId: vote.id,
      })
      .from(vote)
      .innerJoin(
        round,
        and(
          eq(round.contentId, vote.contentId),
          eq(round.roundId, vote.roundId),
        ),
      )
      .innerJoin(content, eq(content.id, vote.contentId))
      .leftJoin(voterStats, eq(voterStats.voter, vote.identityHolder))
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
      .where(
        and(
          roundFilter,
          eq(vote.revealed, true),
          eq(round.state, ROUND_STATE.Settled),
          sql`${vote.identityKey} is not null`,
          sql`${vote.identityHolder} is not null`,
          sql`${vote.identityKey} != ${zeroHash}`,
          sql`${vote.identityHolder} != ${bundle.funder}`,
          sql`${vote.identityKey} != ${bundle.funderIdentityKey}`,
          sql`${vote.identityHolder} != ${content.submitter}`,
          sql`(
            ${bundle.bountyWindowSeconds} = 0
            or (
              ${bundle.bountyClosesAt} != 0
              and ${bundle.bountyOpensAt} <= ${bundle.bountyClosesAt}
              and coalesce(${vote.committedAt}, ${vote.revealedAt}, 0) >= ${bundle.bountyOpensAt}
              and coalesce(${vote.committedAt}, ${vote.revealedAt}, 0) <= ${bundle.bountyClosesAt}
            )
          )`,
          or(
            sql`(${bundle.bountyEligibility} & ${BOUNTY_ELIGIBILITY_CREDENTIAL_MASK}) = 0`,
            sql`(
              (${bundle.bountyEligibility} & ${BOUNTY_ELIGIBILITY_CREDENTIAL_MASK}) > 0
              and (
                ${vote.credentialMask}
                & (${bundle.bountyEligibility} & ${BOUNTY_ELIGIBILITY_CREDENTIAL_MASK})
              ) != 0
              and (
                (${bundle.bountyEligibility} & ${BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG}) = 0
                or (
                  ${vote.credentialMask}
                  & ${vote.freshCredentialMask}
                  & (${bundle.bountyEligibility} & ${BOUNTY_ELIGIBILITY_CREDENTIAL_MASK})
                ) != 0
              )
            )`,
            and(
              sql`(${bundle.bountyEligibility} & ${BOUNTY_ELIGIBILITY_PROOF_OF_HUMAN}) != 0`,
              sql`(${bundle.bountyEligibility} & ${BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG}) = 0`,
              sql`${raterHumanCredential.rater} is not null`,
            ),
          ),
        ),
      )
      .orderBy(
        asc(vote.commitBlockNumber),
        asc(vote.commitLogIndex),
        asc(vote.id),
      );

    type BundleVoteRow = (typeof rows)[number];
    const completedByIdentity = new Map<
      string,
      { firstVote: BundleVoteRow | null; bundleIndexes: Set<number> }
    >();
    for (const row of rows) {
      const bundleIndex = roundKeyToBundleIndex.get(
        `${row.contentId.toString()}-${row.roundId.toString()}`,
      );
      if (bundleIndex === undefined) continue;
      const account = row.account ?? row.voter;
      const identityKey = row.identityKey ?? zeroHash;
      const key = `${identityKey.toLowerCase()}:${account.toLowerCase()}`;
      const entry = completedByIdentity.get(key) ?? {
        firstVote: null,
        bundleIndexes: new Set<number>(),
      };
      entry.bundleIndexes.add(bundleIndex);
      if (bundleIndex === 0 && entry.firstVote === null) {
        entry.firstVote = row;
      }
      completedByIdentity.set(key, entry);
    }

    const firstVotes = [...completedByIdentity.values()]
      .filter(
        (
          entry,
        ): entry is { firstVote: BundleVoteRow; bundleIndexes: Set<number> } =>
          entry.firstVote !== null &&
          entry.bundleIndexes.size >= bundle.questionCount,
      )
      .map((entry) => entry.firstVote);

    const banState =
      firstVotes.length > 0
        ? await loadActiveCorrelationIdentityBanState(
            BigInt(Math.floor(Date.now() / 1000)),
          )
        : null;
    const items: ReturnType<typeof formatCorrelationVoteRow>["item"][] = [];
    const excludedVotes: NonNullable<
      ReturnType<typeof formatCorrelationVoteRow>["excludedVote"]
    >[] = [];
    let eligibleSeen = 0;
    for (const row of firstVotes) {
      const formatted = formatCorrelationVoteRow(row, banState ?? undefined);
      if (formatted.excludedVote) {
        excludedVotes.push(formatted.excludedVote);
        continue;
      }
      if (formatted.item && eligibleSeen >= offset && items.length < limit) {
        items.push(formatted.item);
      }
      eligibleSeen += 1;
      if (items.length >= limit) break;
    }

    return jsonBig(c, {
      excludedVotes,
      items,
      roundContext,
    });
  });

  app.get("/correlation/rating-round-votes", async (c) => {
    const contentId = validPositiveBigIntParam(c.req.query("contentId"));
    const roundId = validPositiveBigIntParam(c.req.query("roundId"));
    const limit = safeLimit(c.req.query("limit"), 500, 1000);
    const offset = safeOffset(c.req.query("offset"));

    if (contentId === null || roundId === null) {
      return c.json(
        { error: "contentId and roundId must be positive integers" },
        400,
      );
    }
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const rows = await db
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
      })
      .from(vote)
      .innerJoin(
        round,
        and(
          eq(round.contentId, vote.contentId),
          eq(round.roundId, vote.roundId),
        ),
      )
      .leftJoin(voterStats, eq(voterStats.voter, vote.identityHolder))
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
      .where(
        and(
          eq(vote.contentId, contentId),
          eq(vote.roundId, roundId),
          eq(vote.revealed, true),
          eq(round.state, ROUND_STATE.Settled),
        ),
      )
      .orderBy(
        asc(vote.commitBlockNumber),
        asc(vote.commitLogIndex),
        asc(vote.id),
      )
      .limit(limit)
      .offset(offset);

    const roundContext = await getRoundContext(contentId, roundId);
    return jsonBig(c, {
      excludedVotes: [],
      items: rows
        .map((row) => formatCorrelationVoteRow(row).item)
        .filter(Boolean),
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
    if (Number.isNaN(parsedDomain))
      return c.json({ error: "Invalid domain" }, 400);
    if (Number.isNaN(parsedStatus))
      return c.json({ error: "Invalid status" }, 400);
    if (parsedDomain !== null)
      roundFilters.push(eq(roundPayoutSnapshot.domain, parsedDomain));
    if (parsedStatus !== null)
      roundFilters.push(eq(roundPayoutSnapshot.status, parsedStatus));
    const parsedRewardPoolId = rewardPoolId ? safeBigInt(rewardPoolId) : null;
    const parsedContentId = contentId ? safeBigInt(contentId) : null;
    const parsedRoundId = roundId ? safeBigInt(roundId) : null;
    if (rewardPoolId && parsedRewardPoolId === null)
      return c.json({ error: "Invalid rewardPoolId" }, 400);
    if (contentId && parsedContentId === null)
      return c.json({ error: "Invalid contentId" }, 400);
    if (roundId && parsedRoundId === null)
      return c.json({ error: "Invalid roundId" }, 400);
    if (parsedRewardPoolId !== null)
      roundFilters.push(
        eq(roundPayoutSnapshot.rewardPoolId, parsedRewardPoolId),
      );
    if (parsedContentId !== null)
      roundFilters.push(eq(roundPayoutSnapshot.contentId, parsedContentId));
    if (parsedRoundId !== null)
      roundFilters.push(eq(roundPayoutSnapshot.roundId, parsedRoundId));

    const parsedEpochId = epochId ? safeBigInt(epochId) : null;
    if (epochId && parsedEpochId === null)
      return c.json({ error: "Invalid epochId" }, 400);

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
        .where(
          parsedEpochId !== null
            ? eq(correlationEpochSnapshot.id, parsedEpochId)
            : sql`true`,
        )
        .orderBy(desc(correlationEpochSnapshot.updatedAt))
        .limit(limit)
        .offset(offset),
    ]);

    return jsonBig(c, { roundSnapshots, epochSnapshots });
  });
}
