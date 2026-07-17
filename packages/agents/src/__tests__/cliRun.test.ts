import { beforeEach, describe, expect, it, vi } from "vitest";

const loadTokenlessAgentsRuntimeConfig = vi.fn();
const loadTokenlessAgentAccount = vi.fn();
const createTokenlessAgentKeystore = vi.fn();
const createTokenlessAgentsClient = vi.fn(() => ({}));
const waitUntilTokenlessReady = vi.fn();
const runTokenlessAutonomous = vi.fn();

vi.mock("../config", () => ({
  loadTokenlessAgentsRuntimeConfig: () => loadTokenlessAgentsRuntimeConfig(),
}));
vi.mock("../tokenlessSigner", () => ({
  loadTokenlessAgentAccount: (...args: unknown[]) => loadTokenlessAgentAccount(...args),
  createTokenlessAgentKeystore: (...args: unknown[]) => createTokenlessAgentKeystore(...args),
}));
vi.mock("../tokenless", () => ({
  createTokenlessAgentsClient: (...args: unknown[]) => createTokenlessAgentsClient(...args),
  waitUntilTokenlessReady: (...args: unknown[]) => waitUntilTokenlessReady(...args),
}));
vi.mock("../tokenlessRun", () => ({
  runTokenlessAutonomous: (...args: unknown[]) => runTokenlessAutonomous(...args),
}));

const { runCli } = await import("../cli");

const baseConfig = {
  apiKey: "rlk_test",
  apiBaseUrl: "https://example.invalid",
  apiPath: "/api/agent/v1",
  requestTimeoutMs: 1_000,
  keystorePath: undefined as string | undefined,
  keystorePassword: undefined as string | undefined,
  resumePath: undefined as string | undefined,
};

describe("tokenless CLI keystore requirements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    loadTokenlessAgentsRuntimeConfig.mockReturnValue({ ...baseConfig });
  });

  it("resume polls with the API key alone and never loads the signing keystore", async () => {
    waitUntilTokenlessReady.mockResolvedValue({ status: "ready" });

    await expect(
      runCli(["resume", "--operation-key", "op_123"]),
    ).resolves.toBeUndefined();

    expect(loadTokenlessAgentAccount).not.toHaveBeenCalled();
    expect(waitUntilTokenlessReady).toHaveBeenCalledTimes(1);
  });

  it("run still requires the signing keystore before submitting", async () => {
    await expect(runCli(["run", "--file", "run.json"])).rejects.toThrow(
      /RATELOOP_AGENT_KEYSTORE_PATH/,
    );

    expect(loadTokenlessAgentAccount).not.toHaveBeenCalled();
    expect(runTokenlessAutonomous).not.toHaveBeenCalled();
  });

  it("both run and resume still require the API key", async () => {
    loadTokenlessAgentsRuntimeConfig.mockReturnValue({ ...baseConfig, apiKey: "" });

    await expect(
      runCli(["resume", "--operation-key", "op_123"]),
    ).rejects.toThrow(/RATELOOP_AGENT_API_KEY/);
    await expect(runCli(["run", "--file", "run.json"])).rejects.toThrow(
      /RATELOOP_AGENT_API_KEY/,
    );
  });
});
