import { RateLoopSdkError } from "./errors";
import {
  HUMAN_REVIEW_RESULT_ENVELOPE_SCHEMA_VERSION,
  HUMAN_REVIEW_RESULT_LANES,
  HUMAN_REVIEW_RESULT_OUTCOMES,
  HUMAN_REVIEW_RESULT_TERMINAL_STATES,
  HUMAN_REVIEW_TERMINAL_EVIDENCE_SCHEMA_VERSION,
  type HumanReviewAutomaticQualityAccounting,
  type HumanReviewFeedbackBonusAccounting,
  type HumanReviewFrozenReference,
  type HumanReviewGuaranteedBaseAccounting,
  type HumanReviewResultCohortCounts,
  type HumanReviewResultCohortSource,
  type HumanReviewResultCommitment,
  type HumanReviewResultEnvelope,
  type HumanReviewResultLane,
  type HumanReviewResultOutcome,
  type HumanReviewResultTerminalState,
  type HumanReviewTerminalEvidence,
} from "./humanReviewResultEnvelopeTypes";

type JsonRecord = Record<string, unknown>;

const ATOMIC_PATTERN = /^(0|[1-9]\d*)$/u;
const COMMITMENT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const REASON_CODE_PATTERN = /^[a-z0-9][a-z0-9:._-]{0,95}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{86}$/u;
const MAX_UINT256 = (1n << 256n) - 1n;

function invalid(path: string, expectation: string): never {
  throw new RateLoopSdkError(
    `Invalid human-review result at ${path}: expected ${expectation}.`,
  );
}

function record(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as JsonRecord;
}

function exactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  path: string,
) {
  const expected = new Set(allowed);
  const actual = Object.keys(value);
  const extras = actual.filter((key) => !expected.has(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  if (extras.length || missing.length) {
    invalid(path, `exactly ${allowed.join(", ")}`);
  }
}

function string(value: unknown, path: string, maximum = 200): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value
  ) {
    invalid(path, `a non-empty trimmed string up to ${maximum} characters`);
  }
  return value;
}

function integer(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid(path, `a safe integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function enumeration<T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
): T {
  const normalized = string(value, path);
  if (!values.includes(normalized as T)) invalid(path, values.join(" or "));
  return normalized as T;
}

function isoDate(value: unknown, path: string): string {
  const normalized = string(value, path, 64);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(normalized) ||
    !Number.isFinite(Date.parse(normalized))
  ) {
    invalid(path, "a UTC ISO-8601 timestamp");
  }
  return normalized;
}

function atomic(value: unknown, path: string): string {
  const normalized = string(value, path, 96);
  if (!ATOMIC_PATTERN.test(normalized) || BigInt(normalized) > MAX_UINT256) {
    invalid(path, "an unsigned uint256 base-10 atomic amount");
  }
  return normalized;
}

function commitment(value: unknown, path: string): HumanReviewResultCommitment {
  const normalized = string(value, path, 71);
  if (!COMMITMENT_PATTERN.test(normalized)) {
    invalid(path, "a lowercase sha256 commitment");
  }
  return normalized as HumanReviewResultCommitment;
}

function reference(value: unknown, path: string): HumanReviewFrozenReference {
  const input = record(value, path);
  exactKeys(input, ["id", "version", "hash"], path);
  return {
    id: string(input.id, `${path}.id`),
    version: integer(input.version, `${path}.version`, 1),
    hash: commitment(input.hash, `${path}.hash`),
  };
}

function reasonCodes(value: unknown, path: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    invalid(path, "an array of 1-32 canonical reason codes");
  }
  const parsed = value.map((entry, index) => {
    const normalized = string(entry, `${path}[${index}]`, 96);
    if (!REASON_CODE_PATTERN.test(normalized)) {
      invalid(`${path}[${index}]`, "a canonical reason code");
    }
    return normalized;
  });
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((entry, index) => entry !== parsed[index])
  ) {
    invalid(path, "unique reason codes in lexical order");
  }
  return parsed;
}

function cohort(value: unknown, path: string): HumanReviewResultCohortCounts {
  const input = record(value, path);
  exactKeys(
    input,
    ["source", "requestedCount", "assignedCount", "responseCount"],
    path,
  );
  const requestedCount = integer(
    input.requestedCount,
    `${path}.requestedCount`,
  );
  const assignedCount = integer(input.assignedCount, `${path}.assignedCount`);
  const responseCount = integer(input.responseCount, `${path}.responseCount`);
  if (responseCount > assignedCount || assignedCount > requestedCount) {
    invalid(path, "responseCount <= assignedCount <= requestedCount");
  }
  return {
    source: enumeration(input.source, `${path}.source`, [
      "invited",
      "network",
    ] as const),
    requestedCount,
    assignedCount,
    responseCount,
  };
}

function expectedCohortSources(
  lane: HumanReviewResultLane,
): HumanReviewResultCohortSource[] {
  if (lane === "public_paid") return ["network"];
  if (lane === "hybrid") return ["invited", "network"];
  return ["invited"];
}

function guaranteedBase(
  value: unknown,
  path: string,
): HumanReviewGuaranteedBaseAccounting {
  const input = record(value, path);
  exactKeys(
    input,
    ["mode", "fundedAtomic", "paidAtomic", "refundedAtomic"],
    path,
  );
  const mode = enumeration(input.mode, `${path}.mode`, [
    "off",
    "usdc",
  ] as const);
  const fundedAtomic = atomic(input.fundedAtomic, `${path}.fundedAtomic`);
  const paidAtomic = atomic(input.paidAtomic, `${path}.paidAtomic`);
  const refundedAtomic = atomic(input.refundedAtomic, `${path}.refundedAtomic`);
  if (mode === "off") {
    if (fundedAtomic !== "0" || paidAtomic !== "0" || refundedAtomic !== "0") {
      invalid(path, "zero accounting when guaranteed base is off");
    }
    return { mode, fundedAtomic: "0", paidAtomic: "0", refundedAtomic: "0" };
  }
  if (
    BigInt(fundedAtomic) < 1n ||
    BigInt(paidAtomic) + BigInt(refundedAtomic) > BigInt(fundedAtomic)
  ) {
    invalid(
      path,
      "positive funding with paid plus refunded no greater than funded",
    );
  }
  return { mode, fundedAtomic, paidAtomic, refundedAtomic };
}

function automaticQuality(
  value: unknown,
  path: string,
): HumanReviewAutomaticQualityAccounting {
  const input = record(value, path);
  exactKeys(
    input,
    ["mode", "availableAtomic", "awardedAtomic", "refundedAtomic"],
    path,
  );
  const mode = enumeration(input.mode, `${path}.mode`, [
    "off",
    "usdc",
  ] as const);
  const availableAtomic = atomic(
    input.availableAtomic,
    `${path}.availableAtomic`,
  );
  const awardedAtomic = atomic(input.awardedAtomic, `${path}.awardedAtomic`);
  const refundedAtomic = atomic(input.refundedAtomic, `${path}.refundedAtomic`);
  if (mode === "off") {
    if (
      availableAtomic !== "0" ||
      awardedAtomic !== "0" ||
      refundedAtomic !== "0"
    ) {
      invalid(path, "zero accounting when automatic quality allocation is off");
    }
    return {
      mode,
      availableAtomic: "0",
      awardedAtomic: "0",
      refundedAtomic: "0",
    };
  }
  if (
    BigInt(availableAtomic) < 1n ||
    BigInt(awardedAtomic) + BigInt(refundedAtomic) > BigInt(availableAtomic)
  ) {
    invalid(
      path,
      "positive availability with awarded plus refunded no greater than available",
    );
  }
  return { mode, availableAtomic, awardedAtomic, refundedAtomic };
}

function feedbackBonus(
  value: unknown,
  path: string,
): HumanReviewFeedbackBonusAccounting {
  const input = record(value, path);
  exactKeys(
    input,
    ["mode", "fundedAtomic", "awardedAtomic", "refundedAtomic", "awards"],
    path,
  );
  const mode = enumeration(input.mode, `${path}.mode`, [
    "off",
    "usdc",
  ] as const);
  const fundedAtomic = atomic(input.fundedAtomic, `${path}.fundedAtomic`);
  const awardedAtomic = atomic(input.awardedAtomic, `${path}.awardedAtomic`);
  const refundedAtomic = atomic(input.refundedAtomic, `${path}.refundedAtomic`);
  if (!Array.isArray(input.awards)) invalid(`${path}.awards`, "an array");
  const awards = input.awards.map((entry, index) => {
    const awardPath = `${path}.awards[${index}]`;
    const award = record(entry, awardPath);
    exactKeys(
      award,
      ["awardId", "responseCommitment", "amountAtomic"],
      awardPath,
    );
    const amountAtomic = atomic(
      award.amountAtomic,
      `${awardPath}.amountAtomic`,
    );
    if (BigInt(amountAtomic) < 1n)
      invalid(`${awardPath}.amountAtomic`, "a positive amount");
    return {
      awardId: string(award.awardId, `${awardPath}.awardId`),
      responseCommitment: commitment(
        award.responseCommitment,
        `${awardPath}.responseCommitment`,
      ),
      amountAtomic,
    };
  });
  if (mode === "off") {
    if (
      fundedAtomic !== "0" ||
      awardedAtomic !== "0" ||
      refundedAtomic !== "0" ||
      awards.length
    ) {
      invalid(path, "zero accounting and no awards when Feedback Bonus is off");
    }
    return {
      mode,
      fundedAtomic: "0",
      awardedAtomic: "0",
      refundedAtomic: "0",
      awards: [],
    };
  }
  if (BigInt(fundedAtomic) < 1n)
    invalid(`${path}.fundedAtomic`, "a positive amount");
  const awardIds = new Set(awards.map((award) => award.awardId));
  const responseCommitments = new Set(
    awards.map((award) => award.responseCommitment),
  );
  if (
    awardIds.size !== awards.length ||
    responseCommitments.size !== awards.length
  ) {
    invalid(`${path}.awards`, "unique award IDs and response commitments");
  }
  const awardSum = awards.reduce(
    (sum, award) => sum + BigInt(award.amountAtomic),
    0n,
  );
  if (
    awardSum !== BigInt(awardedAtomic) ||
    BigInt(awardedAtomic) + BigInt(refundedAtomic) > BigInt(fundedAtomic)
  ) {
    invalid(
      path,
      "awards summing to awardedAtomic and awarded plus refunded no greater than funded",
    );
  }
  return { mode, fundedAtomic, awardedAtomic, refundedAtomic, awards };
}

function terminalEvidence(
  value: unknown,
  path: string,
): HumanReviewTerminalEvidence | null {
  if (value === null) return null;
  const input = record(value, path);
  exactKeys(
    input,
    ["schemaVersion", "algorithm", "keyId", "payloadCommitment", "signature"],
    path,
  );
  if (input.schemaVersion !== HUMAN_REVIEW_TERMINAL_EVIDENCE_SCHEMA_VERSION) {
    invalid(
      `${path}.schemaVersion`,
      HUMAN_REVIEW_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    );
  }
  if (input.algorithm !== "Ed25519") invalid(`${path}.algorithm`, "Ed25519");
  const keyId = string(input.keyId, `${path}.keyId`, 128);
  if (!KEY_ID_PATTERN.test(keyId)) {
    invalid(`${path}.keyId`, "a canonical signing-key identifier");
  }
  const signature = string(input.signature, `${path}.signature`, 256);
  if (!SIGNATURE_PATTERN.test(signature))
    invalid(`${path}.signature`, "a base64url Ed25519 signature");
  return {
    schemaVersion: HUMAN_REVIEW_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    algorithm: "Ed25519",
    keyId,
    payloadCommitment: commitment(
      input.payloadCommitment,
      `${path}.payloadCommitment`,
    ),
    signature,
  };
}

function assertOutcomeMatchesState(
  state: HumanReviewResultTerminalState,
  outcome: HumanReviewResultOutcome,
) {
  const matches =
    (state === "completed" &&
      (outcome === "positive" || outcome === "negative")) ||
    (state === "inconclusive" && outcome === "inconclusive") ||
    (state === "failed_terminal" && outcome === "failed") ||
    (state === "cancelled_before_commit" && outcome === "cancelled");
  if (!matches)
    invalid(
      "result.outcome",
      `an outcome compatible with lifecycle state ${state}`,
    );
}

/**
 * Strictly validates a terminal result projection. Unknown fields fail closed so
 * an accidental private field cannot silently cross the SDK boundary.
 */
export function parseHumanReviewResultEnvelope(
  value: unknown,
): HumanReviewResultEnvelope {
  const input = record(value, "result");
  exactKeys(
    input,
    [
      "schemaVersion",
      "workspaceId",
      "integrationId",
      "opportunityId",
      "lane",
      "lifecycle",
      "frozen",
      "panel",
      "outcome",
      "rationale",
      "economics",
      "commitments",
      "terminalEvidence",
    ],
    "result",
  );
  if (input.schemaVersion !== HUMAN_REVIEW_RESULT_ENVELOPE_SCHEMA_VERSION) {
    invalid(
      "result.schemaVersion",
      HUMAN_REVIEW_RESULT_ENVELOPE_SCHEMA_VERSION,
    );
  }
  const lane = enumeration(
    input.lane,
    "result.lane",
    HUMAN_REVIEW_RESULT_LANES,
  );

  const lifecycleInput = record(input.lifecycle, "result.lifecycle");
  exactKeys(
    lifecycleInput,
    [
      "state",
      "terminal",
      "revision",
      "reasonCodes",
      "startedAt",
      "stateEnteredAt",
      "finalizedAt",
    ],
    "result.lifecycle",
  );
  if (lifecycleInput.terminal !== true)
    invalid("result.lifecycle.terminal", "true");
  const state = enumeration(
    lifecycleInput.state,
    "result.lifecycle.state",
    HUMAN_REVIEW_RESULT_TERMINAL_STATES,
  );
  const startedAt = isoDate(
    lifecycleInput.startedAt,
    "result.lifecycle.startedAt",
  );
  const stateEnteredAt = isoDate(
    lifecycleInput.stateEnteredAt,
    "result.lifecycle.stateEnteredAt",
  );
  const finalizedAt = isoDate(
    lifecycleInput.finalizedAt,
    "result.lifecycle.finalizedAt",
  );
  if (
    Date.parse(stateEnteredAt) < Date.parse(startedAt) ||
    Date.parse(finalizedAt) < Date.parse(stateEnteredAt)
  ) {
    invalid("result.lifecycle", "monotonic lifecycle timestamps");
  }

  const frozenInput = record(input.frozen, "result.frozen");
  exactKeys(
    frozenInput,
    ["selectionPolicy", "binding", "requestProfile", "responseDeadline"],
    "result.frozen",
  );
  const responseDeadline = isoDate(
    frozenInput.responseDeadline,
    "result.frozen.responseDeadline",
  );
  if (Date.parse(responseDeadline) <= Date.parse(startedAt)) {
    invalid(
      "result.frozen.responseDeadline",
      "a timestamp after lifecycle.startedAt",
    );
  }

  const panelInput = record(input.panel, "result.panel");
  exactKeys(
    panelInput,
    ["requestedCount", "assignedCount", "responseCount", "cohorts"],
    "result.panel",
  );
  const requestedCount = integer(
    panelInput.requestedCount,
    "result.panel.requestedCount",
  );
  const assignedCount = integer(
    panelInput.assignedCount,
    "result.panel.assignedCount",
  );
  const responseCount = integer(
    panelInput.responseCount,
    "result.panel.responseCount",
  );
  if (responseCount > assignedCount || assignedCount > requestedCount) {
    invalid("result.panel", "responseCount <= assignedCount <= requestedCount");
  }
  if (!Array.isArray(panelInput.cohorts))
    invalid("result.panel.cohorts", "an array");
  const cohorts = panelInput.cohorts.map((entry, index) =>
    cohort(entry, `result.panel.cohorts[${index}]`),
  );
  const expectedSources = expectedCohortSources(lane);
  if (
    cohorts.length !== expectedSources.length ||
    cohorts.some((entry, index) => entry.source !== expectedSources[index]) ||
    cohorts.reduce((sum, entry) => sum + entry.requestedCount, 0) !==
      requestedCount ||
    cohorts.reduce((sum, entry) => sum + entry.assignedCount, 0) !==
      assignedCount ||
    cohorts.reduce((sum, entry) => sum + entry.responseCount, 0) !==
      responseCount
  ) {
    invalid("result.panel.cohorts", `exact ${lane} cohort sources and totals`);
  }

  const outcome = enumeration(
    input.outcome,
    "result.outcome",
    HUMAN_REVIEW_RESULT_OUTCOMES,
  );
  assertOutcomeMatchesState(state, outcome);

  const rationaleInput = record(input.rationale, "result.rationale");
  exactKeys(rationaleInput, ["mode", "summary"], "result.rationale");
  const rationaleMode = enumeration(
    rationaleInput.mode,
    "result.rationale.mode",
    ["withheld", "aggregate_summary"] as const,
  );
  const rationale =
    rationaleMode === "withheld"
      ? (() => {
          if (rationaleInput.summary !== null)
            invalid("result.rationale.summary", "null when withheld");
          return { mode: "withheld" as const, summary: null };
        })()
      : {
          mode: "aggregate_summary" as const,
          summary: string(
            rationaleInput.summary,
            "result.rationale.summary",
            2_000,
          ),
        };

  const economicsInput = record(input.economics, "result.economics");
  exactKeys(
    economicsInput,
    [
      "asset",
      "decimals",
      "guaranteedBase",
      "automaticQualityAllocation",
      "feedbackBonus",
    ],
    "result.economics",
  );
  if (economicsInput.asset !== "USDC")
    invalid("result.economics.asset", "USDC");
  if (economicsInput.decimals !== 6) invalid("result.economics.decimals", "6");
  const parsedGuaranteedBase = guaranteedBase(
    economicsInput.guaranteedBase,
    "result.economics.guaranteedBase",
  );
  const parsedAutomaticQuality = automaticQuality(
    economicsInput.automaticQualityAllocation,
    "result.economics.automaticQualityAllocation",
  );
  const paidLane = lane !== "private_unpaid";
  if (
    (paidLane &&
      (parsedGuaranteedBase.mode !== "usdc" ||
        parsedAutomaticQuality.mode !== "usdc")) ||
    (!paidLane &&
      (parsedGuaranteedBase.mode !== "off" ||
        parsedAutomaticQuality.mode !== "off"))
  ) {
    invalid(
      "result.economics",
      `base and automatic-quality accounting compatible with ${lane}`,
    );
  }
  const parsedFeedbackBonus = feedbackBonus(
    economicsInput.feedbackBonus,
    "result.economics.feedbackBonus",
  );
  if (
    parsedFeedbackBonus.awards.length > responseCount ||
    (responseCount === 0 &&
      (parsedAutomaticQuality.awardedAtomic !== "0" ||
        parsedFeedbackBonus.awardedAtomic !== "0" ||
        parsedFeedbackBonus.awards.length !== 0))
  ) {
    invalid(
      "result.economics",
      "quality and Feedback Bonus awards backed by recorded responses",
    );
  }
  if (
    state === "cancelled_before_commit" &&
    (parsedGuaranteedBase.paidAtomic !== "0" ||
      parsedAutomaticQuality.awardedAtomic !== "0" ||
      parsedFeedbackBonus.awardedAtomic !== "0")
  ) {
    invalid(
      "result.economics",
      "no paid or awarded work before the first accepted commit",
    );
  }
  if (state === "completed" && responseCount === 0) {
    invalid("result.panel.responseCount", "at least one response for a completed verdict");
  }
  if (rationale.mode === "aggregate_summary" && responseCount === 0) {
    invalid("result.rationale", "a withheld rationale when no response exists");
  }

  const commitmentsInput = record(input.commitments, "result.commitments");
  exactKeys(
    commitmentsInput,
    ["sourceArtifact", "suggestionArtifact", "responseSet", "result"],
    "result.commitments",
  );

  return {
    schemaVersion: HUMAN_REVIEW_RESULT_ENVELOPE_SCHEMA_VERSION,
    workspaceId: string(input.workspaceId, "result.workspaceId"),
    integrationId: string(input.integrationId, "result.integrationId"),
    opportunityId: string(input.opportunityId, "result.opportunityId"),
    lane,
    lifecycle: {
      state,
      terminal: true,
      revision: integer(
        lifecycleInput.revision,
        "result.lifecycle.revision",
        1,
      ),
      reasonCodes: reasonCodes(
        lifecycleInput.reasonCodes,
        "result.lifecycle.reasonCodes",
      ),
      startedAt,
      stateEnteredAt,
      finalizedAt,
    },
    frozen: {
      selectionPolicy: reference(
        frozenInput.selectionPolicy,
        "result.frozen.selectionPolicy",
      ),
      binding: reference(frozenInput.binding, "result.frozen.binding"),
      requestProfile: reference(
        frozenInput.requestProfile,
        "result.frozen.requestProfile",
      ),
      responseDeadline,
    },
    panel: { requestedCount, assignedCount, responseCount, cohorts },
    outcome,
    rationale,
    economics: {
      asset: "USDC",
      decimals: 6,
      guaranteedBase: parsedGuaranteedBase,
      automaticQualityAllocation: parsedAutomaticQuality,
      feedbackBonus: parsedFeedbackBonus,
    },
    commitments: {
      sourceArtifact: commitment(
        commitmentsInput.sourceArtifact,
        "result.commitments.sourceArtifact",
      ),
      suggestionArtifact: commitment(
        commitmentsInput.suggestionArtifact,
        "result.commitments.suggestionArtifact",
      ),
      responseSet: commitment(
        commitmentsInput.responseSet,
        "result.commitments.responseSet",
      ),
      result: commitment(commitmentsInput.result, "result.commitments.result"),
    },
    terminalEvidence: terminalEvidence(
      input.terminalEvidence,
      "result.terminalEvidence",
    ),
  };
}
