import { afterEach, describe, expect, it, vi } from "vitest";

const mockDbSelect = vi.fn();

vi.mock("ponder:api", () => ({
  db: {
    select: mockDbSelect,
  },
}));

vi.mock("ponder:schema", () => ({
  round: {
    humanVerifiedCommitCount: "round.humanVerifiedCommitCount",
    contentId: "round.contentId",
    roundId: "round.roundId",
  },
  vote: {
    contentId: "vote.contentId",
    roundId: "vote.roundId",
    credentialMask: "vote.credentialMask",
    committedAt: "vote.committedAt",
  },
}));

function mockStaleCount(staleRoundCount: number) {
  const from = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue([{ staleRoundCount }]),
  });
  mockDbSelect.mockReturnValue({ from });
}

describe("inspectHumanVerifiedCommitCountHealth", () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns ok when no stale humanVerifiedCommitCount rows exist", async () => {
    mockStaleCount(0);
    const { inspectHumanVerifiedCommitCountHealth } = await import("../src/api/human-verified-commit-health.js");

    await expect(inspectHumanVerifiedCommitCountHealth()).resolves.toEqual({
      status: "ok",
      staleRoundCount: 0,
    });
  });

  it("returns warning when human commits exist but round counts are still zero", async () => {
    mockStaleCount(3);
    const { inspectHumanVerifiedCommitCountHealth } = await import("../src/api/human-verified-commit-health.js");

    await expect(inspectHumanVerifiedCommitCountHealth()).resolves.toMatchObject({
      status: "warning",
      staleRoundCount: 3,
      message: expect.stringContaining("humanVerifiedCommitCount=0"),
    });
  });
});
