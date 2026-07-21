import { execFileSync } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  HOST_RELEASE_EVIDENCE_SCHEMA,
  HOST_RELEASE_PAYLOAD_SCHEMA,
  TRUSTED_KEYRING_SCHEMA,
  buildHostReleaseRequest,
  hostBindingCommitment,
  materializeAuthorizedOutput,
  serverReleaseEvidencePayload,
  sha256Bytes,
  verifyHostOutputRelease,
} from "../../host-gate/rateloop-host-output-gate.mjs";

const NOW = new Date("2026-07-16T12:00:00.000Z");
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_RESULT = `sha256:${"c".repeat(64)}`;
const candidate = Buffer.from(
  "candidate output held behind the host boundary",
  "utf8",
);
const cliPath = resolve("host-gate/rateloop-host-output-gate-cli.mjs");

function fixture(decision: "satisfied" | "skipped" = "satisfied") {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const request = buildHostReleaseRequest(
    {
      releaseId: "release_fixture_0001",
      nonce: "abcdefghijklmnopqrstuvwxyzABCDEF",
      hostId: "host_fixture_0001",
      sessionId: "session_01",
      turnId: "turn_01",
      gateId: "gate_fixture_0001",
      workspaceId: "workspace_fixture_0001",
      integrationId: "integration_fixture_0001",
      opportunityId: "opportunity_fixture_0001",
      decision,
      policyBindingHash: HASH_A,
      scopeCommitment: HASH_B,
      lifetimeMs: 15 * 60 * 1_000,
    },
    candidate,
    NOW,
  );
  const evidence = {
    schemaVersion: HOST_RELEASE_EVIDENCE_SCHEMA,
    keyId: "host-gate-test-key",
    payload: {
      schemaVersion: HOST_RELEASE_PAYLOAD_SCHEMA,
      releaseId: request.releaseId,
      workspaceId: request.workspaceId,
      integrationId: request.integrationId,
      opportunityId: request.opportunityId,
      decision,
      terminalStatus: decision === "satisfied" ? "completed" : "skipped",
      releaseDisposition:
        decision === "satisfied" ? "authorized_positive" : "selection_skipped",
      resultSemantics: "assurance",
      resultOutcome: decision === "satisfied" ? "positive" : null,
      resultCommitment: decision === "satisfied" ? HASH_RESULT : null,
      outputCommitment: request.outputCommitment,
      policyBindingHash: request.policyBindingHash,
      scopeCommitment: request.scopeCommitment,
      hostBindingCommitment: hostBindingCommitment(request),
      issuedAt: new Date(NOW.getTime() + 1_000).toISOString(),
      expiresAt: new Date(NOW.getTime() + 10 * 60 * 1_000).toISOString(),
    },
    signature: "",
  };
  evidence.signature = sign(
    null,
    serverReleaseEvidencePayload(evidence),
    privateKey,
  ).toString("base64url");
  const trustedKeys = {
    schemaVersion: TRUSTED_KEYRING_SCHEMA,
    keys: [
      {
        keyId: evidence.keyId,
        algorithm: "Ed25519",
        publicKeyJwk: publicKey.export({ format: "jwk" }),
      },
    ],
  };
  return { request, evidence, trustedKeys, privateKey };
}

describe("host-owned RateLoop output gate", () => {
  it.each(["satisfied", "skipped"] as const)(
    "atomically materializes a signed %s decision and never returns candidate bytes",
    async (decision) => {
      const root = await mkdtemp(join(tmpdir(), "rateloop-host-gate-"));
      const values = fixture(decision);
      const released = await materializeAuthorizedOutput({
        ...values,
        candidateBytes: candidate,
        stateDirectory: root,
        now: new Date(NOW.getTime() + 2_000),
      });

      expect(released.idempotent).toBe(false);
      expect(released.outputPath).toContain(values.request.releaseId);
      expect(await readFile(released.outputPath)).toEqual(candidate);
      expect(JSON.stringify(released.receipt)).not.toContain(
        candidate.toString("utf8"),
      );
      expect(released.receipt).toMatchObject({
        decision,
        releaseDisposition:
          decision === "satisfied"
            ? "authorized_positive"
            : "selection_skipped",
        resultSemantics: "assurance",
        resultOutcome: decision === "satisfied" ? "positive" : null,
        resultCommitment: decision === "satisfied" ? HASH_RESULT : null,
        outputCommitment: sha256Bytes(candidate),
        hostBindingCommitment: hostBindingCommitment(values.request),
      });
    },
  );

  it("makes an exact retry idempotent without releasing a second copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "rateloop-host-gate-replay-"));
    const values = fixture();
    const first = await materializeAuthorizedOutput({
      ...values,
      candidateBytes: candidate,
      stateDirectory: root,
      now: new Date(NOW.getTime() + 2_000),
    });
    const second = await materializeAuthorizedOutput({
      ...values,
      candidateBytes: candidate,
      stateDirectory: root,
      now: new Date(NOW.getTime() + 3_000),
    });

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.directory).toBe(first.directory);
    expect(second.receipt.releasedAt).toBe(first.receipt.releasedAt);
  });

  it("rejects a conflicting reuse of an already consumed release ID", async () => {
    const root = await mkdtemp(join(tmpdir(), "rateloop-host-gate-conflict-"));
    const first = fixture("satisfied");
    await materializeAuthorizedOutput({
      ...first,
      candidateBytes: candidate,
      stateDirectory: root,
      now: new Date(NOW.getTime() + 2_000),
    });
    const conflicting = fixture("skipped");
    await expect(
      materializeAuthorizedOutput({
        ...conflicting,
        candidateBytes: candidate,
        stateDirectory: root,
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).rejects.toThrow("release_replay_conflict");
  });

  it("requires a separately provisioned owner-only state root outside forbidden workspaces", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "rateloop-host-gate-permissions-"),
    );
    const values = fixture();
    const missing = join(root, "missing");
    await expect(
      materializeAuthorizedOutput({
        ...values,
        candidateBytes: candidate,
        stateDirectory: missing,
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const writable = join(root, "writable");
    await mkdir(writable, { mode: 0o700 });
    await chmod(writable, 0o770);
    await expect(
      materializeAuthorizedOutput({
        ...values,
        candidateBytes: candidate,
        stateDirectory: writable,
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).rejects.toThrow("release_directory_not_host_owned");

    await chmod(writable, 0o700);
    await expect(
      materializeAuthorizedOutput({
        ...values,
        candidateBytes: candidate,
        stateDirectory: writable,
        forbiddenRoots: [root],
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).rejects.toThrow("release_directory_inside_agent_workspace");
  });

  it("refuses unsigned or non-terminal advisory state and creates no release", async () => {
    const root = await mkdtemp(join(tmpdir(), "rateloop-host-gate-refusal-"));
    const values = fixture();
    await expect(
      materializeAuthorizedOutput({
        request: values.request,
        evidence: null,
        trustedKeys: values.trustedKeys,
        candidateBytes: candidate,
        stateDirectory: root,
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).rejects.toThrow("release_evidence_shape_invalid");
    await expect(
      readFile(join(root, "releases", values.request.releaseId, "output.bin")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });

    const pending = fixture();
    pending.evidence.payload.terminalStatus = "pending";
    pending.evidence.signature = sign(
      null,
      serverReleaseEvidencePayload(pending.evidence),
      pending.privateKey,
    ).toString("base64url");
    expect(() =>
      verifyHostOutputRelease({
        ...pending,
        candidateBytes: candidate,
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).toThrow("release_disposition_invalid");
  });

  it.each([
    ["negative assurance", "assurance", "negative"],
    ["positive feedback", "feedback", "positive"],
  ] as const)(
    "refuses a signed completed %s result",
    (_label, resultSemantics, resultOutcome) => {
      const values = fixture();
      values.evidence.payload.releaseDisposition = "not_authorized";
      values.evidence.payload.resultSemantics = resultSemantics;
      values.evidence.payload.resultOutcome = resultOutcome;
      values.evidence.signature = sign(
        null,
        serverReleaseEvidencePayload(values.evidence),
        values.privateKey,
      ).toString("base64url");
      expect(() =>
        verifyHostOutputRelease({
          ...values,
          candidateBytes: candidate,
          now: new Date(NOW.getTime() + 2_000),
        }),
      ).toThrow("release_disposition_invalid");
    },
  );

  it.each([
    [
      "candidate bytes",
      (values: ReturnType<typeof fixture>) => ({
        ...values,
        candidateBytes: Buffer.from("altered"),
      }),
    ],
    [
      "turn",
      (values: ReturnType<typeof fixture>) => ({
        ...values,
        request: { ...values.request, turnId: "turn_02" },
      }),
    ],
    [
      "opportunity",
      (values: ReturnType<typeof fixture>) => ({
        ...values,
        request: {
          ...values.request,
          opportunityId: "opportunity_fixture_0002",
        },
      }),
    ],
    [
      "frozen policy",
      (values: ReturnType<typeof fixture>) => ({
        ...values,
        request: { ...values.request, policyBindingHash: HASH_B },
      }),
    ],
    [
      "frozen scope",
      (values: ReturnType<typeof fixture>) => ({
        ...values,
        request: { ...values.request, scopeCommitment: HASH_A },
      }),
    ],
  ])("refuses evidence moved to different %s", (_label, mutate) => {
    const values = fixture();
    const changed = mutate(values);
    expect(() =>
      verifyHostOutputRelease({
        ...changed,
        candidateBytes: changed.candidateBytes ?? candidate,
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).toThrow();
  });

  it("refuses expired, future, tampered, and untrusted server evidence", () => {
    const expired = fixture();
    expired.evidence.payload.expiresAt = new Date(
      NOW.getTime() + 1_500,
    ).toISOString();
    expired.evidence.signature = sign(
      null,
      serverReleaseEvidencePayload(expired.evidence),
      expired.privateKey,
    ).toString("base64url");
    expect(() =>
      verifyHostOutputRelease({
        ...expired,
        candidateBytes: candidate,
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).toThrow("release_evidence_expired");

    const future = fixture();
    future.evidence.payload.issuedAt = new Date(
      NOW.getTime() + 6 * 60 * 1_000,
    ).toISOString();
    future.evidence.signature = sign(
      null,
      serverReleaseEvidencePayload(future.evidence),
      future.privateKey,
    ).toString("base64url");
    expect(() =>
      verifyHostOutputRelease({
        ...future,
        candidateBytes: candidate,
        now: NOW,
      }),
    ).toThrow("release_time_invalid");

    const tampered = fixture();
    const replacement = tampered.evidence.signature.startsWith("A") ? "B" : "A";
    tampered.evidence.signature = `${replacement}${tampered.evidence.signature.slice(1)}`;
    expect(() =>
      verifyHostOutputRelease({
        ...tampered,
        candidateBytes: candidate,
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).toThrow("release_signature_invalid");

    const untrusted = fixture();
    untrusted.trustedKeys.keys[0].keyId = "different-key";
    expect(() =>
      verifyHostOutputRelease({
        ...untrusted,
        candidateBytes: candidate,
        now: new Date(NOW.getTime() + 2_000),
      }),
    ).toThrow("trusted_key_missing");
  });

  it("runs the CLI without printing candidate content", async () => {
    const root = await mkdtemp(join(tmpdir(), "rateloop-host-gate-cli-"));
    const candidatePath = join(root, "candidate.bin");
    const requestPath = join(root, "request.json");
    const evidencePath = join(root, "evidence.json");
    const keyringPath = join(root, "keys.json");
    const stateDirectory = join(root, "state");
    await writeFile(candidatePath, candidate, { mode: 0o600 });
    await mkdir(stateDirectory, { mode: 0o700 });
    const prepareOutput = execFileSync(
      process.execPath,
      [
        cliPath,
        "prepare",
        "--candidate",
        candidatePath,
        "--request",
        requestPath,
        "--host-id",
        "host_fixture_0001",
        "--session-id",
        "session_01",
        "--turn-id",
        "turn_01",
        "--gate-id",
        "gate_fixture_0001",
        "--workspace-id",
        "workspace_fixture_0001",
        "--integration-id",
        "integration_fixture_0001",
        "--opportunity-id",
        "opportunity_fixture_0001",
        "--decision",
        "satisfied",
        "--policy-binding-hash",
        HASH_A,
        "--scope-commitment",
        HASH_B,
      ],
      { encoding: "utf8" },
    );
    expect(prepareOutput).not.toContain(candidate.toString("utf8"));

    const request = JSON.parse(await readFile(requestPath, "utf8"));
    const values = fixture();
    values.evidence.payload = {
      ...values.evidence.payload,
      releaseId: request.releaseId,
      workspaceId: request.workspaceId,
      integrationId: request.integrationId,
      opportunityId: request.opportunityId,
      decision: request.decision,
      terminalStatus: "completed",
      outputCommitment: request.outputCommitment,
      policyBindingHash: request.policyBindingHash,
      scopeCommitment: request.scopeCommitment,
      hostBindingCommitment: hostBindingCommitment(request),
      issuedAt: new Date().toISOString(),
      expiresAt: request.expiresAt,
    };
    values.evidence.signature = sign(
      null,
      serverReleaseEvidencePayload(values.evidence),
      values.privateKey,
    ).toString("base64url");
    await Promise.all([
      writeFile(evidencePath, JSON.stringify(values.evidence), { mode: 0o600 }),
      writeFile(keyringPath, JSON.stringify(values.trustedKeys), {
        mode: 0o600,
      }),
    ]);

    const releaseOutput = execFileSync(
      process.execPath,
      [
        cliPath,
        "release",
        "--candidate",
        candidatePath,
        "--request",
        requestPath,
        "--evidence",
        evidencePath,
        "--trusted-keys",
        keyringPath,
        "--state-dir",
        stateDirectory,
      ],
      { encoding: "utf8" },
    );
    expect(releaseOutput).not.toContain(candidate.toString("utf8"));
    const output = JSON.parse(releaseOutput);
    expect(await readFile(output.outputPath)).toEqual(candidate);
    expect(output.idempotent).toBe(false);
  });
});
