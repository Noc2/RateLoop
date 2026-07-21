#!/usr/bin/env node

import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateAdvisoryGateState,
  verifyAdvisoryTerminalEvidence,
} from "./rateloop-advisory-stop-gate.mjs";

const CONTRACT_DIRECTORY = "review-stop-gate-v1";
const MAX_FILE_BYTES = 64 * 1024;
const LOCAL_IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function emitDecision(permissionDecision, reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision,
        permissionDecisionReason: reason,
      },
      systemMessage: reason,
    })}\n`,
  );
}

function validateInput(value) {
  if (!isRecord(value) || value.hook_event_name !== "PreToolUse") return null;
  if (
    !LOCAL_IDENTIFIER.test(value.session_id) ||
    typeof value.tool_name !== "string" ||
    value.tool_name.length < 1 ||
    value.tool_name.length > 240
  ) {
    return null;
  }
  if (/^mcp__rateloop[-_]workspace__rateloop_/u.test(value.tool_name)) {
    return null;
  }
  return { sessionId: value.session_id };
}

async function main() {
  // This hook returns Claude-specific permissionDecision values. The shared
  // plugin can also be installed by Codex, where the existing Stop gate stays
  // active and this script deliberately emits nothing.
  if (!process.env.CLAUDE_PLUGIN_ROOT && !process.env.CLAUDE_PLUGIN_DATA)
    return;
  let input;
  try {
    input = validateInput(JSON.parse(await readStdin()));
  } catch {
    return;
  }
  if (!input) return;

  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (!pluginData) {
    emitDecision(
      "deny",
      "RateLoop cannot read its Claude approval state. Reconnect the workspace or use the separately authorized recovery path.",
    );
    return;
  }
  const contractRoot = join(pluginData, CONTRACT_DIRECTORY);
  const statePath = join(contractRoot, "sessions", `${input.sessionId}.json`);
  let state;
  try {
    const raw = await readBoundedJson(statePath, contractRoot);
    state = validateAdvisoryGateState(
      raw,
      { sessionId: input.sessionId, turnId: raw.turnId },
      { allowPriorTurn: true },
    );
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return;
    emitDecision(
      "deny",
      "RateLoop approval state is invalid or unreadable. Refresh the exact opportunity before running this tool.",
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
      if (evidence.payload.terminalStatus === "skipped") return;
    } catch {
      // Fall through to a fail-closed denial below.
    }
    emitDecision(
      "deny",
      "RateLoop selection skip release evidence is invalid. Refresh the exact opportunity before running this tool.",
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
      emitDecision(
        "deny",
        "RateLoop signed a terminal result that does not explicitly authorize the candidate. Negative, feedback, inconclusive, failed, and cancelled results never authorize this tool.",
      );
      return;
    } catch {
      emitDecision(
        "deny",
        "RateLoop terminal evidence is invalid. Fetch the signed terminal result again before running this tool.",
      );
      return;
    }
  }
  if (state.lifecycleTerminal || Date.now() >= Date.parse(state.expiresAt)) {
    emitDecision(
      "deny",
      "RateLoop review has no valid signed release evidence. Refresh the review or use the separately authorized recovery path.",
    );
    return;
  }
  emitDecision(
    "defer",
    "RateLoop review is required or pending. Complete the exact owner approval or review, then resume this Claude session; the same tool call will be checked again.",
  );
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedUrl === import.meta.url) {
  main().catch(() => {
    emitDecision(
      "deny",
      "RateLoop approval checking failed safely. Repair or explicitly recover the gate before running this tool.",
    );
  });
}
