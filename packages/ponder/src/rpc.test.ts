import { describe, expect, it } from "vitest";
import { createPublicClient, custom } from "viem";
import { createOrderedRpcFallbackTransport, resolvePonderRpcUrls } from "./rpc";
import type { TokenlessDeployment } from "./protocol-deployment";

const deployment = {
  chainId: 84_532,
  network: "baseSepolia",
} as TokenlessDeployment;

describe("Ponder RPC failover", () => {
  it("requires distinct HTTPS fallbacks for a live network", () => {
    expect(() =>
      resolvePonderRpcUrls(deployment, {
        PONDER_RPC_URL_84532: "https://primary.example",
      }),
    ).toThrow(/must contain at least one independent HTTPS RPC/i);
    expect(() =>
      resolvePonderRpcUrls(deployment, {
        PONDER_RPC_URL_84532: "https://primary.example",
        PONDER_RPC_FALLBACK_URLS_84532: "http://fallback.example",
      }),
    ).toThrow(/must use HTTPS/i);
    expect(() =>
      resolvePonderRpcUrls(deployment, {
        PONDER_RPC_URL_84532: "https://primary.example",
        PONDER_RPC_FALLBACK_URLS_84532: "https://primary.example",
      }),
    ).toThrow(/must be distinct/i);
  });

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
});
