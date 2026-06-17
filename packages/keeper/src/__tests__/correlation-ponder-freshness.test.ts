import { afterEach, describe, expect, it, vi } from "vitest";
import { ROUND_STATE } from "@rateloop/contracts/protocol";
import { PAYOUT_DOMAIN_PUBLIC_RATING, PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD } from "@rateloop/node-utils/correlationScoring";

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

function mockRoundSnapshot(revealedCount: string, voteCount: string) {
  return new Response(
    JSON.stringify({
      items: [{ roundId: "7", revealedCount, voteCount, state: ROUND_STATE.Settled }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("areCorrelationCandidatesPonderFresh", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockReadRound.mockReset();
  });

  it("queries Ponder with roundId and limit=1", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/correlation/round-votes")) {
        return new Response(JSON.stringify({ items: [{}, {}, {}] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return mockRoundSnapshot("3", "3");
    });
    mockReadRound.mockResolvedValue({
      state: ROUND_STATE.Settled,
      revealedCount: 3n,
      voteCount: 3n,
    });

    const { areCorrelationCandidatesPonderFresh } = await import("../correlation-ponder-freshness.js");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fresh = await areCorrelationCandidatesPonderFresh(
      {} as never,
      [{ domain: 1, rewardPoolId: 5n, contentId: 42n, roundId: 7n }],
      logger,
    );

    expect(fresh).toBe(true);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain("roundId=7");
    expect(requestUrl).toContain("limit=1");
  });

  it("defers when Ponder vote count lags chain", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/correlation/round-votes")) {
        return new Response(JSON.stringify({ items: [{}, {}, {}] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return mockRoundSnapshot("3", "2");
    });
    mockReadRound.mockResolvedValue({
      state: ROUND_STATE.Settled,
      revealedCount: 3n,
      voteCount: 3n,
    });

    const { areCorrelationCandidatesPonderFresh } = await import("../correlation-ponder-freshness.js");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fresh = await areCorrelationCandidatesPonderFresh(
      {} as never,
      [{ domain: 1, rewardPoolId: 5n, contentId: 42n, roundId: 7n }],
      logger,
    );

    expect(fresh).toBe(false);
    expect(logger.debug).toHaveBeenCalledWith(
      "Deferring correlation artifact build until Ponder reflects vote count",
      expect.objectContaining({ chainVoteCount: "3", ponderVoteCount: "2" }),
    );
  });

  it("defers when correlation-eligible vote pagination is truncated", async () => {
    const fullPage = Array.from({ length: 1000 }, () => ({}));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/correlation/round-votes")) {
        return new Response(JSON.stringify({ items: fullPage }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return mockRoundSnapshot("3", "3");
    });
    mockReadRound.mockResolvedValue({
      state: ROUND_STATE.Settled,
      revealedCount: 3n,
      voteCount: 3n,
    });

    const { areCorrelationCandidatesPonderFresh } = await import("../correlation-ponder-freshness.js");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fresh = await areCorrelationCandidatesPonderFresh(
      {} as never,
      [{ domain: 1, rewardPoolId: 5n, contentId: 42n, roundId: 7n }],
      logger,
    );

    expect(fresh).toBe(false);
    expect(
      fetchMock.mock.calls.some(call => String(call[0]).includes("/correlation/round-votes")),
    ).toBe(true);
  });

  it("uses rating-round-votes for public-rating candidates without rewardPoolId", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/correlation/rating-round-votes")) {
        return new Response(JSON.stringify({ items: [{}, {}] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/rounds")) {
        return mockRoundSnapshot("2", "2");
      }
      return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
    });
    mockReadRound.mockResolvedValue({
      state: ROUND_STATE.Settled,
      revealedCount: 2n,
      voteCount: 2n,
    });

    const { areCorrelationCandidatesPonderFresh } = await import("../correlation-ponder-freshness.js");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fresh = await areCorrelationCandidatesPonderFresh(
      {} as never,
      [{ domain: PAYOUT_DOMAIN_PUBLIC_RATING, rewardPoolId: 0n, contentId: 9n, roundId: 2n }],
      logger,
      { ponderNowSeconds: 1_700_000n },
    );

    expect(fresh).toBe(true);
    const voteUrl = fetchMock.mock.calls
      .map(call => String(call[0]))
      .find(value => value.includes("/correlation/rating-round-votes"));
    expect(voteUrl).toBeDefined();
    expect(voteUrl).toContain("now=1700000");
    expect(voteUrl).not.toContain("rewardPoolId");
    expect(
      fetchMock.mock.calls.some(call => String(call[0]).includes("/correlation/round-votes")),
    ).toBe(false);
  });

  it("uses bundle-round-votes for bundle reward candidates", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/correlation/bundle-round-votes")) {
        return new Response(JSON.stringify({ items: [{}] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/rounds")) {
        return mockRoundSnapshot("1", "1");
      }
      return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
    });
    mockReadRound.mockResolvedValue({
      state: ROUND_STATE.Settled,
      revealedCount: 1n,
      voteCount: 1n,
    });

    const { areCorrelationCandidatesPonderFresh } = await import("../correlation-ponder-freshness.js");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fresh = await areCorrelationCandidatesPonderFresh(
      {} as never,
      [{ domain: PAYOUT_DOMAIN_QUESTION_BUNDLE_REWARD, rewardPoolId: 12n, contentId: 3n, roundId: 1n }],
      logger,
    );

    expect(fresh).toBe(true);
    expect(
      fetchMock.mock.calls.some(call => String(call[0]).includes("/correlation/bundle-round-votes?")),
    ).toBe(true);
  });

  it("passes when all revealed votes are correlation-excluded but indexing is complete", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/correlation/round-votes")) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return mockRoundSnapshot("3", "3");
    });
    mockReadRound.mockResolvedValue({
      state: ROUND_STATE.Settled,
      revealedCount: 3n,
      voteCount: 3n,
    });

    const { areCorrelationCandidatesPonderFresh } = await import("../correlation-ponder-freshness.js");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fresh = await areCorrelationCandidatesPonderFresh(
      {} as never,
      [{ domain: 1, rewardPoolId: 5n, contentId: 42n, roundId: 7n }],
      logger,
    );

    expect(fresh).toBe(true);
  });

  it("defers without throwing when public-rating vote fetch would 400 on round-votes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/correlation/round-votes")) {
        return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
      }
      if (url.includes("/correlation/rating-round-votes")) {
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return mockRoundSnapshot("1", "1");
    });
    mockReadRound.mockResolvedValue({
      state: ROUND_STATE.Settled,
      revealedCount: 1n,
      voteCount: 1n,
    });

    const { areCorrelationCandidatesPonderFresh } = await import("../correlation-ponder-freshness.js");
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const fresh = await areCorrelationCandidatesPonderFresh(
      {} as never,
      [{ domain: PAYOUT_DOMAIN_PUBLIC_RATING, rewardPoolId: 0n, contentId: 9n, roundId: 2n }],
      logger,
    );

    expect(fresh).toBe(true);
    expect(
      fetchMock.mock.calls.some(call => String(call[0]).includes("/correlation/rating-round-votes")),
    ).toBe(true);
  });
});
