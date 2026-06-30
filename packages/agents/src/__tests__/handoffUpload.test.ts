import { afterEach, describe, expect, it, vi } from "vitest";
import { createAskHandoffWithStagedImageUploads } from "../handoffUpload.js";

describe("handoff upload helper", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults staged handoff uploads to the public RateLoop origin", async () => {
    const requestedUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = String(input);
        requestedUrls.push(url);

        if (url === "https://www.rateloop.ai/api/agent/handoffs") {
          return new Response(
            JSON.stringify({
              assets: [],
              handoffId: "handoff_default",
              handoffToken: "token_default",
              handoffUrl: "https://www.rateloop.ai/agent/handoff/handoff_default",
              resultTool: "rateloop_get_result",
              statusTool: "rateloop_get_handoff_status",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (
          url ===
          "https://www.rateloop.ai/api/agent/handoffs/handoff_default"
        ) {
          return new Response(
            JSON.stringify({
              assets: [],
              handoffId: "handoff_default",
              handoffToken: "token_default",
              handoffUrl: "https://www.rateloop.ai/agent/handoff/handoff_default",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response("unexpected", { status: 500 });
      }),
    );

    await createAskHandoffWithStagedImageUploads({
      config: {},
      generatedImages: [],
      request: { clientRequestId: "handoff-default-origin-test" },
    });

    expect(requestedUrls).toEqual([
      "https://www.rateloop.ai/api/agent/handoffs",
      "https://www.rateloop.ai/api/agent/handoffs/handoff_default",
    ]);
  });

  it("preserves path-prefixed API bases and attaches timeout signals to JSON requests", async () => {
    const requestedUrls: string[] = [];
    const requestSignals: Array<AbortSignal | null | undefined> = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);
        requestedUrls.push(url);
        requestSignals.push(init?.signal);

        if (url === "https://rateloop.example/prefix/api/agent/handoffs") {
          return new Response(
            JSON.stringify({
              assets: [],
              handoffId: "handoff_1",
              handoffToken: "token_1",
              handoffUrl: "https://rateloop.example/handoff/handoff_1",
              resultTool: "rateloop_get_result",
              statusTool: "rateloop_get_handoff_status",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        if (url === "https://rateloop.example/prefix/api/agent/handoffs/handoff_1") {
          return new Response(
            JSON.stringify({
              assets: [],
              handoffId: "handoff_1",
              handoffToken: "token_1",
              handoffUrl: "https://rateloop.example/handoff/handoff_1",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }

        return new Response("unexpected", { status: 500 });
      }),
    );

    await createAskHandoffWithStagedImageUploads({
      config: {
        apiBaseUrl: "https://rateloop.example/prefix",
        mcpAccessToken: "agent-token",
      },
      generatedImages: [],
      request: { clientRequestId: "handoff-prefix-test" },
    });

    expect(requestedUrls).toEqual([
      "https://rateloop.example/prefix/api/agent/handoffs",
      "https://rateloop.example/prefix/api/agent/handoffs/handoff_1",
    ]);
    expect(requestSignals).toHaveLength(2);
    expect(requestSignals.every(signal => signal instanceof AbortSignal)).toBe(true);
  });
});
