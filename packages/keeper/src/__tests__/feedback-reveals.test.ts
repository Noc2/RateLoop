import { describe, expect, it, vi } from "vitest";
import { revealQueuedFeedback, type FeedbackRevealCandidate, type FeedbackRevealKeeperSettings } from "../feedback-reveals.js";

const FEEDBACK_HASH = `0x${"11".repeat(32)}` as const;
const COMMIT_KEY = `0x${"22".repeat(32)}` as const;
const CLIENT_NONCE = `0x${"33".repeat(32)}` as const;
const TX_HASH = `0x${"44".repeat(32)}` as const;
const AUTHOR = "0x1234567890abcdef1234567890abcdef12345678" as const;
const FEEDBACK_REGISTRY = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const;

const settings: FeedbackRevealKeeperSettings = {
  enabled: true,
  apiBaseUrl: "https://app.example.com",
  secret: "shared-secret",
  batchSize: 10,
  leaseSeconds: 120,
  chainId: 31337,
  feedbackRegistry: FEEDBACK_REGISTRY,
  maxGasPerTx: 2_000_000,
};

const candidate: FeedbackRevealCandidate = {
  id: 7,
  contentId: "13",
  roundId: "8",
  chainId: 31337,
  authorAddress: AUTHOR,
  feedbackType: "evidence",
  body: "The cited report confirms the central claim.",
  sourceUrl: null,
  feedbackHash: FEEDBACK_HASH,
  commitKey: COMMIT_KEY,
  clientNonce: CLIENT_NONCE,
  attempt: 1,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildHarness(params: {
  record?: unknown;
  writeError?: Error;
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/pending-reveals")) {
      return jsonResponse({ ok: true, items: [candidate] });
    }
    if (url.includes("/reveal-results")) {
      return jsonResponse({ ok: true });
    }
    return jsonResponse({ error: "not found" }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);

  const publicClient = {
    readContract: vi.fn().mockResolvedValue(
      params.record ?? [FEEDBACK_HASH, AUTHOR, 100n, 0n, "0x0000000000000000000000000000000000000001"],
    ),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
  };
  const walletClient = {
    writeContract: params.writeError ? vi.fn().mockRejectedValue(params.writeError) : vi.fn().mockResolvedValue(TX_HASH),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    fetchMock,
    publicClient,
    walletClient,
    logger,
  };
}

describe("feedback reveal keeper", () => {
  it("reveals leased feedback and reports the receipt hash", async () => {
    const harness = buildHarness();

    const result = await revealQueuedFeedback(
      harness.publicClient as never,
      harness.walletClient as never,
      { id: 31337 } as never,
      { address: "0x9999999999999999999999999999999999999999" } as never,
      harness.logger,
      settings,
    );

    expect(result).toEqual({
      jobsLeased: 1,
      revealed: 1,
      failures: 0,
      alreadyRevealed: 0,
    });
    expect(harness.walletClient.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FEEDBACK_REGISTRY,
        functionName: "revealFeedback",
        gas: 2_000_000n,
        args: [13n, 8n, COMMIT_KEY, "evidence", candidate.body, "", CLIENT_NONCE],
      }),
    );
    const resultCall = harness.fetchMock.mock.calls.find(call => String(call[0]).includes("/reveal-results"));
    expect(resultCall?.[1]?.body).toBe(JSON.stringify({ id: 7, status: "revealed", txHash: TX_HASH }));
    expect((resultCall?.[1]?.headers as Headers).get("Authorization")).toBe("Bearer shared-secret");
  });

  it("preserves configured app base paths for keeper API calls", async () => {
    const harness = buildHarness();

    await revealQueuedFeedback(
      harness.publicClient as never,
      harness.walletClient as never,
      { id: 31337 } as never,
      { address: "0x9999999999999999999999999999999999999999" } as never,
      harness.logger,
      { ...settings, apiBaseUrl: "https://app.example.com/rateloop" },
    );

    expect(String(harness.fetchMock.mock.calls[0]?.[0])).toBe(
      "https://app.example.com/rateloop/api/feedback/keeper/pending-reveals?limit=10&leaseSeconds=120&chainId=31337",
    );
    const resultCall = harness.fetchMock.mock.calls.find(call => String(call[0]).includes("/reveal-results"));
    expect(String(resultCall?.[0])).toBe("https://app.example.com/rateloop/api/feedback/keeper/reveal-results");
  });

  it("marks jobs already revealed when the registry record has revealedAt", async () => {
    const harness = buildHarness({
      record: [FEEDBACK_HASH, AUTHOR, 100n, 123n, "0x0000000000000000000000000000000000000001"],
    });

    const result = await revealQueuedFeedback(
      harness.publicClient as never,
      harness.walletClient as never,
      { id: 31337 } as never,
      { address: "0x9999999999999999999999999999999999999999" } as never,
      harness.logger,
      settings,
    );

    expect(result.alreadyRevealed).toBe(1);
    expect(result.revealed).toBe(0);
    expect(harness.walletClient.writeContract).not.toHaveBeenCalled();
    const resultCall = harness.fetchMock.mock.calls.find(call => String(call[0]).includes("/reveal-results"));
    expect(resultCall?.[1]?.body).toBe(JSON.stringify({ id: 7, status: "revealed" }));
  });

  it("reports vote-not-revealed failures as retryable", async () => {
    const harness = buildHarness({
      writeError: new Error("execution reverted: Vote not revealed"),
    });

    const result = await revealQueuedFeedback(
      harness.publicClient as never,
      harness.walletClient as never,
      { id: 31337 } as never,
      { address: "0x9999999999999999999999999999999999999999" } as never,
      harness.logger,
      settings,
    );

    expect(result.failures).toBe(1);
    const resultCall = harness.fetchMock.mock.calls.find(call => String(call[0]).includes("/reveal-results"));
    expect(resultCall?.[1]?.body).toBe(
      JSON.stringify({
        id: 7,
        status: "failed",
        error: "execution reverted: Vote not revealed",
        retryable: true,
      }),
    );
    expect(harness.logger.warn).toHaveBeenCalledWith(
      "Feedback reveal failed",
      expect.objectContaining({
        feedbackId: 7,
        retryable: true,
      }),
    );
  });
});
