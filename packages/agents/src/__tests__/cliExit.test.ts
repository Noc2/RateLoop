import { RateLoopApiError } from "@rateloop/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadTokenlessAgentsRuntimeConfig = vi.fn();
const createTokenlessAgentsClient = vi.fn(() => ({}));
const waitUntilTokenlessReady = vi.fn();

vi.mock("../config", () => ({
  loadTokenlessAgentsRuntimeConfig: () => loadTokenlessAgentsRuntimeConfig(),
}));
vi.mock("../tokenlessSigner", () => ({
  loadTokenlessAgentAccount: vi.fn(),
  createTokenlessAgentKeystore: vi.fn(),
}));
vi.mock("../tokenless", () => ({
  createTokenlessAgentsClient: (...args: unknown[]) =>
    createTokenlessAgentsClient(...args),
  waitUntilTokenlessReady: (...args: unknown[]) =>
    waitUntilTokenlessReady(...args),
}));
vi.mock("../tokenlessRun", () => ({ runTokenlessAutonomous: vi.fn() }));

const { CLI_EXIT_CODES, TokenlessWaitTimeoutError } = await import(
  "../exitCodes"
);
const { main } = await import("../cli");

const baseConfig = {
  apiKey: "rlk_test",
  apiBaseUrl: "https://example.invalid",
  apiPath: "/api/agent/v1",
  requestTimeoutMs: 1_000,
  keystorePath: undefined as string | undefined,
  keystorePassword: undefined as string | undefined,
  resumePath: undefined as string | undefined,
};

const gate = ["wait", "--operation-key", "op_123", "--until-ready"];
const silence = () => {};

describe("wait --until-ready as a CI gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    loadTokenlessAgentsRuntimeConfig.mockReturnValue({ ...baseConfig });
  });

  it("passes the build when the verdict is publishable", async () => {
    waitUntilTokenlessReady.mockResolvedValue({
      status: "ready",
      verdictStatus: "publishable",
    });

    await expect(main(gate, silence)).resolves.toBe(CLI_EXIT_CODES.ok);
  });

  // The defect this replaces: a rejected output exited 0, so the gate let
  // every failed review through.
  it.each(["inconclusive", "delisted"] as const)(
    "fails the build when the verdict is %s",
    async (verdictStatus) => {
      waitUntilTokenlessReady.mockResolvedValue({
        status: "ready",
        verdictStatus,
      });

      await expect(main(gate, silence)).resolves.toBe(
        CLI_EXIT_CODES.notPublishable,
      );
    },
  );

  it.each([
    "zero_commit_refunded",
    "under_quorum_compensated",
    "beacon_failure_compensated",
  ] as const)("reports %s as no verdict, not as a rejection", async (status) => {
    waitUntilTokenlessReady.mockResolvedValue({
      status: "ready",
      verdictStatus: status,
    });

    await expect(main(gate, silence)).resolves.toBe(CLI_EXIT_CODES.noVerdict);
  });

  it("distinguishes a timeout from a rejected output", async () => {
    waitUntilTokenlessReady.mockRejectedValue(
      new TokenlessWaitTimeoutError("not ready", 300_000, "cur_1"),
    );

    await expect(main(gate, silence)).resolves.toBe(CLI_EXIT_CODES.timeout);
  });

  it("distinguishes a transport failure from a rejected output", async () => {
    waitUntilTokenlessReady.mockRejectedValue(
      new RateLoopApiError("gateway down", 503, { retryable: true }),
    );

    await expect(main(gate, silence)).resolves.toBe(CLI_EXIT_CODES.api);
  });

  it("distinguishes operator error from every review outcome", async () => {
    await expect(
      main(["wait", "--until-ready"], silence),
    ).resolves.toBe(CLI_EXIT_CODES.usage);
    await expect(main(["not-a-command"], silence)).resolves.toBe(
      CLI_EXIT_CODES.usage,
    );
    await expect(
      main(["wait", "--operation-key", "op_1", "--max-wait-ms", "1000"], silence),
    ).resolves.toBe(CLI_EXIT_CODES.usage);
  });

  it("reports the error message once, without throwing", async () => {
    const messages: string[] = [];
    waitUntilTokenlessReady.mockRejectedValue(
      new TokenlessWaitTimeoutError("not ready in time", 300_000),
    );

    await expect(
      main(gate, (message) => messages.push(message)),
    ).resolves.toBe(CLI_EXIT_CODES.timeout);
    expect(messages).toEqual(["not ready in time"]);
  });

  it("keeps commands that are not gates on the success code", async () => {
    await expect(main(["help"], silence)).resolves.toBe(CLI_EXIT_CODES.ok);
  });
});
