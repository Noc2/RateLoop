import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { getAddress } from "viem";
import { normalizeAccountSubject } from "~~/lib/auth/accountSubject";
import { dbPool } from "~~/lib/db";
import {
  type ForecastCalibrationAccumulator,
  type ForecastPairAccumulator,
  appendForecastCalibration,
  appendForecastPair,
  emptyForecastCalibrationAccumulator,
  emptyForecastPairAccumulator,
  evaluateForecastCalibration,
  evaluateForecastPair,
  forecastConsequence,
  workspaceHistogramExpectedExactMatchBps,
} from "~~/lib/tokenless/crowdForecastIntegrity";
import { integrityReviewerLookup } from "~~/lib/tokenless/integrityEpochs";
import { tokenlessCommitKey } from "~~/lib/tokenless/rater/settlementRecovery";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

type Row = Record<string, unknown>;
export type ForecastSubjectSpace = "invited_workspace" | "network_rater";
export type ForecastAppealReason = "context_missing" | "shared_process" | "measurement_error" | "other";
export type ForecastAppealResolutionStatus = "accepted" | "rejected";

type ForecastSubject = {
  subjectSpace: ForecastSubjectSpace;
  subjectKey: string;
  keyVersion: string;
  workspaceId: string | null;
  raterId: string | null;
};

type ForecastBatchEntry = ForecastSubject & {
  predictedPositiveBps: number;
  vote: 0 | 1;
};

const HARD_REASON_CODES = new Set(["forecast_invariant", "forecast_discrimination_absent", "forecast_pair_lockstep"]);
const APPEAL_REASONS = new Set<ForecastAppealReason>([
  "context_missing",
  "shared_process",
  "measurement_error",
  "other",
]);
const APPEAL_ID_PATTERN = /^cfa_[a-f0-9]{32}$/u;
const FINDING_ID_PATTERN = /^cff_[a-f0-9]{32}$/u;
const FORECAST_RESTRICTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

function text(row: Row | undefined, key: string) {
  const value = row?.[key];
  return value === null || value === undefined ? null : String(value);
}

function numeric(row: Row | undefined, key: string) {
  const value = text(row, key);
  if (value === null || !/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new Error(`Stored ${key} is invalid.`);
  return BigInt(value);
}

function reasonCodes(value: unknown) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? "[]"));
  } catch {
    throw new Error("Stored crowd forecast reason codes are invalid.");
  }
  if (!Array.isArray(parsed) || parsed.some(code => typeof code !== "string")) {
    throw new Error("Stored crowd forecast reason codes are invalid.");
  }
  return parsed as string[];
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeBatchEntries(entries: readonly ForecastBatchEntry[]) {
  const unique = new Map<string, ForecastBatchEntry>();
  for (const entry of entries) {
    const identity = `${entry.subjectSpace}\0${entry.subjectKey}`;
    const previous = unique.get(identity);
    if (previous && (previous.predictedPositiveBps !== entry.predictedPositiveBps || previous.vote !== entry.vote)) {
      throw new TokenlessServiceError(
        "A terminal review set contains conflicting forecasts for one reviewer.",
        409,
        "forecast_integrity_duplicate_subject",
      );
    }
    unique.set(identity, previous ?? entry);
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.subjectSpace.localeCompare(right.subjectSpace) || left.subjectKey.localeCompare(right.subjectKey),
  );
}

function optionalPrivateForecast(row: Row) {
  if (row.predicted_positive_bps === null || row.predicted_positive_bps === undefined) return null;
  const prediction = Number(row.predicted_positive_bps);
  return Number.isSafeInteger(prediction) ? prediction : null;
}

function runtimeFromEncoded(version: string | undefined, encoded: string | undefined) {
  const normalizedVersion = version?.trim();
  const normalizedEncoded = encoded?.trim();
  const key = normalizedEncoded ? Buffer.from(normalizedEncoded, "base64url") : Buffer.alloc(0);
  if (!normalizedVersion || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(normalizedVersion) || key.byteLength < 32) {
    throw new TokenlessServiceError(
      "Crowd forecast integrity is unavailable.",
      503,
      "forecast_integrity_unavailable",
      true,
    );
  }
  return { key, version: normalizedVersion };
}

function lookupRuntimeKeyring(env: NodeJS.ProcessEnv = process.env) {
  if (
    env.NEXT_PUBLIC_TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY ||
    env.NEXT_PUBLIC_TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEYS_JSON
  ) {
    throw new Error("The integrity reviewer lookup key must never be public.");
  }
  const current = runtimeFromEncoded(
    env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION,
    env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY,
  );
  const runtimes = new Map<string, { key: Buffer; version: string }>([[current.version, current]]);
  const encodedKeyring = env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEYS_JSON?.trim();
  if (!encodedKeyring) return { current, runtimes };
  let parsed: unknown;
  try {
    parsed = JSON.parse(encodedKeyring);
  } catch {
    throw new TokenlessServiceError(
      "Crowd forecast integrity is unavailable.",
      503,
      "forecast_integrity_unavailable",
      true,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TokenlessServiceError(
      "Crowd forecast integrity is unavailable.",
      503,
      "forecast_integrity_unavailable",
      true,
    );
  }
  for (const [version, encoded] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof encoded !== "string") {
      throw new TokenlessServiceError(
        "Crowd forecast integrity is unavailable.",
        503,
        "forecast_integrity_unavailable",
        true,
      );
    }
    const runtime = runtimeFromEncoded(version, encoded);
    const existing = runtimes.get(runtime.version);
    if (existing && !existing.key.equals(runtime.key)) {
      throw new TokenlessServiceError(
        "Crowd forecast integrity is unavailable.",
        503,
        "forecast_integrity_unavailable",
        true,
      );
    }
    runtimes.set(runtime.version, runtime);
  }
  return { current, runtimes };
}

function lookupRuntime(env: NodeJS.ProcessEnv = process.env) {
  return lookupRuntimeKeyring(env).current;
}

function invitedSubjectForVersion(input: {
  workspaceId: string;
  principalId: string;
  keyVersion: string;
  keyring: ReturnType<typeof lookupRuntimeKeyring>;
}) {
  const runtime = input.keyring.runtimes.get(input.keyVersion);
  if (!runtime) {
    throw new TokenlessServiceError(
      "Crowd forecast integrity is unavailable until the configured keyring includes all retained key versions.",
      503,
      "forecast_integrity_key_version_unavailable",
      true,
    );
  }
  return invitedForecastSubject({
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    key: runtime.key,
    keyVersion: runtime.version,
  });
}

export function invitedForecastSubject(input: {
  workspaceId: string;
  principalId: string;
  key?: Buffer;
  keyVersion?: string;
}): ForecastSubject {
  const runtime =
    input.key && input.keyVersion ? { key: input.key, version: input.keyVersion } : lookupRuntime(process.env);
  return {
    subjectSpace: "invited_workspace",
    subjectKey: integrityReviewerLookup({
      key: runtime.key,
      reviewerId: `forecast-invited:v1:${input.workspaceId}:${input.principalId}`,
    }),
    keyVersion: runtime.version,
    workspaceId: input.workspaceId,
    raterId: null,
  };
}

export function networkForecastSubject(raterId: string): ForecastSubject {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/u.test(raterId)) throw new Error("Network rater identity is invalid.");
  return {
    subjectSpace: "network_rater",
    subjectKey: raterId,
    keyVersion: "rater-id-v1",
    workspaceId: null,
    raterId,
  };
}

function calibrationFromRow(row: Row | undefined): ForecastCalibrationAccumulator {
  if (!row) return emptyForecastCalibrationAccumulator();
  return {
    observationCount: numeric(row, "observation_count"),
    outcomeObservationCount: numeric(row, "outcome_observation_count"),
    forecastSumBps: numeric(row, "forecast_sum_bps"),
    forecastSquareSum: numeric(row, "forecast_square_sum"),
    squaredErrorSum: numeric(row, "squared_error_sum"),
    outcomePositiveCount: numeric(row, "outcome_positive_count"),
    positiveOutcomeForecastSumBps: numeric(row, "positive_outcome_forecast_sum_bps"),
    positiveOutcomeCount: numeric(row, "positive_outcome_count"),
    negativeOutcomeForecastSumBps: numeric(row, "negative_outcome_forecast_sum_bps"),
    negativeOutcomeCount: numeric(row, "negative_outcome_count"),
    positiveVoteForecastSumBps: numeric(row, "positive_vote_forecast_sum_bps"),
    positiveVoteCount: numeric(row, "positive_vote_count"),
    negativeVoteForecastSumBps: numeric(row, "negative_vote_forecast_sum_bps"),
    negativeVoteCount: numeric(row, "negative_vote_count"),
  };
}

function pairFromRow(row: Row | undefined): ForecastPairAccumulator {
  if (!row) return emptyForecastPairAccumulator();
  return {
    observationCount: numeric(row, "observation_count"),
    exactMatchCount: numeric(row, "exact_match_count"),
    expectedExactMatchBpsSum: numeric(row, "expected_exact_match_bps_sum"),
    distanceSumBps: numeric(row, "distance_sum_bps"),
    distanceSquareSum: numeric(row, "distance_square_sum"),
  };
}

async function appendFinding(
  client: PoolClient,
  input: {
    subject: ForecastSubject;
    peerSubjectKey?: string;
    reasonCode: string;
    sourceObservationCount: bigint;
    evidence: unknown;
    now: Date;
  },
) {
  const hard = HARD_REASON_CODES.has(input.reasonCode);
  const dedupeKey = `sha256:${digest(
    stableJson({
      schemaVersion: "rateloop.crowd-forecast-finding-key.v1",
      subjectSpace: input.subject.subjectSpace,
      subjectKey: input.subject.subjectKey,
      peerSubjectKey: input.peerSubjectKey ?? null,
      reasonCode: input.reasonCode,
      sourceObservationCount: input.sourceObservationCount.toString(10),
    }),
  )}`;
  await client.query(
    `INSERT INTO tokenless_forecast_integrity_findings
     (finding_id,dedupe_key,subject_space,subject_key,workspace_id,peer_subject_key,
      reason_code,severity,source_observation_count,evidence_counters_json,payout_effect,consequence,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'none',$11,$12)
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [
      `cff_${randomUUID().replaceAll("-", "")}`,
      dedupeKey,
      input.subject.subjectSpace,
      input.subject.subjectKey,
      input.subject.workspaceId,
      input.peerSubjectKey ?? null,
      input.reasonCode,
      hard ? "hard" : "soft",
      input.sourceObservationCount.toString(10),
      stableJson(input.evidence),
      hard ? "future_assignment_restriction" : "none",
      input.now,
    ],
  );
}

async function appendCalibration(
  client: PoolClient,
  input: { entry: ForecastBatchEntry; outcome: 0 | 1 | null; now: Date },
) {
  await client.query(
    `UPDATE tokenless_forecast_calibration_accumulators
     SET observation_count=0,outcome_observation_count=0,forecast_sum_bps=0,
         forecast_square_sum=0,squared_error_sum=0,outcome_positive_count=0,
         positive_outcome_forecast_sum_bps=0,positive_outcome_count=0,
         negative_outcome_forecast_sum_bps=0,negative_outcome_count=0,
         positive_vote_forecast_sum_bps=0,positive_vote_count=0,
         negative_vote_forecast_sum_bps=0,negative_vote_count=0,
         current_reason_codes_json='[]',updated_at=$1
     WHERE subject_space=$2 AND subject_key=$3 AND updated_at<=$4`,
    [
      input.now,
      input.entry.subjectSpace,
      input.entry.subjectKey,
      new Date(input.now.getTime() - FORECAST_RESTRICTION_WINDOW_MS),
    ],
  );
  const delta = appendForecastCalibration(emptyForecastCalibrationAccumulator(), {
    predictedPositiveBps: input.entry.predictedPositiveBps,
    outcome: input.outcome,
    vote: input.entry.vote,
  });
  const result = await client.query(
    `INSERT INTO tokenless_forecast_calibration_accumulators
     (subject_space,subject_key,key_version,workspace_id,rater_id,observation_count,outcome_observation_count,
      forecast_sum_bps,forecast_square_sum,squared_error_sum,outcome_positive_count,
      positive_outcome_forecast_sum_bps,positive_outcome_count,negative_outcome_forecast_sum_bps,
      negative_outcome_count,positive_vote_forecast_sum_bps,positive_vote_count,
      negative_vote_forecast_sum_bps,negative_vote_count,current_reason_codes_json,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'[]',$20)
     ON CONFLICT (subject_space,subject_key) DO UPDATE SET
       observation_count=tokenless_forecast_calibration_accumulators.observation_count+EXCLUDED.observation_count,
       outcome_observation_count=tokenless_forecast_calibration_accumulators.outcome_observation_count+EXCLUDED.outcome_observation_count,
       forecast_sum_bps=tokenless_forecast_calibration_accumulators.forecast_sum_bps+EXCLUDED.forecast_sum_bps,
       forecast_square_sum=tokenless_forecast_calibration_accumulators.forecast_square_sum+EXCLUDED.forecast_square_sum,
       squared_error_sum=tokenless_forecast_calibration_accumulators.squared_error_sum+EXCLUDED.squared_error_sum,
       outcome_positive_count=tokenless_forecast_calibration_accumulators.outcome_positive_count+EXCLUDED.outcome_positive_count,
       positive_outcome_forecast_sum_bps=tokenless_forecast_calibration_accumulators.positive_outcome_forecast_sum_bps+EXCLUDED.positive_outcome_forecast_sum_bps,
       positive_outcome_count=tokenless_forecast_calibration_accumulators.positive_outcome_count+EXCLUDED.positive_outcome_count,
       negative_outcome_forecast_sum_bps=tokenless_forecast_calibration_accumulators.negative_outcome_forecast_sum_bps+EXCLUDED.negative_outcome_forecast_sum_bps,
       negative_outcome_count=tokenless_forecast_calibration_accumulators.negative_outcome_count+EXCLUDED.negative_outcome_count,
       positive_vote_forecast_sum_bps=tokenless_forecast_calibration_accumulators.positive_vote_forecast_sum_bps+EXCLUDED.positive_vote_forecast_sum_bps,
       positive_vote_count=tokenless_forecast_calibration_accumulators.positive_vote_count+EXCLUDED.positive_vote_count,
       negative_vote_forecast_sum_bps=tokenless_forecast_calibration_accumulators.negative_vote_forecast_sum_bps+EXCLUDED.negative_vote_forecast_sum_bps,
       negative_vote_count=tokenless_forecast_calibration_accumulators.negative_vote_count+EXCLUDED.negative_vote_count,
       updated_at=EXCLUDED.updated_at
     RETURNING *`,
    [
      input.entry.subjectSpace,
      input.entry.subjectKey,
      input.entry.keyVersion,
      input.entry.workspaceId,
      input.entry.raterId,
      delta.observationCount.toString(10),
      delta.outcomeObservationCount.toString(10),
      delta.forecastSumBps.toString(10),
      delta.forecastSquareSum.toString(10),
      delta.squaredErrorSum.toString(10),
      delta.outcomePositiveCount.toString(10),
      delta.positiveOutcomeForecastSumBps.toString(10),
      delta.positiveOutcomeCount.toString(10),
      delta.negativeOutcomeForecastSumBps.toString(10),
      delta.negativeOutcomeCount.toString(10),
      delta.positiveVoteForecastSumBps.toString(10),
      delta.positiveVoteCount.toString(10),
      delta.negativeVoteForecastSumBps.toString(10),
      delta.negativeVoteCount.toString(10),
      input.now,
    ],
  );
  const row = result.rows[0] as Row;
  const previousReasons = reasonCodes(row.current_reason_codes_json);
  const accumulator = calibrationFromRow(row);
  const evaluation = evaluateForecastCalibration(accumulator);
  for (const code of evaluation.reasonCodes.filter(code => !previousReasons.includes(code))) {
    await appendFinding(client, {
      subject: input.entry,
      reasonCode: code,
      sourceObservationCount: accumulator.observationCount,
      evidence: evaluation,
      now: input.now,
    });
  }
  await client.query(
    `UPDATE tokenless_forecast_calibration_accumulators
     SET current_reason_codes_json=$1 WHERE subject_space=$2 AND subject_key=$3`,
    [stableJson(evaluation.reasonCodes), input.entry.subjectSpace, input.entry.subjectKey],
  );
}

function histogramFromRow(row: Row | undefined) {
  if (!row) return Array<bigint>(99).fill(0n);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(row, "buckets_json") ?? "[]");
  } catch {
    throw new Error("Stored workspace forecast histogram is invalid.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 99 ||
    parsed.some(value => typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value))
  ) {
    throw new Error("Stored workspace forecast histogram is invalid.");
  }
  return parsed.map(value => BigInt(value as string));
}

async function lockHistogram(
  client: PoolClient,
  input: { workspaceId: string; subjectSpace: ForecastSubjectSpace; now: Date },
) {
  await client.query(
    `INSERT INTO tokenless_forecast_workspace_histograms
     (workspace_id,subject_space,observation_count,buckets_json,updated_at)
     VALUES ($1,$2,0,$3,$4) ON CONFLICT (workspace_id,subject_space) DO NOTHING`,
    [input.workspaceId, input.subjectSpace, stableJson(Array<string>(99).fill("0")), input.now],
  );
  const result = await client.query(
    `SELECT * FROM tokenless_forecast_workspace_histograms
     WHERE workspace_id=$1 AND subject_space=$2 FOR UPDATE`,
    [input.workspaceId, input.subjectSpace],
  );
  return histogramFromRow(result.rows[0] as Row | undefined);
}

async function appendPair(
  client: PoolClient,
  input: {
    workspaceId: string;
    left: ForecastBatchEntry;
    right: ForecastBatchEntry;
    expectedExactMatchBps: number;
    now: Date;
  },
) {
  const [left, right] =
    input.left.subjectKey < input.right.subjectKey ? [input.left, input.right] : [input.right, input.left];
  await client.query(
    `UPDATE tokenless_forecast_pair_accumulators
     SET observation_count=0,exact_match_count=0,expected_exact_match_bps_sum=0,
         distance_sum_bps=0,distance_square_sum=0,current_reason_codes_json='[]',updated_at=$1
     WHERE workspace_id=$2 AND subject_space=$3 AND left_subject_key=$4
       AND right_subject_key=$5 AND updated_at<=$6`,
    [
      input.now,
      input.workspaceId,
      left.subjectSpace,
      left.subjectKey,
      right.subjectKey,
      new Date(input.now.getTime() - FORECAST_RESTRICTION_WINDOW_MS),
    ],
  );
  const delta = appendForecastPair(emptyForecastPairAccumulator(), {
    leftForecastBps: left.predictedPositiveBps,
    rightForecastBps: right.predictedPositiveBps,
    expectedExactMatchBps: input.expectedExactMatchBps,
  });
  const result = await client.query(
    `INSERT INTO tokenless_forecast_pair_accumulators
     (workspace_id,subject_space,left_subject_key,right_subject_key,observation_count,exact_match_count,
      expected_exact_match_bps_sum,distance_sum_bps,distance_square_sum,current_reason_codes_json,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'[]',$10)
     ON CONFLICT (workspace_id,subject_space,left_subject_key,right_subject_key) DO UPDATE SET
       observation_count=tokenless_forecast_pair_accumulators.observation_count+EXCLUDED.observation_count,
       exact_match_count=tokenless_forecast_pair_accumulators.exact_match_count+EXCLUDED.exact_match_count,
       expected_exact_match_bps_sum=tokenless_forecast_pair_accumulators.expected_exact_match_bps_sum+EXCLUDED.expected_exact_match_bps_sum,
       distance_sum_bps=tokenless_forecast_pair_accumulators.distance_sum_bps+EXCLUDED.distance_sum_bps,
       distance_square_sum=tokenless_forecast_pair_accumulators.distance_square_sum+EXCLUDED.distance_square_sum,
       updated_at=EXCLUDED.updated_at
     RETURNING *`,
    [
      input.workspaceId,
      left.subjectSpace,
      left.subjectKey,
      right.subjectKey,
      delta.observationCount.toString(10),
      delta.exactMatchCount.toString(10),
      delta.expectedExactMatchBpsSum.toString(10),
      delta.distanceSumBps.toString(10),
      delta.distanceSquareSum.toString(10),
      input.now,
    ],
  );
  const row = result.rows[0] as Row;
  const previousReasons = reasonCodes(row.current_reason_codes_json);
  const accumulator = pairFromRow(row);
  const evaluation = evaluateForecastPair(accumulator);
  if (
    evaluation.reasonCodes.includes("forecast_pair_lockstep") &&
    !previousReasons.includes("forecast_pair_lockstep")
  ) {
    for (const [subject, peer] of [
      [left, right],
      [right, left],
    ] as const) {
      await appendFinding(client, {
        subject: { ...subject, workspaceId: input.workspaceId },
        peerSubjectKey: peer.subjectKey,
        reasonCode: "forecast_pair_lockstep",
        sourceObservationCount: accumulator.observationCount,
        evidence: evaluation,
        now: input.now,
      });
    }
  }
  await client.query(
    `UPDATE tokenless_forecast_pair_accumulators SET current_reason_codes_json=$1
     WHERE workspace_id=$2 AND subject_space=$3 AND left_subject_key=$4 AND right_subject_key=$5`,
    [stableJson(evaluation.reasonCodes), input.workspaceId, left.subjectSpace, left.subjectKey, right.subjectKey],
  );
}

async function aggregateBatch(
  client: PoolClient,
  input: { workspaceId: string; entries: ForecastBatchEntry[]; outcome: 0 | 1 | null; now: Date },
) {
  const orderedEntries = normalizeBatchEntries(input.entries);
  for (const entry of orderedEntries) {
    await appendCalibration(client, { entry, outcome: input.outcome, now: input.now });
  }
  for (const subjectSpace of ["invited_workspace", "network_rater"] as const) {
    const entries = orderedEntries.filter(entry => entry.subjectSpace === subjectSpace);
    if (entries.length === 0) continue;
    const histogram = await lockHistogram(client, {
      workspaceId: input.workspaceId,
      subjectSpace,
      now: input.now,
    });
    const expectedExactMatchBps = workspaceHistogramExpectedExactMatchBps(histogram);
    for (let left = 0; left < entries.length; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        if (entries[left]!.subjectKey === entries[right]!.subjectKey) continue;
        await appendPair(client, {
          workspaceId: input.workspaceId,
          left: entries[left]!,
          right: entries[right]!,
          expectedExactMatchBps,
          now: input.now,
        });
      }
    }
    for (const entry of entries) histogram[entry.predictedPositiveBps / 100 - 1] += 1n;
    await client.query(
      `UPDATE tokenless_forecast_workspace_histograms
       SET observation_count=observation_count+$1,buckets_json=$2,updated_at=$3
       WHERE workspace_id=$4 AND subject_space=$5`,
      [
        entries.length,
        stableJson(histogram.map(value => value.toString(10))),
        input.now,
        input.workspaceId,
        subjectSpace,
      ],
    );
  }
}

async function claimTerminalReceipt(
  client: PoolClient,
  input: {
    lane: "private_invited" | "public_paid";
    terminalKey: string;
    workspaceId: string;
    sourceSetCommitment: string;
    forecastCount: number;
    now: Date;
  },
) {
  const prior = await client.query(
    `SELECT workspace_id,source_set_commitment,aggregated_forecast_count
     FROM tokenless_forecast_integrity_terminal_receipts WHERE lane=$1 AND terminal_key=$2 FOR UPDATE`,
    [input.lane, input.terminalKey],
  );
  const priorRow = prior.rows[0] as Row | undefined;
  if (priorRow) {
    if (
      text(priorRow, "workspace_id") !== input.workspaceId ||
      text(priorRow, "source_set_commitment") !== input.sourceSetCommitment ||
      Number(priorRow.aggregated_forecast_count) !== input.forecastCount
    ) {
      throw new TokenlessServiceError(
        "Crowd forecast terminal evidence conflicts with its prior aggregation.",
        409,
        "forecast_integrity_terminal_conflict",
      );
    }
    return false;
  }
  const inserted = await client.query(
    `INSERT INTO tokenless_forecast_integrity_terminal_receipts
     (lane,terminal_key,workspace_id,source_set_commitment,aggregated_forecast_count,processed_at)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (lane,terminal_key) DO NOTHING RETURNING terminal_key`,
    [input.lane, input.terminalKey, input.workspaceId, input.sourceSetCommitment, input.forecastCount, input.now],
  );
  if (inserted.rows.length === 1) return true;
  const existing = await client.query(
    `SELECT workspace_id,source_set_commitment,aggregated_forecast_count
     FROM tokenless_forecast_integrity_terminal_receipts WHERE lane=$1 AND terminal_key=$2 FOR UPDATE`,
    [input.lane, input.terminalKey],
  );
  const row = existing.rows[0] as Row | undefined;
  if (
    text(row, "workspace_id") !== input.workspaceId ||
    text(row, "source_set_commitment") !== input.sourceSetCommitment ||
    Number(row?.aggregated_forecast_count) !== input.forecastCount
  ) {
    throw new TokenlessServiceError(
      "Crowd forecast terminal evidence conflicts with its prior aggregation.",
      409,
      "forecast_integrity_terminal_conflict",
    );
  }
  return false;
}

export async function aggregatePrivateForecastDeliveryInTransaction(
  client: PoolClient,
  input: {
    deliveryId: string;
    workspaceId: string;
    outcome: "positive" | "negative" | "inconclusive" | "failed" | "cancelled";
    sourceSetCommitment: string;
    now: Date;
  },
) {
  const priorReceipt = await client.query(
    `SELECT workspace_id,source_set_commitment,aggregated_forecast_count
     FROM tokenless_forecast_integrity_terminal_receipts
     WHERE lane='private_invited' AND terminal_key=$1 FOR UPDATE`,
    [input.deliveryId],
  );
  const priorRow = priorReceipt.rows[0] as Row | undefined;
  if (priorRow) {
    if (
      text(priorRow, "workspace_id") !== input.workspaceId ||
      text(priorRow, "source_set_commitment") !== input.sourceSetCommitment
    ) {
      throw new TokenlessServiceError(
        "Crowd forecast terminal evidence conflicts with its prior aggregation.",
        409,
        "forecast_integrity_terminal_conflict",
      );
    }
    return { aggregated: false, forecastCount: Number(priorRow.aggregated_forecast_count) };
  }
  const responseResult = await client.query(
    `SELECT response.predicted_positive_bps,response.choice,assignment.reviewer_account_address
     FROM tokenless_private_review_responses response
     JOIN tokenless_private_unpaid_review_assignments assignment
       ON assignment.assignment_id=response.assignment_id
     WHERE response.delivery_id=$1 ORDER BY response.response_commitment`,
    [input.deliveryId],
  );
  let runtime: ReturnType<typeof lookupRuntime> | null = null;
  const entries = normalizeBatchEntries(
    (responseResult.rows as Row[]).flatMap(row => {
      const prediction = optionalPrivateForecast(row);
      const principalId = text(row, "reviewer_account_address");
      const choice = text(row, "choice");
      if (!principalId || prediction === null) return [];
      runtime ??= lookupRuntime();
      const subject = invitedForecastSubject({
        workspaceId: input.workspaceId,
        principalId,
        key: runtime.key,
        keyVersion: runtime.version,
      });
      return [
        { ...subject, predictedPositiveBps: prediction, vote: choice === "positive" ? (1 as const) : (0 as const) },
      ];
    }),
  );
  const claimed = await claimTerminalReceipt(client, {
    lane: "private_invited",
    terminalKey: input.deliveryId,
    workspaceId: input.workspaceId,
    sourceSetCommitment: input.sourceSetCommitment,
    forecastCount: entries.length,
    now: input.now,
  });
  if (!claimed) return { aggregated: false, forecastCount: entries.length };
  await aggregateBatch(client, {
    workspaceId: input.workspaceId,
    entries,
    outcome: input.outcome === "positive" ? 1 : input.outcome === "negative" ? 0 : null,
    now: input.now,
  });
  await client.query(
    `UPDATE tokenless_private_review_responses SET predicted_positive_bps=NULL
     WHERE delivery_id=$1 AND predicted_positive_bps IS NOT NULL`,
    [input.deliveryId],
  );
  return { aggregated: true, forecastCount: entries.length };
}

export async function aggregatePublicForecastRound(input: {
  operationKey: string;
  deploymentKey: string;
  roundId: string;
  sourceSetCommitment: string;
  upVotes: number;
  reveals: Array<{ commitKey: string; predictedUpBps: number; vote: 0 | 1 }>;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const context = await client.query(
      `SELECT ownership.workspace_id,execution.deployment_key,execution.chain_id,execution.panel_address
       FROM tokenless_ask_ownership ownership
       JOIN tokenless_chain_executions execution ON execution.operation_key=ownership.operation_key
       WHERE ownership.operation_key=$1 AND execution.round_id=$2 LIMIT 1 FOR SHARE`,
      [input.operationKey, input.roundId],
    );
    const contextRow = context.rows[0] as Row | undefined;
    const workspaceId = text(contextRow, "workspace_id");
    const chainId = text(contextRow, "chain_id");
    const panelAddress = text(contextRow, "panel_address");
    if (!workspaceId || !chainId || !panelAddress || text(contextRow, "deployment_key") !== input.deploymentKey) {
      throw new TokenlessServiceError("Public forecast round identity is invalid.", 409, "forecast_round_mismatch");
    }
    const vouchers = await client.query(
      `SELECT voucher.rater_id,profile.principal_id,voucher.vote_key,snapshot.reviewer_source
       FROM tokenless_paid_vouchers voucher
       JOIN tokenless_rater_profiles profile ON profile.rater_id=voucher.rater_id
       JOIN tokenless_voucher_assurance_snapshots snapshot ON snapshot.voucher_id=voucher.voucher_id
       WHERE voucher.round_id=$1
         AND voucher.chain_id=$2
         AND LOWER(voucher.panel_address)=LOWER($3)`,
      [input.roundId, chainId, panelAddress],
    );
    const byCommitKey = new Map(input.reveals.map(reveal => [reveal.commitKey.toLowerCase(), reveal]));
    let invitedRuntime: ReturnType<typeof lookupRuntime> | null = null;
    const rawEntries: ForecastBatchEntry[] = [];
    for (const row of vouchers.rows as Row[]) {
      const voteKey = text(row, "vote_key");
      if (!voteKey) continue;
      const commitKey = tokenlessCommitKey(BigInt(input.roundId), getAddress(voteKey)).toLowerCase();
      const reveal = byCommitKey.get(commitKey);
      if (!reveal) continue;
      const reviewerSource = text(row, "reviewer_source");
      const raterId = text(row, "rater_id");
      const principalId = text(row, "principal_id");
      const subject =
        reviewerSource === "rateloop_network" && raterId
          ? networkForecastSubject(raterId)
          : reviewerSource === "customer_invited" && principalId
            ? (() => {
                invitedRuntime ??= lookupRuntime();
                return invitedForecastSubject({
                  workspaceId,
                  principalId,
                  key: invitedRuntime.key,
                  keyVersion: invitedRuntime.version,
                });
              })()
            : null;
      if (subject) rawEntries.push({ ...subject, predictedPositiveBps: reveal.predictedUpBps, vote: reveal.vote });
    }
    const entries = normalizeBatchEntries(rawEntries);
    const claimed = await claimTerminalReceipt(client, {
      lane: "public_paid",
      terminalKey: `${input.deploymentKey}:${input.roundId}`,
      workspaceId,
      sourceSetCommitment: input.sourceSetCommitment,
      forecastCount: entries.length,
      now,
    });
    if (claimed) {
      await aggregateBatch(client, {
        workspaceId,
        entries,
        outcome:
          input.reveals.length === 0 || input.upVotes * 2 === input.reveals.length
            ? null
            : input.upVotes * 2 > input.reveals.length
              ? 1
              : 0,
        now,
      });
    }
    await client.query("COMMIT");
    return { aggregated: claimed, forecastCount: entries.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function invitedSubjectsForPrincipal(client: PoolClient, input: { principalId: string; workspaceId?: string }) {
  const workspaceRows = await client.query(
    `SELECT DISTINCT workspace_id,key_version
     FROM tokenless_forecast_calibration_accumulators
     WHERE subject_space='invited_workspace' AND workspace_id IS NOT NULL
       AND ($1::text IS NULL OR workspace_id=$1)
     ORDER BY workspace_id,key_version`,
    [input.workspaceId ?? null],
  );
  if (workspaceRows.rows.length === 0) return [];
  const keyring = lookupRuntimeKeyring();
  return (workspaceRows.rows as Row[]).flatMap(row => {
    const workspaceId = text(row, "workspace_id");
    const keyVersion = text(row, "key_version");
    return workspaceId && keyVersion
      ? [
          invitedSubjectForVersion({
            workspaceId,
            principalId: input.principalId,
            keyVersion,
            keyring,
          }),
        ]
      : [];
  });
}

async function subjectsForPrincipal(client: PoolClient, principalId: string) {
  const invited = await invitedSubjectsForPrincipal(client, { principalId });
  const rater = await client.query(
    "SELECT rater_id FROM tokenless_rater_profiles WHERE principal_id=$1 AND deleted_at IS NULL LIMIT 1",
    [principalId],
  );
  const raterId = text(rater.rows[0] as Row | undefined, "rater_id");
  return raterId ? [...invited, networkForecastSubject(raterId)] : invited;
}

type ActiveForecastRestriction = {
  findingId: string | null;
  openAppealId: string | null;
  peerSubjectKey: string | null;
  reasonCode: string;
  workspaceId: string | null;
};

async function activeForecastRestrictions(
  client: PoolClient,
  input: { subject: ForecastSubject; workspaceId?: string; now?: Date },
): Promise<ActiveForecastRestriction[]> {
  const restrictionCutoff = new Date((input.now ?? new Date()).getTime() - FORECAST_RESTRICTION_WINDOW_MS);
  const calibration = await client.query(
    `SELECT current_reason_codes_json FROM tokenless_forecast_calibration_accumulators
     WHERE subject_space=$1 AND subject_key=$2 LIMIT 1`,
    [input.subject.subjectSpace, input.subject.subjectKey],
  );
  const pairs = input.workspaceId
    ? await client.query(
        `SELECT workspace_id,left_subject_key,right_subject_key,current_reason_codes_json
         FROM tokenless_forecast_pair_accumulators
         WHERE workspace_id=$1 AND subject_space=$2
           AND (left_subject_key=$3 OR right_subject_key=$3)`,
        [input.workspaceId, input.subject.subjectSpace, input.subject.subjectKey],
      )
    : await client.query(
        `SELECT workspace_id,left_subject_key,right_subject_key,current_reason_codes_json
         FROM tokenless_forecast_pair_accumulators
         WHERE subject_space=$1 AND (left_subject_key=$2 OR right_subject_key=$2)`,
        [input.subject.subjectSpace, input.subject.subjectKey],
      );
  const causes = [
    ...reasonCodes((calibration.rows[0] as Row | undefined)?.current_reason_codes_json)
      .filter(code => HARD_REASON_CODES.has(code))
      .map(reasonCode => ({
        peerSubjectKey: null,
        reasonCode,
        workspaceId: input.subject.workspaceId,
      })),
    ...(pairs.rows as Row[]).flatMap(row => {
      const left = text(row, "left_subject_key");
      const right = text(row, "right_subject_key");
      const peerSubjectKey = left === input.subject.subjectKey ? right : left;
      const workspaceId = text(row, "workspace_id");
      if (!peerSubjectKey || !workspaceId) return [];
      return reasonCodes(row.current_reason_codes_json)
        .filter(code => HARD_REASON_CODES.has(code))
        .map(reasonCode => ({ peerSubjectKey, reasonCode, workspaceId }));
    }),
  ];
  const uniqueCauses = new Map<string, (typeof causes)[number]>();
  for (const cause of causes) {
    uniqueCauses.set(`${cause.workspaceId ?? ""}\0${cause.peerSubjectKey ?? ""}\0${cause.reasonCode}`, cause);
  }
  const restrictions: ActiveForecastRestriction[] = [];
  for (const cause of uniqueCauses.values()) {
    const finding = await client.query(
      `SELECT finding.finding_id
       FROM tokenless_forecast_integrity_findings finding
       WHERE finding.subject_space=$1 AND finding.subject_key=$2 AND finding.reason_code=$3
         AND (
           (finding.peer_subject_key IS NULL AND $4::text IS NULL)
           OR finding.peer_subject_key=$4
         )
         AND (
           (finding.workspace_id IS NULL AND $5::text IS NULL)
           OR finding.workspace_id=$5
         )
         AND finding.created_at>$6
       ORDER BY finding.source_observation_count DESC,finding.created_at DESC,finding.finding_id DESC
       LIMIT 1`,
      [
        input.subject.subjectSpace,
        input.subject.subjectKey,
        cause.reasonCode,
        cause.peerSubjectKey,
        cause.workspaceId,
        restrictionCutoff,
      ],
    );
    const findingId = text(finding.rows[0] as Row | undefined, "finding_id");
    if (!findingId) continue;
    const appeals = await client.query(
      `SELECT appeal_id,status
       FROM tokenless_forecast_integrity_appeals
       WHERE finding_id=$1
       ORDER BY opened_at DESC,appeal_id DESC`,
      [findingId],
    );
    if ((appeals.rows as Row[]).some(appeal => text(appeal, "status") === "accepted")) {
      continue;
    }
    restrictions.push({
      ...cause,
      findingId,
      openAppealId: text(
        (appeals.rows as Row[]).find(appeal => text(appeal, "status") === "open"),
        "appeal_id",
      ),
    });
  }
  return restrictions;
}

function restrictionConsequence(reasonCodeList: readonly string[], restrictions: readonly ActiveForecastRestriction[]) {
  return forecastConsequence({
    reasonCodes: reasonCodeList,
    activeHardFindingCount: restrictions.length,
    suspendedHardFindingCount: restrictions.filter(restriction => restriction.openAppealId !== null).length,
  });
}

export async function isForecastAssignmentRestricted(
  client: PoolClient,
  input: { subject: ForecastSubject; workspaceId?: string },
) {
  const restrictions = await activeForecastRestrictions(client, input);
  return restrictions.some(restriction => restriction.openAppealId === null);
}

export async function assertForecastAssignmentEligible(input: { subject: ForecastSubject; workspaceId?: string }) {
  const client = await dbPool.connect();
  try {
    if (await isForecastAssignmentRestricted(client, input)) {
      throw new TokenlessServiceError(
        "New review assignments are paused while crowd forecast integrity needs review.",
        403,
        "forecast_integrity_assignment_restricted",
      );
    }
  } finally {
    client.release();
  }
}

export async function assertPrincipalForecastAssignmentEligible(input: {
  principalId: string;
  raterId?: string;
  reviewerSource: "customer_invited" | "rateloop_network";
  workspaceId?: string;
}) {
  const client = await dbPool.connect();
  try {
    await assertPrincipalForecastAssignmentEligibleInTransaction(client, input);
  } finally {
    client.release();
  }
}

export async function assertPrincipalForecastAssignmentEligibleInTransaction(
  client: PoolClient,
  input: {
    principalId: string;
    raterId?: string;
    reviewerSource: "customer_invited" | "rateloop_network";
    workspaceId?: string;
  },
) {
  if (input.reviewerSource === "customer_invited") {
    if (!input.workspaceId) {
      throw new TokenlessServiceError(
        "Invited reviewer forecast checks require the exact workspace.",
        409,
        "forecast_integrity_workspace_required",
      );
    }
    const subjects = await invitedSubjectsForPrincipal(client, {
      principalId: input.principalId,
      workspaceId: input.workspaceId,
    });
    for (const subject of subjects) {
      if (await isForecastAssignmentRestricted(client, { subject, workspaceId: input.workspaceId })) {
        throw new TokenlessServiceError(
          "New review assignments are paused while crowd forecast integrity needs review.",
          403,
          "forecast_integrity_assignment_restricted",
        );
      }
    }
    return;
  }
  const subject = networkForecastSubject(input.raterId ?? "");
  if (await isForecastAssignmentRestricted(client, { subject, workspaceId: input.workspaceId })) {
    throw new TokenlessServiceError(
      "New review assignments are paused while crowd forecast integrity needs review.",
      403,
      "forecast_integrity_assignment_restricted",
    );
  }
}

export async function listPrincipalForecastIntegrity(principalId: string) {
  const client = await dbPool.connect();
  try {
    return await listPrincipalForecastIntegrityInTransaction(client, principalId);
  } finally {
    client.release();
  }
}

export async function listPrincipalForecastIntegrityInTransaction(client: PoolClient, principalId: string) {
  const subjects = await subjectsForPrincipal(client, principalId);
  const items = [];
  for (const subject of subjects) {
    const accumulatorResult = await client.query(
      `SELECT * FROM tokenless_forecast_calibration_accumulators
         WHERE subject_space=$1 AND subject_key=$2 LIMIT 1`,
      [subject.subjectSpace, subject.subjectKey],
    );
    const row = accumulatorResult.rows[0] as Row | undefined;
    if (!row) continue;
    const accumulator = calibrationFromRow(row);
    const evaluation = evaluateForecastCalibration(accumulator);
    const pairRows = await client.query(
      `SELECT current_reason_codes_json FROM tokenless_forecast_pair_accumulators
         WHERE subject_space=$1 AND (left_subject_key=$2 OR right_subject_key=$2)`,
      [subject.subjectSpace, subject.subjectKey],
    );
    const pairReasons = (pairRows.rows as Row[]).flatMap(value => reasonCodes(value.current_reason_codes_json));
    const findings = await client.query(
      `SELECT finding.finding_id,finding.reason_code,finding.severity,finding.source_observation_count,
                finding.payout_effect,finding.consequence,finding.created_at,
                appeal.appeal_id,
                CASE WHEN appeal.appeal_id IS NULL THEN false ELSE true END AS appeal_open
         FROM tokenless_forecast_integrity_findings finding
         LEFT JOIN tokenless_forecast_integrity_appeals appeal
           ON appeal.finding_id=finding.finding_id AND appeal.status='open'
         WHERE finding.subject_space=$1 AND finding.subject_key=$2
         ORDER BY finding.created_at DESC,finding.finding_id DESC LIMIT 50`,
      [subject.subjectSpace, subject.subjectKey],
    );
    const appealHistory = await client.query(
      `SELECT appeal.appeal_id,appeal.finding_id,appeal.reason_code,appeal.status,
              appeal.opened_at,appeal.resolved_at,appeal.resolution_reason,
              event.event_id,event.event_type,event.from_status,event.to_status,
              event.actor_kind,event.event_reason,event.occurred_at
       FROM tokenless_forecast_integrity_appeals appeal
       LEFT JOIN tokenless_forecast_integrity_appeal_events event ON event.appeal_id=appeal.appeal_id
       WHERE appeal.subject_space=$1 AND appeal.subject_key=$2
       ORDER BY appeal.opened_at DESC,appeal.appeal_id DESC,event.occurred_at,event.event_id`,
      [subject.subjectSpace, subject.subjectKey],
    );
    const appealsByFinding = new Map<
      string,
      Array<{
        appealId: string;
        reasonCode: string;
        status: string;
        openedAt: string;
        resolvedAt: string | null;
        resolutionReason: string | null;
        events: Array<{
          eventType: string;
          fromStatus: string | null;
          toStatus: string;
          actorKind: string;
          eventReason: string;
          occurredAt: string;
        }>;
      }>
    >();
    const appealsById = new Map<string, NonNullable<ReturnType<typeof appealsByFinding.get>>[number]>();
    for (const value of appealHistory.rows as Row[]) {
      const appealId = text(value, "appeal_id");
      const findingId = text(value, "finding_id");
      if (!appealId || !findingId) throw new Error("Stored forecast appeal history is invalid.");
      let appeal = appealsById.get(appealId);
      if (!appeal) {
        appeal = {
          appealId,
          reasonCode: text(value, "reason_code")!,
          status: text(value, "status")!,
          openedAt: new Date(String(value.opened_at)).toISOString(),
          resolvedAt: value.resolved_at ? new Date(String(value.resolved_at)).toISOString() : null,
          resolutionReason: text(value, "resolution_reason"),
          events: [],
        };
        appealsById.set(appealId, appeal);
        const history = appealsByFinding.get(findingId) ?? [];
        history.push(appeal);
        appealsByFinding.set(findingId, history);
      }
      if (value.event_id) {
        appeal.events.push({
          eventType: text(value, "event_type")!,
          fromStatus: text(value, "from_status"),
          toStatus: text(value, "to_status")!,
          actorKind: text(value, "actor_kind")!,
          eventReason: text(value, "event_reason")!,
          occurredAt: new Date(String(value.occurred_at)).toISOString(),
        });
      }
    }
    const currentReasonCodes = [...new Set([...evaluation.reasonCodes, ...pairReasons])];
    const restrictions = await activeForecastRestrictions(client, { subject });
    items.push({
      subjectSpace: subject.subjectSpace,
      workspaceId: subject.workspaceId,
      observationCount: evaluation.observationCount,
      brierSkillScoreBps: evaluation.brierSkillScoreBps,
      forecastVarianceBpsSquared: evaluation.forecastVarianceBpsSquared,
      outcomeDiscriminationBps: evaluation.outcomeDiscriminationBps,
      voteDiscriminationBps: evaluation.voteDiscriminationBps,
      reasonCodes: currentReasonCodes,
      limitationCodes: [],
      payoutEffect: "none" as const,
      consequence: restrictionConsequence(currentReasonCodes, restrictions),
      findings: (findings.rows as Row[]).map(value => ({
        findingId: text(value, "finding_id")!,
        reasonCode: text(value, "reason_code")!,
        severity: text(value, "severity")!,
        sourceObservationCount: text(value, "source_observation_count")!,
        payoutEffect: "none" as const,
        consequence: text(value, "consequence")!,
        appealOpen: value.appeal_open === true,
        openAppealId: text(value, "appeal_id"),
        appeals: appealsByFinding.get(text(value, "finding_id")!) ?? [],
        createdAt: new Date(String(value.created_at)).toISOString(),
      })),
    });
  }
  return { schemaVersion: "rateloop.reviewer-forecast-integrity.v1" as const, items };
}

async function appendAppealEvent(
  client: PoolClient,
  input: {
    appealId: string;
    eventType: "opened" | "accepted" | "rejected" | "withdrawn";
    fromStatus: "open" | null;
    actorKind: "principal" | "workspace_manager" | "compliance_operator";
    actorReference: string;
    eventReason: string;
    now: Date;
  },
) {
  await client.query(
    `INSERT INTO tokenless_forecast_integrity_appeal_events
     (event_id,appeal_id,event_type,from_status,to_status,actor_kind,actor_reference,event_reason,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      `cfae_${randomUUID().replaceAll("-", "")}`,
      input.appealId,
      input.eventType,
      input.fromStatus,
      input.eventType === "opened" ? "open" : input.eventType,
      input.actorKind,
      input.actorReference,
      input.eventReason,
      input.now,
    ],
  );
}

function normalizeResolutionReason(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 1_000) {
    throw new TokenlessServiceError(
      "Appeal resolutionReason must be 1-1000 characters.",
      400,
      "invalid_forecast_appeal_resolution",
    );
  }
  return normalized;
}

function normalizeResolverReference(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw new TokenlessServiceError(
      "Appeal resolver reference must be 1-200 characters.",
      400,
      "invalid_forecast_appeal_resolution",
    );
  }
  return normalized;
}

export async function openPrincipalForecastAppeal(input: {
  principalId: string;
  findingId: string;
  reasonCode: ForecastAppealReason;
  now?: Date;
}) {
  if (!FINDING_ID_PATTERN.test(input.findingId) || !APPEAL_REASONS.has(input.reasonCode)) {
    throw new TokenlessServiceError("Appeal request is invalid.", 400, "invalid_forecast_appeal");
  }
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const finding = await client.query(
      `SELECT * FROM tokenless_forecast_integrity_findings WHERE finding_id=$1 LIMIT 1 FOR SHARE`,
      [input.findingId],
    );
    const row = finding.rows[0] as Row | undefined;
    if (!row) throw new TokenlessServiceError("Finding not found.", 404, "forecast_finding_not_found");
    const subjects = await subjectsForPrincipal(client, input.principalId);
    const owned = subjects.find(
      subject => subject.subjectSpace === text(row, "subject_space") && subject.subjectKey === text(row, "subject_key"),
    );
    if (!owned) throw new TokenlessServiceError("Finding not found.", 404, "forecast_finding_not_found");
    const appealId = `cfa_${randomUUID().replaceAll("-", "")}`;
    const inserted = await client.query(
      `INSERT INTO tokenless_forecast_integrity_appeals
       (appeal_id,finding_id,subject_space,subject_key,reason_code,status,opened_at)
       VALUES ($1,$2,$3,$4,$5,'open',$6)
       ON CONFLICT DO NOTHING RETURNING appeal_id`,
      [appealId, input.findingId, owned.subjectSpace, owned.subjectKey, input.reasonCode, now],
    );
    const insertedAppealId = text(inserted.rows[0] as Row | undefined, "appeal_id");
    if (insertedAppealId) {
      await appendAppealEvent(client, {
        appealId: insertedAppealId,
        eventType: "opened",
        fromStatus: null,
        actorKind: "principal",
        actorReference: input.principalId,
        eventReason: `appeal_reason:${input.reasonCode}`,
        now,
      });
    }
    const storedAppealId =
      insertedAppealId ??
      text(
        (
          await client.query(
            `SELECT appeal_id FROM tokenless_forecast_integrity_appeals
             WHERE finding_id=$1 AND status='open' LIMIT 1`,
            [input.findingId],
          )
        ).rows[0] as Row | undefined,
        "appeal_id",
      );
    if (!storedAppealId) throw new Error("Forecast appeal insert did not return an appeal.");
    const restrictions = await activeForecastRestrictions(client, {
      subject: owned,
      ...(owned.workspaceId ? { workspaceId: owned.workspaceId } : {}),
    });
    const consequence = restrictionConsequence(
      restrictions.map(restriction => restriction.reasonCode),
      restrictions,
    );
    await client.query("COMMIT");
    return {
      schemaVersion: "rateloop.reviewer-forecast-appeal.v1" as const,
      appealId: storedAppealId,
      findingId: input.findingId,
      status: "open" as const,
      consequence,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function appealResult(input: {
  appealId: string;
  findingId: string;
  status: "accepted" | "rejected" | "withdrawn";
  consequence: ReturnType<typeof forecastConsequence>;
  replay: boolean;
}) {
  return {
    schemaVersion: "rateloop.reviewer-forecast-appeal.v1" as const,
    ...input,
  };
}

export async function withdrawPrincipalForecastAppeal(input: { principalId: string; appealId: string; now?: Date }) {
  if (!APPEAL_ID_PATTERN.test(input.appealId)) {
    throw new TokenlessServiceError("Appeal request is invalid.", 400, "invalid_forecast_appeal");
  }
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const appeal = await client.query(
      `SELECT appeal.appeal_id,appeal.finding_id,appeal.subject_space,appeal.subject_key,appeal.status,
              finding.workspace_id
       FROM tokenless_forecast_integrity_appeals appeal
       JOIN tokenless_forecast_integrity_findings finding ON finding.finding_id=appeal.finding_id
       WHERE appeal.appeal_id=$1 LIMIT 1 FOR UPDATE`,
      [input.appealId],
    );
    const row = appeal.rows[0] as Row | undefined;
    if (!row) throw new TokenlessServiceError("Appeal not found.", 404, "forecast_appeal_not_found");
    const subjects = await subjectsForPrincipal(client, input.principalId);
    const owned = subjects.find(
      subject => subject.subjectSpace === text(row, "subject_space") && subject.subjectKey === text(row, "subject_key"),
    );
    if (!owned) throw new TokenlessServiceError("Appeal not found.", 404, "forecast_appeal_not_found");
    const status = text(row, "status");
    if (status !== "open" && status !== "withdrawn") {
      throw new TokenlessServiceError("Resolved appeals cannot be withdrawn.", 409, "forecast_appeal_already_resolved");
    }
    const replay = status === "withdrawn";
    if (!replay) {
      await client.query(
        `UPDATE tokenless_forecast_integrity_appeals
         SET status='withdrawn',resolved_at=$1,resolved_by=$2,resolution_reason=$3
         WHERE appeal_id=$4 AND status='open'`,
        [now, input.principalId, "Principal withdrew the appeal.", input.appealId],
      );
      await appendAppealEvent(client, {
        appealId: input.appealId,
        eventType: "withdrawn",
        fromStatus: "open",
        actorKind: "principal",
        actorReference: input.principalId,
        eventReason: "Principal withdrew the appeal.",
        now,
      });
    }
    const workspaceId = text(row, "workspace_id");
    const restrictions = await activeForecastRestrictions(client, {
      subject: owned,
      ...(workspaceId ? { workspaceId } : {}),
    });
    const consequence = restrictionConsequence(
      restrictions.map(restriction => restriction.reasonCode),
      restrictions,
    );
    await client.query("COMMIT");
    return appealResult({
      appealId: input.appealId,
      findingId: text(row, "finding_id")!,
      status: "withdrawn",
      consequence,
      replay,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function requireForecastAppealManager(
  client: PoolClient,
  input: { accountAddress: string; workspaceId: string },
) {
  let actor: string;
  try {
    actor = normalizeAccountSubject(input.accountAddress);
  } catch {
    throw new TokenlessServiceError("Account address is invalid.", 400, "invalid_account");
  }
  const manager = await client.query(
    `SELECT 1 FROM tokenless_workspace_members member
     JOIN tokenless_workspaces workspace ON workspace.workspace_id=member.workspace_id
     WHERE member.workspace_id=$1 AND member.account_address=$2
       AND member.role IN ('owner','admin') AND workspace.status='active'
     LIMIT 1 FOR SHARE`,
    [input.workspaceId, actor],
  );
  if (manager.rowCount !== 1) {
    throw new TokenlessServiceError("Appeal not found.", 404, "forecast_appeal_not_found");
  }
  return actor;
}

async function clearAcceptedForecastFinding(
  client: PoolClient,
  input: {
    subjectSpace: ForecastSubjectSpace;
    subjectKey: string;
    peerSubjectKey: string | null;
    workspaceId: string | null;
    now: Date;
  },
) {
  if (input.peerSubjectKey === null) {
    await client.query(
      `UPDATE tokenless_forecast_calibration_accumulators
       SET observation_count=0,outcome_observation_count=0,forecast_sum_bps=0,
           forecast_square_sum=0,squared_error_sum=0,outcome_positive_count=0,
           positive_outcome_forecast_sum_bps=0,positive_outcome_count=0,
           negative_outcome_forecast_sum_bps=0,negative_outcome_count=0,
           positive_vote_forecast_sum_bps=0,positive_vote_count=0,
           negative_vote_forecast_sum_bps=0,negative_vote_count=0,
           current_reason_codes_json='[]',updated_at=$1
       WHERE subject_space=$2 AND subject_key=$3`,
      [input.now, input.subjectSpace, input.subjectKey],
    );
    return;
  }
  if (!input.workspaceId) {
    throw new Error("A paired forecast finding is missing its workspace.");
  }
  const [leftSubjectKey, rightSubjectKey] =
    input.subjectKey < input.peerSubjectKey
      ? [input.subjectKey, input.peerSubjectKey]
      : [input.peerSubjectKey, input.subjectKey];
  await client.query(
    `UPDATE tokenless_forecast_pair_accumulators
     SET observation_count=0,exact_match_count=0,expected_exact_match_bps_sum=0,
         distance_sum_bps=0,distance_square_sum=0,current_reason_codes_json='[]',updated_at=$1
     WHERE workspace_id=$2 AND subject_space=$3 AND left_subject_key=$4 AND right_subject_key=$5`,
    [input.now, input.workspaceId, input.subjectSpace, leftSubjectKey, rightSubjectKey],
  );
}

async function resolveForecastAppealInTransaction(
  client: PoolClient,
  input: {
    appealId: string;
    status: ForecastAppealResolutionStatus;
    resolutionReason: string;
    actorKind: "workspace_manager" | "compliance_operator";
    actorReference: string;
    workspaceId?: string;
    now: Date;
  },
) {
  const appeal = await client.query(
    `SELECT appeal.appeal_id,appeal.finding_id,appeal.subject_space,appeal.subject_key,appeal.status,
            appeal.resolved_by,appeal.resolution_reason,finding.workspace_id,finding.peer_subject_key
     FROM tokenless_forecast_integrity_appeals appeal
     JOIN tokenless_forecast_integrity_findings finding ON finding.finding_id=appeal.finding_id
     WHERE appeal.appeal_id=$1 LIMIT 1 FOR UPDATE`,
    [input.appealId],
  );
  const row = appeal.rows[0] as Row | undefined;
  if (!row || (input.workspaceId !== undefined && text(row, "workspace_id") !== input.workspaceId)) {
    throw new TokenlessServiceError("Appeal not found.", 404, "forecast_appeal_not_found");
  }
  const priorStatus = text(row, "status");
  const replay =
    priorStatus === input.status &&
    text(row, "resolved_by") === input.actorReference &&
    text(row, "resolution_reason") === input.resolutionReason;
  if (priorStatus !== "open" && !replay) {
    throw new TokenlessServiceError("Appeal has already been resolved.", 409, "forecast_appeal_already_resolved");
  }
  if (!replay) {
    const updated = await client.query(
      `UPDATE tokenless_forecast_integrity_appeals
       SET status=$1,resolved_at=$2,resolved_by=$3,resolution_reason=$4
       WHERE appeal_id=$5 AND status='open' RETURNING appeal_id`,
      [input.status, input.now, input.actorReference, input.resolutionReason, input.appealId],
    );
    if (updated.rowCount !== 1) {
      throw new TokenlessServiceError("Appeal has already been resolved.", 409, "forecast_appeal_already_resolved");
    }
    await appendAppealEvent(client, {
      appealId: input.appealId,
      eventType: input.status,
      fromStatus: "open",
      actorKind: input.actorKind,
      actorReference: input.actorReference,
      eventReason: input.resolutionReason,
      now: input.now,
    });
    if (input.status === "accepted") {
      await clearAcceptedForecastFinding(client, {
        subjectSpace: text(row, "subject_space") as ForecastSubjectSpace,
        subjectKey: text(row, "subject_key")!,
        peerSubjectKey: text(row, "peer_subject_key"),
        workspaceId: text(row, "workspace_id"),
        now: input.now,
      });
    }
  }
  return {
    appealId: input.appealId,
    findingId: text(row, "finding_id")!,
    status: input.status,
    replay,
  };
}

export async function resolveWorkspaceForecastAppeal(input: {
  accountAddress: string;
  workspaceId: string;
  appealId: string;
  status: ForecastAppealResolutionStatus;
  resolutionReason: string;
  now?: Date;
}) {
  if (!APPEAL_ID_PATTERN.test(input.appealId) || !["accepted", "rejected"].includes(input.status)) {
    throw new TokenlessServiceError("Appeal resolution is invalid.", 400, "invalid_forecast_appeal_resolution");
  }
  const resolutionReason = normalizeResolutionReason(input.resolutionReason);
  const now = input.now ?? new Date();
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const actor = await requireForecastAppealManager(client, input);
    const resolved = await resolveForecastAppealInTransaction(client, {
      appealId: input.appealId,
      status: input.status,
      resolutionReason,
      actorKind: "workspace_manager",
      actorReference: actor,
      workspaceId: input.workspaceId,
      now,
    });
    await client.query("COMMIT");
    return {
      schemaVersion: "rateloop.reviewer-forecast-appeal-resolution.v1" as const,
      ...resolved,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resolveComplianceForecastAppeal(input: {
  appealId: string;
  status: ForecastAppealResolutionStatus;
  resolutionReason: string;
  resolvedBy: string;
  now?: Date;
}) {
  if (!APPEAL_ID_PATTERN.test(input.appealId) || !["accepted", "rejected"].includes(input.status)) {
    throw new TokenlessServiceError("Appeal resolution is invalid.", 400, "invalid_forecast_appeal_resolution");
  }
  const resolutionReason = normalizeResolutionReason(input.resolutionReason);
  const resolvedBy = normalizeResolverReference(input.resolvedBy);
  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");
    const resolved = await resolveForecastAppealInTransaction(client, {
      appealId: input.appealId,
      status: input.status,
      resolutionReason,
      actorKind: "compliance_operator",
      actorReference: resolvedBy,
      now: input.now ?? new Date(),
    });
    await client.query("COMMIT");
    return {
      schemaVersion: "rateloop.reviewer-forecast-appeal-resolution.v1" as const,
      ...resolved,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function erasePrincipalForecastIntegrityInTransaction(client: PoolClient, input: { principalId: string }) {
  const subjects = await subjectsForPrincipal(client, input.principalId);
  let deleted = 0;
  if (subjects.length > 0) await client.query("SELECT set_config('rateloop.account_erasure','on',true)");
  const histogramScopes = new Map<string, { workspaceId: string; subjectSpace: ForecastSubjectSpace }>();
  for (const subject of subjects) {
    if (subject.workspaceId) {
      histogramScopes.set(`${subject.subjectSpace}\0${subject.workspaceId}`, {
        workspaceId: subject.workspaceId,
        subjectSpace: subject.subjectSpace,
      });
    }
    const pairWorkspaces = await client.query(
      `SELECT DISTINCT workspace_id FROM tokenless_forecast_pair_accumulators
       WHERE subject_space=$1 AND (left_subject_key=$2 OR right_subject_key=$2)`,
      [subject.subjectSpace, subject.subjectKey],
    );
    for (const row of pairWorkspaces.rows as Row[]) {
      const workspaceId = text(row, "workspace_id");
      if (workspaceId) {
        histogramScopes.set(`${subject.subjectSpace}\0${workspaceId}`, {
          workspaceId,
          subjectSpace: subject.subjectSpace,
        });
      }
    }
  }
  for (const subject of subjects) {
    const findings = await client.query(
      `DELETE FROM tokenless_forecast_integrity_findings
       WHERE subject_space=$1 AND (subject_key=$2 OR peer_subject_key=$2)`,
      [subject.subjectSpace, subject.subjectKey],
    );
    const pairs = await client.query(
      `DELETE FROM tokenless_forecast_pair_accumulators
       WHERE subject_space=$1 AND (left_subject_key=$2 OR right_subject_key=$2)`,
      [subject.subjectSpace, subject.subjectKey],
    );
    const accumulators = await client.query(
      `DELETE FROM tokenless_forecast_calibration_accumulators WHERE subject_space=$1 AND subject_key=$2`,
      [subject.subjectSpace, subject.subjectKey],
    );
    deleted += (findings.rowCount ?? 0) + (pairs.rowCount ?? 0) + (accumulators.rowCount ?? 0);
  }
  for (const scope of histogramScopes.values()) {
    const histogram = await client.query(
      `DELETE FROM tokenless_forecast_workspace_histograms WHERE workspace_id=$1 AND subject_space=$2`,
      [scope.workspaceId, scope.subjectSpace],
    );
    deleted += histogram.rowCount ?? 0;
  }
  let remainingRows = 0;
  for (const subject of subjects) {
    const remaining = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM tokenless_forecast_integrity_findings
          WHERE subject_space=$1 AND (subject_key=$2 OR peer_subject_key=$2)) +
         (SELECT COUNT(*) FROM tokenless_forecast_integrity_appeals
          WHERE subject_space=$1 AND subject_key=$2) +
         (SELECT COUNT(*) FROM tokenless_forecast_calibration_accumulators
          WHERE subject_space=$1 AND subject_key=$2) +
         (SELECT COUNT(*) FROM tokenless_forecast_pair_accumulators
          WHERE subject_space=$1 AND (left_subject_key=$2 OR right_subject_key=$2)) AS count`,
      [subject.subjectSpace, subject.subjectKey],
    );
    remainingRows += Number((remaining.rows[0] as Row | undefined)?.count ?? 0);
  }
  for (const scope of histogramScopes.values()) {
    const remaining = await client.query(
      `SELECT COUNT(*) AS count FROM tokenless_forecast_workspace_histograms
       WHERE workspace_id=$1 AND subject_space=$2`,
      [scope.workspaceId, scope.subjectSpace],
    );
    remainingRows += Number((remaining.rows[0] as Row | undefined)?.count ?? 0);
  }
  return { deletedRows: deleted, remainingRows, subjectCount: subjects.length };
}

export const __crowdForecastPersistenceTestUtils = {
  optionalPrivateForecast,
  async aggregateInvitedBatch(
    client: PoolClient,
    input: {
      workspaceId: string;
      observations: Array<{ principalId: string; predictedPositiveBps: number; vote: 0 | 1 }>;
      outcome: 0 | 1 | null;
      now: Date;
    },
  ) {
    const runtime = lookupRuntime();
    await aggregateBatch(client, {
      workspaceId: input.workspaceId,
      entries: input.observations.map(observation => ({
        ...invitedForecastSubject({
          workspaceId: input.workspaceId,
          principalId: observation.principalId,
          key: runtime.key,
          keyVersion: runtime.version,
        }),
        predictedPositiveBps: observation.predictedPositiveBps,
        vote: observation.vote,
      })),
      outcome: input.outcome,
      now: input.now,
    });
  },
};
