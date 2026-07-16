#!/usr/bin/env node

import { createPublicKey, verify } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const STATE_SCHEMA = "rateloop.stop-gate.v1";
const TERMINAL_SCHEMA = "rateloop.stop-gate-terminal.v1";
const KEYRING_SCHEMA = "rateloop.stop-gate-trusted-keys.v1";
const CONTRACT_DIRECTORY = "review-stop-gate-v1";
const MAX_INPUT_BYTES = 64 * 1024;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const KEY_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const OPAQUE_IDENTIFIER = /^[A-Za-z0-9._:-]{8,200}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const BLOCKING_LIFECYCLES = new Set(["approval_required", "request_ready", "pending", "blocked"]);
const TERMINAL_STATUSES = new Set([
  "completed",
  "inconclusive",
  "failed_terminal",
  "cancelled_before_commit",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function exactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error("hook_input_too_large");
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
  if (metadata.isSymbolicLink() || !metadata.isFile() || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("state_path_invalid");
  }
  const bytes = await readFile(path);
  if (bytes.length > MAX_INPUT_BYTES) throw new Error("state_file_too_large");
  return JSON.parse(bytes.toString("utf8"));
}

function stop(output) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function block(code, message) {
  stop({
    continue: false,
    stopReason: `RateLoop review gate: ${code}`,
    systemMessage: message,
  });
}

function validateHookInput(value) {
  if (!isRecord(value)) return null;
  if (value.hook_event_name !== "Stop") return null;
  if (typeof value.session_id !== "string" || !IDENTIFIER.test(value.session_id)) return null;
  if (typeof value.turn_id !== "string" || !IDENTIFIER.test(value.turn_id)) return null;
  return { sessionId: value.session_id, turnId: value.turn_id };
}

function validateArmedState(value, input) {
  const keys = [
    "schemaVersion",
    "armed",
    "sessionId",
    "turnId",
    "gateId",
    "opportunityId",
    "lifecycle",
    "outputCommitment",
    "policyBindingHash",
    "armedAt",
    "expiresAt",
    "terminalEvidence",
  ];
  if (!exactKeys(value, keys)) throw new Error("state_shape_invalid");
  if (value.schemaVersion !== STATE_SCHEMA || value.armed !== true) throw new Error("state_schema_invalid");
  if (value.sessionId !== input.sessionId || value.turnId !== input.turnId) throw new Error("state_binding_mismatch");
  if (!OPAQUE_IDENTIFIER.test(value.gateId) || !OPAQUE_IDENTIFIER.test(value.opportunityId)) {
    throw new Error("state_identifier_invalid");
  }
  if (!BLOCKING_LIFECYCLES.has(value.lifecycle)) throw new Error("state_lifecycle_invalid");
  if (!SHA256.test(value.outputCommitment) || !SHA256.test(value.policyBindingHash)) {
    throw new Error("state_commitment_invalid");
  }
  if (!isIsoDate(value.armedAt) || !isIsoDate(value.expiresAt)) throw new Error("state_time_invalid");
  if (Date.parse(value.expiresAt) <= Date.parse(value.armedAt)) throw new Error("state_expiry_invalid");
  if (value.terminalEvidence !== null && !isRecord(value.terminalEvidence)) {
    throw new Error("terminal_evidence_shape_invalid");
  }
  return value;
}

function isExplicitlyDisarmed(value, sessionId) {
  return (
    exactKeys(value, ["schemaVersion", "armed", "sessionId"]) &&
    value.schemaVersion === STATE_SCHEMA &&
    value.armed === false &&
    value.sessionId === sessionId
  );
}

function validateTerminalEvidence(evidence, state) {
  const keys = [
    "schemaVersion",
    "gateId",
    "sessionId",
    "opportunityId",
    "terminalStatus",
    "outputCommitment",
    "policyBindingHash",
    "issuedAt",
    "keyId",
    "signature",
  ];
  if (!exactKeys(evidence, keys)) throw new Error("terminal_evidence_shape_invalid");
  if (evidence.schemaVersion !== TERMINAL_SCHEMA) throw new Error("terminal_evidence_schema_invalid");
  if (
    evidence.gateId !== state.gateId ||
    evidence.sessionId !== state.sessionId ||
    evidence.opportunityId !== state.opportunityId ||
    evidence.outputCommitment !== state.outputCommitment ||
    evidence.policyBindingHash !== state.policyBindingHash
  ) {
    throw new Error("terminal_evidence_binding_mismatch");
  }
  if (!TERMINAL_STATUSES.has(evidence.terminalStatus)) throw new Error("terminal_status_invalid");
  if (!isIsoDate(evidence.issuedAt) || Date.parse(evidence.issuedAt) < Date.parse(state.armedAt)) {
    throw new Error("terminal_evidence_time_invalid");
  }
  if (!KEY_IDENTIFIER.test(evidence.keyId) || !BASE64URL_SIGNATURE.test(evidence.signature)) {
    throw new Error("terminal_evidence_signature_invalid");
  }
  return evidence;
}

export function terminalEvidencePayload(evidence) {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: evidence.schemaVersion,
      gateId: evidence.gateId,
      sessionId: evidence.sessionId,
      opportunityId: evidence.opportunityId,
      terminalStatus: evidence.terminalStatus,
      outputCommitment: evidence.outputCommitment,
      policyBindingHash: evidence.policyBindingHash,
      issuedAt: evidence.issuedAt,
    }),
    "utf8",
  );
}

function validateKeyring(value, keyId) {
  if (
    !exactKeys(value, ["schemaVersion", "keys"]) ||
    value.schemaVersion !== KEYRING_SCHEMA ||
    !Array.isArray(value.keys)
  ) {
    throw new Error("trusted_keyring_invalid");
  }
  if (value.keys.length < 1 || value.keys.length > 16) throw new Error("trusted_keyring_invalid");
  const seen = new Set();
  let candidate = null;
  for (const key of value.keys) {
    if (
      !exactKeys(key, ["keyId", "algorithm", "publicKeyJwk"]) ||
      !KEY_IDENTIFIER.test(key.keyId) ||
      key.algorithm !== "Ed25519" ||
      !exactKeys(key.publicKeyJwk, ["kty", "crv", "x"]) ||
      key.publicKeyJwk.kty !== "OKP" ||
      key.publicKeyJwk.crv !== "Ed25519" ||
      typeof key.publicKeyJwk.x !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(key.publicKeyJwk.x) ||
      seen.has(key.keyId)
    ) {
      throw new Error("trusted_key_invalid");
    }
    seen.add(key.keyId);
    if (key.keyId === keyId) candidate = key.publicKeyJwk;
  }
  if (!candidate) throw new Error("trusted_key_missing");
  return candidate;
}

async function verifyTerminalEvidence(evidence, state, pluginData) {
  const validated = validateTerminalEvidence(evidence, state);
  const contractRoot = join(pluginData, CONTRACT_DIRECTORY);
  const keyringPath = join(contractRoot, "trusted-keys.json");
  const keyring = await readBoundedJson(keyringPath, contractRoot);
  const jwk = validateKeyring(keyring, validated.keyId);
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const signature = Buffer.from(validated.signature, "base64url");
  if (!verify(null, terminalEvidencePayload(validated), publicKey, signature)) {
    throw new Error("terminal_evidence_signature_invalid");
  }
}

async function main() {
  let input;
  try {
    input = validateHookInput(JSON.parse(await readStdin()));
  } catch {
    return;
  }
  if (!input) return;

  const pluginData = process.env.PLUGIN_DATA ?? process.env.CLAUDE_PLUGIN_DATA;
  if (!pluginData) return;

  const contractRoot = join(pluginData, CONTRACT_DIRECTORY);
  const statePath = join(contractRoot, "sessions", `${input.sessionId}.json`);
  let rawState;
  try {
    rawState = await readBoundedJson(statePath, contractRoot);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    block(
      "state_invalid_recovery_required",
      "RateLoop review enforcement state is unreadable. A trusted host must repair or explicitly disarm the gate; plugin trust alone is not host enforcement.",
    );
    return;
  }

  if (isExplicitlyDisarmed(rawState, input.sessionId)) return;

  let state;
  try {
    state = validateArmedState(rawState, input);
  } catch {
    block(
      "state_invalid_recovery_required",
      "RateLoop review enforcement state is invalid or mismatched. A trusted host must write a fresh evaluation or explicitly authorized disarm.",
    );
    return;
  }

  if (state.terminalEvidence) {
    try {
      await verifyTerminalEvidence(state.terminalEvidence, state, pluginData);
      return;
    } catch {
      block(
        "terminal_evidence_invalid_recovery_required",
        "RateLoop terminal evidence is missing, mismatched, or not signed by a trusted key. Fetch the result again or use the separately authorized owner recovery path.",
      );
      return;
    }
  }

  if (Date.now() >= Date.parse(state.expiresAt)) {
    block(
      "state_expired_recovery_required",
      "RateLoop review is still required, but the local gate state expired. Time does not authorize release; obtain fresh signed terminal evidence, re-evaluate, or use the separately authorized owner recovery path.",
    );
    return;
  }

  block(
    `review_${state.lifecycle}`,
    "RateLoop review is required or pending. Complete the owner-approval or authorized review route, then resume from the durable continuation and fetch the signed terminal result.",
  );
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedUrl === import.meta.url) {
  main().catch(() => {
    block(
      "hook_failure_recovery_required",
      "The RateLoop Stop gate failed safely. A trusted host must repair or explicitly disarm it before this output can be treated as enforced.",
    );
  });
}
