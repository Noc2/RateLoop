import { createConfiguredRpcTransport, createOrderedRpcFallbackTransport } from "./runtime";
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

test("the maintenance signal aborts an in-flight RPC before fallback timeouts can accumulate", async () => {
  let requestStarted!: () => void;
  const started = new Promise<void>(resolve => {
    requestStarted = resolve;
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestStarted();
    return new Promise<Response>((_resolve, reject) => {
      const rejectForAbort = () => reject(init?.signal?.reason ?? new Error("request aborted"));
      if (init?.signal?.aborted) rejectForAbort();
      else init?.signal?.addEventListener("abort", rejectForAbort, { once: true });
    });
  }) as typeof fetch;
  try {
    const controller = new AbortController();
    const client = createPublicClient({
      transport: createConfiguredRpcTransport(
        ["https://primary.example.test", "https://fallback-one.example.test", "https://fallback-two.example.test"],
        controller.signal,
      ),
    });
    const request = client.getChainId();
    await started;
    controller.abort(new Error("maintenance deadline exhausted"));
    await assert.rejects(request);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
