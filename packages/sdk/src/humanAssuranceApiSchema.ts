import { RateLoopSdkError } from "./errors";
import type {
  HumanAssuranceProjectCreateRequest,
  HumanAssuranceProjectCreateResponse,
  HumanAssuranceProjectListResponse,
  HumanAssuranceProjectResourcesResponse,
  HumanAssuranceRunStatusResponse,
} from "./humanAssuranceApiTypes";
import { HUMAN_ASSURANCE_SCHEMA_VERSION } from "./humanAssuranceTypes";

type JsonRecord = Record<string, unknown>;

function invalid(path: string, expectation: string): never {
  throw new RateLoopSdkError(
    `Invalid human-assurance API value at ${path}: expected ${expectation}.`,
  );
}

function record(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(path, "an object");
  return value as JsonRecord;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim())
    invalid(path, "a non-empty string");
  return value;
}

function optionalString(value: unknown, path: string) {
  return value === undefined ? undefined : string(value, path);
}

function nullableString(value: unknown, path: string) {
  return value === null ? null : string(value, path);
}

function integer(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
) {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    invalid(path, `an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

function bps(value: unknown, path: string) {
  return integer(value, path, 0, 10_000);
}

function isoDate(value: unknown, path: string) {
  const result = string(value, path);
  if (!Number.isFinite(Date.parse(result)))
    invalid(path, "an ISO-8601 timestamp");
  return result;
}

function nullableIsoDate(value: unknown, path: string) {
  return value === null ? null : isoDate(value, path);
}

function enumeration<T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
): T {
  const result = string(value, path);
  if (!values.includes(result as T)) invalid(path, values.join(" or "));
  return result as T;
}

function schemaVersion(value: unknown) {
  if (value !== HUMAN_ASSURANCE_SCHEMA_VERSION)
    invalid("schemaVersion", HUMAN_ASSURANCE_SCHEMA_VERSION);
  return HUMAN_ASSURANCE_SCHEMA_VERSION;
}

function digest(value: unknown, path: string): `sha256:${string}` {
  const result = string(value, path);
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) invalid(path, "a sha256 digest");
  return result as `sha256:${string}`;
}

function nullableDigest(value: unknown, path: string) {
  return value === null ? null : digest(value, path);
}

function array<T>(
  value: unknown,
  path: string,
  parser: (entry: unknown, entryPath: string) => T,
): T[] {
  if (!Array.isArray(value)) invalid(path, "an array");
  return value.map((entry, index) => parser(entry, `${path}[${index}]`));
}

function exactKeys(
  value: JsonRecord,
  allowed: readonly string[],
  path: string,
) {
  const allow = new Set(allowed);
  const unsupported = Object.keys(value).filter((key) => !allow.has(key));
  if (unsupported.length) invalid(path, `only ${allowed.join(", ")}`);
}

const DATA_CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
const RUN_STATUSES = [
  "draft",
  "frozen",
  "recruiting",
  "collecting",
  "aggregating",
  "completed",
  "cancelled",
] as const;
const ROUND_STATUSES = [
  "planned",
  "submitted",
  "open",
  "revealable",
  "settling",
  "finalized",
  "terminal",
  "failed",
] as const;

export function parseHumanAssuranceProjectCreateRequest(
  value: unknown,
): HumanAssuranceProjectCreateRequest {
  const input = record(value, "project");
  exactKeys(
    input,
    ["name", "description", "dataClassification", "retentionDays"],
    "project",
  );
  const name = string(input.name, "project.name").trim();
  if (name.length > 160) invalid("project.name", "at most 160 characters");
  const description = optionalString(
    input.description,
    "project.description",
  )?.trim();
  if (description && description.length > 2_000)
    invalid("project.description", "at most 2000 characters");
  return {
    name,
    ...(description ? { description } : {}),
    dataClassification: enumeration(
      input.dataClassification,
      "project.dataClassification",
      DATA_CLASSIFICATIONS,
    ),
    retentionDays: integer(
      input.retentionDays,
      "project.retentionDays",
      1,
      3650,
    ),
  };
}

export function parseHumanAssuranceProjectCreateResponse(
  value: unknown,
): HumanAssuranceProjectCreateResponse {
  const input = record(value, "project");
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    projectId: string(input.projectId, "project.projectId"),
    workspaceId: string(input.workspaceId, "project.workspaceId"),
  };
}

function projectSummary(value: unknown, path: string) {
  const input = record(value, path);
  return {
    projectId: string(input.projectId, `${path}.projectId`),
    name: string(input.name, `${path}.name`),
    description: optionalString(input.description, `${path}.description`),
    dataClassification: enumeration(
      input.dataClassification,
      `${path}.dataClassification`,
      DATA_CLASSIFICATIONS,
    ),
    status: enumeration(input.status, `${path}.status`, [
      "active",
      "archived",
    ] as const),
    retentionDays: integer(
      input.retentionDays,
      `${path}.retentionDays`,
      1,
      3650,
    ),
    suiteCount: integer(input.suiteCount, `${path}.suiteCount`),
    runCount: integer(input.runCount, `${path}.runCount`),
    createdAt: isoDate(input.createdAt, `${path}.createdAt`),
    updatedAt: isoDate(input.updatedAt, `${path}.updatedAt`),
  };
}

export function parseHumanAssuranceProjectListResponse(
  value: unknown,
): HumanAssuranceProjectListResponse {
  const input = record(value, "projects");
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    workspaceId: string(input.workspaceId, "projects.workspaceId"),
    projects: array(input.projects, "projects.projects", projectSummary),
  };
}

export function parseHumanAssuranceProjectResourcesResponse(
  value: unknown,
): HumanAssuranceProjectResourcesResponse {
  const input = record(value, "projectResources");
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    projectId: string(input.projectId, "projectResources.projectId"),
    suites: array(input.suites, "projectResources.suites", (value, path) => {
      const suite = record(value, path);
      return {
        suiteId: string(suite.suiteId, `${path}.suiteId`),
        name: string(suite.name, `${path}.name`),
        version: integer(suite.version, `${path}.version`, 1),
        status: enumeration(suite.status, `${path}.status`, [
          "draft",
          "frozen",
          "retired",
        ] as const),
        manifestHash: nullableDigest(
          suite.manifestHash,
          `${path}.manifestHash`,
        ),
        caseCount: integer(suite.caseCount, `${path}.caseCount`),
        frozenAt: nullableIsoDate(suite.frozenAt, `${path}.frozenAt`),
      };
    }),
    policies: array(
      input.policies,
      "projectResources.policies",
      (value, path) => {
        const policy = record(value, path);
        return {
          policyId: string(policy.policyId, `${path}.policyId`),
          version: integer(policy.version, `${path}.version`, 1),
          reviewerSource: enumeration(
            policy.reviewerSource,
            `${path}.reviewerSource`,
            [
              "customer_invited",
              "rateloop_network",
              "hybrid",
            ] as const,
          ),
          compensation: enumeration(
            policy.compensation,
            `${path}.compensation`,
            ["paid", "unpaid", "mixed"] as const,
          ),
          selection: enumeration(policy.selection, `${path}.selection`, [
            "randomized",
            "customer_named",
          ] as const),
          policyHash: digest(policy.policyHash, `${path}.policyHash`),
        };
      },
    ),
    runs: array(input.runs, "projectResources.runs", (value, path) => {
      const run = record(value, path);
      return {
        runId: string(run.runId, `${path}.runId`),
        suiteId: string(run.suiteId, `${path}.suiteId`),
        suiteVersion: integer(run.suiteVersion, `${path}.suiteVersion`, 1),
        audiencePolicyId: string(
          run.audiencePolicyId,
          `${path}.audiencePolicyId`,
        ),
        audiencePolicyVersion: integer(
          run.audiencePolicyVersion,
          `${path}.audiencePolicyVersion`,
          1,
        ),
        status: enumeration(run.status, `${path}.status`, RUN_STATUSES),
        manifestHash: nullableDigest(run.manifestHash, `${path}.manifestHash`),
        previousRunId: nullableString(
          run.previousRunId,
          `${path}.previousRunId`,
        ),
        createdAt: isoDate(run.createdAt, `${path}.createdAt`),
        updatedAt: isoDate(run.updatedAt, `${path}.updatedAt`),
        completedAt: nullableIsoDate(run.completedAt, `${path}.completedAt`),
      };
    }),
  };
}

function countMap(value: unknown, path: string) {
  const input = record(value, path);
  const result: HumanAssuranceRunStatusResponse["roundStates"] = {};
  for (const [key, count] of Object.entries(input)) {
    if (!ROUND_STATUSES.includes(key as (typeof ROUND_STATUSES)[number]))
      invalid(`${path}.${key}`, "a supported round state");
    result[key as keyof typeof result] = integer(count, `${path}.${key}`);
  }
  return result;
}

export function parseHumanAssuranceRunStatusResponse(
  value: unknown,
): HumanAssuranceRunStatusResponse {
  const input = record(value, "runStatus");
  const checks = record(
    input.deterministicChecks,
    "runStatus.deterministicChecks",
  );
  const responses = record(input.responses, "runStatus.responses");
  const passRule = record(input.passRule, "runStatus.passRule");
  const rerun =
    input.rerun === null ? null : record(input.rerun, "runStatus.rerun");
  const parsedResponses = {
    baseline: integer(responses.baseline, "runStatus.responses.baseline"),
    candidate: integer(responses.candidate, "runStatus.responses.candidate"),
    tie: integer(responses.tie, "runStatus.responses.tie"),
    valid: integer(responses.valid, "runStatus.responses.valid"),
  };
  if (
    parsedResponses.valid !==
    parsedResponses.baseline + parsedResponses.candidate + parsedResponses.tie
  ) {
    invalid(
      "runStatus.responses.valid",
      "the sum of baseline, candidate, and tie responses",
    );
  }
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    runId: string(input.runId, "runStatus.runId"),
    runStatus: enumeration(
      input.runStatus,
      "runStatus.runStatus",
      RUN_STATUSES,
    ),
    totalCases: integer(input.totalCases, "runStatus.totalCases"),
    roundStates: countMap(input.roundStates, "runStatus.roundStates"),
    deterministicChecks: {
      notApplicable: integer(
        checks.notApplicable,
        "runStatus.deterministicChecks.notApplicable",
      ),
      pending: integer(checks.pending, "runStatus.deterministicChecks.pending"),
      passed: integer(checks.passed, "runStatus.deterministicChecks.passed"),
      failed: integer(checks.failed, "runStatus.deterministicChecks.failed"),
    },
    responses: parsedResponses,
    candidatePreferenceShareBps:
      input.candidatePreferenceShareBps === null
        ? null
        : bps(
            input.candidatePreferenceShareBps,
            "runStatus.candidatePreferenceShareBps",
          ),
    passRule: {
      metric: enumeration(passRule.metric, "runStatus.passRule.metric", [
        "candidate_preference_share_bps",
      ] as const),
      operator: enumeration(passRule.operator, "runStatus.passRule.operator", [
        "gte",
      ] as const),
      thresholdBps: bps(
        passRule.thresholdBps,
        "runStatus.passRule.thresholdBps",
      ),
      minimumValidResponses: integer(
        passRule.minimumValidResponses,
        "runStatus.passRule.minimumValidResponses",
        1,
      ),
    },
    decision: enumeration(input.decision, "runStatus.decision", [
      "pending",
      "passed",
      "failed",
    ] as const),
    rerun: rerun
      ? {
          rootRunId: string(rerun.rootRunId, "runStatus.rerun.rootRunId"),
          previousRunId: nullableString(
            rerun.previousRunId,
            "runStatus.rerun.previousRunId",
          ),
          previousManifestHash: nullableDigest(
            rerun.previousManifestHash,
            "runStatus.rerun.previousManifestHash",
          ),
          ordinal: integer(rerun.ordinal, "runStatus.rerun.ordinal"),
        }
      : null,
  };
}
