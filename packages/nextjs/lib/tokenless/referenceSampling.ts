import { PINNED_DRAND_CHAINS } from "@rateloop/node-utils/drand";
import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import { createHash } from "node:crypto";
import "server-only";
import {
  type TokenlessReferenceSampleBeacon,
  deriveTokenlessReferenceSampleSeed,
  verifyTokenlessReferenceSampleBeacon,
} from "~~/lib/tokenless/referenceSamplingBeacon";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const REFERENCE_FRAME_SCHEMA_VERSION = "rateloop.reference-sampling-frame.v3" as const;
export const REFERENCE_SAMPLE_SCHEMA_VERSION = "rateloop.reference-sample.v2" as const;
export const REFERENCE_SAMPLING_METHOD_VERSION = "stratified-sha256-rank-without-replacement-v1" as const;
export const REFERENCE_SAMPLE_INTENDED_ESTIMANDS = ["accuracy", "precision", "recall"] as const;
export const REFERENCE_SAMPLE_PLAN_LIMITATIONS = [
  "no_public_confidence_interval",
  "pilot_sample_size_not_validated",
] as const;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const LOWER_IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UNIT_ID = /^rsu_[A-Za-z0-9_-]{22}$/u;
const PUBLIC_DESIGNATION = /^[^\u0000-\u001f\u007f]{1,160}$/u;
const FORMULA_LEADING = /^[=+@-]/u;
const MACHINE_CLASSES = new Set<ReferenceFrameUnit["machineClass"]>([
  "text_classifier",
  "image_classifier",
  "audio_classifier",
  "video_classifier",
  "multimodal_classifier",
  "rules_engine",
  "other_machine_class",
]);
const MAX_FRAME_UNITS = 50_000;
const MINIMUM_BEACON_LEAD_MS = 5 * 60 * 1_000;

export type ReferenceFrameUnit = Readonly<{
  unitId: string;
  sourceDecisionBinding: `sha256:${string}`;
  sourceEvaluationBinding: `sha256:${string}`;
  sourceEvaluationHash: `sha256:${string}`;
  decidedAt: string;
  automationProcessing: "solely_automated" | "partially_automated";
  systemIdentity: `sha256:${string}`;
  systemId: string;
  systemVersion: string;
  machineClass:
    | "text_classifier"
    | "image_classifier"
    | "audio_classifier"
    | "video_classifier"
    | "multimodal_classifier"
    | "rules_engine"
    | "other_machine_class";
  publicDesignation: string;
  automatedOutcome: "pass" | "fail";
  referenceLabelState: "unlabeled";
}>;

export type ReferenceSystemSampleSizePlan = Readonly<{
  systemId: string;
  systemVersion: string;
  automatedFail: number;
  automatedPass: number;
}>;

export type ReferenceFrameSourceBinding = Readonly<{
  workspaceId: string;
  projectId: string;
  benchmarkId: string;
  activationReference: string;
  deploymentKey: string;
  contextAuthority: "workspace_manager_asserted_context";
  populationId: string;
  populationVersion: number;
  populationContractHash: `sha256:${string}`;
  populationRoot: `sha256:${string}`;
  populationFrozenAt: string;
  reportingWindow: Readonly<{ startInclusive: string; endExclusive: string }>;
  populationCount: number;
  eligibleDrawUnitCount: number;
  evaluatedDecisionCount: number;
  notAutomatedDecisionCount: number;
  excludedDecisionCount: number;
}>;

export type ReferenceFrameWitness = Readonly<{
  kind: "database_transaction_and_attestation";
  witnessId: string;
  sourceFrozenAt: string;
  committedAt: string;
  auditHeadDigest: `sha256:${string}`;
}>;

export type ReferenceFrameCommitment = Readonly<{
  schemaVersion: typeof REFERENCE_FRAME_SCHEMA_VERSION;
  frameId: string;
  purpose: string;
  source: ReferenceFrameSourceBinding;
  witness: ReferenceFrameWitness;
  beaconNetwork: "quicknet" | "quicknet-t";
  beaconRound: number;
  methodVersion: typeof REFERENCE_SAMPLING_METHOD_VERSION;
  sampleSizePlan: Readonly<{
    planId: string;
    version: number;
    methodReviewStatus: "pending_external_method_review";
    adequacy: "pilot_unvalidated";
    intendedEstimands: typeof REFERENCE_SAMPLE_INTENDED_ESTIMANDS;
    limitations: typeof REFERENCE_SAMPLE_PLAN_LIMITATIONS;
  }>;
  strata: readonly Readonly<{
    systemIdentity: `sha256:${string}`;
    systemId: string;
    systemVersion: string;
    automatedOutcome: "pass" | "fail";
    eligibleCount: number;
    sampleSize: number;
    gap: "absent_stratum" | null;
  }>[];
  frameRoot: `sha256:${string}`;
  commitmentDigest: `sha256:${string}`;
}>;

export type FrozenReferenceSample = Readonly<{
  schemaVersion: typeof REFERENCE_SAMPLE_SCHEMA_VERSION;
  commitmentDigest: `sha256:${string}`;
  beacon: Readonly<{
    network: "quicknet" | "quicknet-t";
    chainHash: string;
    round: number;
    randomness: `0x${string}`;
    signature: `0x${string}`;
  }>;
  seedDigest: `sha256:${string}`;
  strata: readonly Readonly<{
    systemIdentity: `sha256:${string}`;
    systemId: string;
    systemVersion: string;
    automatedOutcome: "pass" | "fail";
    eligibleCount: number;
    selectedCount: number;
    gap: "absent_stratum" | null;
  }>[];
  manifest: readonly Readonly<{
    unitId: string;
    sourceDecisionBinding: `sha256:${string}`;
    sourceEvaluationBinding: `sha256:${string}`;
    sourceEvaluationHash: `sha256:${string}`;
    decidedAt: string;
    automationProcessing: "solely_automated" | "partially_automated";
    systemIdentity: `sha256:${string}`;
    systemId: string;
    systemVersion: string;
    machineClass: ReferenceFrameUnit["machineClass"];
    publicDesignation: string;
    automatedOutcome: "pass" | "fail";
    selected: boolean;
    selectionRank: number;
    inclusionProbability: Readonly<{ numerator: number; denominator: number }>;
  }>[];
  manifestRoot: `sha256:${string}`;
  frozenWitness: Readonly<{
    kind: "database_transaction_and_attestation";
    witnessId: string;
    frozenAt: string;
    auditHeadDigest: `sha256:${string}`;
  }>;
  sampleDigest: `sha256:${string}`;
}>;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_reference_sampling_frame", false, field);
}

function portableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasExactKeys(value: object, expected: readonly string[]) {
  const actual = Object.keys(value).sort(portableCompare);
  const normalizedExpected = [...expected].sort(portableCompare);
  return actual.length === normalizedExpected.length && actual.every((key, index) => key === normalizedExpected[index]);
}

function digestRecords(domain: string, header: unknown, rows: readonly unknown[]) {
  const hash = createHash("sha256");
  hash.update(`${domain}\0${canonicalizeRfc8785(header)}\n`, "utf8");
  rows.forEach(row => hash.update(`${canonicalizeRfc8785(row)}\n`, "utf8"));
  return `sha256:${hash.digest("hex")}` as const;
}

export function deriveReferenceSystemIdentity(input: { systemId: string; systemVersion: string }) {
  if (!IDENTIFIER.test(input.systemId) || !IDENTIFIER.test(input.systemVersion)) {
    invalid("Reference system identity is invalid.", "systemId");
  }
  return sha256Rfc8785({ systemId: input.systemId, systemVersion: input.systemVersion });
}

function normalizeUnits(units: readonly ReferenceFrameUnit[]) {
  if (!Array.isArray(units) || units.length === 0 || units.length > MAX_FRAME_UNITS) {
    invalid(`Reference frames must contain between 1 and ${MAX_FRAME_UNITS} units.`, "units");
  }
  const normalized = units.map(unit => {
    if (
      !unit ||
      typeof unit !== "object" ||
      !hasExactKeys(unit, [
        "unitId",
        "sourceDecisionBinding",
        "sourceEvaluationBinding",
        "sourceEvaluationHash",
        "decidedAt",
        "automationProcessing",
        "systemIdentity",
        "systemId",
        "systemVersion",
        "machineClass",
        "publicDesignation",
        "automatedOutcome",
        "referenceLabelState",
      ]) ||
      !UNIT_ID.test(unit.unitId) ||
      !SHA256.test(unit.sourceDecisionBinding) ||
      !SHA256.test(unit.sourceEvaluationBinding) ||
      !SHA256.test(unit.sourceEvaluationHash) ||
      (unit.automationProcessing !== "solely_automated" && unit.automationProcessing !== "partially_automated") ||
      !SHA256.test(unit.systemIdentity) ||
      unit.systemIdentity !== deriveReferenceSystemIdentity(unit) ||
      !MACHINE_CLASSES.has(unit.machineClass) ||
      typeof unit.publicDesignation !== "string" ||
      unit.publicDesignation !== unit.publicDesignation.trim() ||
      !PUBLIC_DESIGNATION.test(unit.publicDesignation) ||
      FORMULA_LEADING.test(unit.publicDesignation) ||
      (unit.automatedOutcome !== "pass" && unit.automatedOutcome !== "fail") ||
      unit.referenceLabelState !== "unlabeled"
    ) {
      invalid("Reference frame units require the exact pre-label source projection.", "units");
    }
    const decidedAt = new Date(unit.decidedAt);
    if (!Number.isFinite(decidedAt.getTime()) || decidedAt.toISOString() !== unit.decidedAt) {
      invalid("Reference frame decision timestamps must be canonical UTC timestamps.", "units");
    }
    return { ...unit };
  });
  normalized.sort((left, right) => portableCompare(left.unitId, right.unitId));
  if (new Set(normalized.map(unit => unit.unitId)).size !== normalized.length) {
    invalid("A reference frame unit may appear only once, including across strata.", "units");
  }
  if (new Set(normalized.map(unit => unit.sourceEvaluationBinding)).size !== normalized.length) {
    invalid("A source evaluation may bind only one reference frame unit.", "units");
  }
  const systemDescriptors = new Map<string, string>();
  normalized.forEach(unit => {
    const descriptor = canonicalizeRfc8785({
      systemId: unit.systemId,
      systemVersion: unit.systemVersion,
      machineClass: unit.machineClass,
      publicDesignation: unit.publicDesignation,
    });
    const existing = systemDescriptors.get(unit.systemIdentity);
    if (existing && existing !== descriptor) {
      invalid("A system identity must have one public descriptor throughout the frame.", "units");
    }
    systemDescriptors.set(unit.systemIdentity, descriptor);
  });
  return normalized;
}

function normalizeSampleSizes(
  units: readonly ReferenceFrameUnit[],
  sampleSizes: readonly ReferenceSystemSampleSizePlan[],
) {
  if (!Array.isArray(sampleSizes) || sampleSizes.length === 0) {
    invalid("Reference sample sizes are invalid.", "sampleSizes");
  }
  const systems = new Map<string, { systemId: string; systemVersion: string }>();
  const eligible = new Map<string, number>();
  units.forEach(unit => {
    systems.set(unit.systemIdentity, { systemId: unit.systemId, systemVersion: unit.systemVersion });
    const key = `${unit.systemIdentity}:${unit.automatedOutcome}`;
    eligible.set(key, (eligible.get(key) ?? 0) + 1);
  });
  const plans = new Map<string, ReferenceSystemSampleSizePlan>();
  sampleSizes.forEach(plan => {
    if (
      !plan ||
      typeof plan !== "object" ||
      !hasExactKeys(plan, ["systemId", "systemVersion", "automatedFail", "automatedPass"])
    ) {
      invalid("Each system needs an exact two-cell sample-size plan.", "sampleSizes");
    }
    const identity = deriveReferenceSystemIdentity(plan);
    if (plans.has(identity)) invalid("A system sample-size plan may appear only once.", "sampleSizes");
    if (
      !Number.isSafeInteger(plan.automatedFail) ||
      plan.automatedFail < 0 ||
      !Number.isSafeInteger(plan.automatedPass) ||
      plan.automatedPass < 0
    ) {
      invalid("System sample sizes must be non-negative safe integers.", "sampleSizes");
    }
    plans.set(identity, { ...plan });
  });
  if (plans.size !== systems.size || [...systems.keys()].some(identity => !plans.has(identity))) {
    invalid("Every and only represented system versions require a sample-size plan.", "sampleSizes");
  }
  return [...systems.entries()]
    .sort(([left], [right]) => portableCompare(left, right))
    .flatMap(([systemIdentity, system]) =>
      (["fail", "pass"] as const).map(automatedOutcome => {
        const eligibleCount = eligible.get(`${systemIdentity}:${automatedOutcome}`) ?? 0;
        const plan = plans.get(systemIdentity)!;
        const sampleSize = automatedOutcome === "fail" ? plan.automatedFail : plan.automatedPass;
        if (sampleSize > eligibleCount || (eligibleCount === 0 ? sampleSize !== 0 : sampleSize < 1)) {
          invalid(
            "Each present system-by-outcome stratum needs a positive sample no larger than its frame.",
            "sampleSizes",
          );
        }
        return {
          systemIdentity: systemIdentity as `sha256:${string}`,
          ...system,
          automatedOutcome,
          eligibleCount,
          sampleSize,
          gap: eligibleCount === 0 ? ("absent_stratum" as const) : null,
        };
      }),
    );
}

function roundAvailabilityMilliseconds(network: "quicknet" | "quicknet-t", round: number) {
  if (!Number.isSafeInteger(round) || round <= 0)
    invalid("Beacon round must be a positive safe integer.", "beaconRound");
  const chain = PINNED_DRAND_CHAINS[network];
  return (BigInt(chain.genesisTime) + (BigInt(round) - 1n) * BigInt(chain.period)) * 1_000n;
}

function canonicalTimestamp(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) invalid(`${field} is invalid.`, field);
  return parsed;
}

function normalizeSource(source: ReferenceFrameSourceBinding, units: readonly ReferenceFrameUnit[]) {
  if (
    !source ||
    typeof source !== "object" ||
    !hasExactKeys(source, [
      "workspaceId",
      "projectId",
      "benchmarkId",
      "activationReference",
      "deploymentKey",
      "contextAuthority",
      "populationId",
      "populationVersion",
      "populationContractHash",
      "populationRoot",
      "populationFrozenAt",
      "reportingWindow",
      "populationCount",
      "eligibleDrawUnitCount",
      "evaluatedDecisionCount",
      "notAutomatedDecisionCount",
      "excludedDecisionCount",
    ]) ||
    !IDENTIFIER.test(source.workspaceId) ||
    !IDENTIFIER.test(source.projectId) ||
    !IDENTIFIER.test(source.benchmarkId) ||
    !IDENTIFIER.test(source.activationReference) ||
    !IDENTIFIER.test(source.deploymentKey) ||
    source.contextAuthority !== "workspace_manager_asserted_context" ||
    !IDENTIFIER.test(source.populationId) ||
    !Number.isSafeInteger(source.populationVersion) ||
    source.populationVersion <= 0 ||
    !SHA256.test(source.populationContractHash) ||
    !SHA256.test(source.populationRoot) ||
    typeof source.populationFrozenAt !== "string" ||
    !Number.isSafeInteger(source.populationCount) ||
    !Number.isSafeInteger(source.eligibleDrawUnitCount) ||
    !Number.isSafeInteger(source.evaluatedDecisionCount) ||
    !Number.isSafeInteger(source.notAutomatedDecisionCount) ||
    !Number.isSafeInteger(source.excludedDecisionCount) ||
    source.populationCount < 1 ||
    source.eligibleDrawUnitCount !== units.length ||
    source.evaluatedDecisionCount < 0 ||
    source.notAutomatedDecisionCount < 0 ||
    source.excludedDecisionCount < 0 ||
    source.evaluatedDecisionCount + source.notAutomatedDecisionCount + source.excludedDecisionCount !==
      source.populationCount ||
    !source.reportingWindow ||
    typeof source.reportingWindow !== "object" ||
    !hasExactKeys(source.reportingWindow, ["startInclusive", "endExclusive"])
  ) {
    invalid("Reference frame source binding is invalid.", "source");
  }
  const start = canonicalTimestamp(source.reportingWindow.startInclusive, "source.reportingWindow.startInclusive");
  const end = canonicalTimestamp(source.reportingWindow.endExclusive, "source.reportingWindow.endExclusive");
  const populationFrozenAt = canonicalTimestamp(source.populationFrozenAt, "source.populationFrozenAt");
  if (end <= start) invalid("Reference frame reporting window is invalid.", "source.reportingWindow");
  if (populationFrozenAt < end) {
    invalid("The population freeze must follow the complete reporting window.", "source.populationFrozenAt");
  }
  if (units.some(unit => new Date(unit.decidedAt) < start || new Date(unit.decidedAt) >= end)) {
    invalid("Every reference frame unit must fall inside the bound reporting window.", "units");
  }
  return structuredClone(source);
}

function normalizeCommitWitness(
  witness: ReferenceFrameWitness,
  beaconNetwork: "quicknet" | "quicknet-t",
  beaconRound: number,
) {
  if (
    !witness ||
    typeof witness !== "object" ||
    !hasExactKeys(witness, ["kind", "witnessId", "sourceFrozenAt", "committedAt", "auditHeadDigest"]) ||
    witness.kind !== "database_transaction_and_attestation" ||
    !IDENTIFIER.test(witness.witnessId) ||
    !SHA256.test(witness.auditHeadDigest)
  ) {
    invalid("Reference frame witness is invalid.", "witness");
  }
  const sourceFrozenAt = canonicalTimestamp(witness.sourceFrozenAt, "witness.sourceFrozenAt");
  const committedAt = canonicalTimestamp(witness.committedAt, "witness.committedAt");
  if (committedAt < sourceFrozenAt) {
    invalid("The commitment cannot predate its complete source projection.", "witness.committedAt");
  }
  const availability = roundAvailabilityMilliseconds(beaconNetwork, beaconRound);
  if (availability - BigInt(committedAt.getTime()) < BigInt(MINIMUM_BEACON_LEAD_MS)) {
    invalid("The witnessed commitment must precede beacon availability by at least five minutes.", "beaconRound");
  }
  return structuredClone(witness);
}

function normalizeFrozenWitness(witness: FrozenReferenceSample["frozenWitness"], commitment: ReferenceFrameCommitment) {
  if (
    !witness ||
    typeof witness !== "object" ||
    !hasExactKeys(witness, ["kind", "witnessId", "frozenAt", "auditHeadDigest"]) ||
    witness.kind !== "database_transaction_and_attestation" ||
    !IDENTIFIER.test(witness.witnessId) ||
    !SHA256.test(witness.auditHeadDigest)
  ) {
    invalid("Frozen reference sample witness is invalid.", "frozenWitness");
  }
  const frozenAt = canonicalTimestamp(witness.frozenAt, "frozenWitness.frozenAt");
  if (
    BigInt(frozenAt.getTime()) < roundAvailabilityMilliseconds(commitment.beaconNetwork, commitment.beaconRound) ||
    frozenAt < new Date(commitment.witness.committedAt)
  ) {
    invalid("A frozen sample witness must follow commitment and beacon availability.", "frozenWitness");
  }
  return structuredClone(witness);
}

function withoutDigest<T extends { commitmentDigest: string }>(value: T) {
  const payload = { ...value } as Omit<T, "commitmentDigest"> & { commitmentDigest?: string };
  delete payload.commitmentDigest;
  return payload;
}

function validateCommitment(commitment: ReferenceFrameCommitment, units: readonly ReferenceFrameUnit[]) {
  if (
    !commitment ||
    typeof commitment !== "object" ||
    !hasExactKeys(commitment, [
      "schemaVersion",
      "frameId",
      "purpose",
      "source",
      "witness",
      "beaconNetwork",
      "beaconRound",
      "methodVersion",
      "sampleSizePlan",
      "strata",
      "frameRoot",
      "commitmentDigest",
    ])
  ) {
    invalid("Reference frame commitment is invalid.");
  }
  if (
    commitment.schemaVersion !== REFERENCE_FRAME_SCHEMA_VERSION ||
    commitment.methodVersion !== REFERENCE_SAMPLING_METHOD_VERSION ||
    !IDENTIFIER.test(commitment.frameId) ||
    !LOWER_IDENTIFIER.test(commitment.purpose) ||
    !SHA256.test(commitment.frameRoot) ||
    !SHA256.test(commitment.commitmentDigest) ||
    (commitment.beaconNetwork !== "quicknet" && commitment.beaconNetwork !== "quicknet-t") ||
    !commitment.sampleSizePlan ||
    typeof commitment.sampleSizePlan !== "object" ||
    !hasExactKeys(commitment.sampleSizePlan, [
      "planId",
      "version",
      "methodReviewStatus",
      "adequacy",
      "intendedEstimands",
      "limitations",
    ]) ||
    !IDENTIFIER.test(commitment.sampleSizePlan.planId) ||
    !Number.isSafeInteger(commitment.sampleSizePlan.version) ||
    commitment.sampleSizePlan.version <= 0 ||
    canonicalizeRfc8785(commitment.sampleSizePlan) !==
      canonicalizeRfc8785({
        planId: commitment.sampleSizePlan.planId,
        version: commitment.sampleSizePlan.version,
        methodReviewStatus: "pending_external_method_review",
        adequacy: "pilot_unvalidated",
        intendedEstimands: REFERENCE_SAMPLE_INTENDED_ESTIMANDS,
        limitations: REFERENCE_SAMPLE_PLAN_LIMITATIONS,
      }) ||
    !Array.isArray(commitment.strata)
  ) {
    invalid("Reference frame commitment is invalid.");
  }
  const source = normalizeSource(commitment.source, units);
  const witness = normalizeCommitWitness(commitment.witness, commitment.beaconNetwork, commitment.beaconRound);
  if (new Date(witness.sourceFrozenAt) < new Date(source.populationFrozenAt)) {
    invalid("The source projection cannot be frozen before its bound population.", "witness.sourceFrozenAt");
  }
  const expectedRoot = digestRecords("rateloop.reference-sampling-frame-units.v2", { source }, units);
  if (
    expectedRoot !== commitment.frameRoot ||
    sha256Rfc8785(withoutDigest(commitment)) !== commitment.commitmentDigest
  ) {
    invalid("Reference frame commitment does not match the supplied frame.");
  }
  if (
    commitment.strata.length === 0 ||
    commitment.strata.some(
      stratum =>
        !stratum ||
        typeof stratum !== "object" ||
        !hasExactKeys(stratum, [
          "systemIdentity",
          "systemId",
          "systemVersion",
          "automatedOutcome",
          "eligibleCount",
          "sampleSize",
          "gap",
        ]),
    )
  ) {
    invalid("Reference frame strata do not reconcile with the supplied frame.");
  }
  const planBySystem = new Map<string, ReferenceSystemSampleSizePlan>();
  commitment.strata.forEach(stratum => {
    if (
      !SHA256.test(stratum.systemIdentity) ||
      stratum.systemIdentity !== deriveReferenceSystemIdentity(stratum) ||
      (stratum.automatedOutcome !== "pass" && stratum.automatedOutcome !== "fail")
    ) {
      invalid("Reference frame strata do not reconcile with the supplied frame.");
    }
    const current = planBySystem.get(stratum.systemIdentity) ?? {
      systemId: stratum.systemId,
      systemVersion: stratum.systemVersion,
      automatedFail: -1,
      automatedPass: -1,
    };
    if (current.systemId !== stratum.systemId || current.systemVersion !== stratum.systemVersion) {
      invalid("Reference frame strata do not reconcile with the supplied frame.");
    }
    const field = stratum.automatedOutcome === "fail" ? "automatedFail" : "automatedPass";
    if (current[field] !== -1) invalid("Reference frame strata contain a duplicate cell.");
    planBySystem.set(stratum.systemIdentity, { ...current, [field]: stratum.sampleSize });
  });
  const plans = [...planBySystem.values()];
  if (plans.some(plan => plan.automatedFail < 0 || plan.automatedPass < 0)) {
    invalid("Every represented system requires both outcome cells.");
  }
  const expectedStrata = normalizeSampleSizes(units, plans);
  if (canonicalizeRfc8785(commitment.strata) !== canonicalizeRfc8785(expectedStrata)) {
    invalid("Reference frame strata do not reconcile with the supplied frame.");
  }
}

/**
 * Deterministic commitment core. The persistence adapter is responsible for deriving
 * `source`, `units`, and `witness` inside one database transaction, enforcing the one-
 * controlling-epoch rule, and publishing the audit head before the beacon lead closes.
 * Route or client input must never be passed here as authoritative evidence.
 */
export function createReferenceFrameCommitment(input: {
  frameId: string;
  purpose: string;
  source: ReferenceFrameSourceBinding;
  witness: ReferenceFrameWitness;
  units: readonly ReferenceFrameUnit[];
  sampleSizes: readonly ReferenceSystemSampleSizePlan[];
  sampleSizePlanId: string;
  sampleSizePlanVersion: number;
  beaconNetwork: "quicknet" | "quicknet-t";
  beaconRound: number;
}): ReferenceFrameCommitment {
  if (!IDENTIFIER.test(input.frameId) || !LOWER_IDENTIFIER.test(input.purpose)) {
    invalid("Reference frame identity is invalid.");
  }
  if (input.beaconNetwork !== "quicknet" && input.beaconNetwork !== "quicknet-t") {
    invalid("Reference frame beacon network is unsupported.", "beaconNetwork");
  }
  const units = normalizeUnits(input.units);
  const source = normalizeSource(input.source, units);
  const witness = normalizeCommitWitness(input.witness, input.beaconNetwork, input.beaconRound);
  if (new Date(witness.sourceFrozenAt) < new Date(source.populationFrozenAt)) {
    invalid("The source projection cannot be frozen before its bound population.", "witness.sourceFrozenAt");
  }
  const strata = normalizeSampleSizes(units, input.sampleSizes);
  if (
    !IDENTIFIER.test(input.sampleSizePlanId) ||
    !Number.isSafeInteger(input.sampleSizePlanVersion) ||
    input.sampleSizePlanVersion <= 0
  ) {
    invalid("Reference sample-size plan identity is invalid.", "sampleSizePlanId");
  }
  const frameRoot = digestRecords("rateloop.reference-sampling-frame-units.v2", { source }, units);
  const payload = {
    schemaVersion: REFERENCE_FRAME_SCHEMA_VERSION,
    frameId: input.frameId,
    purpose: input.purpose,
    source,
    witness,
    beaconNetwork: input.beaconNetwork,
    beaconRound: input.beaconRound,
    methodVersion: REFERENCE_SAMPLING_METHOD_VERSION,
    sampleSizePlan: {
      planId: input.sampleSizePlanId,
      version: input.sampleSizePlanVersion,
      methodReviewStatus: "pending_external_method_review" as const,
      adequacy: "pilot_unvalidated" as const,
      intendedEstimands: REFERENCE_SAMPLE_INTENDED_ESTIMANDS,
      limitations: REFERENCE_SAMPLE_PLAN_LIMITATIONS,
    },
    strata,
    frameRoot,
  };
  return { ...payload, commitmentDigest: sha256Rfc8785(payload) };
}

/**
 * Deterministic freeze core. The persistence adapter must load the committed rows and
 * database/attestation witness; this function verifies bytes but does not confer trust
 * on caller-constructed witness objects.
 */
export function freezeReferenceSample(input: {
  commitment: ReferenceFrameCommitment;
  units: readonly ReferenceFrameUnit[];
  beacon: TokenlessReferenceSampleBeacon;
  frozenWitness: FrozenReferenceSample["frozenWitness"];
}): FrozenReferenceSample {
  const units = normalizeUnits(input.units);
  validateCommitment(input.commitment, units);
  if (
    input.beacon.network !== input.commitment.beaconNetwork ||
    input.beacon.expectedRound !== input.commitment.beaconRound
  ) {
    invalid("Beacon evidence does not match the committed network and round.");
  }
  const verified = verifyTokenlessReferenceSampleBeacon(input.beacon);
  const frozenWitness = normalizeFrozenWitness(input.frozenWitness, input.commitment);
  const seedDigest = deriveTokenlessReferenceSampleSeed({
    ...input.beacon,
    frameDigest: input.commitment.commitmentDigest,
    samplingMethod: input.commitment.methodVersion,
  });
  const stratumKey = (systemIdentity: string, automatedOutcome: "pass" | "fail") =>
    `${systemIdentity}:${automatedOutcome}`;
  const sampleSize = new Map(
    input.commitment.strata.map(stratum => [
      stratumKey(stratum.systemIdentity, stratum.automatedOutcome),
      stratum.sampleSize,
    ]),
  );
  const eligibleCount = new Map(
    input.commitment.strata.map(stratum => [
      stratumKey(stratum.systemIdentity, stratum.automatedOutcome),
      stratum.eligibleCount,
    ]),
  );
  const ranked = units.map(unit => ({
    ...unit,
    samplingStratumKey: stratumKey(unit.systemIdentity, unit.automatedOutcome),
    selectionDigest: sha256Rfc8785({
      domain: "rateloop.reference-sampling-unit-rank.v2",
      commitmentDigest: input.commitment.commitmentDigest,
      seedDigest,
      systemIdentity: unit.systemIdentity,
      automatedOutcome: unit.automatedOutcome,
      unitId: unit.unitId,
    }),
  }));
  const byStratum = new Map<string, typeof ranked>();
  ranked.forEach(unit => {
    const entries = byStratum.get(unit.samplingStratumKey);
    if (entries) entries.push(unit);
    else byStratum.set(unit.samplingStratumKey, [unit]);
  });
  const rankByUnit = new Map<string, number>();
  for (const [stratum, entries] of byStratum) {
    entries.sort(
      (left, right) =>
        portableCompare(left.selectionDigest, right.selectionDigest) || portableCompare(left.unitId, right.unitId),
    );
    entries.forEach((unit, index) => rankByUnit.set(unit.unitId, index + 1));
    if (entries.length !== eligibleCount.get(stratum)) invalid("Reference sample strata changed after commitment.");
  }
  const manifest = ranked.map(unit => {
    const selectionRank = rankByUnit.get(unit.unitId)!;
    const numerator = sampleSize.get(unit.samplingStratumKey)!;
    const denominator = eligibleCount.get(unit.samplingStratumKey)!;
    return {
      unitId: unit.unitId,
      sourceDecisionBinding: unit.sourceDecisionBinding,
      sourceEvaluationBinding: unit.sourceEvaluationBinding,
      sourceEvaluationHash: unit.sourceEvaluationHash,
      decidedAt: unit.decidedAt,
      automationProcessing: unit.automationProcessing,
      systemIdentity: unit.systemIdentity,
      systemId: unit.systemId,
      systemVersion: unit.systemVersion,
      machineClass: unit.machineClass,
      publicDesignation: unit.publicDesignation,
      automatedOutcome: unit.automatedOutcome,
      selected: selectionRank <= numerator,
      selectionRank,
      inclusionProbability: { numerator, denominator },
    };
  });
  const selectedCounts = new Map<string, number>();
  manifest.forEach(unit => {
    const key = stratumKey(unit.systemIdentity, unit.automatedOutcome);
    if (unit.selected) selectedCounts.set(key, (selectedCounts.get(key) ?? 0) + 1);
  });
  const strata = input.commitment.strata.map(stratum => ({
    systemIdentity: stratum.systemIdentity,
    systemId: stratum.systemId,
    systemVersion: stratum.systemVersion,
    automatedOutcome: stratum.automatedOutcome,
    eligibleCount: stratum.eligibleCount,
    selectedCount: selectedCounts.get(stratumKey(stratum.systemIdentity, stratum.automatedOutcome)) ?? 0,
    gap: stratum.gap,
  }));
  const manifestRoot = digestRecords(
    "rateloop.reference-sample-manifest.v2",
    { commitmentDigest: input.commitment.commitmentDigest, seedDigest },
    manifest,
  );
  const payload = {
    schemaVersion: REFERENCE_SAMPLE_SCHEMA_VERSION,
    commitmentDigest: input.commitment.commitmentDigest,
    beacon: {
      network: input.beacon.network,
      chainHash: verified.chain.chainHash,
      round: verified.round,
      randomness: verified.randomness,
      signature: verified.signature,
    },
    seedDigest,
    strata,
    manifest,
    manifestRoot,
    frozenWitness,
  };
  return {
    ...payload,
    sampleDigest: sha256Rfc8785({
      schemaVersion: payload.schemaVersion,
      commitmentDigest: payload.commitmentDigest,
      beacon: payload.beacon,
      seedDigest: payload.seedDigest,
      strata: payload.strata,
      manifestRoot: payload.manifestRoot,
      frozenWitness: payload.frozenWitness,
    }),
  };
}

export function verifyFrozenReferenceSample(input: {
  expected: FrozenReferenceSample;
  commitment: ReferenceFrameCommitment;
  units: readonly ReferenceFrameUnit[];
  beacon: TokenlessReferenceSampleBeacon;
  frozenWitness: FrozenReferenceSample["frozenWitness"];
}) {
  const recomputed = freezeReferenceSample(input);
  try {
    if (
      !input.expected ||
      typeof input.expected !== "object" ||
      !hasExactKeys(input.expected, [
        "schemaVersion",
        "commitmentDigest",
        "beacon",
        "seedDigest",
        "strata",
        "manifest",
        "manifestRoot",
        "frozenWitness",
        "sampleDigest",
      ]) ||
      !Array.isArray(input.expected.manifest) ||
      input.expected.manifest.length > MAX_FRAME_UNITS ||
      input.expected.manifest.length !== recomputed.manifest.length ||
      input.expected.manifest.some(
        (row, index) => canonicalizeRfc8785(row) !== canonicalizeRfc8785(recomputed.manifest[index]),
      ) ||
      canonicalizeRfc8785({
        schemaVersion: input.expected.schemaVersion,
        commitmentDigest: input.expected.commitmentDigest,
        beacon: input.expected.beacon,
        seedDigest: input.expected.seedDigest,
        strata: input.expected.strata,
        manifestRoot: input.expected.manifestRoot,
        frozenWitness: input.expected.frozenWitness,
        sampleDigest: input.expected.sampleDigest,
      }) !==
        canonicalizeRfc8785({
          schemaVersion: recomputed.schemaVersion,
          commitmentDigest: recomputed.commitmentDigest,
          beacon: recomputed.beacon,
          seedDigest: recomputed.seedDigest,
          strata: recomputed.strata,
          manifestRoot: recomputed.manifestRoot,
          frozenWitness: recomputed.frozenWitness,
          sampleDigest: recomputed.sampleDigest,
        })
    ) {
      throw new Error("mismatch");
    }
  } catch {
    throw new TokenlessServiceError("Frozen reference sample verification failed.", 400, "reference_sample_mismatch");
  }
  return recomputed;
}

export const __referenceSamplingTestUtils = { roundAvailabilityMilliseconds };
