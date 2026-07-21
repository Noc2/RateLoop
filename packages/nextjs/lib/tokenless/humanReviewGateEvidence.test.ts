import { verifyAdvisoryTerminalEvidence } from "../../../../plugins/rateloop-workspace/hooks/rateloop-advisory-stop-gate.mjs";
import {
  buildHostReleaseRequest,
  hostBindingCommitment,
  verifyHostOutputRelease,
} from "../../../agents/host-gate/rateloop-host-output-gate.mjs";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
  type HumanReviewGateBinding,
  type HumanReviewGateServerState,
  __humanReviewGateEvidenceTestUtils,
  __setHumanReviewGateEvidenceConfigForTests,
  issueHumanReviewAdvisoryTerminalEvidence,
  issueHumanReviewHostReleaseEvidence,
  projectHumanReviewAdvisoryTrustedKeyring,
  projectHumanReviewGateTrustedKeyHistory,
  projectHumanReviewGateTrustedKeyring,
  verifyHumanReviewGateEvidence,
} from "~~/lib/tokenless/humanReviewGateEvidence";
import { TokenlessServiceError } from "~~/lib/tokenless/server";

const CURRENT = generateKeyPairSync("ed25519");
const RETIRED = generateKeyPairSync("ed25519");
const ROTATED = generateKeyPairSync("ed25519");
const ISSUED_AT = new Date("2026-07-16T12:00:00.000Z");
const originalVerificationKeys = process.env.TOKENLESS_EVIDENCE_VERIFICATION_KEYS;
const originalDecisionPacketVerificationKeys = process.env.TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS;
const originalKmsKeyResource = process.env.TOKENLESS_EVIDENCE_KMS_KEY_RESOURCE;
const originalSigningKeyId = process.env.TOKENLESS_EVIDENCE_SIGNING_KEY_ID;
const issueHumanReviewGateEvidence = __humanReviewGateEvidenceTestUtils.issueGenericEvidence;
const HOST_CANDIDATE = Buffer.from("candidate output held for exact review-gate release", "utf8");
const HASH_OUTPUT = `sha256:${createHash("sha256").update(HOST_CANDIDATE).digest("hex")}` as const;
const HASH_POLICY = `sha256:${"d".repeat(64)}` as const;
const HASH_SCOPE = `sha256:${"e".repeat(64)}` as const;
const HASH_RESULT = `sha256:${"f".repeat(64)}` as const;

function pendingBinding(): HumanReviewGateBinding {
  return {
    workspaceId: "workspace_gate_01",
    integrationId: "integration_gate_01",
    agentId: "agent_gate_01",
    agentVersionId: "version_gate_01",
    scopeId: "scope_gate_01",
    opportunityId: "opportunity_gate_01",
    lifecycle: { state: "pending", revision: 4 },
    references: {
      operationKey: "op_0123456789abcdef",
      requestReference: `sha256:${"a".repeat(64)}`,
      resultReference: null,
    },
    reviewDecision: "required",
    terminalDisposition: null,
  };
}

function completedBinding(): HumanReviewGateBinding {
  return {
    ...pendingBinding(),
    lifecycle: { state: "completed", revision: 5 },
    references: {
      ...pendingBinding().references,
      resultReference: `sha256:${"b".repeat(64)}`,
    },
    terminalDisposition: "completed",
  };
}

function serverState(overrides: Partial<HumanReviewGateServerState> = {}): HumanReviewGateServerState {
  return {
    schemaVersion: "rateloop.human-review-gate-server-state.v1",
    ...completedBinding(),
    selectionPolicy: { id: "selection_policy_01", version: 2, hash: `sha256:${"1".repeat(64)}` },
    humanReviewBinding: { id: "human_review_binding_01", version: 3, hash: HASH_POLICY },
    requestProfile: { id: "request_profile_01", version: 4, hash: `sha256:${"2".repeat(64)}` },
    outputCommitment: HASH_OUTPUT,
    scopeCommitment: HASH_SCOPE,
    inconclusiveReleaseAllowed: false,
    resultSemantics: "assurance",
    resultOutcome: "positive",
    resultCommitment: HASH_RESULT,
    releaseDisposition: "authorized_positive",
    ...overrides,
  };
}

function resolverFor(state: HumanReviewGateServerState) {
  const lookups: Array<{ workspaceId: string; integrationId: string; opportunityId: string }> = [];
  return {
    lookups,
    resolver: {
      async resolve(lookup: { workspaceId: string; integrationId: string; opportunityId: string }) {
        lookups.push(lookup);
        return structuredClone(state);
      },
    },
  };
}

function configure(
  input: {
    signer?: typeof CURRENT.privateKey;
    verificationKeys?: Array<{ publicKey: typeof CURRENT.publicKey; status: "current" | "retired" }>;
    now?: Date;
    nonce?: Buffer;
  } = {},
) {
  __setHumanReviewGateEvidenceConfigForTests({
    signingPrivateKey: input.signer ?? CURRENT.privateKey,
    verificationKeys: input.verificationKeys,
    now: input.now ?? ISSUED_AT,
    nonce: input.nonce ?? Buffer.alloc(24, 7),
  });
}

function assertServiceError(action: () => unknown, code: string, pattern?: RegExp) {
  assert.throws(action, error => {
    assert.ok(error instanceof TokenlessServiceError);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

async function assertServiceErrorAsync(action: () => Promise<unknown>, code: string, pattern?: RegExp) {
  await assert.rejects(action, error => {
    assert.ok(error instanceof TokenlessServiceError);
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

beforeEach(() => configure());

afterEach(() => {
  __setHumanReviewGateEvidenceConfigForTests(null);
  if (originalVerificationKeys === undefined) delete process.env.TOKENLESS_EVIDENCE_VERIFICATION_KEYS;
  else process.env.TOKENLESS_EVIDENCE_VERIFICATION_KEYS = originalVerificationKeys;
  if (originalDecisionPacketVerificationKeys === undefined)
    delete process.env.TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS;
  else process.env.TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS = originalDecisionPacketVerificationKeys;
  if (originalKmsKeyResource === undefined) delete process.env.TOKENLESS_EVIDENCE_KMS_KEY_RESOURCE;
  else process.env.TOKENLESS_EVIDENCE_KMS_KEY_RESOURCE = originalKmsKeyResource;
  if (originalSigningKeyId === undefined) delete process.env.TOKENLESS_EVIDENCE_SIGNING_KEY_ID;
  else process.env.TOKENLESS_EVIDENCE_SIGNING_KEY_ID = originalSigningKeyId;
});

test("projects the hosted P-256 advisory keyring only when its current fingerprint matches", () => {
  const current = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey;
  const retired = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey;
  const entry = (publicKey: typeof current, status: "current" | "retired") => {
    const der = publicKey.export({ format: "der", type: "spki" });
    return {
      algorithm: "ECDSA-SHA256",
      keyId: `p256:${createHash("sha256").update(der).digest("hex").slice(0, 24)}`,
      publicKey: der.toString("base64url"),
      status,
    };
  };
  const currentEntry = entry(current, "current");
  const retiredEntry = entry(retired, "retired");
  process.env.TOKENLESS_EVIDENCE_KMS_KEY_RESOURCE = "arn:aws:kms:eu-central-1:123456789012:key/test";
  process.env.TOKENLESS_EVIDENCE_SIGNING_KEY_ID = currentEntry.keyId;
  process.env.TOKENLESS_DECISION_PACKET_VERIFICATION_KEYS = JSON.stringify([currentEntry, retiredEntry]);

  const keyring = projectHumanReviewAdvisoryTrustedKeyring();
  assert.deepEqual(
    keyring.keys.map(key => ({ algorithm: key.algorithm, keyId: key.keyId })),
    [
      { algorithm: "ECDSA-SHA256", keyId: currentEntry.keyId },
      { algorithm: "ECDSA-SHA256", keyId: retiredEntry.keyId },
    ],
  );
  assert.equal(keyring.keys[0]?.publicKeyJwk.kty, "EC");
  assert.equal(keyring.keys[0]?.publicKeyJwk.crv, "P-256");

  process.env.TOKENLESS_EVIDENCE_SIGNING_KEY_ID = retiredEntry.keyId;
  assertServiceError(() => projectHumanReviewAdvisoryTrustedKeyring(), "review_gate_evidence_verification_unavailable");
});

test("issues a compact signed receipt for exact server-known review-gate state", () => {
  const binding = pendingBinding();
  const evidence = issueHumanReviewGateEvidence(binding);
  const verified = verifyHumanReviewGateEvidence({ evidence, expected: binding });

  assert.equal(evidence.schemaVersion, "rateloop.human-review-gate-evidence.v1");
  assert.deepEqual(evidence.signing, {
    algorithm: "Ed25519",
    keyId: __humanReviewGateEvidenceTestUtils.derivedKeyId(CURRENT.publicKey),
    version: 1,
  });
  assert.equal(evidence.payload.schemaVersion, "rateloop.human-review-gate-payload.v1");
  assert.equal(evidence.payload.assertion, "rateloop_server_review_gate_state");
  assert.equal(evidence.payload.workspaceId, binding.workspaceId);
  assert.equal(evidence.payload.lifecycleState, "pending");
  assert.equal(evidence.payload.lifecycleRevision, 4);
  assert.equal(evidence.payload.operationKey, binding.references.operationKey);
  assert.equal(evidence.payload.requestReference, binding.references.requestReference);
  assert.equal(evidence.payload.resultReference, null);
  assert.equal(evidence.payload.issuedAt, ISSUED_AT.toISOString());
  assert.equal(evidence.payload.expiresAt, "2026-07-16T12:05:00.000Z");
  assert.equal(evidence.payload.nonce, Buffer.alloc(24, 7).toString("base64url"));
  assert.match(evidence.payload.evidenceCommitment, /^sha256:[0-9a-f]{64}$/u);
  assert.match(evidence.signature, /^[A-Za-z0-9_-]{86}$/u);
  assert.equal(verified.keyStatus, "current");
  assert.deepEqual(verified.evidence, evidence);
  assert.deepEqual(issueHumanReviewGateEvidence(binding), evidence);
});

test("binds terminal disposition and result reference to the signed lifecycle revision", () => {
  const binding = completedBinding();
  const evidence = issueHumanReviewGateEvidence(binding);

  assert.equal(evidence.payload.terminalDisposition, "completed");
  assert.equal(evidence.payload.resultReference, binding.references.resultReference);
  assert.deepEqual(verifyHumanReviewGateEvidence({ evidence, expected: binding }).evidence, evidence);

  const wrongRevision = structuredClone(binding);
  wrongRevision.lifecycle.revision = 6;
  assertServiceError(
    () => verifyHumanReviewGateEvidence({ evidence, expected: wrongRevision }),
    "invalid_review_gate_evidence",
    /expected server-known binding|revision/u,
  );
  const wrongOpportunity = structuredClone(binding);
  wrongOpportunity.opportunityId = "opportunity_gate_other";
  assertServiceError(
    () => verifyHumanReviewGateEvidence({ evidence, expected: wrongOpportunity }),
    "invalid_review_gate_evidence",
  );
});

test("rejects payload, commitment, signature, algorithm, key, and version tampering", () => {
  const binding = completedBinding();
  const valid = issueHumanReviewGateEvidence(binding);

  const mutations: Array<(value: Record<string, any>) => void> = [
    value => {
      value.payload.lifecycleRevision += 1;
    },
    value => {
      value.payload.evidenceCommitment = `sha256:${"c".repeat(64)}`;
    },
    value => {
      value.signature = `${value.signature[0] === "A" ? "B" : "A"}${value.signature.slice(1)}`;
    },
    value => {
      value.signing.algorithm = "RSA";
    },
    value => {
      value.signing.version = 2;
    },
    value => {
      value.signing.keyId = `ed25519:${"f".repeat(24)}`;
    },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(valid) as unknown as Record<string, any>;
    mutate(value);
    assert.throws(() => verifyHumanReviewGateEvidence({ evidence: value, expected: binding }));
  }
});

test("accepts an explicitly configured retired verification key after signer rotation", () => {
  configure({ signer: RETIRED.privateKey });
  const binding = completedBinding();
  const evidence = issueHumanReviewGateEvidence(binding);

  __setHumanReviewGateEvidenceConfigForTests({
    verificationKeys: [{ publicKey: RETIRED.publicKey, status: "retired" }],
    now: ISSUED_AT,
  });
  assert.equal(verifyHumanReviewGateEvidence({ evidence, expected: binding }).keyStatus, "retired");

  configure({ signer: ROTATED.privateKey });
  assertServiceError(
    () => verifyHumanReviewGateEvidence({ evidence, expected: binding }),
    "review_gate_evidence_key_untrusted",
  );
});

test("loads fingerprint-bound current and retired public keys from the verification keyring", () => {
  const currentId = __humanReviewGateEvidenceTestUtils.derivedKeyId(CURRENT.publicKey);
  const retiredId = __humanReviewGateEvidenceTestUtils.derivedKeyId(RETIRED.publicKey);
  process.env.TOKENLESS_EVIDENCE_VERIFICATION_KEYS = JSON.stringify([
    {
      algorithm: "Ed25519",
      keyId: currentId,
      publicKey: CURRENT.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
      status: "current",
    },
    {
      algorithm: "Ed25519",
      keyId: retiredId,
      publicKey: RETIRED.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
      status: "retired",
    },
  ]);

  const keys = __humanReviewGateEvidenceTestUtils.parseConfiguredVerificationKeys();
  assert.deepEqual(
    keys.map(key => ({ keyId: key.keyId, status: key.status })),
    [
      { keyId: currentId, status: "current" },
      { keyId: retiredId, status: "retired" },
    ],
  );
  assert.deepEqual(
    projectHumanReviewGateTrustedKeyHistory().keys.map(key => ({ keyId: key.keyId, status: key.status })),
    [
      { keyId: currentId, status: "current" },
      { keyId: retiredId, status: "retired" },
    ],
  );

  const invalid = JSON.parse(process.env.TOKENLESS_EVIDENCE_VERIFICATION_KEYS) as Array<Record<string, unknown>>;
  invalid[1]!.keyId = currentId;
  process.env.TOKENLESS_EVIDENCE_VERIFICATION_KEYS = JSON.stringify(invalid);
  assertServiceError(
    () => __humanReviewGateEvidenceTestUtils.parseConfiguredVerificationKeys(),
    "review_gate_evidence_verification_unavailable",
  );
});

test("rejects expired and future-dated receipts", () => {
  const binding = pendingBinding();
  const evidence = issueHumanReviewGateEvidence(binding);

  configure({ now: new Date("2026-07-16T12:05:00.000Z") });
  assertServiceError(
    () => verifyHumanReviewGateEvidence({ evidence, expected: binding }),
    "review_gate_evidence_expired",
  );

  configure({ now: new Date("2026-07-16T11:59:00.000Z") });
  assertServiceError(
    () => verifyHumanReviewGateEvidence({ evidence, expected: binding }),
    "invalid_review_gate_evidence",
    /future/u,
  );
});

test("supports consume-once replay rejection without making ordinary verification stateful", () => {
  const binding = completedBinding();
  const evidence = issueHumanReviewGateEvidence(binding);
  const consumed = new Set<string>();
  const replayGuard = {
    consume(input: { nonce: string; evidenceCommitment: string }) {
      const key = `${input.nonce}:${input.evidenceCommitment}`;
      if (consumed.has(key)) return false;
      consumed.add(key);
      return true;
    },
  };

  assert.equal(verifyHumanReviewGateEvidence({ evidence, expected: binding }).keyStatus, "current");
  assert.equal(verifyHumanReviewGateEvidence({ evidence, expected: binding }).keyStatus, "current");
  assert.equal(verifyHumanReviewGateEvidence({ evidence, expected: binding, replayGuard }).keyStatus, "current");
  assertServiceError(
    () => verifyHumanReviewGateEvidence({ evidence, expected: binding, replayGuard }),
    "review_gate_evidence_replayed",
  );
});

test("rejects caller-generated host metadata and never includes private content fields", () => {
  for (const forbidden of ["prompt", "output", "hiddenReasoning", "toolPayload", "hostMetadata", "modelAttestation"]) {
    const binding = structuredClone(pendingBinding()) as unknown as Record<string, unknown>;
    binding[forbidden] = "caller supplied";
    assertServiceError(() => issueHumanReviewGateEvidence(binding), "invalid_review_gate_evidence_binding");
  }

  const binding = pendingBinding();
  const value = structuredClone(issueHumanReviewGateEvidence(binding)) as unknown as Record<string, any>;
  value.payload.hostMetadata = { provider: "caller" };
  assertServiceError(
    () => verifyHumanReviewGateEvidence({ evidence: value, expected: binding }),
    "invalid_review_gate_evidence",
  );

  const keys = new Set<string>();
  function visit(input: unknown) {
    if (Array.isArray(input)) return input.forEach(visit);
    if (!input || typeof input !== "object") return;
    for (const [key, child] of Object.entries(input as Record<string, unknown>)) {
      keys.add(key);
      visit(child);
    }
  }
  visit(issueHumanReviewGateEvidence(binding));
  for (const forbidden of [
    "prompt",
    "output",
    "hiddenReasoning",
    "toolPayload",
    "hostMetadata",
    "modelMetadata",
    "publicKey",
    "privateKey",
  ]) {
    assert.equal(keys.has(forbidden), false, `unexpected field ${forbidden}`);
  }
});

test("issues advisory terminal evidence accepted by the actual commit43 stop-gate verifier", async () => {
  const crossNow = new Date();
  configure({ now: crossNow });
  const state = serverState();
  const { resolver, lookups } = resolverFor(state);
  const evidence = await issueHumanReviewAdvisoryTerminalEvidence({
    resolver,
    expected: {
      workspaceId: state.workspaceId,
      integrationId: state.integrationId,
      opportunityId: state.opportunityId,
      lifecycleRevision: state.lifecycle.revision,
      outputCommitment: state.outputCommitment,
      policyBindingHash: state.humanReviewBinding.hash,
    },
  });
  const pluginData = await mkdtemp(join(tmpdir(), "rateloop-advisory-evidence-"));
  const contractRoot = join(pluginData, "review-stop-gate-v1");
  try {
    await mkdir(contractRoot, { recursive: true });
    await writeFile(
      join(contractRoot, "trusted-keys.json"),
      `${JSON.stringify(projectHumanReviewGateTrustedKeyring())}\n`,
      { mode: 0o600 },
    );
    await verifyAdvisoryTerminalEvidence(
      evidence,
      {
        workspaceId: state.workspaceId,
        integrationId: state.integrationId,
        opportunityId: state.opportunityId,
        lifecycle: state.lifecycle.state,
        outputCommitment: state.outputCommitment,
        policyBindingHash: state.humanReviewBinding.hash,
        armedAt: new Date(crossNow.getTime() - 1_000).toISOString(),
      },
      pluginData,
    );
  } finally {
    await rm(pluginData, { recursive: true, force: true });
  }

  assert.deepEqual(lookups, [
    {
      workspaceId: state.workspaceId,
      integrationId: state.integrationId,
      opportunityId: state.opportunityId,
    },
  ]);
  assert.equal(evidence.schemaVersion, "rateloop.human-review-terminal-evidence.v2");
  assert.equal(evidence.payload.schemaVersion, "rateloop.human-review-terminal-payload.v2");
  assert.equal(evidence.payload.terminalStatus, "completed");
  assert.equal(evidence.payload.releaseDisposition, "authorized_positive");
  assert.equal(evidence.payload.resultSemantics, "assurance");
  assert.equal(evidence.payload.resultOutcome, "positive");
  assert.equal(evidence.payload.resultCommitment, HASH_RESULT);
});

test("issues host release evidence accepted by the actual commit44 host verifier", async () => {
  const crossNow = new Date();
  configure({ now: crossNow });
  const state = serverState();
  const { resolver } = resolverFor(state);
  const request = buildHostReleaseRequest(
    {
      releaseId: "release_gate_cross_01",
      hostId: "host_gate_cross_01",
      sessionId: "session_01",
      turnId: "turn_01",
      gateId: "gate_gate_cross_01",
      workspaceId: state.workspaceId,
      integrationId: state.integrationId,
      opportunityId: state.opportunityId,
      decision: "satisfied",
      policyBindingHash: state.humanReviewBinding.hash,
      scopeCommitment: state.scopeCommitment,
      nonce: "abcdefghijklmnopqrstuvwxyzABCDEF",
    },
    HOST_CANDIDATE,
    crossNow,
  );
  const binding = hostBindingCommitment(request);
  const evidence = await issueHumanReviewHostReleaseEvidence({
    resolver,
    request,
    hostBindingCommitment: binding,
  });
  const verified = verifyHostOutputRelease({
    request,
    evidence,
    trustedKeys: projectHumanReviewGateTrustedKeyring(),
    candidateBytes: HOST_CANDIDATE,
    now: crossNow,
  });

  assert.equal(evidence.schemaVersion, "rateloop.host-output-release-evidence.v2");
  assert.equal(evidence.payload.schemaVersion, "rateloop.host-output-release-payload.v2");
  assert.equal(evidence.payload.hostBindingCommitment, binding);
  assert.equal(evidence.payload.outputCommitment, HASH_OUTPUT);
  assert.equal(evidence.payload.releaseDisposition, "authorized_positive");
  assert.equal(evidence.payload.resultCommitment, HASH_RESULT);
  assert.equal(verified.hostBindingCommitment, binding);
});

test("host issuer independently enforces exact output, policy, scope, and host bindings", async () => {
  const crossNow = new Date();
  configure({ now: crossNow });
  const state = serverState();
  const request = buildHostReleaseRequest(
    {
      releaseId: "release_gate_cross_02",
      hostId: "host_gate_cross_01",
      sessionId: "session_01",
      turnId: "turn_01",
      gateId: "gate_gate_cross_01",
      workspaceId: state.workspaceId,
      integrationId: state.integrationId,
      opportunityId: state.opportunityId,
      decision: "satisfied",
      policyBindingHash: state.humanReviewBinding.hash,
      scopeCommitment: state.scopeCommitment,
      nonce: "abcdefghijklmnopqrstuvwxyzABCDEG",
    },
    HOST_CANDIDATE,
    crossNow,
  );
  const binding = hostBindingCommitment(request);

  await assertServiceErrorAsync(
    () =>
      issueHumanReviewHostReleaseEvidence({
        resolver: resolverFor(serverState({ outputCommitment: `sha256:${"9".repeat(64)}` })).resolver,
        request,
        hostBindingCommitment: binding,
      }),
    "review_gate_server_state_mismatch",
    /commitments/u,
  );
  await assertServiceErrorAsync(
    () =>
      issueHumanReviewHostReleaseEvidence({
        resolver: resolverFor(state).resolver,
        request,
        hostBindingCommitment: `sha256:${"8".repeat(64)}`,
      }),
    "review_gate_server_state_mismatch",
    /host binding/u,
  );
});

test("host issuer authorizes only skipped or explicitly positive assurance results", async () => {
  const crossNow = new Date();
  configure({ now: crossNow });
  const inconclusive = serverState({
    lifecycle: { state: "inconclusive", revision: 6 },
    terminalDisposition: "inconclusive",
    resultOutcome: "inconclusive",
    resultCommitment: `sha256:${"8".repeat(64)}`,
    releaseDisposition: "not_authorized",
  });
  const satisfiedRequest = buildHostReleaseRequest(
    {
      releaseId: "release_gate_cross_03",
      hostId: "host_gate_cross_01",
      sessionId: "session_01",
      turnId: "turn_01",
      gateId: "gate_gate_cross_01",
      workspaceId: inconclusive.workspaceId,
      integrationId: inconclusive.integrationId,
      opportunityId: inconclusive.opportunityId,
      decision: "satisfied",
      policyBindingHash: inconclusive.humanReviewBinding.hash,
      scopeCommitment: inconclusive.scopeCommitment,
      nonce: "abcdefghijklmnopqrstuvwxyzABCDEH",
    },
    HOST_CANDIDATE,
    crossNow,
  );
  const satisfiedBinding = hostBindingCommitment(satisfiedRequest);
  await assertServiceErrorAsync(
    () =>
      issueHumanReviewHostReleaseEvidence({
        resolver: resolverFor(inconclusive).resolver,
        request: satisfiedRequest,
        hostBindingCommitment: satisfiedBinding,
      }),
    "review_gate_server_state_mismatch",
    /authorize/u,
  );
  await assertServiceErrorAsync(
    () =>
      issueHumanReviewHostReleaseEvidence({
        resolver: resolverFor(serverState({ ...inconclusive, inconclusiveReleaseAllowed: true })).resolver,
        request: satisfiedRequest,
        hostBindingCommitment: satisfiedBinding,
      }),
    "review_gate_server_state_mismatch",
    /authorize/u,
  );

  const skipped = serverState({
    lifecycle: { state: "skipped", revision: 1 },
    references: { operationKey: null, requestReference: null, resultReference: null },
    reviewDecision: "skip",
    terminalDisposition: "skipped",
    resultOutcome: null,
    resultCommitment: null,
    releaseDisposition: "not_authorized",
  });
  const skippedRequest = buildHostReleaseRequest(
    {
      releaseId: "release_gate_cross_04",
      hostId: "host_gate_cross_01",
      sessionId: "session_01",
      turnId: "turn_01",
      gateId: "gate_gate_cross_01",
      workspaceId: skipped.workspaceId,
      integrationId: skipped.integrationId,
      opportunityId: skipped.opportunityId,
      decision: "skipped",
      policyBindingHash: skipped.humanReviewBinding.hash,
      scopeCommitment: skipped.scopeCommitment,
      nonce: "abcdefghijklmnopqrstuvwxyzABCDEI",
    },
    HOST_CANDIDATE,
    crossNow,
  );
  const skippedEvidence = await issueHumanReviewHostReleaseEvidence({
    resolver: resolverFor(skipped).resolver,
    request: skippedRequest,
    hostBindingCommitment: hostBindingCommitment(skippedRequest),
  });
  assert.equal(skippedEvidence.payload.terminalStatus, "skipped");
  assert.equal(skippedEvidence.payload.releaseDisposition, "selection_skipped");
  assert.equal(skippedEvidence.payload.resultOutcome, null);
  assert.equal(skippedEvidence.payload.resultCommitment, null);
});

test("completed negative assurance and positive feedback results never authorize host release", async () => {
  const crossNow = new Date();
  configure({ now: crossNow });
  for (const state of [
    serverState({ resultOutcome: "negative", releaseDisposition: "not_authorized" }),
    serverState({ resultSemantics: "feedback", releaseDisposition: "not_authorized" }),
  ]) {
    const request = buildHostReleaseRequest(
      {
        releaseId: `release_denied_${state.resultSemantics}_${state.resultOutcome}`,
        hostId: "host_gate_cross_01",
        sessionId: "session_01",
        turnId: "turn_01",
        gateId: "gate_gate_cross_01",
        workspaceId: state.workspaceId,
        integrationId: state.integrationId,
        opportunityId: state.opportunityId,
        decision: "satisfied",
        policyBindingHash: state.humanReviewBinding.hash,
        scopeCommitment: state.scopeCommitment,
        nonce: `deny${state.resultSemantics.padEnd(28, "x")}`,
      },
      HOST_CANDIDATE,
      crossNow,
    );
    await assertServiceErrorAsync(
      () =>
        issueHumanReviewHostReleaseEvidence({
          resolver: resolverFor(state).resolver,
          request,
          hostBindingCommitment: hostBindingCommitment(request),
        }),
      "review_gate_server_state_mismatch",
      /authorize/u,
    );
  }
});

test("consumer issuers reject non-terminal advisory state and malformed resolver state", async () => {
  const pending = serverState({
    ...pendingBinding(),
    schemaVersion: "rateloop.human-review-gate-server-state.v1",
    resultOutcome: null,
    resultCommitment: null,
    releaseDisposition: "not_authorized",
  });
  await assertServiceErrorAsync(
    () =>
      issueHumanReviewAdvisoryTerminalEvidence({
        resolver: resolverFor(pending).resolver,
        expected: {
          workspaceId: pending.workspaceId,
          integrationId: pending.integrationId,
          opportunityId: pending.opportunityId,
          lifecycleRevision: pending.lifecycle.revision,
          outputCommitment: pending.outputCommitment,
          policyBindingHash: pending.humanReviewBinding.hash,
        },
      }),
    "review_gate_server_state_mismatch",
    /terminal/u,
  );

  const malformed = { ...serverState(), hostMetadata: "caller supplied" };
  await assertServiceErrorAsync(
    () =>
      issueHumanReviewAdvisoryTerminalEvidence({
        resolver: {
          async resolve() {
            return malformed;
          },
        },
        expected: {
          workspaceId: malformed.workspaceId,
          integrationId: malformed.integrationId,
          opportunityId: malformed.opportunityId,
          lifecycleRevision: malformed.lifecycle.revision,
          outputCommitment: malformed.outputCommitment,
          policyBindingHash: malformed.humanReviewBinding.hash,
        },
      }),
    "review_gate_server_state_invalid",
  );
});
