import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseAgentExecutionEvidence, projectAgentExecutionEvidence } from "~~/lib/tokenless/agentExecutionEvidence";
import {
  type AgentExecutionProvenanceInput,
  LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION,
  agentExecutionProfileHash,
  normalizeAgentExecutionProvenance,
  projectAgentExecutionProfile,
} from "~~/lib/tokenless/agentExecutionProvenance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const HASH = `sha256:${"a".repeat(64)}`;

function execution(): AgentExecutionProvenanceInput {
  return {
    externalExecutionId: "codex-task-0001",
    status: "completed",
    startedAt: "2026-07-16T10:00:00.000Z",
    completedAt: "2026-07-16T10:00:05.000Z",
    toolCallCount: 2,
    toolDurationMs: 900,
    primarySpanId: "primary",
    generationSpans: [
      {
        spanId: "supporting",
        parentSpanId: "primary",
        role: "supporting",
        provider: "openai",
        requestedModel: "terra",
        resolvedModel: "gpt-5-terra-2026-07-01",
        startedAt: "2026-07-16T10:00:01.000Z",
        completedAt: "2026-07-16T10:00:03.000Z",
        inputTokens: 120,
        cachedInputTokens: 20,
        outputTokens: 40,
        reasoningOutputTokens: 10,
      },
      {
        spanId: "primary",
        role: "primary",
        provider: "openai",
        requestedModel: "sol",
        resolvedModel: "gpt-5-sol-2026-07-01",
        modelVersion: "2026-07-01",
        reasoningEffort: "medium",
        serviceTier: "standard",
        startedAt: "2026-07-16T10:00:00.500Z",
        completedAt: "2026-07-16T10:00:04.500Z",
        timeToFirstOutputMs: 600,
        inputTokens: 800,
        cachedInputTokens: 300,
        outputTokens: 200,
        reasoningOutputTokens: 80,
        responseIdHash: HASH,
        finishReason: "stop",
      },
    ],
  };
}

function evidence() {
  return projectAgentExecutionEvidence({
    executionId: "aex_0123456789abcdef0123456789abcdef01234567",
    opportunityId: "aop_0123456789abcdef0123456789abcdef01234567",
    metadataCommitment: `sha256:${"e".repeat(64)}`,
    execution: normalizeAgentExecutionProvenance(execution()),
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function commitment(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function assertInvalid(value: unknown, pattern?: RegExp) {
  assert.throws(
    () => parseAgentExecutionEvidence(value),
    error => {
      assert.ok(error instanceof TokenlessServiceError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "invalid_execution_evidence");
      if (pattern) assert.match(error.message, pattern);
      return true;
    },
  );
}

test("projects an exact hash-bound host-reported execution evidence envelope", () => {
  const value = evidence();

  assert.equal(value.schemaVersion, "rateloop.execution-evidence.v1");
  assert.deepEqual(value.source, {
    kind: "host_reported",
    independentlyVerified: false,
    attestation: null,
  });
  assert.deepEqual(value.opportunityBinding, {
    opportunityId: "aop_0123456789abcdef0123456789abcdef01234567",
    metadataCommitment: `sha256:${"e".repeat(64)}`,
  });
  assert.equal(value.manifest.durationMs, 5_000);
  assert.equal(value.manifest.totals.totalTokens, 1_160);
  assert.deepEqual(
    value.manifest.generationSpans.map(span => span.spanId),
    ["primary", "supporting"],
  );
  assert.equal(value.manifest.generationSpans[0]?.reasoningEffort, "medium");
  assert.equal(value.manifest.generationSpans[0]?.serviceTier, "standard");
  assert.equal(value.executionProfile.schemaVersion, "rateloop.execution-profile.v2");
  assert.equal(value.executionProfile.orchestrationMode, "multi_model");
  assert.match(value.manifestCommitment, /^sha256:[0-9a-f]{64}$/u);
  assert.match(value.executionProfileHash, /^sha256:[0-9a-f]{64}$/u);
  assert.match(value.evidenceCommitment, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(parseAgentExecutionEvidence(value), value);
});

test("effort and service tier stay evidence-bound without changing the v2 evaluation profile hash", () => {
  const original = evidence();
  const changedInput = execution();
  changedInput.generationSpans.find(span => span.spanId === "primary")!.reasoningEffort = "high";
  changedInput.generationSpans.find(span => span.spanId === "primary")!.serviceTier = "priority";
  const changed = projectAgentExecutionEvidence({
    executionId: original.executionId,
    ...original.opportunityBinding,
    execution: normalizeAgentExecutionProvenance(changedInput),
  });

  assert.equal(changed.executionProfileHash, original.executionProfileHash);
  assert.notEqual(changed.manifestCommitment, original.manifestCommitment);
  assert.notEqual(changed.evidenceCommitment, original.evidenceCommitment);
  assert.equal(changed.manifest.generationSpans[0]?.reasoningEffort, "high");
  assert.equal(changed.manifest.generationSpans[0]?.serviceTier, "priority");
  assert.deepEqual(parseAgentExecutionEvidence(changed), changed);
});

test("parses canonical historical v1 evidence without rewriting its profile semantics", () => {
  const current = evidence();
  const executionValue = normalizeAgentExecutionProvenance(execution());
  const legacyProfile = projectAgentExecutionProfile(executionValue, LEGACY_AGENT_EXECUTION_PROFILE_SCHEMA_VERSION);
  const { evidenceCommitment: _currentCommitment, ...currentBody } = current;
  void _currentCommitment;
  const legacyBody = {
    ...currentBody,
    executionProfile: legacyProfile,
    executionProfileHash: agentExecutionProfileHash(legacyProfile),
  };
  const legacy = { ...legacyBody, evidenceCommitment: commitment(legacyBody) };

  assert.equal(legacy.executionProfile.schemaVersion, "rateloop.execution-profile.v1");
  assert.deepEqual(parseAgentExecutionEvidence(legacy), legacy);
});

test("keeps evidence stable when callers report equivalent spans in a different order", () => {
  const reordered = execution();
  reordered.generationSpans.reverse();
  const projected = projectAgentExecutionEvidence({
    executionId: evidence().executionId,
    ...evidence().opportunityBinding,
    execution: normalizeAgentExecutionProvenance(reordered),
  });

  assert.deepEqual(projected, evidence());
});

test("recomputes manifest, profile, and whole-envelope commitments", () => {
  for (const mutate of [
    (value: ReturnType<typeof evidence>) => {
      value.opportunityBinding.opportunityId = "aop_substituted";
    },
    (value: ReturnType<typeof evidence>) => {
      value.manifest.toolCallCount = 3;
    },
    (value: ReturnType<typeof evidence>) => {
      value.manifestCommitment = `sha256:${"b".repeat(64)}`;
    },
    (value: ReturnType<typeof evidence>) => {
      value.executionProfile.primary.resolvedModel = "substituted-model";
    },
    (value: ReturnType<typeof evidence>) => {
      value.executionProfileHash = `sha256:${"c".repeat(64)}`;
    },
    (value: ReturnType<typeof evidence>) => {
      value.evidenceCommitment = `sha256:${"d".repeat(64)}`;
    },
  ]) {
    const value = structuredClone(evidence());
    mutate(value);
    assertInvalid(value, /canonical|commitment/u);
  }
});

test("rejects any content-bearing or caller-asserted attestation fields", () => {
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    value => {
      value.prompt = "private prompt";
    },
    value => {
      (value.manifest as Record<string, unknown>).output = "private output";
    },
    value => {
      const manifest = value.manifest as { generationSpans: Array<Record<string, unknown>> };
      manifest.generationSpans[0]!.toolPayload = { secret: true };
    },
    value => {
      (value.executionProfile as Record<string, unknown>).hiddenReasoning = "private reasoning";
    },
    value => {
      const source = value.source as Record<string, unknown>;
      source.independentlyVerified = true;
      source.attestation = { issuer: "caller" };
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(evidence()) as unknown as Record<string, unknown>;
    mutate(value);
    assertInvalid(value);
  }
});

test("the canonical projection contains metadata and counts but no raw content fields", () => {
  const keys = new Set<string>();
  function visit(value: unknown) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      keys.add(key);
      visit(child);
    }
  }
  visit(evidence());

  for (const forbidden of [
    "prompt",
    "messages",
    "input",
    "output",
    "reasoning",
    "hiddenReasoning",
    "toolPayload",
    "toolInput",
    "toolOutput",
  ]) {
    assert.equal(keys.has(forbidden), false, `unexpected content field ${forbidden}`);
  }
});
