import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUND_STATE } from "@rateloop/contracts/protocol";

const mockReadRound = vi.fn();
const mockConfig = {
  ponderBaseUrl: "https://ponder.test",
  contracts: { votingEngine: "0x1111111111111111111111111111111111111111" },
};

vi.mock("../config.js", () => ({
  config: mockConfig,
}));

vi.mock("../contract-reads.js", () => ({
  readRound: (...args: unknown[]) => mockReadRound(...args),
}));

describe("areCorrelationCandidatesPonderFresh", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockReadRound.mockReset();
  });

  it("queries Ponder with roundId and limit=1", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ roundId: "7", revealedCount: "3", voteCount: "3", state: ROUND_STATE.Settled }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    mockReadRound.mockResolvedValue({
      state: ROUND_STATE.Settled,
      revealedCount: 3n,
      voteCount: 3n,
    });

    const { areCorrelationCandidatesPonderFresh } = await import("../correlation-ponder-freshness.js");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fresh = await areCorrelationCandidatesPonderFresh(
      {} as never,
      [{ domain: 1, rewardPoolId: 0n, contentId: 42n, roundId: 7n }],
      logger,
    );

    expect(fresh).toBe(true);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("roundId=7");
    expect(requestUrl).toContain("limit=1");
  });

  it("defers when Ponder vote count lags chain", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ roundId: "7", revealedCount: "3", voteCount: "2", state: ROUND_STATE.Settled }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    mockReadRound.mockResolvedValue({
      state: ROUND_STATE.Settled,
      revealedCount: 3n,
      voteCount: 3n,
    });

    const { areCorrelationCandidatesPonderFresh } = await import("../correlation-ponder-freshness.js");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fresh = await areCorrelationCandidatesPonderFresh(
      {} as never,
      [{ domain: 1, rewardPoolId: 0n, contentId: 42n, roundId: 7n }],
      logger,
    );

    expect(fresh).toBe(false);
    expect(logger.debug).toHaveBeenCalledWith(
      "Deferring correlation artifact build until Ponder reflects vote count",
      expect.objectContaining({ chainVoteCount: "3", ponderVoteCount: "2" }),
    );
  });
});
