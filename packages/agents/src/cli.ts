#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type {
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
  rateloop-agents wait --operation-key op_... [--cursor ...] [--timeout-ms 30000]
  rateloop-agents wait --operation-key op_... --until-ready --max-wait-ms 300000
  rateloop-agents result --operation-key op_...

Environment:
  RATELOOP_API_BASE_URL       Required isolated tokenless deployment URL
  RATELOOP_AGENT_API_KEY      Optional scoped prepaid-agent bearer key
  RATELOOP_AGENT_API_PATH     Optional API prefix; defaults to /api/agent/v1
  RATELOOP_REQUEST_TIMEOUT_MS Optional positive HTTP timeout

The CLI never defaults to rateloop.ai and never signs or submits legacy contract calls.`;
}

export async function runCli(args: string[]) {
  const { command, options } = parseCliArgs(args);
  validateCliOptions(command, options);
  if (command === "help" || command === "--help") {
    console.log(usage());
    return;
  }

  const config = loadTokenlessAgentsRuntimeConfig();
  const client = createTokenlessAgentsClient({
    apiKey: config.apiKey,
    apiBaseUrl: config.apiBaseUrl,
    apiPath: config.apiPath,
    timeoutMs: config.requestTimeoutMs,
  });

  switch (command) {
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
