import { describe, expect, it } from "vitest";
import { createPublicClient, custom } from "viem";
import { createOrderedRpcFallbackTransport } from "../rpc.js";

describe("keeper RPC failover", () => {
  it("tries explicitly configured transports in order", async () => {
    const calls: string[] = [];
    const client = createPublicClient({
      transport: createOrderedRpcFallbackTransport([
        custom({
          request: async () => {
            calls.push("primary");
            throw new Error("primary unavailable");
          },
        }),
        custom({
          request: async () => {
            calls.push("fallback");
            return "0x14a34";
          },
        }),
      ]),
    });

    expect(await client.getChainId()).toBe(84_532);
    expect(calls).toEqual(["primary", "fallback"]);
  });

  it("rejects an empty provider set", () => {
    expect(() => createOrderedRpcFallbackTransport([])).toThrow(
      /at least one RPC transport/i,
    );
  });
});
