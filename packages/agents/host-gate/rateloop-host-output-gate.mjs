import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

export const HOST_RELEASE_REQUEST_SCHEMA =
  "rateloop.host-output-release-request.v1";
export const HOST_RELEASE_EVIDENCE_SCHEMA =
  "rateloop.host-output-release-evidence.v2";
export const HOST_RELEASE_PAYLOAD_SCHEMA =
  "rateloop.host-output-release-payload.v2";
export const HOST_RELEASE_RECEIPT_SCHEMA =
  "rateloop.host-output-release-receipt.v2";
export const TRUSTED_KEYRING_SCHEMA = "rateloop.stop-gate-trusted-keys.v1";

const MAX_CONTROL_FILE_BYTES = 64 * 1024;
const MAX_CANDIDATE_BYTES = 64 * 1024 * 1024;
const MAX_REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const LOCAL_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const KEY_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const OPAQUE_IDENTIFIER = /^[A-Za-z0-9._:-]{8,200}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const BASE64URL_SIGNATURE = /^[A-Za-z0-9_-]{86}$/;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
const RELEASE_DECISIONS = new Set(["satisfied", "skipped"]);
const REQUEST_KEYS = [
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
];
const PAYLOAD_KEYS = [
  "schemaVersion",
  "releaseId",
  "workspaceId",
  "integrationId",
  "opportunityId",
  "decision",
  "terminalStatus",
  "releaseDisposition",
  "resultSemantics",
  "resultOutcome",
  "resultCommitment",
  "outputCommitment",
  "policyBindingHash",
  "scopeCommitment",
  "hostBindingCommitment",
  "issuedAt",
  "expiresAt",
];
const RECEIPT_KEYS = [
  "schemaVersion",
  "releaseId",
  "workspaceId",
  "integrationId",
  "opportunityId",
  "decision",
  "releaseDisposition",
  "resultSemantics",
  "resultOutcome",
  "resultCommitment",
  "outputCommitment",
  "policyBindingHash",
  "scopeCommitment",
  "hostBindingCommitment",
  "evidenceCommitment",
  "releasedAt",
];

function failure(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

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

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha256Json(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

function timestamp(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function assertRequestIdentifiers(value) {
  for (const field of [
    "releaseId",
    "hostId",
    "gateId",
    "workspaceId",
    "integrationId",
    "opportunityId",
  ]) {
    if (!OPAQUE_IDENTIFIER.test(value[field]))
      throw failure(`request_${field}_invalid`);
  }
  for (const field of ["sessionId", "turnId"]) {
    if (!LOCAL_IDENTIFIER.test(value[field]))
      throw failure(`request_${field}_invalid`);
  }
}

export function parseHostReleaseRequest(value, now = new Date()) {
  if (
    !exactKeys(value, REQUEST_KEYS) ||
    value.schemaVersion !== HOST_RELEASE_REQUEST_SCHEMA
  ) {
    throw failure("request_shape_invalid");
  }
  assertRequestIdentifiers(value);
  if (!RELEASE_DECISIONS.has(value.decision))
    throw failure("request_decision_invalid");
  for (const field of [
    "outputCommitment",
    "policyBindingHash",
    "scopeCommitment",
  ]) {
    if (!SHA256.test(value[field])) throw failure(`request_${field}_invalid`);
  }
  if (!NONCE.test(value.nonce)) throw failure("request_nonce_invalid");
  if (!isIsoDate(value.createdAt) || !isIsoDate(value.expiresAt))
    throw failure("request_time_invalid");
  const createdAt = Date.parse(value.createdAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (
    expiresAt <= createdAt ||
    expiresAt - createdAt > MAX_REQUEST_LIFETIME_MS ||
    createdAt > timestamp(now) + MAX_CLOCK_SKEW_MS
  ) {
    throw failure("request_time_invalid");
  }
  if (timestamp(now) >= expiresAt) throw failure("request_expired");
  return value;
}

export function hostBindingPayload(request) {
  return {
    schemaVersion: request.schemaVersion,
    releaseId: request.releaseId,
    hostId: request.hostId,
    sessionId: request.sessionId,
    turnId: request.turnId,
    gateId: request.gateId,
    workspaceId: request.workspaceId,
    integrationId: request.integrationId,
    opportunityId: request.opportunityId,
    decision: request.decision,
    outputCommitment: request.outputCommitment,
    policyBindingHash: request.policyBindingHash,
    scopeCommitment: request.scopeCommitment,
    nonce: request.nonce,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
  };
}

export function hostBindingCommitment(request) {
  return sha256Json(hostBindingPayload(request));
}

export function serverReleaseEvidencePayload(evidence) {
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

function parseKeyring(value, keyId) {
  if (
    !exactKeys(value, ["schemaVersion", "keys"]) ||
    value.schemaVersion !== TRUSTED_KEYRING_SCHEMA ||
    !Array.isArray(value.keys) ||
    value.keys.length < 1 ||
    value.keys.length > 16
  ) {
    throw failure("trusted_keyring_invalid");
  }
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
      throw failure("trusted_key_invalid");
    }
    seen.add(key.keyId);
    if (key.keyId === keyId) candidate = key.publicKeyJwk;
  }
  if (!candidate) throw failure("trusted_key_missing");
  return candidate;
}

function parseReleaseEvidence(value, request, now) {
  if (
    !exactKeys(value, ["schemaVersion", "keyId", "payload", "signature"]) ||
    value.schemaVersion !== HOST_RELEASE_EVIDENCE_SCHEMA ||
    !KEY_IDENTIFIER.test(value.keyId) ||
    !BASE64URL_SIGNATURE.test(value.signature)
  ) {
    throw failure("release_evidence_shape_invalid");
  }
  const payload = value.payload;
  if (
    !exactKeys(payload, PAYLOAD_KEYS) ||
    payload.schemaVersion !== HOST_RELEASE_PAYLOAD_SCHEMA
  ) {
    throw failure("release_payload_shape_invalid");
  }
  for (const field of [
    "releaseId",
    "workspaceId",
    "integrationId",
    "opportunityId",
  ]) {
    if (!OPAQUE_IDENTIFIER.test(payload[field]))
      throw failure(`release_${field}_invalid`);
  }
  for (const field of [
    "outputCommitment",
    "policyBindingHash",
    "scopeCommitment",
    "hostBindingCommitment",
  ]) {
    if (!SHA256.test(payload[field])) throw failure(`release_${field}_invalid`);
  }
  if (!RELEASE_DECISIONS.has(payload.decision))
    throw failure("release_decision_invalid");
  if (
    (payload.decision === "satisfied" &&
      (payload.terminalStatus !== "completed" ||
        payload.releaseDisposition !== "authorized_positive" ||
        payload.resultSemantics !== "assurance" ||
        payload.resultOutcome !== "positive" ||
        !SHA256.test(payload.resultCommitment))) ||
    (payload.decision === "skipped" &&
      (payload.terminalStatus !== "skipped" ||
        payload.releaseDisposition !== "selection_skipped" ||
        !new Set(["assurance", "feedback"]).has(payload.resultSemantics) ||
        payload.resultOutcome !== null ||
        payload.resultCommitment !== null))
  ) {
    throw failure("release_disposition_invalid");
  }
  if (!isIsoDate(payload.issuedAt) || !isIsoDate(payload.expiresAt)) {
    throw failure("release_time_invalid");
  }
  const issuedAt = Date.parse(payload.issuedAt);
  const evidenceExpiresAt = Date.parse(payload.expiresAt);
  const requestCreatedAt = Date.parse(request.createdAt);
  const requestExpiresAt = Date.parse(request.expiresAt);
  if (
    evidenceExpiresAt <= issuedAt ||
    evidenceExpiresAt > requestExpiresAt ||
    issuedAt + MAX_CLOCK_SKEW_MS < requestCreatedAt ||
    issuedAt > timestamp(now) + MAX_CLOCK_SKEW_MS
  ) {
    throw failure("release_time_invalid");
  }
  if (timestamp(now) >= evidenceExpiresAt)
    throw failure("release_evidence_expired");
  const expectedBindings = {
    releaseId: request.releaseId,
    workspaceId: request.workspaceId,
    integrationId: request.integrationId,
    opportunityId: request.opportunityId,
    decision: request.decision,
    releaseDisposition: payload.releaseDisposition,
    resultSemantics: payload.resultSemantics,
    resultOutcome: payload.resultOutcome,
    resultCommitment: payload.resultCommitment,
    outputCommitment: request.outputCommitment,
    policyBindingHash: request.policyBindingHash,
    scopeCommitment: request.scopeCommitment,
    hostBindingCommitment: hostBindingCommitment(request),
  };
  for (const [field, expected] of Object.entries(expectedBindings)) {
    if (payload[field] !== expected) throw failure(`release_${field}_mismatch`);
  }
  return value;
}

export function buildHostReleaseRequest(
  input,
  candidateBytes,
  now = new Date(),
) {
  const createdAt = new Date(now).toISOString();
  const lifetimeMs = input.lifetimeMs ?? 15 * 60 * 1_000;
  if (
    !Number.isSafeInteger(lifetimeMs) ||
    lifetimeMs < 30_000 ||
    lifetimeMs > MAX_REQUEST_LIFETIME_MS
  ) {
    throw failure("request_lifetime_invalid");
  }
  const request = {
    schemaVersion: HOST_RELEASE_REQUEST_SCHEMA,
    releaseId:
      input.releaseId ?? `release_${randomBytes(24).toString("base64url")}`,
    hostId: input.hostId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    gateId: input.gateId,
    workspaceId: input.workspaceId,
    integrationId: input.integrationId,
    opportunityId: input.opportunityId,
    decision: input.decision,
    outputCommitment: sha256Bytes(candidateBytes),
    policyBindingHash: input.policyBindingHash,
    scopeCommitment: input.scopeCommitment,
    nonce: input.nonce ?? randomBytes(24).toString("base64url"),
    createdAt,
    expiresAt: new Date(timestamp(now) + lifetimeMs).toISOString(),
  };
  return parseHostReleaseRequest(request, now);
}

export function verifyHostOutputRelease({
  request: inputRequest,
  evidence: inputEvidence,
  trustedKeys,
  candidateBytes,
  now = new Date(),
}) {
  const request = parseHostReleaseRequest(inputRequest, now);
  if (sha256Bytes(candidateBytes) !== request.outputCommitment)
    throw failure("candidate_output_mismatch");
  const evidence = parseReleaseEvidence(inputEvidence, request, now);
  const publicKeyJwk = parseKeyring(trustedKeys, evidence.keyId);
  const publicKey = createPublicKey({ key: publicKeyJwk, format: "jwk" });
  if (
    !verify(
      null,
      serverReleaseEvidencePayload(evidence),
      publicKey,
      Buffer.from(evidence.signature, "base64url"),
    )
  ) {
    throw failure("release_signature_invalid");
  }
  return {
    request,
    evidence,
    hostBindingCommitment: hostBindingCommitment(request),
    evidenceCommitment: sha256Json(evidence),
  };
}

export async function readBoundedRegularFile(
  path,
  maximumBytes = MAX_CONTROL_FILE_BYTES,
  { ownerOnly = false } = {},
) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw failure("input_file_invalid");
    const currentUid =
      typeof process.getuid === "function" ? process.getuid() : null;
    if (
      ownerOnly &&
      ((currentUid !== null && metadata.uid !== currentUid) ||
        (metadata.mode & 0o077) !== 0)
    ) {
      throw failure("input_file_not_host_owned");
    }
    if (metadata.size > maximumBytes) throw failure("input_file_too_large");
    return await handle.readFile();
  } catch (error) {
    if (error?.code === "ELOOP") throw failure("input_file_symlink_forbidden");
    throw error;
  } finally {
    await handle?.close();
  }
}

async function ensureTrustedDirectory(path, { create = false } = {}) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    (currentUid !== null && metadata.uid !== currentUid) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw failure("release_directory_not_host_owned");
  }
  return realpath(path);
}

async function assertOutsideForbiddenRoots(stateRoot, forbiddenRoots) {
  for (const root of forbiddenRoots) {
    let forbiddenRoot;
    try {
      forbiddenRoot = await realpath(root);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    const pathFromForbiddenRoot = relative(forbiddenRoot, stateRoot);
    if (
      pathFromForbiddenRoot === "" ||
      (!pathFromForbiddenRoot.startsWith("..") &&
        !isAbsolute(pathFromForbiddenRoot))
    ) {
      throw failure("release_directory_inside_agent_workspace");
    }
  }
}

function receiptFor(verified, releasedAt) {
  const {
    request,
    evidence,
    hostBindingCommitment: binding,
    evidenceCommitment,
  } = verified;
  return {
    schemaVersion: HOST_RELEASE_RECEIPT_SCHEMA,
    releaseId: request.releaseId,
    workspaceId: request.workspaceId,
    integrationId: request.integrationId,
    opportunityId: request.opportunityId,
    decision: request.decision,
    releaseDisposition: evidence.payload.releaseDisposition,
    resultSemantics: evidence.payload.resultSemantics,
    resultOutcome: evidence.payload.resultOutcome,
    resultCommitment: evidence.payload.resultCommitment,
    outputCommitment: request.outputCommitment,
    policyBindingHash: request.policyBindingHash,
    scopeCommitment: request.scopeCommitment,
    hostBindingCommitment: binding,
    evidenceCommitment,
    releasedAt: new Date(releasedAt).toISOString(),
  };
}

function validateExistingReceipt(value, expected) {
  if (
    !exactKeys(value, RECEIPT_KEYS) ||
    value.schemaVersion !== HOST_RELEASE_RECEIPT_SCHEMA
  ) {
    throw failure("release_replay_conflict");
  }
  for (const field of RECEIPT_KEYS.filter((field) => field !== "releasedAt")) {
    if (value[field] !== expected[field])
      throw failure("release_replay_conflict");
  }
  if (!isIsoDate(value.releasedAt)) throw failure("release_replay_conflict");
  return value;
}

async function existingRelease(finalDirectory, verified, candidateBytes) {
  const metadata = await lstat(finalDirectory);
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    (currentUid !== null && metadata.uid !== currentUid) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw failure("release_replay_conflict");
  }
  const directory = await realpath(finalDirectory);
  const [receiptBytes, outputBytes] = await Promise.all([
    readBoundedRegularFile(join(directory, "receipt.json")),
    readBoundedRegularFile(join(directory, "output.bin"), MAX_CANDIDATE_BYTES),
  ]);
  const expected = receiptFor(verified, new Date(0));
  const receipt = validateExistingReceipt(
    JSON.parse(receiptBytes.toString("utf8")),
    expected,
  );
  if (
    sha256Bytes(outputBytes) !== verified.request.outputCommitment ||
    !Buffer.from(outputBytes).equals(Buffer.from(candidateBytes))
  ) {
    throw failure("release_replay_conflict");
  }
  return {
    directory,
    outputPath: join(directory, "output.bin"),
    receiptPath: join(directory, "receipt.json"),
    receipt,
    idempotent: true,
  };
}

export async function materializeAuthorizedOutput({
  request,
  evidence,
  trustedKeys,
  candidateBytes,
  stateDirectory,
  forbiddenRoots = [],
  now = new Date(),
}) {
  const verified = verifyHostOutputRelease({
    request,
    evidence,
    trustedKeys,
    candidateBytes,
    now,
  });
  const stateRoot = await ensureTrustedDirectory(stateDirectory);
  await assertOutsideForbiddenRoots(stateRoot, forbiddenRoots);
  const releasesRoot = await ensureTrustedDirectory(
    join(stateRoot, "releases"),
    { create: true },
  );
  const relativeRoot = relative(stateRoot, releasesRoot);
  if (relativeRoot.startsWith("..") || isAbsolute(relativeRoot))
    throw failure("release_directory_invalid");
  const finalDirectory = join(releasesRoot, verified.request.releaseId);
  try {
    return await existingRelease(finalDirectory, verified, candidateBytes);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporaryDirectory = join(
    releasesRoot,
    `.release-${process.pid}-${randomUUID()}.tmp`,
  );
  await mkdir(temporaryDirectory, { mode: 0o700 });
  const receipt = receiptFor(verified, now);
  try {
    await writeFile(join(temporaryDirectory, "output.bin"), candidateBytes, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(
      join(temporaryDirectory, "receipt.json"),
      `${JSON.stringify(receipt)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    );
    await rename(temporaryDirectory, finalDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
      return existingRelease(finalDirectory, verified, candidateBytes);
    }
    throw error;
  }
  const directory = await realpath(finalDirectory);
  return {
    directory,
    outputPath: join(directory, "output.bin"),
    receiptPath: join(directory, "receipt.json"),
    receipt,
    idempotent: false,
  };
}

export const limits = Object.freeze({
  maxCandidateBytes: MAX_CANDIDATE_BYTES,
  maxControlFileBytes: MAX_CONTROL_FILE_BYTES,
  maxRequestLifetimeMs: MAX_REQUEST_LIFETIME_MS,
});
