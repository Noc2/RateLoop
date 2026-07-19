import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import "server-only";
import { dbPool } from "~~/lib/db";
import {
  type AdaptiveReviewDecisionRequest,
  evaluateAdaptiveReviewRequirement,
} from "~~/lib/tokenless/adaptiveReviewService";
import {
  type AgentExecutionProvenanceInput,
  type NormalizedAgentExecutionProvenance,
  legacyAgentExecutionProfileHash,
  normalizeAgentExecutionProvenance,
} from "~~/lib/tokenless/agentExecutionProvenance";
import {
  type OtlpKeyValue,
  type OtlpPrimitive,
  type OtlpResourceSpans,
  type OtlpSpan,
  type OtlpTraceExportRequest,
  decodeOtlpTraceProtobuf,
} from "~~/lib/tokenless/otlpTraceProtobuf";
import {
  type ProductPrincipal,
  authenticateProductPrincipal,
  requireProductPrincipalScope,
} from "~~/lib/tokenless/productCore";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const OTLP_HTTP_PROTOCOL_PIN = "opentelemetry-otlp/1.10.0" as const;
export const OTLP_CORE_SEMCONV_PIN = "open-telemetry/semantic-conventions@v1.43.0" as const;
export const OTLP_GENAI_SEMCONV_PIN =
  "open-telemetry/semantic-conventions-genai@0183a25b3d6970d993fd3e77b0471b8d518efe83" as const;
export const OTLP_PROVENANCE_SOURCE = {
  kind: "host_reported",
  independentlyVerified: false,
  attestation: null,
} as const;
export const OTLP_REVIEW_MAPPING_PIN = "rateloop.otlp-review-attributes.v1" as const;

export const OTLP_INGEST_LIMITS = {
  compressedBytes: 1_048_576,
  decompressedBytes: 4_194_304,
  resourceSpans: 32,
  scopeSpans: 128,
  spans: 512,
  traces: 128,
  attributesPerEntity: 64,
  totalAttributes: 8_192,
  uniqueAttributeKeys: 256,
  eventsPerSpan: 64,
  linksPerSpan: 64,
} as const;

const TRACE_ID_PATTERN = /^[0-9a-f]{32}$/u;
const SPAN_ID_PATTERN = /^[0-9a-f]{16}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{3,160}$/u;
const REVIEW_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const REVIEW_RISK_TIER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GENERATION_OPERATIONS = new Set([
  "chat",
  "generate_content",
  "invoke_agent",
  "invoke_workflow",
  "text_completion",
]);
const MAX_INTEGER = 2_147_483_647;

type QueryRow = Record<string, unknown>;
type OtlpPrincipal = Extract<ProductPrincipal, { kind: "api_key" }>;

type MaterializedSpan = OtlpSpan & {
  attributesByKey: Map<string, OtlpPrimitive>;
  agentId: string | null;
  agentVersionId: string | null;
};

type TraceGroup = {
  traceId: string;
  spans: MaterializedSpan[];
};

type TraceMapping = {
  agentId: string;
  agentVersionId: string;
  execution: NormalizedAgentExecutionProvenance;
  reviewRequest: AdaptiveReviewDecisionRequest | null;
};

export type OtlpTraceIngestResult = {
  acceptedSpans: number;
  acceptedExecutions: number;
  deduplicatedExecutions: number;
  rejectedSpans: number;
  errorMessage: string;
};

function invalid(message: string, code = "invalid_otlp_request", status = 400): never {
  throw new TokenlessServiceError(message, status, code);
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function array(value: unknown, name: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid(`${name} must be an array.`);
  return value;
}

function boundedArray(value: unknown, name: string, maximum: number): unknown[] {
  const result = array(value, name);
  if (result.length > maximum) invalid(`${name} exceeds the ${maximum}-item ingest limit.`, "otlp_limit_exceeded", 413);
  return result;
}

function boundedString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    invalid(`${name} must be 1-${maximum} characters.`);
  }
  return value;
}

function enumInteger(value: unknown, name: string): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(`${name} must use the OTLP integer enum encoding.`);
  return Number(value);
}

function int64String(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/u.test(value)) {
    invalid(`${name} must be an unsigned decimal string.`);
  }
  return value;
}

function jsonAnyValue(value: unknown, name: string): OtlpPrimitive | null {
  const anyValue = record(value, name);
  const populated = [
    "stringValue",
    "boolValue",
    "intValue",
    "doubleValue",
    "arrayValue",
    "kvlistValue",
    "bytesValue",
  ].filter(key => anyValue[key] !== undefined);
  if (populated.length > 1) invalid(`${name} must contain one AnyValue field.`);
  if (anyValue.stringValue !== undefined) return boundedString(anyValue.stringValue, `${name}.stringValue`, 4_096);
  if (anyValue.boolValue !== undefined) {
    if (typeof anyValue.boolValue !== "boolean") invalid(`${name}.boolValue must be boolean.`);
    return anyValue.boolValue;
  }
  if (anyValue.intValue !== undefined) return int64String(anyValue.intValue, `${name}.intValue`);
  if (anyValue.doubleValue !== undefined) {
    if (typeof anyValue.doubleValue !== "number" || !Number.isFinite(anyValue.doubleValue)) {
      invalid(`${name}.doubleValue must be finite.`);
    }
    return anyValue.doubleValue;
  }
  // Nested and byte values may contain prompts, messages, or tool payloads. They
  // count toward request limits but are never materialized or persisted.
  return null;
}

function jsonAttributes(value: unknown, name: string): OtlpKeyValue[] {
  return boundedArray(value, name, OTLP_INGEST_LIMITS.attributesPerEntity).map((entry, index) => {
    const item = record(entry, `${name}[${index}]`);
    return {
      key: boundedString(item.key, `${name}[${index}].key`, 256),
      value: item.value === undefined ? null : jsonAnyValue(item.value, `${name}[${index}].value`),
    };
  });
}

function jsonSpan(value: unknown, name: string): OtlpSpan {
  const span = record(value, name);
  const events = boundedArray(span.events, `${name}.events`, OTLP_INGEST_LIMITS.eventsPerSpan);
  const links = boundedArray(span.links, `${name}.links`, OTLP_INGEST_LIMITS.linksPerSpan);
  const status = span.status === undefined ? {} : record(span.status, `${name}.status`);
  return {
    traceId: typeof span.traceId === "string" ? span.traceId.toLowerCase() : "",
    spanId: typeof span.spanId === "string" ? span.spanId.toLowerCase() : "",
    parentSpanId: typeof span.parentSpanId === "string" ? span.parentSpanId.toLowerCase() : "",
    name: typeof span.name === "string" ? span.name : "",
    kind: enumInteger(span.kind, `${name}.kind`),
    startTimeUnixNano: int64String(span.startTimeUnixNano, `${name}.startTimeUnixNano`),
    endTimeUnixNano: int64String(span.endTimeUnixNano, `${name}.endTimeUnixNano`),
    attributes: jsonAttributes(span.attributes, `${name}.attributes`),
    statusCode: enumInteger(status.code, `${name}.status.code`),
    eventCount: events.length,
    linkCount: links.length,
  };
}

export function parseOtlpTraceJson(value: unknown): OtlpTraceExportRequest {
  const request = record(value, "OTLP trace export");
  const resourceSpans = boundedArray(request.resourceSpans, "resourceSpans", OTLP_INGEST_LIMITS.resourceSpans).map(
    (resourceValue, resourceIndex): OtlpResourceSpans => {
      const resourceSpan = record(resourceValue, `resourceSpans[${resourceIndex}]`);
      const resource = resourceSpan.resource === undefined ? {} : record(resourceSpan.resource, "resource");
      const scopeSpans = boundedArray(
        resourceSpan.scopeSpans,
        `resourceSpans[${resourceIndex}].scopeSpans`,
        OTLP_INGEST_LIMITS.scopeSpans,
      ).map((scopeValue, scopeIndex) => {
        const scope = record(scopeValue, `resourceSpans[${resourceIndex}].scopeSpans[${scopeIndex}]`);
        return {
          spans: boundedArray(
            scope.spans,
            `resourceSpans[${resourceIndex}].scopeSpans[${scopeIndex}].spans`,
            OTLP_INGEST_LIMITS.spans,
          ).map((span, spanIndex) =>
            jsonSpan(span, `resourceSpans[${resourceIndex}].scopeSpans[${scopeIndex}].spans[${spanIndex}]`),
          ),
        };
      });
      return {
        resourceAttributes: jsonAttributes(resource.attributes, `resourceSpans[${resourceIndex}].resource.attributes`),
        scopeSpans,
      };
    },
  );
  return { resourceSpans };
}

export function parseOtlpTraceBody(
  contentType: string | null,
  body: Buffer,
): {
  format: "json" | "protobuf";
  request: OtlpTraceExportRequest;
} {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/json") {
    let value: unknown;
    try {
      value = JSON.parse(body.toString("utf8"));
    } catch {
      invalid("OTLP JSON payload is malformed.", "invalid_otlp_json");
    }
    return { format: "json", request: parseOtlpTraceJson(value) };
  }
  if (
    mediaType === "application/x-protobuf" ||
    mediaType === "application/protobuf" ||
    mediaType === "application/vnd.google.protobuf"
  ) {
    return { format: "protobuf", request: decodeOtlpTraceProtobuf(body) };
  }
  invalid("OTLP traces require application/json or application/x-protobuf.", "unsupported_otlp_content_type", 415);
}

function validateRequestLimits(request: OtlpTraceExportRequest) {
  if (request.resourceSpans.length > OTLP_INGEST_LIMITS.resourceSpans) {
    invalid("resourceSpans exceeds the ingest limit.", "otlp_limit_exceeded", 413);
  }
  let scopeCount = 0;
  let spanCount = 0;
  let attributeCount = 0;
  const attributeKeys = new Set<string>();
  for (const resource of request.resourceSpans) {
    if (resource.resourceAttributes.length > OTLP_INGEST_LIMITS.attributesPerEntity) {
      invalid("A resource exceeds the attribute ingest limit.", "otlp_limit_exceeded", 413);
    }
    scopeCount += resource.scopeSpans.length;
    attributeCount += resource.resourceAttributes.length;
    for (const attribute of resource.resourceAttributes) attributeKeys.add(attribute.key);
    for (const scope of resource.scopeSpans) {
      spanCount += scope.spans.length;
      for (const span of scope.spans) {
        if (span.eventCount > OTLP_INGEST_LIMITS.eventsPerSpan || span.linkCount > OTLP_INGEST_LIMITS.linksPerSpan) {
          invalid("An OTLP span exceeds the event or link ingest limit.", "otlp_limit_exceeded", 413);
        }
        if (span.attributes.length > OTLP_INGEST_LIMITS.attributesPerEntity) {
          invalid("A span exceeds the attribute ingest limit.", "otlp_limit_exceeded", 413);
        }
        attributeCount += span.attributes.length;
        for (const attribute of span.attributes) attributeKeys.add(attribute.key);
      }
    }
  }
  if (scopeCount > OTLP_INGEST_LIMITS.scopeSpans) {
    invalid("scopeSpans exceeds the ingest limit.", "otlp_limit_exceeded", 413);
  }
  if (spanCount > OTLP_INGEST_LIMITS.spans) invalid("spans exceeds the ingest limit.", "otlp_limit_exceeded", 413);
  if (attributeCount > OTLP_INGEST_LIMITS.totalAttributes) {
    invalid("OTLP attributes exceed the ingest limit.", "otlp_limit_exceeded", 413);
  }
  if (attributeKeys.size > OTLP_INGEST_LIMITS.uniqueAttributeKeys) {
    invalid("OTLP attribute-key cardinality exceeds the ingest limit.", "otlp_limit_exceeded", 413);
  }
}

function attributesMap(attributes: OtlpKeyValue[]): Map<string, OtlpPrimitive> {
  const result = new Map<string, OtlpPrimitive>();
  for (const attribute of attributes) {
    if (typeof attribute.key !== "string" || attribute.key.length < 1 || attribute.key.length > 256) continue;
    if (attribute.value !== null) result.set(attribute.key, attribute.value);
  }
  return result;
}

function attributeString(attributes: Map<string, OtlpPrimitive>, key: string): string | null {
  const value = attributes.get(key);
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function materializeSpans(request: OtlpTraceExportRequest): { groups: TraceGroup[]; preRejectedSpans: number } {
  validateRequestLimits(request);
  const groups = new Map<string, MaterializedSpan[]>();
  let preRejectedSpans = 0;
  for (const resource of request.resourceSpans) {
    const resourceAttributes = attributesMap(resource.resourceAttributes);
    for (const scope of resource.scopeSpans) {
      for (const span of scope.spans) {
        const traceId = span.traceId.toLowerCase();
        const spanId = span.spanId.toLowerCase();
        const parentSpanId = span.parentSpanId.toLowerCase();
        if (
          !TRACE_ID_PATTERN.test(traceId) ||
          !SPAN_ID_PATTERN.test(spanId) ||
          (parentSpanId !== "" && !SPAN_ID_PATTERN.test(parentSpanId))
        ) {
          preRejectedSpans += 1;
          continue;
        }
        const attributesByKey = new Map(resourceAttributes);
        for (const [key, value] of attributesMap(span.attributes)) attributesByKey.set(key, value);
        const agentId = attributeString(attributesByKey, "rateloop.agent.id");
        const agentVersionId = attributeString(attributesByKey, "rateloop.agent.version.id");
        const materialized: MaterializedSpan = {
          ...span,
          traceId,
          spanId,
          parentSpanId,
          attributesByKey,
          agentId,
          agentVersionId,
        };
        const group = groups.get(traceId) ?? [];
        group.push(materialized);
        groups.set(traceId, group);
      }
    }
  }
  if (groups.size > OTLP_INGEST_LIMITS.traces) invalid("traces exceeds the ingest limit.", "otlp_limit_exceeded", 413);
  return {
    groups: [...groups.entries()]
      .map(([traceId, spans]) => ({ traceId, spans }))
      .sort((left, right) => left.traceId.localeCompare(right.traceId)),
    preRejectedSpans,
  };
}

function nanoTimestamp(value: string, name: string): { iso: string; nanos: bigint } {
  if (!/^(0|[1-9]\d*)$/u.test(value)) invalid(`${name} must be an unsigned nanosecond timestamp.`);
  const nanos = BigInt(value);
  const milliseconds = nanos / 1_000_000n;
  if (milliseconds > 8_640_000_000_000_000n) invalid(`${name} is outside the supported date range.`);
  const date = new Date(Number(milliseconds));
  if (!Number.isFinite(date.getTime())) invalid(`${name} is outside the supported date range.`);
  return { iso: date.toISOString(), nanos };
}

function boundedCount(value: OtlpPrimitive | undefined, name: string): number | null {
  if (value === undefined) return null;
  const parsed =
    typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_INTEGER) invalid(`${name} is invalid.`);
  return parsed;
}

function boundedOptionalAttribute(attributes: Map<string, OtlpPrimitive>, key: string, maximum: number): string | null {
  const value = attributeString(attributes, key);
  if (value === null) return null;
  if (value.length > maximum) invalid(`${key} exceeds ${maximum} characters.`);
  return value;
}

const OTLP_REVIEW_ATTRIBUTES = [
  "rateloop.review.policy.id",
  "rateloop.review.policy.version",
  "rateloop.review.workflow.key",
  "rateloop.review.risk.tier",
  "rateloop.review.audience_policy_hash",
  "rateloop.review.suggestion_commitment",
  "rateloop.review.declared_confidence_bps",
  "rateloop.review.critical_risk",
  "rateloop.review.metadata_complete",
] as const;

function reviewBoolean(attributes: Map<string, OtlpPrimitive>, key: string, required: boolean) {
  const value = attributes.get(key);
  if (value === undefined && !required) return null;
  if (typeof value !== "boolean") invalid(`${key} must be a boolean.`, "invalid_otlp_review_mapping");
  return value;
}

function reviewInteger(
  attributes: Map<string, OtlpPrimitive>,
  key: string,
  minimum: number,
  maximum: number,
  required: boolean,
) {
  const value = attributes.get(key);
  if (value === undefined && !required) return null;
  const parsed =
    typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    invalid(`${key} must be an integer from ${minimum} to ${maximum}.`, "invalid_otlp_review_mapping");
  }
  return parsed;
}

function reviewString(attributes: Map<string, OtlpPrimitive>, key: string, pattern: RegExp, description: string) {
  const value = attributeString(attributes, key);
  if (value === null || !pattern.test(value)) {
    invalid(`${key} must be ${description}.`, "invalid_otlp_review_mapping");
  }
  return value;
}

function mapReviewRequest(input: {
  group: TraceGroup;
  primary: MaterializedSpan;
  agentId: string;
  agentVersionId: string;
  execution: NormalizedAgentExecutionProvenance;
}): AdaptiveReviewDecisionRequest | null {
  const attributes = input.primary.attributesByKey;
  const eligible = reviewBoolean(attributes, "rateloop.review.eligible", false);
  const hasReviewMetadata = OTLP_REVIEW_ATTRIBUTES.some(key => attributes.has(key));
  if (eligible !== true) {
    if (hasReviewMetadata) {
      invalid("OTLP review attributes require rateloop.review.eligible=true.", "invalid_otlp_review_mapping");
    }
    return null;
  }
  if (input.execution.status !== "completed") {
    invalid("A failed OTLP execution cannot declare an eligible output.", "invalid_otlp_review_mapping");
  }
  const policyId = reviewString(
    attributes,
    "rateloop.review.policy.id",
    REVIEW_IDENTIFIER_PATTERN,
    "a bounded policy identifier",
  );
  const workflowKey = reviewString(
    attributes,
    "rateloop.review.workflow.key",
    REVIEW_IDENTIFIER_PATTERN,
    "a bounded workflow identifier",
  );
  const riskTier = reviewString(
    attributes,
    "rateloop.review.risk.tier",
    REVIEW_RISK_TIER_PATTERN,
    "a lowercase risk tier",
  );
  const audiencePolicyHash = reviewString(
    attributes,
    "rateloop.review.audience_policy_hash",
    SHA256_PATTERN,
    "a sha256 commitment",
  );
  const suggestionCommitment = reviewString(
    attributes,
    "rateloop.review.suggestion_commitment",
    SHA256_PATTERN,
    "a sha256 commitment",
  );
  return {
    externalOpportunityId: `otlp:${input.group.traceId}`,
    agentId: input.agentId,
    agentVersionId: input.agentVersionId,
    policyId,
    policyVersion: reviewInteger(attributes, "rateloop.review.policy.version", 1, MAX_INTEGER, true)!,
    workflowKey,
    riskTier,
    audiencePolicyHash,
    suggestionCommitment,
    sourceEvidence: {
      reference: `otlp-trace/${input.group.traceId}`,
      hash: input.execution.manifestCommitment,
    },
    declaredConfidenceBps: reviewInteger(attributes, "rateloop.review.declared_confidence_bps", 0, 10_000, false),
    criticalRisk: reviewBoolean(attributes, "rateloop.review.critical_risk", false) ?? false,
    metadataComplete: reviewBoolean(attributes, "rateloop.review.metadata_complete", true)!,
    execution: input.execution,
  };
}

function isToolSpan(span: MaterializedSpan) {
  return (
    attributeString(span.attributesByKey, "gen_ai.operation.name") === "execute_tool" ||
    attributeString(span.attributesByKey, "rpc.system.name") === "mcp" ||
    attributeString(span.attributesByKey, "rpc.system") === "mcp" ||
    attributeString(span.attributesByKey, "mcp.method.name") !== null ||
    attributeString(span.attributesByKey, "mcp.method") !== null
  );
}

function mapTrace(group: TraceGroup): TraceMapping {
  if (group.spans.length === 0) invalid("OTLP trace contains no valid spans.");
  const agentIds = new Set(group.spans.map(span => span.agentId).filter((value): value is string => value !== null));
  const versionIds = new Set(
    group.spans.map(span => span.agentVersionId).filter((value): value is string => value !== null),
  );
  if (agentIds.size !== 1 || versionIds.size !== 1) {
    invalid(
      "Every trace must bind consistently to rateloop.agent.id and rateloop.agent.version.id.",
      "invalid_otlp_binding",
    );
  }
  const agentId = [...agentIds][0]!;
  const agentVersionId = [...versionIds][0]!;
  if (group.spans.some(span => span.agentId !== agentId || span.agentVersionId !== agentVersionId)) {
    invalid(
      "Every trace must bind consistently to rateloop.agent.id and rateloop.agent.version.id.",
      "invalid_otlp_binding",
    );
  }
  if (!IDENTIFIER_PATTERN.test(agentId) || !IDENTIFIER_PATTERN.test(agentVersionId)) {
    invalid("RateLoop agent identifiers in OTLP resource attributes are invalid.", "invalid_otlp_binding");
  }
  if (new Set(group.spans.map(span => span.spanId)).size !== group.spans.length) {
    invalid("OTLP trace contains duplicate span IDs.", "invalid_otlp_trace");
  }
  const allById = new Map(group.spans.map(span => [span.spanId, span]));
  const generationSpans = group.spans.filter(span => {
    const operation = attributeString(span.attributesByKey, "gen_ai.operation.name");
    return operation !== null && GENERATION_OPERATIONS.has(operation);
  });
  if (generationSpans.length < 1 || generationSpans.length > 64) {
    invalid("Each OTLP trace must contain 1-64 supported GenAI generation spans.", "invalid_otlp_trace");
  }
  const startValues = group.spans.map(span => nanoTimestamp(span.startTimeUnixNano, "span.startTimeUnixNano"));
  const endValues = group.spans.map(span => nanoTimestamp(span.endTimeUnixNano, "span.endTimeUnixNano"));
  for (let index = 0; index < group.spans.length; index += 1) {
    if (endValues[index]!.nanos < startValues[index]!.nanos)
      invalid("A span ends before it starts.", "invalid_otlp_trace");
  }
  const generationIds = new Set(generationSpans.map(span => span.spanId));
  const orderedGenerations = [...generationSpans].sort((left, right) => {
    const leftInvoke = attributeString(left.attributesByKey, "gen_ai.operation.name") === "invoke_agent" ? 0 : 1;
    const rightInvoke = attributeString(right.attributesByKey, "gen_ai.operation.name") === "invoke_agent" ? 0 : 1;
    const invokeOrder = leftInvoke - rightInvoke;
    if (invokeOrder !== 0) return invokeOrder;
    const leftStartedAt = BigInt(left.startTimeUnixNano);
    const rightStartedAt = BigInt(right.startTimeUnixNano);
    if (leftStartedAt < rightStartedAt) return -1;
    if (leftStartedAt > rightStartedAt) return 1;
    return left.spanId.localeCompare(right.spanId);
  });
  const primary = orderedGenerations[0]!;
  const nearestGenerationParent = (span: MaterializedSpan): string | null => {
    let parentId = span.parentSpanId || null;
    const visited = new Set<string>([span.spanId]);
    while (parentId) {
      if (visited.has(parentId)) invalid("OTLP trace contains a parent cycle.", "invalid_otlp_trace");
      visited.add(parentId);
      if (generationIds.has(parentId)) return parentId;
      parentId = allById.get(parentId)?.parentSpanId || null;
    }
    return null;
  };
  const toolSpans = group.spans.filter(isToolSpan);
  const executionStart = startValues.reduce((minimum, entry) => (entry.nanos < minimum.nanos ? entry : minimum));
  const executionEnd = endValues.reduce((maximum, entry) => (entry.nanos > maximum.nanos ? entry : maximum));
  const toolDurationMs = toolSpans.reduce((sum, span) => {
    const start = BigInt(span.startTimeUnixNano);
    const end = BigInt(span.endTimeUnixNano);
    const duration = Number((end - start) / 1_000_000n);
    if (!Number.isSafeInteger(duration) || duration < 0 || sum + duration > MAX_INTEGER) {
      invalid("Tool span duration exceeds the supported range.", "invalid_otlp_trace");
    }
    return sum + duration;
  }, 0);
  const executionInput: AgentExecutionProvenanceInput = {
    externalExecutionId: `otlp:${group.traceId}`,
    status: group.spans.some(
      span => span.statusCode === 2 || attributeString(span.attributesByKey, "error.type") !== null,
    )
      ? "failed"
      : "completed",
    startedAt: executionStart.iso,
    completedAt: executionEnd.iso,
    toolCallCount: toolSpans.length,
    toolDurationMs,
    primarySpanId: primary.spanId,
    generationSpans: generationSpans.map(span => {
      const startedAt = nanoTimestamp(span.startTimeUnixNano, "span.startTimeUnixNano");
      const completedAt = nanoTimestamp(span.endTimeUnixNano, "span.endTimeUnixNano");
      const provider =
        boundedOptionalAttribute(span.attributesByKey, "gen_ai.provider.name", 120) ??
        boundedOptionalAttribute(span.attributesByKey, "service.name", 120) ??
        "unknown";
      const requestedModel =
        boundedOptionalAttribute(span.attributesByKey, "gen_ai.request.model", 200) ??
        boundedOptionalAttribute(span.attributesByKey, "gen_ai.response.model", 200) ??
        "unknown";
      const responseId = boundedOptionalAttribute(span.attributesByKey, "gen_ai.response.id", 1_024);
      return {
        spanId: span.spanId,
        parentSpanId: nearestGenerationParent(span),
        role:
          span.spanId === primary.spanId
            ? ("primary" as const)
            : attributeString(span.attributesByKey, "gen_ai.operation.name") === "invoke_agent"
              ? ("subagent" as const)
              : ("supporting" as const),
        provider,
        requestedModel,
        resolvedModel: boundedOptionalAttribute(span.attributesByKey, "gen_ai.response.model", 200),
        modelVersion:
          boundedOptionalAttribute(span.attributesByKey, "gen_ai.agent.version", 160) ??
          boundedOptionalAttribute(span.attributesByKey, "gen_ai.response.model_version", 160),
        reasoningEffort:
          boundedOptionalAttribute(span.attributesByKey, "gen_ai.request.reasoning.level", 80) ??
          boundedOptionalAttribute(span.attributesByKey, "gen_ai.request.reasoning_effort", 80),
        serviceTier: boundedOptionalAttribute(span.attributesByKey, "gen_ai.request.service_tier", 80),
        startedAt: startedAt.iso,
        completedAt: completedAt.iso,
        inputTokens: boundedCount(span.attributesByKey.get("gen_ai.usage.input_tokens"), "gen_ai.usage.input_tokens"),
        cachedInputTokens: boundedCount(
          span.attributesByKey.get("gen_ai.usage.cache_read.input_tokens"),
          "gen_ai.usage.cache_read.input_tokens",
        ),
        outputTokens: boundedCount(
          span.attributesByKey.get("gen_ai.usage.output_tokens"),
          "gen_ai.usage.output_tokens",
        ),
        reasoningOutputTokens: boundedCount(
          span.attributesByKey.get("gen_ai.usage.reasoning.output_tokens"),
          "gen_ai.usage.reasoning.output_tokens",
        ),
        responseIdHash: responseId === null ? null : `sha256:${createHash("sha256").update(responseId).digest("hex")}`,
        finishReason: boundedOptionalAttribute(span.attributesByKey, "gen_ai.response.finish_reason", 160),
      };
    }),
  };
  const execution = normalizeAgentExecutionProvenance(executionInput);
  return {
    agentId,
    agentVersionId,
    execution,
    reviewRequest: mapReviewRequest({ group, primary, agentId, agentVersionId, execution }),
  };
}

function deterministicExecutionId(workspaceId: string, agentId: string, externalExecutionId: string) {
  return `aex_${createHash("sha256")
    .update([workspaceId, agentId, externalExecutionId].join("\0"))
    .digest("hex")
    .slice(0, 40)}`;
}

function rowString(row: QueryRow | undefined, key: string): string | null {
  const value = row?.[key];
  return typeof value === "string" ? value : value === null || value === undefined ? null : String(value);
}

function parentFirstSpans(execution: NormalizedAgentExecutionProvenance) {
  const byId = new Map(execution.generationSpans.map(span => [span.spanId, span]));
  const depth = (spanId: string, visited = new Set<string>()): number => {
    if (visited.has(spanId)) invalid("Generation span graph contains a cycle.", "invalid_otlp_trace");
    visited.add(spanId);
    const parent = byId.get(spanId)?.parentSpanId;
    return parent ? 1 + depth(parent, visited) : 0;
  };
  return [...execution.generationSpans].sort(
    (left, right) => depth(left.spanId) - depth(right.spanId) || left.spanId.localeCompare(right.spanId),
  );
}

async function persistMappedTrace(
  client: PoolClient,
  workspaceId: string,
  mapping: TraceMapping,
): Promise<{ deduplicated: boolean }> {
  const binding = await client.query(
    `SELECT a.status
     FROM tokenless_agents a
     JOIN tokenless_agent_versions v
       ON v.workspace_id=a.workspace_id AND v.agent_id=a.agent_id
     WHERE a.workspace_id=$1 AND a.agent_id=$2 AND v.version_id=$3
     LIMIT 1`,
    [workspaceId, mapping.agentId, mapping.agentVersionId],
  );
  if (rowString(binding.rows[0] as QueryRow | undefined, "status") !== "active") {
    invalid("OTLP trace is not bound to an active agent version in this workspace.", "invalid_otlp_binding");
  }
  const execution = mapping.execution;
  const executionId = deterministicExecutionId(workspaceId, mapping.agentId, execution.externalExecutionId);
  const existingExecution = await client.query(
    `SELECT execution_id, agent_version_id, integration_id, manifest_commitment, execution_profile_hash
     FROM tokenless_agent_executions
     WHERE workspace_id=$1 AND agent_id=$2 AND external_execution_id=$3
     LIMIT 1`,
    [workspaceId, mapping.agentId, execution.externalExecutionId],
  );
  const assertExactReplay = (row: QueryRow | undefined) => {
    const storedProfileHash = rowString(row, "execution_profile_hash");
    if (
      rowString(row, "execution_id") !== executionId ||
      rowString(row, "agent_version_id") !== mapping.agentVersionId ||
      rowString(row, "integration_id") !== null ||
      rowString(row, "manifest_commitment") !== execution.manifestCommitment ||
      (storedProfileHash !== execution.executionProfileHash &&
        storedProfileHash !== legacyAgentExecutionProfileHash(execution))
    ) {
      invalid("OTLP trace ID is already bound to different immutable provenance.", "otlp_execution_conflict", 409);
    }
  };
  if (existingExecution.rowCount === 1) {
    assertExactReplay(existingExecution.rows[0] as QueryRow | undefined);
    return { deduplicated: true };
  }
  const inserted = await client.query(
    `INSERT INTO tokenless_agent_executions
     (execution_id, workspace_id, agent_id, agent_version_id, integration_id, external_execution_id,
      status, metadata_source, started_at, completed_at, total_duration_ms, tool_call_count, tool_duration_ms,
      model_call_count, input_token_total, cached_input_token_total, output_token_total,
      reasoning_output_token_total, primary_span_id, manifest_commitment, execution_profile_hash,
      execution_profile_json, created_at)
     VALUES ($1,$2,$3,$4,NULL,$5,$6,'host_reported',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (workspace_id, agent_id, external_execution_id) DO NOTHING
     RETURNING execution_id`,
    [
      executionId,
      workspaceId,
      mapping.agentId,
      mapping.agentVersionId,
      execution.externalExecutionId,
      execution.status,
      execution.startedAt ? new Date(execution.startedAt) : null,
      execution.completedAt ? new Date(execution.completedAt) : null,
      execution.durationMs,
      execution.toolCallCount,
      execution.toolDurationMs,
      execution.totals.generationSpanCount,
      execution.totals.inputTokens,
      execution.totals.cachedInputTokens,
      execution.totals.outputTokens,
      execution.totals.reasoningOutputTokens,
      execution.primarySpanId,
      execution.manifestCommitment,
      execution.executionProfileHash,
      JSON.stringify(execution.executionProfile),
      new Date(),
    ],
  );
  if (inserted.rowCount === 0) {
    const existing = await client.query(
      `SELECT execution_id, agent_version_id, integration_id, manifest_commitment, execution_profile_hash
       FROM tokenless_agent_executions
       WHERE workspace_id=$1 AND agent_id=$2 AND external_execution_id=$3
       LIMIT 1`,
      [workspaceId, mapping.agentId, execution.externalExecutionId],
    );
    assertExactReplay(existing.rows[0] as QueryRow | undefined);
    return { deduplicated: true };
  }
  for (const span of parentFirstSpans(execution)) {
    await client.query(
      `INSERT INTO tokenless_agent_generation_spans
       (execution_id,span_id,parent_span_id,role,provider,requested_model,resolved_model,model_version,
        reasoning_effort,service_tier,started_at,completed_at,duration_ms,time_to_first_output_ms,
        input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,response_id_hash,
        finish_reason,metadata_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'host_reported')`,
      [
        executionId,
        span.spanId,
        span.parentSpanId,
        span.role,
        span.provider,
        span.requestedModel,
        span.resolvedModel,
        span.modelVersion,
        span.reasoningEffort,
        span.serviceTier,
        span.startedAt ? new Date(span.startedAt) : null,
        span.completedAt ? new Date(span.completedAt) : null,
        span.durationMs,
        span.timeToFirstOutputMs,
        span.inputTokens,
        span.cachedInputTokens,
        span.outputTokens,
        span.reasoningOutputTokens,
        span.responseIdHash,
        span.finishReason,
      ],
    );
  }
  return { deduplicated: false };
}

export async function authenticateOtlpTracePrincipal(authorization: string | null): Promise<OtlpPrincipal> {
  if (!authorization) invalid("A workspace API key is required for OTLP ingest.", "workspace_api_key_required", 401);
  const principal = await authenticateProductPrincipal({ authorization, sessionToken: undefined });
  if (principal.kind !== "api_key") {
    invalid("A workspace API key is required for OTLP ingest.", "workspace_api_key_required", 401);
  }
  requireProductPrincipalScope(principal, "telemetry:write");
  return principal;
}

function partialMessage(codes: Set<string>) {
  if (codes.size === 0) return "";
  return `Some spans were rejected (${[...codes].sort().join(", ")}). RateLoop stores only host-reported provenance.`.slice(
    0,
    512,
  );
}

export async function ingestOtlpTraces(input: {
  principal: OtlpPrincipal;
  request: OtlpTraceExportRequest;
  evaluateReview?: typeof evaluateAdaptiveReviewRequirement;
}): Promise<OtlpTraceIngestResult> {
  requireProductPrincipalScope(input.principal, "telemetry:write");
  const materialized = materializeSpans(input.request);
  let acceptedSpans = 0;
  let acceptedExecutions = 0;
  let deduplicatedExecutions = 0;
  let rejectedSpans = materialized.preRejectedSpans;
  const rejectionCodes = new Set<string>();
  if (materialized.preRejectedSpans > 0) rejectionCodes.add("invalid_span_id");
  for (const group of materialized.groups) {
    let mapping: TraceMapping;
    try {
      mapping = mapTrace(group);
    } catch (error) {
      if (!(error instanceof TokenlessServiceError) || error.status >= 500) throw error;
      rejectedSpans += group.spans.length;
      rejectionCodes.add(error.code);
      continue;
    }
    try {
      if (mapping.reviewRequest) {
        requireProductPrincipalScope(input.principal, "review:decide");
        await (input.evaluateReview ?? evaluateAdaptiveReviewRequirement)({
          principal: input.principal,
          request: mapping.reviewRequest,
        });
      }
    } catch (error) {
      if (!(error instanceof TokenlessServiceError) || error.status >= 500) throw error;
      rejectedSpans += group.spans.length;
      rejectionCodes.add(error.code);
      continue;
    }
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      const stored = await persistMappedTrace(client, input.principal.workspaceId, mapping);
      await client.query("COMMIT");
      acceptedSpans += group.spans.length;
      acceptedExecutions += 1;
      if (stored.deduplicated) deduplicatedExecutions += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      if (!(error instanceof TokenlessServiceError) || error.status >= 500) throw error;
      rejectedSpans += group.spans.length;
      rejectionCodes.add(error.code);
    } finally {
      client.release();
    }
  }
  return {
    acceptedSpans,
    acceptedExecutions,
    deduplicatedExecutions,
    rejectedSpans,
    errorMessage: partialMessage(rejectionCodes),
  };
}

export const __otlpTraceIngestTestUtils = {
  mapTrace,
  materializeSpans,
};
