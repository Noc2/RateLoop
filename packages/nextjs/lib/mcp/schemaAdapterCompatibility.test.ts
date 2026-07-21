import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type SchemaAdapterResult,
  emulateGeminiCliToolSchema,
  emulateOpenAiStrictToolSchema,
} from "~~/lib/mcp/schemaAdapterCompatibility";
import { oauthWorkspaceMcpTools, pairingMcpTools, workspaceMcpTools } from "~~/lib/mcp/workspaceProtocol";

/**
 * Schema-adapter compatibility gate (agent-install plan Phase 5, item 3).
 *
 * Every deployed workspace/pairing MCP tool schema is run through conservative
 * emulations of the OpenAI strict function-schema conversion and the Gemini CLI
 * schema sanitizer (see lib/mcp/schemaAdapterCompatibility.ts — documented-behavior
 * emulations, not vendor SDKs). The KNOWN_ADAPTER_BASELINE map pins today's exact
 * per-tool losses as a known-issues baseline:
 *
 * - any NEW dropped constraint or semantic change fails the gate (regression);
 * - any DISAPPEARED entry also fails (an improvement must update the baseline, so
 *   the documented gaps never silently drift from reality — exact match, not subset).
 *
 * Independent of the emulator's own accounting, a structural fingerprint check
 * asserts that no tool loses a required field, a union arm, or an enum constraint
 * except where the baseline explicitly records that loss (today: the
 * rateloop_request_review material oneOf under Gemini sanitization, and conditional
 * requireds under both adapters).
 */

type ToolDefinition = { name: string; inputSchema: unknown };
type AdapterBaseline = { droppedConstraints: readonly string[]; semanticChanges: readonly string[] };
type ToolBaseline = { openai: AdapterBaseline; gemini: AdapterBaseline };

const deployedTools = new Map<string, ToolDefinition>();
for (const tool of [...pairingMcpTools, ...workspaceMcpTools, ...oauthWorkspaceMcpTools]) {
  deployedTools.set(tool.name, tool as ToolDefinition);
}

const KNOWN_ADAPTER_BASELINE: Record<string, ToolBaseline> = {
  rateloop_register_agent: {
    openai: {
      droppedConstraints: [
        "$.description: maxLength 1000 dropped (outside the strict-mode keyword floor)",
        "$.displayName: maxLength 120 dropped (outside the strict-mode keyword floor)",
        "$.displayName: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.externalId: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.externalId: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.model: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.model: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.modelVersion: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.provider: maxLength 120 dropped (outside the strict-mode keyword floor)",
        "$.provider: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.requestedWorkflowKeys: maxItems 32 dropped (outside the strict-mode keyword floor)",
        "$.requestedWorkflowKeys: minItems 1 dropped (outside the strict-mode keyword floor)",
        "$.requestedWorkflowKeys[]: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.requestedWorkflowKeys[]: minLength 1 dropped (outside the strict-mode keyword floor)",
      ],
      semanticChanges: [
        "$.description: optional property forced required by strict mode",
        "$.modelVersion: optional property forced required by strict mode",
      ],
    },
    gemini: {
      droppedConstraints: [
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: [
        '$.description: type ["string","null"] rewritten to nullable string',
        '$.modelVersion: type ["string","null"] rewritten to nullable string',
      ],
    },
  },
  rateloop_get_registration_status: {
    openai: {
      droppedConstraints: [],
      semanticChanges: [],
    },
    gemini: {
      droppedConstraints: [
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: [],
    },
  },
  rateloop_connect_workspace: {
    openai: {
      droppedConstraints: [
        "$.connectionUrl: maxLength 4096 dropped (outside the strict-mode keyword floor)",
        "$.connectionUrl: minLength 1 dropped (outside the strict-mode keyword floor)",
      ],
      semanticChanges: ["$.reportedLane: optional property forced required by strict mode"],
    },
    gemini: {
      droppedConstraints: [
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: [],
    },
  },
  rateloop_claim_connection_intent: {
    openai: {
      droppedConstraints: [
        "$.connectionUrl: maxLength 4096 dropped (outside the strict-mode keyword floor)",
        "$.connectionUrl: minLength 1 dropped (outside the strict-mode keyword floor)",
      ],
      semanticChanges: ["$.reportedLane: optional property forced required by strict mode"],
    },
    gemini: {
      droppedConstraints: [
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: [],
    },
  },
  rateloop_confirm_workspace_move: {
    openai: {
      droppedConstraints: [
        "$.transferId: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.transferId: minLength 1 dropped (outside the strict-mode keyword floor)",
      ],
      semanticChanges: [],
    },
    gemini: {
      droppedConstraints: [
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: [],
    },
  },
  rateloop_get_agent_context: {
    openai: {
      droppedConstraints: [],
      semanticChanges: [],
    },
    gemini: {
      droppedConstraints: [
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: [],
    },
  },
  rateloop_verify_connection: {
    openai: {
      droppedConstraints: [],
      semanticChanges: [],
    },
    gemini: {
      droppedConstraints: [
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: [],
    },
  },
  rateloop_list_open_reviews: {
    openai: {
      droppedConstraints: [
        "$.cursor: maxLength 1024 dropped (outside the strict-mode keyword floor)",
        "$.cursor: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.limit: maximum 50 dropped (outside the strict-mode keyword floor)",
        "$.limit: minimum 1 dropped (outside the strict-mode keyword floor)",
      ],
      semanticChanges: [
        "$.cursor: optional property forced required by strict mode",
        "$.limit: optional property forced required by strict mode",
      ],
    },
    gemini: {
      droppedConstraints: [
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: ['$.cursor: type ["string","null"] rewritten to nullable string'],
    },
  },
  rateloop_get_assurance_state: {
    openai: {
      droppedConstraints: [
        "$.scopeId: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.scopeId: minLength 1 dropped (outside the strict-mode keyword floor)",
      ],
      semanticChanges: [],
    },
    gemini: {
      droppedConstraints: [
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: [],
    },
  },
  rateloop_evaluate_review_requirement: {
    openai: {
      droppedConstraints: [
        '$.audiencePolicyHash: pattern "^sha256:[0-9a-f]{64}$" dropped (outside the strict-mode keyword floor)',
        "$.declaredConfidenceBps: maximum 10000 dropped (outside the strict-mode keyword floor)",
        "$.declaredConfidenceBps: minimum 0 dropped (outside the strict-mode keyword floor)",
        "$.execution.completedAt: maxLength 40 dropped (outside the strict-mode keyword floor)",
        "$.execution.completedAt: minLength 20 dropped (outside the strict-mode keyword floor)",
        "$.execution.externalExecutionId: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.execution.externalExecutionId: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans: maxItems 64 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans: minItems 1 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].cachedInputTokens: maximum 2147483647 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].cachedInputTokens: minimum 0 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].completedAt: maxLength 40 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].completedAt: minLength 20 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].finishReason: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].finishReason: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].inputTokens: maximum 2147483647 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].inputTokens: minimum 0 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].modelVersion: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].modelVersion: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].outputTokens: maximum 2147483647 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].outputTokens: minimum 0 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].parentSpanId: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].parentSpanId: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].provider: maxLength 120 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].provider: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].reasoningEffort: maxLength 80 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].reasoningEffort: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].reasoningOutputTokens: maximum 2147483647 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].reasoningOutputTokens: minimum 0 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].requestedModel: maxLength 200 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].requestedModel: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].resolvedModel: maxLength 200 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].resolvedModel: minLength 1 dropped (outside the strict-mode keyword floor)",
        '$.execution.generationSpans[].responseIdHash: pattern "^sha256:[0-9a-f]{64}$" dropped (outside the strict-mode keyword floor)',
        "$.execution.generationSpans[].serviceTier: maxLength 80 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].serviceTier: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].spanId: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].spanId: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].startedAt: maxLength 40 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].startedAt: minLength 20 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].timeToFirstOutputMs: maximum 2147483647 dropped (outside the strict-mode keyword floor)",
        "$.execution.generationSpans[].timeToFirstOutputMs: minimum 0 dropped (outside the strict-mode keyword floor)",
        "$.execution.primarySpanId: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.execution.primarySpanId: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.execution.startedAt: maxLength 40 dropped (outside the strict-mode keyword floor)",
        "$.execution.startedAt: minLength 20 dropped (outside the strict-mode keyword floor)",
        "$.execution.toolCallCount: maximum 2147483647 dropped (outside the strict-mode keyword floor)",
        "$.execution.toolCallCount: minimum 0 dropped (outside the strict-mode keyword floor)",
        "$.execution.toolDurationMs: maximum 2147483647 dropped (outside the strict-mode keyword floor)",
        "$.execution.toolDurationMs: minimum 0 dropped (outside the strict-mode keyword floor)",
        "$.externalOpportunityId: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.externalOpportunityId: minLength 1 dropped (outside the strict-mode keyword floor)",
        '$.riskTier: pattern "^[a-z][a-z0-9_-]{0,63}$" dropped (outside the strict-mode keyword floor)',
        '$.sourceEvidence.hash: pattern "^sha256:[0-9a-f]{64}$" dropped (outside the strict-mode keyword floor)',
        "$.sourceEvidence.reference: maxLength 240 dropped (outside the strict-mode keyword floor)",
        "$.sourceEvidence.reference: minLength 1 dropped (outside the strict-mode keyword floor)",
        '$.suggestionCommitment: pattern "^sha256:[0-9a-f]{64}$" dropped (outside the strict-mode keyword floor)',
        "$.workflowKey: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.workflowKey: minLength 1 dropped (outside the strict-mode keyword floor)",
      ],
      semanticChanges: [
        "$.criticalRisk: optional property forced required by strict mode",
        "$.declaredConfidenceBps: optional property forced required by strict mode",
        "$.execution.completedAt: optional property forced required by strict mode",
        "$.execution.generationSpans[].cachedInputTokens: optional property forced required by strict mode",
        "$.execution.generationSpans[].completedAt: optional property forced required by strict mode",
        "$.execution.generationSpans[].finishReason: optional property forced required by strict mode",
        "$.execution.generationSpans[].inputTokens: optional property forced required by strict mode",
        "$.execution.generationSpans[].modelVersion: optional property forced required by strict mode",
        "$.execution.generationSpans[].outputTokens: optional property forced required by strict mode",
        "$.execution.generationSpans[].parentSpanId: optional property forced required by strict mode",
        "$.execution.generationSpans[].reasoningEffort: optional property forced required by strict mode",
        "$.execution.generationSpans[].reasoningOutputTokens: optional property forced required by strict mode",
        "$.execution.generationSpans[].resolvedModel: optional property forced required by strict mode",
        "$.execution.generationSpans[].responseIdHash: optional property forced required by strict mode",
        "$.execution.generationSpans[].serviceTier: optional property forced required by strict mode",
        "$.execution.generationSpans[].startedAt: optional property forced required by strict mode",
        "$.execution.generationSpans[].timeToFirstOutputMs: optional property forced required by strict mode",
        "$.execution.startedAt: optional property forced required by strict mode",
        "$.execution.toolCallCount: optional property forced required by strict mode",
        "$.execution.toolDurationMs: optional property forced required by strict mode",
      ],
    },
    gemini: {
      droppedConstraints: [
        '$.audiencePolicyHash: pattern "^sha256:[0-9a-f]{64}$" dropped (sanitizer strips pattern constraints)',
        '$.execution.generationSpans[].responseIdHash: pattern "^sha256:[0-9a-f]{64}$" dropped (sanitizer strips pattern constraints)',
        "$.execution.generationSpans[]: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
        "$.execution: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
        '$.riskTier: pattern "^[a-z][a-z0-9_-]{0,63}$" dropped (sanitizer strips pattern constraints)',
        '$.sourceEvidence.hash: pattern "^sha256:[0-9a-f]{64}$" dropped (sanitizer strips pattern constraints)',
        "$.sourceEvidence: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
        '$.suggestionCommitment: pattern "^sha256:[0-9a-f]{64}$" dropped (sanitizer strips pattern constraints)',
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: [
        '$.declaredConfidenceBps: type ["integer","null"] rewritten to nullable integer',
        '$.execution.completedAt: type ["string","null"] rewritten to nullable string',
        '$.execution.generationSpans[].cachedInputTokens: type ["integer","null"] rewritten to nullable integer',
        '$.execution.generationSpans[].completedAt: type ["string","null"] rewritten to nullable string',
        '$.execution.generationSpans[].finishReason: type ["string","null"] rewritten to nullable string',
        '$.execution.generationSpans[].inputTokens: type ["integer","null"] rewritten to nullable integer',
        '$.execution.generationSpans[].modelVersion: type ["string","null"] rewritten to nullable string',
        '$.execution.generationSpans[].outputTokens: type ["integer","null"] rewritten to nullable integer',
        '$.execution.generationSpans[].parentSpanId: type ["string","null"] rewritten to nullable string',
        '$.execution.generationSpans[].reasoningEffort: type ["string","null"] rewritten to nullable string',
        '$.execution.generationSpans[].reasoningOutputTokens: type ["integer","null"] rewritten to nullable integer',
        '$.execution.generationSpans[].resolvedModel: type ["string","null"] rewritten to nullable string',
        '$.execution.generationSpans[].responseIdHash: type ["string","null"] rewritten to nullable string',
        '$.execution.generationSpans[].serviceTier: type ["string","null"] rewritten to nullable string',
        '$.execution.generationSpans[].startedAt: type ["string","null"] rewritten to nullable string',
        '$.execution.generationSpans[].timeToFirstOutputMs: type ["integer","null"] rewritten to nullable integer',
        '$.execution.startedAt: type ["string","null"] rewritten to nullable string',
        '$.execution.toolCallCount: type ["integer","null"] rewritten to nullable integer',
        '$.execution.toolDurationMs: type ["integer","null"] rewritten to nullable integer',
      ],
    },
  },
  rateloop_request_review: {
    openai: {
      droppedConstraints: [
        "$.material.union[0].publication.allOf[0]: conditional required [redactionSummary] dropped (if/then unsupported in strict mode)",
        "$.material.union[0].publication.redactionSummary: maxLength 1000 dropped (outside the strict-mode keyword floor)",
        "$.material.union[0].publication.redactionSummary: minLength 10 dropped (outside the strict-mode keyword floor)",
        "$.material.union[1].sourceContentType: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.material.union[1].sourceContentType: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.material.union[1].suggestionContentType: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.material.union[1].suggestionContentType: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.opportunityId: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.opportunityId: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.question.negativeLabel: maxLength 40 dropped (outside the strict-mode keyword floor)",
        "$.question.negativeLabel: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.question.positiveLabel: maxLength 40 dropped (outside the strict-mode keyword floor)",
        "$.question.positiveLabel: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.question.prompt: maxLength 500 dropped (outside the strict-mode keyword floor)",
        "$.question.prompt: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.sourcePayload: maxLength 3000 dropped (outside the strict-mode keyword floor)",
        "$.sourcePayload: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.suggestionPayload: maxLength 3000 dropped (outside the strict-mode keyword floor)",
        "$.suggestionPayload: minLength 1 dropped (outside the strict-mode keyword floor)",
      ],
      semanticChanges: [
        "$.material.union[0].kind: const rewritten as a single-value enum",
        "$.material.union[0].publication.redactionSummary: optional property forced required by strict mode",
        "$.material.union[1].kind: const rewritten as a single-value enum",
        "$.material: oneOf relaxed to anyOf (strict mode has no exclusive union)",
        "$.material: optional property forced required by strict mode",
        "$.question.kind: const rewritten as a single-value enum",
        "$.question: optional property forced required by strict mode",
      ],
    },
    gemini: {
      droppedConstraints: [
        "$.material.union[0]: oneOf union arm dropped (kind=public)",
        "$.material.union[1]: oneOf union arm dropped (kind=private)",
        "$.question: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: [
        "$.material: oneOf union collapsed to an unconstrained object",
        "$.question.kind: const rewritten as a single-value enum",
      ],
    },
  },
  rateloop_wait_for_review: {
    openai: {
      droppedConstraints: [
        '$.cursor: pattern "^[0-9]{1,16}$" dropped (outside the strict-mode keyword floor)',
        "$.opportunityId: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.opportunityId: minLength 1 dropped (outside the strict-mode keyword floor)",
        "$.timeoutMs: maximum 60000 dropped (outside the strict-mode keyword floor)",
        "$.timeoutMs: minimum 1 dropped (outside the strict-mode keyword floor)",
      ],
      semanticChanges: [
        "$.cursor: optional property forced required by strict mode",
        "$.timeoutMs: optional property forced required by strict mode",
      ],
    },
    gemini: {
      droppedConstraints: [
        '$.cursor: pattern "^[0-9]{1,16}$" dropped (sanitizer strips pattern constraints)',
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: ['$.cursor: type ["string","null"] rewritten to nullable string'],
    },
  },
  rateloop_get_review_result: {
    openai: {
      droppedConstraints: [
        "$.opportunityId: maxLength 160 dropped (outside the strict-mode keyword floor)",
        "$.opportunityId: minLength 1 dropped (outside the strict-mode keyword floor)",
      ],
      semanticChanges: [],
    },
    gemini: {
      droppedConstraints: [
        "$: additionalProperties:false dropped (closed-object constraint not representable after sanitization)",
      ],
      semanticChanges: [],
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Collect a structural fingerprint of the constraints the gate must never lose
 * silently: required fields, enum constraints (const counts as a one-value enum),
 * and union arms. Union arms are keyed with a composition-neutral `.union[i]` path
 * segment so a oneOf→anyOf rewrite still lines up. Conditional constructs
 * (allOf/if/then/else) are deliberately not fingerprinted; their loss is tracked
 * through the exact-match droppedConstraints baseline instead.
 */
function collectConstraintFingerprint(schema: unknown, path = "$", entries = new Set<string>()): Set<string> {
  if (!isRecord(schema)) return entries;
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) entries.add(`required|${path}|${String(key)}`);
  }
  if (Array.isArray(schema.enum)) entries.add(`enum|${path}|${JSON.stringify(schema.enum)}`);
  if ("const" in schema) entries.add(`enum|${path}|${JSON.stringify([schema.const])}`);
  for (const keyword of ["oneOf", "anyOf"] as const) {
    const arms = schema[keyword];
    if (Array.isArray(arms)) {
      entries.add(`union|${path}|${arms.length}`);
      arms.forEach((arm, index) => collectConstraintFingerprint(arm, `${path}.union[${index}]`, entries));
    }
  }
  if (isRecord(schema.properties)) {
    for (const [key, value] of Object.entries(schema.properties)) {
      collectConstraintFingerprint(value, `${path}.${key}`, entries);
    }
  }
  if (isRecord(schema.items)) collectConstraintFingerprint(schema.items, `${path}[]`, entries);
  return entries;
}

/** Paths whose subtree losses the baseline explicitly documents (dropped unions/conditionals). */
function baselinedLossRoots(droppedConstraints: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const entry of droppedConstraints) {
    if (!/union arm dropped|conditional required|composition constraint dropped|conditional dropped/.test(entry)) {
      continue;
    }
    const path = entry.slice(0, entry.indexOf(": "));
    roots.add(path);
    const parent = path.replace(/\.(union|allOf)\[\d+\]$/, "");
    roots.add(parent);
  }
  return [...roots];
}

function pathWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}.`) || candidate.startsWith(`${root}[`);
}

function fingerprintPath(entry: string): string {
  return entry.split("|")[1] ?? "";
}

function assertNoUnbaselinedConstraintLoss(
  toolName: string,
  adapter: string,
  original: unknown,
  result: SchemaAdapterResult,
) {
  const before = collectConstraintFingerprint(original);
  const after = collectConstraintFingerprint(result.converted);
  const allowedRoots = baselinedLossRoots(result.droppedConstraints);
  const unaccountedLosses = [...before].filter(
    entry => !after.has(entry) && !allowedRoots.some(root => pathWithin(fingerprintPath(entry), root)),
  );
  assert.deepEqual(
    unaccountedLosses,
    [],
    `${toolName} loses required/enum/union constraints through the ${adapter} adapter emulation without recording the loss`,
  );
}

test("every deployed MCP tool is pinned in the adapter baseline and vice versa", () => {
  assert.deepEqual([...deployedTools.keys()].sort(), Object.keys(KNOWN_ADAPTER_BASELINE).sort());
});

test("the OpenAI strict emulation never drops a required field, union arm, or enum outside conditionals", () => {
  for (const tool of deployedTools.values()) {
    const result = emulateOpenAiStrictToolSchema(tool.inputSchema);
    for (const entry of result.droppedConstraints) {
      assert.match(
        entry,
        /keyword floor|conditional required|composition constraint|conditional dropped/,
        `${tool.name}: unexpected OpenAI drop category: ${entry}`,
      );
    }
    assertNoUnbaselinedConstraintLoss(tool.name, "OpenAI strict", tool.inputSchema, result);
  }
});

test("the Gemini sanitization emulation loses unions only where the baseline records them", () => {
  for (const tool of deployedTools.values()) {
    const result = emulateGeminiCliToolSchema(tool.inputSchema);
    assertNoUnbaselinedConstraintLoss(tool.name, "Gemini CLI", tool.inputSchema, result);
    const unionLosses = result.droppedConstraints.filter(entry => entry.includes("union arm dropped"));
    if (tool.name !== "rateloop_request_review") {
      assert.deepEqual(unionLosses, [], `${tool.name}: a union arm loss appeared outside the known-issues baseline`);
    }
  }
});

for (const tool of deployedTools.values()) {
  const baseline = KNOWN_ADAPTER_BASELINE[tool.name];
  test(`${tool.name} matches its pinned OpenAI strict adapter baseline exactly`, () => {
    assert.ok(baseline, `no baseline entry for ${tool.name}`);
    const result = emulateOpenAiStrictToolSchema(tool.inputSchema);
    assert.deepEqual(result.droppedConstraints, baseline.openai.droppedConstraints);
    assert.deepEqual(result.semanticChanges, baseline.openai.semanticChanges);
  });
  test(`${tool.name} matches its pinned Gemini CLI adapter baseline exactly`, () => {
    assert.ok(baseline, `no baseline entry for ${tool.name}`);
    const result = emulateGeminiCliToolSchema(tool.inputSchema);
    assert.deepEqual(result.droppedConstraints, baseline.gemini.droppedConstraints);
    assert.deepEqual(result.semanticChanges, baseline.gemini.semanticChanges);
  });
}

test("the emulators themselves detect representative constraint losses (self-check)", () => {
  const syntheticSchema = {
    additionalProperties: false,
    properties: {
      mode: {
        oneOf: [
          {
            additionalProperties: false,
            allOf: [
              {
                if: { properties: { level: { const: "custom" } }, required: ["level"] },
                then: { required: ["customLabel"] },
              },
            ],
            properties: {
              level: { enum: ["standard", "custom"], type: "string" },
              customLabel: { maxLength: 10, type: "string" },
            },
            required: ["level"],
            type: "object",
          },
          {
            additionalProperties: false,
            properties: { token: { pattern: "^[a-z]+$", type: "string" } },
            required: ["token"],
            type: "object",
          },
        ],
      },
    },
    required: ["mode"],
    type: "object",
  };

  const openai = emulateOpenAiStrictToolSchema(syntheticSchema);
  assert.ok(openai.droppedConstraints.some(entry => entry.includes("conditional required [customLabel]")));
  assert.ok(openai.droppedConstraints.some(entry => entry.includes("pattern")));
  assert.ok(openai.semanticChanges.some(entry => entry.includes("oneOf relaxed to anyOf")));
  const openaiAfter = collectConstraintFingerprint(openai.converted);
  assert.ok(openaiAfter.has('enum|$.mode.union[0].level|["standard","custom"]'), "OpenAI emulation must keep enums");
  assert.ok(openaiAfter.has("union|$.mode|2"), "OpenAI emulation must keep both union arms");

  const gemini = emulateGeminiCliToolSchema(syntheticSchema);
  assert.equal(gemini.droppedConstraints.filter(entry => entry.includes("union arm dropped")).length, 2);
  const geminiAfter = collectConstraintFingerprint(gemini.converted);
  assert.ok(!geminiAfter.has("union|$.mode|2"), "Gemini emulation must report the union as gone");
  const before = collectConstraintFingerprint(syntheticSchema);
  const lost = [...before].filter(entry => !geminiAfter.has(entry));
  assert.ok(lost.length > 0, "the fingerprint check must observe Gemini union losses");
});
