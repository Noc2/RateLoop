#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  HumanAssuranceProjectCreateRequest,
  TokenlessAskRequest,
  TokenlessQuoteRequest,
} from "@rateloop/sdk";
import {
  readBooleanFlag,
  readOptionalPositiveInteger,
  validateCliOptions,
  type CliOptions,
} from "./cliOptions";
import { loadTokenlessAgentsRuntimeConfig } from "./config";
import { resolveExistingInputPath } from "./inputPaths";
import {
  createTokenlessAgentKeystore,
  loadTokenlessAgentAccount,
} from "./tokenlessSigner";
import {
  runTokenlessAutonomous,
  type TokenlessAutonomousRunInput,
} from "./tokenlessRun";
import {
  createTokenlessAgentsClient,
  waitUntilTokenlessReady,
} from "./tokenless";

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function setOption(options: CliOptions, key: string, value: string | boolean) {
  const existing = options[key];
  if (existing === undefined) {
    options[key] = value;
    return;
  }
  options[key] = Array.isArray(existing)
    ? [...existing, String(value)]
    : [String(existing), String(value)];
}

export function parseCliArgs(args: string[]): {
  command: string;
  options: CliOptions;
} {
  const [command = "help", ...rest] = args;
  const options: CliOptions = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      setOption(options, name, true);
    } else {
      setOption(options, name, next);
      index += 1;
    }
  }
  return { command, options };
}

function requireString(options: CliOptions, name: string) {
  const value = options[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--${name} is required`);
  }
  return value.trim();
}

function requireEnvPassword(options: CliOptions, name: string) {
  const envName =
    typeof options["password-env"] === "string"
      ? options["password-env"].trim()
      : "RATELOOP_AGENT_KEYSTORE_PASSWORD";
  if (!envName)
    throw new Error(`--${name} password environment name must not be empty`);
  const password = process.env[envName]?.trim();
  if (!password) throw new Error(`${envName} is required for ${name}`);
  return password;
}

async function readJsonFile<T>(path: string): Promise<T> {
  const resolvedPath = resolveExistingInputPath(path, { label: "JSON file" });
  const value = JSON.parse(await readFile(resolvedPath, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must contain one JSON object.`);
  }
  return value as T;
}

function usage() {
  return `RateLoop tokenless agent CLI

Usage:
  rateloop-agents quote --file quote.json
  rateloop-agents ask --file ask.json
  rateloop-agents media-upload --file image.png --client-request-id release-image-01
  rateloop-agents wait --operation-key op_... [--cursor ...] [--timeout-ms 30000]
  rateloop-agents wait --operation-key op_... --until-ready --max-wait-ms 300000
  rateloop-agents result --operation-key op_...
  rateloop-agents wallet-create --keystore ~/.rateloop/tokenless-agent.json
  rateloop-agents wallet-address --keystore ~/.rateloop/tokenless-agent.json
  rateloop-agents run --file run.json --max-wait-ms 300000
  rateloop-agents resume --operation-key op_... --max-wait-ms 300000
  rateloop-agents assurance-projects
  rateloop-agents assurance-project-create --file assurance-project.json
  rateloop-agents assurance-project --project-id hap_...
  rateloop-agents assurance-run --run-id hau_...

Environment:
  RATELOOP_API_BASE_URL       Required isolated tokenless deployment URL
  RATELOOP_AGENT_API_KEY      Workspace key; required for assurance commands and prepaid operations
  RATELOOP_AGENT_API_PATH     Optional API prefix; defaults to /api/agent/v1
  RATELOOP_REQUEST_TIMEOUT_MS Optional positive HTTP timeout
  RATELOOP_AGENT_KEYSTORE_PATH Agent wallet keystore for autonomous runs
  RATELOOP_AGENT_KEYSTORE_PASSWORD Agent wallet keystore password
  RATELOOP_AGENT_RESUME_PATH Optional non-secret autonomous-run receipt path

The CLI never defaults to rateloop.ai and never signs or submits legacy contract calls.`;
}

export async function runCli(args: string[]) {
  const { command, options } = parseCliArgs(args);
  validateCliOptions(command, options);
  if (command === "help" || command === "--help") {
    console.log(usage());
    return;
  }

  if (command === "wallet-create") {
    const created = await createTokenlessAgentKeystore({
      path: requireString(options, "keystore"),
      password: requireEnvPassword(options, "wallet-create"),
      overwrite: readBooleanFlag(options, "overwrite"),
    });
    printJson(created);
    return;
  }

  if (command === "wallet-address") {
    const keystorePath = requireString(options, "keystore");
    const account = await loadTokenlessAgentAccount({
      path: keystorePath,
      password: requireEnvPassword(options, "wallet-address"),
    });
    printJson({ address: account.address, keystore: resolve(keystorePath) });
    return;
  }

  const config = loadTokenlessAgentsRuntimeConfig();
  if (command.startsWith("assurance-") && !config.apiKey) {
    throw new Error(
      "RATELOOP_AGENT_API_KEY is required for assurance project and run commands.",
    );
  }
  const client = createTokenlessAgentsClient({
    apiKey: config.apiKey,
    apiBaseUrl: config.apiBaseUrl,
    apiPath: config.apiPath,
    timeoutMs: config.requestTimeoutMs,
  });

  if (command === "run" || command === "resume") {
    if (!config.apiKey) {
      throw new Error(
        "RATELOOP_AGENT_API_KEY is required for autonomous publishing.",
      );
    }
    const maxWaitMs =
      readOptionalPositiveInteger(options, "max-wait-ms") ?? 300_000;
    if (command === "run") {
      // Only `run` submits and signs; `resume` merely polls an existing operation with the API
      // credential. Loading the keystore here keeps recovery-after-restart working when the signing
      // key is intentionally offline.
      if (!config.keystorePath || !config.keystorePassword) {
        throw new Error(
          "RATELOOP_AGENT_KEYSTORE_PATH and RATELOOP_AGENT_KEYSTORE_PASSWORD are required for autonomous publishing.",
        );
      }
      const account = await loadTokenlessAgentAccount({
        path: config.keystorePath,
        password: config.keystorePassword,
      });
      const request = await readJsonFile<TokenlessAutonomousRunInput>(
        requireString(options, "file"),
      );
      printJson(
        await runTokenlessAutonomous({
          account,
          apiBaseUrl: config.apiBaseUrl,
          client,
          maxWaitMs,
          request,
          resumePath: config.resumePath,
        }),
      );
      return;
    }
    const operationKey = requireString(options, "operation-key");
    printJson(
      await waitUntilTokenlessReady(client, {
        maxWaitMs,
        operationKey,
      }),
    );
    return;
  }

  switch (command) {
    case "media-upload": {
      if (!config.apiKey)
        throw new Error("RATELOOP_AGENT_API_KEY is required for media-upload.");
      const path = resolveExistingInputPath(requireString(options, "file"), {
        label: "image file",
      });
      const extension = extname(path).toLowerCase();
      const contentType =
        extension === ".jpg" || extension === ".jpeg"
          ? "image/jpeg"
          : extension === ".png"
            ? "image/png"
            : extension === ".webp"
              ? "image/webp"
              : undefined;
      printJson(
        await client.stageQuestionImage({
          bytes: new Uint8Array(await readFile(path)),
          clientRequestId: requireString(options, "client-request-id"),
          ...(contentType ? { contentType } : {}),
          filename: basename(path),
        }),
      );
      return;
    }
    case "assurance-projects":
      printJson(await client.assurance.listProjects());
      return;
    case "assurance-project-create":
      printJson(
        await client.assurance.createProject(
          await readJsonFile<HumanAssuranceProjectCreateRequest>(
            requireString(options, "file"),
          ),
        ),
      );
      return;
    case "assurance-project":
      printJson(
        await client.assurance.getProject({
          projectId: requireString(options, "project-id"),
        }),
      );
      return;
    case "assurance-run":
      printJson(
        await client.assurance.getRunStatus({
          runId: requireString(options, "run-id"),
        }),
      );
      return;
    case "quote":
      printJson(
        await client.quote(
          await readJsonFile<TokenlessQuoteRequest>(
            requireString(options, "file"),
          ),
        ),
      );
      return;
    case "ask":
      printJson(
        await client.ask(
          await readJsonFile<TokenlessAskRequest>(
            requireString(options, "file"),
          ),
        ),
      );
      return;
    case "wait": {
      const operationKey = requireString(options, "operation-key");
      const cursor =
        typeof options.cursor === "string" ? options.cursor : undefined;
      const timeoutMs = readOptionalPositiveInteger(options, "timeout-ms");
      if (readBooleanFlag(options, "until-ready")) {
        printJson(
          await waitUntilTokenlessReady(client, {
            cursor,
            maxWaitMs:
              readOptionalPositiveInteger(options, "max-wait-ms") ?? 300_000,
            operationKey,
            timeoutMs,
          }),
        );
        return;
      }
      if (options["max-wait-ms"] !== undefined) {
        throw new Error("--max-wait-ms requires --until-ready");
      }
      printJson(await client.wait({ cursor, operationKey, timeoutMs }));
      return;
    }
    case "result":
      printJson(
        await client.result({
          operationKey: requireString(options, "operation-key"),
        }),
      );
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
