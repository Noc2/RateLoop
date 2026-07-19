import { createHash } from "node:crypto";
import "server-only";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const AGENT_EXECUTION_MANIFEST_SCHEMA_VERSION = "rateloop.execution-manifest.v1" as const;
export const LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION = "rateloop.execution-profile.v1" as const;
export const AGENT_EXECUTION_PROFILE_SCHEMA_VERSION = "rateloop.execution-profile.v2" as const;
export type AgentExecutionProfileSchemaVersion =
  | typeof LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION
  | typeof AGENT_EXECUTION_PROFILE_SCHEMA_VERSION;

const MAX_GENERATION_SPANS = 64;
const MAX_INTEGER = 2_147_483_647;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/u;

const EXECUTION_KEYS = new Set([
  "externalExecutionId",
  "status",
  "startedAt",
  "completedAt",
  "toolCallCount",
  "toolDurationMs",
  "primarySpanId",
  "generationSpans",
]);
const SPAN_KEYS = new Set([
  "spanId",
  "parentSpanId",
  "role",
  "provider",
  "requestedModel",
  "resolvedModel",
  "modelVersion",
  "reasoningEffort",
  "serviceTier",
  "startedAt",
  "completedAt",
  "timeToFirstOutputMs",
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "responseIdHash",
  "finishReason",
]);

export type AgentExecutionStatus = "completed" | "failed";
export type AgentGenerationRole = "primary" | "subagent" | "supporting";

export type AgentGenerationSpanInput = {
  spanId: string;
  parentSpanId?: string | null;
  role: AgentGenerationRole;
  provider: string;
  requestedModel: string;
  resolvedModel?: string | null;
  modelVersion?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  timeToFirstOutputMs?: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  reasoningOutputTokens?: number | null;
  responseIdHash?: string | null;
  finishReason?: string | null;
};

export type AgentExecutionProvenanceInput = {
  externalExecutionId: string;
  status: AgentExecutionStatus;
  startedAt?: string | null;
  completedAt?: string | null;
  toolCallCount?: number | null;
  toolDurationMs?: number | null;
  primarySpanId: string;
  generationSpans: AgentGenerationSpanInput[];
};

export type AgentExecutionModelProfile = {
  provider: string;
  requestedModel: string;
  resolvedModel: string | null;
  modelVersion: string | null;
  reasoningEffort: string | null;
  serviceTier: string | null;
};

export type AgentExecutionProfile = {
  schemaVersion: AgentExecutionProfileSchemaVersion;
  orchestrationMode: "single_model" | "multi_model";
  primary: AgentExecutionModelProfile;
  contributors: AgentExecutionModelProfile[];
};

export type NormalizedAgentGenerationSpan = AgentExecutionModelProfile & {
  spanId: string;
  parentSpanId: string | null;
  role: AgentGenerationRole;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  timeToFirstOutputMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  responseIdHash: string | null;
  finishReason: string | null;
};

export type AgentExecutionTotals = {
  generationSpanCount: number;
  generationDurationMs: number | null;
  toolCallCount: number | null;
  toolDurationMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
};

export type NormalizedAgentExecutionProvenance = {
  schemaVersion: typeof AGENT_EXECUTION_MANIFEST_SCHEMA_VERSION;
  externalExecutionId: string;
  status: AgentExecutionStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  toolCallCount: number | null;
  toolDurationMs: number | null;
  primarySpanId: string;
  generationSpans: NormalizedAgentGenerationSpan[];
  totals: AgentExecutionTotals;
  manifestCommitment: `sha256:${string}`;
  executionProfile: AgentExecutionProfile;
  executionProfileHash: `sha256:${string}`;
};

function invalid(message: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_execution_provenance");
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(`${name} must be a plain object.`);
  return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, allowed: Set<string>, name: string) {
  const unsupported = Object.keys(value).filter(key => !allowed.has(key));
  if (unsupported.length > 0) invalid(`${name} contains unsupported fields: ${unsupported.sort().join(", ")}.`);
}

function boundedString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string") invalid(`${name} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) invalid(`${name} must be 1-${maximum} characters.`);
  return normalized;
}

function optionalBoundedString(value: unknown, name: string, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  return boundedString(value, name, maximum);
}

function optionalCount(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_INTEGER) {
    invalid(`${name} must be a non-negative integer no greater than ${MAX_INTEGER}.`);
  }
  return Number(value);
}

function optionalTimestamp(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") invalid(`${name} must be an ISO-8601 timestamp.`);
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) invalid(`${name} must be an ISO-8601 timestamp.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[7] ?? 0);
  const offsetMinute = Number(match[8] ?? 0);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (
    daysInMonth === undefined ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    invalid(`${name} must be an ISO-8601 timestamp.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) invalid(`${name} must be an ISO-8601 timestamp.`);
  return date.toISOString();
}

function timestampPair(
  startedValue: unknown,
  completedValue: unknown,
  name: string,
): { startedAt: string | null; completedAt: string | null; durationMs: number | null } {
  const startedAt = optionalTimestamp(startedValue, `${name}.startedAt`);
  const completedAt = optionalTimestamp(completedValue, `${name}.completedAt`);
  if ((startedAt === null) !== (completedAt === null)) {
    invalid(`${name}.startedAt and ${name}.completedAt must be supplied together.`);
  }
  if (startedAt === null || completedAt === null) return { startedAt: null, completedAt: null, durationMs: null };
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    invalid(`${name}.completedAt must not be earlier than ${name}.startedAt.`);
  }
  if (durationMs > MAX_INTEGER) invalid(`${name} duration cannot exceed ${MAX_INTEGER} milliseconds.`);
  return { startedAt, completedAt, durationMs };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Execution provenance must be JSON serializable.");
  return encoded;
}

function commitment(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function normalizeSpan(value: unknown, index: number): NormalizedAgentGenerationSpan {
  const name = `generationSpans[${index}]`;
  const span = record(value, name);
  assertKnownKeys(span, SPAN_KEYS, name);
  const role = span.role;
  if (role !== "primary" && role !== "subagent" && role !== "supporting") {
    invalid(`${name}.role must be primary, subagent, or supporting.`);
  }
  const timestamps = timestampPair(span.startedAt, span.completedAt, name);
  const timeToFirstOutputMs = optionalCount(span.timeToFirstOutputMs, `${name}.timeToFirstOutputMs`);
  if (timeToFirstOutputMs !== null && timestamps.durationMs !== null && timeToFirstOutputMs > timestamps.durationMs) {
    invalid(`${name}.timeToFirstOutputMs cannot exceed the span duration.`);
  }
  const inputTokens = optionalCount(span.inputTokens, `${name}.inputTokens`);
  const cachedInputTokens = optionalCount(span.cachedInputTokens, `${name}.cachedInputTokens`);
  if (inputTokens !== null && cachedInputTokens !== null && cachedInputTokens > inputTokens) {
    invalid(`${name}.cachedInputTokens cannot exceed inputTokens.`);
  }
  const outputTokens = optionalCount(span.outputTokens, `${name}.outputTokens`);
  const reasoningOutputTokens = optionalCount(span.reasoningOutputTokens, `${name}.reasoningOutputTokens`);
  if (outputTokens !== null && reasoningOutputTokens !== null && reasoningOutputTokens > outputTokens) {
    invalid(`${name}.reasoningOutputTokens cannot exceed outputTokens.`);
  }
  const responseIdHash = optionalBoundedString(span.responseIdHash, `${name}.responseIdHash`, 71);
  if (responseIdHash !== null && !SHA256_PATTERN.test(responseIdHash)) {
    invalid(`${name}.responseIdHash must be a lowercase sha256 commitment.`);
  }
  return {
    spanId: boundedString(span.spanId, `${name}.spanId`, 160),
    parentSpanId: optionalBoundedString(span.parentSpanId, `${name}.parentSpanId`, 160),
    role,
    provider: boundedString(span.provider, `${name}.provider`, 120),
    requestedModel: boundedString(span.requestedModel, `${name}.requestedModel`, 200),
    resolvedModel: optionalBoundedString(span.resolvedModel, `${name}.resolvedModel`, 200),
    modelVersion: optionalBoundedString(span.modelVersion, `${name}.modelVersion`, 160),
    reasoningEffort: optionalBoundedString(span.reasoningEffort, `${name}.reasoningEffort`, 80),
    serviceTier: optionalBoundedString(span.serviceTier, `${name}.serviceTier`, 80),
    ...timestamps,
    timeToFirstOutputMs,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    responseIdHash,
    finishReason: optionalBoundedString(span.finishReason, `${name}.finishReason`, 160),
  };
}

function assertSpanGraph(spans: NormalizedAgentGenerationSpan[], primarySpanId: string) {
  const byId = new Map<string, NormalizedAgentGenerationSpan>();
  for (const span of spans) {
    if (byId.has(span.spanId)) invalid(`generationSpans contains duplicate spanId ${span.spanId}.`);
    byId.set(span.spanId, span);
  }
  const primarySpans = spans.filter(span => span.role === "primary");
  if (primarySpans.length !== 1 || primarySpans[0]?.spanId !== primarySpanId) {
    invalid("Exactly one primary generation span must match primarySpanId.");
  }
  for (const span of spans) {
    if (span.parentSpanId !== null && !byId.has(span.parentSpanId)) {
      invalid(`Parent span ${span.parentSpanId} does not exist.`);
    }
  }
  const state = new Map<string, "visiting" | "visited">();
  function visit(spanId: string) {
    const current = state.get(spanId);
    if (current === "visiting") invalid("generationSpans must not contain parent cycles.");
    if (current === "visited") return;
    state.set(spanId, "visiting");
    const parentSpanId = byId.get(spanId)?.parentSpanId;
    if (parentSpanId !== null && parentSpanId !== undefined) visit(parentSpanId);
    state.set(spanId, "visited");
  }
  for (const span of spans) visit(span.spanId);
}

function modelProfile(span: NormalizedAgentGenerationSpan): AgentExecutionModelProfile {
  return {
    provider: span.provider,
    requestedModel: span.requestedModel,
    resolvedModel: span.resolvedModel,
    modelVersion: span.modelVersion,
    reasoningEffort: span.reasoningEffort,
    serviceTier: span.serviceTier,
  };
}

function nullableSum(values: Array<number | null>): number | null {
  if (values.some(value => value === null)) return null;
  const total = values.reduce<number>((sum, value) => sum + Number(value), 0);
  if (!Number.isSafeInteger(total) || total > MAX_INTEGER) {
    invalid(`Execution provenance totals cannot exceed ${MAX_INTEGER}.`);
  }
  return total;
}

function profileFor(
  spans: NormalizedAgentGenerationSpan[],
  primarySpanId: string,
  schemaVersion: AgentExecutionProfileSchemaVersion,
): AgentExecutionProfile {
  const profiles = new Map<string, AgentExecutionModelProfile>();
  const modelIdentities = new Set<string>();
  for (const span of spans) {
    const profile = modelProfile(span);
    profiles.set(canonicalJson(profile), profile);
    modelIdentities.add(
      canonicalJson({
        provider: profile.provider,
        model: profile.resolvedModel ?? profile.requestedModel,
        modelVersion: profile.modelVersion,
      }),
    );
  }
  const contributors = [...profiles.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, profile]) => profile);
  const primarySpan = spans.find(span => span.spanId === primarySpanId);
  if (!primarySpan) throw new Error("Validated execution provenance is missing its primary span.");
  return {
    schemaVersion,
    orchestrationMode: modelIdentities.size === 1 ? "single_model" : "multi_model",
    primary: modelProfile(primarySpan),
    contributors,
  };
}

function evaluationModelProfile(profile: AgentExecutionModelProfile) {
  return {
    provider: profile.provider,
    requestedModel: profile.requestedModel,
    resolvedModel: profile.resolvedModel,
    modelVersion: profile.modelVersion,
  };
}

function profileCommitmentPayload(profile: AgentExecutionProfile) {
  if (profile.schemaVersion === LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION) return profile;
  const contributors = new Map<string, ReturnType<typeof evaluationModelProfile>>();
  for (const contributor of profile.contributors) {
    const projected = evaluationModelProfile(contributor);
    contributors.set(canonicalJson(projected), projected);
  }
  return {
    schemaVersion: profile.schemaVersion,
    orchestrationMode: profile.orchestrationMode,
    primary: evaluationModelProfile(profile.primary),
    contributors: [...contributors.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, contributor]) => contributor),
  };
}

/**
 * Builds the explicitly versioned profile stored with executions and scopes.
 * v1 treated effort and service tier as partition dimensions. v2 retains those
 * observations in the profile/evidence but excludes them from cohort identity.
 */
export function projectAgentExecutionProfile(
  execution: Pick<NormalizedAgentExecutionProvenance, "generationSpans" | "primarySpanId">,
  schemaVersion: AgentExecutionProfileSchemaVersion = AGENT_EXECUTION_PROFILE_SCHEMA_VERSION,
) {
  return profileFor(execution.generationSpans, execution.primarySpanId, schemaVersion);
}

export function agentExecutionProfileHash(profile: AgentExecutionProfile): `sha256:${string}` {
  return commitment(profileCommitmentPayload(profile));
}

export function legacyAgentExecutionProfileHash(
  execution: Pick<NormalizedAgentExecutionProvenance, "generationSpans" | "primarySpanId">,
) {
  return agentExecutionProfileHash(
    projectAgentExecutionProfile(execution, LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION),
  );
}

export function normalizeAgentExecutionProvenance(input: unknown): NormalizedAgentExecutionProvenance {
  const execution = record(input, "execution");
  assertKnownKeys(execution, EXECUTION_KEYS, "execution");
  const status: AgentExecutionStatus =
    execution.status === "completed" || execution.status === "failed"
      ? execution.status
      : invalid("execution.status must be completed or failed.");
  const timestamps = timestampPair(execution.startedAt, execution.completedAt, "execution");
  const toolCallCount = optionalCount(execution.toolCallCount, "execution.toolCallCount");
  const toolDurationMs = optionalCount(execution.toolDurationMs, "execution.toolDurationMs");
  const primarySpanId = boundedString(execution.primarySpanId, "execution.primarySpanId", 160);
  if (!Array.isArray(execution.generationSpans)) invalid("execution.generationSpans must be an array.");
  if (execution.generationSpans.length < 1 || execution.generationSpans.length > MAX_GENERATION_SPANS) {
    invalid(`execution.generationSpans must contain 1-${MAX_GENERATION_SPANS} spans.`);
  }
  const generationSpans = execution.generationSpans
    .map(normalizeSpan)
    .sort((left, right) => left.spanId.localeCompare(right.spanId));
  assertSpanGraph(generationSpans, primarySpanId);
  if (timestamps.startedAt !== null && timestamps.completedAt !== null) {
    const executionStart = new Date(timestamps.startedAt).getTime();
    const executionEnd = new Date(timestamps.completedAt).getTime();
    for (const span of generationSpans) {
      if (
        span.startedAt !== null &&
        span.completedAt !== null &&
        (new Date(span.startedAt).getTime() < executionStart || new Date(span.completedAt).getTime() > executionEnd)
      ) {
        invalid(`Generation span ${span.spanId} must be within the execution timestamps.`);
      }
    }
  }
  const inputTokens = nullableSum(generationSpans.map(span => span.inputTokens));
  const outputTokens = nullableSum(generationSpans.map(span => span.outputTokens));
  const totals: AgentExecutionTotals = {
    generationSpanCount: generationSpans.length,
    generationDurationMs: nullableSum(generationSpans.map(span => span.durationMs)),
    toolCallCount,
    toolDurationMs,
    inputTokens,
    cachedInputTokens: nullableSum(generationSpans.map(span => span.cachedInputTokens)),
    outputTokens,
    reasoningOutputTokens: nullableSum(generationSpans.map(span => span.reasoningOutputTokens)),
    totalTokens: inputTokens === null || outputTokens === null ? null : nullableSum([inputTokens, outputTokens]),
  };
  const executionProfile = profileFor(generationSpans, primarySpanId, AGENT_EXECUTION_PROFILE_SCHEMA_VERSION);
  const manifest = {
    schemaVersion: AGENT_EXECUTION_MANIFEST_SCHEMA_VERSION,
    externalExecutionId: boundedString(execution.externalExecutionId, "execution.externalExecutionId", 160),
    status,
    ...timestamps,
    toolCallCount,
    toolDurationMs,
    primarySpanId,
    generationSpans,
    totals,
  };
  return {
    ...manifest,
    manifestCommitment: commitment(manifest),
    executionProfile,
    executionProfileHash: agentExecutionProfileHash(executionProfile),
  };
}
