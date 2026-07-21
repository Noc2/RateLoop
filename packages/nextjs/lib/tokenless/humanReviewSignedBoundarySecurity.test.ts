import {
  buildHostReleaseRequest,
  hostBindingCommitment,
  verifyHostOutputRelease,
} from "../../../agents/host-gate/rateloop-host-output-gate.mjs";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  type HumanReviewGateServerState,
  __setHumanReviewGateEvidenceConfigForTests,
  issueHumanReviewAdvisoryTerminalEvidence,
  issueHumanReviewHostReleaseEvidence,
  projectHumanReviewGateTrustedKeyring,
} from "~~/lib/tokenless/humanReviewGateEvidence";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const pluginRoot = join(repoRoot, "plugins", "rateloop-workspace");
const updaterPath = join(pluginRoot, "hooks", "rateloop-advisory-state-update.mjs");
const stopPath = join(pluginRoot, "hooks", "rateloop-advisory-stop-gate.mjs");
const signingKey = generateKeyPairSync("ed25519");
const HASH_POLICY = `sha256:${"1".repeat(64)}` as const;
const HASH_PROFILE = `sha256:${"2".repeat(64)}` as const;
const HASH_SCOPE = `sha256:${"3".repeat(64)}` as const;
const CANDIDATE = Buffer.from("candidate output held by the trusted host", "utf8");
const HASH_OUTPUT = `sha256:${createHash("sha256").update(CANDIDATE).digest("hex")}` as const;
const temporaryDirectories: string[] = [];

function serverState(): HumanReviewGateServerState {
  return {
    schemaVersion: "rateloop.human-review-gate-server-state.v1",
    workspaceId: "workspace_security_01",
    integrationId: "integration_security_01",
    agentId: "agent_security_01",
    agentVersionId: "version_security_01",
    scopeId: "scope_security_01",
    opportunityId: "opportunity_security_01",
    lifecycle: { state: "completed", revision: 2 },
    references: {
      operationKey: "operation_security_01",
      requestReference: `sha256:${"4".repeat(64)}`,
      resultReference: `sha256:${"5".repeat(64)}`,
    },
    reviewDecision: "required",
    terminalDisposition: "completed",
    selectionPolicy: { id: "selection_security_01", version: 1, hash: `sha256:${"6".repeat(64)}` },
    humanReviewBinding: { id: "binding_security_01", version: 1, hash: HASH_POLICY },
    requestProfile: { id: "profile_security_01", version: 1, hash: HASH_PROFILE },
    outputCommitment: HASH_OUTPUT,
    scopeCommitment: HASH_SCOPE,
    inconclusiveReleaseAllowed: false,
    resultSemantics: "assurance",
    resultOutcome: "positive",
    resultCommitment: `sha256:${"7".repeat(64)}`,
    releaseDisposition: "authorized_positive",
  };
}

function resolver(state = serverState()) {
  return {
    async resolve() {
      return structuredClone(state);
    },
  };
}

function envelope(state: "pending" | "completed", terminalEvidence: unknown, enteredAt: Date) {
  return {
    schemaVersion: "rateloop.human-review-tool-envelope.v1",
    workspaceId: "workspace_security_01",
    integrationId: "integration_security_01",
    opportunityId: "opportunity_security_01",
    decision: "required",
    lifecycle: {
      state,
      revision: state === "pending" ? 1 : 2,
      terminal: state === "completed",
      reasonCodes: [state === "pending" ? "security_review_pending" : "security_review_completed"],
      stateEnteredAt: enteredAt.toISOString(),
    },
    frozen: {
      selectionPolicy: { id: "selection_security_01", version: 1 },
      binding: { id: "binding_security_01", version: 1, hash: HASH_POLICY },
      requestProfile: { id: "profile_security_01", version: 1, hash: HASH_PROFILE },
      evaluationCommitment: HASH_OUTPUT,
    },
    route: { lane: "private_unpaid", authority: "ask_automatically" },
    continuation:
      state === "pending"
        ? {
            cursor: "cursor_security_pending",
            retryAfterMs: 1_000,
            expiresAt: new Date(enteredAt.getTime() + 60 * 60_000).toISOString(),
          }
        : null,
    terminalEvidence,
  };
}

function hookInput(tool: "evaluate_review_requirement" | "get_review_result", value: Record<string, unknown>) {
  return {
    session_id: "session_security_01",
    turn_id: "turn_security_01",
    transcript_path: "/private/transcript-must-not-be-read.jsonl",
    cwd: "/private/workspace-must-not-be-persisted",
    hook_event_name: "PostToolUse",
    permission_mode: "default",
    model: "gpt-5",
    tool_name: `mcp__rateloop-workspace__rateloop_${tool}`,
    tool_use_id: tool === "evaluate_review_requirement" ? "tool_security_01" : "tool_security_02",
    tool_input:
      tool === "evaluate_review_requirement"
        ? { externalOpportunityId: "external_security_01" }
        : { opportunityId: "opportunity_security_01" },
    tool_response: { content: [], structuredContent: value },
  };
}

async function pluginData() {
  const path = await mkdtemp(join(tmpdir(), "rateloop-signed-boundary-security-"));
  temporaryDirectories.push(path);
  await mkdir(join(path, "review-stop-gate-v1"), { recursive: true });
  await writeFile(
    join(path, "review-stop-gate-v1", "trusted-keys.json"),
    `${JSON.stringify(projectHumanReviewGateTrustedKeyring())}\n`,
    { mode: 0o600 },
  );
  return path;
}

async function runHook(script: string, data: string, input: unknown) {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [script], {
    cwd: repoRoot,
    env: { ...process.env, PLUGIN_DATA: data, PLUGIN_ROOT: pluginRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(input));
  const chunks: Buffer[] = [];
  const errors: Buffer[] = [];
  child.stdout.on("data", chunk => chunks.push(Buffer.from(chunk)));
  child.stderr.on("data", chunk => errors.push(Buffer.from(chunk)));
  const exitCode = await new Promise<number | null>(resolve => child.on("close", resolve));
  assert.equal(exitCode, 0);
  assert.equal(Buffer.concat(errors).toString("utf8"), "");
  const output = Buffer.concat(chunks).toString("utf8").trim();
  return output ? (JSON.parse(output) as Record<string, any>) : null;
}

afterEach(async () => {
  __setHumanReviewGateEvidenceConfigForTests(null);
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

test("server-signed terminal evidence crosses the exact tool envelope without persisting private hook fields", async () => {
  const now = new Date();
  __setHumanReviewGateEvidenceConfigForTests({
    signingPrivateKey: signingKey.privateKey,
    now,
    nonce: Buffer.alloc(24, 8),
  });
  const data = await pluginData();
  const secret = "private-source-payload-that-must-not-enter-gate-state";
  const pending = hookInput("evaluate_review_requirement", envelope("pending", null, new Date(now.getTime() - 1_000)));
  (pending.tool_input as Record<string, unknown>).privateSourcePayload = secret;
  (pending.tool_response as Record<string, any>).content = [{ type: "text", text: secret }];
  (pending.tool_response.structuredContent as Record<string, unknown>).privateSuggestionPayload = secret;
  assert.equal(await runHook(updaterPath, data, pending), null);

  const statePath = join(data, "review-stop-gate-v1", "sessions", "session_security_01.json");
  const pendingState = await readFile(statePath, "utf8");
  assert.equal(pendingState.includes(secret), false);
  assert.equal(pendingState.includes("transcript"), false);
  assert.equal(pendingState.includes("/private/workspace"), false);

  const evidence = await issueHumanReviewAdvisoryTerminalEvidence({
    resolver: resolver(),
    expected: {
      workspaceId: "workspace_security_01",
      integrationId: "integration_security_01",
      opportunityId: "opportunity_security_01",
      lifecycleRevision: 2,
      outputCommitment: HASH_OUTPUT,
      policyBindingHash: HASH_POLICY,
    },
  });
  const terminalEnvelope = envelope("completed", evidence, now);
  const tampered = structuredClone(terminalEnvelope);
  tampered.frozen.evaluationCommitment = `sha256:${"f".repeat(64)}`;
  const rejected = await runHook(updaterPath, data, hookInput("get_review_result", tampered));
  assert.match(String(rejected?.systemMessage), /frozen_commitment_mismatch/u);
  assert.equal(await readFile(statePath, "utf8"), pendingState);

  assert.equal(await runHook(updaterPath, data, hookInput("get_review_result", terminalEnvelope)), null);
  assert.equal(
    await runHook(stopPath, data, {
      session_id: "session_security_01",
      turn_id: "turn_security_01",
      hook_event_name: "Stop",
    }),
    null,
  );
});

test("host release evidence cannot be replayed across a candidate, signature, or host turn", async () => {
  const now = new Date();
  __setHumanReviewGateEvidenceConfigForTests({
    signingPrivateKey: signingKey.privateKey,
    now,
    nonce: Buffer.alloc(24, 9),
  });
  const state = serverState();
  const request = buildHostReleaseRequest(
    {
      releaseId: "release_security_01",
      hostId: "host_security_01",
      sessionId: "session_security_01",
      turnId: "turn_security_01",
      gateId: "gate_security_01",
      workspaceId: state.workspaceId,
      integrationId: state.integrationId,
      opportunityId: state.opportunityId,
      decision: "satisfied",
      policyBindingHash: state.humanReviewBinding.hash,
      scopeCommitment: state.scopeCommitment,
      nonce: "abcdefghijklmnopqrstuvwxyzABCDEF",
    },
    CANDIDATE,
    now,
  );
  const evidence = await issueHumanReviewHostReleaseEvidence({
    resolver: resolver(state),
    request,
    hostBindingCommitment: hostBindingCommitment(request),
  });
  const trustedKeys = projectHumanReviewGateTrustedKeyring();
  assert.equal(
    verifyHostOutputRelease({ request, evidence, trustedKeys, candidateBytes: CANDIDATE, now }).request.turnId,
    "turn_security_01",
  );
  assert.throws(
    () =>
      verifyHostOutputRelease({
        request,
        evidence,
        trustedKeys,
        candidateBytes: Buffer.from("tampered candidate", "utf8"),
        now,
      }),
    /candidate_output_mismatch/u,
  );

  const otherTurn = { ...request, turnId: "turn_security_02" };
  assert.throws(
    () => verifyHostOutputRelease({ request: otherTurn, evidence, trustedKeys, candidateBytes: CANDIDATE, now }),
    /release_hostBindingCommitment_mismatch/u,
  );
  const tamperedEvidence = structuredClone(evidence);
  tamperedEvidence.signature = `${tamperedEvidence.signature.startsWith("A") ? "B" : "A"}${tamperedEvidence.signature.slice(1)}`;
  assert.throws(
    () => verifyHostOutputRelease({ request, evidence: tamperedEvidence, trustedKeys, candidateBytes: CANDIDATE, now }),
    /release_signature_invalid/u,
  );
});
