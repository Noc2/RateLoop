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
const updaterPath = join(hookRoot, "rateloop-advisory-state-update.mjs");
const stopPath = join(hookRoot, "rateloop-advisory-stop-gate.mjs");
const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "codex-hooks-v2",
);
const contractDirectory = "review-stop-gate-v1";
const temporaryDirectories: string[] = [];

async function fixture() {
  return JSON.parse(
    await readFile(join(fixtureRoot, "evaluate-skipped.json"), "utf8"),
  ) as Record<string, any>;
}

async function pluginData() {
  const path = await mkdtemp(join(tmpdir(), "rateloop-advisory-hook-"));
  temporaryDirectories.push(path);
  return path;
}

function runScript(script: string, data: string, input: Record<string, any>) {
  const result = spawnSync(process.execPath, [script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PLUGIN_DATA: data, PLUGIN_ROOT: pluginRoot },
    input: JSON.stringify(input),
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout.trim() === ""
    ? null
    : (JSON.parse(result.stdout) as Record<string, any>);
}

function statePath(data: string, sessionId = "session_advisory_01") {
  return join(data, contractDirectory, "sessions", `${sessionId}.json`);
}

function connectionPath(data: string) {
  return join(data, contractDirectory, "connection.json");
}

async function state(data: string) {
  return JSON.parse(await readFile(statePath(data), "utf8")) as Record<
    string,
    any
  >;
}

async function connectionState(data: string) {
  return JSON.parse(await readFile(connectionPath(data), "utf8")) as Record<
    string,
    any
  >;
}

function connectionInput(
  tool: "connect_workspace" | "verify_connection" = "connect_workspace",
  input: {
    integrationId?: string;
    sessionId?: string;
    turnId?: string;
    toolUseId?: string;
    workspaceId?: string;
  } = {},
): Record<string, any> {
  const verification = {
    schemaVersion: "rateloop.connection-verification.v1",
    connection: {
      status: "connected",
      integrationId: input.integrationId ?? "integration_fixture_01",
      workspaceId: input.workspaceId ?? "workspace_fixture_01",
      agentId: "agent_fixture_01",
      agentVersionId: "version_fixture_01",
      reportedLane: "plugin-with-hooks",
    },
    reportedLaneStatement:
      "Connected via RateLoop plugin — host-reported; hook presence is not verified.",
    safeAccess: {
      canCheckReviewRequirement: true,
      canSpend: false,
      canPublish: false,
      canReadPrivateArtifacts: false,
      canAdministerWorkspace: false,
    },
    verifiedAt: "2026-07-21T12:00:00.000Z",
  };
  return {
    session_id: input.sessionId ?? "session_advisory_01",
    turn_id: input.turnId ?? "turn_advisory_01",
    transcript_path: "/must/not/be/read/transcript.jsonl",
    cwd: "/fixture/workspace",
    hook_event_name: "PostToolUse",
    permission_mode: "default",
    model: "gpt-5.4",
    tool_name: `mcp__rateloop-workspace__rateloop_${tool}`,
    tool_use_id: input.toolUseId ?? "tool_connection_01",
    tool_input:
      tool === "connect_workspace"
        ? {
            connectionUrl:
              "https://rateloop-tokenless.vercel.app/connect/aci_fixture#claim=must-not-persist",
            reportedLane: "plugin-with-hooks",
          }
        : {},
    tool_response: {
      content: [{ type: "text", text: "This field is deliberately ignored." }],
      structuredContent:
        tool === "connect_workspace"
          ? {
              schemaVersion: "rateloop.workspace-connection.v1",
              connected: true,
              idempotent: false,
              connection: verification.connection,
              context: { enforcementBoundary: "advisory" },
              verification,
              nextAction: "follow_bound_policy",
            }
          : verification,
    },
  };
}

function stopInput(turnId = "turn_advisory_01") {
  return {
    session_id: "session_advisory_01",
    turn_id: turnId,
    transcript_path: "/must/not/be/read/transcript.jsonl",
    cwd: "/fixture/workspace",
    hook_event_name: "Stop",
    permission_mode: "default",
    model: "gpt-5.4",
  };
}

function lifecycle(
  input: Record<string, any>,
  next: string,
  revision: number,
  terminal = false,
) {
  const enteredAt = Date.now() - 60_000 + revision * 1_000;
  input.tool_response.structuredContent.lifecycle = {
    state: next,
    revision,
    terminal,
    reasonCodes: [`fixture_${next}`],
    stateEnteredAt: new Date(enteredAt).toISOString(),
  };
  input.tool_response.structuredContent.decision =
    next === "skipped" ? "skip" : "required";
  return input;
}

function asTool(input: Record<string, any>, tool: string, toolUseId: string) {
  input.tool_name = `mcp__rateloop-workspace__rateloop_${tool}`;
  input.tool_use_id = toolUseId;
  input.tool_input =
    tool === "evaluate_review_requirement"
      ? { externalOpportunityId: "external_fixture_01" }
      : { opportunityId: input.tool_response.structuredContent.opportunityId };
  return input;
}

async function installKeyring(data: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = "advisory-test-key";
  const path = join(data, contractDirectory, "trusted-keys.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    `${JSON.stringify({
      schemaVersion: "rateloop.stop-gate-trusted-keys.v1",
      keys: [
        {
          keyId,
          algorithm: "Ed25519",
          publicKeyJwk: publicKey.export({ format: "jwk" }),
        },
      ],
    })}\n`,
    "utf8",
  );
  return { keyId, privateKey };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("RateLoop advisory PostToolUse integration", () => {
  it("uses only supported PostToolUse fields and identifies itself as advisory", async () => {
    const config = JSON.parse(
      await readFile(join(hookRoot, "hooks.json"), "utf8"),
    ) as Record<string, any>;
    const contract = await readFile(
      join(hookRoot, "ADVISORY_STATE_CONTRACT.md"),
      "utf8",
    );
    const updater = await readFile(updaterPath, "utf8");
    const stop = await readFile(stopPath, "utf8");
    const schema = JSON.parse(
      await readFile(
        join(
          hookRoot,
          "schemas",
          "rateloop-advisory-stop-gate-state.schema.json",
        ),
        "utf8",
      ),
    ) as Record<string, any>;
    const connectionSchema = JSON.parse(
      await readFile(
        join(
          hookRoot,
          "schemas",
          "rateloop-advisory-connection-state.schema.json",
        ),
        "utf8",
      ),
    ) as Record<string, any>;

    expect(config.hooks.PostToolUse[0].matcher).toContain(
      "connect_workspace",
    );
    expect(config.hooks.PostToolUse[0].matcher).toContain(
      "verify_connection",
    );
    expect(config.hooks.PostToolUse[0].matcher).toContain(
      "evaluate_review_requirement",
    );
    expect(config.hooks.PostToolUse[0].hooks[0].type).toBe("command");
    expect(config.hooks.Stop[0].hooks[0].command).toContain(
      "rateloop-advisory-stop-gate.mjs",
    );
    expect(contract).toContain("separately reviewable, trustable, disableable");
    expect(contract).toContain("is not verified host enforcement");
    expect(schema.$id).toContain("rateloop-advisory-stop-gate-state.v2.json");
    expect(connectionSchema.$id).toContain(
      "rateloop-advisory-connection-state.v1.json",
    );
    for (const source of [updater, stop]) {
      expect(source).not.toContain("transcript_path");
      expect(source).not.toContain("sourcePayload");
      expect(source).not.toContain("suggestionPayload");
      expect(source).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("fails closed after setup when a later turn has no review evaluation", async () => {
    const data = await pluginData();
    const connected = connectionInput();

    expect(runScript(updaterPath, data, connected)).toBeNull();
    expect(await connectionState(data)).toEqual({
      schemaVersion: "rateloop.advisory-connection-state.v1",
      active: true,
      workspaceId: "workspace_fixture_01",
      integrationId: "integration_fixture_01",
      setupSessionId: "session_advisory_01",
      setupTurnId: "turn_advisory_01",
      verifiedAt: "2026-07-21T12:00:00.000Z",
      lastToolUseId: "tool_connection_01",
    });
    expect(await readFile(connectionPath(data), "utf8")).not.toContain(
      "must-not-persist",
    );
    expect(runScript(stopPath, data, stopInput())).toBeNull();
    expect(runScript(stopPath, data, stopInput("turn_advisory_02"))).toEqual(
      expect.objectContaining({
        continue: false,
        stopReason: "RateLoop advisory review gate: evaluation_missing",
      }),
    );

    const pending = lifecycle(await fixture(), "pending", 1);
    pending.turn_id = "turn_advisory_02";
    expect(runScript(updaterPath, data, pending)).toBeNull();
    expect(
      runScript(stopPath, data, stopInput("turn_advisory_02"))?.stopReason,
    ).toBe("RateLoop advisory review gate: review_pending");
    expect(
      runScript(stopPath, data, stopInput("turn_advisory_03"))?.stopReason,
    ).toBe("RateLoop advisory review gate: evaluation_missing");
  });

  it("does not let idempotent verification move the setup-turn exemption", async () => {
    const data = await pluginData();
    expect(runScript(updaterPath, data, connectionInput())).toBeNull();
    expect(
      runScript(
        updaterPath,
        data,
        connectionInput("verify_connection", {
          turnId: "turn_advisory_02",
          toolUseId: "tool_connection_02",
        }),
      ),
    ).toBeNull();

    expect(await connectionState(data)).toEqual(
      expect.objectContaining({
        setupTurnId: "turn_advisory_01",
        lastToolUseId: "tool_connection_01",
      }),
    );
    expect(
      runScript(stopPath, data, stopInput("turn_advisory_02"))?.stopReason,
    ).toBe("RateLoop advisory review gate: evaluation_missing");
  });

  it("replaces the marker only for a verified different integration", async () => {
    const data = await pluginData();
    expect(runScript(updaterPath, data, connectionInput())).toBeNull();
    expect(
      runScript(
        updaterPath,
        data,
        connectionInput("verify_connection", {
          integrationId: "integration_fixture_02",
          workspaceId: "workspace_fixture_02",
          turnId: "turn_advisory_02",
          toolUseId: "tool_connection_02",
        }),
      ),
    ).toBeNull();

    expect(await connectionState(data)).toEqual(
      expect.objectContaining({
        workspaceId: "workspace_fixture_02",
        integrationId: "integration_fixture_02",
        setupTurnId: "turn_advisory_02",
        lastToolUseId: "tool_connection_02",
      }),
    );
    expect(runScript(stopPath, data, stopInput("turn_advisory_02"))).toBeNull();
    expect(
      runScript(stopPath, data, stopInput("turn_advisory_03"))?.stopReason,
    ).toBe("RateLoop advisory review gate: evaluation_missing");
  });

  it("fails closed for invalid connection state and connection-review mismatch", async () => {
    const invalidData = await pluginData();
    await mkdir(dirname(connectionPath(invalidData)), { recursive: true });
    await writeFile(connectionPath(invalidData), '{"active":true}\n', "utf8");
    expect(runScript(stopPath, invalidData, stopInput())?.stopReason).toBe(
      "RateLoop advisory review gate: connection_state_invalid_recovery_required",
    );
    expect(
      runScript(
        updaterPath,
        invalidData,
        connectionInput("verify_connection", {
          turnId: "turn_advisory_02",
          toolUseId: "tool_connection_repair",
        }),
      ),
    ).toBeNull();
    expect(
      runScript(stopPath, invalidData, stopInput("turn_advisory_03"))
        ?.stopReason,
    ).toBe("RateLoop advisory review gate: evaluation_missing");

    const mismatchData = await pluginData();
    const pending = lifecycle(await fixture(), "pending", 1);
    expect(runScript(updaterPath, mismatchData, pending)).toBeNull();
    expect(
      runScript(
        updaterPath,
        mismatchData,
        connectionInput("verify_connection", {
          integrationId: "integration_fixture_02",
          workspaceId: "workspace_fixture_02",
        }),
      ),
    ).toBeNull();
    expect(runScript(stopPath, mismatchData, stopInput())?.stopReason).toBe(
      "RateLoop advisory review gate: connection_review_binding_mismatch_recovery_required",
    );
  });

  it("does not activate omission checking from a failed connection", async () => {
    const data = await pluginData();
    const failed = connectionInput();
    failed.tool_response.isError = true;
    expect(runScript(updaterPath, data, failed)?.systemMessage).toContain(
      "mcp_tool_failed",
    );
    expect(runScript(stopPath, data, stopInput("turn_advisory_02"))).toBeNull();
  });

  it("keeps an unsigned selection skip armed and fails closed", async () => {
    const data = await pluginData();
    const input = await fixture();
    expect(runScript(updaterPath, data, input)?.systemMessage).toContain(
      "skip_release_evidence_missing_recovery_required",
    );
    expect(await state(data)).toEqual(
      expect.objectContaining({
        armed: true,
        lifecycle: "skipped",
        scopeCommitment: null,
        terminalEvidence: null,
      }),
    );
    expect(runScript(stopPath, data, stopInput())?.stopReason).toBe(
      "RateLoop advisory review gate: skip_release_evidence_missing_recovery_required",
    );
  });

  it("disarms only for a signed skip release bound to scope, policy, and output", async () => {
    const data = await pluginData();
    expect(runScript(updaterPath, data, connectionInput())).toBeNull();
    const input = await fixture();
    expect(runScript(updaterPath, data, input)?.systemMessage).toContain(
      "skip_release_evidence_missing_recovery_required",
    );
    expect(await state(data)).toEqual(
      expect.objectContaining({ armed: true, lifecycle: "skipped" }),
    );
    const { keyId, privateKey } = await installKeyring(data);
    const release = {
      schemaVersion: "rateloop.human-review-skip-release-evidence.v1",
      keyId,
      payload: {
        schemaVersion: "rateloop.human-review-skip-release-payload.v1",
        workspaceId: input.tool_response.structuredContent.workspaceId,
        integrationId: input.tool_response.structuredContent.integrationId,
        opportunityId: input.tool_response.structuredContent.opportunityId,
        decision: "skipped",
        terminalStatus: "skipped",
        outputCommitment:
          input.tool_response.structuredContent.frozen.evaluationCommitment,
        policyBindingHash:
          input.tool_response.structuredContent.frozen.binding.hash,
        scopeCommitment: `sha256:${"4".repeat(64)}`,
        issuedAt: new Date().toISOString(),
      },
      signature: "",
    };
    const stopModule = (await import(pathToFileURL(stopPath).href)) as {
      advisoryTerminalPayload(value: Record<string, any>): Buffer;
    };
    release.signature = sign(
      null,
      stopModule.advisoryTerminalPayload(release),
      privateKey,
    ).toString("base64url");
    input.tool_response.structuredContent.terminalEvidence = release;

    expect(runScript(updaterPath, data, input)).toBeNull();
    expect(await state(data)).toEqual(
      expect.objectContaining({
        armed: false,
        lifecycle: "skipped",
        scopeCommitment: release.payload.scopeCommitment,
      }),
    );
    expect(runScript(stopPath, data, stopInput())).toBeNull();
    expect(
      runScript(stopPath, data, stopInput("turn_advisory_02"))?.stopReason,
    ).toBe("RateLoop advisory review gate: evaluation_missing");

    const tampered = await state(data);
    tampered.scopeCommitment = `sha256:${"5".repeat(64)}`;
    await writeFile(statePath(data), `${JSON.stringify(tampered)}\n`, "utf8");
    expect(runScript(stopPath, data, stopInput())?.stopReason).toBe(
      "RateLoop advisory review gate: skip_release_evidence_invalid_recovery_required",
    );
  });

  it("rejects a conflicting non-terminal envelope at the same lifecycle revision", async () => {
    const data = await pluginData();
    const pending = lifecycle(await fixture(), "pending", 1);
    pending.tool_response.structuredContent.continuation = {
      cursor: "cursor_fixture_01",
      retryAfterMs: 1_000,
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    expect(runScript(updaterPath, data, pending)).toBeNull();
    const before = await readFile(statePath(data), "utf8");

    const conflict = asTool(
      lifecycle(await fixture(), "pending", 1),
      "wait_for_review",
      "tool_conflict_01",
    );
    conflict.tool_response.structuredContent.continuation = {
      cursor: "cursor_conflicting_same_revision",
      retryAfterMs: 2_000,
      expiresAt: "2099-01-02T00:00:00.000Z",
    };
    expect(runScript(updaterPath, data, conflict)?.systemMessage).toContain(
      "lifecycle_revision_conflict",
    );
    expect(await readFile(statePath(data), "utf8")).toBe(before);
  });

  it.each(["approval_required", "request_ready", "pending"])(
    "arms an advisory Stop gate for %s",
    async (next) => {
      const data = await pluginData();
      const input = lifecycle(await fixture(), next, 1);
      if (next === "pending") {
        input.tool_response.structuredContent.continuation = {
          cursor: "cursor_fixture_01",
          retryAfterMs: 1_000,
          expiresAt: "2099-01-01T00:00:00.000Z",
        };
      }
      expect(runScript(updaterPath, data, input)).toBeNull();
      expect(await state(data)).toEqual(
        expect.objectContaining({ armed: true, lifecycle: next }),
      );
      expect(runScript(stopPath, data, stopInput())).toEqual(
        expect.objectContaining({
          continue: false,
          stopReason: `RateLoop advisory review gate: review_${next}`,
        }),
      );
    },
  );

  it("releases an armed gate only after matching signed terminal evidence", async () => {
    const data = await pluginData();
    const pending = lifecycle(await fixture(), "pending", 1);
    pending.tool_response.structuredContent.continuation = {
      cursor: "cursor_fixture_01",
      retryAfterMs: 1_000,
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    expect(runScript(updaterPath, data, pending)).toBeNull();

    const result = asTool(
      lifecycle(await fixture(), "completed", 2, true),
      "get_review_result",
      "tool_result_02",
    );
    result.turn_id = "turn_advisory_02";
    const missingEvidence = runScript(updaterPath, data, result);
    expect(missingEvidence?.systemMessage).toContain(
      "terminal_evidence_missing_recovery_required",
    );
    expect(
      runScript(stopPath, data, stopInput("turn_advisory_02"))?.stopReason,
    ).toBe(
      "RateLoop advisory review gate: terminal_evidence_missing_recovery_required",
    );

    const { keyId, privateKey } = await installKeyring(data);
    const evidence = {
      schemaVersion: "rateloop.human-review-terminal-evidence.v1",
      keyId,
      payload: {
        schemaVersion: "rateloop.human-review-terminal-payload.v1",
        workspaceId: result.tool_response.structuredContent.workspaceId,
        integrationId: result.tool_response.structuredContent.integrationId,
        opportunityId: result.tool_response.structuredContent.opportunityId,
        terminalStatus: "completed",
        outputCommitment:
          result.tool_response.structuredContent.frozen.evaluationCommitment,
        policyBindingHash:
          result.tool_response.structuredContent.frozen.binding.hash,
        issuedAt: new Date().toISOString(),
      },
      signature: "",
    };
    const stopModule = (await import(pathToFileURL(stopPath).href)) as {
      advisoryTerminalPayload(value: Record<string, any>): Buffer;
    };
    evidence.signature = sign(
      null,
      stopModule.advisoryTerminalPayload(evidence),
      privateKey,
    ).toString("base64url");
    result.tool_response.structuredContent.terminalEvidence = evidence;
    result.tool_use_id = "tool_result_03";
    expect(runScript(updaterPath, data, result)).toBeNull();
    expect(runScript(stopPath, data, stopInput("turn_advisory_02"))).toBeNull();
  });

  it.each(["inconclusive", "failed_terminal", "cancelled_before_commit"])(
    "does not release on a signed %s terminal receipt",
    async (terminalStatus) => {
      const data = await pluginData();
      const pending = lifecycle(await fixture(), "pending", 1);
      pending.tool_response.structuredContent.continuation = {
        cursor: "cursor_fixture_01",
        retryAfterMs: 1_000,
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
      expect(runScript(updaterPath, data, pending)).toBeNull();

      const result = asTool(
        lifecycle(await fixture(), terminalStatus, 2, true),
        "get_review_result",
        `tool_result_${terminalStatus}`,
      );
      result.turn_id = "turn_advisory_02";
      const { keyId, privateKey } = await installKeyring(data);
      const evidence = {
        schemaVersion: "rateloop.human-review-terminal-evidence.v1",
        keyId,
        payload: {
          schemaVersion: "rateloop.human-review-terminal-payload.v1",
          workspaceId: result.tool_response.structuredContent.workspaceId,
          integrationId: result.tool_response.structuredContent.integrationId,
          opportunityId: result.tool_response.structuredContent.opportunityId,
          terminalStatus,
          outputCommitment:
            result.tool_response.structuredContent.frozen.evaluationCommitment,
          policyBindingHash:
            result.tool_response.structuredContent.frozen.binding.hash,
          issuedAt: new Date().toISOString(),
        },
        signature: "",
      };
      const stopModule = (await import(pathToFileURL(stopPath).href)) as {
        advisoryTerminalPayload(value: Record<string, any>): Buffer;
      };
      evidence.signature = sign(
        null,
        stopModule.advisoryTerminalPayload(evidence),
        privateKey,
      ).toString("base64url");
      result.tool_response.structuredContent.terminalEvidence = evidence;

      expect(runScript(updaterPath, data, result)).toBeNull();
      expect(runScript(stopPath, data, stopInput("turn_advisory_02"))).toEqual(
        expect.objectContaining({
          continue: false,
          stopReason: `RateLoop advisory review gate: terminal_${terminalStatus}_does_not_release`,
        }),
      );
    },
  );

  it("rejects workspace, opportunity, and local session mismatches", async () => {
    const data = await pluginData();
    const pending = lifecycle(await fixture(), "pending", 1);
    expect(runScript(updaterPath, data, pending)).toBeNull();
    const before = await readFile(statePath(data), "utf8");

    const wrongWorkspace = asTool(
      lifecycle(await fixture(), "pending", 2),
      "wait_for_review",
      "tool_wait_02",
    );
    wrongWorkspace.tool_response.structuredContent.workspaceId =
      "workspace_fixture_other";
    expect(
      runScript(updaterPath, data, wrongWorkspace)?.systemMessage,
    ).toContain("workspace_integration_mismatch");
    expect(await readFile(statePath(data), "utf8")).toBe(before);

    const wrongIntegration = asTool(
      lifecycle(await fixture(), "pending", 2),
      "wait_for_review",
      "tool_wait_02b",
    );
    wrongIntegration.tool_response.structuredContent.integrationId =
      "integration_fixture_other";
    expect(
      runScript(updaterPath, data, wrongIntegration)?.systemMessage,
    ).toContain("workspace_integration_mismatch");
    expect(await readFile(statePath(data), "utf8")).toBe(before);

    const wrongOpportunity = asTool(
      lifecycle(await fixture(), "pending", 2),
      "wait_for_review",
      "tool_wait_03",
    );
    wrongOpportunity.tool_input.opportunityId = "opportunity_fixture_other";
    expect(
      runScript(updaterPath, data, wrongOpportunity)?.systemMessage,
    ).toContain("tool_opportunity_mismatch");
    expect(await readFile(statePath(data), "utf8")).toBe(before);

    const conflictingSkip = lifecycle(await fixture(), "skipped", 2, true);
    conflictingSkip.tool_use_id = "tool_conflicting_skip";
    expect(
      runScript(updaterPath, data, conflictingSkip)?.systemMessage,
    ).toContain("armed_opportunity_cannot_be_skipped");
    expect(await readFile(statePath(data), "utf8")).toBe(before);

    const corrupted = JSON.parse(before) as Record<string, any>;
    corrupted.sessionId = "session_advisory_other";
    await writeFile(statePath(data), `${JSON.stringify(corrupted)}\n`, "utf8");
    const currentBytes = await readFile(statePath(data), "utf8");
    const next = asTool(
      lifecycle(await fixture(), "pending", 2),
      "wait_for_review",
      "tool_wait_04",
    );
    expect(runScript(updaterPath, data, next)?.systemMessage).toContain(
      "state_session_turn_mismatch",
    );
    expect(await readFile(statePath(data), "utf8")).toBe(currentBytes);
  });

  it("leaves the prior armed state unchanged when the MCP tool fails", async () => {
    const data = await pluginData();
    const pending = lifecycle(await fixture(), "pending", 1);
    expect(runScript(updaterPath, data, pending)).toBeNull();
    const before = await readFile(statePath(data), "utf8");
    const failed = asTool(
      lifecycle(await fixture(), "pending", 2),
      "wait_for_review",
      "tool_wait_failed",
    );
    failed.tool_response.isError = true;
    expect(runScript(updaterPath, data, failed)?.systemMessage).toContain(
      "mcp_tool_failed",
    );
    expect(await readFile(statePath(data), "utf8")).toBe(before);
  });
});
