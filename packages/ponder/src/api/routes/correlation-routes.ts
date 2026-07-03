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
  PAYOUT_DOMAIN_RBTS_SETTLEMENT,
} from "@rateloop/node-utils/correlationScoring";
import { encodeAbiParameters, keccak256, zeroAddress, zeroHash } from "viem";
import { and, asc, desc, eq, or, sql } from "ponder";
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
  vote,
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
import { buildCorrelationFinalitySla } from "../correlation-finality-sla.js";
import {
  parseStrictUnsignedInteger,
  safeBigInt,
  safeLimit,
  safeOffset,
} from "../utils.js";

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

type InputSnapshotSource = {
  sourceBlockNumber: bigint | null;
  sourceTxHash: `0x${string}` | null;
  sourceLogIndex: number | null;
  sourceTimestamp: bigint | null;
};

function parseStoredBanReasons(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter((reason): reason is string => typeof reason === "string")
          .sort()
      : [];
  } catch {
    return [];
  }
}

function hasPinnedVoteSnapshot(row: {
  banReasons: string | null;
  historicalVoteCount: number | null;
  verifiedHuman: boolean | null;
}) {
  return (
    (row.verifiedHuman === true || row.verifiedHuman === false) &&
    row.historicalVoteCount !== null &&
    Number.isSafeInteger(row.historicalVoteCount) &&
    row.historicalVoteCount >= 0 &&
    typeof row.banReasons === "string"
  );
}

function hasPinnedLaunchCreditSnapshot(row: LaunchCreditRow) {
  return hasPinnedVoteSnapshot({
    banReasons: row.banReasons,
    historicalVoteCount: row.historicalVoteCount,
    verifiedHuman: row.verifiedHuman,
  });
}

function hasPinnedLaunchAnchorSnapshot(row: LaunchAnchorVoteRow) {
  return hasPinnedVoteSnapshot({
    banReasons: row.banReasons,
    historicalVoteCount: row.historicalVoteCount,
    verifiedHuman: row.verifiedHuman,
  });
}

function missingInputSnapshotResponse(c: any) {
  return c.json(
    {
      error:
        "Correlation input snapshot fields are missing; rebuild Ponder from the redeployed contracts before publishing the artifact.",
      reason: "correlation_input_snapshot_missing",
    },
    409,
  );
}

function latestInputSnapshotSource(
  sources: readonly InputSnapshotSource[],
): InputSnapshotSource | null {
  const complete = sources.filter(
    (source) =>
      source.sourceBlockNumber !== null &&
      source.sourceTxHash !== null &&
      source.sourceLogIndex !== null &&
      source.sourceTimestamp !== null,
  );
  if (complete.length === 0) return null;
  return complete.reduce((latest, source) => {
    if (source.sourceBlockNumber! > latest.sourceBlockNumber!) return source;
    if (
      source.sourceBlockNumber === latest.sourceBlockNumber &&
      source.sourceLogIndex! > latest.sourceLogIndex!
    ) {
      return source;
    }
    return latest;
  });
}

function buildInputSnapshotRef(args: {
  contentId: bigint;
  domain: number;
  rewardPoolId: bigint;
  roundId: bigint;
  source: InputSnapshotSource | null;
}) {
  const source = args.source;
  if (
    source?.sourceBlockNumber === null ||
    source?.sourceBlockNumber === undefined ||
    source.sourceTxHash === null ||
    source.sourceLogIndex === null ||
    source.sourceTimestamp === null
  ) {
    return null;
  }
  return {
    domain: args.domain,
    rewardPoolId: args.rewardPoolId.toString(),
    contentId: args.contentId.toString(),
    roundId: args.roundId.toString(),
    sourceBlockNumber: source.sourceBlockNumber.toString(),
    sourceLogIndex: source.sourceLogIndex,
    sourceTimestamp: source.sourceTimestamp.toString(),
    sourceTransactionHash: source.sourceTxHash,
  };
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

async function getRoundContext(args: {
  contentId: bigint;
  domain: number;
  expectedRoundState?: number | null;
  inputSnapshotSource?: InputSnapshotSource | null;
  rewardPoolId: bigint;
  roundId: bigint;
  snapshotContentId?: bigint;
  snapshotRoundId?: bigint;
}) {
  const expectedRoundState = args.expectedRoundState ?? ROUND_STATE.Settled;
  const requestedRoundPredicates = [
    eq(round.contentId, args.contentId),
    eq(round.roundId, args.roundId),
  ];
  if (expectedRoundState !== null) {
    requestedRoundPredicates.push(eq(round.state, expectedRoundState));
  }
  const [requestedRound] = await db
    .select({
      questionMetadataHash: content.questionMetadataHash,
      questionMetadataUri: content.questionMetadataUri,
      resultSpecHash: content.resultSpecHash,
      settledAt: round.settledAt,
      settledBlockNumber: round.settledBlockNumber,
      settledTxHash: round.settledTxHash,
      settledLogIndex: round.settledLogIndex,
    })
    .from(round)
    .innerJoin(content, eq(content.id, round.contentId))
    .where(and(...requestedRoundPredicates))
    .limit(1);

  const settledAt = requestedRound?.settledAt ?? null;
  const source =
    args.inputSnapshotSource ??
    (requestedRound
      ? {
          sourceBlockNumber: requestedRound.settledBlockNumber,
          sourceTxHash: normalizeHex32(requestedRound.settledTxHash),
          sourceLogIndex: requestedRound.settledLogIndex,
          sourceTimestamp: requestedRound.settledAt,
        }
      : null);
  const inputSnapshot = buildInputSnapshotRef({
    contentId: args.snapshotContentId ?? args.contentId,
    domain: args.domain,
    rewardPoolId: args.rewardPoolId,
    roundId: args.snapshotRoundId ?? args.roundId,
    source,
  });
  if (settledAt === null) {
    return {
      trailingBaseRateUpBps: BASE_RATE_NEUTRAL_BPS,
      baseRateWindowRounds: BASE_RATE_WINDOW_ROUNDS,
      questionMetadataRef: questionMetadataRef(requestedRound ?? null),
      ...(inputSnapshot ? { inputSnapshot } : {}),
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
        sql`(${round.settledAt}, ${round.contentId}, ${round.roundId}) < (${settledAt}, ${args.contentId}, ${args.roundId})`,
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
    ...(inputSnapshot ? { inputSnapshot } : {}),
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
  return parseStrictUnsignedInteger(value) ?? Number.NaN;
}

function formatCorrelationVoteRow(
  row: {
    account: `0x${string}` | null;
    banReasons: string | null;
    voter: `0x${string}`;
    identityKey: `0x${string}` | null;
    commitKey: `0x${string}`;
    isUp: boolean | null;
    stake: bigint;
    epochIndex: number;
    revealWeight: bigint | null;
    baseWeight: bigint | null;
    verifiedHuman: boolean | null;
    historicalVoteCount: number | null;
  },
) {
  const account = row.account ?? row.voter;
  const identityKey = row.identityKey ?? zeroHash;
  const excludedReasons = parseStoredBanReasons(row.banReasons);

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
    baseWeight: row.baseWeight ?? row.revealWeight ?? 0n,
    verifiedHuman: row.verifiedHuman === true,
    historicalVoteCount: row.historicalVoteCount ?? 0,
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
  sourceBlockNumber: bigint | null;
  sourceTxHash: `0x${string}` | null;
  sourceLogIndex: number | null;
  sourceTimestamp: bigint | null;
  historicalVoteCount: number | null;
  verifiedHuman: boolean | null;
  credentialProvider: number | null;
  credentialNullifierHash: `0x${string}` | null;
  credentialVerifiedAt: bigint | null;
  credentialExpiresAt: bigint | null;
  banReasons: string | null;
};

type LaunchAnchorVoteRow = {
  account: `0x${string}` | null;
  voter: `0x${string}`;
  historicalVoteCount: number | null;
  verifiedHuman: boolean | null;
  credentialProvider: number | null;
  credentialNullifierHash: `0x${string}` | null;
  credentialVerifiedAt: bigint | null;
  credentialExpiresAt: bigint | null;
  banReasons: string | null;
};

function collectPinnedLaunchAnchorFeatures(args: {
  anchorRows: readonly LaunchAnchorVoteRow[];
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
    const banReasons = parseStoredBanReasons(row.banReasons);
    if (
      banReasons.some((reason) =>
        [
          "holder_address_banned",
          "identity_banned",
          "launch_identity_banned",
          "voter_address_banned",
        ].includes(reason),
      )
    ) {
      continue;
    }
    if (
      row.verifiedHuman !== true ||
      row.credentialVerifiedAt === null ||
      row.credentialProvider === null
    ) {
      continue;
    }
    const nullifierHash = normalizeHex32(row.credentialNullifierHash);
    if (nullifierHash === null || nullifierHash === zeroHash) continue;
    if (row.credentialVerifiedAt + minCredentialAge > args.roundStartTime)
      continue;

    const anchorId = launchHumanIdentityKey(
      row.credentialProvider,
      nullifierHash,
    );
    if (anchorId === zeroHash) continue;
    const normalizedAnchorId = anchorId.toLowerCase();
    if (seenAnchors.has(normalizedAnchorId)) continue;
    seenAnchors.add(normalizedAnchorId);
    anchors.push(`launch-anchor:${normalizedAnchorId}`);
  }
  return anchors.sort();
}

function formatLaunchCreditRow(args: {
  anchorFeatures: readonly string[];
  credit: LaunchCreditRow;
  minVerifiedHumans: number;
  roundStartTime: bigint;
}) {
  const excludedReasons = parseStoredBanReasons(args.credit.banReasons).map(
    (reason) =>
      reason === "voter_address_banned" || reason === "holder_address_banned"
        ? "rater_address_banned"
        : reason,
  );
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
      verifiedHuman: args.credit.verifiedHuman === true,
      historicalVoteCount: args.credit.historicalVoteCount ?? 0,
      payoutEligible: true,
      features: args.anchorFeatures,
    },
  };
}

export function registerCorrelationRoutes(app: ApiApp) {
  app.get("/correlation/finality-sla", async (c) => {
    const now = resolveApiNowSeconds(c.req.query("now"));
    if (now === null) return c.json({ error: "Invalid now" }, 400);
    return c.json(await buildCorrelationFinalitySla(now));
  });

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

  app.get("/correlation/rbts-settlement-round-candidates", async (c) => {
    const limit = safeLimit(c.req.query("limit"), 50, 200);
    const offset = safeOffset(c.req.query("offset"));
    if (Number.isNaN(offset)) return c.json({ error: "Invalid offset" }, 400);

    const rows = await db
      .select({
        domain: sql<number>`${PAYOUT_DOMAIN_RBTS_SETTLEMENT}`,
        rewardPoolId: sql<bigint>`0`,
        contentId: round.contentId,
        roundId: round.roundId,
        rbtsSettlementStatus: round.rbtsSettlementStatus,
        rbtsSettlementReadyAt: round.rbtsSettlementReadyAt,
        revealedCount: round.revealedCount,
        snapshotStatus: roundPayoutSnapshot.status,
      })
      .from(round)
      .leftJoin(
        roundPayoutSnapshot,
        and(
          eq(roundPayoutSnapshot.domain, PAYOUT_DOMAIN_RBTS_SETTLEMENT),
          eq(roundPayoutSnapshot.rewardPoolId, 0n),
          eq(roundPayoutSnapshot.contentId, round.contentId),
          eq(roundPayoutSnapshot.roundId, round.roundId),
        ),
      )
      .where(
        and(
          eq(round.state, ROUND_STATE.SettlementPending),
          eq(round.rbtsSettlementStatus, "pending"),
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
    if (resolveApiNowSeconds(c.req.query("now")) === null) {
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
          verifiedHuman: vote.correlationVerifiedHuman,
          historicalVoteCount: vote.correlationHistoricalVoteCount,
          banReasons: vote.correlationBanReasons,
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
                eq(vote.correlationVerifiedHuman, true),
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
    const scanPageBudget = correlationVoteScanPageBudget(offset);
    for (let page = 0; page < scanPageBudget; page += 1) {
      const rows = await loadVoteRows(CORRELATION_VOTE_PAGE_SIZE, scanOffset);
      if (rows.some((row) => !hasPinnedVoteSnapshot(row))) {
        return missingInputSnapshotResponse(c);
      }
      for (const row of rows) {
        const formatted = formatCorrelationVoteRow(row);
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

    const roundContext = await getRoundContext({
      contentId,
      domain: PAYOUT_DOMAIN_QUESTION_REWARD,
      rewardPoolId,
      roundId,
    });

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
    if (resolveApiNowSeconds(c.req.query("now")) === null) {
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
          sourceBlockNumber: launchEarnedRaterCredit.sourceBlockNumber,
          sourceTxHash: launchEarnedRaterCredit.sourceTxHash,
          sourceLogIndex: launchEarnedRaterCredit.sourceLogIndex,
          sourceTimestamp: launchEarnedRaterCredit.sourceTimestamp,
          historicalVoteCount:
            launchEarnedRaterCredit.correlationHistoricalVoteCount,
          verifiedHuman: launchEarnedRaterCredit.correlationVerifiedHuman,
          credentialProvider:
            launchEarnedRaterCredit.correlationCredentialProvider,
          credentialNullifierHash:
            launchEarnedRaterCredit.correlationCredentialNullifierHash,
          credentialVerifiedAt:
            launchEarnedRaterCredit.correlationCredentialVerifiedAt,
          credentialExpiresAt:
            launchEarnedRaterCredit.correlationCredentialExpiresAt,
          banReasons: launchEarnedRaterCredit.correlationBanReasons,
        })
        .from(launchEarnedRaterCredit)
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
          historicalVoteCount: vote.correlationHistoricalVoteCount,
          verifiedHuman: vote.correlationVerifiedHuman,
          credentialProvider: vote.correlationCredentialProvider,
          credentialNullifierHash: vote.correlationCredentialNullifierHash,
          credentialVerifiedAt: vote.correlationCredentialVerifiedAt,
          credentialExpiresAt: vote.correlationCredentialExpiresAt,
          banReasons: vote.correlationBanReasons,
        })
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
        ),
    ]);

    const typedCreditRows = creditRows as LaunchCreditRow[];
    const typedAnchorRows = anchorRows as LaunchAnchorVoteRow[];
    if (
      typedCreditRows.some((row) => !hasPinnedLaunchCreditSnapshot(row)) ||
      typedAnchorRows.some((row) => !hasPinnedLaunchAnchorSnapshot(row))
    ) {
      return missingInputSnapshotResponse(c);
    }
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
    const launchInputSnapshotSource = latestInputSnapshotSource(
      typedCreditRows.map((credit) => ({
        sourceBlockNumber: credit.sourceBlockNumber,
        sourceTxHash: normalizeHex32(credit.sourceTxHash),
        sourceLogIndex: credit.sourceLogIndex,
        sourceTimestamp: credit.sourceTimestamp,
      })),
    );
    const items: ReturnType<typeof formatLaunchCreditRow>["item"][] = [];
    const excludedVotes: NonNullable<
      ReturnType<typeof formatLaunchCreditRow>["excludedVote"]
    >[] = [];
    let eligibleSeen = 0;

    for (const credit of typedCreditRows) {
      const anchorFeatures = collectPinnedLaunchAnchorFeatures({
        anchorRows: typedAnchorRows,
        minAnchorCredentialAgeSeconds,
        rewardRecipient: credit.rater,
        roundStartTime: roundRow.startTime,
        submitterIdentity,
      });
      const formatted = formatLaunchCreditRow({
        anchorFeatures,
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

    const roundContext = await getRoundContext({
      contentId,
      domain: PAYOUT_DOMAIN_LAUNCH_CREDIT,
      inputSnapshotSource: launchInputSnapshotSource,
      rewardPoolId: 0n,
      roundId,
    });

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
    if (resolveApiNowSeconds(c.req.query("now")) === null) {
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
        sourceBlockNumber: round.settledBlockNumber,
        sourceTxHash: round.settledTxHash,
        sourceLogIndex: round.settledLogIndex,
        sourceTimestamp: round.settledAt,
      })
      .from(questionBundleRound)
      .innerJoin(
        round,
        and(
          eq(round.contentId, questionBundleRound.contentId),
          eq(round.roundId, questionBundleRound.roundId),
        ),
      )
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
    const bundleInputSnapshotSource = latestInputSnapshotSource(
      bundleRounds.map((row) => ({
        sourceBlockNumber: row.sourceBlockNumber,
        sourceTxHash: normalizeHex32(row.sourceTxHash),
        sourceLogIndex: row.sourceLogIndex,
        sourceTimestamp: row.sourceTimestamp,
      })),
    );
    const roundContext = await getRoundContext({
      contentId: firstBundleRound.contentId,
      domain: PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
      inputSnapshotSource: bundleInputSnapshotSource,
      rewardPoolId,
      roundId: firstBundleRound.roundId,
      snapshotContentId: contentId,
      snapshotRoundId: roundId,
    });
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
          verifiedHuman: vote.correlationVerifiedHuman,
          historicalVoteCount: vote.correlationHistoricalVoteCount,
          banReasons: vote.correlationBanReasons,
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
                eq(vote.correlationVerifiedHuman, true),
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
      if (rows.some((row) => !hasPinnedVoteSnapshot(row))) {
        return missingInputSnapshotResponse(c);
      }
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

    const items: ReturnType<typeof formatCorrelationVoteRow>["item"][] = [];
    const excludedVotes: NonNullable<
      ReturnType<typeof formatCorrelationVoteRow>["excludedVote"]
    >[] = [];
    let eligibleSeen = 0;
    for (const row of firstVotes) {
      const formatted = formatCorrelationVoteRow(row);
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
    if (resolveApiNowSeconds(c.req.query("now")) === null) {
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
          verifiedHuman: vote.correlationVerifiedHuman,
          historicalVoteCount: vote.correlationHistoricalVoteCount,
          banReasons: vote.correlationBanReasons,
        })
        .from(vote)
        .innerJoin(
          round,
          and(
            eq(round.contentId, vote.contentId),
            eq(round.roundId, vote.roundId),
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
    const scanPageBudget = correlationVoteScanPageBudget(offset);
    for (let page = 0; page < scanPageBudget; page += 1) {
      const rows = await loadVoteRows(CORRELATION_VOTE_PAGE_SIZE, scanOffset);
      if (rows.some((row) => !hasPinnedVoteSnapshot(row))) {
        return missingInputSnapshotResponse(c);
      }
      for (const row of rows) {
        const formatted = formatCorrelationVoteRow(row);
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

    const roundContext = await getRoundContext({
      contentId,
      domain: PAYOUT_DOMAIN_PUBLIC_RATING,
      rewardPoolId: 0n,
      roundId,
    });
    return jsonBig(c, {
      excludedVotes,
      items,
      roundContext,
      truncated,
    });
  });

  app.get("/correlation/rbts-settlement-round-votes", async (c) => {
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
    if (resolveApiNowSeconds(c.req.query("now")) === null) {
      return c.json({ error: "now must be a non-negative integer" }, 400);
    }

    const [roundRow] = await db
      .select({
        rbtsSettlementPendingBlockNumber:
          round.rbtsSettlementPendingBlockNumber,
        rbtsSettlementPendingTxHash: round.rbtsSettlementPendingTxHash,
        rbtsSettlementPendingLogIndex: round.rbtsSettlementPendingLogIndex,
        rbtsSettlementPendingAt: round.rbtsSettlementPendingAt,
        rbtsSettlementReadyAt: round.rbtsSettlementReadyAt,
      })
      .from(round)
      .where(
        and(
          eq(round.contentId, contentId),
          eq(round.roundId, roundId),
          eq(round.state, ROUND_STATE.SettlementPending),
          eq(round.rbtsSettlementStatus, "pending"),
        ),
      )
      .limit(1);

    if (!roundRow) {
      return jsonBig(c, {
        excludedVotes: [],
        items: [],
        roundContext: null,
        truncated: false,
      });
    }

    const settlementInputSnapshotSource = {
      sourceBlockNumber: roundRow.rbtsSettlementPendingBlockNumber,
      sourceTxHash: normalizeHex32(roundRow.rbtsSettlementPendingTxHash),
      sourceLogIndex: roundRow.rbtsSettlementPendingLogIndex,
      sourceTimestamp: roundRow.rbtsSettlementPendingAt,
    };

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
          baseWeight: vote.rbtsWeight,
          verifiedHuman: vote.correlationVerifiedHuman,
          historicalVoteCount: vote.correlationHistoricalVoteCount,
          banReasons: vote.correlationBanReasons,
        })
        .from(vote)
        .where(
          and(
            eq(vote.contentId, contentId),
            eq(vote.roundId, roundId),
            eq(vote.revealed, true),
            sql`${vote.identityKey} is not null`,
            sql`${vote.identityHolder} is not null`,
            sql`${vote.identityKey} != ${zeroHash}`,
            sql`${vote.rbtsWeight} is not null`,
            sql`${vote.rbtsWeight} > 0`,
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
    const scanPageBudget = correlationVoteScanPageBudget(offset);
    for (let page = 0; page < scanPageBudget; page += 1) {
      const rows = await loadVoteRows(CORRELATION_VOTE_PAGE_SIZE, scanOffset);
      if (rows.some((row) => !hasPinnedVoteSnapshot(row))) {
        return missingInputSnapshotResponse(c);
      }
      for (const row of rows) {
        const formatted = formatCorrelationVoteRow(row);
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

    const roundContext = await getRoundContext({
      contentId,
      domain: PAYOUT_DOMAIN_RBTS_SETTLEMENT,
      expectedRoundState: ROUND_STATE.SettlementPending,
      inputSnapshotSource: settlementInputSnapshotSource,
      rewardPoolId: 0n,
      roundId,
    });
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
