import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LOG_BLOCKS_PER_QUERY,
  getLogsInBlockChunks,
} from "../block-log-scan.js";

describe("bounded block log scans", () => {
  it("covers a far-behind deployment without exceeding provider limits", async () => {
    const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    const logs = await getLogsInBlockChunks({
      fromBlock: 100n,
      toBlock: 10_100n,
      stopAfterCount: 1,
      async getLogs(range) {
        const blockCount = range.toBlock - range.fromBlock + 1n;
        if (blockCount > DEFAULT_MAX_LOG_BLOCKS_PER_QUERY) {
          throw new Error("provider rejected an oversized eth_getLogs range");
        }
        ranges.push(range);
        return range.toBlock === 10_100n ? ["fresh-round-commit"] : [];
      },
    });

    expect(logs).toEqual(["fresh-round-commit"]);
    expect(ranges).toEqual([{ fromBlock: 8_102n, toBlock: 10_100n }]);
  });

  it("walks older chunks without gaps when the indexed commit is historical", async () => {
    const ranges: Array<{ fromBlock: bigint; toBlock: bigint }> = [];
    await getLogsInBlockChunks({
      fromBlock: 100n,
      toBlock: 10_100n,
      async getLogs(range) {
        ranges.push(range);
        return [];
      },
    });

    expect(ranges).toHaveLength(6);
    expect(ranges[0]).toEqual({ fromBlock: 8_102n, toBlock: 10_100n });
    expect(ranges.at(-1)).toEqual({ fromBlock: 100n, toBlock: 105n });
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]?.toBlock).toBe(ranges[index - 1]!.fromBlock - 1n);
    }
  });

  it("does not query when the requested range is empty", async () => {
    let queries = 0;
    await expect(
      getLogsInBlockChunks({
        fromBlock: 2n,
        toBlock: 1n,
        async getLogs() {
          queries += 1;
          return [];
        },
      }),
    ).resolves.toEqual([]);
    expect(queries).toBe(0);
  });
});
