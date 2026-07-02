import { inArray } from "ponder";
import { db } from "ponder:api";
import {
  correlationEpochSnapshot,
  roundPayoutSnapshot,
} from "ponder:schema";

const SNAPSHOT_STATUS = {
  Proposed: 1,
  Challenged: 2,
  Finalized: 3,
  Rejected: 4,
} as const;

const NORMAL_MAX_DELAY_SECONDS = 60 * 60;
const SLA_ROW_LIMIT = 1_000;

type SnapshotRow = Record<string, unknown>;

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

function classifySnapshot(row: SnapshotRow, now: bigint) {
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
    const consumedAt = toBigInt(row.consumedAt);
    if (consumedAt !== null) {
      return {
        phase: "consumed",
        since: consumedAt,
        estimatedReadyAt: consumedAt,
        normalPath: false,
      };
    }
    const vetoEndsAt = toBigInt(row.vetoEndsAt);
    if (vetoEndsAt !== null && now < vetoEndsAt) {
      return {
        phase: "finalization_veto",
        since: row.finalizedAt ?? row.updatedAt,
        estimatedReadyAt: vetoEndsAt,
        normalPath: true,
      };
    }
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
) {
  const agesByBucket = new Map<string, number[]>();
  const readyAtByBucket = new Map<string, Array<number | null>>();
  const normalBreaches: Array<{ domain: number | "correlation_epoch"; phase: string }> = [];
  let disputedCount = 0;
  let rejectedCount = 0;

  for (const row of rows) {
    const classification = classifySnapshot(row, now);
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

export async function buildCorrelationFinalitySla(
  nowSeconds = BigInt(Math.floor(Date.now() / 1000)),
) {
  const [roundRows, epochRows] = await Promise.all([
    db
      .select()
      .from(roundPayoutSnapshot)
      .where(
        inArray(roundPayoutSnapshot.status, [
          SNAPSHOT_STATUS.Proposed,
          SNAPSHOT_STATUS.Challenged,
          SNAPSHOT_STATUS.Finalized,
          SNAPSHOT_STATUS.Rejected,
        ]),
      )
      .limit(SLA_ROW_LIMIT),
    db
      .select()
      .from(correlationEpochSnapshot)
      .where(
        inArray(correlationEpochSnapshot.status, [
          SNAPSHOT_STATUS.Proposed,
          SNAPSHOT_STATUS.Challenged,
          SNAPSHOT_STATUS.Finalized,
          SNAPSHOT_STATUS.Rejected,
        ]),
      )
      .limit(SLA_ROW_LIMIT),
  ]);
  const roundSummary = summarizeRows(
    nowSeconds,
    roundRows as SnapshotRow[],
    0,
  );
  const epochSummary = summarizeRows(
    nowSeconds,
    epochRows as SnapshotRow[],
    "correlation_epoch",
  );
  const normalBreaches = [
    ...roundSummary.normalBreaches,
    ...epochSummary.normalBreaches,
  ];
  const disputedCount = roundSummary.disputedCount + epochSummary.disputedCount;
  const rejectedCount = roundSummary.rejectedCount + epochSummary.rejectedCount;

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
    phases: [...roundSummary.buckets, ...epochSummary.buckets].sort((a, b) =>
      String(a.domain).localeCompare(String(b.domain)) ||
      a.phase.localeCompare(b.phase),
    ),
  };
}
