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
const scriptPath = join(hookRoot, "rateloop-stop-gate.mjs");
const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "codex-hooks",
);
const contractDirectory = "review-stop-gate-v1";
const temporaryDirectories: string[] = [];

async function fixture(name: string) {
  return JSON.parse(await readFile(join(fixtureRoot, name), "utf8")) as Record<
    string,
    any
  >;
}

async function runHook(options: {
  state?: Record<string, any>;
  keyring?: Record<string, any>;
  event?: Record<string, any>;
}) {
  const pluginData = await mkdtemp(join(tmpdir(), "rateloop-stop-hook-"));
  temporaryDirectories.push(pluginData);
  const event = options.event ?? (await fixture("stop-event.json"));
  if (options.state) {
    const statePath = join(
      pluginData,
      contractDirectory,
      "sessions",
      `${event.session_id}.json`,
    );
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, `${JSON.stringify(options.state)}\n`, "utf8");
  }
  if (options.keyring) {
    const keyringPath = join(
      pluginData,
      contractDirectory,
      "trusted-keys.json",
    );
    await mkdir(dirname(keyringPath), { recursive: true });
    await writeFile(
      keyringPath,
      `${JSON.stringify(options.keyring)}\n`,
      "utf8",
    );
  }

  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PLUGIN_DATA: pluginData, PLUGIN_ROOT: pluginRoot },
    input: JSON.stringify(event),
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout.trim() === ""
    ? null
    : (JSON.parse(result.stdout) as Record<string, any>);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("RateLoop Codex Stop hook", () => {
  it("bundles the current command Stop-hook shape with separate trust guidance", async () => {
    const manifest = JSON.parse(
      await readFile(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"),
    ) as Record<string, any>;
    const config = JSON.parse(
      await readFile(join(hookRoot, "hooks.json"), "utf8"),
    ) as Record<string, any>;
    const stateSchema = JSON.parse(
      await readFile(
        join(hookRoot, "schemas", "rateloop-stop-gate-state.schema.json"),
        "utf8",
      ),
    ) as Record<string, any>;
    const keyringSchema = JSON.parse(
      await readFile(
        join(
          hookRoot,
          "schemas",
          "rateloop-stop-gate-trusted-keys.schema.json",
        ),
        "utf8",
      ),
    ) as Record<string, any>;
    const readme = await readFile(join(hookRoot, "README.md"), "utf8");
    const script = await readFile(scriptPath, "utf8");

    // Codex discovers this default plugin path without an unsupported manifest field.
    expect(manifest).not.toHaveProperty("hooks");
    expect(config).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "^(?!mcp__rateloop[-_]workspace__rateloop_).+",
            hooks: [
              {
                type: "command",
                command:
                  'node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/hooks/rateloop-claude-pre-tool-use.mjs"',
                commandWindows:
                  'if defined CLAUDE_PLUGIN_ROOT (node "%CLAUDE_PLUGIN_ROOT%\\hooks\\rateloop-claude-pre-tool-use.mjs") else (node "%PLUGIN_ROOT%\\hooks\\rateloop-claude-pre-tool-use.mjs")',
                timeout: 5,
                statusMessage: "Checking RateLoop approval before tool use",
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher:
              "^mcp__rateloop[-_]workspace__rateloop_(connect_workspace|verify_connection|evaluate_review_requirement|request_review|wait_for_review|get_review_result)$",
            hooks: [
              {
                type: "command",
                command:
                  'node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/hooks/rateloop-advisory-state-update.mjs"',
                commandWindows:
                  'if defined CLAUDE_PLUGIN_ROOT (node "%CLAUDE_PLUGIN_ROOT%\\hooks\\rateloop-advisory-state-update.mjs") else (node "%PLUGIN_ROOT%\\hooks\\rateloop-advisory-state-update.mjs")',
                timeout: 5,
                statusMessage:
                  "Updating advisory RateLoop connection or review state",
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  'node "${CLAUDE_PLUGIN_ROOT:-$PLUGIN_ROOT}/hooks/rateloop-advisory-stop-gate.mjs"',
                commandWindows:
                  'if defined CLAUDE_PLUGIN_ROOT (node "%CLAUDE_PLUGIN_ROOT%\\hooks\\rateloop-advisory-stop-gate.mjs") else (node "%PLUGIN_ROOT%\\hooks\\rateloop-advisory-stop-gate.mjs")',
                timeout: 5,
                statusMessage: "Checking advisory RateLoop review state",
              },
            ],
          },
        ],
      },
    });
    expect(stateSchema.$id).toContain("rateloop-stop-gate-state.v1.json");
    expect(stateSchema.properties.lifecycle.enum).toEqual([
      "approval_required",
      "request_ready",
      "pending",
      "blocked",
    ]);
    expect(keyringSchema.$id).toContain(
      "rateloop-stop-gate-trusted-keys.v1.json",
    );
    expect(keyringSchema.properties.keys.items.properties.algorithm.const).toBe(
      "Ed25519",
    );
    expect(readme).toContain(
      "separately reviews and trusts the exact hook definition",
    );
    expect(readme).toContain("does not make the integration host-enforced");
    expect(readme).toContain("deliberately ignore `transcript_path`");
    expect(script).not.toContain("transcript_path");
    expect(script).not.toMatch(/\bfetch\s*\(/);
    expect(script).not.toContain("sourcePayload");
    expect(script).not.toContain("suggestionPayload");
  });

  it("continues when no gate is armed", async () => {
    expect(await runHook({})).toBeNull();
    expect(
      await runHook({ state: await fixture("disarmed-state.json") }),
    ).toBeNull();
  });

  it("blocks Stop for an armed required or pending review", async () => {
    const output = await runHook({
      state: await fixture("pending-state.json"),
    });
    expect(output).toEqual(
      expect.objectContaining({
        continue: false,
        stopReason: "RateLoop review gate: review_pending",
      }),
    );
  });

  it("fails closed after expiry and requires explicit recovery", async () => {
    const output = await runHook({
      state: await fixture("expired-pending-state.json"),
    });
    expect(output).toEqual(
      expect.objectContaining({
        continue: false,
        stopReason: "RateLoop review gate: state_expired_recovery_required",
      }),
    );
    expect(output?.systemMessage).toContain("Time does not authorize release");
  });

  it("continues only when terminal evidence matches and verifies", async () => {
    const state = await fixture("pending-state.json");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const keyId = "test-key-1";
    const evidence = {
      schemaVersion: "rateloop.stop-gate-terminal.v1",
      gateId: state.gateId,
      sessionId: state.sessionId,
      opportunityId: state.opportunityId,
      terminalStatus: "completed",
      outputCommitment: state.outputCommitment,
      policyBindingHash: state.policyBindingHash,
      issuedAt: "2026-07-16T12:00:00.000Z",
      keyId,
      signature: "",
    };
    const hookModule = (await import(pathToFileURL(scriptPath).href)) as {
      terminalEvidencePayload(value: Record<string, any>): Buffer;
    };
    evidence.signature = sign(
      null,
      hookModule.terminalEvidencePayload(evidence),
      privateKey,
    ).toString("base64url");
    state.terminalEvidence = evidence;
    const keyring = {
      schemaVersion: "rateloop.stop-gate-trusted-keys.v1",
      keys: [
        {
          keyId,
          algorithm: "Ed25519",
          publicKeyJwk: publicKey.export({ format: "jwk" }),
        },
      ],
    };

    expect(await runHook({ state, keyring })).toBeNull();

    state.terminalEvidence = { ...evidence, terminalStatus: "inconclusive" };
    const rejected = await runHook({ state, keyring });
    expect(rejected?.continue).toBe(false);
    expect(rejected?.stopReason).toBe(
      "RateLoop review gate: terminal_evidence_invalid_recovery_required",
    );
  });

  it("accepts the documented punctuation in trusted key identifiers", async () => {
    const state = await fixture("pending-state.json");
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const evidence = {
      schemaVersion: "rateloop.stop-gate-terminal.v1",
      gateId: state.gateId,
      sessionId: state.sessionId,
      opportunityId: state.opportunityId,
      terminalStatus: "completed",
      outputCommitment: state.outputCommitment,
      policyBindingHash: state.policyBindingHash,
      issuedAt: "2026-07-16T12:00:00.000Z",
      keyId: "rateloop.test:key-1",
      signature: "",
    };
    const hookModule = (await import(pathToFileURL(scriptPath).href)) as {
      terminalEvidencePayload(value: Record<string, any>): Buffer;
    };
    evidence.signature = sign(
      null,
      hookModule.terminalEvidencePayload(evidence),
      privateKey,
    ).toString("base64url");
    state.terminalEvidence = evidence;

    expect(
      await runHook({
        state,
        keyring: {
          schemaVersion: "rateloop.stop-gate-trusted-keys.v1",
          keys: [
            {
              keyId: evidence.keyId,
              algorithm: "Ed25519",
              publicKeyJwk: publicKey.export({ format: "jwk" }),
            },
          ],
        },
      }),
    ).toBeNull();
  });

  it("rejects a stale armed payload disguised as disarmed", async () => {
    const state = await fixture("pending-state.json");
    state.armed = false;
    const output = await runHook({ state });
    expect(output?.continue).toBe(false);
    expect(output?.stopReason).toBe(
      "RateLoop review gate: state_invalid_recovery_required",
    );
  });

  it("fails closed for malformed or turn-mismatched armed state", async () => {
    const state = await fixture("pending-state.json");
    state.turnId = "different_turn";
    const output = await runHook({ state });
    expect(output?.continue).toBe(false);
    expect(output?.stopReason).toBe(
      "RateLoop review gate: state_invalid_recovery_required",
    );
  });
});
