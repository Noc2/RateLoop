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
});
