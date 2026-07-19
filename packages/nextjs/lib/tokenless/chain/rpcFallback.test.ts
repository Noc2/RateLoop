import { createOrderedRpcFallbackTransport } from "./runtime";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicClient, custom } from "viem";

test("ordered RPC transport fails over without reordering configured providers", async () => {
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

  assert.equal(await client.getChainId(), 84_532);
  assert.deepEqual(calls, ["primary", "fallback"]);
});

test("ordered RPC transport rejects an empty provider set", () => {
  assert.throws(() => createOrderedRpcFallbackTransport([]), /at least one RPC transport/i);
});
