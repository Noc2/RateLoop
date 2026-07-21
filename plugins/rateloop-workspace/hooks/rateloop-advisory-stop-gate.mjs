#!/usr/bin/env node

import { createPublicKey, verify } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const STATE_SCHEMA = "rateloop.advisory-stop-gate.v2";
const CONNECTION_SCHEMA = "rateloop.advisory-connection-state.v1";
const EVIDENCE_SCHEMA = "rateloop.human-review-terminal-evidence.v2";
const PAYLOAD_SCHEMA = "rateloop.human-review-terminal-payload.v2";
const SKIP_EVIDENCE_SCHEMA = "rateloop.human-review-skip-release-evidence.v1";
const SKIP_PAYLOAD_SCHEMA = "rateloop.human-review-skip-release-payload.v1";
const KEYRING_SCHEMA = "rateloop.stop-gate-trusted-keys.v1";
const CONTRACT_DIRECTORY = "review-stop-gate-v1";
const MAX_FILE_BYTES = 64 * 1024;
const LOCAL_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const KEY_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const OPAQUE_IDENTIFIER = /^[A-Za-z0-9._:-]{8,200}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{80,128}$/;
const NONTERMINAL_STATES = new Set([
  "approval_required",
  "request_ready",
  "pending",
  "blocked",
]);
const TERMINAL_STATES = new Set([
  "completed",
  "inconclusive",
  "failed_terminal",
  "cancelled_before_commit",
]);
const STATE_KEYS = [
  "schemaVersion",
  "armed",
  "sessionId",
  "turnId",
  "gateId",
  "workspaceId",
  "integrationId",
  "opportunityId",
  "lifecycle",
  "lifecycleRevision",
  "lifecycleTerminal",
  "outputCommitment",
  "policyBindingHash",
  "scopeCommitment",
  "armedAt",
  "expiresAt",
  "lastToolUseId",
  "envelopeCommitment",
  "terminalEvidence",
];
const CONNECTION_KEYS = [
  "schemaVersion",
  "active",
  "workspaceId",
  "integrationId",
  "setupSessionId",
  "setupTurnId",
  "verifiedAt",
  "lastToolUseId",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_FILE_BYTES) throw new Error("hook_input_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readBoundedJson(path, contractRoot) {
  const [rootPath, filePath, metadata] = await Promise.all([
    realpath(contractRoot),
    realpath(path),
    lstat(path),
  ]);
  const relativePath = relative(rootPath, filePath);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new Error("state_path_invalid");
  }
  const bytes = await readFile(path);
  if (bytes.length > MAX_FILE_BYTES) throw new Error("state_file_too_large");
  return JSON.parse(bytes.toString("utf8"));
}

function emit(output) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function block(code, message) {
  emit({
    continue: false,
    stopReason: `RateLoop advisory review gate: ${code}`,
    systemMessage: message,
  });
}

function validateStopInput(value) {
  if (!isRecord(value) || value.hook_event_name !== "Stop") return null;
  if (
    !LOCAL_IDENTIFIER.test(value.session_id) ||
    !LOCAL_IDENTIFIER.test(value.turn_id)
  )
    return null;
  return { sessionId: value.session_id, turnId: value.turn_id };
}

export function validateAdvisoryConnectionState(value) {
  if (
    !exactKeys(value, CONNECTION_KEYS) ||
    value.schemaVersion !== CONNECTION_SCHEMA ||
    value.active !== true
  ) {
    throw new Error("connection_state_shape_invalid");
  }
  for (const field of ["workspaceId", "integrationId"]) {
    if (!OPAQUE_IDENTIFIER.test(value[field]))
      throw new Error("connection_state_identifier_invalid");
  }
  for (const field of ["setupSessionId", "setupTurnId", "lastToolUseId"]) {
    if (!LOCAL_IDENTIFIER.test(value[field]))
      throw new Error("connection_state_local_identifier_invalid");
  }
  if (!isIsoDate(value.verifiedAt))
    throw new Error("connection_state_time_invalid");
  return value;
}

export function validateAdvisoryGateState(value, input, options = {}) {
  if (!exactKeys(value, STATE_KEYS) || value.schemaVersion !== STATE_SCHEMA) {
    throw new Error("state_shape_invalid");
  }
  if (typeof value.armed !== "boolean") throw new Error("state_armed_invalid");
  if (
    value.sessionId !== input.sessionId ||
    (!options.allowPriorTurn && value.turnId !== input.turnId)
  ) {
    throw new Error("state_session_turn_mismatch");
  }
  for (const field of ["sessionId", "turnId", "lastToolUseId"]) {
    if (!LOCAL_IDENTIFIER.test(value[field]))
      throw new Error("state_local_identifier_invalid");
  }
  for (const field of [
    "gateId",
    "workspaceId",
    "integrationId",
    "opportunityId",
  ]) {
    if (!OPAQUE_IDENTIFIER.test(value[field]))
      throw new Error("state_opaque_identifier_invalid");
  }
  if (
    !Number.isSafeInteger(value.lifecycleRevision) ||
    value.lifecycleRevision < 1 ||
    value.lifecycleRevision > 2_147_483_647 ||
    typeof value.lifecycleTerminal !== "boolean"
  ) {
    throw new Error("state_lifecycle_revision_invalid");
  }
  const recognized =
    value.lifecycle === "skipped" ||
    NONTERMINAL_STATES.has(value.lifecycle) ||
    TERMINAL_STATES.has(value.lifecycle);
  if (!recognized) throw new Error("state_lifecycle_invalid");
  if (
    value.lifecycleTerminal !==
    (value.lifecycle === "skipped" || TERMINAL_STATES.has(value.lifecycle))
  ) {
    throw new Error("state_terminal_flag_invalid");
  }
  if (value.lifecycle === "skipped") {
    if (
      (value.armed &&
        (value.terminalEvidence !== null || value.scopeCommitment !== null)) ||
      (!value.armed &&
        (!isRecord(value.terminalEvidence) ||
          !SHA256.test(value.scopeCommitment)))
    ) {
      throw new Error("state_armed_lifecycle_mismatch");
    }
  } else if (!value.armed || value.scopeCommitment !== null) {
    throw new Error("state_armed_lifecycle_mismatch");
  }
  if (
    !SHA256.test(value.outputCommitment) ||
    !SHA256.test(value.policyBindingHash)
  ) {
    throw new Error("state_commitment_invalid");
  }
  if (!SHA256.test(value.envelopeCommitment))
    throw new Error("state_envelope_commitment_invalid");
  if (!isIsoDate(value.armedAt) || !isIsoDate(value.expiresAt))
    throw new Error("state_time_invalid");
  if (Date.parse(value.expiresAt) <= Date.parse(value.armedAt))
    throw new Error("state_expiry_invalid");
  if (value.terminalEvidence !== null && !isRecord(value.terminalEvidence)) {
    throw new Error("state_terminal_evidence_invalid");
  }
  return value;
}

export function advisoryTerminalPayload(evidence) {
  const payload = evidence.payload;
  if (evidence.schemaVersion === SKIP_EVIDENCE_SCHEMA) {
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

function validateTerminalEvidence(evidence, state) {
  if (
    !exactKeys(evidence, ["schemaVersion", "keyId", "payload", "signature"])
  ) {
    throw new Error("terminal_evidence_shape_invalid");
  }
  if (!KEY_IDENTIFIER.test(evidence.keyId)) {
    throw new Error("terminal_evidence_schema_invalid");
  }
  if (!BASE64URL_SIGNATURE.test(evidence.signature))
    throw new Error("terminal_signature_invalid");
  const payload = evidence.payload;
  if (evidence.schemaVersion === SKIP_EVIDENCE_SCHEMA) {
    const payloadKeys = [
      "schemaVersion",
      "workspaceId",
      "integrationId",
      "opportunityId",
      "decision",
      "terminalStatus",
      "outputCommitment",
      "policyBindingHash",
      "scopeCommitment",
      "issuedAt",
    ];
    if (
      !exactKeys(payload, payloadKeys) ||
      payload.schemaVersion !== SKIP_PAYLOAD_SCHEMA ||
      payload.workspaceId !== state.workspaceId ||
      payload.integrationId !== state.integrationId ||
      payload.opportunityId !== state.opportunityId ||
      payload.decision !== "skipped" ||
      payload.terminalStatus !== "skipped" ||
      payload.outputCommitment !== state.outputCommitment ||
      payload.policyBindingHash !== state.policyBindingHash ||
      payload.scopeCommitment !== state.scopeCommitment ||
      !SHA256.test(payload.scopeCommitment) ||
      !isIsoDate(payload.issuedAt)
    ) {
      throw new Error("terminal_binding_mismatch");
    }
    if (Date.parse(payload.issuedAt) < Date.parse(state.armedAt))
      throw new Error("terminal_evidence_stale");
    if (Date.parse(payload.issuedAt) > Date.now() + 300_000)
      throw new Error("terminal_evidence_from_future");
    return evidence;
  }
  if (evidence.schemaVersion !== EVIDENCE_SCHEMA) {
    throw new Error("terminal_evidence_schema_invalid");
  }
  const payloadKeys = [
    "schemaVersion",
    "workspaceId",
    "integrationId",
    "opportunityId",
    "terminalStatus",
    "releaseDisposition",
    "resultSemantics",
    "resultOutcome",
    "resultCommitment",
    "outputCommitment",
    "policyBindingHash",
    "issuedAt",
  ];
  if (
    !exactKeys(payload, payloadKeys) ||
    payload.schemaVersion !== PAYLOAD_SCHEMA
  ) {
    throw new Error("terminal_payload_invalid");
  }
  if (
    payload.workspaceId !== state.workspaceId ||
    payload.integrationId !== state.integrationId ||
    payload.opportunityId !== state.opportunityId ||
    payload.terminalStatus !== state.lifecycle ||
    payload.outputCommitment !== state.outputCommitment ||
    payload.policyBindingHash !== state.policyBindingHash
  ) {
    throw new Error("terminal_binding_mismatch");
  }
  const resultShape =
    (payload.resultOutcome === null && payload.resultCommitment === null) ||
    (new Set([
      "positive",
      "negative",
      "inconclusive",
      "failed",
      "cancelled",
    ]).has(payload.resultOutcome) &&
      SHA256.test(payload.resultCommitment));
  const authorizedPositive =
    payload.terminalStatus === "completed" &&
    payload.releaseDisposition === "authorized_positive" &&
    payload.resultSemantics === "assurance" &&
    payload.resultOutcome === "positive" &&
    SHA256.test(payload.resultCommitment);
  if (
    !new Set(["authorized_positive", "not_authorized"]).has(
      payload.releaseDisposition,
    ) ||
    !new Set(["assurance", "feedback"]).has(payload.resultSemantics) ||
    !resultShape ||
    (payload.releaseDisposition === "authorized_positive") !==
      authorizedPositive
  ) {
    throw new Error("terminal_release_disposition_invalid");
  }
  if (
    !TERMINAL_STATES.has(payload.terminalStatus) ||
    !isIsoDate(payload.issuedAt)
  ) {
    throw new Error("terminal_payload_invalid");
  }
  if (Date.parse(payload.issuedAt) < Date.parse(state.armedAt))
    throw new Error("terminal_evidence_stale");
  if (Date.parse(payload.issuedAt) > Date.now() + 300_000)
    throw new Error("terminal_evidence_from_future");
  return evidence;
}

function validateKeyring(value, keyId) {
  if (
    !exactKeys(value, ["schemaVersion", "keys"]) ||
    value.schemaVersion !== KEYRING_SCHEMA ||
    !Array.isArray(value.keys) ||
    value.keys.length < 1 ||
    value.keys.length > 16
  ) {
    throw new Error("trusted_keyring_invalid");
  }
  const seen = new Set();
  let candidate = null;
  for (const key of value.keys) {
    const ed25519 =
      key?.algorithm === "Ed25519" &&
      exactKeys(key.publicKeyJwk, ["kty", "crv", "x"]) &&
      key.publicKeyJwk.kty === "OKP" &&
      key.publicKeyJwk.crv === "Ed25519" &&
      typeof key.publicKeyJwk.x === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(key.publicKeyJwk.x);
    const p256 =
      key?.algorithm === "ECDSA-SHA256" &&
      exactKeys(key.publicKeyJwk, ["kty", "crv", "x", "y"]) &&
      key.publicKeyJwk.kty === "EC" &&
      key.publicKeyJwk.crv === "P-256" &&
      typeof key.publicKeyJwk.x === "string" &&
      typeof key.publicKeyJwk.y === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(key.publicKeyJwk.x) &&
      /^[A-Za-z0-9_-]{43}$/.test(key.publicKeyJwk.y);
    if (
      !exactKeys(key, ["keyId", "algorithm", "publicKeyJwk"]) ||
      !KEY_IDENTIFIER.test(key.keyId) ||
      (!ed25519 && !p256) ||
      seen.has(key.keyId)
    ) {
      throw new Error("trusted_key_invalid");
    }
    seen.add(key.keyId);
    if (key.keyId === keyId) candidate = key;
  }
  if (!candidate) throw new Error("trusted_key_missing");
  return candidate;
}

export async function verifyAdvisoryTerminalEvidence(
  evidence,
  state,
  pluginData,
) {
  const validated = validateTerminalEvidence(evidence, state);
  const contractRoot = join(pluginData, CONTRACT_DIRECTORY);
  const keyring = await readBoundedJson(
    join(contractRoot, "trusted-keys.json"),
    contractRoot,
  );
  const publicKey = createPublicKey({
    key: validateKeyring(keyring, validated.keyId).publicKeyJwk,
    format: "jwk",
  });
  const trustedKey = validateKeyring(keyring, validated.keyId);
  if (
    !verify(
      trustedKey.algorithm === "ECDSA-SHA256" ? "sha256" : null,
      advisoryTerminalPayload(validated),
      publicKey,
      Buffer.from(validated.signature, "base64url"),
    )
  ) {
    throw new Error("terminal_signature_invalid");
  }
  return validated;
}

async function main() {
  let input;
  try {
    input = validateStopInput(JSON.parse(await readStdin()));
  } catch {
    return;
  }
  if (!input) return;
  const pluginData = process.env.PLUGIN_DATA ?? process.env.CLAUDE_PLUGIN_DATA;
  if (!pluginData) return;
  const contractRoot = join(pluginData, CONTRACT_DIRECTORY);
  const connectionPath = join(contractRoot, "connection.json");
  const statePath = join(contractRoot, "sessions", `${input.sessionId}.json`);
  let connection = null;
  try {
    connection = validateAdvisoryConnectionState(
      await readBoundedJson(connectionPath, contractRoot),
    );
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
    ) {
      block(
        "connection_state_invalid_recovery_required",
        "Advisory RateLoop connection state is unreadable or invalid. Re-verify the connection through RateLoop before releasing another output; plugin trust is not host enforcement.",
      );
      return;
    }
  }
  let state;
  try {
    state = validateAdvisoryGateState(
      await readBoundedJson(statePath, contractRoot),
      input,
      {
        allowPriorTurn: true,
      },
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      if (!connection) return;
      if (
        connection.setupSessionId === input.sessionId &&
        connection.setupTurnId === input.turnId
      ) {
        return;
      }
      block(
        "evaluation_missing",
        "This connected RateLoop plugin has no current-turn review evaluation. Call rateloop_get_agent_context and rateloop_evaluate_review_requirement before releasing an eligible output. This advisory hook can be disabled and is not host enforcement.",
      );
      return;
    }
    block(
      "state_invalid_recovery_required",
      "Advisory RateLoop review state is unreadable, invalid, or bound to another turn. A trusted host must refresh or explicitly disarm it; plugin trust is not host enforcement.",
    );
    return;
  }

  if (
    connection &&
    (connection.workspaceId !== state.workspaceId ||
      connection.integrationId !== state.integrationId)
  ) {
    block(
      "connection_review_binding_mismatch_recovery_required",
      "The current advisory review state belongs to a different RateLoop connection. Re-evaluate this output with the active connection before release.",
    );
    return;
  }

  if (state.turnId !== input.turnId) {
    if (
      connection?.setupSessionId === input.sessionId &&
      connection.setupTurnId === input.turnId
    ) {
      return;
    }
    if (connection) {
      block(
        "evaluation_missing",
        "This connected RateLoop plugin has no current-turn review evaluation. Evaluate this output, or resume the prior armed review with the RateLoop progress tools, before release. This advisory hook can be disabled and is not host enforcement.",
      );
      return;
    }
    block(
      "armed_state_turn_mismatch_recovery_required",
      "An advisory RateLoop gate remains armed for a prior turn. Resume that exact review opportunity or use the separately authorized recovery path before releasing this output.",
    );
    return;
  }

  if (!state.armed) {
    try {
      const evidence = await verifyAdvisoryTerminalEvidence(
        state.terminalEvidence,
        state,
        pluginData,
      );
      if (
        evidence.schemaVersion === SKIP_EVIDENCE_SCHEMA &&
        evidence.payload.terminalStatus === "skipped"
      ) {
        return;
      }
    } catch {
      // Fall through to the fail-closed recovery response below.
    }
    block(
      "skip_release_evidence_invalid_recovery_required",
      "RateLoop selection skip release evidence is missing, mismatched, or not signed by a trusted key. Refresh the exact opportunity or use the separately authorized recovery path.",
    );
    return;
  }
  if (state.terminalEvidence) {
    try {
      const evidence = await verifyAdvisoryTerminalEvidence(
        state.terminalEvidence,
        state,
        pluginData,
      );
      if (
        evidence.payload.terminalStatus === "completed" &&
        evidence.payload.releaseDisposition === "authorized_positive"
      )
        return;
      block(
        `terminal_${evidence.payload.releaseDisposition}_does_not_release`,
        "RateLoop signed this terminal result, but it does not explicitly authorize the candidate. Negative, feedback, inconclusive, failed, and cancelled results remain held.",
      );
      return;
    } catch {
      block(
        "terminal_evidence_invalid_recovery_required",
        "Advisory RateLoop terminal evidence is mismatched or not signed by a trusted key. Fetch the terminal result again or use the separately authorized owner recovery path.",
      );
      return;
    }
  }
  if (state.lifecycleTerminal) {
    if (state.lifecycle === "skipped") {
      block(
        "skip_release_evidence_missing_recovery_required",
        "RateLoop selected a skip but no matching signed skip release evidence is available. Refresh the exact opportunity or use the separately authorized recovery path.",
      );
      return;
    }
    block(
      "terminal_evidence_missing_recovery_required",
      "RateLoop reported a terminal lifecycle without signed terminal evidence. The advisory gate remains armed until signed evidence or separately authorized recovery is recorded.",
    );
    return;
  }
  if (Date.now() >= Date.parse(state.expiresAt)) {
    block(
      "state_expired_recovery_required",
      "The advisory RateLoop gate expired while review was still required or pending. Time does not authorize release; re-evaluate, fetch signed terminal evidence, or use authorized recovery.",
    );
    return;
  }
  block(
    `review_${state.lifecycle}`,
    "RateLoop review is required or pending. Complete the owner-approval or authorized route and fetch signed terminal evidence before treating the output as reviewed.",
  );
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedUrl === import.meta.url) {
  main().catch(() => {
    block(
      "hook_failure_recovery_required",
      "The advisory RateLoop Stop gate failed safely. A trusted host must repair or explicitly disarm it before this output can be treated as reviewed.",
    );
  });
}
