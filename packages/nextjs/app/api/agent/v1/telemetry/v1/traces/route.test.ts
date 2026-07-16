import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { gzipSync } from "node:zlib";
import { POST } from "~~/app/api/agent/v1/telemetry/v1/traces/route";
import { __setDatabaseResourcesForTests, dbClient } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspaceAgent } from "~~/lib/tokenless/agentRegistry";
import {
  OTLP_CORE_SEMCONV_PIN,
  OTLP_GENAI_SEMCONV_PIN,
  OTLP_HTTP_PROTOCOL_PIN,
  OTLP_PROVENANCE_SOURCE,
  OTLP_REVIEW_MAPPING_PIN,
  authenticateOtlpTracePrincipal,
  ingestOtlpTraces,
  parseOtlpTraceJson,
} from "~~/lib/tokenless/otlpTraceIngest";
import { createWorkspace, createWorkspaceApiKey } from "~~/lib/tokenless/productCore";

const OWNER = "0x1111111111111111111111111111111111111111";
type JsonRecord = Record<string, unknown>;

beforeEach(() => {
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
});

function fixture(): JsonRecord {
  return JSON.parse(
    readFileSync(join(process.cwd(), "lib/tokenless/fixtures/otlp-genai-traces.json"), "utf8"),
  ) as JsonRecord;
}

function resourceSpans(value: JsonRecord): JsonRecord[] {
  return value.resourceSpans as JsonRecord[];
}

function scopeSpans(value: JsonRecord): JsonRecord[] {
  return value.scopeSpans as JsonRecord[];
}

function spans(value: JsonRecord): JsonRecord[] {
  return value.spans as JsonRecord[];
}

function attributes(value: JsonRecord): JsonRecord[] {
  return value.attributes as JsonRecord[];
}

function bindFixture(value: JsonRecord, agentId: string, agentVersionId: string) {
  const resource = resourceSpans(value)[0]!.resource as JsonRecord;
  for (const attribute of attributes(resource)) {
    const anyValue = attribute.value as JsonRecord;
    if (attribute.key === "rateloop.agent.id") anyValue.stringValue = agentId;
    if (attribute.key === "rateloop.agent.version.id") anyValue.stringValue = agentVersionId;
  }
}

function setTraceId(value: JsonRecord, traceId: string) {
  for (const resource of resourceSpans(value)) {
    for (const scope of scopeSpans(resource)) {
      for (const span of spans(scope)) span.traceId = traceId;
    }
  }
}

function addPrimaryAttribute(value: JsonRecord, key: string, anyValue: JsonRecord) {
  const primary = spans(scopeSpans(resourceSpans(value)[0]!)[0]!)[0]!;
  attributes(primary).push({ key, value: anyValue });
}

function addEligibleReviewAttributes(value: JsonRecord) {
  addPrimaryAttribute(value, "rateloop.review.eligible", { boolValue: true });
  addPrimaryAttribute(value, "rateloop.review.policy.id", { stringValue: "arp_otlp" });
  addPrimaryAttribute(value, "rateloop.review.policy.version", { intValue: "2" });
  addPrimaryAttribute(value, "rateloop.review.workflow.key", { stringValue: "support_reply" });
  addPrimaryAttribute(value, "rateloop.review.risk.tier", { stringValue: "medium" });
  addPrimaryAttribute(value, "rateloop.review.audience_policy_hash", {
    stringValue: `sha256:${"22".repeat(32)}`,
  });
  addPrimaryAttribute(value, "rateloop.review.suggestion_commitment", {
    stringValue: `sha256:${"33".repeat(32)}`,
  });
  addPrimaryAttribute(value, "rateloop.review.declared_confidence_bps", { intValue: "7300" });
  addPrimaryAttribute(value, "rateloop.review.critical_risk", { boolValue: false });
  addPrimaryAttribute(value, "rateloop.review.metadata_complete", { boolValue: true });
}

async function setup() {
  const { workspaceId } = await createWorkspace({ name: "OTLP workspace", ownerAddress: OWNER });
  const agent = await createWorkspaceAgent({
    accountAddress: OWNER,
    workspaceId,
    externalId: "otlp-agent",
    version: {
      displayName: "OTLP Agent",
      provider: "OpenAI",
      model: "gpt-fixture",
      environment: "production",
    },
  });
  const key = await createWorkspaceApiKey({ workspaceId, name: "Telemetry", scopes: ["telemetry:write"] });
  const reviewKey = await createWorkspaceApiKey({
    workspaceId,
    name: "Telemetry review decisions",
    scopes: ["telemetry:write", "review:decide"],
  });
  const narrow = await createWorkspaceApiKey({ workspaceId, name: "Read only", scopes: ["evaluation:read"] });
  const body = fixture();
  bindFixture(body, agent.agentId, agent.currentVersion.versionId);
  return { workspaceId, agent, token: key.token, reviewToken: reviewKey.token, narrowToken: narrow.token, body };
}

function request(body: BodyInit, token?: string, headers?: Record<string, string>) {
  return new NextRequest("https://rateloop-tokenless.vercel.app/api/agent/v1/telemetry/v1/traces", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });
}

function varint(value: bigint): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining > 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0n);
  return Buffer.from(bytes);
}

function field(fieldNumber: number, wire: number, value: Buffer) {
  return Buffer.concat([varint(BigInt((fieldNumber << 3) | wire)), value]);
}

function message(fieldNumber: number, value: Buffer) {
  return field(fieldNumber, 2, Buffer.concat([varint(BigInt(value.length)), value]));
}

function stringField(fieldNumber: number, value: string) {
  return message(fieldNumber, Buffer.from(value, "utf8"));
}

function fixed64Field(fieldNumber: number, value: string) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return field(fieldNumber, 1, buffer);
}

function protobufAnyValue(value: JsonRecord): Buffer {
  if (typeof value.stringValue === "string") return stringField(1, value.stringValue);
  if (typeof value.boolValue === "boolean") return field(2, 0, varint(value.boolValue ? 1n : 0n));
  if (typeof value.intValue === "string") return field(3, 0, varint(BigInt(value.intValue)));
  if (typeof value.doubleValue === "number") {
    const buffer = Buffer.alloc(8);
    buffer.writeDoubleLE(value.doubleValue);
    return field(4, 1, buffer);
  }
  // Nested content is represented as an empty array. The production decoder
  // intentionally skips this value and never persists its contents.
  return message(5, Buffer.alloc(0));
}

function protobufAttribute(attribute: JsonRecord) {
  return Buffer.concat([
    stringField(1, String(attribute.key)),
    message(2, protobufAnyValue(attribute.value as JsonRecord)),
  ]);
}

function protobufSpan(span: JsonRecord) {
  const status = span.status as JsonRecord;
  return Buffer.concat([
    message(1, Buffer.from(String(span.traceId), "hex")),
    message(2, Buffer.from(String(span.spanId), "hex")),
    ...(span.parentSpanId ? [message(4, Buffer.from(String(span.parentSpanId), "hex"))] : []),
    stringField(5, String(span.name)),
    field(6, 0, varint(BigInt(Number(span.kind)))),
    fixed64Field(7, String(span.startTimeUnixNano)),
    fixed64Field(8, String(span.endTimeUnixNano)),
    ...attributes(span).map(attribute => message(9, protobufAttribute(attribute))),
    ...(Array.isArray(span.events) ? span.events.map(() => message(11, Buffer.alloc(0))) : []),
    ...(Array.isArray(span.links) ? span.links.map(() => message(13, Buffer.alloc(0))) : []),
    message(15, field(3, 0, varint(BigInt(Number(status.code))))),
  ]);
}

function protobufRequest(value: JsonRecord) {
  return Buffer.concat(
    resourceSpans(value).map(resourceSpan => {
      const resource = resourceSpan.resource as JsonRecord;
      const resourceMessage = Buffer.concat(
        attributes(resource).map(attribute => message(1, protobufAttribute(attribute))),
      );
      const scopeMessages = scopeSpans(resourceSpan).map(scope =>
        message(2, Buffer.concat(spans(scope).map(span => message(2, protobufSpan(span))))),
      );
      return message(1, Buffer.concat([message(1, resourceMessage), ...scopeMessages]));
    }),
  );
}

test("pins the OTLP and development GenAI mapping inputs", () => {
  assert.equal(OTLP_HTTP_PROTOCOL_PIN, "opentelemetry-otlp/1.10.0");
  assert.equal(OTLP_CORE_SEMCONV_PIN, "open-telemetry/semantic-conventions@v1.43.0");
  assert.equal(
    OTLP_GENAI_SEMCONV_PIN,
    "open-telemetry/semantic-conventions-genai@0183a25b3d6970d993fd3e77b0471b8d518efe83",
  );
  assert.deepEqual(OTLP_PROVENANCE_SOURCE, {
    kind: "host_reported",
    independentlyVerified: false,
    attestation: null,
  });
  assert.equal(OTLP_REVIEW_MAPPING_PIN, "rateloop.otlp-review-attributes.v1");
});

test("eligible OTLP outputs use exact commitment-only attributes to evaluate the human-review policy", async () => {
  const setupData = await setup();
  addEligibleReviewAttributes(setupData.body);
  const principal = await authenticateOtlpTracePrincipal(`Bearer ${setupData.reviewToken}`);
  let captured: JsonRecord | null = null;
  const evaluateReview = (async (input: { request: JsonRecord }) => {
    captured = input.request;
    return {} as never;
  }) as NonNullable<Parameters<typeof ingestOtlpTraces>[0]["evaluateReview"]>;
  const result = await ingestOtlpTraces({
    principal,
    request: parseOtlpTraceJson(setupData.body),
    evaluateReview,
  });
  assert.equal(result.acceptedExecutions, 1);
  const reviewRequest = (captured ?? {}) as JsonRecord;
  assert.equal(reviewRequest.policyId, "arp_otlp");
  assert.equal(reviewRequest.policyVersion, 2);
  assert.equal(reviewRequest.workflowKey, "support_reply");
  assert.equal(reviewRequest.suggestionCommitment, `sha256:${"33".repeat(32)}`);
  assert.match(String((reviewRequest.sourceEvidence as JsonRecord | undefined)?.hash), /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    (reviewRequest.execution as JsonRecord | undefined)?.externalExecutionId,
    "otlp:5b8efff798038103d269b633813fc60c",
  );
  assert.doesNotMatch(JSON.stringify(reviewRequest), /never-persist-this-prompt|never-persist-this-tool-input/u);
});

test("eligible OTLP outputs fail closed without review authority or a complete mapping", async () => {
  const setupData = await setup();
  addEligibleReviewAttributes(setupData.body);
  const telemetryOnly = await authenticateOtlpTracePrincipal(`Bearer ${setupData.token}`);
  const unauthorized = await ingestOtlpTraces({
    principal: telemetryOnly,
    request: parseOtlpTraceJson(setupData.body),
    evaluateReview: (async () => ({}) as never) as NonNullable<
      Parameters<typeof ingestOtlpTraces>[0]["evaluateReview"]
    >,
  });
  assert.equal(unauthorized.acceptedExecutions, 0);
  assert.equal(unauthorized.rejectedSpans, 2);
  assert.match(unauthorized.errorMessage, /insufficient_scope/u);

  const incomplete = fixture();
  bindFixture(incomplete, setupData.agent.agentId, setupData.agent.currentVersion.versionId);
  addPrimaryAttribute(incomplete, "rateloop.review.policy.id", { stringValue: "arp_otlp" });
  const principal = await authenticateOtlpTracePrincipal(`Bearer ${setupData.reviewToken}`);
  const rejected = await ingestOtlpTraces({ principal, request: parseOtlpTraceJson(incomplete) });
  assert.equal(rejected.acceptedExecutions, 0);
  assert.equal(rejected.rejectedSpans, 2);
  assert.match(rejected.errorMessage, /invalid_otlp_review_mapping/u);
});

test("ingests collector JSON as host-reported execution provenance and deduplicates exact replay", async () => {
  const setupData = await setup();
  const first = await POST(request(JSON.stringify(setupData.body), setupData.token));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {});
  assert.equal(first.headers.get("cache-control"), "private, no-store, max-age=0");

  const replay = await POST(request(JSON.stringify(setupData.body), setupData.token));
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), {});

  const conflicting = structuredClone(setupData.body);
  const primary = spans(scopeSpans(resourceSpans(conflicting)[0]!)[0]!)[0]!;
  const requestedModel = attributes(primary).find(attribute => attribute.key === "gen_ai.request.model")!;
  (requestedModel.value as JsonRecord).stringValue = "different-model";
  const conflict = await POST(request(JSON.stringify(conflicting), setupData.token));
  assert.equal(conflict.status, 200);
  assert.deepEqual(await conflict.json(), {
    partialSuccess: {
      rejectedSpans: "2",
      errorMessage:
        "Some spans were rejected (otlp_execution_conflict). RateLoop stores only host-reported provenance.",
    },
  });

  const executions = await dbClient.execute(
    `SELECT external_execution_id,metadata_source,tool_call_count,tool_duration_ms,model_call_count,
            input_token_total,output_token_total,manifest_commitment,execution_profile_json
     FROM tokenless_agent_executions`,
  );
  assert.equal(executions.rowCount, 1);
  assert.deepEqual(
    {
      externalExecutionId: executions.rows[0]?.external_execution_id,
      metadataSource: executions.rows[0]?.metadata_source,
      toolCallCount: Number(executions.rows[0]?.tool_call_count),
      toolDurationMs: Number(executions.rows[0]?.tool_duration_ms),
      modelCallCount: Number(executions.rows[0]?.model_call_count),
      inputTokens: Number(executions.rows[0]?.input_token_total),
      outputTokens: Number(executions.rows[0]?.output_token_total),
    },
    {
      externalExecutionId: "otlp:5b8efff798038103d269b633813fc60c",
      metadataSource: "host_reported",
      toolCallCount: 1,
      toolDurationMs: 250,
      modelCallCount: 1,
      inputTokens: 120,
      outputTokens: 40,
    },
  );
  assert.match(String(executions.rows[0]?.manifest_commitment), /^sha256:[0-9a-f]{64}$/u);

  const generations = await dbClient.execute(
    `SELECT metadata_source,response_id_hash,provider,requested_model,resolved_model
     FROM tokenless_agent_generation_spans`,
  );
  assert.equal(generations.rowCount, 1);
  assert.equal(generations.rows[0]?.metadata_source, "host_reported");
  assert.equal(generations.rows[0]?.provider, "openai");
  assert.match(String(generations.rows[0]?.response_id_hash), /^sha256:[0-9a-f]{64}$/u);
  const stored = JSON.stringify({ executions: executions.rows, generations: generations.rows });
  assert.doesNotMatch(stored, /provider-response-secret-id|never-persist-this-prompt|never-persist-this-tool-input/u);
  assert.doesNotMatch(stored, /independentlyVerified["']?\s*:\s*true/u);
});

test("accepts gzip-compressed OTLP protobuf from a collector-compatible envelope", async () => {
  const setupData = await setup();
  setTraceId(setupData.body, "5b8efff798038103d269b633813fc60d");
  const encoded = gzipSync(protobufRequest(setupData.body));
  const response = await POST(
    request(encoded, setupData.token, {
      "content-type": "application/x-protobuf",
      "content-encoding": "gzip",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-protobuf");
  assert.equal((await response.arrayBuffer()).byteLength, 0);
  const executions = await dbClient.execute("SELECT metadata_source FROM tokenless_agent_executions");
  assert.equal(executions.rowCount, 1);
  assert.equal(executions.rows[0]?.metadata_source, "host_reported");
});

test("returns OTLP partial_success while accepting valid traces in the same batch", async () => {
  const setupData = await setup();
  const rejected = structuredClone(setupData.body);
  setTraceId(rejected, "5b8efff798038103d269b633813fc60e");
  bindFixture(rejected, "agt_not_in_this_workspace", setupData.agent.currentVersion.versionId);
  setupData.body.resourceSpans = [...resourceSpans(setupData.body), ...resourceSpans(rejected)];

  const response = await POST(request(JSON.stringify(setupData.body), setupData.token));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    partialSuccess: {
      rejectedSpans: "2",
      errorMessage: "Some spans were rejected (invalid_otlp_binding). RateLoop stores only host-reported provenance.",
    },
  });
  const executions = await dbClient.execute("SELECT execution_id FROM tokenless_agent_executions");
  assert.equal(executions.rowCount, 1);
});

test("requires a workspace telemetry scope and enforces batch cardinality", async () => {
  const setupData = await setup();
  const missing = await POST(request(JSON.stringify(setupData.body)));
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).code, "workspace_api_key_required");

  const narrow = await POST(request(JSON.stringify(setupData.body), setupData.narrowToken));
  assert.equal(narrow.status, 403);
  assert.equal((await narrow.json()).code, "insufficient_scope");

  const excessive = { resourceSpans: Array.from({ length: 33 }, () => ({ scopeSpans: [] })) };
  const limited = await POST(request(JSON.stringify(excessive), setupData.token));
  assert.equal(limited.status, 413);
  assert.equal((await limited.json()).code, "otlp_limit_exceeded");

  const protobufLimited = structuredClone(setupData.body);
  spans(scopeSpans(resourceSpans(protobufLimited)[0]!)[0]!)[0]!.events = Array.from({ length: 65 }, () => ({}));
  const protobufResponse = await POST(
    request(protobufRequest(protobufLimited), setupData.token, { "content-type": "application/x-protobuf" }),
  );
  assert.equal(protobufResponse.status, 413);
  assert.equal((await protobufResponse.json()).code, "otlp_limit_exceeded");
});
