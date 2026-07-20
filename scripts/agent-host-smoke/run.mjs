#!/usr/bin/env node
/**
 * Agent-host smoke harness runner (agent-install plan Phase 5, item 2 — scaffold).
 *
 * This runner does NOT execute smoke tests and does NOT verify any host. The real
 * per-host runs need live pinned client installs (Codex desktop, Claude Code,
 * VS Code / Copilot Chat, Gemini CLI) plus a disposable workspace, and are performed
 * by an operator (or, later, an automated pipeline) following the per-host specs in
 * specs/. What this runner enforces, CI-runnably, is claims discipline:
 *
 *   - every per-host spec is well-formed and contains the full required step
 *     sequence (install -> auth -> lifecycle -> rateloop_get_agent_context ->
 *     rateloop_verify_connection -> resume-after-new-task);
 *   - no spec step claims automation that does not exist;
 *   - any recorded green-run artifact under results/ is well-formed evidence
 *     (pinned client version, operator, per-step pass status, evidence ref);
 *   - no host may be claimed "verified" -- in a spec, or (advisory textual check)
 *     in packages/nextjs/lib/tokenless/hostCapabilities.ts -- without a recorded
 *     green-run artifact. Any such claim exits non-zero.
 *
 * See README.md in this directory for how a host graduates tiers.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const harnessRoot = dirname(fileURLToPath(import.meta.url));
const specsDir = join(harnessRoot, "specs");
const resultsDir = join(harnessRoot, "results");
const registryPath = join(harnessRoot, "..", "..", "packages", "nextjs", "lib", "tokenless", "hostCapabilities.ts");

const REQUIRED_STEP_IDS = [
  "install",
  "auth",
  "lifecycle",
  "rateloop_get_agent_context",
  "rateloop_verify_connection",
  "resume-after-new-task",
];
const ALLOWED_CLAIMED_TIERS = new Set(["experimental", "supported", "verified"]);
const SPEC_SCHEMA_VERSION = "rateloop.host-smoke-spec.v1";
const RUN_SCHEMA_VERSION = "rateloop.host-smoke-run.v1";

const violations = [];

function violation(message) {
  violations.push(message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    violation(`${path}: unreadable or invalid JSON (${error.message})`);
    return null;
  }
}

function loadSpecs() {
  if (!existsSync(specsDir)) {
    violation(`missing specs directory: ${specsDir}`);
    return [];
  }
  const specs = [];
  for (const entry of readdirSync(specsDir).sort()) {
    if (!entry.endsWith(".json")) continue;
    const path = join(specsDir, entry);
    const spec = readJson(path);
    if (!isRecord(spec)) continue;
    if (spec.schemaVersion !== SPEC_SCHEMA_VERSION) {
      violation(`${path}: schemaVersion must be ${SPEC_SCHEMA_VERSION}`);
      continue;
    }
    if (typeof spec.hostId !== "string" || spec.hostId.length === 0) {
      violation(`${path}: hostId is required`);
      continue;
    }
    if (`${spec.hostId}.json` !== entry) {
      violation(`${path}: file name must match hostId "${spec.hostId}"`);
    }
    if (typeof spec.displayName !== "string" || spec.displayName.length === 0) {
      violation(`${path}: displayName is required`);
    }
    if (!ALLOWED_CLAIMED_TIERS.has(spec.claimedTier)) {
      violation(`${path}: claimedTier must be one of ${[...ALLOWED_CLAIMED_TIERS].join(", ")}`);
    }
    const steps = Array.isArray(spec.steps) ? spec.steps : [];
    const stepIds = steps.map(step => (isRecord(step) ? step.id : undefined));
    if (JSON.stringify(stepIds) !== JSON.stringify(REQUIRED_STEP_IDS)) {
      violation(`${path}: steps must be exactly [${REQUIRED_STEP_IDS.join(", ")}] in order (got [${stepIds.join(", ")}])`);
    }
    for (const step of steps) {
      if (!isRecord(step)) continue;
      if (typeof step.automated !== "boolean") {
        violation(`${path}: step "${step.id}" must declare automated: true|false`);
      } else if (step.automated === true) {
        // No automated per-host runner exists yet. A step may only claim automation
        // once it carries an executable command this runner can invoke.
        violation(`${path}: step "${step.id}" claims automated: true but no automated runner exists in this scaffold`);
      }
      if (typeof step.instructions !== "string" || step.instructions.length < 20) {
        violation(`${path}: step "${step.id}" needs operator instructions`);
      }
    }
    specs.push({ path, spec });
  }
  return specs;
}

function validateRunArtifact(path, run, spec) {
  if (!isRecord(run)) return null;
  const problems = [];
  if (run.schemaVersion !== RUN_SCHEMA_VERSION) problems.push(`schemaVersion must be ${RUN_SCHEMA_VERSION}`);
  if (run.hostId !== spec.hostId) problems.push(`hostId must be "${spec.hostId}"`);
  if (typeof run.clientVersion !== "string" || run.clientVersion.length === 0) {
    problems.push("clientVersion (the exact pinned client version exercised) is required");
  }
  if (typeof run.operator !== "string" || run.operator.length === 0) {
    problems.push("operator is required");
  }
  if (typeof run.recordedAt !== "string" || Number.isNaN(Date.parse(run.recordedAt))) {
    problems.push("recordedAt must be an ISO 8601 timestamp");
  }
  if (typeof run.evidenceRef !== "string" || run.evidenceRef.length === 0) {
    problems.push("evidenceRef (CI run, recording, or log reference) is required");
  }
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const stepStatusById = new Map();
  for (const step of steps) {
    if (isRecord(step) && typeof step.id === "string") stepStatusById.set(step.id, step.status);
  }
  for (const id of REQUIRED_STEP_IDS) {
    if (!stepStatusById.has(id)) problems.push(`missing step result for "${id}"`);
  }
  const allPass = REQUIRED_STEP_IDS.every(id => stepStatusById.get(id) === "pass");
  if (run.overall === "green" && !allPass) {
    problems.push('overall is "green" but not every required step recorded status "pass"');
  }
  for (const problem of problems) violation(`${path}: ${problem}`);
  if (problems.length > 0) return null;
  return run.overall === "green" && allPass ? run : null;
}

function greenRunsFor(spec) {
  const hostResultsDir = join(resultsDir, spec.hostId);
  if (!existsSync(hostResultsDir)) return [];
  const greens = [];
  for (const entry of readdirSync(hostResultsDir).sort()) {
    if (!entry.endsWith(".json")) continue;
    const path = join(hostResultsDir, entry);
    const green = validateRunArtifact(path, readJson(path), spec);
    if (green) greens.push({ path, run: green });
  }
  return greens;
}

/**
 * Advisory textual cross-check against the host-capability registry. The registry
 * (packages/nextjs/lib/tokenless/hostCapabilities.ts) is created in a parallel
 * commit and is intentionally NOT imported here; its own tests are the
 * authoritative tier gate. This heuristic only catches the blatant case of a
 * registry entry for a smoke-spec host being marked verified with no green run
 * recorded in this harness.
 */
function registryClaimsVerified(hostId) {
  if (!existsSync(registryPath)) return false;
  let source;
  try {
    source = readFileSync(registryPath, "utf8");
  } catch {
    return false;
  }
  const idIndex = source.indexOf(`"${hostId}"`);
  if (idIndex === -1) return false;
  const windowEnd = source.indexOf('id: "', idIndex + hostId.length + 2);
  const window = source.slice(idIndex, windowEnd === -1 ? idIndex + 1500 : windowEnd);
  return /supportTier:\s*["']verified["']/.test(window);
}

const specs = loadSpecs();

console.log("Agent-host smoke harness — scaffold status");
console.log("(This runner verifies claims discipline only; it does not run host smoke tests.)\n");

for (const { spec } of specs) {
  const greens = greenRunsFor(spec);
  const latest = greens[greens.length - 1];
  console.log(`${spec.displayName} [${spec.hostId}]`);
  console.log(`  claimed tier: ${spec.claimedTier}`);
  console.log(
    latest
      ? `  green runs: ${greens.length} (latest: ${latest.run.clientVersion} at ${latest.run.recordedAt})`
      : "  green runs: none recorded — this host is NOT verified",
  );
  for (const step of Array.isArray(spec.steps) ? spec.steps : []) {
    if (!isRecord(step)) continue;
    const mode = step.automated === true ? "automated" : "manual";
    console.log(`  [ ] ${step.id} (${mode}) — ${step.name ?? ""}`);
  }
  if (spec.claimedTier === "verified" && greens.length === 0) {
    violation(`${spec.hostId}: claimedTier is "verified" but no green run artifact exists under results/${spec.hostId}/`);
  }
  if (registryClaimsVerified(spec.hostId) && greens.length === 0) {
    violation(
      `${spec.hostId}: hostCapabilities.ts appears to mark this host verified but no green run artifact exists under results/${spec.hostId}/`,
    );
  }
  console.log("");
}

if (specs.length === 0) {
  violation("no host smoke specs found");
}

if (violations.length > 0) {
  console.error("Claims-discipline violations:");
  for (const message of violations) console.error(`  - ${message}`);
  process.exit(1);
}

console.log("No claims-discipline violations. No host is verified by this output; only recorded green runs count.");
