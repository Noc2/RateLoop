#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateAdvisoryConnectionState,
  validateAdvisoryGateState,
  verifyAdvisoryTerminalEvidence,
} from "./rateloop-advisory-stop-gate.mjs";

const ENVELOPE_SCHEMA = "rateloop.human-review-tool-envelope.v1";
const STATE_SCHEMA = "rateloop.advisory-stop-gate.v2";
const CONNECTION_SCHEMA = "rateloop.advisory-connection-state.v1";
const CONTRACT_DIRECTORY = "review-stop-gate-v1";
const MAX_FILE_BYTES = 64 * 1024;
const LOCAL_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const OPAQUE_IDENTIFIER = /^[A-Za-z0-9._:-]{8,200}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const TOOL_NAME =
  /^mcp__rateloop[-_]workspace__rateloop_(connect_workspace|verify_connection|evaluate_review_requirement|request_review|wait_for_review|get_review_result)$/;
const CONNECTION_TOOLS = new Set(["connect_workspace", "verify_connection"]);
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
const ROUTE_LANES = new Set([
  "public_paid",
  "private_paid",
  "private_unpaid",
  "hybrid",
]);
const ROUTE_AUTHORITIES = new Set([
  "check_only",
  "prepare_for_approval",
  "ask_automatically",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
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

function warn(code) {
  process.stdout.write(
    `${JSON.stringify({
      systemMessage: `RateLoop advisory state was not updated (${code}). Any prior armed gate is unchanged; do not claim host enforcement.`,
    })}\n`,
  );
}

function validateHookInput(value) {
  if (!isRecord(value) || value.hook_event_name !== "PostToolUse")
    throw new Error("hook_event_invalid");
  if (
    !LOCAL_IDENTIFIER.test(value.session_id) ||
    !LOCAL_IDENTIFIER.test(value.turn_id)
  ) {
    throw new Error("hook_session_invalid");
  }
  if (
    !LOCAL_IDENTIFIER.test(value.tool_use_id) ||
    typeof value.tool_name !== "string"
  ) {
    throw new Error("hook_tool_invalid");
  }
  const match = TOOL_NAME.exec(value.tool_name);
  if (!match) throw new Error("hook_tool_not_supported");
  if (!isRecord(value.tool_input) || !isRecord(value.tool_response))
    throw new Error("hook_tool_shape_invalid");
  if (value.tool_response.isError === true) throw new Error("mcp_tool_failed");
  if (!isRecord(value.tool_response.structuredContent))
    throw new Error("mcp_structured_content_missing");
  return {
    sessionId: value.session_id,
    turnId: value.turn_id,
    toolUseId: value.tool_use_id,
    tool: match[1],
    toolInput: value.tool_input,
    envelope: value.tool_response.structuredContent,
  };
}

function validateVersionedReference(value, field) {
  if (
    !isRecord(value) ||
    !OPAQUE_IDENTIFIER.test(value.id) ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    (field !== "selectionPolicy" && !SHA256.test(value.hash))
  ) {
    throw new Error(`${field}_invalid`);
  }
  return value;
}

function validateEnvelope(value) {
  if (!isRecord(value) || value.schemaVersion !== ENVELOPE_SCHEMA)
    throw new Error("envelope_schema_invalid");
  for (const field of ["workspaceId", "integrationId", "opportunityId"]) {
    if (!OPAQUE_IDENTIFIER.test(value[field]))
      throw new Error("envelope_identifier_invalid");
  }
  if (!isRecord(value.lifecycle)) throw new Error("envelope_lifecycle_invalid");
  const lifecycle = value.lifecycle;
  const recognized =
    lifecycle.state === "skipped" ||
    NONTERMINAL_STATES.has(lifecycle.state) ||
    TERMINAL_STATES.has(lifecycle.state);
  if (
    !recognized ||
    !Number.isSafeInteger(lifecycle.revision) ||
    lifecycle.revision < 1 ||
    lifecycle.revision > 2_147_483_647 ||
    typeof lifecycle.terminal !== "boolean" ||
    lifecycle.terminal !==
      (lifecycle.state === "skipped" || TERMINAL_STATES.has(lifecycle.state)) ||
    !Array.isArray(lifecycle.reasonCodes) ||
    lifecycle.reasonCodes.length > 64 ||
    lifecycle.reasonCodes.some(
      (reason) => typeof reason !== "string" || reason.length > 160,
    ) ||
    !isIsoDate(lifecycle.stateEnteredAt)
  ) {
    throw new Error("envelope_lifecycle_invalid");
  }
  if (!isRecord(value.frozen)) throw new Error("envelope_frozen_invalid");
  const frozen = value.frozen;
  validateVersionedReference(frozen.selectionPolicy, "selectionPolicy");
  validateVersionedReference(frozen.binding, "binding");
  validateVersionedReference(frozen.requestProfile, "requestProfile");
  if (!SHA256.test(frozen.evaluationCommitment))
    throw new Error("evaluation_commitment_invalid");
  if (
    !isRecord(value.route) ||
    !ROUTE_LANES.has(value.route.lane) ||
    !ROUTE_AUTHORITIES.has(value.route.authority)
  ) {
    throw new Error("envelope_route_invalid");
  }
  if (value.continuation !== null) {
    const continuation = value.continuation;
    if (
      !isRecord(continuation) ||
      typeof continuation.cursor !== "string" ||
      continuation.cursor.length < 1 ||
      continuation.cursor.length > 512 ||
      !Number.isSafeInteger(continuation.retryAfterMs) ||
      continuation.retryAfterMs < 0 ||
      continuation.retryAfterMs > 300_000 ||
      !isIsoDate(continuation.expiresAt)
    ) {
      throw new Error("envelope_continuation_invalid");
    }
  }
  if (value.terminalEvidence !== null && !isRecord(value.terminalEvidence)) {
    throw new Error("envelope_terminal_evidence_invalid");
  }
  return value;
}

function validateToolEnvelope(input) {
  const envelope = validateEnvelope(input.envelope);
  if (
    envelope.lifecycle.state === "skipped" &&
    input.tool !== "evaluate_review_requirement"
  ) {
    throw new Error("selection_skip_tool_invalid");
  }
  if (
    envelope.terminalEvidence !== null &&
    input.tool !== "get_review_result" &&
    !(
      input.tool === "evaluate_review_requirement" &&
      envelope.lifecycle.state === "skipped"
    )
  ) {
    throw new Error("terminal_evidence_tool_invalid");
  }
  if (input.tool !== "evaluate_review_requirement") {
    if (input.toolInput.opportunityId !== envelope.opportunityId)
      throw new Error("tool_opportunity_mismatch");
  } else {
    if (!new Set(["required", "recommended", "skip"]).has(envelope.decision)) {
      throw new Error("evaluation_decision_invalid");
    }
    if (
      envelope.lifecycle.state === "skipped" &&
      !new Set(["recommended", "skip"]).has(envelope.decision)
    ) {
      throw new Error("evaluation_skip_invalid");
    }
    if (
      envelope.lifecycle.state !== "skipped" &&
      envelope.decision !== "required"
    ) {
      throw new Error("evaluation_required_invalid");
    }
  }
  if (input.tool === "get_review_result" && !envelope.lifecycle.terminal) {
    throw new Error("result_not_terminal");
  }
  return envelope;
}

function validateConnectionEnvelope(input) {
  const value = input.envelope;
  let verification;
  if (input.tool === "connect_workspace") {
    if (
      value.schemaVersion !== "rateloop.workspace-connection.v1" ||
      value.connected !== true ||
      !isRecord(value.verification)
    ) {
      throw new Error("connection_envelope_invalid");
    }
    verification = value.verification;
  } else if (input.tool === "verify_connection") {
    verification = value;
  } else {
    throw new Error("connection_tool_invalid");
  }
  if (
    verification.schemaVersion !== "rateloop.connection-verification.v1" ||
    !isRecord(verification.connection) ||
    verification.connection.status !== "connected" ||
    !OPAQUE_IDENTIFIER.test(verification.connection.workspaceId) ||
    !OPAQUE_IDENTIFIER.test(verification.connection.integrationId) ||
    !isIsoDate(verification.verifiedAt)
  ) {
    throw new Error("connection_verification_invalid");
  }
  const advisoryGate = verification.advisoryGate;
  if (
    !isRecord(advisoryGate) ||
    advisoryGate.enforcementBoundary !== "advisory"
  ) {
    throw new Error("connection_advisory_gate_invalid");
  }
  const trustedKeys = advisoryGate.trustedKeys;
  if (
    !isRecord(trustedKeys) ||
    trustedKeys.schemaVersion !== "rateloop.stop-gate-trusted-keys.v1" ||
    !Array.isArray(trustedKeys.keys) ||
    trustedKeys.keys.length < 1 ||
    trustedKeys.keys.length > 16
  ) {
    throw new Error("connection_trusted_keys_invalid");
  }
  const seen = new Set();
  for (const key of trustedKeys.keys) {
    const ed25519 =
      key?.algorithm === "Ed25519" &&
      isRecord(key.publicKeyJwk) &&
      key.publicKeyJwk.kty === "OKP" &&
      key.publicKeyJwk.crv === "Ed25519" &&
      typeof key.publicKeyJwk.x === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(key.publicKeyJwk.x) &&
      Object.keys(key.publicKeyJwk).length === 3;
    const p256 =
      key?.algorithm === "ECDSA-SHA256" &&
      isRecord(key.publicKeyJwk) &&
      key.publicKeyJwk.kty === "EC" &&
      key.publicKeyJwk.crv === "P-256" &&
      typeof key.publicKeyJwk.x === "string" &&
      typeof key.publicKeyJwk.y === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(key.publicKeyJwk.x) &&
      /^[A-Za-z0-9_-]{43}$/.test(key.publicKeyJwk.y) &&
      Object.keys(key.publicKeyJwk).length === 4;
    if (
      !isRecord(key) ||
      !OPAQUE_IDENTIFIER.test(key.keyId) ||
      (!ed25519 && !p256) ||
      seen.has(key.keyId)
    ) {
      throw new Error("connection_trusted_keys_invalid");
    }
    seen.add(key.keyId);
  }
  return {
    workspaceId: verification.connection.workspaceId,
    integrationId: verification.connection.integrationId,
    verifiedAt: verification.verifiedAt,
    trustedKeys,
  };
}

function buildConnectionState(input, connection) {
  return {
    schemaVersion: CONNECTION_SCHEMA,
    active: true,
    workspaceId: connection.workspaceId,
    integrationId: connection.integrationId,
    setupSessionId: input.sessionId,
    setupTurnId: input.turnId,
    verifiedAt: connection.verifiedAt,
    lastToolUseId: input.toolUseId,
  };
}

function projectedEnvelope(envelope) {
  return {
    schemaVersion: envelope.schemaVersion,
    workspaceId: envelope.workspaceId,
    integrationId: envelope.integrationId,
    opportunityId: envelope.opportunityId,
    lifecycle: {
      state: envelope.lifecycle.state,
      revision: envelope.lifecycle.revision,
      terminal: envelope.lifecycle.terminal,
      reasonCodes: envelope.lifecycle.reasonCodes,
      stateEnteredAt: envelope.lifecycle.stateEnteredAt,
    },
    frozen: {
      selectionPolicy: {
        id: envelope.frozen.selectionPolicy.id,
        version: envelope.frozen.selectionPolicy.version,
      },
      binding: {
        id: envelope.frozen.binding.id,
        version: envelope.frozen.binding.version,
        hash: envelope.frozen.binding.hash,
      },
      requestProfile: {
        id: envelope.frozen.requestProfile.id,
        version: envelope.frozen.requestProfile.version,
        hash: envelope.frozen.requestProfile.hash,
      },
      evaluationCommitment: envelope.frozen.evaluationCommitment,
    },
    route: { lane: envelope.route.lane, authority: envelope.route.authority },
    continuation:
      envelope.continuation === null
        ? null
        : {
            cursor: envelope.continuation.cursor,
            retryAfterMs: envelope.continuation.retryAfterMs,
            expiresAt: envelope.continuation.expiresAt,
          },
    terminalEvidence: envelope.terminalEvidence,
  };
}

function gateExpiry(envelope) {
  const entered = Date.parse(envelope.lifecycle.stateEnteredAt);
  if (
    envelope.continuation &&
    Date.parse(envelope.continuation.expiresAt) > entered
  ) {
    return envelope.continuation.expiresAt;
  }
  return new Date(entered + 86_400_000).toISOString();
}

function gateId(input, envelope) {
  return `gate_${createHash("sha256")
    .update(
      canonicalJson([
        input.sessionId,
        envelope.workspaceId,
        envelope.integrationId,
        envelope.opportunityId,
        envelope.frozen.evaluationCommitment,
        envelope.frozen.binding.hash,
      ]),
    )
    .digest("hex")
    .slice(0, 48)}`;
}

function buildState(input, envelope, existing, skipReleaseVerified = false) {
  const sameOpportunity = existing?.opportunityId === envelope.opportunityId;
  const projection = projectedEnvelope(envelope);
  const skipEvidence =
    envelope.lifecycle.state === "skipped" &&
    envelope.terminalEvidence?.schemaVersion ===
      "rateloop.human-review-skip-release-evidence.v1"
      ? envelope.terminalEvidence
      : null;
  return {
    schemaVersion: STATE_SCHEMA,
    armed: envelope.lifecycle.state !== "skipped" || !skipReleaseVerified,
    sessionId: input.sessionId,
    turnId: input.turnId,
    gateId: sameOpportunity ? existing.gateId : gateId(input, envelope),
    workspaceId: envelope.workspaceId,
    integrationId: envelope.integrationId,
    opportunityId: envelope.opportunityId,
    lifecycle: envelope.lifecycle.state,
    lifecycleRevision: envelope.lifecycle.revision,
    lifecycleTerminal: envelope.lifecycle.terminal,
    outputCommitment: envelope.frozen.evaluationCommitment,
    policyBindingHash: envelope.frozen.binding.hash,
    scopeCommitment: skipReleaseVerified
      ? skipEvidence.payload.scopeCommitment
      : null,
    armedAt: sameOpportunity
      ? existing.armedAt
      : envelope.lifecycle.stateEnteredAt,
    expiresAt: gateExpiry(envelope),
    lastToolUseId: input.toolUseId,
    envelopeCommitment: sha256(
      envelope.lifecycle.state === "skipped" && !skipReleaseVerified
        ? { ...projection, terminalEvidence: null }
        : projection,
    ),
    terminalEvidence:
      envelope.lifecycle.state === "skipped" && !skipReleaseVerified
        ? null
        : envelope.terminalEvidence,
  };
}

async function readExistingState(statePath, contractRoot, input) {
  try {
    const [rootPath, filePath, metadata] = await Promise.all([
      realpath(contractRoot),
      realpath(statePath),
      lstat(statePath),
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
    const bytes = await readFile(statePath);
    if (bytes.length > MAX_FILE_BYTES) throw new Error("state_file_too_large");
    return validateAdvisoryGateState(
      JSON.parse(bytes.toString("utf8")),
      input,
      { allowPriorTurn: true },
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}

async function readExistingConnectionState(connectionPath, contractRoot) {
  try {
    const [rootPath, filePath, metadata] = await Promise.all([
      realpath(contractRoot),
      realpath(connectionPath),
      lstat(connectionPath),
    ]);
    const relativePath = relative(rootPath, filePath);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      relativePath.startsWith("..") ||
      isAbsolute(relativePath)
    ) {
      throw new Error("connection_state_path_invalid");
    }
    const bytes = await readFile(connectionPath);
    if (bytes.length > MAX_FILE_BYTES)
      throw new Error("connection_state_file_too_large");
    return validateAdvisoryConnectionState(JSON.parse(bytes.toString("utf8")));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}

async function authorizeTransition(input, envelope, existing, pluginData) {
  if (!existing) {
    if (input.tool !== "evaluate_review_requirement")
      throw new Error("evaluation_required_before_update");
    return;
  }
  if (
    existing.workspaceId !== envelope.workspaceId ||
    existing.integrationId !== envelope.integrationId
  ) {
    throw new Error("workspace_integration_mismatch");
  }
  if (existing.opportunityId !== envelope.opportunityId) {
    if (input.tool !== "evaluate_review_requirement")
      throw new Error("opportunity_mismatch");
    if (existing.armed && !existing.terminalEvidence)
      throw new Error("prior_opportunity_still_armed");
    if (existing.terminalEvidence) {
      const evidence = await verifyAdvisoryTerminalEvidence(
        existing.terminalEvidence,
        existing,
        pluginData,
      );
      if (
        evidence.payload.terminalStatus !== "completed" &&
        evidence.payload.terminalStatus !== "skipped"
      ) {
        throw new Error("prior_opportunity_does_not_release");
      }
    }
    return;
  }
  const signedSkipAugmentation =
    existing.armed &&
    existing.lifecycle === "skipped" &&
    existing.lifecycleTerminal &&
    existing.terminalEvidence === null &&
    envelope.lifecycle.state === "skipped" &&
    envelope.terminalEvidence !== null &&
    envelope.lifecycle.revision === existing.lifecycleRevision;
  if (
    existing.armed &&
    envelope.lifecycle.state === "skipped" &&
    !signedSkipAugmentation
  ) {
    throw new Error("armed_opportunity_cannot_be_skipped");
  }
  if (envelope.lifecycle.revision < existing.lifecycleRevision)
    throw new Error("lifecycle_revision_stale");
  if (
    envelope.frozen.evaluationCommitment !== existing.outputCommitment ||
    envelope.frozen.binding.hash !== existing.policyBindingHash
  ) {
    throw new Error("frozen_commitment_mismatch");
  }
  if (envelope.lifecycle.revision === existing.lifecycleRevision) {
    const projection = projectedEnvelope(envelope);
    const exactReplay = sha256(projection) === existing.envelopeCommitment;
    const signedTerminalAugmentation =
      existing.lifecycleTerminal &&
      existing.terminalEvidence === null &&
      envelope.terminalEvidence !== null &&
      sha256({ ...projection, terminalEvidence: null }) ===
        existing.envelopeCommitment;
    if (!exactReplay && !signedTerminalAugmentation) {
      throw new Error("lifecycle_revision_conflict");
    }
  }
}

async function writeStateAtomically(statePath, state) {
  const directory = join(statePath, "..");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const resolvedDirectory = await realpath(directory);
  const relativeStatePath = relative(resolvedDirectory, statePath);
  if (relativeStatePath.startsWith("..") || isAbsolute(relativeStatePath))
    throw new Error("state_path_invalid");
  try {
    const metadata = await lstat(statePath);
    if (metadata.isSymbolicLink() || !metadata.isFile())
      throw new Error("state_path_invalid");
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      )
    )
      throw error;
  }
  const temporary = join(
    resolvedDirectory,
    `.state-${process.pid}-${randomUUID()}.tmp`,
  );
  await writeFile(temporary, `${JSON.stringify(state)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await rename(temporary, statePath);
}

async function main() {
  const pluginData = process.env.PLUGIN_DATA ?? process.env.CLAUDE_PLUGIN_DATA;
  if (!pluginData) {
    warn("plugin_data_unavailable");
    return;
  }
  let input;
  let envelope;
  try {
    input = validateHookInput(JSON.parse(await readStdin()));
  } catch (error) {
    warn(error instanceof Error ? error.message : "tool_result_invalid");
    return;
  }

  let pluginDataRoot;
  try {
    pluginDataRoot = await realpath(pluginData);
  } catch {
    warn("plugin_data_invalid");
    return;
  }
  const contractRoot = join(pluginDataRoot, CONTRACT_DIRECTORY);
  const connectionPath = join(contractRoot, "connection.json");
  const trustedKeysPath = join(contractRoot, "trusted-keys.json");
  const statePath = join(contractRoot, "sessions", `${input.sessionId}.json`);
  try {
    if (CONNECTION_TOOLS.has(input.tool)) {
      const verified = validateConnectionEnvelope(input);
      await writeStateAtomically(trustedKeysPath, verified.trustedKeys);
      let connection;
      try {
        connection = await readExistingConnectionState(
          connectionPath,
          contractRoot,
        );
      } catch {
        connection = null;
      }
      if (
        connection?.workspaceId === verified.workspaceId &&
        connection?.integrationId === verified.integrationId
      ) {
        return;
      }
      await writeStateAtomically(
        connectionPath,
        buildConnectionState(input, verified),
      );
      return;
    }
    const connection = await readExistingConnectionState(
      connectionPath,
      contractRoot,
    );
    envelope = validateToolEnvelope(input);
    if (
      connection &&
      (connection.workspaceId !== envelope.workspaceId ||
        connection.integrationId !== envelope.integrationId)
    ) {
      throw new Error("connection_review_binding_mismatch");
    }
    const existing = await readExistingState(statePath, contractRoot, input);
    await authorizeTransition(input, envelope, existing, pluginDataRoot);
    let state = buildState(input, envelope, existing);
    if (envelope.lifecycle.state === "skipped") {
      if (envelope.terminalEvidence) {
        try {
          const candidate = buildState(input, envelope, existing, true);
          const evidence = await verifyAdvisoryTerminalEvidence(
            candidate.terminalEvidence,
            candidate,
            pluginDataRoot,
          );
          if (evidence.payload.terminalStatus !== "skipped") {
            throw new Error("skip_release_evidence_invalid");
          }
          state = candidate;
        } catch {
          await writeStateAtomically(statePath, state);
          warn("skip_release_evidence_invalid_recovery_required");
          return;
        }
      }
    } else if (state.terminalEvidence) {
      await verifyAdvisoryTerminalEvidence(
        state.terminalEvidence,
        state,
        pluginDataRoot,
      );
    }
    await writeStateAtomically(statePath, state);
    if (state.lifecycle === "skipped" && state.armed) {
      warn("skip_release_evidence_missing_recovery_required");
    }
    if (
      state.armed &&
      state.lifecycleTerminal &&
      state.lifecycle !== "skipped" &&
      !state.terminalEvidence
    ) {
      warn("terminal_evidence_missing_recovery_required");
    }
  } catch (error) {
    warn(error instanceof Error ? error.message : "state_update_failed");
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedUrl === import.meta.url) {
  main().catch(() => warn("state_update_failed"));
}
