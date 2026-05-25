import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRateLoopAgentClient } from "@rateloop/sdk/agent";
import { loadAgentsRuntimeConfig } from "./config";
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

type CliOptions = Record<string, string | boolean>;
const packageRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
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
      options[key] = true;
      continue;
    }

    options[key] = next;
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

function readPaymentMode(options: CliOptions) {
  const value = options["payment-mode"];
  if (value === undefined) return undefined;
  if (value === "wallet_calls" || value === "x402_authorization") return value;
  throw new Error("--payment-mode must be wallet_calls or x402_authorization");
}

function printLocalAskProgress(event: LocalAskProgress) {
  switch (event.type) {
    case "ask_submitted":
      console.error(`RateLoop ask prepared: ${event.response.operationKey ?? "operation pending"}`);
      return;
    case "x402_signed":
      console.error("Signed x402 authorization.");
      return;
    case "x402_resubmitted":
      console.error(`RateLoop x402 ask prepared: ${event.response.operationKey ?? "operation pending"}`);
      return;
    case "transaction_sent":
      console.error(`Sent transactionPlan.calls[${event.index}]${event.phase ? ` (${event.phase})` : ""}: ${event.hash}`);
      return;
    case "transaction_confirmed":
      console.error(`Receipt confirmed for transactionPlan.calls[${event.index}]: ${event.hash}`);
      return;
    case "transactions_confirmed":
      console.error(`Confirmed hashes with RateLoop: ${event.response.operationKey ?? "operation pending"}`);
      return;
  }
}

async function readJsonFile(path: string) {
  const candidates = [
    resolve(path),
    path.startsWith("packages/agents/") ? resolve(packageRoot, path.replace(/^packages\/agents\//, "")) : null,
  ].filter((candidate): candidate is string => Boolean(candidate));

  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8")) as unknown;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function listExampleQuestionFiles() {
  const questionDir = resolve(packageRoot, "examples", "questions");
  const entries = await readdir(questionDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".json"))
    .map(entry => `packages/agents/examples/questions/${entry.name}`)
    .sort();
}

function usage() {
  return `Usage:
  yarn workspace @rateloop/agents templates
  yarn workspace @rateloop/agents lint:questions --file packages/agents/examples/questions/landing-pitch-review.json
  yarn workspace @rateloop/agents quote --file packages/agents/examples/questions/landing-pitch-review.json
  yarn workspace @rateloop/agents ask --file packages/agents/examples/questions/landing-pitch-review.json
  export CURYO_LOCAL_SIGNER_KEYSTORE_PASSWORD=<load-from-secret-store>
  yarn workspace @rateloop/agents wallet --generate --keystore ~/.curyo/local-signer.json
  yarn workspace @rateloop/agents wallet
  yarn workspace @rateloop/agents local-ask --file packages/agents/examples/questions/landing-pitch-review.json
  yarn workspace @rateloop/agents status --operation-key 0x...
  yarn workspace @rateloop/agents result --operation-key 0x...

Environment:
  CURYO_API_BASE_URL     Hosted RateLoop origin for HTTP and MCP flows
  CURYO_AGENT_WALLET_ADDRESS  Funded wallet address for tokenless public asks
  CURYO_MCP_TOKEN        Optional managed agent bearer token
  CURYO_MCP_API_URL      Optional MCP endpoint override
  CURYO_RPC_URL          RPC URL used by local-ask to send wallet transactions
  CURYO_CHAIN_ID         Optional chain guard for CURYO_RPC_URL
  CURYO_LOCAL_SIGNER_KEYSTORE_PATH      Encrypted local signer keystore path
  CURYO_LOCAL_SIGNER_KEYSTORE_PASSWORD  Keystore password from a secret source
  CURYO_LOCAL_SIGNER_PRIVATE_KEY        Escape hatch for ephemeral CI only`;
}

function createAgentClient() {
  const config = loadAgentsRuntimeConfig();
  return createRateLoopAgentClient({
    apiBaseUrl: config.apiBaseUrl,
    mcpAccessToken: config.mcpAccessToken,
    mcpApiUrl: config.mcpApiUrl,
    mcpProtocolVersion: config.mcpProtocolVersion,
  });
}

function withConfiguredWalletAddress(payload: unknown, walletAddress: string | undefined) {
  if (!walletAddress || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  return typeof record.walletAddress === "string" && record.walletAddress.trim()
    ? payload
    : { ...record, walletAddress };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "templates":
      printJson({ templates: listAgentResultTemplates() });
      return;

    case "lint": {
      const explicitFile = typeof options.file === "string" ? options.file : null;
      const files = explicitFile ? [explicitFile] : await listExampleQuestionFiles();
      const results = [];

      for (const file of files) {
        const payload = await readJsonFile(file);
        const findings = lintAgentAskRequest(payload);
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

      if (results.some(result => result.findings.some(finding => finding.level === "error"))) {
        process.exitCode = 1;
      }
      return;
    }

    case "quote": {
      const config = loadAgentsRuntimeConfig();
      const agent = createAgentClient();
      const payload = withConfiguredWalletAddress(await readJsonFile(requireString(options, "file")), config.agentWalletAddress);
      printJson(await agent.quoteQuestion(payload as never));
      return;
    }

    case "ask": {
      const config = loadAgentsRuntimeConfig();
      const agent = createAgentClient();
      const payload = withConfiguredWalletAddress(await readJsonFile(requireString(options, "file")), config.agentWalletAddress);
      const findings = lintAgentAskRequest(payload);
      if (findings.some(finding => finding.level === "error")) {
        printJson({ findings, ...summarizeLintFindings(findings) });
        process.exitCode = 1;
        return;
      }
      printJson(await agent.askHumans(payload as never));
      return;
    }

    case "wallet": {
      const localSignerConfig = loadLocalSignerConfig(options);
      if (options.generate) {
        const generated = await generateLocalSignerWallet(localSignerConfig, { overwrite: Boolean(options.overwrite) });
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
            ? ["Loaded CURYO_LOCAL_SIGNER_PRIVATE_KEY. Prefer an encrypted keystore for persistent agent wallets."]
            : [],
      });
      return;
    }

    case "local-ask": {
      const agent = createAgentClient();
      const localSignerConfig = loadLocalSignerConfig(options);
      const wallet = await loadLocalSignerWallet(localSignerConfig);
      const payload = await readJsonFile(requireString(options, "file"));
      const payloadWithWallet = withLocalSignerWallet(payload, wallet.account.address);
      const findings = lintAgentAskRequest(payloadWithWallet);
      if (findings.some(finding => finding.level === "error")) {
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
              ? ["Loaded CURYO_LOCAL_SIGNER_PRIVATE_KEY. Prefer an encrypted keystore for persistent agent wallets."]
              : [],
        }),
      );
      return;
    }

    case "status": {
      const config = loadAgentsRuntimeConfig();
      const agent = createAgentClient();
      printJson(
        await agent.getQuestionStatus({
          chainId: typeof options["chain-id"] === "string" ? Number(options["chain-id"]) : undefined,
          clientRequestId: typeof options["client-request-id"] === "string" ? options["client-request-id"] : undefined,
          operationKey: typeof options["operation-key"] === "string" ? options["operation-key"] : undefined,
          walletAddress: typeof options["wallet-address"] === "string" ? options["wallet-address"] : config.agentWalletAddress,
        }),
      );
      return;
    }

    case "result": {
      const config = loadAgentsRuntimeConfig();
      const agent = createAgentClient();
      printJson(
        await agent.getResult({
          chainId: typeof options["chain-id"] === "string" ? Number(options["chain-id"]) : undefined,
          clientRequestId: typeof options["client-request-id"] === "string" ? options["client-request-id"] : undefined,
          contentId: typeof options["content-id"] === "string" ? options["content-id"] : undefined,
          operationKey: typeof options["operation-key"] === "string" ? options["operation-key"] : undefined,
          walletAddress: typeof options["wallet-address"] === "string" ? options["wallet-address"] : config.agentWalletAddress,
        }),
      );
      return;
    }

    default:
      console.log(usage());
      process.exitCode = command === "help" || command === "--help" ? 0 : 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
