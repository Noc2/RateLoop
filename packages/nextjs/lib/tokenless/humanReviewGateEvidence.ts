import { type KeyObject, createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";
import "server-only";
import { createConfiguredAwsKmsEvidenceSigner } from "~~/lib/tokenless/awsKmsEvidenceSigner";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

export const HUMAN_REVIEW_GATE_EVIDENCE_SCHEMA_VERSION = "rateloop.human-review-gate-evidence.v1" as const;
export const HUMAN_REVIEW_GATE_PAYLOAD_SCHEMA_VERSION = "rateloop.human-review-gate-payload.v1" as const;
export const HUMAN_REVIEW_GATE_SERVER_STATE_SCHEMA_VERSION = "rateloop.human-review-gate-server-state.v1" as const;
export const HUMAN_REVIEW_ADVISORY_TERMINAL_EVIDENCE_SCHEMA_VERSION =
  "rateloop.human-review-terminal-evidence.v2" as const;
export const HUMAN_REVIEW_ADVISORY_TERMINAL_PAYLOAD_SCHEMA_VERSION =
  "rateloop.human-review-terminal-payload.v2" as const;
export const HUMAN_REVIEW_ADVISORY_SKIP_EVIDENCE_SCHEMA_VERSION =
  "rateloop.human-review-skip-release-evidence.v1" as const;
export const HUMAN_REVIEW_ADVISORY_SKIP_PAYLOAD_SCHEMA_VERSION =
  "rateloop.human-review-skip-release-payload.v1" as const;
export const HUMAN_REVIEW_HOST_RELEASE_EVIDENCE_SCHEMA_VERSION = "rateloop.host-output-release-evidence.v2" as const;
export const HUMAN_REVIEW_HOST_RELEASE_PAYLOAD_SCHEMA_VERSION = "rateloop.host-output-release-payload.v2" as const;

const SIGNATURE_VERSION = 1 as const;
const EVIDENCE_TTL_MS = 5 * 60 * 1_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const KEY_ID = /^ed25519:[0-9a-f]{24}$/u;
const NONCE = /^[A-Za-z0-9_-]{32}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{59}$/u;
const HOST_LOCAL_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const HOST_OPAQUE_IDENTIFIER = /^[A-Za-z0-9._:-]{8,200}$/u;
const HOST_NONCE = /^[A-Za-z0-9_-]{32,128}$/u;
const MAX_HOST_REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;

const LIFECYCLE_STATES = [
  "skipped",
  "approval_required",
  "request_ready",
  "pending",
  "blocked",
  "completed",
  "inconclusive",
  "failed_terminal",
  "cancelled_before_commit",
] as const;
const TERMINAL_DISPOSITIONS = [
  "skipped",
  "completed",
  "inconclusive",
  "failed_terminal",
  "cancelled_before_commit",
] as const;
const REVIEW_DECISIONS = ["required", "recommended", "skip"] as const;
const RESULT_SEMANTICS = ["assurance", "feedback"] as const;
const RESULT_OUTCOMES = ["positive", "negative", "inconclusive", "failed", "cancelled"] as const;
const RELEASE_DISPOSITIONS = ["authorized_positive", "not_authorized"] as const;

export type HumanReviewGateLifecycleState = (typeof LIFECYCLE_STATES)[number];
export type HumanReviewGateTerminalDisposition = (typeof TERMINAL_DISPOSITIONS)[number] | null;
export type HumanReviewGateDecision = (typeof REVIEW_DECISIONS)[number];
export type HumanReviewGateResultSemantics = (typeof RESULT_SEMANTICS)[number];
export type HumanReviewGateResultOutcome = (typeof RESULT_OUTCOMES)[number];
export type HumanReviewGateReleaseDisposition = (typeof RELEASE_DISPOSITIONS)[number];

export type HumanReviewGateBinding = {
  workspaceId: string;
  integrationId: string;
  agentId: string;
  agentVersionId: string;
  scopeId: string;
  opportunityId: string;
  lifecycle: {
    state: HumanReviewGateLifecycleState;
    revision: number;
  };
  references: {
    operationKey: string | null;
    requestReference: string | null;
    resultReference: string | null;
  };
  reviewDecision: HumanReviewGateDecision;
  terminalDisposition: HumanReviewGateTerminalDisposition;
};

export type HumanReviewGatePayload = {
  schemaVersion: typeof HUMAN_REVIEW_GATE_PAYLOAD_SCHEMA_VERSION;
  assertion: "rateloop_server_review_gate_state";
  workspaceId: string;
  integrationId: string;
  agentId: string;
  agentVersionId: string;
  scopeId: string;
  opportunityId: string;
  lifecycleState: HumanReviewGateLifecycleState;
  lifecycleRevision: number;
  operationKey: string | null;
  requestReference: string | null;
  resultReference: string | null;
  reviewDecision: HumanReviewGateDecision;
  terminalDisposition: HumanReviewGateTerminalDisposition;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  evidenceCommitment: `sha256:${string}`;
};

export type HumanReviewGateEvidence = {
  schemaVersion: typeof HUMAN_REVIEW_GATE_EVIDENCE_SCHEMA_VERSION;
  signing: {
    algorithm: "Ed25519";
    keyId: string;
    version: typeof SIGNATURE_VERSION;
  };
  payload: HumanReviewGatePayload;
  signature: string;
};

export type HumanReviewGateEvidenceReplayGuard = {
  consume(input: { nonce: string; evidenceCommitment: string; expiresAt: string }): boolean;
};

export type HumanReviewGateVersionReference = {
  id: string;
  version: number;
  hash: `sha256:${string}`;
};

export type HumanReviewGateServerState = HumanReviewGateBinding & {
  schemaVersion: typeof HUMAN_REVIEW_GATE_SERVER_STATE_SCHEMA_VERSION;
  selectionPolicy: HumanReviewGateVersionReference;
  humanReviewBinding: HumanReviewGateVersionReference;
  requestProfile: HumanReviewGateVersionReference;
  outputCommitment: `sha256:${string}`;
  scopeCommitment: `sha256:${string}`;
  inconclusiveReleaseAllowed: boolean;
  resultSemantics: HumanReviewGateResultSemantics;
  resultOutcome: HumanReviewGateResultOutcome | null;
  resultCommitment: `sha256:${string}` | null;
  releaseDisposition: HumanReviewGateReleaseDisposition;
};

export type HumanReviewGateServerStateResolver = {
  resolve(input: { workspaceId: string; integrationId: string; opportunityId: string }): Promise<unknown>;
};

export type HumanReviewAdvisoryTerminalEvidence = {
  schemaVersion: typeof HUMAN_REVIEW_ADVISORY_TERMINAL_EVIDENCE_SCHEMA_VERSION;
  keyId: string;
  payload: {
    schemaVersion: typeof HUMAN_REVIEW_ADVISORY_TERMINAL_PAYLOAD_SCHEMA_VERSION;
    workspaceId: string;
    integrationId: string;
    opportunityId: string;
    terminalStatus: "completed" | "inconclusive" | "failed_terminal" | "cancelled_before_commit";
    releaseDisposition: HumanReviewGateReleaseDisposition;
    resultSemantics: HumanReviewGateResultSemantics;
    resultOutcome: HumanReviewGateResultOutcome | null;
    resultCommitment: `sha256:${string}` | null;
    outputCommitment: `sha256:${string}`;
    policyBindingHash: `sha256:${string}`;
    issuedAt: string;
  };
  signature: string;
};

export type HumanReviewAdvisorySkipEvidence = {
  schemaVersion: typeof HUMAN_REVIEW_ADVISORY_SKIP_EVIDENCE_SCHEMA_VERSION;
  keyId: string;
  payload: {
    schemaVersion: typeof HUMAN_REVIEW_ADVISORY_SKIP_PAYLOAD_SCHEMA_VERSION;
    workspaceId: string;
    integrationId: string;
    opportunityId: string;
    decision: "skipped";
    terminalStatus: "skipped";
    outputCommitment: `sha256:${string}`;
    policyBindingHash: `sha256:${string}`;
    scopeCommitment: `sha256:${string}`;
    issuedAt: string;
  };
  signature: string;
};

export type HumanReviewHostReleaseRequest = {
  schemaVersion: "rateloop.host-output-release-request.v1";
  releaseId: string;
  hostId: string;
  sessionId: string;
  turnId: string;
  gateId: string;
  workspaceId: string;
  integrationId: string;
  opportunityId: string;
  decision: "satisfied" | "skipped";
  outputCommitment: `sha256:${string}`;
  policyBindingHash: `sha256:${string}`;
  scopeCommitment: `sha256:${string}`;
  nonce: string;
  createdAt: string;
  expiresAt: string;
};

export type HumanReviewHostReleaseEvidence = {
  schemaVersion: typeof HUMAN_REVIEW_HOST_RELEASE_EVIDENCE_SCHEMA_VERSION;
  keyId: string;
  payload: {
    schemaVersion: typeof HUMAN_REVIEW_HOST_RELEASE_PAYLOAD_SCHEMA_VERSION;
    releaseId: string;
    workspaceId: string;
    integrationId: string;
    opportunityId: string;
    decision: "satisfied" | "skipped";
    terminalStatus: "completed" | "inconclusive" | "skipped";
    releaseDisposition: "authorized_positive" | "selection_skipped";
    resultSemantics: HumanReviewGateResultSemantics;
    resultOutcome: "positive" | null;
    resultCommitment: `sha256:${string}` | null;
    outputCommitment: `sha256:${string}`;
    policyBindingHash: `sha256:${string}`;
    scopeCommitment: `sha256:${string}`;
    hostBindingCommitment: `sha256:${string}`;
    issuedAt: string;
    expiresAt: string;
  };
  signature: string;
};

type VerificationKeyStatus = "current" | "retired";
type VerificationKey = { keyId: string; publicKey: KeyObject; status: VerificationKeyStatus };
type TestConfig = {
  signingPrivateKey?: KeyObject;
  verificationKeys?: Array<{ publicKey: KeyObject; status: VerificationKeyStatus }>;
  now?: Date;
  nonce?: Buffer;
};

const BINDING_KEYS = [
  "workspaceId",
  "integrationId",
  "agentId",
  "agentVersionId",
  "scopeId",
  "opportunityId",
  "lifecycle",
  "references",
  "reviewDecision",
  "terminalDisposition",
] as const;
const PAYLOAD_KEYS = [
  "schemaVersion",
  "assertion",
  "workspaceId",
  "integrationId",
  "agentId",
  "agentVersionId",
  "scopeId",
  "opportunityId",
  "lifecycleState",
  "lifecycleRevision",
  "operationKey",
  "requestReference",
  "resultReference",
  "reviewDecision",
  "terminalDisposition",
  "issuedAt",
  "expiresAt",
  "nonce",
  "evidenceCommitment",
] as const;
const SERVER_STATE_KEYS = [
  "schemaVersion",
  ...BINDING_KEYS,
  "selectionPolicy",
  "humanReviewBinding",
  "requestProfile",
  "outputCommitment",
  "scopeCommitment",
  "inconclusiveReleaseAllowed",
  "resultSemantics",
  "resultOutcome",
  "resultCommitment",
  "releaseDisposition",
] as const;
const HOST_REQUEST_KEYS = [
  "schemaVersion",
  "releaseId",
  "hostId",
  "sessionId",
  "turnId",
  "gateId",
  "workspaceId",
  "integrationId",
  "opportunityId",
  "decision",
  "outputCommitment",
  "policyBindingHash",
  "scopeCommitment",
  "nonce",
  "createdAt",
  "expiresAt",
] as const;

let testConfig: TestConfig | null = null;

function serviceError(message: string, code: string, status = 409, retryable = false): never {
  throw new TokenlessServiceError(message, status, code, retryable);
}

function invalidBinding(message: string): never {
  serviceError(message, "invalid_review_gate_evidence_binding", 400);
}

function invalidEvidence(message: string, code = "invalid_review_gate_evidence"): never {
  serviceError(message, code, 409);
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidEvidence(`${field} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidEvidence(`${field} must be a plain object.`);
  return value as Record<string, unknown>;
}

function bindingRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidBinding(`${field} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidBinding(`${field} must be a plain object.`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
  invalid: (message: string) => never = invalidEvidence,
) {
  const expected = new Set(keys);
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !expected.has(key))) {
    invalid(`${field} must contain exactly: ${keys.join(", ")}.`);
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) invalidEvidence("Review-gate evidence must be JSON serializable.");
  return encoded;
}

function sha256(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function identifier(value: unknown, field: string, invalid: (message: string) => never) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    invalid(`${field} must be a privacy-safe opaque identifier of 1-200 characters.`);
  }
  return value;
}

function optionalReference(value: unknown, field: string, invalid: (message: string) => never) {
  if (value === null) return null;
  return identifier(value, field, invalid);
}

function positiveRevision(value: unknown, invalid: (message: string) => never) {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    invalid("lifecycle.revision must be a positive 32-bit integer.");
  }
  return Number(value);
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  field: string,
  invalid: (message: string) => never,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid(`${field} is unsupported.`);
  return value as Values[number];
}

function normalizeBinding(value: unknown): HumanReviewGateBinding {
  const input = bindingRecord(value, "review-gate binding");
  exactKeys(input, BINDING_KEYS, "review-gate binding", invalidBinding);
  const lifecycle = bindingRecord(input.lifecycle, "lifecycle");
  exactKeys(lifecycle, ["state", "revision"], "lifecycle", invalidBinding);
  const references = bindingRecord(input.references, "references");
  exactKeys(references, ["operationKey", "requestReference", "resultReference"], "references", invalidBinding);
  const state = enumValue(lifecycle.state, LIFECYCLE_STATES, "lifecycle.state", invalidBinding);
  const reviewDecision = enumValue(input.reviewDecision, REVIEW_DECISIONS, "reviewDecision", invalidBinding);
  const terminalDisposition =
    input.terminalDisposition === null
      ? null
      : enumValue(input.terminalDisposition, TERMINAL_DISPOSITIONS, "terminalDisposition", invalidBinding);
  const terminal = state === "skipped" || TERMINAL_DISPOSITIONS.includes(state as never);
  if (terminalDisposition !== (terminal ? state : null)) {
    invalidBinding("terminalDisposition must exactly match a terminal lifecycle state and otherwise be null.");
  }
  if ((state === "skipped") !== (reviewDecision === "skip" || reviewDecision === "recommended")) {
    invalidBinding(
      "Skipped lifecycle evidence must carry a skip or recommended decision, and only skipped evidence may do so.",
    );
  }
  if (state !== "skipped" && reviewDecision !== "required") {
    invalidBinding("A non-skipped review gate must carry the required review decision.");
  }
  const resultReference = optionalReference(references.resultReference, "references.resultReference", invalidBinding);
  if (!terminal && resultReference !== null) {
    invalidBinding("Non-terminal review-gate evidence cannot carry a result reference.");
  }
  if (
    state === "skipped" &&
    (references.operationKey !== null || references.requestReference !== null || resultReference !== null)
  ) {
    invalidBinding("Skipped review-gate evidence cannot carry operation, request, or result references.");
  }
  if (["completed", "inconclusive", "failed_terminal"].includes(state) && resultReference === null) {
    invalidBinding("A completed, inconclusive, or failed terminal review must carry a result reference.");
  }
  return {
    workspaceId: identifier(input.workspaceId, "workspaceId", invalidBinding),
    integrationId: identifier(input.integrationId, "integrationId", invalidBinding),
    agentId: identifier(input.agentId, "agentId", invalidBinding),
    agentVersionId: identifier(input.agentVersionId, "agentVersionId", invalidBinding),
    scopeId: identifier(input.scopeId, "scopeId", invalidBinding),
    opportunityId: identifier(input.opportunityId, "opportunityId", invalidBinding),
    lifecycle: { state, revision: positiveRevision(lifecycle.revision, invalidBinding) },
    references: {
      operationKey: optionalReference(references.operationKey, "references.operationKey", invalidBinding),
      requestReference: optionalReference(references.requestReference, "references.requestReference", invalidBinding),
      resultReference,
    },
    reviewDecision,
    terminalDisposition,
  };
}

function serverStateInvalid(message: string): never {
  serviceError(message, "review_gate_server_state_invalid", 500);
}

function serverStateMismatch(message: string): never {
  serviceError(message, "review_gate_server_state_mismatch", 409);
}

function serverStateRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    serverStateInvalid(`${field} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    serverStateInvalid(`${field} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function versionReference(value: unknown, field: string): HumanReviewGateVersionReference {
  const reference = serverStateRecord(value, field);
  exactKeys(reference, ["id", "version", "hash"], field, serverStateInvalid);
  if (
    typeof reference.id !== "string" ||
    !IDENTIFIER.test(reference.id) ||
    !Number.isSafeInteger(reference.version) ||
    Number(reference.version) < 1 ||
    typeof reference.hash !== "string" ||
    !HASH.test(reference.hash)
  ) {
    serverStateInvalid(`${field} must contain an exact ID, positive version, and commitment.`);
  }
  return {
    id: reference.id,
    version: Number(reference.version),
    hash: reference.hash as `sha256:${string}`,
  };
}

function expectedReleaseDisposition(input: {
  lifecycle: HumanReviewGateLifecycleState;
  resultSemantics: HumanReviewGateResultSemantics;
  resultOutcome: HumanReviewGateResultOutcome | null;
  resultCommitment: string | null;
}): HumanReviewGateReleaseDisposition {
  return input.lifecycle === "completed" &&
    input.resultSemantics === "assurance" &&
    input.resultOutcome === "positive" &&
    input.resultCommitment !== null
    ? "authorized_positive"
    : "not_authorized";
}

function normalizeServerState(value: unknown): HumanReviewGateServerState {
  const state = serverStateRecord(value, "review-gate server state");
  exactKeys(state, SERVER_STATE_KEYS, "review-gate server state", serverStateInvalid);
  if (state.schemaVersion !== HUMAN_REVIEW_GATE_SERVER_STATE_SCHEMA_VERSION) {
    serverStateInvalid("Review-gate server state schemaVersion is unsupported.");
  }
  let binding: HumanReviewGateBinding;
  try {
    binding = normalizeBinding({
      workspaceId: state.workspaceId,
      integrationId: state.integrationId,
      agentId: state.agentId,
      agentVersionId: state.agentVersionId,
      scopeId: state.scopeId,
      opportunityId: state.opportunityId,
      lifecycle: state.lifecycle,
      references: state.references,
      reviewDecision: state.reviewDecision,
      terminalDisposition: state.terminalDisposition,
    });
  } catch (error) {
    if (error instanceof TokenlessServiceError) {
      serverStateInvalid(`Resolved review-gate binding is invalid: ${error.message}`);
    }
    throw error;
  }
  if (
    typeof state.outputCommitment !== "string" ||
    !HASH.test(state.outputCommitment) ||
    typeof state.scopeCommitment !== "string" ||
    !HASH.test(state.scopeCommitment) ||
    typeof state.inconclusiveReleaseAllowed !== "boolean"
  ) {
    serverStateInvalid("Review-gate server commitments or release policy are invalid.");
  }
  const resultSemantics = enumValue(state.resultSemantics, RESULT_SEMANTICS, "resultSemantics", serverStateInvalid);
  const resultOutcome =
    state.resultOutcome === null
      ? null
      : enumValue(state.resultOutcome, RESULT_OUTCOMES, "resultOutcome", serverStateInvalid);
  const resultCommitment =
    state.resultCommitment === null
      ? null
      : typeof state.resultCommitment === "string" && HASH.test(state.resultCommitment)
        ? (state.resultCommitment as `sha256:${string}`)
        : serverStateInvalid("resultCommitment must be null or an exact SHA-256 commitment.");
  if ((resultOutcome === null) !== (resultCommitment === null)) {
    serverStateInvalid("A terminal result outcome and commitment must be present or absent together.");
  }
  const expectedOutcomeState =
    resultOutcome === "positive" || resultOutcome === "negative"
      ? "completed"
      : resultOutcome === "inconclusive"
        ? "inconclusive"
        : resultOutcome === "failed"
          ? "failed_terminal"
          : resultOutcome === "cancelled"
            ? "cancelled_before_commit"
            : null;
  if (expectedOutcomeState !== null && binding.lifecycle.state !== expectedOutcomeState) {
    serverStateInvalid("The result outcome does not match the terminal review lifecycle.");
  }
  if (
    resultOutcome === null &&
    (binding.lifecycle.state === "completed" || binding.lifecycle.state === "inconclusive")
  ) {
    serverStateInvalid("A completed or inconclusive review must carry its canonical result outcome and commitment.");
  }
  const releaseDisposition = enumValue(
    state.releaseDisposition,
    RELEASE_DISPOSITIONS,
    "releaseDisposition",
    serverStateInvalid,
  );
  if (
    releaseDisposition !==
    expectedReleaseDisposition({
      lifecycle: binding.lifecycle.state,
      resultSemantics,
      resultOutcome,
      resultCommitment,
    })
  ) {
    serverStateInvalid("The release disposition does not match the frozen semantics and canonical result.");
  }
  return {
    schemaVersion: HUMAN_REVIEW_GATE_SERVER_STATE_SCHEMA_VERSION,
    ...binding,
    selectionPolicy: versionReference(state.selectionPolicy, "selectionPolicy"),
    humanReviewBinding: versionReference(state.humanReviewBinding, "humanReviewBinding"),
    requestProfile: versionReference(state.requestProfile, "requestProfile"),
    outputCommitment: state.outputCommitment as `sha256:${string}`,
    scopeCommitment: state.scopeCommitment as `sha256:${string}`,
    inconclusiveReleaseAllowed: state.inconclusiveReleaseAllowed,
    resultSemantics,
    resultOutcome,
    resultCommitment,
    releaseDisposition,
  };
}

async function resolveServerState(
  resolver: HumanReviewGateServerStateResolver,
  lookup: { workspaceId: string; integrationId: string; opportunityId: string },
) {
  if (!resolver || typeof resolver.resolve !== "function") {
    serviceError(
      "A trusted review-gate server-state resolver is required.",
      "review_gate_server_state_unavailable",
      503,
      true,
    );
  }
  const normalizedLookup = {
    workspaceId: identifier(lookup.workspaceId, "workspaceId", invalidBinding),
    integrationId: identifier(lookup.integrationId, "integrationId", invalidBinding),
    opportunityId: identifier(lookup.opportunityId, "opportunityId", invalidBinding),
  };
  const state = normalizeServerState(await resolver.resolve(Object.freeze(normalizedLookup)));
  if (
    state.workspaceId !== normalizedLookup.workspaceId ||
    state.integrationId !== normalizedLookup.integrationId ||
    state.opportunityId !== normalizedLookup.opportunityId
  ) {
    serverStateMismatch("Resolved review-gate state does not match the exact lookup binding.");
  }
  return state;
}

function canonicalBinding(payload: HumanReviewGatePayload): HumanReviewGateBinding {
  return normalizeBinding({
    workspaceId: payload.workspaceId,
    integrationId: payload.integrationId,
    agentId: payload.agentId,
    agentVersionId: payload.agentVersionId,
    scopeId: payload.scopeId,
    opportunityId: payload.opportunityId,
    lifecycle: { state: payload.lifecycleState, revision: payload.lifecycleRevision },
    references: {
      operationKey: payload.operationKey,
      requestReference: payload.requestReference,
      resultReference: payload.resultReference,
    },
    reviewDecision: payload.reviewDecision,
    terminalDisposition: payload.terminalDisposition,
  });
}

function payloadCore(payload: Omit<HumanReviewGatePayload, "evidenceCommitment">) {
  return {
    schemaVersion: HUMAN_REVIEW_GATE_EVIDENCE_SCHEMA_VERSION,
    signatureVersion: SIGNATURE_VERSION,
    payload,
  };
}

function exactIso(value: unknown, field: string) {
  if (typeof value !== "string") invalidEvidence(`${field} must be a canonical ISO-8601 timestamp.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    invalidEvidence(`${field} must be a canonical ISO-8601 timestamp.`);
  }
  return value;
}

function publicKeyBytes(publicKey: KeyObject) {
  if (publicKey.asymmetricKeyType !== "ed25519") {
    serviceError(
      "Review-gate evidence requires an Ed25519 key.",
      "review_gate_evidence_signing_unavailable",
      503,
      true,
    );
  }
  return publicKey.export({ format: "der", type: "spki" });
}

function derivedKeyId(publicKey: KeyObject) {
  return `ed25519:${createHash("sha256").update(publicKeyBytes(publicKey)).digest("hex").slice(0, 24)}`;
}

function parsePrivateKey(encoded: string) {
  try {
    const key = encoded.includes("BEGIN PRIVATE KEY")
      ? createPrivateKey(encoded)
      : createPrivateKey({ key: Buffer.from(encoded, "base64url"), format: "der", type: "pkcs8" });
    if (key.asymmetricKeyType !== "ed25519") throw new Error("wrong key type");
    return key;
  } catch {
    serviceError("The evidence signing key is invalid.", "review_gate_evidence_signing_unavailable", 503, true);
  }
}

function signingPrivateKey() {
  if (testConfig?.signingPrivateKey) return testConfig.signingPrivateKey;
  const encoded = process.env.TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY?.trim();
  if (!encoded) {
    serviceError("Review-gate evidence signing is unavailable.", "review_gate_evidence_signing_unavailable", 503, true);
  }
  return parsePrivateKey(encoded);
}

function currentSigningKey() {
  const privateKey = signingPrivateKey();
  const publicKey = createPublicKey(privateKey);
  const keyId = derivedKeyId(publicKey);
  const configuredKeyId = process.env.TOKENLESS_EVIDENCE_SIGNING_KEY_ID?.trim();
  if (!testConfig && configuredKeyId && configuredKeyId !== keyId) {
    serviceError(
      "The evidence signing key ID does not match its public-key fingerprint.",
      "review_gate_evidence_signing_unavailable",
      503,
      true,
    );
  }
  return { privateKey, publicKey, keyId };
}

function configuredCurrentVerificationKey() {
  if (testConfig) return testConfig.signingPrivateKey ? currentSigningKey() : null;
  return process.env.TOKENLESS_EVIDENCE_SIGNING_PRIVATE_KEY?.trim() ? currentSigningKey() : null;
}

function parseConfiguredVerificationKeys(): VerificationKey[] {
  const encoded = process.env.TOKENLESS_EVIDENCE_VERIFICATION_KEYS?.trim();
  if (!encoded) return [];
  try {
    const value = JSON.parse(encoded) as unknown;
    if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error("invalid keyring");
    return value.map((entry, index) => {
      const item = record(entry, `verification key ${index}`);
      exactKeys(item, ["algorithm", "keyId", "publicKey", "status"], `verification key ${index}`);
      if (
        item.algorithm !== "Ed25519" ||
        (item.status !== "current" && item.status !== "retired") ||
        typeof item.keyId !== "string" ||
        !KEY_ID.test(item.keyId) ||
        typeof item.publicKey !== "string" ||
        !PUBLIC_KEY.test(item.publicKey)
      ) {
        throw new Error("invalid key");
      }
      const publicKey = createPublicKey({
        key: Buffer.from(item.publicKey, "base64url"),
        format: "der",
        type: "spki",
      });
      if (derivedKeyId(publicKey) !== item.keyId) throw new Error("key ID mismatch");
      return { keyId: item.keyId, publicKey, status: item.status };
    });
  } catch {
    serviceError(
      "The evidence verification keyring is invalid.",
      "review_gate_evidence_verification_unavailable",
      503,
      true,
    );
  }
}

function verificationKeys() {
  const values: VerificationKey[] = [];
  if (testConfig?.verificationKeys) {
    for (const entry of testConfig.verificationKeys) {
      const publicKey = entry.publicKey.type === "private" ? createPublicKey(entry.publicKey) : entry.publicKey;
      values.push({ keyId: derivedKeyId(publicKey), publicKey, status: entry.status });
    }
  } else {
    values.push(...parseConfiguredVerificationKeys());
  }
  const current = configuredCurrentVerificationKey();
  if (current) {
    values.push({ keyId: current.keyId, publicKey: current.publicKey, status: "current" });
  }
  if (values.length === 0) {
    serviceError(
      "Review-gate evidence verification is unavailable.",
      "review_gate_evidence_verification_unavailable",
      503,
      true,
    );
  }
  const byId = new Map<string, VerificationKey>();
  for (const value of values) {
    const existing = byId.get(value.keyId);
    if (existing) {
      if (
        existing.status !== value.status ||
        !publicKeyBytes(existing.publicKey).equals(publicKeyBytes(value.publicKey))
      ) {
        serviceError(
          "The evidence verification keyring contains conflicting keys.",
          "review_gate_evidence_verification_unavailable",
          503,
          true,
        );
      }
      continue;
    }
    byId.set(value.keyId, value);
  }
  return byId;
}

function now() {
  return testConfig?.now ? new Date(testConfig.now) : new Date();
}

function nonce() {
  const bytes = testConfig?.nonce ?? randomBytes(24);
  if (bytes.byteLength !== 24) throw new Error("Review-gate test nonce must contain exactly 24 bytes.");
  return Buffer.from(bytes).toString("base64url");
}

function signedDocument(evidence: Pick<HumanReviewGateEvidence, "schemaVersion" | "signing" | "payload">) {
  return canonicalJson(evidence);
}

function trustedKeyring() {
  const keys = [...verificationKeys().values()].map(value => {
    const jwk = value.publicKey.export({ format: "jwk" });
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string") {
      serviceError(
        "The evidence verification keyring contains an invalid Ed25519 key.",
        "review_gate_evidence_verification_unavailable",
        503,
        true,
      );
    }
    return {
      keyId: value.keyId,
      algorithm: "Ed25519" as const,
      publicKeyJwk: { kty: "OKP" as const, crv: "Ed25519" as const, x: jwk.x },
    };
  });
  if (keys.length > 16) {
    serviceError(
      "The evidence verification keyring exceeds the consumer key limit.",
      "review_gate_evidence_verification_unavailable",
      503,
      true,
    );
  }
  return { schemaVersion: "rateloop.stop-gate-trusted-keys.v1" as const, keys };
}

export function projectHumanReviewGateTrustedKeyring() {
  return trustedKeyring();
}

function managedAdvisoryTrustedKeyring() {
  let entries: unknown;
  try {
    entries = JSON.parse(process.env.TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS?.trim() ?? "");
  } catch {
    serviceError(
      "Advisory review-gate verification keys are invalid.",
      "review_gate_evidence_verification_unavailable",
      503,
      true,
    );
  }
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 16) {
    serviceError(
      "Advisory review-gate verification keys are unavailable.",
      "review_gate_evidence_verification_unavailable",
      503,
      true,
    );
  }
  const expectedCurrent = process.env.TOKENLESS_EVIDENCE_SIGNING_KEY_ID?.trim();
  let currentKeyId: string | null = null;
  const seen = new Set<string>();
  const keys = entries.map((entry, index) => {
    const value = record(entry, `advisory verification key ${index}`);
    exactKeys(value, ["algorithm", "keyId", "publicKey", "status"], `advisory verification key ${index}`);
    if (
      value.algorithm !== "ECDSA-SHA256" ||
      typeof value.keyId !== "string" ||
      !/^p256:[0-9a-f]{24}$/u.test(value.keyId) ||
      typeof value.publicKey !== "string" ||
      (value.status !== "current" && value.status !== "retired") ||
      seen.has(value.keyId)
    ) {
      serviceError(
        "Advisory review-gate verification keys are invalid.",
        "review_gate_evidence_verification_unavailable",
        503,
        true,
      );
    }
    let publicKey: KeyObject;
    try {
      publicKey = createPublicKey({ key: Buffer.from(value.publicKey, "base64url"), format: "der", type: "spki" });
    } catch {
      serviceError(
        "Advisory review-gate verification keys are invalid.",
        "review_gate_evidence_verification_unavailable",
        503,
        true,
      );
    }
    const canonical = publicKey!.export({ format: "der", type: "spki" });
    const derived = `p256:${createHash("sha256").update(canonical).digest("hex").slice(0, 24)}`;
    const jwk = publicKey!.export({ format: "jwk" });
    if (
      publicKey!.asymmetricKeyType !== "ec" ||
      publicKey!.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
      derived !== value.keyId ||
      canonical.toString("base64url") !== value.publicKey ||
      jwk.kty !== "EC" ||
      jwk.crv !== "P-256" ||
      typeof jwk.x !== "string" ||
      typeof jwk.y !== "string"
    ) {
      serviceError(
        "Advisory review-gate verification keys are invalid.",
        "review_gate_evidence_verification_unavailable",
        503,
        true,
      );
    }
    seen.add(value.keyId);
    if (value.status === "current") {
      if (currentKeyId) {
        serviceError(
          "Advisory review-gate verification keys are invalid.",
          "review_gate_evidence_verification_unavailable",
          503,
          true,
        );
      }
      currentKeyId = value.keyId;
    }
    return {
      keyId: value.keyId,
      algorithm: "ECDSA-SHA256" as const,
      publicKeyJwk: { kty: "EC" as const, crv: "P-256" as const, x: jwk.x, y: jwk.y },
    };
  });
  if (!expectedCurrent || currentKeyId !== expectedCurrent) {
    serviceError(
      "The current advisory review-gate verification key is invalid.",
      "review_gate_evidence_verification_unavailable",
      503,
      true,
    );
  }
  return { schemaVersion: "rateloop.stop-gate-trusted-keys.v1" as const, keys };
}

export function projectHumanReviewAdvisoryTrustedKeyring() {
  return process.env.TOKENLESS_EVIDENCE_KMS_KEY_RESOURCE?.trim() ? managedAdvisoryTrustedKeyring() : trustedKeyring();
}

export function projectHumanReviewGateTrustedKeyHistory() {
  const keyring = trustedKeyring();
  const statuses = verificationKeys();
  return {
    ...keyring,
    keys: keyring.keys.map(key => ({
      ...key,
      status: statuses.get(key.keyId)?.status ?? "retired",
    })),
  };
}

function advisoryPayloadBytes(evidence: HumanReviewAdvisoryTerminalEvidence) {
  const payload = evidence.payload;
  return Buffer.from(
    JSON.stringify({
      schemaVersion: payload.schemaVersion,
      workspaceId: payload.workspaceId,
      integrationId: payload.integrationId,
      opportunityId: payload.opportunityId,
      terminalStatus: payload.terminalStatus,
      releaseDisposition: payload.releaseDisposition,
      resultSemantics: payload.resultSemantics,
      resultOutcome: payload.resultOutcome,
      resultCommitment: payload.resultCommitment,
      outputCommitment: payload.outputCommitment,
      policyBindingHash: payload.policyBindingHash,
      issuedAt: payload.issuedAt,
    }),
    "utf8",
  );
}

function advisorySkipPayloadBytes(evidence: HumanReviewAdvisorySkipEvidence) {
  const payload = evidence.payload;
  return Buffer.from(
    JSON.stringify({
      schemaVersion: payload.schemaVersion,
      workspaceId: payload.workspaceId,
      integrationId: payload.integrationId,
      opportunityId: payload.opportunityId,
      decision: payload.decision,
      terminalStatus: payload.terminalStatus,
      outputCommitment: payload.outputCommitment,
      policyBindingHash: payload.policyBindingHash,
      scopeCommitment: payload.scopeCommitment,
      issuedAt: payload.issuedAt,
    }),
    "utf8",
  );
}

async function signAdvisoryDocument(document: Uint8Array) {
  if (process.env.TOKENLESS_EVIDENCE_KMS_KEY_RESOURCE?.trim() && !testConfig) {
    const signer = createConfiguredAwsKmsEvidenceSigner();
    const metadata = await signer.metadata();
    return { keyId: metadata.keyId, signature: await signer.sign(document) };
  }
  const signer = currentSigningKey();
  return {
    keyId: signer.keyId,
    signature: sign(null, document, signer.privateKey).toString("base64url"),
  };
}

export async function issueHumanReviewAdvisorySkipEvidence(input: {
  resolver: HumanReviewGateServerStateResolver;
  expected: {
    workspaceId: string;
    integrationId: string;
    opportunityId: string;
    lifecycleRevision: number;
    outputCommitment: string;
    policyBindingHash: string;
    scopeCommitment: string;
  };
}): Promise<HumanReviewAdvisorySkipEvidence> {
  const expected = record(input.expected, "advisory skip evidence expectation");
  exactKeys(
    expected,
    [
      "workspaceId",
      "integrationId",
      "opportunityId",
      "lifecycleRevision",
      "outputCommitment",
      "policyBindingHash",
      "scopeCommitment",
    ],
    "advisory skip evidence expectation",
    invalidBinding,
  );
  const state = await resolveServerState(input.resolver, {
    workspaceId: String(expected.workspaceId),
    integrationId: String(expected.integrationId),
    opportunityId: String(expected.opportunityId),
  });
  if (
    !Number.isSafeInteger(expected.lifecycleRevision) ||
    state.lifecycle.revision !== expected.lifecycleRevision ||
    state.outputCommitment !== expected.outputCommitment ||
    state.humanReviewBinding.hash !== expected.policyBindingHash ||
    state.scopeCommitment !== expected.scopeCommitment ||
    state.lifecycle.state !== "skipped" ||
    (state.reviewDecision !== "skip" && state.reviewDecision !== "recommended")
  ) {
    serverStateMismatch("Advisory skip evidence expectations do not match resolved review-gate state.");
  }
  const evidence: HumanReviewAdvisorySkipEvidence = {
    schemaVersion: HUMAN_REVIEW_ADVISORY_SKIP_EVIDENCE_SCHEMA_VERSION,
    keyId: "",
    payload: {
      schemaVersion: HUMAN_REVIEW_ADVISORY_SKIP_PAYLOAD_SCHEMA_VERSION,
      workspaceId: state.workspaceId,
      integrationId: state.integrationId,
      opportunityId: state.opportunityId,
      decision: "skipped",
      terminalStatus: "skipped",
      outputCommitment: state.outputCommitment,
      policyBindingHash: state.humanReviewBinding.hash,
      scopeCommitment: state.scopeCommitment,
      issuedAt: now().toISOString(),
    },
    signature: "",
  };
  const signed = await signAdvisoryDocument(advisorySkipPayloadBytes(evidence));
  evidence.keyId = signed.keyId;
  evidence.signature = signed.signature;
  return evidence;
}

export async function issueHumanReviewAdvisoryTerminalEvidence(input: {
  resolver: HumanReviewGateServerStateResolver;
  expected: {
    workspaceId: string;
    integrationId: string;
    opportunityId: string;
    lifecycleRevision: number;
    outputCommitment: string;
    policyBindingHash: string;
  };
}): Promise<HumanReviewAdvisoryTerminalEvidence> {
  const expected = record(input.expected, "advisory evidence expectation");
  exactKeys(
    expected,
    ["workspaceId", "integrationId", "opportunityId", "lifecycleRevision", "outputCommitment", "policyBindingHash"],
    "advisory evidence expectation",
    invalidBinding,
  );
  const state = await resolveServerState(input.resolver, {
    workspaceId: String(expected.workspaceId),
    integrationId: String(expected.integrationId),
    opportunityId: String(expected.opportunityId),
  });
  if (
    !Number.isSafeInteger(expected.lifecycleRevision) ||
    state.lifecycle.revision !== expected.lifecycleRevision ||
    state.outputCommitment !== expected.outputCommitment ||
    state.humanReviewBinding.hash !== expected.policyBindingHash
  ) {
    serverStateMismatch("Advisory evidence expectations do not match resolved review-gate state.");
  }
  if (
    state.lifecycle.state !== "completed" &&
    state.lifecycle.state !== "inconclusive" &&
    state.lifecycle.state !== "failed_terminal" &&
    state.lifecycle.state !== "cancelled_before_commit"
  ) {
    serverStateMismatch("Advisory terminal evidence requires an exact terminal review lifecycle.");
  }
  const evidence: HumanReviewAdvisoryTerminalEvidence = {
    schemaVersion: HUMAN_REVIEW_ADVISORY_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    keyId: "",
    payload: {
      schemaVersion: HUMAN_REVIEW_ADVISORY_TERMINAL_PAYLOAD_SCHEMA_VERSION,
      workspaceId: state.workspaceId,
      integrationId: state.integrationId,
      opportunityId: state.opportunityId,
      terminalStatus: state.lifecycle.state,
      releaseDisposition: state.releaseDisposition,
      resultSemantics: state.resultSemantics,
      resultOutcome: state.resultOutcome,
      resultCommitment: state.resultCommitment,
      outputCommitment: state.outputCommitment,
      policyBindingHash: state.humanReviewBinding.hash,
      issuedAt: now().toISOString(),
    },
    signature: "",
  };
  const signed = await signAdvisoryDocument(advisoryPayloadBytes(evidence));
  evidence.keyId = signed.keyId;
  evidence.signature = signed.signature;
  return evidence;
}

function parseHostReleaseRequest(value: unknown): HumanReviewHostReleaseRequest {
  const request = record(value, "host release request");
  exactKeys(request, HOST_REQUEST_KEYS, "host release request", invalidBinding);
  if (request.schemaVersion !== "rateloop.host-output-release-request.v1") {
    invalidBinding("Host release request schemaVersion is unsupported.");
  }
  for (const field of ["releaseId", "hostId", "gateId", "workspaceId", "integrationId", "opportunityId"]) {
    if (typeof request[field] !== "string" || !HOST_OPAQUE_IDENTIFIER.test(request[field])) {
      invalidBinding(`Host release request ${field} is invalid.`);
    }
  }
  for (const field of ["sessionId", "turnId"]) {
    if (typeof request[field] !== "string" || !HOST_LOCAL_IDENTIFIER.test(request[field])) {
      invalidBinding(`Host release request ${field} is invalid.`);
    }
  }
  for (const field of ["outputCommitment", "policyBindingHash", "scopeCommitment"]) {
    if (typeof request[field] !== "string" || !HASH.test(request[field])) {
      invalidBinding(`Host release request ${field} is invalid.`);
    }
  }
  if (request.decision !== "satisfied" && request.decision !== "skipped") {
    invalidBinding("Host release request decision is unsupported.");
  }
  if (typeof request.nonce !== "string" || !HOST_NONCE.test(request.nonce)) {
    invalidBinding("Host release request nonce is invalid.");
  }
  const createdAt = exactIso(request.createdAt, "createdAt");
  const expiresAt = exactIso(request.expiresAt, "expiresAt");
  if (
    Date.parse(expiresAt) <= Date.parse(createdAt) ||
    Date.parse(expiresAt) - Date.parse(createdAt) > MAX_HOST_REQUEST_LIFETIME_MS ||
    Date.parse(createdAt) > now().getTime() + MAX_CLOCK_SKEW_MS ||
    now().getTime() >= Date.parse(expiresAt)
  ) {
    invalidBinding("Host release request lifetime is invalid or expired.");
  }
  return request as unknown as HumanReviewHostReleaseRequest;
}

function hostBindingCommitment(request: HumanReviewHostReleaseRequest) {
  return sha256(request);
}

function hostReleasePayloadBytes(evidence: HumanReviewHostReleaseEvidence) {
  const payload = evidence.payload;
  return Buffer.from(
    JSON.stringify({
      schemaVersion: payload.schemaVersion,
      releaseId: payload.releaseId,
      workspaceId: payload.workspaceId,
      integrationId: payload.integrationId,
      opportunityId: payload.opportunityId,
      decision: payload.decision,
      terminalStatus: payload.terminalStatus,
      releaseDisposition: payload.releaseDisposition,
      resultSemantics: payload.resultSemantics,
      resultOutcome: payload.resultOutcome,
      resultCommitment: payload.resultCommitment,
      outputCommitment: payload.outputCommitment,
      policyBindingHash: payload.policyBindingHash,
      scopeCommitment: payload.scopeCommitment,
      hostBindingCommitment: payload.hostBindingCommitment,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
    }),
    "utf8",
  );
}

export async function issueHumanReviewHostReleaseEvidence(input: {
  resolver: HumanReviewGateServerStateResolver;
  request: unknown;
  hostBindingCommitment: string;
}): Promise<HumanReviewHostReleaseEvidence> {
  const request = parseHostReleaseRequest(input.request);
  const expectedHostBinding = hostBindingCommitment(request);
  if (!HASH.test(input.hostBindingCommitment) || input.hostBindingCommitment !== expectedHostBinding) {
    serverStateMismatch("The supplied host binding commitment does not match the exact host release request.");
  }
  const state = await resolveServerState(input.resolver, request);
  if (
    state.outputCommitment !== request.outputCommitment ||
    state.humanReviewBinding.hash !== request.policyBindingHash ||
    state.scopeCommitment !== request.scopeCommitment
  ) {
    serverStateMismatch("Host release commitments do not match independently resolved review-gate state.");
  }
  const skipped = request.decision === "skipped" && state.lifecycle.state === "skipped";
  const satisfied = request.decision === "satisfied" && state.releaseDisposition === "authorized_positive";
  if (!skipped && !satisfied) {
    serverStateMismatch("Resolved review-gate state does not authorize the requested host release decision.");
  }
  const issuedAt = now();
  const expiresAt = new Date(Math.min(issuedAt.getTime() + EVIDENCE_TTL_MS, Date.parse(request.expiresAt)));
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    serverStateMismatch("The host release request expires before evidence can be issued.");
  }
  const signer = currentSigningKey();
  const evidence: HumanReviewHostReleaseEvidence = {
    schemaVersion: HUMAN_REVIEW_HOST_RELEASE_EVIDENCE_SCHEMA_VERSION,
    keyId: signer.keyId,
    payload: {
      schemaVersion: HUMAN_REVIEW_HOST_RELEASE_PAYLOAD_SCHEMA_VERSION,
      releaseId: request.releaseId,
      workspaceId: state.workspaceId,
      integrationId: state.integrationId,
      opportunityId: state.opportunityId,
      decision: request.decision,
      terminalStatus: skipped ? "skipped" : "completed",
      releaseDisposition: skipped ? "selection_skipped" : "authorized_positive",
      resultSemantics: state.resultSemantics,
      resultOutcome: skipped ? null : "positive",
      resultCommitment: skipped ? null : state.resultCommitment,
      outputCommitment: state.outputCommitment,
      policyBindingHash: state.humanReviewBinding.hash,
      scopeCommitment: state.scopeCommitment,
      hostBindingCommitment: expectedHostBinding,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    signature: "",
  };
  evidence.signature = sign(null, hostReleasePayloadBytes(evidence), signer.privateKey).toString("base64url");
  return evidence;
}

/**
 * Signs only the compact gate binding read by trusted server code from
 * RateLoop state. Callers must never map host/model claims or request content
 * into this input; the exact-key validator deliberately leaves no field for
 * them. The receipt is evidence about review-gate state, not a model, host, or
 * output attestation.
 */
function issueHumanReviewGateEvidence(bindingValue: unknown): HumanReviewGateEvidence {
  const binding = normalizeBinding(bindingValue);
  const issuedAt = now();
  const expiresAt = new Date(issuedAt.getTime() + EVIDENCE_TTL_MS);
  const unsignedPayload = {
    schemaVersion: HUMAN_REVIEW_GATE_PAYLOAD_SCHEMA_VERSION,
    assertion: "rateloop_server_review_gate_state" as const,
    workspaceId: binding.workspaceId,
    integrationId: binding.integrationId,
    agentId: binding.agentId,
    agentVersionId: binding.agentVersionId,
    scopeId: binding.scopeId,
    opportunityId: binding.opportunityId,
    lifecycleState: binding.lifecycle.state,
    lifecycleRevision: binding.lifecycle.revision,
    operationKey: binding.references.operationKey,
    requestReference: binding.references.requestReference,
    resultReference: binding.references.resultReference,
    reviewDecision: binding.reviewDecision,
    terminalDisposition: binding.terminalDisposition,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nonce: nonce(),
  };
  const payload: HumanReviewGatePayload = {
    ...unsignedPayload,
    evidenceCommitment: sha256(payloadCore(unsignedPayload)),
  };
  const signer = currentSigningKey();
  const evidence = {
    schemaVersion: HUMAN_REVIEW_GATE_EVIDENCE_SCHEMA_VERSION,
    signing: { algorithm: "Ed25519" as const, keyId: signer.keyId, version: SIGNATURE_VERSION },
    payload,
  };
  return {
    ...evidence,
    signature: sign(null, Buffer.from(signedDocument(evidence)), signer.privateKey).toString("base64url"),
  };
}

function parseEvidence(value: unknown): HumanReviewGateEvidence {
  const root = record(value, "review-gate evidence");
  exactKeys(root, ["schemaVersion", "signing", "payload", "signature"], "review-gate evidence");
  if (root.schemaVersion !== HUMAN_REVIEW_GATE_EVIDENCE_SCHEMA_VERSION) {
    invalidEvidence("Review-gate evidence schemaVersion is unsupported.");
  }
  const signingValue = record(root.signing, "signing");
  exactKeys(signingValue, ["algorithm", "keyId", "version"], "signing");
  if (
    signingValue.algorithm !== "Ed25519" ||
    signingValue.version !== SIGNATURE_VERSION ||
    typeof signingValue.keyId !== "string" ||
    !KEY_ID.test(signingValue.keyId)
  ) {
    invalidEvidence("Review-gate signing algorithm, version, or key ID is unsupported.");
  }
  if (typeof root.signature !== "string" || !SIGNATURE.test(root.signature)) {
    invalidEvidence("Review-gate evidence signature is invalid.");
  }
  const payloadValue = record(root.payload, "payload");
  exactKeys(payloadValue, PAYLOAD_KEYS, "payload");
  if (
    payloadValue.schemaVersion !== HUMAN_REVIEW_GATE_PAYLOAD_SCHEMA_VERSION ||
    payloadValue.assertion !== "rateloop_server_review_gate_state"
  ) {
    invalidEvidence("Review-gate payload schema or assertion is unsupported.");
  }
  if (typeof payloadValue.nonce !== "string" || !NONCE.test(payloadValue.nonce)) {
    invalidEvidence("Review-gate evidence nonce is invalid.");
  }
  if (typeof payloadValue.evidenceCommitment !== "string" || !HASH.test(payloadValue.evidenceCommitment)) {
    invalidEvidence("Review-gate evidence commitment is invalid.");
  }
  const issuedAt = exactIso(payloadValue.issuedAt, "issuedAt");
  const expiresAt = exactIso(payloadValue.expiresAt, "expiresAt");
  if (Date.parse(expiresAt) - Date.parse(issuedAt) !== EVIDENCE_TTL_MS) {
    invalidEvidence("Review-gate evidence lifetime is invalid.");
  }
  const binding = normalizeBinding({
    workspaceId: payloadValue.workspaceId,
    integrationId: payloadValue.integrationId,
    agentId: payloadValue.agentId,
    agentVersionId: payloadValue.agentVersionId,
    scopeId: payloadValue.scopeId,
    opportunityId: payloadValue.opportunityId,
    lifecycle: { state: payloadValue.lifecycleState, revision: payloadValue.lifecycleRevision },
    references: {
      operationKey: payloadValue.operationKey,
      requestReference: payloadValue.requestReference,
      resultReference: payloadValue.resultReference,
    },
    reviewDecision: payloadValue.reviewDecision,
    terminalDisposition: payloadValue.terminalDisposition,
  });
  const unsignedPayload = {
    schemaVersion: HUMAN_REVIEW_GATE_PAYLOAD_SCHEMA_VERSION,
    assertion: "rateloop_server_review_gate_state" as const,
    workspaceId: binding.workspaceId,
    integrationId: binding.integrationId,
    agentId: binding.agentId,
    agentVersionId: binding.agentVersionId,
    scopeId: binding.scopeId,
    opportunityId: binding.opportunityId,
    lifecycleState: binding.lifecycle.state,
    lifecycleRevision: binding.lifecycle.revision,
    operationKey: binding.references.operationKey,
    requestReference: binding.references.requestReference,
    resultReference: binding.references.resultReference,
    reviewDecision: binding.reviewDecision,
    terminalDisposition: binding.terminalDisposition,
    issuedAt,
    expiresAt,
    nonce: payloadValue.nonce,
  };
  const payload: HumanReviewGatePayload = {
    ...unsignedPayload,
    evidenceCommitment: payloadValue.evidenceCommitment as `sha256:${string}`,
  };
  if (payload.evidenceCommitment !== sha256(payloadCore(unsignedPayload))) {
    invalidEvidence("Review-gate evidence commitment does not match its exact payload.");
  }
  return {
    schemaVersion: HUMAN_REVIEW_GATE_EVIDENCE_SCHEMA_VERSION,
    signing: {
      algorithm: "Ed25519",
      keyId: signingValue.keyId,
      version: SIGNATURE_VERSION,
    },
    payload,
    signature: root.signature,
  };
}

export function verifyHumanReviewGateEvidence(input: {
  evidence: unknown;
  expected: unknown;
  replayGuard?: HumanReviewGateEvidenceReplayGuard;
}): { evidence: HumanReviewGateEvidence; keyStatus: VerificationKeyStatus } {
  const evidence = parseEvidence(input.evidence);
  const key = verificationKeys().get(evidence.signing.keyId);
  if (!key)
    invalidEvidence("The review-gate evidence signing key is not trusted.", "review_gate_evidence_key_untrusted");
  const document = { schemaVersion: evidence.schemaVersion, signing: evidence.signing, payload: evidence.payload };
  if (
    !verify(null, Buffer.from(signedDocument(document)), key.publicKey, Buffer.from(evidence.signature, "base64url"))
  ) {
    invalidEvidence("Review-gate evidence signature verification failed.");
  }
  const expected = normalizeBinding(input.expected);
  if (canonicalJson(canonicalBinding(evidence.payload)) !== canonicalJson(expected)) {
    invalidEvidence("Review-gate evidence does not match the expected server-known binding or lifecycle revision.");
  }
  const currentTime = now().getTime();
  if (Date.parse(evidence.payload.issuedAt) > currentTime + 30_000) {
    invalidEvidence("Review-gate evidence was issued in the future.");
  }
  if (Date.parse(evidence.payload.expiresAt) <= currentTime) {
    invalidEvidence("Review-gate evidence has expired.", "review_gate_evidence_expired");
  }
  if (
    input.replayGuard &&
    !input.replayGuard.consume({
      nonce: evidence.payload.nonce,
      evidenceCommitment: evidence.payload.evidenceCommitment,
      expiresAt: evidence.payload.expiresAt,
    })
  ) {
    invalidEvidence("Review-gate evidence was already consumed.", "review_gate_evidence_replayed");
  }
  return { evidence, keyStatus: key.status };
}

export function __setHumanReviewGateEvidenceConfigForTests(value: TestConfig | null) {
  testConfig = value;
}

export const __humanReviewGateEvidenceTestUtils = {
  canonicalJson,
  derivedKeyId,
  issueGenericEvidence: issueHumanReviewGateEvidence,
  parseConfiguredVerificationKeys,
};
