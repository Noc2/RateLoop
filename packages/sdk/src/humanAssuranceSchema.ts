import { RateLoopSdkError } from "./errors";
import {
  HUMAN_ASSURANCE_CAPABILITIES,
  HUMAN_ASSURANCE_SCHEMA_VERSION,
  type HumanAssuranceArtifact,
  type HumanAssuranceAudiencePolicy,
  type HumanAssuranceCapability,
  type HumanAssuranceCase,
  type HumanAssuranceClientDecision,
  type HumanAssuranceEvidencePacket,
  type HumanAssuranceProject,
  type HumanAssuranceResponse,
  type HumanAssuranceRubric,
  type HumanAssuranceRun,
  type HumanAssuranceSuite,
} from "./humanAssuranceTypes";

type JsonRecord = Record<string, unknown>;

function invalid(path: string, expectation: string): never {
  throw new RateLoopSdkError(
    `Invalid human-assurance document at ${path}: expected ${expectation}.`,
  );
}

function record(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as JsonRecord;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    invalid(path, "a non-empty string");
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : string(value, path);
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function integer(value: unknown, path: string, min = 0, max = 2 ** 31 - 1) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    invalid(path, `an integer between ${min} and ${max}`);
  }
  return value;
}

function boolean(value: unknown, path: string) {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function isoDate(value: unknown, path: string): string {
  const result = string(value, path);
  if (!Number.isFinite(Date.parse(result))) invalid(path, "an ISO-8601 date");
  return result;
}

function nullableIsoDate(value: unknown, path: string): string | null {
  return value === null ? null : isoDate(value, path);
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) invalid(path, "an array");
  return value.map((entry, index) => string(entry, `${path}[${index}]`));
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
  if (value !== HUMAN_ASSURANCE_SCHEMA_VERSION) {
    invalid("schemaVersion", HUMAN_ASSURANCE_SCHEMA_VERSION);
  }
  return HUMAN_ASSURANCE_SCHEMA_VERSION;
}

function digest(value: unknown, path: string): `sha256:${string}` {
  const result = string(value, path);
  if (!/^sha256:[0-9a-f]{64}$/.test(result)) {
    invalid(path, "a sha256:<64 lowercase hex characters> digest");
  }
  return result as `sha256:${string}`;
}

function bps(value: unknown, path: string) {
  return integer(value, path, 0, 10_000);
}

export function parseHumanAssuranceProject(
  value: unknown,
): HumanAssuranceProject {
  const input = record(value, "project");
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    projectId: string(input.projectId, "projectId"),
    workspaceId: string(input.workspaceId, "workspaceId"),
    name: string(input.name, "name"),
    description: optionalString(input.description, "description"),
    dataClassification: enumeration(
      input.dataClassification,
      "dataClassification",
      ["public", "internal", "confidential", "restricted"],
    ),
    status: enumeration(input.status, "status", ["active", "archived"]),
    retentionDays: integer(input.retentionDays, "retentionDays", 1, 3650),
    createdAt: isoDate(input.createdAt, "createdAt"),
    updatedAt: isoDate(input.updatedAt, "updatedAt"),
  };
}

export function parseHumanAssuranceArtifact(
  value: unknown,
): HumanAssuranceArtifact {
  const input = record(value, "artifact");
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    artifactId: string(input.artifactId, "artifactId"),
    projectId: string(input.projectId, "projectId"),
    role: enumeration(input.role, "role", [
      "baseline",
      "candidate",
      "context",
      "reference",
    ]),
    label: string(input.label, "label"),
    digest: digest(input.digest, "digest"),
    contentType: string(input.contentType, "contentType"),
    sizeBytes: integer(input.sizeBytes, "sizeBytes", 0, 100_000_000),
    storageRef: string(input.storageRef, "storageRef"),
    redactionStatus: enumeration(input.redactionStatus, "redactionStatus", [
      "not_required",
      "pending",
      "approved",
      "rejected",
    ]),
    rendererPolicy: enumeration(input.rendererPolicy, "rendererPolicy", [
      "plain_text",
      "sanitized_html",
      "image",
      "download",
    ]),
    createdAt: isoDate(input.createdAt, "createdAt"),
  };
}

export function parseHumanAssuranceCase(value: unknown): HumanAssuranceCase {
  const input = record(value, "case");
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    caseId: string(input.caseId, "caseId"),
    projectId: string(input.projectId, "projectId"),
    title: string(input.title, "title"),
    instructions: string(input.instructions, "instructions"),
    baselineArtifactId: string(input.baselineArtifactId, "baselineArtifactId"),
    candidateArtifactId: string(
      input.candidateArtifactId,
      "candidateArtifactId",
    ),
    contextArtifactIds: stringArray(
      input.contextArtifactIds,
      "contextArtifactIds",
    ),
    objectiveReference: optionalString(
      input.objectiveReference,
      "objectiveReference",
    ),
    status: enumeration(input.status, "status", ["draft", "ready", "retired"]),
  };
}

export function parseHumanAssuranceRubric(
  value: unknown,
): HumanAssuranceRubric {
  const input = record(value, "rubric");
  const rationale = record(input.rationale, "rationale");
  const passRule = record(input.passRule, "passRule");
  if (!Array.isArray(input.failureTags)) invalid("failureTags", "an array");
  if (
    !Array.isArray(input.choices) ||
    input.choices.length !== 3 ||
    input.choices[0] !== "baseline" ||
    input.choices[1] !== "candidate" ||
    input.choices[2] !== "tie"
  ) {
    invalid("choices", "baseline, candidate, and tie in that order");
  }
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    rubricId: string(input.rubricId, "rubricId"),
    projectId: string(input.projectId, "projectId"),
    version: integer(input.version, "version", 1),
    prompt: string(input.prompt, "prompt"),
    choices: ["baseline", "candidate", "tie"],
    failureTags: input.failureTags.map((value, index) => {
      const tag = record(value, `failureTags[${index}]`);
      return {
        key: string(tag.key, `failureTags[${index}].key`),
        label: string(tag.label, `failureTags[${index}].label`),
        description: optionalString(
          tag.description,
          `failureTags[${index}].description`,
        ),
      };
    }),
    rationale: {
      mode: enumeration(rationale.mode, "rationale.mode", [
        "optional",
        "required",
      ]),
      minLength:
        rationale.minLength === undefined
          ? undefined
          : integer(rationale.minLength, "rationale.minLength", 0, 10_000),
      maxLength: integer(rationale.maxLength, "rationale.maxLength", 1, 10_000),
    },
    passRule: {
      metric: enumeration(passRule.metric, "passRule.metric", [
        "candidate_preference_share_bps",
      ]),
      operator: enumeration(passRule.operator, "passRule.operator", ["gte"]),
      thresholdBps: bps(passRule.thresholdBps, "passRule.thresholdBps"),
      minimumValidResponses: integer(
        passRule.minimumValidResponses,
        "passRule.minimumValidResponses",
        1,
      ),
    },
  };
}

export function parseHumanAssuranceAudiencePolicy(
  value: unknown,
): HumanAssuranceAudiencePolicy {
  const input = record(value, "audiencePolicy");
  const assurance = record(input.assurance, "assurance");
  if (!Array.isArray(input.requiredQualifications)) {
    invalid("requiredQualifications", "an array");
  }
  const requiredCapabilities = stringArray(
    assurance.requiredCapabilities,
    "assurance.requiredCapabilities",
  ).map((capability, index) =>
    enumeration(
      capability,
      `assurance.requiredCapabilities[${index}]`,
      HUMAN_ASSURANCE_CAPABILITIES,
    ),
  );
  const compensation = enumeration(input.compensation, "compensation", [
    "paid",
    "unpaid",
    "mixed",
  ]);
  const legalEligibilityRequired = boolean(
    input.legalEligibilityRequired,
    "legalEligibilityRequired",
  );
  if (compensation !== "unpaid" && !legalEligibilityRequired) {
    invalid(
      "legalEligibilityRequired",
      "true whenever any reviewer can be paid",
    );
  }
  if (!Array.isArray(input.cohorts)) invalid("cohorts", "an array");
  const fallbacks = record(input.fallbacks, "fallbacks");
  const buyerPrivacy = record(input.buyerPrivacy, "buyerPrivacy");
  const fallbackSources: HumanAssuranceAudiencePolicy["fallbacks"]["sources"] =
    stringArray(fallbacks.sources, "fallbacks.sources").map((source, index) =>
      enumeration(source, `fallbacks.sources[${index}]`, [
        "customer_invited",
        "rateloop_network",
        "hybrid",
        "sandbox",
      ]),
    );
  const fallbackAllowed = boolean(fallbacks.allowed, "fallbacks.allowed");
  if (!fallbackAllowed && fallbackSources.length > 0) {
    invalid("fallbacks.sources", "an empty array when fallbacks are denied");
  }
  const visibleFields: HumanAssuranceAudiencePolicy["buyerPrivacy"]["visibleFields"] =
    stringArray(buyerPrivacy.visibleFields, "buyerPrivacy.visibleFields").map(
      (field, index) =>
        enumeration(field, `buyerPrivacy.visibleFields[${index}]`, [
          "reviewer_source",
          "qualification_summary",
          "assurance_summary",
          "country_bucket",
        ]),
    );
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    policyId: string(input.policyId, "policyId"),
    version: integer(input.version, "version", 1),
    reviewerSource: enumeration(input.reviewerSource, "reviewerSource", [
      "customer_invited",
      "rateloop_network",
      "hybrid",
      "sandbox",
    ]),
    compensation,
    cohorts: input.cohorts.map((value, index) => {
      const cohort = record(value, `cohorts[${index}]`);
      const minimumReviewers = integer(
        cohort.minimumReviewers,
        `cohorts[${index}].minimumReviewers`,
      );
      const maximumReviewers = integer(
        cohort.maximumReviewers,
        `cohorts[${index}].maximumReviewers`,
        minimumReviewers,
      );
      return {
        cohortId: string(cohort.cohortId, `cohorts[${index}].cohortId`),
        minimumReviewers,
        maximumReviewers,
      };
    }),
    selection: enumeration(input.selection, "selection", [
      "randomized",
      "customer_named",
    ]),
    fallbacks: { allowed: fallbackAllowed, sources: fallbackSources },
    requiredQualifications: input.requiredQualifications.map((value, index) => {
      const qualification = record(value, `requiredQualifications[${index}]`);
      const rawValue = qualification.value;
      if (
        !["string", "number", "boolean"].includes(typeof rawValue) &&
        !(
          Array.isArray(rawValue) &&
          rawValue.every((entry) => typeof entry === "string")
        )
      ) {
        invalid(
          `requiredQualifications[${index}].value`,
          "a scalar or string array",
        );
      }
      return {
        key: string(qualification.key, `requiredQualifications[${index}].key`),
        operator: enumeration(
          qualification.operator,
          `requiredQualifications[${index}].operator`,
          ["equals", "one_of", "at_least", "attested"],
        ),
        value: rawValue as string | number | boolean | string[],
      };
    }),
    assurance: {
      requiredCapabilities,
      allowedProviders: stringArray(
        assurance.allowedProviders,
        "assurance.allowedProviders",
      ),
      freshnessSeconds:
        assurance.freshnessSeconds === undefined
          ? undefined
          : integer(
              assurance.freshnessSeconds,
              "assurance.freshnessSeconds",
              1,
              31_536_000,
            ),
    },
    buyerPrivacy: {
      visibleFields,
      minimumAggregationSize: integer(
        buyerPrivacy.minimumAggregationSize,
        "buyerPrivacy.minimumAggregationSize",
        2,
      ),
      suppressSmallCells: boolean(
        buyerPrivacy.suppressSmallCells,
        "buyerPrivacy.suppressSmallCells",
      ),
    },
    legalEligibilityRequired,
  };
}

export function parseHumanAssuranceSuite(value: unknown): HumanAssuranceSuite {
  const input = record(value, "suite");
  const status = enumeration(input.status, "status", [
    "draft",
    "frozen",
    "retired",
  ]);
  const frozenAt = nullableIsoDate(input.frozenAt, "frozenAt");
  if (status === "frozen" && frozenAt === null) {
    invalid("frozenAt", "a timestamp for a frozen suite");
  }
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    suiteId: string(input.suiteId, "suiteId"),
    projectId: string(input.projectId, "projectId"),
    name: string(input.name, "name"),
    version: integer(input.version, "version", 1),
    status,
    caseIds: stringArray(input.caseIds, "caseIds"),
    rubricId: string(input.rubricId, "rubricId"),
    rubricVersion: integer(input.rubricVersion, "rubricVersion", 1),
    frozenAt,
  };
}

export function parseHumanAssuranceRun(value: unknown): HumanAssuranceRun {
  const input = record(value, "run");
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    runId: string(input.runId, "runId"),
    projectId: string(input.projectId, "projectId"),
    suiteId: string(input.suiteId, "suiteId"),
    suiteVersion: integer(input.suiteVersion, "suiteVersion", 1),
    audiencePolicyId: string(input.audiencePolicyId, "audiencePolicyId"),
    audiencePolicyVersion: integer(
      input.audiencePolicyVersion,
      "audiencePolicyVersion",
      1,
    ),
    status: enumeration(input.status, "status", [
      "draft",
      "frozen",
      "recruiting",
      "collecting",
      "aggregating",
      "completed",
      "cancelled",
    ]),
    policyHash: digest(input.policyHash, "policyHash"),
    manifestHash:
      input.manifestHash === null
        ? null
        : digest(input.manifestHash, "manifestHash"),
    previousRunId: nullableString(input.previousRunId, "previousRunId"),
    createdAt: isoDate(input.createdAt, "createdAt"),
    frozenAt: nullableIsoDate(input.frozenAt, "frozenAt"),
    completedAt: nullableIsoDate(input.completedAt, "completedAt"),
  };
}

export function parseHumanAssuranceResponse(
  value: unknown,
): HumanAssuranceResponse {
  const input = record(value, "response");
  const reviewer = record(input.reviewer, "reviewer");
  const capabilities = stringArray(
    reviewer.assuranceCapabilities,
    "reviewer.assuranceCapabilities",
  ) as HumanAssuranceCapability[];
  capabilities.forEach((capability, index) =>
    enumeration(
      capability,
      `reviewer.assuranceCapabilities[${index}]`,
      HUMAN_ASSURANCE_CAPABILITIES,
    ),
  );
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    responseId: string(input.responseId, "responseId"),
    runId: string(input.runId, "runId"),
    caseId: string(input.caseId, "caseId"),
    choice: enumeration(input.choice, "choice", [
      "baseline",
      "candidate",
      "tie",
    ]),
    failureTagKeys: stringArray(input.failureTagKeys, "failureTagKeys"),
    rationale: nullableString(input.rationale, "rationale"),
    reviewer: {
      source: enumeration(reviewer.source, "reviewer.source", [
        "customer_invited",
        "rateloop_network",
        "sandbox",
      ]),
      qualificationKeys: stringArray(
        reviewer.qualificationKeys,
        "reviewer.qualificationKeys",
      ),
      assuranceCapabilities: capabilities,
    },
    responseDigest: digest(input.responseDigest, "responseDigest"),
    settlementReference: nullableString(
      input.settlementReference,
      "settlementReference",
    ),
    validity: enumeration(input.validity, "validity", [
      "pending",
      "valid",
      "invalid",
      "withdrawn",
    ]),
    submittedAt: isoDate(input.submittedAt, "submittedAt"),
  };
}

export function parseHumanAssuranceEvidencePacket(
  value: unknown,
): HumanAssuranceEvidencePacket {
  const input = record(value, "evidencePacket");
  const result = record(input.result, "result");
  const reviewerCoverage = record(
    result.reviewerCoverage,
    "result.reviewerCoverage",
  );
  const judgmentCoverage = record(
    result.judgmentCoverage,
    "result.judgmentCoverage",
  );
  if (!Array.isArray(result.cases)) invalid("result.cases", "an array");
  const suite = record(result.suite, "result.suite");
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    packetId: string(input.packetId, "packetId"),
    runId: string(input.runId, "runId"),
    manifestHash: digest(input.manifestHash, "manifestHash"),
    caseRoot: digest(input.caseRoot, "caseRoot"),
    responseRoot: digest(input.responseRoot, "responseRoot"),
    aggregationVersion: string(input.aggregationVersion, "aggregationVersion"),
    result: {
      method: enumeration(result.method, "result.method", [
        "descriptive_per_case",
      ]),
      reviewerCoverage: {
        targetReviewerCount: integer(
          reviewerCoverage.targetReviewerCount,
          "result.reviewerCoverage.targetReviewerCount",
        ),
        assignedReviewerCount: integer(
          reviewerCoverage.assignedReviewerCount,
          "result.reviewerCoverage.assignedReviewerCount",
        ),
        paidReviewerCount: integer(
          reviewerCoverage.paidReviewerCount,
          "result.reviewerCoverage.paidReviewerCount",
        ),
        respondingReviewerCount: integer(
          reviewerCoverage.respondingReviewerCount,
          "result.reviewerCoverage.respondingReviewerCount",
        ),
        completeJudgmentSetReviewerCount: integer(
          reviewerCoverage.completeJudgmentSetReviewerCount,
          "result.reviewerCoverage.completeJudgmentSetReviewerCount",
        ),
      },
      judgmentCoverage: {
        caseCount: integer(
          judgmentCoverage.caseCount,
          "result.judgmentCoverage.caseCount",
        ),
        targetExpectedJudgmentCount: integer(
          judgmentCoverage.targetExpectedJudgmentCount,
          "result.judgmentCoverage.targetExpectedJudgmentCount",
        ),
        assignedExpectedJudgmentCount: integer(
          judgmentCoverage.assignedExpectedJudgmentCount,
          "result.judgmentCoverage.assignedExpectedJudgmentCount",
        ),
        submittedJudgmentCount: integer(
          judgmentCoverage.submittedJudgmentCount,
          "result.judgmentCoverage.submittedJudgmentCount",
        ),
        validJudgmentCount: integer(
          judgmentCoverage.validJudgmentCount,
          "result.judgmentCoverage.validJudgmentCount",
        ),
        invalidJudgmentCount: integer(
          judgmentCoverage.invalidJudgmentCount,
          "result.judgmentCoverage.invalidJudgmentCount",
        ),
        pendingJudgmentCount: integer(
          judgmentCoverage.pendingJudgmentCount,
          "result.judgmentCoverage.pendingJudgmentCount",
        ),
        missingTargetJudgmentCount: integer(
          judgmentCoverage.missingTargetJudgmentCount,
          "result.judgmentCoverage.missingTargetJudgmentCount",
        ),
        missingAssignedJudgmentCount: integer(
          judgmentCoverage.missingAssignedJudgmentCount,
          "result.judgmentCoverage.missingAssignedJudgmentCount",
        ),
      },
      cases: result.cases.map((value, index) => {
        const path = `result.cases[${index}]`;
        const entry = record(value, path);
        const quorum = record(entry.quorum, `${path}.quorum`);
        return {
          caseId: string(entry.caseId, `${path}.caseId`),
          targetReviewerCount: integer(
            entry.targetReviewerCount,
            `${path}.targetReviewerCount`,
          ),
          assignedReviewerCount: integer(
            entry.assignedReviewerCount,
            `${path}.assignedReviewerCount`,
          ),
          submittedJudgmentCount: integer(
            entry.submittedJudgmentCount,
            `${path}.submittedJudgmentCount`,
          ),
          validReviewerCount: integer(
            entry.validReviewerCount,
            `${path}.validReviewerCount`,
          ),
          invalidJudgmentCount: integer(
            entry.invalidJudgmentCount,
            `${path}.invalidJudgmentCount`,
          ),
          pendingJudgmentCount: integer(
            entry.pendingJudgmentCount,
            `${path}.pendingJudgmentCount`,
          ),
          missingTargetJudgmentCount: integer(
            entry.missingTargetJudgmentCount,
            `${path}.missingTargetJudgmentCount`,
          ),
          missingAssignedJudgmentCount: integer(
            entry.missingAssignedJudgmentCount,
            `${path}.missingAssignedJudgmentCount`,
          ),
          quorum: {
            requiredValidReviewers: integer(
              quorum.requiredValidReviewers,
              `${path}.quorum.requiredValidReviewers`,
            ),
            met: boolean(quorum.met, `${path}.quorum.met`),
          },
          candidatePreferenceShareBps:
            entry.candidatePreferenceShareBps === null
              ? null
              : bps(
                  entry.candidatePreferenceShareBps,
                  `${path}.candidatePreferenceShareBps`,
                ),
          disagreementBps:
            entry.disagreementBps === null
              ? null
              : bps(entry.disagreementBps, `${path}.disagreementBps`),
          outcome: enumeration(entry.outcome, `${path}.outcome`, [
            "pass",
            "fail",
            "insufficient",
          ]),
        };
      }),
      suite: {
        method: enumeration(suite.method, "result.suite.method", [
          "all_cases_must_pass",
        ]),
        evaluatedCaseCount: integer(
          suite.evaluatedCaseCount,
          "result.suite.evaluatedCaseCount",
        ),
        passCaseCount: integer(
          suite.passCaseCount,
          "result.suite.passCaseCount",
        ),
        failCaseCount: integer(
          suite.failCaseCount,
          "result.suite.failCaseCount",
        ),
        insufficientCaseCount: integer(
          suite.insufficientCaseCount,
          "result.suite.insufficientCaseCount",
        ),
        outcome: enumeration(suite.outcome, "result.suite.outcome", [
          "pass",
          "fail",
          "insufficient",
        ]),
      },
    },
    limitations: stringArray(input.limitations, "limitations"),
    chainReferences: stringArray(input.chainReferences, "chainReferences"),
    generatedAt: isoDate(input.generatedAt, "generatedAt"),
    signature: string(input.signature, "signature"),
  };
}

export function parseHumanAssuranceClientDecision(
  value: unknown,
): HumanAssuranceClientDecision {
  const input = record(value, "clientDecision");
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    decisionId: string(input.decisionId, "decisionId"),
    runId: string(input.runId, "runId"),
    decision: enumeration(input.decision, "decision", [
      "go",
      "revise",
      "stop",
      "no_decision",
    ]),
    note: optionalString(input.note, "note"),
    decidedBy: string(input.decidedBy, "decidedBy"),
    evidencePacketId: string(input.evidencePacketId, "evidencePacketId"),
    decidedAt: isoDate(input.decidedAt, "decidedAt"),
  };
}

const digestSchema = {
  pattern: "^sha256:[0-9a-f]{64}$",
  type: "string",
} as const;
const versionSchema = { const: HUMAN_ASSURANCE_SCHEMA_VERSION } as const;
const idSchema = { minLength: 1, type: "string" } as const;

export const HUMAN_ASSURANCE_PROJECT_JSON_SCHEMA = {
  $id: "urn:rateloop:human-assurance:project:v2",
  additionalProperties: false,
  properties: {
    schemaVersion: versionSchema,
    projectId: idSchema,
    workspaceId: idSchema,
    name: idSchema,
    description: { type: "string" },
    dataClassification: {
      enum: ["public", "internal", "confidential", "restricted"],
    },
    status: { enum: ["active", "archived"] },
    retentionDays: { maximum: 3650, minimum: 1, type: "integer" },
    createdAt: { format: "date-time", type: "string" },
    updatedAt: { format: "date-time", type: "string" },
  },
  required: [
    "schemaVersion",
    "projectId",
    "workspaceId",
    "name",
    "dataClassification",
    "status",
    "retentionDays",
    "createdAt",
    "updatedAt",
  ],
  type: "object",
} as const;

export const HUMAN_ASSURANCE_ARTIFACT_JSON_SCHEMA = {
  $id: "urn:rateloop:human-assurance:artifact:v2",
  properties: {
    schemaVersion: versionSchema,
    artifactId: idSchema,
    projectId: idSchema,
    role: { enum: ["baseline", "candidate", "context", "reference"] },
    label: idSchema,
    digest: digestSchema,
    contentType: idSchema,
    sizeBytes: { minimum: 0, type: "integer" },
    storageRef: idSchema,
    redactionStatus: {
      enum: ["not_required", "pending", "approved", "rejected"],
    },
    rendererPolicy: {
      enum: ["plain_text", "sanitized_html", "image", "download"],
    },
    createdAt: { format: "date-time", type: "string" },
  },
  required: [
    "schemaVersion",
    "artifactId",
    "projectId",
    "role",
    "label",
    "digest",
    "contentType",
    "sizeBytes",
    "storageRef",
    "redactionStatus",
    "rendererPolicy",
    "createdAt",
  ],
  type: "object",
} as const;

export const HUMAN_ASSURANCE_CASE_JSON_SCHEMA = {
  $id: "urn:rateloop:human-assurance:case:v2",
  properties: {
    schemaVersion: versionSchema,
    caseId: idSchema,
    projectId: idSchema,
    title: idSchema,
    instructions: idSchema,
    baselineArtifactId: idSchema,
    candidateArtifactId: idSchema,
    contextArtifactIds: { items: idSchema, type: "array" },
    objectiveReference: { type: "string" },
    status: { enum: ["draft", "ready", "retired"] },
  },
  required: [
    "schemaVersion",
    "caseId",
    "projectId",
    "title",
    "instructions",
    "baselineArtifactId",
    "candidateArtifactId",
    "contextArtifactIds",
    "status",
  ],
  type: "object",
} as const;

export const HUMAN_ASSURANCE_RUBRIC_JSON_SCHEMA = {
  $id: "urn:rateloop:human-assurance:rubric:v2",
  properties: {
    schemaVersion: versionSchema,
    rubricId: idSchema,
    projectId: idSchema,
    version: { minimum: 1, type: "integer" },
    prompt: idSchema,
    choices: { const: ["baseline", "candidate", "tie"] },
    failureTags: { type: "array" },
    rationale: { type: "object" },
    passRule: { type: "object" },
  },
  required: [
    "schemaVersion",
    "rubricId",
    "projectId",
    "version",
    "prompt",
    "choices",
    "failureTags",
    "rationale",
    "passRule",
  ],
  type: "object",
} as const;

export const HUMAN_ASSURANCE_AUDIENCE_POLICY_JSON_SCHEMA = {
  $id: "urn:rateloop:human-assurance:audience-policy:v2",
  properties: {
    schemaVersion: versionSchema,
    policyId: idSchema,
    version: { minimum: 1, type: "integer" },
    reviewerSource: {
      enum: ["customer_invited", "rateloop_network", "hybrid", "sandbox"],
    },
    compensation: { enum: ["paid", "unpaid", "mixed"] },
    cohorts: { type: "array" },
    selection: { enum: ["randomized", "customer_named"] },
    fallbacks: { type: "object" },
    requiredQualifications: { type: "array" },
    assurance: { type: "object" },
    buyerPrivacy: { type: "object" },
    legalEligibilityRequired: { type: "boolean" },
  },
  required: [
    "schemaVersion",
    "policyId",
    "version",
    "reviewerSource",
    "compensation",
    "cohorts",
    "selection",
    "fallbacks",
    "requiredQualifications",
    "assurance",
    "buyerPrivacy",
    "legalEligibilityRequired",
  ],
  type: "object",
} as const;

export const HUMAN_ASSURANCE_SUITE_JSON_SCHEMA = {
  $id: "urn:rateloop:human-assurance:suite:v2",
  properties: {
    schemaVersion: versionSchema,
    suiteId: idSchema,
    projectId: idSchema,
    name: idSchema,
    version: { minimum: 1, type: "integer" },
    status: { enum: ["draft", "frozen", "retired"] },
    caseIds: { items: idSchema, type: "array" },
    rubricId: idSchema,
    rubricVersion: { minimum: 1, type: "integer" },
    frozenAt: { type: ["string", "null"] },
  },
  required: [
    "schemaVersion",
    "suiteId",
    "projectId",
    "name",
    "version",
    "status",
    "caseIds",
    "rubricId",
    "rubricVersion",
    "frozenAt",
  ],
  type: "object",
} as const;

export const HUMAN_ASSURANCE_RUN_JSON_SCHEMA = {
  $id: "urn:rateloop:human-assurance:run:v2",
  properties: {
    schemaVersion: versionSchema,
    runId: idSchema,
    projectId: idSchema,
    suiteId: idSchema,
    suiteVersion: { minimum: 1, type: "integer" },
    audiencePolicyId: idSchema,
    audiencePolicyVersion: { minimum: 1, type: "integer" },
    status: {
      enum: [
        "draft",
        "frozen",
        "recruiting",
        "collecting",
        "aggregating",
        "completed",
        "cancelled",
      ],
    },
    policyHash: digestSchema,
    manifestHash: { anyOf: [digestSchema, { type: "null" }] },
    previousRunId: { type: ["string", "null"] },
    createdAt: { format: "date-time", type: "string" },
    frozenAt: { type: ["string", "null"] },
    completedAt: { type: ["string", "null"] },
  },
  required: [
    "schemaVersion",
    "runId",
    "projectId",
    "suiteId",
    "suiteVersion",
    "audiencePolicyId",
    "audiencePolicyVersion",
    "status",
    "policyHash",
    "manifestHash",
    "previousRunId",
    "createdAt",
    "frozenAt",
    "completedAt",
  ],
  type: "object",
} as const;

export const HUMAN_ASSURANCE_RESPONSE_JSON_SCHEMA = {
  $id: "urn:rateloop:human-assurance:response:v2",
  properties: {
    schemaVersion: versionSchema,
    responseId: idSchema,
    runId: idSchema,
    caseId: idSchema,
    choice: { enum: ["baseline", "candidate", "tie"] },
    failureTagKeys: { items: idSchema, type: "array" },
    rationale: { type: ["string", "null"] },
    reviewer: { type: "object" },
    responseDigest: digestSchema,
    settlementReference: { type: ["string", "null"] },
    validity: { enum: ["pending", "valid", "invalid", "withdrawn"] },
    submittedAt: { format: "date-time", type: "string" },
  },
  required: [
    "schemaVersion",
    "responseId",
    "runId",
    "caseId",
    "choice",
    "failureTagKeys",
    "rationale",
    "reviewer",
    "responseDigest",
    "settlementReference",
    "validity",
    "submittedAt",
  ],
  type: "object",
} as const;

export const HUMAN_ASSURANCE_EVIDENCE_PACKET_JSON_SCHEMA = {
  $id: "urn:rateloop:human-assurance:evidence-packet:v2",
  properties: {
    schemaVersion: versionSchema,
    packetId: idSchema,
    runId: idSchema,
    manifestHash: digestSchema,
    caseRoot: digestSchema,
    responseRoot: digestSchema,
    aggregationVersion: idSchema,
    result: {
      properties: {
        method: { const: "descriptive_per_case" },
        reviewerCoverage: {
          properties: {
            targetReviewerCount: { minimum: 0, type: "integer" },
            assignedReviewerCount: { minimum: 0, type: "integer" },
            paidReviewerCount: { minimum: 0, type: "integer" },
            respondingReviewerCount: { minimum: 0, type: "integer" },
            completeJudgmentSetReviewerCount: {
              minimum: 0,
              type: "integer",
            },
          },
          required: [
            "targetReviewerCount",
            "assignedReviewerCount",
            "paidReviewerCount",
            "respondingReviewerCount",
            "completeJudgmentSetReviewerCount",
          ],
          type: "object",
        },
        judgmentCoverage: {
          properties: {
            caseCount: { minimum: 0, type: "integer" },
            targetExpectedJudgmentCount: { minimum: 0, type: "integer" },
            assignedExpectedJudgmentCount: { minimum: 0, type: "integer" },
            submittedJudgmentCount: { minimum: 0, type: "integer" },
            validJudgmentCount: { minimum: 0, type: "integer" },
            invalidJudgmentCount: { minimum: 0, type: "integer" },
            pendingJudgmentCount: { minimum: 0, type: "integer" },
            missingTargetJudgmentCount: { minimum: 0, type: "integer" },
            missingAssignedJudgmentCount: { minimum: 0, type: "integer" },
          },
          required: [
            "caseCount",
            "targetExpectedJudgmentCount",
            "assignedExpectedJudgmentCount",
            "submittedJudgmentCount",
            "validJudgmentCount",
            "invalidJudgmentCount",
            "pendingJudgmentCount",
            "missingTargetJudgmentCount",
            "missingAssignedJudgmentCount",
          ],
          type: "object",
        },
        cases: {
          items: {
            properties: {
              caseId: idSchema,
              targetReviewerCount: { minimum: 0, type: "integer" },
              assignedReviewerCount: { minimum: 0, type: "integer" },
              submittedJudgmentCount: { minimum: 0, type: "integer" },
              validReviewerCount: { minimum: 0, type: "integer" },
              invalidJudgmentCount: { minimum: 0, type: "integer" },
              pendingJudgmentCount: { minimum: 0, type: "integer" },
              missingTargetJudgmentCount: { minimum: 0, type: "integer" },
              missingAssignedJudgmentCount: { minimum: 0, type: "integer" },
              quorum: {
                properties: {
                  requiredValidReviewers: { minimum: 0, type: "integer" },
                  met: { type: "boolean" },
                },
                required: ["requiredValidReviewers", "met"],
                type: "object",
              },
              candidatePreferenceShareBps: {
                maximum: 10_000,
                minimum: 0,
                type: ["integer", "null"],
              },
              disagreementBps: {
                maximum: 10_000,
                minimum: 0,
                type: ["integer", "null"],
              },
              outcome: { enum: ["pass", "fail", "insufficient"] },
            },
            required: [
              "caseId",
              "targetReviewerCount",
              "assignedReviewerCount",
              "submittedJudgmentCount",
              "validReviewerCount",
              "invalidJudgmentCount",
              "pendingJudgmentCount",
              "missingTargetJudgmentCount",
              "missingAssignedJudgmentCount",
              "quorum",
              "candidatePreferenceShareBps",
              "disagreementBps",
              "outcome",
            ],
            type: "object",
          },
          type: "array",
        },
        suite: {
          properties: {
            method: { const: "all_cases_must_pass" },
            evaluatedCaseCount: { minimum: 0, type: "integer" },
            passCaseCount: { minimum: 0, type: "integer" },
            failCaseCount: { minimum: 0, type: "integer" },
            insufficientCaseCount: { minimum: 0, type: "integer" },
            outcome: { enum: ["pass", "fail", "insufficient"] },
          },
          required: [
            "method",
            "evaluatedCaseCount",
            "passCaseCount",
            "failCaseCount",
            "insufficientCaseCount",
            "outcome",
          ],
          type: "object",
        },
      },
      required: [
        "method",
        "reviewerCoverage",
        "judgmentCoverage",
        "cases",
        "suite",
      ],
      type: "object",
    },
    limitations: { items: idSchema, type: "array" },
    chainReferences: { items: idSchema, type: "array" },
    generatedAt: { format: "date-time", type: "string" },
    signature: idSchema,
  },
  required: [
    "schemaVersion",
    "packetId",
    "runId",
    "manifestHash",
    "caseRoot",
    "responseRoot",
    "aggregationVersion",
    "result",
    "limitations",
    "chainReferences",
    "generatedAt",
    "signature",
  ],
  type: "object",
} as const;

export const HUMAN_ASSURANCE_CLIENT_DECISION_JSON_SCHEMA = {
  $id: "urn:rateloop:human-assurance:client-decision:v2",
  properties: {
    schemaVersion: versionSchema,
    decisionId: idSchema,
    runId: idSchema,
    decision: { enum: ["go", "revise", "stop", "no_decision"] },
    note: { type: "string" },
    decidedBy: idSchema,
    evidencePacketId: idSchema,
    decidedAt: { format: "date-time", type: "string" },
  },
  required: [
    "schemaVersion",
    "decisionId",
    "runId",
    "decision",
    "decidedBy",
    "evidencePacketId",
    "decidedAt",
  ],
  type: "object",
} as const;
