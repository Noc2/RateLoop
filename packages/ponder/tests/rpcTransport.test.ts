import { describe, expect, it, vi } from "vitest";
import { chunkGetLogsParams, httpWithGetLogsBlockRange } from "../src/rpcTransport";

describe("RPC transport helpers", () => {
  it("splits oversized eth_getLogs block ranges into provider-safe chunks", () => {
    expect(
      chunkGetLogsParams(
        {
          address: "0x1111111111111111111111111111111111111111",
          fromBlock: "0x1",
          toBlock: "0x3e9",
        },
        1_000,
      ),
    ).toEqual([
      {
        address: "0x1111111111111111111111111111111111111111",
        fromBlock: "0x1",
        toBlock: "0x3e8",
      },
      {
        address: "0x1111111111111111111111111111111111111111",
        fromBlock: "0x3e9",
        toBlock: "0x3e9",
      },
    ]);
  });

  it("leaves non-numeric block tag requests untouched", () => {
    const params = {
      fromBlock: "latest",
      toBlock: "latest",
    };

    expect(chunkGetLogsParams(params, 1_000)).toEqual([params]);
  });

  it("combines split eth_getLogs responses in order", async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { id: number; params: [{ fromBlock: string; toBlock: string }] };

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: [{ blockNumber: body.params[0].fromBlock }, { blockNumber: body.params[0].toBlock }],
        }),
        {
          headers: { "content-type": "application/json" },
        },
      );
    });
    const transport = httpWithGetLogsBlockRange("https://rpc.example", 1_000, { fetchFn })({});

    const logs = await transport.request({
      method: "eth_getLogs",
      params: [
        {
          fromBlock: "0x1",
          toBlock: "0x3e9",
        },
      ],
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(logs).toEqual([
      { blockNumber: "0x1" },
      { blockNumber: "0x3e8" },
      { blockNumber: "0x3e9" },
      { blockNumber: "0x3e9" },
    ]);
  });
});
