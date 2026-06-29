import {
  BOUNTY_ELIGIBILITY_CREDENTIAL_MASK,
  BOUNTY_ELIGIBILITY_RECENT_RECHECK_FLAG,
  ROUND_STATE,
} from "@rateloop/contracts/protocol";
import {
  PAYOUT_DOMAIN_LAUNCH_CREDIT,
  PAYOUT_DOMAIN_PUBLIC_RATING,
  PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
  PAYOUT_DOMAIN_QUESTION_REWARD,
} from "@rateloop/node-utils/correlationScoring";
import { encodeAbiParameters, keccak256, zeroAddress, zeroHash } from "viem";
import { and, asc, desc, eq, inArray, or, sql } from "ponder";
import { db } from "ponder:api";
import {
  content,
  correlationEpochSnapshot,
  launchEarnedRaterCredit,
  launchRewardPolicyState,
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
import {
  jsonBig,
  questionRewardPoolHasValidBountyWindowExpression,
  questionRewardPoolVoteWithinBountyWindowExpression,
  resolveApiNowSeconds,
} from "../shared.js";
import {
  CORRELATION_VOTE_PAGE_SIZE,
  correlationVoteScanPageBudget,
  isCorrelationVoteScanTruncated,
} from "../correlation-vote-scan.js";
import { safeBigInt, safeLimit, safeOffset } from "../utils.js";
import { addressIdentityKey } from "@rateloop/node-utils/identityKeys";

const SNAPSHOT_STATUS_PROPOSED = 1;
const SNAPSHOT_STATUS_FINALIZED = 3;
const SNAPSHOT_STATUS_REJECTED = 4;
const RATING_REVIEW_STATUS_PENDING = 1;
const BOUNTY_ELIGIBILITY_PROOF_OF_HUMAN = 0x08;
const HUMAN_CREDENTIAL_PROVIDER_NONE = 0;
const HUMAN_CREDENTIAL_PROVIDER_WORLD_ID = 1;
const HUMAN_CREDENTIAL_PROVIDER_WORLD_ID_V4 = 2;
const DEFAULT_LAUNCH_MIN_VERIFIED_HUMANS = 1;
const DEFAULT_LAUNCH_MIN_ANCHOR_CREDENTIAL_AGE_SECONDS = 7 * 24 * 60 * 60;

// Trailing base-rate window for surprise-weighted bounty claim weights: the most recent
// settled rounds strictly preceding the requested round in lexicographic
// (settledAt, contentId, roundId) order.
const BASE_RATE_WINDOW_ROUNDS = 100;
const BASE_RATE_MIN_BPS = 500;
const BASE_RATE_MAX_BPS = 9500;
const BASE_RATE_NEUTRAL_BPS = 5000;

const HEX32_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

function normalizeHex32(value: unknown): `0x${string}` | null {
  return typeof value === "string" && HEX32_PATTERN.test(value)
    ? (value.toLowerCase() as `0x${string}`)
    : null;
}

function normalizeAddress(value: unknown): `0x${string}` | null {
  return typeof value === "string" && ADDRESS_PATTERN.test(value)
    ? (value.toLowerCase() as `0x${string}`)
    : null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function credentialIdentityKey(provider: number, nullifierHash: `0x${string}`) {
  if (provider === HUMAN_CREDENTIAL_PROVIDER_NONE || nullifierHash === zeroHash)
    return zeroHash;
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "uint8" }, { type: "bytes32" }],
      ["rateloop.human-identity-v1", provider, nullifierHash],
    ),
  );
}

function launchHumanIdentityKey(
  provider: number,
  nullifierHash: `0x${string}`,
) {
  if (provider === HUMAN_CREDENTIAL_PROVIDER_NONE || nullifierHash === zeroHash)
    return zeroHash;
  if (
    provider === HUMAN_CREDENTIAL_PROVIDER_WORLD_ID ||
    provider === HUMAN_CREDENTIAL_PROVIDER_WORLD_ID_V4
  ) {
    return keccak256(
      encodeAbiParameters(
        [{ type: "string" }, { type: "bytes32" }],
        ["rateloop.launch-world-id-human-v1", nullifierHash],
      ),
    );
  }
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint8" }, { type: "bytes32" }],
      [provider, nullifierHash],
    ),
  );
}

function identityBanSourceKey(provider: number, nullifierHash: `0x${string}`) {
  return `${provider}:${nullifierHash.toLowerCase()}`;
}

type ActiveCorrelationIdentityBanState = {
  addressIdentityKeys: Set<string>;
  identityKeys: Set<string>;
  launchIdentityKeys: Set<string>;
};

type CorrelationIdentityBanSource = {
  provider: number;
  nullifierHash: `0x${string}`;
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
  const launchIdentityKeys = new Set<string>();
  const sourceKeys = new Set<string>();
  const nullifierHashes: `0x${string}`[] = [];
  const seenNullifierHashes = new Set<string>();
  for (const ban of activeBans) {
    const nullifierHash = normalizeHex32(ban.nullifierHash);
    if (nullifierHash === null) continue;
    const provider = Number(ban.provider);
    const identityKey = credentialIdentityKey(provider, nullifierHash);
    if (identityKey !== zeroHash) identityKeys.add(identityKey.toLowerCase());
    const launchIdentityKey = launchHumanIdentityKey(provider, nullifierHash);
    if (launchIdentityKey !== zeroHash)
      launchIdentityKeys.add(launchIdentityKey.toLowerCase());
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

  return { addressIdentityKeys, identityKeys, launchIdentityKeys };
}

function collectLaunchIdentityBanSources(
  credits: readonly LaunchCreditRow[],
  anchors: readonly LaunchAnchorVoteRow[],
) {
  const sources: CorrelationIdentityBanSource[] = [];
  const seen = new Set<string>();
  const addSource = (
    provider: number | null | undefined,
    value: `0x${string}` | null | undefined,
  ) => {
    if (provider === null || provider === undefined) return;
    const nullifierHash = normalizeHex32(value);
    if (nullifierHash === null || nullifierHash === zeroHash) return;
    const key = identityBanSourceKey(provider, nullifierHash);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({ provider, nullifierHash });
  };

  for (const credit of credits) {
    addSource(credit.raterCredentialProvider, credit.raterCredentialNullifierHash);
  }
  for (const anchor of anchors) {
    addSource(anchor.provider, anchor.nullifierHash);
  }

  return sources;
}

async function loadLatestRelevantIdentityBanUpdatedAt(
  sources: readonly CorrelationIdentityBanSource[],
  updatedAfter: bigint,
) {
  if (sources.length === 0) return null;
  const sourcePredicates = sources.map((source) =>
    and(
      eq(raterIdentityBan.provider, source.provider),
      eq(raterIdentityBan.nullifierHash, source.nullifierHash),
    ),
  );
  const [latestBan] = await db
    .select({ updatedAt: raterIdentityBan.updatedAt })
    .from(raterIdentityBan)
    .where(
      and(
        sql`${raterIdentityBan.updatedAt} > ${updatedAfter}`,
        sourcePredicates.length === 1
          ? sourcePredicates[0]!
          : or(...sourcePredicates),
      ),
    )
    .orderBy(desc(raterIdentityBan.updatedAt))
    .limit(1);

  return latestBan?.updatedAt ?? null;
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

type LaunchCreditRow = {
  rater: `0x${string}`;
  commitKey: `0x${string}`;
  recordedAt: bigint;
  historicalVoteCount: number;
  raterVerified: boolean | null;
  raterRevoked: boolean | null;
  raterCredentialProvider: number | null;
  raterCredentialNullifierHash: `0x${string}` | null;
  raterCredentialExpiresAt: bigint | null;
  raterCredentialUpdatedAt: bigint | null;
};

type LaunchAnchorVoteRow = {
  account: `0x${string}` | null;
  voter: `0x${string}`;
  provider: number | null;
  nullifierHash: `0x${string}` | null;
  verified: boolean | null;
  revoked: boolean | null;
  verifiedAt: bigint | null;
  expiresAt: bigint | null;
  credentialUpdatedAt: bigint | null;
};

function isActiveRoundHumanCredential(
  credential: {
    verified: boolean | null;
    revoked: boolean | null;
    expiresAt: bigint | null;
  },
  roundStartTime: bigint,
) {
  return (
    credential.verified === true &&
    credential.revoked !== true &&
    credential.expiresAt !== null &&
    credential.expiresAt > roundStartTime
  );
}

function collectCurrentLaunchAnchorFeatures(args: {
  anchorRows: readonly LaunchAnchorVoteRow[];
  banState: ActiveCorrelationIdentityBanState;
  minAnchorCredentialAgeSeconds: number;
  rewardRecipient: `0x${string}`;
  roundStartTime: bigint;
  submitterIdentity: `0x${string}`;
}) {
  const anchors: string[] = [];
  const seenAnchors = new Set<string>();
  const rewardRecipient = args.rewardRecipient.toLowerCase();
  const submitterIdentity = args.submitterIdentity.toLowerCase();
  const minCredentialAge = BigInt(args.minAnchorCredentialAgeSeconds);
  for (const row of args.anchorRows) {
    const account = row.account ?? row.voter;
    const normalizedAccount = account.toLowerCase();
    if (
      normalizedAccount === rewardRecipient ||
      normalizedAccount === submitterIdentity
    )
      continue;
    if (
      !isActiveRoundHumanCredential(
        {
          verified: row.verified,
          revoked: row.revoked,
          expiresAt: row.expiresAt,
        },
        args.roundStartTime,
      ) ||
      row.verifiedAt === null ||
      row.provider === null
    ) {
      continue;
    }
    const nullifierHash = normalizeHex32(row.nullifierHash);
    if (nullifierHash === null || nullifierHash === zeroHash) continue;
    if (row.verifiedAt + minCredentialAge > args.roundStartTime) continue;

    const anchorId = launchHumanIdentityKey(row.provider, nullifierHash);
    if (anchorId === zeroHash) continue;
    if (args.banState.launchIdentityKeys.has(anchorId.toLowerCase())) continue;
    if (
      args.banState.addressIdentityKeys.has(
        addressIdentityKey(account).toLowerCase(),
      )
    ) {
      continue;
    }
    const normalizedAnchorId = anchorId.toLowerCase();
    if (seenAnchors.has(normalizedAnchorId)) continue;
    seenAnchors.add(normalizedAnchorId);
    anchors.push(`launch-anchor:${normalizedAnchorId}`);
  }
  return anchors.sort();
}

function formatLaunchCreditRow(args: {
  anchorFeatures: readonly string[];
  banState: ActiveCorrelationIdentityBanState;
  credit: LaunchCreditRow;
  minVerifiedHumans: number;
  roundStartTime: bigint;
}) {
  const excludedReasons: string[] = [];
  if (
    args.banState.addressIdentityKeys.has(
      addressIdentityKey(args.credit.rater).toLowerCase(),
    )
  ) {
    excludedReasons.push("rater_address_banned");
  }
  if (args.anchorFeatures.length < args.minVerifiedHumans) {
    excludedReasons.push("launch_anchor_threshold");
  }

  if (excludedReasons.length > 0) {
    return {
      excludedVote: {
        account: args.credit.rater,
        identityKey: zeroHash,
        commitKey: args.credit.commitKey,
        cooldownSeconds: null,
        profileUpdatedAt: null,
        reasons: excludedReasons,
        roundOpenTime: args.roundStartTime.toString(),
      },
      item: null,
    };
  }

  return {
    excludedVote: null,
    item: {
      account: args.credit.rater,
      voter: args.credit.rater,
      identityKey: zeroHash,
      commitKey: args.credit.commitKey,
      isUp: null,
      stake: null,
      epochIndex: null,
      revealWeight: null,
      baseWeight: 10_000n,
      verifiedHuman: isActiveRoundHumanCredential(
        {
          verified: args.credit.raterVerified,
          revoked: args.credit.raterRevoked,
          expiresAt: args.credit.raterCredentialExpiresAt,
        },
        args.roundStartTime,
      ),
      historicalVoteCount: args.credit.historicalVoteCount,
      payoutEligible: true,
      features: args.anchorFeatures,
    },
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
        questionDuration: questionRewardPool.bountyWindowSeconds,
        questionDurationSeconds: questionRewardPool.bountyWindowSeconds,
        rewardOpensAt: questionRewardPool.bountyOpensAt,
        rewardClosesAt: questionRewardPool.bountyClosesAt,
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
          questionRewardPoolHasValidBountyWindowExpression(),
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

  app.get("/correlation/launch-round-candidates", async (c) => {
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const rows = await db
      .select({
        domain: sql<number>`${PAYOUT_DOMAIN_LAUNCH_CREDIT}`,
        rewardPoolId: sql<bigint>`0`,
        contentId: launchEarnedRaterCredit.contentId,
        roundId: launchEarnedRaterCredit.roundId,
        pendingCreditCount: sql<number>`count(*)`,
        snapshotStatus: roundPayoutSnapshot.status,
      })
      .from(launchEarnedRaterCredit)
      .innerJoin(
        round,
        and(
          eq(round.contentId, launchEarnedRaterCredit.contentId),
          eq(round.roundId, launchEarnedRaterCredit.roundId),
        ),
      )
      .leftJoin(
        roundPayoutSnapshot,
        and(
          eq(roundPayoutSnapshot.domain, PAYOUT_DOMAIN_LAUNCH_CREDIT),
          eq(roundPayoutSnapshot.rewardPoolId, 0n),
          eq(roundPayoutSnapshot.contentId, launchEarnedRaterCredit.contentId),
          eq(roundPayoutSnapshot.roundId, launchEarnedRaterCredit.roundId),
        ),
      )
      .where(
        and(
          eq(launchEarnedRaterCredit.pending, true),
          eq(launchEarnedRaterCredit.finalized, false),
          eq(launchEarnedRaterCredit.cancelled, false),
          eq(round.state, ROUND_STATE.Settled),
          or(
            sql`${roundPayoutSnapshot.id} is null`,
            eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS_PROPOSED),
            eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS_REJECTED),
          ),
        ),
      )
      .groupBy(
        launchEarnedRaterCredit.contentId,
        launchEarnedRaterCredit.roundId,
        roundPayoutSnapshot.status,
      )
      .orderBy(
        desc(launchEarnedRaterCredit.roundId),
        asc(launchEarnedRaterCredit.contentId),
      )
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
        questionDuration: questionBundleReward.bountyWindowSeconds,
        questionDurationSeconds: questionBundleReward.bountyWindowSeconds,
        rewardOpensAt: questionBundleReward.bountyOpensAt,
        rewardClosesAt: questionBundleReward.bountyClosesAt,
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
            ${questionBundleReward.bountyClosesAt} != 0
            and ${questionBundleReward.bountyOpensAt} <= ${questionBundleReward.bountyClosesAt}
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
    const nowSeconds = resolveApiNowSeconds(c.req.query("now"));
    if (nowSeconds === null) {
      return c.json({ error: "now must be a non-negative integer" }, 400);
    }

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
            sql`${vote.identityHolder} != ${questionRewardPool.payerIdentity}`,
            sql`${vote.identityHolder} != ${questionRewardPool.submitterIdentity}`,
            sql`${vote.identityKey} != ${questionRewardPool.payerIdentityKey}`,
            sql`${vote.identityKey} != ${questionRewardPool.submitterIdentityKey}`,
            questionRewardPoolVoteWithinBountyWindowExpression(
              sql`coalesce(${vote.committedAt}, ${vote.revealedAt}, 0)`,
            ),
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
    let endedNaturally = false;
    let banState: ActiveCorrelationIdentityBanState | null = null;
    const scanPageBudget = correlationVoteScanPageBudget(offset);
    for (let page = 0; page < scanPageBudget; page += 1) {
      const rows = await loadVoteRows(CORRELATION_VOTE_PAGE_SIZE, scanOffset);
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
      if (rows.length < CORRELATION_VOTE_PAGE_SIZE) {
        endedNaturally = true;
        break;
      }
    }
    if (!endedNaturally) {
      const probeRows = await loadVoteRows(1, scanOffset);
      if (probeRows.length === 0) {
        endedNaturally = true;
      }
    }
    const truncated = isCorrelationVoteScanTruncated({
      endedNaturally,
      eligibleSeen,
      offset,
    });

    const roundContext = await getRoundContext(contentId, roundId);

    return jsonBig(c, {
      excludedVotes,
      items,
      roundContext,
      truncated,
    });
  });

  app.get("/correlation/launch-round-votes", async (c) => {
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
    const nowSeconds = resolveApiNowSeconds(c.req.query("now"));
    if (nowSeconds === null) {
      return c.json({ error: "now must be a non-negative integer" }, 400);
    }

    const [roundRow] = await db
      .select({
        startTime: round.startTime,
        submitter: content.submitter,
        submitterIdentity: content.submitterIdentity,
      })
      .from(round)
      .innerJoin(content, eq(content.id, round.contentId))
      .where(
        and(
          eq(round.contentId, contentId),
          eq(round.roundId, roundId),
          eq(round.state, ROUND_STATE.Settled),
          sql`${round.startTime} is not null`,
        ),
      )
      .limit(1);

    if (!roundRow || roundRow.startTime === null) {
      return jsonBig(c, {
        excludedVotes: [],
        items: [],
        roundContext: null,
        truncated: false,
      });
    }
    const submitterIdentity = normalizeAddress(roundRow.submitterIdentity);
    if (submitterIdentity === null || submitterIdentity === zeroAddress) {
      return c.json(
        {
          error:
            "Submitter identity is not indexed for this launch round; rebuild or backfill Ponder before publishing the artifact.",
          reason: "launch_submitter_identity_unavailable",
        },
        409,
      );
    }

    const [launchPolicy] = await db
      .select()
      .from(launchRewardPolicyState)
      .where(eq(launchRewardPolicyState.id, "current"))
      .limit(1);
    const minVerifiedHumans =
      launchPolicy?.minVerifiedHumans ?? DEFAULT_LAUNCH_MIN_VERIFIED_HUMANS;
    const minAnchorCredentialAgeSeconds =
      launchPolicy?.minAnchorCredentialAgeSeconds ??
      DEFAULT_LAUNCH_MIN_ANCHOR_CREDENTIAL_AGE_SECONDS;

    const [creditRows, anchorRows] = await Promise.all([
      db
        .select({
          rater: launchEarnedRaterCredit.rater,
          commitKey: launchEarnedRaterCredit.commitKey,
          recordedAt: launchEarnedRaterCredit.recordedAt,
          historicalVoteCount: sql<number>`case when coalesce(${voterStats.totalSettledVotes}, 0) > 0 then coalesce(${voterStats.totalSettledVotes}, 0) - 1 else 0 end`,
          raterVerified: raterHumanCredential.verified,
          raterRevoked: raterHumanCredential.revoked,
          raterCredentialProvider: raterHumanCredential.provider,
          raterCredentialNullifierHash: raterHumanCredential.nullifierHash,
          raterCredentialExpiresAt: raterHumanCredential.expiresAt,
          raterCredentialUpdatedAt: raterHumanCredential.updatedAt,
        })
        .from(launchEarnedRaterCredit)
        .leftJoin(
          voterStats,
          eq(voterStats.voter, launchEarnedRaterCredit.rater),
        )
        .leftJoin(
          raterHumanCredential,
          eq(raterHumanCredential.rater, launchEarnedRaterCredit.rater),
        )
        .where(
          and(
            eq(launchEarnedRaterCredit.contentId, contentId),
            eq(launchEarnedRaterCredit.roundId, roundId),
            eq(launchEarnedRaterCredit.pending, true),
            eq(launchEarnedRaterCredit.finalized, false),
            eq(launchEarnedRaterCredit.cancelled, false),
          ),
        )
        .orderBy(
          asc(launchEarnedRaterCredit.updatedAt),
          asc(launchEarnedRaterCredit.commitKey),
        ),
      db
        .select({
          account: vote.identityHolder,
          voter: vote.voter,
          provider: raterHumanCredential.provider,
          nullifierHash: raterHumanCredential.nullifierHash,
          verified: raterHumanCredential.verified,
          revoked: raterHumanCredential.revoked,
          verifiedAt: raterHumanCredential.verifiedAt,
          expiresAt: raterHumanCredential.expiresAt,
          credentialUpdatedAt: raterHumanCredential.updatedAt,
        })
        .from(vote)
        .leftJoin(
          raterHumanCredential,
          eq(raterHumanCredential.rater, vote.identityHolder),
        )
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
        ),
    ]);

    const banState =
      creditRows.length > 0 || anchorRows.length > 0
        ? await loadActiveCorrelationIdentityBanState(nowSeconds)
        : {
            addressIdentityKeys: new Set<string>(),
            identityKeys: new Set<string>(),
            launchIdentityKeys: new Set<string>(),
          };
    const typedCreditRows = creditRows as LaunchCreditRow[];
    const typedAnchorRows = anchorRows as LaunchAnchorVoteRow[];
    const earliestRecordedAt = typedCreditRows.reduce<bigint | null>(
      (earliest, credit) =>
        earliest === null || credit.recordedAt < earliest
          ? credit.recordedAt
          : earliest,
      null,
    );
    if (
      earliestRecordedAt !== null &&
      launchPolicy?.updatedAt !== undefined &&
      launchPolicy.updatedAt > earliestRecordedAt
    ) {
      return c.json(
        {
          error:
            "Launch reward policy changed after a pending credit was recorded; use a manually verified artifact.",
          reason: "launch_policy_drift",
        },
        409,
      );
    }
    if (
      earliestRecordedAt !== null &&
      typedCreditRows.some(
        (credit) =>
          credit.raterCredentialUpdatedAt !== null &&
          credit.raterCredentialUpdatedAt > credit.recordedAt,
      )
    ) {
      return c.json(
        {
          error:
            "Rater credential state changed after a pending credit was recorded; use a manually verified artifact.",
          reason: "launch_rater_credential_drift",
        },
        409,
      );
    }
    if (
      earliestRecordedAt !== null &&
      typedAnchorRows.some(
        (row) =>
          row.credentialUpdatedAt !== null &&
          row.credentialUpdatedAt > earliestRecordedAt,
      )
    ) {
      return c.json(
        {
          error:
            "Anchor credential state changed after a pending credit was recorded; use a manually verified artifact.",
          reason: "launch_anchor_credential_drift",
        },
        409,
      );
    }
    const latestRelevantIdentityBanUpdatedAt =
      earliestRecordedAt === null
        ? null
        : await loadLatestRelevantIdentityBanUpdatedAt(
            collectLaunchIdentityBanSources(typedCreditRows, typedAnchorRows),
            earliestRecordedAt,
          );
    if (latestRelevantIdentityBanUpdatedAt !== null) {
      return c.json(
        {
          error:
            "Identity ban state changed after a pending credit was recorded; use a manually verified artifact.",
          reason: "launch_identity_ban_drift",
        },
        409,
      );
    }
    const items: ReturnType<typeof formatLaunchCreditRow>["item"][] = [];
    const excludedVotes: NonNullable<
      ReturnType<typeof formatLaunchCreditRow>["excludedVote"]
    >[] = [];
    let eligibleSeen = 0;

    for (const credit of typedCreditRows) {
      const anchorFeatures = collectCurrentLaunchAnchorFeatures({
        anchorRows: typedAnchorRows,
        banState,
        minAnchorCredentialAgeSeconds,
        rewardRecipient: credit.rater,
        roundStartTime: roundRow.startTime,
        submitterIdentity,
      });
      const formatted = formatLaunchCreditRow({
        anchorFeatures,
        banState,
        credit,
        minVerifiedHumans,
        roundStartTime: roundRow.startTime,
      });
      if (formatted.excludedVote) {
        excludedVotes.push(formatted.excludedVote);
        continue;
      }
      if (formatted.item && eligibleSeen >= offset && items.length < limit) {
        items.push(formatted.item);
      }
      eligibleSeen += 1;
    }

    const roundContext = await getRoundContext(contentId, roundId);

    return jsonBig(c, {
      excludedVotes,
      items,
      roundContext,
      truncated: false,
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
    const nowSeconds = resolveApiNowSeconds(c.req.query("now"));
    if (nowSeconds === null) {
      return c.json({ error: "now must be a non-negative integer" }, 400);
    }
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
      return jsonBig(c, {
        excludedVotes: [],
        items: [],
        roundContext: null,
        truncated: false,
      });
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
      return jsonBig(c, {
        excludedVotes: [],
        items: [],
        roundContext: null,
        truncated: false,
      });
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

    const loadVoteRows = (scanLimit: number, scanOffset: number) =>
      db
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
            ${bundle.bountyClosesAt} != 0
            and ${bundle.bountyOpensAt} <= ${bundle.bountyClosesAt}
            and coalesce(${vote.committedAt}, ${vote.revealedAt}, 0) >= ${bundle.bountyOpensAt}
            and coalesce(${vote.committedAt}, ${vote.revealedAt}, 0) <= ${bundle.bountyClosesAt}
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
        )
        .limit(scanLimit)
        .offset(scanOffset);

    type BundleVoteRow = Awaited<ReturnType<typeof loadVoteRows>>[number];
    const completedByIdentity = new Map<
      string,
      { firstVote: BundleVoteRow | null; bundleIndexes: Set<number> }
    >();
    let scanOffset = 0;
    let endedNaturally = false;
    const scanPageBudget = correlationVoteScanPageBudget(
      offset * Number(bundle.questionCount),
    );
    for (let page = 0; page < scanPageBudget; page += 1) {
      const rows = await loadVoteRows(CORRELATION_VOTE_PAGE_SIZE, scanOffset);
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
      scanOffset += rows.length;
      if (rows.length < CORRELATION_VOTE_PAGE_SIZE) {
        endedNaturally = true;
        break;
      }
    }
    if (!endedNaturally) {
      const probeRows = await loadVoteRows(1, scanOffset);
      if (probeRows.length === 0) {
        endedNaturally = true;
      }
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
        ? await loadActiveCorrelationIdentityBanState(nowSeconds)
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
    }

    const truncated = isCorrelationVoteScanTruncated({
      endedNaturally,
      eligibleSeen,
      offset,
    });

    return jsonBig(c, {
      excludedVotes,
      items,
      roundContext,
      truncated,
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
    const nowSeconds = resolveApiNowSeconds(c.req.query("now"));
    if (nowSeconds === null) {
      return c.json({ error: "now must be a non-negative integer" }, 400);
    }

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
        .limit(scanLimit)
        .offset(scanOffset);

    const items: ReturnType<typeof formatCorrelationVoteRow>["item"][] = [];
    const excludedVotes: NonNullable<
      ReturnType<typeof formatCorrelationVoteRow>["excludedVote"]
    >[] = [];
    let eligibleSeen = 0;
    let scanOffset = 0;
    let endedNaturally = false;
    let banState: ActiveCorrelationIdentityBanState | null = null;
    const scanPageBudget = correlationVoteScanPageBudget(offset);
    for (let page = 0; page < scanPageBudget; page += 1) {
      const rows = await loadVoteRows(CORRELATION_VOTE_PAGE_SIZE, scanOffset);
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
      if (rows.length < CORRELATION_VOTE_PAGE_SIZE) {
        endedNaturally = true;
        break;
      }
    }
    if (!endedNaturally) {
      const probeRows = await loadVoteRows(1, scanOffset);
      if (probeRows.length === 0) {
        endedNaturally = true;
      }
    }
    const truncated = isCorrelationVoteScanTruncated({
      endedNaturally,
      eligibleSeen,
      offset,
    });

    const roundContext = await getRoundContext(contentId, roundId);
    return jsonBig(c, {
      excludedVotes,
      items,
      roundContext,
      truncated,
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
