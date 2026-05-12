import { afterEach, describe, expect, it, vi } from "vitest";
import { createPendingProbeTracker, validateProberContracts } from "../registry.js";

const REGISTRY = "0x3333333333333333333333333333333333333333" as const;
const RATER = "0x1111111111111111111111111111111111111111" as const;
const OTHER_RATER = "0x2222222222222222222222222222222222222222" as const;
const PROBE_ROLE = `0x${"44".repeat(32)}` as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("pending probe tracker", () => {
  it("rebuilds pending candidates from declaration and probe request logs", async () => {
    const getLogs = vi.fn(async ({ event }: { event: { name: string } }) => {
      if (event.name === "DeclarationSubmitted") {
        return [
          {
            blockNumber: 120n,
            args: {
              rater: RATER,
              version: 2,
              probePending: true,
              declarationHash: `0x${"aa".repeat(32)}`,
            },
          },
        ];
      }

      if (event.name === "ProbeRequested") {
        return [
          {
            blockNumber: 150n,
            args: {
              rater: OTHER_RATER,
              version: 3,
              declarationHash: `0x${"bb".repeat(32)}`,
            },
          },
        ];
      }

      return [];
    });

    const tracker = createPendingProbeTracker({
      startBlock: 100,
      recentBlockLookback: 10,
      declarationScanBatchBlocks: 50,
    });

    const scan = await tracker.scan(
      {
        getBlockNumber: vi.fn().mockResolvedValue(150n),
        getLogs,
      } as any,
      REGISTRY,
    );

    expect(scan.discoveredCandidates).toBe(2);
    expect(scan.pendingCount).toBe(2);

    const claimed = tracker.claim(5);
    expect(claimed).toHaveLength(2);
    expect(claimed[0]).toMatchObject({
      rater: OTHER_RATER,
      source: "probe-requested",
    });
    expect(claimed[1]).toMatchObject({
      rater: RATER,
      source: "recent-declaration",
    });
  });
});

describe("registry validation", () => {
  it("requires the configured signer to hold PROBE_ROLE", async () => {
    await expect(
      validateProberContracts(
        {
          getCode: vi.fn().mockResolvedValue("0x1234"),
          readContract: vi
            .fn()
            .mockResolvedValueOnce(PROBE_ROLE)
            .mockResolvedValueOnce(false),
        } as any,
        REGISTRY,
        RATER,
      ),
    ).rejects.toThrow(`Configured signer ${RATER} does not have PROBE_ROLE`);
  });
});
