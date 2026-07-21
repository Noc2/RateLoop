import { generateKeyPairSync, sign } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const pluginRoot = join(repoRoot, "plugins", "rateloop-workspace");
const hookRoot = join(pluginRoot, "hooks");
const hookPath = join(hookRoot, "rateloop-claude-pre-tool-use.mjs");
const temporaryDirectories: string[] = [];

async function pluginData() {
  const path = await mkdtemp(join(tmpdir(), "rateloop-claude-hook-"));
  temporaryDirectories.push(path);
  return path;
}

function input() {
  return {
    session_id: "session_claude_01",
    transcript_path: "/must/not/be/read/transcript.jsonl",
    cwd: "/fixture/workspace",
    hook_event_name: "PreToolUse",
    permission_mode: "default",
    tool_name: "Bash",
    tool_input: { command: "must not be inspected" },
    tool_use_id: "tool_claude_01",
  };
}

async function installState(data: string, lifecycle = "approval_required") {
  const path = join(
    data,
    "review-stop-gate-v1",
    "sessions",
    "session_claude_01.json",
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({
      schemaVersion: "rateloop.advisory-stop-gate.v2",
      armed: true,
      sessionId: "session_claude_01",
      turnId: "turn_claude_01",
      gateId: "gate_claude_01",
      workspaceId: "workspace_claude_01",
      integrationId: "integration_claude_01",
      opportunityId: "opportunity_claude_01",
      lifecycle,
      lifecycleRevision: 1,
      lifecycleTerminal:
        lifecycle === "skipped" ||
        [
          "completed",
          "inconclusive",
          "failed_terminal",
          "cancelled_before_commit",
        ].includes(lifecycle),
      outputCommitment: `sha256:${"a".repeat(64)}`,
      policyBindingHash: `sha256:${"b".repeat(64)}`,
      scopeCommitment: null,
      armedAt: "2026-07-16T08:00:00.000Z",
      expiresAt: "2099-07-17T08:00:00.000Z",
      lastToolUseId: "tool_claude_00",
      envelopeCommitment: `sha256:${"c".repeat(64)}`,
      terminalEvidence: null,
    })}\n`,
    { mode: 0o600 },
  );
}

async function installSignedTerminalEvidence(
  data: string,
  lifecycle: string,
  result: {
    semantics?: "assurance" | "feedback";
    outcome?: string;
    authorized?: boolean;
  } = {},
) {
  await installState(data, lifecycle);
  const path = join(
    data,
    "review-stop-gate-v1",
    "sessions",
    "session_claude_01.json",
  );
  const state = JSON.parse(await readFile(path, "utf8")) as Record<string, any>;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const skipped = lifecycle === "skipped";
  const scopeCommitment = `sha256:${"d".repeat(64)}`;
  const evidence = {
    schemaVersion: skipped
      ? "rateloop.human-review-skip-release-evidence.v1"
      : "rateloop.human-review-terminal-evidence.v2",
    keyId: "claude-test-key",
    payload: {
      schemaVersion: skipped
        ? "rateloop.human-review-skip-release-payload.v1"
        : "rateloop.human-review-terminal-payload.v2",
      workspaceId: state.workspaceId,
      integrationId: state.integrationId,
      opportunityId: state.opportunityId,
      ...(skipped ? { decision: "skipped" } : {}),
      terminalStatus: lifecycle,
      ...(!skipped
        ? {
            releaseDisposition:
              result.authorized === false
                ? "not_authorized"
                : "authorized_positive",
            resultSemantics: result.semantics ?? "assurance",
            resultOutcome: result.outcome ?? "positive",
            resultCommitment: `sha256:${"e".repeat(64)}`,
          }
        : {}),
      outputCommitment: state.outputCommitment,
      policyBindingHash: state.policyBindingHash,
      ...(skipped ? { scopeCommitment } : {}),
      issuedAt: new Date().toISOString(),
    },
    signature: "",
  };
  const stopPath = join(hookRoot, "rateloop-advisory-stop-gate.mjs");
  const stopModule = (await import(pathToFileURL(stopPath).href)) as {
    advisoryTerminalPayload(value: Record<string, any>): Buffer;
  };
  evidence.signature = sign(
    null,
    stopModule.advisoryTerminalPayload(evidence),
    privateKey,
  ).toString("base64url");
  state.terminalEvidence = evidence;
  if (skipped) {
    state.armed = false;
    state.scopeCommitment = scopeCommitment;
  }
  await writeFile(path, `${JSON.stringify(state)}\n`, "utf8");
  const keyringPath = join(data, "review-stop-gate-v1", "trusted-keys.json");
  await mkdir(dirname(keyringPath), { recursive: true });
  await writeFile(
    keyringPath,
    `${JSON.stringify({
      schemaVersion: "rateloop.stop-gate-trusted-keys.v1",
      keys: [
        {
          keyId: evidence.keyId,
          algorithm: "Ed25519",
          publicKeyJwk: publicKey.export({ format: "jwk" }),
        },
      ],
    })}\n`,
    "utf8",
  );
}

function run(data: string, value = input(), claude = true) {
  const result = spawnSync(process.execPath, [hookPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PLUGIN_ROOT: pluginRoot,
      ...(claude
        ? { CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: data }
        : { PLUGIN_DATA: data }),
    },
    input: JSON.stringify(value),
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout.trim()
    ? (JSON.parse(result.stdout) as Record<string, any>)
    : null;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("RateLoop Claude PreToolUse adapter", () => {
  it("is wired as Claude's durable defer primitive", async () => {
    const config = JSON.parse(
      await readFile(join(hookRoot, "hooks.json"), "utf8"),
    ) as Record<string, any>;
    expect(config.hooks.PreToolUse[0].matcher).toContain("mcp__rateloop");
    expect(config.hooks.PreToolUse[0].hooks[0].command).toContain(
      "rateloop-claude-pre-tool-use.mjs",
    );
  });

  it("defers a non-RateLoop tool while a review remains armed", async () => {
    const data = await pluginData();
    await installState(data);
    expect(run(data)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "defer",
      },
    });
  });

  it("does not block RateLoop progress tools or non-Claude hosts", async () => {
    const data = await pluginData();
    await installState(data);
    const rateloop = input();
    rateloop.tool_name = "mcp__rateloop-workspace__rateloop_wait_for_review";
    expect(run(data, rateloop)).toBeNull();
    expect(run(data, input(), false)).toBeNull();
  });

  it("denies an unsigned selection skip", async () => {
    const data = await pluginData();
    await installState(data, "skipped");
    expect(run(data)?.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("allows a selection skip only with matching signed release evidence", async () => {
    const data = await pluginData();
    await installSignedTerminalEvidence(data, "skipped");
    expect(run(data)).toBeNull();
  });

  it("allows a matching signed completed receipt", async () => {
    const data = await pluginData();
    await installSignedTerminalEvidence(data, "completed");
    expect(run(data)).toBeNull();
  });

  it.each(["inconclusive", "failed_terminal", "cancelled_before_commit"])(
    "denies a tool for a signed %s terminal receipt",
    async (lifecycle) => {
      const data = await pluginData();
      await installSignedTerminalEvidence(data, lifecycle, {
        authorized: false,
        outcome:
          lifecycle === "inconclusive"
            ? "inconclusive"
            : lifecycle === "failed_terminal"
              ? "failed"
              : "cancelled",
      });
      expect(run(data)).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      });
    },
  );

  it.each([
    ["negative assurance", "assurance", "negative"],
    ["positive feedback", "feedback", "positive"],
  ] as const)(
    "denies a tool for a signed completed %s result",
    async (_label, semantics, outcome) => {
      const data = await pluginData();
      await installSignedTerminalEvidence(data, "completed", {
        semantics,
        outcome,
        authorized: false,
      });
      expect(run(data)).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
        },
      });
    },
  );
});
