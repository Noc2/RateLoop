#!/usr/bin/env node

import { lstat, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildHostReleaseRequest,
  hostBindingCommitment,
  limits,
  materializeAuthorizedOutput,
  readBoundedRegularFile,
} from "./rateloop-host-output-gate.mjs";

const VALUE_OPTIONS = new Set([
  "candidate",
  "request",
  "evidence",
  "trusted-keys",
  "state-dir",
  "host-id",
  "session-id",
  "turn-id",
  "gate-id",
  "workspace-id",
  "integration-id",
  "opportunity-id",
  "decision",
  "policy-binding-hash",
  "scope-commitment",
  "ttl-seconds",
]);

function usage() {
  return `RateLoop host-owned output gate

Prepare a release challenge:
  node rateloop-host-output-gate-cli.mjs prepare \\
    --candidate <private-candidate-file> --request <new-request.json> \\
    --host-id <id> --session-id <id> --turn-id <id> --gate-id <id> \\
    --workspace-id <id> --integration-id <id> --opportunity-id <id> \\
    --decision <satisfied|skipped> --policy-binding-hash <sha256:...> \\
    --scope-commitment <sha256:...> [--ttl-seconds 900]

Materialize an authorized output:
  node rateloop-host-output-gate-cli.mjs release \\
    --candidate <private-candidate-file> --request <request.json> \\
    --evidence <server-evidence.json> --trusted-keys <keyring.json> \\
    --state-dir <host-owned-directory>

The candidate is never written to stdout. Only the release command creates a
consumer-visible output.bin, after exact signed evidence verifies.`;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (command !== "prepare" && command !== "release")
    throw new Error("command_invalid");
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const option = rest[index];
    const value = rest[index + 1];
    if (
      !option?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new Error("arguments_invalid");
    }
    const key = option.slice(2);
    if (!VALUE_OPTIONS.has(key) || options[key] !== undefined)
      throw new Error("arguments_invalid");
    options[key] = value;
  }
  return { command, options };
}

function requireOptions(options, keys) {
  for (const key of keys) {
    if (!options[key]) throw new Error(`missing_${key.replaceAll("-", "_")}`);
  }
}

async function jsonFile(path) {
  return JSON.parse(
    (
      await readBoundedRegularFile(resolve(path), limits.maxControlFileBytes, {
        ownerOnly: true,
      })
    ).toString("utf8"),
  );
}

async function assertHostOwnedDirectory(path) {
  const metadata = await lstat(path);
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    (currentUid !== null && metadata.uid !== currentUid) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error("host_private_directory_invalid");
  }
  return realpath(path);
}

async function assertOutsideCurrentWorkspace(path, { parent = false } = {}) {
  const [workspaceRoot, target] = await Promise.all([
    realpath(process.cwd()),
    parent ? assertHostOwnedDirectory(dirname(path)) : realpath(path),
  ]);
  const pathFromWorkspace = relative(workspaceRoot, target);
  if (
    pathFromWorkspace === "" ||
    (!pathFromWorkspace.startsWith("..") && !isAbsolute(pathFromWorkspace))
  ) {
    throw new Error("host_private_path_inside_agent_workspace");
  }
}

async function prepare(options) {
  requireOptions(options, [
    "candidate",
    "request",
    "host-id",
    "session-id",
    "turn-id",
    "gate-id",
    "workspace-id",
    "integration-id",
    "opportunity-id",
    "decision",
    "policy-binding-hash",
    "scope-commitment",
  ]);
  const candidatePath = resolve(options.candidate);
  const requestPath = resolve(options.request);
  await Promise.all([
    assertOutsideCurrentWorkspace(candidatePath),
    assertOutsideCurrentWorkspace(requestPath, { parent: true }),
  ]);
  const candidateBytes = await readBoundedRegularFile(
    candidatePath,
    limits.maxCandidateBytes,
    { ownerOnly: true },
  );
  const ttlSeconds =
    options["ttl-seconds"] === undefined ? 900 : Number(options["ttl-seconds"]);
  if (!Number.isSafeInteger(ttlSeconds)) throw new Error("ttl_seconds_invalid");
  const request = buildHostReleaseRequest(
    {
      hostId: options["host-id"],
      sessionId: options["session-id"],
      turnId: options["turn-id"],
      gateId: options["gate-id"],
      workspaceId: options["workspace-id"],
      integrationId: options["integration-id"],
      opportunityId: options["opportunity-id"],
      decision: options.decision,
      policyBindingHash: options["policy-binding-hash"],
      scopeCommitment: options["scope-commitment"],
      lifetimeMs: ttlSeconds * 1_000,
    },
    candidateBytes,
  );
  await writeFile(requestPath, `${JSON.stringify(request)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify({
      requestPath,
      releaseId: request.releaseId,
      outputCommitment: request.outputCommitment,
      hostBindingCommitment: hostBindingCommitment(request),
      expiresAt: request.expiresAt,
    })}\n`,
  );
}

async function release(options) {
  requireOptions(options, [
    "candidate",
    "request",
    "evidence",
    "trusted-keys",
    "state-dir",
  ]);
  const candidatePath = resolve(options.candidate);
  const requestPath = resolve(options.request);
  const evidencePath = resolve(options.evidence);
  const trustedKeysPath = resolve(options["trusted-keys"]);
  await Promise.all(
    [candidatePath, requestPath, evidencePath, trustedKeysPath].map((path) =>
      assertOutsideCurrentWorkspace(path),
    ),
  );
  const [candidateBytes, request, evidence, trustedKeys] = await Promise.all([
    readBoundedRegularFile(candidatePath, limits.maxCandidateBytes, {
      ownerOnly: true,
    }),
    jsonFile(requestPath),
    jsonFile(evidencePath),
    jsonFile(trustedKeysPath),
  ]);
  const released = await materializeAuthorizedOutput({
    request,
    evidence,
    trustedKeys,
    candidateBytes,
    stateDirectory: resolve(options["state-dir"]),
    forbiddenRoots: [process.cwd()],
  });
  process.stdout.write(
    `${JSON.stringify({
      releaseId: released.receipt.releaseId,
      decision: released.receipt.decision,
      outputPath: released.outputPath,
      receiptPath: released.receiptPath,
      idempotent: released.idempotent,
    })}\n`,
  );
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const { command, options } = parseArguments(argv);
  if (command === "prepare") await prepare(options);
  else await release(options);
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedUrl === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof Error ? error.message : "release_refused";
    process.stderr.write(
      `RateLoop host output gate refused the operation (${code}).\n`,
    );
    process.exitCode = 1;
  });
}

export { main, parseArguments };
