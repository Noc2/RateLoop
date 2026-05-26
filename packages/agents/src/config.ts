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

function readOptionalAddress(name: string): Address | undefined {
  const value = readEnv(name);
  if (!value) return undefined;
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} must be a valid EVM address.`);
  }
  return value as Address;
}

export function loadAgentsRuntimeConfig(): AgentsRuntimeConfig {
  return {
    agentWalletAddress: readOptionalAddress("RATELOOP_AGENT_WALLET_ADDRESS"),
    apiBaseUrl: readOptionalUrl("RATELOOP_API_BASE_URL"),
    mcpAccessToken: readEnv("RATELOOP_MCP_TOKEN"),
    mcpApiUrl: readOptionalUrl("RATELOOP_MCP_API_URL"),
    mcpProtocolVersion: readEnv("RATELOOP_MCP_PROTOCOL_VERSION"),
  };
}
