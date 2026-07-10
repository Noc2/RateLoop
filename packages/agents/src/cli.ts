#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRateLoopAgentClient } from "@rateloop/sdk/agent";
import {
  loadAgentsRuntimeConfig,
  requireExplicitLiveAgentTarget,
} from "./config";
import {
  readHandoffGeneratedImageFiles,
  type HandoffGeneratedImageFile,
} from "./handoffImages";
import {
  lintGeneratedImageHandoffShape,
  shouldKeepHandoffFinding,
} from "./handoffLint";
import {
  DEFAULT_HANDOFF_API_BASE_URL,
  createAskHandoffWithStagedImageUploads,
  inlineHandoffGeneratedImage,
  shouldStageHandoffImageUploads,
} from "./handoffUpload";
import {
  inputPathCandidates,
  resolveExistingInputPath,
} from "./inputPaths";
import {
  askHumansWithLocalSigner,
  generateLocalSignerWallet,
  loadLocalSignerConfig,
  loadLocalSignerWallet,
  withLocalSignerWallet,
  type LocalAskProgress,
} from "./localSigner";
import { listAgentResultTemplates } from "./templates";
import { lintAgentAskRequest, summarizeLintFindings } from "./questions/lint";
import { normalizeInferredHeadToHeadAbRequestBody } from "./voteUi";
import {
  readBooleanFlag,
  readOptionalPositiveInteger,
  type CliOptions,
  type CliOptionValue,
} from "./cliOptions";

const DRY_RUN_WALLET_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const AGENTS_PACKAGE_PATH_PREFIX = "packages/agents/";
type AgentsRuntimeConfig = ReturnType<typeof loadAgentsRuntimeConfig>;

function findPackageRoot(startDir: string) {
  let current = resolve(startDir);
  for (let depth = 0; depth < 8; depth++) {
    const packageJsonPath = resolve(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
          name?: unknown;
        };
        if (manifest.name === "@rateloop/agents") {
          return current;
        }
      } catch {
        // Keep walking; a malformed package.json should surface through normal command failures.
      }
    }

    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }

  return resolve(startDir, "..");
}

const packageRoot = findPackageRoot(
  fileURLToPath(new URL(".", import.meta.url)),
);

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function printHandoffGeneratedImageWarnings(
  images: readonly HandoffGeneratedImageFile[],
) {
  for (const image of images) {
    for (const warning of image.warnings) {
      console.error(`Warning: ${image.filename}: ${warning}`);
    }
  }
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (["privateKey", "signature"].includes(key)) {
        return [key, "[redacted]"];
      }
      return [key, redactSensitive(entry)];
    }),
  );
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

function parseArgs(args: string[]): { command: string; options: CliOptions } {
  const [command = "help", ...rest] = args;
  const options: CliOptions = {};

  for (let index = 0; index < rest.length; index++) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      setOption(options, key, true);
      continue;
    }

    setOption(options, key, next);
    index++;
  }

  return { command, options };
}

function requireString(options: CliOptions, name: string): string {
  const value = options[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function readStringList(options: CliOptions, ...names: string[]): string[] {
  return names.flatMap((name) => {
    const value = options[name];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value;
    return [];
  });
}

function singleValueOptions(
  options: CliOptions,
): Record<string, string | boolean | undefined> {
  return Object.fromEntries(
    Object.entries(options).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[value.length - 1] : value,
    ]),
  );
}

function readPaymentMode(options: CliOptions) {
  const value = options["payment-mode"];
  if (value === undefined) return undefined;
  if (value === "wallet_calls" || value === "x402_authorization") return value;
  if (
    value === "eip3009_usdc_authorization" ||
    value === "eip3009_authorization"
  )
    return "x402_authorization";
  throw new Error(
    "--payment-mode must be wallet_calls, eip3009_usdc_authorization, eip3009_authorization, or x402_authorization",
  );
}

function printLocalAskProgress(event: LocalAskProgress) {
  const planLabel = "transactionPlan";
  switch (event.type) {
    case "ask_submitted":
      console.error(
        `RateLoop ask prepared: ${event.response.operationKey ?? "operation pending"}`,
      );
      return;
    case "x402_signed":
      console.error("Signed EIP-3009 USDC authorization.");
      return;
    case "x402_resubmitted":
      console.error(
        `RateLoop EIP-3009 USDC ask prepared: ${event.response.operationKey ?? "operation pending"}`,
      );
      return;
    case "transaction_sent":
      console.error(
        `Sent ${planLabel}.calls[${event.index}]${event.phase ? ` (${event.phase})` : ""}: ${event.hash}`,
      );
      return;
    case "transaction_confirmed":
      console.error(
        `Receipt confirmed for ${planLabel}.calls[${event.index}]: ${event.hash}`,
      );
      return;
    case "transactions_confirmed":
      console.error(
        `Confirmed ${planLabel} hashes with RateLoop: ${event.response.operationKey ?? "operation pending"}`,
      );
      return;
  }
}

async function readJsonFile(path: string) {
  const candidates = inputPathCandidates(path, {
    packagePrefix: AGENTS_PACKAGE_PATH_PREFIX,
    packageRoot,
  });

  let lastError: unknown;
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return JSON.parse(await readFile(candidate, "utf8")) as unknown;
    } catch (error) {
      lastError = error;
      break;
    }
  }

  throw lastError ?? new Error(`JSON file not found: ${path}`);
}

function resolveCliInputPath(path: string, label: string) {
  return resolveExistingInputPath(path, {
    label,
    packagePrefix: AGENTS_PACKAGE_PATH_PREFIX,
    packageRoot,
  });
}

async function listExampleQuestionFiles() {
  const questionDir = resolve(packageRoot, "examples", "questions");
  const entries = await readdir(questionDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => `packages/agents/examples/questions/${entry.name}`)
    .sort();
}

function usage() {
  return `Usage:
  yarn workspace @rateloop/agents templates
  yarn workspace @rateloop/agents lint --file packages/agents/examples/questions/landing-pitch-review.json
  yarn workspace @rateloop/agents sandbox --file packages/agents/examples/questions/landing-pitch-review.json
  yarn workspace @rateloop/agents quote --file packages/agents/examples/questions/landing-pitch-review.json
  yarn workspace @rateloop/agents ask --dry-run --file packages/agents/examples/questions/landing-pitch-review.json
  yarn workspace @rateloop/agents ask --file packages/agents/examples/questions/landing-pitch-review.json
  yarn workspace @rateloop/agents handoff --file ask.json --image mockup.png
  yarn workspace @rateloop/agents handoff-status --handoff-id ahf_... --handoff-token <private-token> --include-image-data
  export RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD=<load-from-secret-store>
  yarn workspace @rateloop/agents wallet --generate --keystore ~/.rateloop/local-signer.json
  yarn workspace @rateloop/agents wallet
  yarn workspace @rateloop/agents local-ask --file packages/agents/examples/questions/landing-pitch-review.json
  yarn workspace @rateloop/agents status --operation-key 0x...
  yarn workspace @rateloop/agents result --operation-key 0x...

Common flags:
  --file <path>                 Ask JSON for lint, sandbox, quote, ask, handoff, or local-ask
  --image <path>                Attach a local JPG/PNG/WEBP to handoff; repeat for up to four
  --generated-image <path>      Alias for --image
  --include-image-data          Include generated image data in handoff-status output
  --ttl-ms <ms>                 Handoff link TTL, 60000-1800000
  --payment-mode <mode>         local-ask mode: wallet_calls, x402_authorization, eip3009_usdc_authorization, or eip3009_authorization
  --overwrite                   Allow wallet --generate to replace an existing keystore
  --operation-key <0x...>       Recover status/result by operation key
  --client-request-id <id>      Recover status/result by client request id
  --chain-id <id>               Chain id for client-request-id recovery
  --wallet-address <0x...>      Wallet address for tokenless client-request-id recovery
  --content-id <id>             Recover result by submitted content id

Environment:
  RATELOOP_API_BASE_URL     Hosted RateLoop origin for HTTP flows; ask/local-ask require an explicit value
  RATELOOP_AGENT_WALLET_ADDRESS  Funded wallet address for tokenless public asks
  RATELOOP_MCP_TOKEN        Optional managed agent bearer token
  RATELOOP_MCP_API_URL      Optional MCP endpoint override
  RATELOOP_RPC_URL          RPC URL used by local-ask to send wallet transactions
  RATELOOP_CHAIN_ID         Optional chain guard for RATELOOP_RPC_URL
  RATELOOP_LOCAL_SIGNER_QUESTION_METADATA_BASE_URL  Metadata base used for local canonical ask hashes
  RATELOOP_LOCAL_SIGNER_KEYSTORE_PATH      Encrypted local signer keystore path
  RATELOOP_LOCAL_SIGNER_KEYSTORE_PASSWORD  Keystore password from a secret source
  RATELOOP_LOCAL_SIGNER_PRIVATE_KEY        Escape hatch for ephemeral CI only`;
}

function createAgentClient(
  config: AgentsRuntimeConfig = withDefaultAgentApiBaseUrl(
    loadAgentsRuntimeConfig(),
  ),
) {
  return createRateLoopAgentClient({
    apiBaseUrl: config.apiBaseUrl,
    mcpAccessToken: config.mcpAccessToken,
    mcpApiUrl: config.mcpApiUrl,
    mcpProtocolVersion: config.mcpProtocolVersion,
  });
}

function withDefaultAgentApiBaseUrl(
  config: AgentsRuntimeConfig,
): AgentsRuntimeConfig {
  return config.apiBaseUrl || config.mcpApiUrl
    ? config
    : { ...config, apiBaseUrl: DEFAULT_HANDOFF_API_BASE_URL };
}

function loadExplicitLiveAgentConfig(command: "ask" | "local-ask") {
  return requireExplicitLiveAgentTarget(loadAgentsRuntimeConfig(), command);
}

function withConfiguredWalletAddress(
  payload: unknown,
  walletAddress: string | undefined,
) {
  if (
    !walletAddress ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  return typeof record.walletAddress === "string" && record.walletAddress.trim()
    ? payload
    : { ...record, walletAddress };
}

function normalizeHandoffPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { payload, warnings: [] as string[] };
  }
  const normalized = normalizeInferredHeadToHeadAbRequestBody(payload as Record<string, unknown>);
  return {
    payload: normalized.requestBody,
    warnings: normalized.inferred
      ? [
          `Inferred head_to_head_ab from explicit Option A/B wording (${normalized.inferred.optionALabel} vs ${normalized.inferred.optionBLabel}).`,
        ]
      : [],
  };
}

function withDryRunOptions(
  payload: unknown,
  options: CliOptions,
  walletAddress: string | undefined,
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const configuredWallet = walletAddress ?? DRY_RUN_WALLET_ADDRESS;
  const record = withConfiguredWalletAddress(
    payload,
    configuredWallet,
  ) as Record<string, unknown>;

  return {
    ...record,
    dryRun: true,
    mode: "dry_run",
    walletAddress:
      typeof record.walletAddress === "string" && record.walletAddress.trim()
        ? record.walletAddress
        : configuredWallet,
    ...(typeof options["client-request-id"] === "string"
      ? { clientRequestId: options["client-request-id"] }
      : {}),
  };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "templates":
      printJson({ templates: listAgentResultTemplates() });
      return;

    case "lint": {
      const explicitFile =
        typeof options.file === "string" ? options.file : null;
      const files = explicitFile
        ? [explicitFile]
        : await listExampleQuestionFiles();
      const results = [];

      for (const file of files) {
        const payload = await readJsonFile(file);
        const findings = lintAgentAskRequest(payload, {
          requireMaxPaymentAmount: true,
        });
        results.push({ file, findings, ...summarizeLintFindings(findings) });
      }

      if (explicitFile) {
        const [result] = results;
        printJson(
          result
            ? {
                findings: result.findings,
                errorCount: result.errorCount,
                ok: result.ok,
                warningCount: result.warningCount,
              }
            : { findings: [], errorCount: 0, ok: true, warningCount: 0 },
        );
      } else {
        printJson({ files: results });
      }

      if (
        results.some((result) =>
          result.findings.some((finding) => finding.level === "error"),
        )
      ) {
        process.exitCode = 1;
      }
      return;
    }

    case "quote": {
      const config = withDefaultAgentApiBaseUrl(loadAgentsRuntimeConfig());
      const agent = createAgentClient(config);
      const rawPayload = await readJsonFile(requireString(options, "file"));
      const payload = options["dry-run"]
        ? withDryRunOptions(rawPayload, options, config.agentWalletAddress)
        : withConfiguredWalletAddress(rawPayload, config.agentWalletAddress);
      const findings = lintAgentAskRequest(payload);
      if (findings.some((finding) => finding.level === "error")) {
        printJson({ findings, ...summarizeLintFindings(findings) });
        process.exitCode = 1;
        return;
      }
      printJson(await agent.quoteQuestion(payload as never));
      return;
    }

    case "sandbox":
    case "ask": {
      const config =
        command === "ask" && !options["dry-run"]
          ? loadExplicitLiveAgentConfig("ask")
          : withDefaultAgentApiBaseUrl(loadAgentsRuntimeConfig());
      const agent = createAgentClient(config);
      const rawPayload = await readJsonFile(requireString(options, "file"));
      const payload =
        command === "sandbox" || options["dry-run"]
          ? withDryRunOptions(rawPayload, options, config.agentWalletAddress)
          : withConfiguredWalletAddress(rawPayload, config.agentWalletAddress);
      const findings = lintAgentAskRequest(payload, {
        requireMaxPaymentAmount: command === "ask" && !options["dry-run"],
      });
      if (findings.some((finding) => finding.level === "error")) {
        printJson({ findings, ...summarizeLintFindings(findings) });
        process.exitCode = 1;
        return;
      }
      printJson(await agent.askHumans(payload as never));
      return;
    }

    case "handoff": {
      const config = withDefaultAgentApiBaseUrl(loadAgentsRuntimeConfig());
      const agent = createAgentClient(config);
      const rawPayload = await readJsonFile(requireString(options, "file"));
      const payloadWithWallet = withConfiguredWalletAddress(
        rawPayload,
        config.agentWalletAddress,
      );
      const { payload, warnings } = normalizeHandoffPayload(payloadWithWallet);
      const generatedImages = await readHandoffGeneratedImageFiles(
        readStringList(options, "image", "generated-image").map((path) =>
          resolveCliInputPath(path, "Handoff image"),
        ),
      );
      const findings = [
        ...lintAgentAskRequest(payload, { requireMaxPaymentAmount: true }).filter((finding) =>
          shouldKeepHandoffFinding(finding, {
            hasGeneratedImages: generatedImages.length > 0,
            payload,
          }),
        ),
        ...lintGeneratedImageHandoffShape({
          hasGeneratedImages: generatedImages.length > 0,
          payload,
        }),
      ];
      if (findings.some((finding) => finding.level === "error")) {
        printJson({ findings, ...summarizeLintFindings(findings) });
        process.exitCode = 1;
        return;
      }
      printHandoffGeneratedImageWarnings(generatedImages);
      for (const warning of warnings) {
        console.error(`Warning: ${warning}`);
      }
      printJson(
        shouldStageHandoffImageUploads(generatedImages)
          ? await createAskHandoffWithStagedImageUploads({
              config,
              generatedImages,
              request: payload,
              ttlMs: readOptionalPositiveInteger(options, "ttl-ms"),
            })
          : await agent.createAskHandoff({
              generatedImages: generatedImages.map(inlineHandoffGeneratedImage),
              request: payload as never,
              ttlMs: readOptionalPositiveInteger(options, "ttl-ms"),
            }),
      );
      return;
    }

    case "handoff-status": {
      const config = withDefaultAgentApiBaseUrl(loadAgentsRuntimeConfig());
      const agent = createAgentClient(config);
      printJson(
        await agent.getAskHandoffStatus({
          handoffId: requireString(options, "handoff-id"),
          handoffToken: requireString(options, "handoff-token"),
          includeImageData: readBooleanFlag(options, "include-image-data"),
        }),
      );
      return;
    }

    case "wallet": {
      const localSignerConfig = loadLocalSignerConfig(
        singleValueOptions(options),
      );
      if (readBooleanFlag(options, "generate")) {
        const generated = await generateLocalSignerWallet(localSignerConfig, {
          overwrite: readBooleanFlag(options, "overwrite"),
        });
        printJson({
          address: generated.account.address,
          keystorePath: generated.keystorePath,
          source: generated.source,
        });
        return;
      }

      const wallet = await loadLocalSignerWallet(localSignerConfig);
      printJson({
        address: wallet.account.address,
        source: wallet.source,
        warnings:
          wallet.source === "private-key"
            ? [
                "Loaded RATELOOP_LOCAL_SIGNER_PRIVATE_KEY. Prefer an encrypted keystore for persistent agent wallets.",
              ]
            : [],
      });
      return;
    }

    case "local-ask": {
      const agent = createAgentClient(
        loadExplicitLiveAgentConfig("local-ask"),
      );
      const localSignerConfig = loadLocalSignerConfig(
        singleValueOptions(options),
      );
      const wallet = await loadLocalSignerWallet(localSignerConfig);
      const payload = await readJsonFile(requireString(options, "file"));
      const payloadWithWallet = withLocalSignerWallet(
        payload,
        wallet.account.address,
      );
      const findings = lintAgentAskRequest(payloadWithWallet, { requireMaxPaymentAmount: true });
      if (findings.some((finding) => finding.level === "error")) {
        printJson({ findings, ...summarizeLintFindings(findings) });
        process.exitCode = 1;
        return;
      }

      const result = await askHumansWithLocalSigner({
        account: wallet.account,
        agent,
        config: localSignerConfig,
        onProgress: printLocalAskProgress,
        paymentMode: readPaymentMode(options),
        payload: payloadWithWallet,
      });

      printJson(
        redactSensitive({
          ...result,
          walletSource: wallet.source,
          warnings:
            wallet.source === "private-key"
              ? [
                  "Loaded RATELOOP_LOCAL_SIGNER_PRIVATE_KEY. Prefer an encrypted keystore for persistent agent wallets.",
                ]
              : [],
        }),
      );
      return;
    }

    case "status": {
      const config = withDefaultAgentApiBaseUrl(loadAgentsRuntimeConfig());
      const agent = createAgentClient(config);
      printJson(
        await agent.getQuestionStatus({
          chainId: readOptionalPositiveInteger(options, "chain-id"),
          clientRequestId:
            typeof options["client-request-id"] === "string"
              ? options["client-request-id"]
              : undefined,
          operationKey:
            typeof options["operation-key"] === "string"
              ? options["operation-key"]
              : undefined,
          walletAddress:
            typeof options["wallet-address"] === "string"
              ? options["wallet-address"]
              : config.agentWalletAddress,
        }),
      );
      return;
    }

    case "result": {
      const config = withDefaultAgentApiBaseUrl(loadAgentsRuntimeConfig());
      const agent = createAgentClient(config);
      printJson(
        await agent.getResult({
          chainId: readOptionalPositiveInteger(options, "chain-id"),
          clientRequestId:
            typeof options["client-request-id"] === "string"
              ? options["client-request-id"]
              : undefined,
          contentId:
            typeof options["content-id"] === "string"
              ? options["content-id"]
              : undefined,
          operationKey:
            typeof options["operation-key"] === "string"
              ? options["operation-key"]
              : undefined,
          walletAddress:
            typeof options["wallet-address"] === "string"
              ? options["wallet-address"]
              : config.agentWalletAddress,
        }),
      );
      return;
    }

    default:
      console.log(usage());
      process.exitCode = command === "help" || command === "--help" ? 0 : 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
