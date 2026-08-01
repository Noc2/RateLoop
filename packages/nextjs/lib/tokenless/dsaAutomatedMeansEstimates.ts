import { canonicalizeRfc8785, sha256Rfc8785 } from "@rateloop/node-utils/jcs";
import "server-only";
import {
  DSA_PART8_CLASSIFIER_MACHINE_CLASSES,
  DSA_PART8_NOTIFIER_CLASSES,
  DSA_PART8_ORIGINS,
  DSA_PART8_PARTIALLY_AUTOMATED,
  DSA_PART8_SOLELY_AUTOMATED,
  EU_OFFICIAL_LANGUAGE_CODES,
} from "~~/lib/tokenless/dsaPart8SourceFacts";
import { classifyDsaConfusionCell } from "~~/lib/tokenless/dsaReferenceOutcomes";
import {
  type FrozenReferenceSample,
  REFERENCE_SAMPLE_PLAN_LIMITATIONS,
  type ReferenceFrameCommitment,
  type ReferenceFrameUnit,
  verifyFrozenReferenceSample,
} from "~~/lib/tokenless/referenceSampling";
import type { TokenlessReferenceSampleBeacon } from "~~/lib/tokenless/referenceSamplingBeacon";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const DSA_AUTOMATED_MEANS_ESTIMATE_SCHEMA_VERSION = "rateloop.dsa-part8-automated-means-estimate.v3" as const;
export const DSA_AUTOMATED_MEANS_ESTIMATOR_VERSION = "horvitz-thompson-system-stratified-point-estimate-v3" as const;
export const DSA_AUTOMATED_MEANS_MAX_CLASSIFIERS = 64 as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/u;
const UNIT_ID = /^rsu_[A-Za-z0-9_-]{22}$/u;
const MAX_UNITS = 50_000;
const EU_LANGUAGES = new Set<string>(EU_OFFICIAL_LANGUAGE_CODES);

type Rational = Readonly<{ numerator: bigint; denominator: bigint }>;
type EuLanguage = (typeof EU_OFFICIAL_LANGUAGE_CODES)[number];
type Origin = (typeof DSA_PART8_ORIGINS)[number];
type NotifierClass = (typeof DSA_PART8_NOTIFIER_CLASSES)[number];
type MachineClass = (typeof DSA_PART8_CLASSIFIER_MACHINE_CLASSES)[number];

export type DsaAutomatedMeansProviderType =
  | "intermediary_service"
  | "hosting_service"
  | "online_platform"
  | "vlop"
  | "vlose";

export type DsaAutomatedMeansReferenceFact = Readonly<{
  unitId: string;
  sourceDecisionBinding: `sha256:${string}`;
  sourceEvaluationBinding: `sha256:${string}`;
  sourceEvaluationHash: `sha256:${string}`;
  system: Readonly<{
    systemId: string;
    systemVersion: string;
    machineClass: MachineClass;
    publicDesignation: string;
  }>;
  automationProcessing: typeof DSA_PART8_SOLELY_AUTOMATED | typeof DSA_PART8_PARTIALLY_AUTOMATED;
  languageCodes: readonly EuLanguage[];
  origin: Origin;
  notifierClass: NotifierClass | null;
  referenceOutcome: "pass" | "fail" | "uncertain" | null;
  referenceLabelBinding: `sha256:${string}` | null;
}>;

export type DsaAutomatedMeansSystemInventoryEntry = DsaAutomatedMeansReferenceFact["system"];

export type DsaAutomatedMeansMetric = "accuracy" | "precision" | "recall";
export type DsaAutomatedMeansScope =
  | "Total number"
  | "Own-initiative"
  | "NAM Total"
  | "NAM Trusted Flagger"
  | EuLanguage;

export type DsaAutomatedMeansEstimateCell = Readonly<{
  system: DsaAutomatedMeansSystemInventoryEntry;
  scope: DsaAutomatedMeansScope;
  metric: DsaAutomatedMeansMetric;
  populationCount: number;
  selectedCount: number;
  completedCount: number;
  weightedConfusion: Readonly<{
    truePositive: string;
    falsePositive: string;
    trueNegative: string;
    falseNegative: string;
  }>;
  result:
    | Readonly<{
        status: "internal_point_estimate";
        exactNumerator: string;
        exactDenominator: string;
        decimal: string;
        interval: null;
        publicationEligible: false;
      }>
    | Readonly<{
        status: "coverage_gap";
        code:
          | "empty_scope"
          | "no_selected_reference_units"
          | "no_completed_reference_units"
          | "missing_selected_reference_outcome"
          | "zero_denominator"
          | "estimate_out_of_bounds";
        value: null;
        publicationEligible: false;
      }>;
  limitations: typeof REFERENCE_SAMPLE_PLAN_LIMITATIONS;
}>;

export type DsaAutomatedMeansEstimateInput = Readonly<{
  providerType: DsaAutomatedMeansProviderType;
  systemInventory: readonly DsaAutomatedMeansSystemInventoryEntry[];
  commitment: ReferenceFrameCommitment;
  frameUnits: readonly ReferenceFrameUnit[];
  sample: FrozenReferenceSample;
  beacon: TokenlessReferenceSampleBeacon;
  frozenWitness: FrozenReferenceSample["frozenWitness"];
  facts: readonly DsaAutomatedMeansReferenceFact[];
}>;

function invalid(message: string, field?: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_dsa_automated_means_estimate", false, field);
}

function portableCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: object, expected: readonly string[]) {
  const actual = Object.keys(value).sort(portableCompare);
  const normalized = [...expected].sort(portableCompare);
  return actual.length === normalized.length && actual.every((key, index) => key === normalized[index]);
}

function gcd(left: bigint, right: bigint) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator <= 0n) invalid("Estimate denominators must be positive.");
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function add(left: Rational, right: Rational) {
  return rational(
    left.numerator * right.denominator + right.numerator * left.denominator,
    left.denominator * right.denominator,
  );
}

function divide(left: Rational, right: Rational) {
  if (right.numerator === 0n) return null;
  return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

function decimal(value: Rational, digits = 8) {
  const scale = 10n ** BigInt(digits);
  const rounded = (value.numerator * scale * 2n + value.denominator) / (2n * value.denominator);
  const whole = rounded / scale;
  const fraction = (rounded % scale).toString().padStart(digits, "0").replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function rationalText(value: Rational) {
  return `${value.numerator}/${value.denominator}`;
}

function classifierKey(classifier: DsaAutomatedMeansSystemInventoryEntry) {
  return `${classifier.systemId}\u0000${classifier.systemVersion}\u0000${classifier.machineClass}`;
}

function classifierIdentity(classifier: DsaAutomatedMeansSystemInventoryEntry) {
  return `${classifier.systemId}\u0000${classifier.systemVersion}`;
}

function normalizeSystemInventory(inventory: readonly DsaAutomatedMeansSystemInventoryEntry[]) {
  if (!Array.isArray(inventory) || inventory.length === 0 || inventory.length > DSA_AUTOMATED_MEANS_MAX_CLASSIFIERS) {
    invalid(
      `systemInventory must contain between 1 and ${DSA_AUTOMATED_MEANS_MAX_CLASSIFIERS} systems.`,
      "systemInventory",
    );
  }
  const normalized = inventory.map((system, index) => {
    if (
      !system ||
      typeof system !== "object" ||
      !exactKeys(system, ["systemId", "systemVersion", "machineClass", "publicDesignation"]) ||
      !IDENTIFIER.test(system.systemId) ||
      !IDENTIFIER.test(system.systemVersion) ||
      !DSA_PART8_CLASSIFIER_MACHINE_CLASSES.includes(system.machineClass) ||
      typeof system.publicDesignation !== "string" ||
      system.publicDesignation.trim() !== system.publicDesignation ||
      system.publicDesignation.length === 0 ||
      system.publicDesignation.length > 160 ||
      /[\u0000-\u001f\u007f]/u.test(system.publicDesignation) ||
      /^[=+@-]/u.test(system.publicDesignation)
    ) {
      invalid("systemInventory contains an invalid classifier.", `systemInventory[${index}]`);
    }
    return { ...system };
  });
  const keys = normalized.map(classifierKey);
  const identities = normalized.map(classifierIdentity);
  const designations = normalized.map(system => system.publicDesignation.toLocaleLowerCase("en-US"));
  if (
    new Set(keys).size !== keys.length ||
    new Set(identities).size !== identities.length ||
    new Set(designations).size !== designations.length ||
    keys.some((key, index) => index > 0 && portableCompare(keys[index - 1]!, key) >= 0)
  ) {
    invalid("systemInventory must be canonical with unique system/version identities.", "systemInventory");
  }
  return normalized;
}

function normalizeFacts(
  facts: readonly DsaAutomatedMeansReferenceFact[],
  sample: FrozenReferenceSample,
  inventory: readonly DsaAutomatedMeansSystemInventoryEntry[],
) {
  if (
    !Array.isArray(facts) ||
    facts.length === 0 ||
    facts.length > MAX_UNITS ||
    facts.length !== sample.manifest.length
  ) {
    invalid("Automated-means facts must cover the complete verified sample manifest.", "facts");
  }
  const normalized = facts.map(fact => {
    if (
      !fact ||
      typeof fact !== "object" ||
      !exactKeys(fact, [
        "unitId",
        "sourceDecisionBinding",
        "sourceEvaluationBinding",
        "sourceEvaluationHash",
        "system",
        "automationProcessing",
        "languageCodes",
        "origin",
        "notifierClass",
        "referenceOutcome",
        "referenceLabelBinding",
      ]) ||
      !UNIT_ID.test(fact.unitId) ||
      !SHA256.test(fact.sourceDecisionBinding) ||
      !SHA256.test(fact.sourceEvaluationBinding) ||
      !SHA256.test(fact.sourceEvaluationHash) ||
      !fact.system ||
      typeof fact.system !== "object" ||
      !exactKeys(fact.system, ["systemId", "systemVersion", "machineClass", "publicDesignation"]) ||
      !IDENTIFIER.test(fact.system.systemId) ||
      !IDENTIFIER.test(fact.system.systemVersion) ||
      !DSA_PART8_CLASSIFIER_MACHINE_CLASSES.includes(fact.system.machineClass) ||
      typeof fact.system.publicDesignation !== "string" ||
      (fact.automationProcessing !== DSA_PART8_SOLELY_AUTOMATED &&
        fact.automationProcessing !== DSA_PART8_PARTIALLY_AUTOMATED) ||
      !Array.isArray(fact.languageCodes) ||
      fact.languageCodes.some((code: string) => !EU_LANGUAGES.has(code)) ||
      [...fact.languageCodes].sort(portableCompare).some((code, index) => code !== fact.languageCodes[index]) ||
      new Set(fact.languageCodes).size !== fact.languageCodes.length ||
      !DSA_PART8_ORIGINS.includes(fact.origin) ||
      (fact.notifierClass !== null && !DSA_PART8_NOTIFIER_CLASSES.includes(fact.notifierClass)) ||
      (fact.origin === "article16_notice" ? fact.notifierClass === null : fact.notifierClass !== null) ||
      (fact.referenceOutcome !== null &&
        fact.referenceOutcome !== "pass" &&
        fact.referenceOutcome !== "fail" &&
        fact.referenceOutcome !== "uncertain") ||
      (fact.referenceLabelBinding !== null && !SHA256.test(fact.referenceLabelBinding)) ||
      (fact.referenceOutcome === null) !== (fact.referenceLabelBinding === null)
    ) {
      invalid("Automated-means reference facts are invalid.", "facts");
    }
    return structuredClone(fact);
  });
  normalized.sort((left, right) => portableCompare(left.unitId, right.unitId));
  if (
    new Set(normalized.map(fact => fact.unitId)).size !== normalized.length ||
    new Set(normalized.map(fact => fact.sourceEvaluationBinding)).size !== normalized.length ||
    new Set(normalized.filter(fact => fact.referenceLabelBinding !== null).map(fact => fact.referenceLabelBinding))
      .size !== normalized.filter(fact => fact.referenceLabelBinding !== null).length
  ) {
    invalid("Automated-means facts and reference labels must be unique.", "facts");
  }
  const inventoryByKey = new Map(inventory.map(system => [classifierKey(system), system]));
  if (
    normalized.some(fact => {
      const system = inventoryByKey.get(classifierKey(fact.system));
      return !system || canonicalizeRfc8785(system) !== canonicalizeRfc8785(fact.system);
    })
  ) {
    invalid("A reference fact uses a classifier absent from the complete system inventory.", "facts");
  }
  normalized.forEach((fact, index) => {
    const manifest = sample.manifest[index];
    if (
      !manifest ||
      manifest.unitId !== fact.unitId ||
      manifest.sourceDecisionBinding !== fact.sourceDecisionBinding ||
      manifest.sourceEvaluationBinding !== fact.sourceEvaluationBinding ||
      manifest.sourceEvaluationHash !== fact.sourceEvaluationHash ||
      manifest.automationProcessing !== fact.automationProcessing ||
      manifest.systemId !== fact.system.systemId ||
      manifest.systemVersion !== fact.system.systemVersion ||
      manifest.machineClass !== fact.system.machineClass ||
      manifest.publicDesignation !== fact.system.publicDesignation ||
      (manifest.selected ? fact.referenceOutcome === null : fact.referenceOutcome !== null)
    ) {
      invalid("Automated-means facts must match every verified sample unit and selection.", "facts");
    }
  });
  return normalized;
}

function estimateMetric(
  metric: DsaAutomatedMeansMetric,
  populationCount: number,
  cells: { tp: Rational; fp: Rational; tn: Rational; fn: Rational },
) {
  const correct = add(cells.tp, cells.tn);
  const estimate =
    metric === "accuracy"
      ? rational(correct.numerator, correct.denominator * BigInt(populationCount))
      : metric === "precision"
        ? divide(cells.tp, add(cells.tp, cells.fp))
        : divide(cells.tp, add(cells.tp, cells.fn));
  if (estimate === null) {
    return {
      status: "coverage_gap" as const,
      code: "zero_denominator" as const,
      value: null,
      publicationEligible: false as const,
    };
  }
  if (estimate.numerator < 0n || estimate.numerator > estimate.denominator) {
    return {
      status: "coverage_gap" as const,
      code: "estimate_out_of_bounds" as const,
      value: null,
      publicationEligible: false as const,
    };
  }
  return {
    status: "internal_point_estimate" as const,
    exactNumerator: estimate.numerator.toString(),
    exactDenominator: estimate.denominator.toString(),
    decimal: decimal(estimate),
    interval: null,
    publicationEligible: false as const,
  };
}

function scopesFor(providerType: DsaAutomatedMeansProviderType) {
  if (
    !(["intermediary_service", "hosting_service", "online_platform", "vlop", "vlose"] as const).includes(providerType)
  ) {
    invalid("Automated-means provider type is invalid.", "providerType");
  }
  const scopes: DsaAutomatedMeansScope[] = ["Total number", "Own-initiative"];
  if (providerType === "hosting_service" || providerType === "online_platform" || providerType === "vlop") {
    scopes.push("NAM Total");
  }
  if (providerType === "online_platform" || providerType === "vlop") scopes.push("NAM Trusted Flagger");
  if (providerType === "vlop") scopes.push(...EU_OFFICIAL_LANGUAGE_CODES);
  return scopes;
}

function inScope(fact: DsaAutomatedMeansReferenceFact, scope: DsaAutomatedMeansScope) {
  if (scope === "Total number") return true;
  if (scope === "Own-initiative") return fact.origin === "own_initiative";
  if (scope === "NAM Total") return fact.origin === "article16_notice";
  if (scope === "NAM Trusted Flagger") {
    return fact.origin === "article16_notice" && fact.notifierClass === "trusted_flagger";
  }
  return fact.languageCodes.includes(scope);
}

/**
 * Deterministic calculation and offline-verification core. A persistence adapter must
 * load the commitment, complete frame, frozen sample, immutable Part 8 facts, and
 * accepted reference labels from their authoritative append-only records. This helper
 * verifies all cross-artifact bindings but does not confer trust on caller-built facts.
 */
export function estimateDsaAutomatedMeansMetrics(input: DsaAutomatedMeansEstimateInput) {
  if (
    !input ||
    typeof input !== "object" ||
    !exactKeys(input, [
      "providerType",
      "systemInventory",
      "commitment",
      "frameUnits",
      "sample",
      "beacon",
      "frozenWitness",
      "facts",
    ])
  ) {
    invalid("Automated-means estimate input is invalid.");
  }
  const sample = verifyFrozenReferenceSample({
    expected: input.sample,
    commitment: input.commitment,
    units: input.frameUnits,
    beacon: input.beacon,
    frozenWitness: input.frozenWitness,
  });
  const systemInventory = normalizeSystemInventory(input.systemInventory);
  const facts = normalizeFacts(input.facts, sample, systemInventory);
  const manifestByUnit = new Map(sample.manifest.map(row => [row.unitId, row]));
  const output: DsaAutomatedMeansEstimateCell[] = [];
  for (const system of systemInventory) {
    const key = classifierKey(system);
    const systemFacts = facts.filter(fact => classifierKey(fact.system) === key);
    for (const scope of scopesFor(input.providerType)) {
      const population = systemFacts.filter(fact => inScope(fact, scope));
      for (const metric of ["accuracy", "precision", "recall"] as const) {
        const selected = population.filter(fact => manifestByUnit.get(fact.unitId)?.selected);
        const complete = selected.filter(
          (fact): fact is typeof fact & { referenceOutcome: "pass" | "fail" } =>
            fact.referenceOutcome === "pass" || fact.referenceOutcome === "fail",
        );
        const zero = rational(0n, 1n);
        const cells = { tp: zero, fp: zero, tn: zero, fn: zero };
        for (const fact of complete) {
          const manifest = manifestByUnit.get(fact.unitId)!;
          const weight = rational(
            BigInt(manifest.inclusionProbability.denominator),
            BigInt(manifest.inclusionProbability.numerator),
          );
          const confusionCell = classifyDsaConfusionCell(manifest.automatedOutcome, fact.referenceOutcome);
          if (confusionCell === "true_positive") cells.tp = add(cells.tp, weight);
          else if (confusionCell === "false_positive") cells.fp = add(cells.fp, weight);
          else if (confusionCell === "true_negative") cells.tn = add(cells.tn, weight);
          else cells.fn = add(cells.fn, weight);
        }
        const gap = (
          code: DsaAutomatedMeansEstimateCell["result"] extends infer R
            ? R extends { status: "coverage_gap"; code: infer C }
              ? C
              : never
            : never,
        ) => ({ status: "coverage_gap" as const, code, value: null, publicationEligible: false as const });
        const result =
          population.length === 0
            ? gap("empty_scope")
            : selected.length === 0
              ? gap("no_selected_reference_units")
              : complete.length === 0
                ? gap("no_completed_reference_units")
                : complete.length !== selected.length
                  ? gap("missing_selected_reference_outcome")
                  : estimateMetric(metric, population.length, cells);
        output.push({
          system,
          scope,
          metric,
          populationCount: population.length,
          selectedCount: selected.length,
          completedCount: complete.length,
          weightedConfusion: {
            truePositive: rationalText(cells.tp),
            falsePositive: rationalText(cells.fp),
            trueNegative: rationalText(cells.tn),
            falseNegative: rationalText(cells.fn),
          },
          result,
          limitations: REFERENCE_SAMPLE_PLAN_LIMITATIONS,
        });
      }
    }
  }
  const referenceLabelRoot = sha256Rfc8785(
    facts.map(fact => ({
      unitId: fact.unitId,
      sourceDecisionBinding: fact.sourceDecisionBinding,
      sourceEvaluationBinding: fact.sourceEvaluationBinding,
      sourceEvaluationHash: fact.sourceEvaluationHash,
      system: fact.system,
      automationProcessing: fact.automationProcessing,
      languageCodes: fact.languageCodes,
      origin: fact.origin,
      notifierClass: fact.notifierClass,
      referenceOutcome: fact.referenceOutcome,
      referenceLabelBinding: fact.referenceLabelBinding,
    })),
  );
  const payload = {
    schemaVersion: DSA_AUTOMATED_MEANS_ESTIMATE_SCHEMA_VERSION,
    estimatorVersion: DSA_AUTOMATED_MEANS_ESTIMATOR_VERSION,
    providerType: input.providerType,
    systemInventoryRoot: sha256Rfc8785({
      systems: systemInventory,
      systemCount: systemInventory.length,
    }),
    frame: {
      frameId: input.commitment.frameId,
      commitmentDigest: input.commitment.commitmentDigest,
      purpose: input.commitment.purpose,
      source: input.commitment.source,
      methodVersion: input.commitment.methodVersion,
      sampleSizePlan: input.commitment.sampleSizePlan,
      frameRoot: input.commitment.frameRoot,
      witness: input.commitment.witness,
    },
    sample: {
      sampleDigest: sample.sampleDigest,
      manifestRoot: sample.manifestRoot,
      seedDigest: sample.seedDigest,
      beacon: sample.beacon,
      frozenWitness: sample.frozenWitness,
    },
    referenceLabelRoot,
    publication: {
      eligible: false as const,
      block: "pending_external_method_review" as const,
      requiredContext: [
        "input_criteria",
        "calculation_methodology",
        "reference_standard",
        "positive_class_automatically_removed_content",
        "uncertainty_and_coverage_gaps",
      ] as const,
    },
    cells: output,
  };
  return { ...payload, estimateDigest: sha256Rfc8785(payload) };
}

export type DsaAutomatedMeansEstimate = ReturnType<typeof estimateDsaAutomatedMeansMetrics>;

export function verifyDsaAutomatedMeansEstimate(
  input: DsaAutomatedMeansEstimateInput & {
    expected: DsaAutomatedMeansEstimate;
  },
) {
  const { expected, ...estimateInput } = input;
  const recomputed = estimateDsaAutomatedMeansMetrics(estimateInput);
  if (canonicalizeRfc8785(expected) !== canonicalizeRfc8785(recomputed)) {
    invalid("Automated-means estimate verification failed.");
  }
  return recomputed;
}

export const __dsaAutomatedMeansEstimatesTestUtils = { decimal };
