import { createHash } from "node:crypto";
import "server-only";
import {
  type AgentExecutionProfile,
  type AgentExecutionProfileSchemaVersion,
  type AgentGenerationSpanInput,
  type NormalizedAgentExecutionProvenance,
  agentExecutionProfileHash,
  normalizeAgentExecutionProvenance,
  projectAgentExecutionProfile,
} from "~~/lib/tokenless/agentExecutionProvenance";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const AGENT_EXECUTION_EVIDENCE_SCHEMA_VERSION = "rateloop.execution-evidence.v1" as const;

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MANIFEST_KEYS = [
  "schemaVersion",
  "externalExecutionId",
  "status",
  "startedAt",
  "completedAt",
  "durationMs",
  "toolCallCount",
  "toolDurationMs",
  "primarySpanId",
  "generationSpans",
  "totals",
] as const;
const SPAN_KEYS = [
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
  "durationMs",
  "timeToFirstOutputMs",
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "responseIdHash",
  "finishReason",
] as const;
const TOTAL_KEYS = [
  "generationSpanCount",
  "generationDurationMs",
  "toolCallCount",
  "toolDurationMs",
  "inputTokens",
  "cachedInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "totalTokens",
] as const;
const PROFILE_KEYS = ["schemaVersion", "orchestrationMode", "primary", "contributors"] as const;
const MODEL_PROFILE_KEYS = [
  "provider",
  "requestedModel",
  "resolvedModel",
  "modelVersion",
  "reasoningEffort",
  "serviceTier",
] as const;

type AgentExecutionManifest = Omit<
  NormalizedAgentExecutionProvenance,
  "manifestCommitment" | "executionProfile" | "executionProfileHash"
>;

export type AgentExecutionEvidence = {
  schemaVersion: typeof AGENT_EXECUTION_EVIDENCE_SCHEMA_VERSION;
  executionId: string;
  opportunityBinding: {
    opportunityId: string;
    metadataCommitment: `sha256:${string}`;
  };
  source: {
    kind: "host_reported";
    independentlyVerified: false;
    attestation: null;
  };
  manifest: AgentExecutionManifest;
  manifestCommitment: `sha256:${string}`;
  executionProfile: AgentExecutionProfile;
  executionProfileHash: `sha256:${string}`;
  evidenceCommitment: `sha256:${string}`;
};

function invalid(message: string): never {
  throw new TokenlessServiceError(message, 400, "invalid_execution_evidence");
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(`${name} must be a plain object.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, name: string, keys: readonly string[]) {
  const expected = new Set(keys);
  const unsupported = Object.keys(value).filter(key => !expected.has(key));
  const missing = keys.filter(key => !(key in value));
  if (unsupported.length > 0 || missing.length > 0) {
    invalid(`${name} must contain exactly: ${keys.join(", ")}.`);
  }
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
  if (encoded === undefined) invalid("Execution evidence must be JSON serializable.");
  return encoded;
}

function commitment(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function executionId(value: unknown) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    invalid("executionId must be a privacy-safe identifier of 1-160 characters.");
  }
  return value;
}

function manifestFrom(execution: NormalizedAgentExecutionProvenance): AgentExecutionManifest {
  const {
    manifestCommitment: _manifestCommitment,
    executionProfile: _executionProfile,
    executionProfileHash: _profileHash,
    ...manifest
  } = execution;
  void _manifestCommitment;
  void _executionProfile;
  void _profileHash;
  return manifest;
}

function generationInput(value: unknown, index: number): AgentGenerationSpanInput {
  const span = record(value, `manifest.generationSpans[${index}]`);
  exactKeys(span, `manifest.generationSpans[${index}]`, SPAN_KEYS);
  return {
    spanId: span.spanId as string,
    parentSpanId: span.parentSpanId as string | null,
    role: span.role as AgentGenerationSpanInput["role"],
    provider: span.provider as string,
    requestedModel: span.requestedModel as string,
    resolvedModel: span.resolvedModel as string | null,
    modelVersion: span.modelVersion as string | null,
    reasoningEffort: span.reasoningEffort as string | null,
    serviceTier: span.serviceTier as string | null,
    startedAt: span.startedAt as string | null,
    completedAt: span.completedAt as string | null,
    timeToFirstOutputMs: span.timeToFirstOutputMs as number | null,
    inputTokens: span.inputTokens as number | null,
    cachedInputTokens: span.cachedInputTokens as number | null,
    outputTokens: span.outputTokens as number | null,
    reasoningOutputTokens: span.reasoningOutputTokens as number | null,
    responseIdHash: span.responseIdHash as string | null,
    finishReason: span.finishReason as string | null,
  };
}

function normalizeManifest(value: unknown) {
  const manifest = record(value, "manifest");
  exactKeys(manifest, "manifest", MANIFEST_KEYS);
  exactKeys(record(manifest.totals, "manifest.totals"), "manifest.totals", TOTAL_KEYS);
  if (!Array.isArray(manifest.generationSpans)) invalid("manifest.generationSpans must be an array.");
  return normalizeAgentExecutionProvenance({
    externalExecutionId: manifest.externalExecutionId,
    status: manifest.status,
    startedAt: manifest.startedAt,
    completedAt: manifest.completedAt,
    toolCallCount: manifest.toolCallCount,
    toolDurationMs: manifest.toolDurationMs,
    primarySpanId: manifest.primarySpanId,
    generationSpans: manifest.generationSpans.map(generationInput),
  });
}

function assertProfileShape(value: unknown) {
  const profile = record(value, "executionProfile");
  exactKeys(profile, "executionProfile", PROFILE_KEYS);
  if (
    profile.schemaVersion !== "rateloop.execution-profile.v1" &&
    profile.schemaVersion !== "rateloop.execution-profile.v2"
  ) {
    invalid("executionProfile.schemaVersion is unsupported.");
  }
  exactKeys(record(profile.primary, "executionProfile.primary"), "executionProfile.primary", MODEL_PROFILE_KEYS);
  if (!Array.isArray(profile.contributors)) invalid("executionProfile.contributors must be an array.");
  profile.contributors.forEach((contributor, index) => {
    exactKeys(
      record(contributor, `executionProfile.contributors[${index}]`),
      `executionProfile.contributors[${index}]`,
      MODEL_PROFILE_KEYS,
    );
  });
}

function buildEvidence(input: {
  executionId: string;
  opportunityId: string;
  metadataCommitment: `sha256:${string}`;
  execution: NormalizedAgentExecutionProvenance;
  executionProfile?: AgentExecutionProfile;
}): AgentExecutionEvidence {
  const { execution } = input;
  const executionProfile = input.executionProfile ?? execution.executionProfile;
  const manifest = manifestFrom(execution);
  if (commitment(manifest) !== execution.manifestCommitment) {
    invalid("Execution manifest does not match its commitment.");
  }
  const executionProfileHash = agentExecutionProfileHash(executionProfile);
  if (input.executionProfile === undefined && executionProfileHash !== execution.executionProfileHash) {
    invalid("Execution profile does not match its commitment.");
  }
  const evidence = {
    schemaVersion: AGENT_EXECUTION_EVIDENCE_SCHEMA_VERSION,
    executionId: input.executionId,
    opportunityBinding: {
      opportunityId: input.opportunityId,
      metadataCommitment: input.metadataCommitment,
    },
    source: {
      kind: "host_reported" as const,
      independentlyVerified: false as const,
      attestation: null,
    },
    manifest,
    manifestCommitment: execution.manifestCommitment,
    executionProfile,
    executionProfileHash,
  };
  return { ...evidence, evidenceCommitment: commitment(evidence) };
}

/**
 * Projects a previously normalized execution into the exact privacy-safe
 * evidence envelope returned by agent-facing review tools.
 */
export function projectAgentExecutionEvidence(input: {
  executionId: string;
  opportunityId: string;
  metadataCommitment: string;
  execution: NormalizedAgentExecutionProvenance;
  profileSchemaVersion?: AgentExecutionProfileSchemaVersion;
}): AgentExecutionEvidence {
  const id = executionId(input.executionId);
  const opportunityId = executionId(input.opportunityId);
  if (!HASH_PATTERN.test(input.metadataCommitment)) {
    invalid("metadataCommitment must be a lowercase sha256 commitment.");
  }
  const normalized = normalizeManifest(manifestFrom(input.execution));
  if (canonicalJson(normalized) !== canonicalJson(input.execution)) {
    invalid("Execution provenance is not in its canonical normalized form.");
  }
  const executionProfile = input.profileSchemaVersion
    ? projectAgentExecutionProfile(normalized, input.profileSchemaVersion)
    : undefined;
  return buildEvidence({
    executionId: id,
    opportunityId,
    metadataCommitment: input.metadataCommitment as `sha256:${string}`,
    execution: normalized,
    ...(executionProfile ? { executionProfile } : {}),
  });
}

/**
 * Parses an envelope from durable state or a tool boundary, recomputing every
 * commitment and all derived timing/usage fields. Unknown keys are rejected;
 * this prevents content fields from being smuggled into provenance evidence.
 */
export function parseAgentExecutionEvidence(value: unknown): AgentExecutionEvidence {
  const root = record(value, "execution evidence");
  exactKeys(root, "execution evidence", [
    "schemaVersion",
    "executionId",
    "opportunityBinding",
    "source",
    "manifest",
    "manifestCommitment",
    "executionProfile",
    "executionProfileHash",
    "evidenceCommitment",
  ]);
  if (root.schemaVersion !== AGENT_EXECUTION_EVIDENCE_SCHEMA_VERSION) {
    invalid("Execution evidence schemaVersion is unsupported.");
  }
  const opportunityBinding = record(root.opportunityBinding, "opportunityBinding");
  exactKeys(opportunityBinding, "opportunityBinding", ["opportunityId", "metadataCommitment"]);
  const source = record(root.source, "source");
  exactKeys(source, "source", ["kind", "independentlyVerified", "attestation"]);
  if (source.kind !== "host_reported" || source.independentlyVerified !== false || source.attestation !== null) {
    invalid("Execution evidence must identify unverified host-reported metadata exactly.");
  }
  for (const [field, hash] of [
    ["opportunityBinding.metadataCommitment", opportunityBinding.metadataCommitment],
    ["manifestCommitment", root.manifestCommitment],
    ["executionProfileHash", root.executionProfileHash],
    ["evidenceCommitment", root.evidenceCommitment],
  ] as const) {
    if (typeof hash !== "string" || !HASH_PATTERN.test(hash)) {
      invalid(`${field} must be a lowercase sha256 commitment.`);
    }
  }
  assertProfileShape(root.executionProfile);
  const normalized = normalizeManifest(root.manifest);
  const profileSchemaVersion = (root.executionProfile as AgentExecutionProfile).schemaVersion;
  const executionProfile = projectAgentExecutionProfile(
    normalized,
    profileSchemaVersion as AgentExecutionProfileSchemaVersion,
  );
  const expected = buildEvidence({
    executionId: executionId(root.executionId),
    opportunityId: executionId(opportunityBinding.opportunityId),
    metadataCommitment: opportunityBinding.metadataCommitment as `sha256:${string}`,
    execution: normalized,
    executionProfile,
  });
  if (canonicalJson(root) !== canonicalJson(expected)) {
    invalid("Execution evidence is not the exact canonical hash-bound projection.");
  }
  return expected;
}
