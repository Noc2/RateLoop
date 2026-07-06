import { afterEach, describe, expect, it } from "vitest";
import {
  loadAgentsRuntimeConfig,
  requireExplicitLiveAgentTarget,
} from "../config.js";

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

  it("derives the tokenless public MCP endpoint from the configured app origin", () => {
    process.env.RATELOOP_API_BASE_URL = "https://rateloop.example/app";

    expect(loadAgentsRuntimeConfig()).toMatchObject({
      apiBaseUrl: "https://rateloop.example/app",
      mcpApiUrl: "https://rateloop.example/app/api/mcp/public",
    });
  });

  it("derives the managed MCP endpoint from the configured app origin when a token is set", () => {
    process.env.RATELOOP_API_BASE_URL = "https://rateloop.example/app";
    process.env.RATELOOP_MCP_TOKEN = "agent-token";

    expect(loadAgentsRuntimeConfig()).toMatchObject({
      apiBaseUrl: "https://rateloop.example/app",
      mcpAccessToken: "agent-token",
      mcpApiUrl: "https://rateloop.example/app/api/mcp",
    });
  });

  it("lets an explicit MCP endpoint override the derived app-origin default", () => {
    process.env.RATELOOP_API_BASE_URL = "https://rateloop.example/app";
    process.env.RATELOOP_MCP_API_URL = "https://mcp.rateloop.example/custom";

    expect(loadAgentsRuntimeConfig()).toMatchObject({
      apiBaseUrl: "https://rateloop.example/app",
      mcpApiUrl: "https://mcp.rateloop.example/custom",
    });
  });

  it("requires an explicit endpoint for live-spend commands", () => {
    expect(() => requireExplicitLiveAgentTarget({}, "ask")).toThrow(
      "ask can submit paid RateLoop work and requires an explicit endpoint",
    );

    expect(
      requireExplicitLiveAgentTarget(
        { apiBaseUrl: "https://www.rateloop.ai" },
        "ask",
      ),
    ).toMatchObject({ apiBaseUrl: "https://www.rateloop.ai" });
    expect(
      requireExplicitLiveAgentTarget(
        { mcpApiUrl: "https://www.rateloop.ai/api/mcp" },
        "local-ask",
      ),
    ).toMatchObject({ mcpApiUrl: "https://www.rateloop.ai/api/mcp" });
  });
});
