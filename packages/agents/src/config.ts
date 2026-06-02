import "dotenv/config";
import { isAddress, type Address } from "viem";

type AgentsRuntimeConfig = {
  agentWalletAddress?: Address;
  apiBaseUrl?: string;
  mcpAccessToken?: string;
  mcpApiUrl?: string;
  mcpProtocolVersion?: string;
};

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readOptionalUrl(name: string): string | undefined {
  const value = readEnv(name);
  if (!value) return undefined;

  try {
    return new URL(value).toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
}

function enforceTokenUrlPolicy(
  name: string,
  value: string | undefined,
  token: string | undefined,
) {
  if (!token || !value) return;

  const url = new URL(value);
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname)) return;

  throw new Error(
    `${name} must use HTTPS when RATELOOP_MCP_TOKEN is set; localhost HTTP is only allowed for local development.`,
  );
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function readOptionalAddress(name: string): Address | undefined {
  const value = readEnv(name);
  if (!value) return undefined;
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} must be a valid EVM address.`);
  }
  return value as Address;
}

export function loadAgentsRuntimeConfig(): AgentsRuntimeConfig {
  const apiBaseUrl = readOptionalUrl("RATELOOP_API_BASE_URL");
  const mcpAccessToken = readEnv("RATELOOP_MCP_TOKEN");
  const mcpApiUrl = readOptionalUrl("RATELOOP_MCP_API_URL");

  enforceTokenUrlPolicy("RATELOOP_API_BASE_URL", apiBaseUrl, mcpAccessToken);
  enforceTokenUrlPolicy("RATELOOP_MCP_API_URL", mcpApiUrl, mcpAccessToken);

  return {
    agentWalletAddress: readOptionalAddress("RATELOOP_AGENT_WALLET_ADDRESS"),
    apiBaseUrl,
    mcpAccessToken,
    mcpApiUrl,
    mcpProtocolVersion: readEnv("RATELOOP_MCP_PROTOCOL_VERSION"),
  };
}
