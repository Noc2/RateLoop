import assert from "node:assert/strict";
import test from "node:test";
import {
  type AgentExecutionProvenanceInput,
  LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION,
  agentExecutionProfileHash,
  normalizeAgentExecutionProvenance,
  projectAgentExecutionProfile,
} from "~~/lib/tokenless/agentExecutionProvenance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const RESPONSE_HASH = `sha256:${"a".repeat(64)}`;

function solExecution(): AgentExecutionProvenanceInput {
  return {
    externalExecutionId: "codex-task-1",
    status: "completed",
    startedAt: "2026-07-16T06:00:00.000Z",
    completedAt: "2026-07-16T06:00:05.000Z",
    toolCallCount: 2,
    toolDurationMs: 1_000,
    primarySpanId: "span-sol",
    generationSpans: [
      {
        spanId: "span-sol",
        role: "primary",
        provider: "openai",
        requestedModel: "Sol",
        resolvedModel: "gpt-5-codex",
        modelVersion: "2026-07-01",
        reasoningEffort: "medium",
        serviceTier: "standard",
        startedAt: "2026-07-16T06:00:00.500Z",
        completedAt: "2026-07-16T06:00:04.500Z",
        timeToFirstOutputMs: 700,
        inputTokens: 1_000,
        cachedInputTokens: 400,
        outputTokens: 300,
        reasoningOutputTokens: 100,
        responseIdHash: RESPONSE_HASH,
        finishReason: "stop",
      },
    ],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertInvalid(input: unknown, pattern?: RegExp) {
  assert.throws(
    () => normalizeAgentExecutionProvenance(input),
    error => {
      assert.ok(error instanceof TokenlessServiceError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_execution_provenance");
      if (pattern) assert.match(error.message, pattern);
      return true;
    },
  );
}

test("normalizes a single Sol execution with a medium-effort model profile", () => {
  const normalized = normalizeAgentExecutionProvenance(solExecution());

  assert.equal(normalized.schemaVersion, "rateloop.execution-manifest.v1");
  assert.equal(normalized.durationMs, 5_000);
  assert.deepEqual(normalized.totals, {
    generationSpanCount: 1,
    generationDurationMs: 4_000,
    toolCallCount: 2,
    toolDurationMs: 1_000,
    inputTokens: 1_000,
    cachedInputTokens: 400,
    outputTokens: 300,
    reasoningOutputTokens: 100,
    totalTokens: 1_300,
  });
  assert.deepEqual(normalized.executionProfile, {
    schemaVersion: "rateloop.execution-profile.v2",
    orchestrationMode: "single_model",
    primary: {
      provider: "openai",
      requestedModel: "Sol",
      resolvedModel: "gpt-5-codex",
      modelVersion: "2026-07-01",
      reasoningEffort: "medium",
      serviceTier: "standard",
    },
    contributors: [
      {
        provider: "openai",
        requestedModel: "Sol",
        resolvedModel: "gpt-5-codex",
        modelVersion: "2026-07-01",
        reasoningEffort: "medium",
        serviceTier: "standard",
      },
    ],
  });
  assert.match(normalized.manifestCommitment, /^sha256:[0-9a-f]{64}$/u);
  assert.match(normalized.executionProfileHash, /^sha256:[0-9a-f]{64}$/u);
});

test("normalizes Sol plus Terra as a sorted multi-model profile whose contributors include the primary", () => {
  const input = solExecution();
  input.generationSpans.push({
    spanId: "span-terra",
    parentSpanId: "span-sol",
    role: "subagent",
    provider: "openai",
    requestedModel: "Terra",
    resolvedModel: "gpt-5-mini",
    modelVersion: "2026-07-02",
    reasoningEffort: "low",
    serviceTier: "fast",
    startedAt: "2026-07-16T06:00:01.000Z",
    completedAt: "2026-07-16T06:00:02.000Z",
    inputTokens: 200,
    cachedInputTokens: 0,
    outputTokens: 50,
    reasoningOutputTokens: 10,
  });

  const normalized = normalizeAgentExecutionProvenance(input);
  assert.equal(normalized.executionProfile.orchestrationMode, "multi_model");
  assert.deepEqual(
    normalized.executionProfile.contributors.map(profile => profile.requestedModel),
    ["Sol", "Terra"],
  );
  assert.equal(normalized.totals.inputTokens, 1_200);
  assert.equal(normalized.totals.totalTokens, 1_550);

  const reversed = clone(input);
  reversed.generationSpans.reverse();
  assert.equal(normalizeAgentExecutionProvenance(reversed).manifestCommitment, normalized.manifestCommitment);
});

test("profile cohorts stay stable while measurements change and manifests do not", () => {
  const original = normalizeAgentExecutionProvenance(solExecution());
  const changedInput = solExecution();
  changedInput.completedAt = "2026-07-16T06:00:09.000Z";
  changedInput.toolDurationMs = 2_000;
  changedInput.generationSpans[0]!.completedAt = "2026-07-16T06:00:08.000Z";
  changedInput.generationSpans[0]!.timeToFirstOutputMs = 1_200;
  changedInput.generationSpans[0]!.inputTokens = 2_000;
  changedInput.generationSpans[0]!.cachedInputTokens = 800;
  changedInput.generationSpans[0]!.outputTokens = 600;
  changedInput.generationSpans[0]!.reasoningOutputTokens = 200;
  const changed = normalizeAgentExecutionProvenance(changedInput);

  assert.deepEqual(changed.executionProfile, original.executionProfile);
  assert.equal(changed.executionProfileHash, original.executionProfileHash);
  assert.notEqual(changed.manifestCommitment, original.manifestCommitment);
});

test("profile v2 keeps effort and service observations in evidence without partitioning on them", () => {
  const original = normalizeAgentExecutionProvenance(solExecution());
  const changedInput = solExecution();
  changedInput.generationSpans[0]!.reasoningEffort = "high";
  changedInput.generationSpans[0]!.serviceTier = "priority";
  const changed = normalizeAgentExecutionProvenance(changedInput);

  assert.equal(original.executionProfile.schemaVersion, "rateloop.execution-profile.v2");
  assert.equal(changed.executionProfile.primary.reasoningEffort, "high");
  assert.equal(changed.executionProfile.primary.serviceTier, "priority");
  assert.equal(changed.executionProfileHash, original.executionProfileHash);
  assert.notEqual(changed.manifestCommitment, original.manifestCommitment);
});

test("profile v2 still partitions provider, requested model, resolved model, and model version", () => {
  const original = normalizeAgentExecutionProvenance(solExecution());
  for (const change of [
    { provider: "anthropic" },
    { requestedModel: "Terra" },
    { resolvedModel: "gpt-5-codex-next" },
    { modelVersion: "2026-07-02" },
  ]) {
    const changedInput = solExecution();
    Object.assign(changedInput.generationSpans[0]!, change);
    const changed = normalizeAgentExecutionProvenance(changedInput);
    assert.notEqual(changed.executionProfileHash, original.executionProfileHash, JSON.stringify(change));
  }
});

test("legacy profile v1 commitments remain reproducible without rewriting historical rows", () => {
  const normalized = normalizeAgentExecutionProvenance(solExecution());
  const legacy = projectAgentExecutionProfile(normalized, LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION);
  assert.equal(legacy.schemaVersion, "rateloop.execution-profile.v1");
  assert.match(agentExecutionProfileHash(legacy), /^sha256:[0-9a-f]{64}$/u);

  const changedInput = solExecution();
  changedInput.generationSpans[0]!.reasoningEffort = "high";
  const changedLegacy = projectAgentExecutionProfile(
    normalizeAgentExecutionProvenance(changedInput),
    LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION,
  );
  assert.notEqual(agentExecutionProfileHash(changedLegacy), agentExecutionProfileHash(legacy));
});

test("does not invent clocks or usage when callers cannot observe them", () => {
  const input = solExecution();
  delete input.startedAt;
  delete input.completedAt;
  delete input.toolCallCount;
  delete input.toolDurationMs;
  const span = input.generationSpans[0]!;
  delete span.startedAt;
  delete span.completedAt;
  delete span.timeToFirstOutputMs;
  delete span.inputTokens;
  delete span.cachedInputTokens;
  delete span.outputTokens;
  delete span.reasoningOutputTokens;

  const normalized = normalizeAgentExecutionProvenance(input);
  assert.equal(normalized.startedAt, null);
  assert.equal(normalized.durationMs, null);
  assert.equal(normalized.generationSpans[0]!.durationMs, null);
  assert.equal(normalized.totals.totalTokens, null);
});

test("rejects missing, mismatched, duplicate, and empty primary spans", () => {
  const mismatched = solExecution();
  mismatched.primarySpanId = "some-other-span";
  assertInvalid(mismatched, /one primary/u);

  const duplicatePrimary = solExecution();
  duplicatePrimary.generationSpans.push({
    spanId: "second-primary",
    role: "primary",
    provider: "openai",
    requestedModel: "Terra",
  });
  assertInvalid(duplicatePrimary, /one primary/u);

  const empty = solExecution();
  empty.generationSpans = [];
  assertInvalid(empty, /1-64/u);
});

test("rejects missing parents and cycles", () => {
  const missingParent = solExecution();
  missingParent.generationSpans.push({
    spanId: "orphan",
    parentSpanId: "missing",
    role: "supporting",
    provider: "openai",
    requestedModel: "Terra",
  });
  assertInvalid(missingParent, /does not exist/u);

  const cycle = solExecution();
  cycle.generationSpans.push(
    {
      spanId: "cycle-a",
      parentSpanId: "cycle-b",
      role: "supporting",
      provider: "openai",
      requestedModel: "Terra",
    },
    {
      spanId: "cycle-b",
      parentSpanId: "cycle-a",
      role: "subagent",
      provider: "openai",
      requestedModel: "Terra",
    },
  );
  assertInvalid(cycle, /cycles/u);
});

test("rejects invalid, incomplete, reversed, and out-of-execution timestamps", () => {
  const incomplete = solExecution();
  delete incomplete.completedAt;
  assertInvalid(incomplete, /supplied together/u);

  const reversed = solExecution();
  reversed.generationSpans[0]!.completedAt = "2026-07-16T05:59:59.000Z";
  assertInvalid(reversed, /not be earlier/u);

  const outside = solExecution();
  outside.generationSpans[0]!.completedAt = "2026-07-16T06:00:06.000Z";
  assertInvalid(outside, /within the execution/u);

  const invalid = solExecution();
  invalid.startedAt = "not-a-date";
  assertInvalid(invalid, /ISO-8601/u);
});

test("rejects invalid counts, durations, token relationships, and response commitments", () => {
  const negative = solExecution();
  negative.toolCallCount = -1;
  assertInvalid(negative, /non-negative/u);

  const longFirstOutput = solExecution();
  longFirstOutput.generationSpans[0]!.timeToFirstOutputMs = 4_001;
  assertInvalid(longFirstOutput, /span duration/u);

  const impossibleCache = solExecution();
  impossibleCache.generationSpans[0]!.cachedInputTokens = 1_001;
  assertInvalid(impossibleCache, /cannot exceed inputTokens/u);

  const impossibleReasoning = solExecution();
  impossibleReasoning.generationSpans[0]!.reasoningOutputTokens = 301;
  assertInvalid(impossibleReasoning, /cannot exceed outputTokens/u);

  const tooLarge = solExecution();
  tooLarge.toolCallCount = 2_147_483_648;
  assertInvalid(tooLarge, /2147483647/u);

  const tooLongToolDuration = solExecution();
  tooLongToolDuration.toolDurationMs = 2_147_483_648;
  assertInvalid(tooLongToolDuration, /2147483647/u);

  const overflowingTotal = solExecution();
  overflowingTotal.generationSpans[0]!.inputTokens = 2_147_483_647;
  overflowingTotal.generationSpans[0]!.cachedInputTokens = 0;
  overflowingTotal.generationSpans[0]!.outputTokens = 1;
  overflowingTotal.generationSpans[0]!.reasoningOutputTokens = 0;
  assertInvalid(overflowingTotal, /totals cannot exceed/u);

  const badResponseHash = solExecution();
  badResponseHash.generationSpans[0]!.responseIdHash = `sha256:${"A".repeat(64)}`;
  assertInvalid(badResponseHash, /lowercase sha256/u);
});

test("rejects raw content, reasoning, and caller-asserted metadata provenance fields", () => {
  for (const forbidden of ["prompt", "output", "reasoning", "metadataSource"]) {
    const input = solExecution() as unknown as Record<string, unknown>;
    input[forbidden] = "must not be retained";
    assertInvalid(input, /unsupported fields/u);
  }
  for (const forbidden of ["prompt", "output", "reasoning", "metadataSource"]) {
    const input = solExecution();
    (input.generationSpans[0] as unknown as Record<string, unknown>)[forbidden] = "must not be retained";
    assertInvalid(input, /unsupported fields/u);
  }
});
