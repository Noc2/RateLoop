import { ROUND_STATE } from "@rateloop/contracts/protocol";
import {
  PAYOUT_DOMAIN_LAUNCH_CREDIT,
  PAYOUT_DOMAIN_PUBLIC_RATING,
  PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD,
  PAYOUT_DOMAIN_QUESTION_REWARD,
  PAYOUT_DOMAIN_RBTS_SETTLEMENT,
} from "@rateloop/node-utils/correlationScoring";
import { and, asc, eq, inArray, or, sql } from "ponder";
import { db } from "ponder:api";
import {
  correlationEpochSnapshot,
  launchEarnedRaterCredit,
  questionBundleRound,
  questionBundleReward,
  questionRewardPool,
  round,
  roundPayoutSnapshot,
} from "ponder:schema";
import {
  questionRewardPoolHasValidBountyWindowExpression,
  questionRewardPayoutSnapshotCanQualifyExpression,
} from "./shared.js";

const SNAPSHOT_STATUS = {
  Proposed: 1,
  Challenged: 2,
  Finalized: 3,
  Rejected: 4,
} as const;

const NORMAL_MAX_DELAY_SECONDS = 60 * 60;
const SLA_ROW_LIMIT = 1_000;
const RATING_REVIEW_STATUS_PENDING = 1;

type SnapshotRow = Record<string, unknown>;
type SourceReadyRow = Record<string, unknown>;

interface PhaseBucket {
  domain: number | "correlation_epoch";
  phase: string;
  count: number;
  oldestAgeSeconds: number;
  p95AgeSeconds: number;
  oldestEstimatedReadyAt: number | null;
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/u.test(value)) return BigInt(value);
  return null;
}

function toNumber(value: bigint | null): number | null {
  if (value === null) return null;
  return value > BigInt(Number.MAX_SAFE_INTEGER)
    ? Number.MAX_SAFE_INTEGER
    : Number(value);
}

function ageSeconds(now: bigint, since: unknown): number {
  const startedAt = toBigInt(since);
  if (startedAt === null || startedAt > now) return 0;
  return toNumber(now - startedAt) ?? 0;
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

function classifySnapshot(
  row: SnapshotRow,
  now: bigint,
  options: { completeAfterFinalizedVeto?: boolean } = {},
) {
  const status = Number(row.status);
  if (status === SNAPSHOT_STATUS.Challenged) {
    return {
      phase: "disputed",
      since: row.updatedAt ?? row.proposedAt,
      estimatedReadyAt: null,
      normalPath: false,
    };
  }
  if (status === SNAPSHOT_STATUS.Rejected) {
    return {
      phase: "rejected",
      since: row.updatedAt ?? row.proposedAt,
      estimatedReadyAt: null,
      normalPath: false,
    };
  }
  if (status === SNAPSHOT_STATUS.Proposed) {
    return {
      phase: "challenge_window",
      since: row.proposedAt,
      estimatedReadyAt: toBigInt(row.challengeEndsAt),
      normalPath: true,
    };
  }
  if (status === SNAPSHOT_STATUS.Finalized) {
    const vetoEndsAt = toBigInt(row.vetoEndsAt);
    if (vetoEndsAt !== null && now < vetoEndsAt) {
      return {
        phase: "finalization_veto",
        since: row.finalizedAt ?? row.updatedAt,
        estimatedReadyAt: vetoEndsAt,
        normalPath: true,
      };
    }
    const consumedAt = toBigInt(row.consumedAt);
    if (consumedAt !== null) return null;
    if (options.completeAfterFinalizedVeto) return null;
    return {
      phase: "ready_for_consumer",
      since: vetoEndsAt ?? row.finalizedAt ?? row.updatedAt,
      estimatedReadyAt: vetoEndsAt ?? toBigInt(row.finalizedAt),
      normalPath: true,
    };
  }
  return null;
}

function bucketKey(domain: number | "correlation_epoch", phase: string) {
  return `${domain}:${phase}`;
}

function summarizeRows(
  now: bigint,
  rows: Array<SnapshotRow & { domain?: unknown }>,
  domainFallback: number | "correlation_epoch",
  options: { completeAfterFinalizedVeto?: boolean } = {},
) {
  const agesByBucket = new Map<string, number[]>();
  const readyAtByBucket = new Map<string, Array<number | null>>();
  const normalBreaches: Array<{ domain: number | "correlation_epoch"; phase: string }> = [];
  let disputedCount = 0;
  let rejectedCount = 0;

  for (const row of rows) {
    const classification = classifySnapshot(row, now, options);
    if (!classification) continue;
    const domain =
      typeof row.domain === "number" ? row.domain : domainFallback;
    const phase = classification.phase;
    const age = ageSeconds(now, classification.since);
    const key = bucketKey(domain, phase);
    agesByBucket.set(key, [...(agesByBucket.get(key) ?? []), age]);
    readyAtByBucket.set(key, [
      ...(readyAtByBucket.get(key) ?? []),
      toNumber(classification.estimatedReadyAt),
    ]);

    if (phase === "disputed") disputedCount += 1;
    if (phase === "rejected") rejectedCount += 1;
    if (classification.normalPath && age >= NORMAL_MAX_DELAY_SECONDS) {
      normalBreaches.push({ domain, phase });
    }
  }

  const buckets: PhaseBucket[] = [];
  for (const [key, ages] of agesByBucket.entries()) {
    const [domainPart, phase] = key.split(":");
    const domain =
      domainPart === "correlation_epoch"
        ? "correlation_epoch"
        : Number(domainPart);
    const readyAtValues = readyAtByBucket
      .get(key)
      ?.filter((value): value is number => value !== null) ?? [];
    buckets.push({
      domain,
      phase: phase ?? "unknown",
      count: ages.length,
      oldestAgeSeconds: Math.max(...ages),
      p95AgeSeconds: percentile95(ages),
      oldestEstimatedReadyAt:
        readyAtValues.length > 0 ? Math.min(...readyAtValues) : null,
    });
  }

  return { buckets, normalBreaches, disputedCount, rejectedCount };
}

function summarizeSourceReadyRows(now: bigint, rows: SourceReadyRow[]) {
  const agesByBucket = new Map<string, number[]>();
  const normalBreaches: Array<{ domain: number; phase: string }> = [];

  for (const row of rows) {
    const domain = typeof row.domain === "number" ? row.domain : null;
    if (domain === null) continue;
    const readyAt = toBigInt(row.sourceReadyAt);
    if (readyAt === null) continue;
    const phase = "source_ready_unproposed";
    const age = ageSeconds(now, readyAt);
    const key = bucketKey(domain, phase);
    agesByBucket.set(key, [...(agesByBucket.get(key) ?? []), age]);
    if (age >= NORMAL_MAX_DELAY_SECONDS) {
      normalBreaches.push({ domain, phase });
    }
  }

  const buckets: PhaseBucket[] = [];
  for (const [key, ages] of agesByBucket.entries()) {
    const [domainPart, phase] = key.split(":");
    buckets.push({
      domain: Number(domainPart),
      phase: phase ?? "source_ready_unproposed",
      count: ages.length,
      oldestAgeSeconds: Math.max(...ages),
      p95AgeSeconds: percentile95(ages),
      oldestEstimatedReadyAt: null,
    });
  }

  return { buckets, normalBreaches };
}

async function loadSourceReadyUnproposedRows() {
  const bundleSourceReadyAt = sql<bigint>`max(${questionBundleRound.updatedAt})`;
  const launchSourceReadyAt = sql<bigint>`case when max(${launchEarnedRaterCredit.recordedAt}) > ${round.settledAt} then max(${launchEarnedRaterCredit.recordedAt}) else ${round.settledAt} end`;
  const [
    questionRewardRows,
    launchRows,
    bundleRows,
    ratingRows,
    rbtsRows,
  ] = await Promise.all([
    db
      .select({
        domain: sql<number>`${PAYOUT_DOMAIN_QUESTION_REWARD}`,
        sourceReadyAt: round.settledAt,
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
          sql`${round.settledAt} is not null`,
          sql`${roundPayoutSnapshot.id} is null`,
        ),
      )
      .orderBy(asc(round.settledAt), asc(questionRewardPool.id))
      .limit(SLA_ROW_LIMIT),
    db
      .select({
        domain: sql<number>`${PAYOUT_DOMAIN_LAUNCH_CREDIT}`,
        sourceReadyAt: launchSourceReadyAt,
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
          sql`${round.settledAt} is not null`,
          sql`${roundPayoutSnapshot.id} is null`,
        ),
      )
      .groupBy(
        launchEarnedRaterCredit.contentId,
        launchEarnedRaterCredit.roundId,
        round.settledAt,
      )
      .orderBy(asc(launchSourceReadyAt), asc(launchEarnedRaterCredit.contentId))
      .limit(SLA_ROW_LIMIT),
    db
      .select({
        domain: sql<number>`${PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD}`,
        sourceReadyAt: bundleSourceReadyAt,
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
          sql`${roundPayoutSnapshot.id} is null`,
        ),
      )
      .groupBy(
        questionBundleReward.id,
        questionBundleRound.roundSetIndex,
        questionBundleReward.questionCount,
      )
      .having(
        sql`count(distinct ${questionBundleRound.bundleIndex}) >= ${questionBundleReward.questionCount}`,
      )
      .orderBy(asc(bundleSourceReadyAt), asc(questionBundleReward.id))
      .limit(SLA_ROW_LIMIT),
    db
      .select({
        domain: sql<number>`${PAYOUT_DOMAIN_PUBLIC_RATING}`,
        sourceReadyAt: round.settledAt,
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
          sql`${round.settledAt} is not null`,
          sql`${roundPayoutSnapshot.id} is null`,
        ),
      )
      .orderBy(asc(round.settledAt), asc(round.contentId))
      .limit(SLA_ROW_LIMIT),
    db
      .select({
        domain: sql<number>`${PAYOUT_DOMAIN_RBTS_SETTLEMENT}`,
        sourceReadyAt: round.rbtsSettlementReadyAt,
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
          sql`${round.rbtsSettlementReadyAt} is not null`,
          sql`${roundPayoutSnapshot.id} is null`,
        ),
      )
      .orderBy(asc(round.rbtsSettlementReadyAt), asc(round.contentId))
      .limit(SLA_ROW_LIMIT),
  ]);

  return [
    ...questionRewardRows,
    ...launchRows,
    ...bundleRows,
    ...ratingRows,
    ...rbtsRows,
  ] as SourceReadyRow[];
}

export async function buildCorrelationFinalitySla(
  nowSeconds = BigInt(Math.floor(Date.now() / 1000)),
) {
  const [
    roundNormalRows,
    roundAttentionRows,
    epochNormalRows,
    epochAttentionRows,
    sourceReadyRows,
  ] = await Promise.all([
    db
      .select()
      .from(roundPayoutSnapshot)
      .leftJoin(
        questionRewardPool,
        and(
          eq(roundPayoutSnapshot.domain, PAYOUT_DOMAIN_QUESTION_REWARD),
          eq(questionRewardPool.id, roundPayoutSnapshot.rewardPoolId),
          eq(questionRewardPool.contentId, roundPayoutSnapshot.contentId),
        ),
      )
      .where(
        and(
          or(
            eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS.Proposed),
            and(
              eq(roundPayoutSnapshot.status, SNAPSHOT_STATUS.Finalized),
              or(
                sql`${roundPayoutSnapshot.consumedAt} is null`,
                sql`${roundPayoutSnapshot.vetoEndsAt} > ${nowSeconds}`,
              ),
            ),
          ),
          and(
            or(
              sql`${roundPayoutSnapshot.domain} != ${PAYOUT_DOMAIN_QUESTION_REWARD}`,
              sql`${questionRewardPool.id} is null`,
              questionRewardPayoutSnapshotCanQualifyExpression(),
            ),
          ),
        ),
      )
      .orderBy(asc(roundPayoutSnapshot.updatedAt), asc(roundPayoutSnapshot.id))
      .limit(SLA_ROW_LIMIT),
    db
      .select()
      .from(roundPayoutSnapshot)
      .where(
        inArray(roundPayoutSnapshot.status, [
          SNAPSHOT_STATUS.Challenged,
          SNAPSHOT_STATUS.Rejected,
        ]),
      )
      .orderBy(asc(roundPayoutSnapshot.updatedAt), asc(roundPayoutSnapshot.id))
      .limit(SLA_ROW_LIMIT),
    db
      .select()
      .from(correlationEpochSnapshot)
      .where(
        or(
          eq(correlationEpochSnapshot.status, SNAPSHOT_STATUS.Proposed),
          and(
            eq(correlationEpochSnapshot.status, SNAPSHOT_STATUS.Finalized),
            sql`${correlationEpochSnapshot.vetoEndsAt} > ${nowSeconds}`,
          ),
        ),
      )
      .orderBy(
        asc(correlationEpochSnapshot.updatedAt),
        asc(correlationEpochSnapshot.id),
      )
      .limit(SLA_ROW_LIMIT),
    db
      .select()
      .from(correlationEpochSnapshot)
      .where(
        inArray(correlationEpochSnapshot.status, [
          SNAPSHOT_STATUS.Challenged,
          SNAPSHOT_STATUS.Rejected,
        ]),
      )
      .orderBy(
        asc(correlationEpochSnapshot.updatedAt),
        asc(correlationEpochSnapshot.id),
      )
      .limit(SLA_ROW_LIMIT),
    loadSourceReadyUnproposedRows(),
  ]);
  const roundNormalSummary = summarizeRows(
    nowSeconds,
    roundNormalRows as SnapshotRow[],
    0,
  );
  const roundAttentionSummary = summarizeRows(
    nowSeconds,
    roundAttentionRows as SnapshotRow[],
    0,
  );
  const epochNormalSummary = summarizeRows(
    nowSeconds,
    epochNormalRows as SnapshotRow[],
    "correlation_epoch",
    { completeAfterFinalizedVeto: true },
  );
  const epochAttentionSummary = summarizeRows(
    nowSeconds,
    epochAttentionRows as SnapshotRow[],
    "correlation_epoch",
    { completeAfterFinalizedVeto: true },
  );
  const sourceReadySummary = summarizeSourceReadyRows(
    nowSeconds,
    sourceReadyRows,
  );
  const normalBreaches = [
    ...roundNormalSummary.normalBreaches,
    ...epochNormalSummary.normalBreaches,
    ...sourceReadySummary.normalBreaches,
  ];
  const disputedCount =
    roundAttentionSummary.disputedCount + epochAttentionSummary.disputedCount;
  const rejectedCount =
    roundAttentionSummary.rejectedCount + epochAttentionSummary.rejectedCount;

  return {
    status:
      normalBreaches.length > 0
        ? "degraded"
        : disputedCount > 0 || rejectedCount > 0
          ? "attention"
          : "ok",
    now: Number(nowSeconds),
    normalMaxDelaySeconds: NORMAL_MAX_DELAY_SECONDS,
    includesVetoWindow: true,
    rowLimit: SLA_ROW_LIMIT,
    breachCount: normalBreaches.length,
    disputedCount,
    rejectedCount,
    phases: [
      ...sourceReadySummary.buckets,
      ...roundNormalSummary.buckets,
      ...roundAttentionSummary.buckets,
      ...epochNormalSummary.buckets,
      ...epochAttentionSummary.buckets,
    ].sort((a, b) =>
      String(a.domain).localeCompare(String(b.domain)) ||
      a.phase.localeCompare(b.phase),
    ),
  };
}
