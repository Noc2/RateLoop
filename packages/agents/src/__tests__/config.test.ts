import { afterEach, describe, expect, it } from "vitest";
import { loadAgentsRuntimeConfig } from "../config.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("agents runtime config", () => {
  it("loads the tokenless public wallet address from env", () => {
    process.env.RATELOOP_AGENT_WALLET_ADDRESS = "0x00000000000000000000000000000000000000aa";

    expect(loadAgentsRuntimeConfig().agentWalletAddress).toBe("0x00000000000000000000000000000000000000aa");
  });

  it("rejects invalid tokenless public wallet addresses", () => {
    process.env.RATELOOP_AGENT_WALLET_ADDRESS = "not-an-address";

    expect(() => loadAgentsRuntimeConfig()).toThrow("RATELOOP_AGENT_WALLET_ADDRESS must be a valid EVM address");
  });

  it("rejects token-bearing remote HTTP API URLs", () => {
    process.env.RATELOOP_MCP_TOKEN = "agent-token";
    process.env.RATELOOP_API_BASE_URL = "http://rateloop.example";

    expect(() => loadAgentsRuntimeConfig()).toThrow(
      "RATELOOP_API_BASE_URL must use HTTPS",
    );
  });

  it("rejects token-bearing remote HTTP MCP URLs", () => {
    process.env.RATELOOP_MCP_TOKEN = "agent-token";
    process.env.RATELOOP_MCP_API_URL = "http://rateloop.example/api/mcp";

    expect(() => loadAgentsRuntimeConfig()).toThrow(
      "RATELOOP_MCP_API_URL must use HTTPS",
    );
  });

  it("allows token-bearing localhost HTTP URLs", () => {
    process.env.RATELOOP_MCP_TOKEN = "agent-token";
    process.env.RATELOOP_API_BASE_URL = "http://127.0.0.1:3000";
    process.env.RATELOOP_MCP_API_URL = "http://[::1]:3000/api/mcp";

    expect(loadAgentsRuntimeConfig()).toMatchObject({
      apiBaseUrl: "http://127.0.0.1:3000",
      mcpAccessToken: "agent-token",
      mcpApiUrl: "http://[::1]:3000/api/mcp",
    });
  });
});
