import { describe, expect, it, vi } from "vitest";
import { leaseFeedbackRevealJobs, revealQueuedFeedback, type FeedbackRevealKeeperSettings } from "../feedback-reveals.js";

const settings: FeedbackRevealKeeperSettings = {
  enabled: true,
  apiBaseUrl: "https://app.example.com",
  secret: "shared-secret",
  batchSize: 10,
  leaseSeconds: 120,
  chainId: 31337,
  feedbackRegistry: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  maxGasPerTx: 2_000_000,
};

describe("feedback reveal keeper", () => {
  it("does not lease jobs after direct feedback publishing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(leaseFeedbackRevealJobs(settings)).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty result without chain writes", async () => {
    const publicClient = {
      readContract: vi.fn(),
      waitForTransactionReceipt: vi.fn(),
    };
    const walletClient = {
      writeContract: vi.fn(),
    };
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const result = await revealQueuedFeedback(
      publicClient as never,
      walletClient as never,
      { id: 31337 } as never,
      { address: "0x9999999999999999999999999999999999999999" } as never,
      logger,
      settings,
    );

    expect(result).toEqual({
      jobsLeased: 0,
      revealed: 0,
      failures: 0,
      alreadyRevealed: 0,
    });
    expect(publicClient.readContract).not.toHaveBeenCalled();
    expect(walletClient.writeContract).not.toHaveBeenCalled();
  });
});
