import { describe, expect, it } from "vitest";
import { loadTokenlessAgentsRuntimeConfig } from "../config";

describe("tokenless agent config", () => {
  it("requires and normalizes an isolated deployment URL", () => {
    expect(
      loadTokenlessAgentsRuntimeConfig({
        RATELOOP_AGENT_API_KEY: "test-scoped-key",
        RATELOOP_AGENT_API_PATH: "/api/agent/v1/",
        RATELOOP_API_BASE_URL: "https://tokenless-preview.vercel.app/",
        RATELOOP_REQUEST_TIMEOUT_MS: "12000",
      }),
    ).toEqual({
      apiKey: "test-scoped-key",
      apiBaseUrl: "https://tokenless-preview.vercel.app",
      apiPath: "/api/agent/v1",
      requestTimeoutMs: 12_000,
    });
  });

  it("never defaults to or accepts the legacy RateLoop domain", () => {
    expect(() => loadTokenlessAgentsRuntimeConfig({})).toThrow(
      /RATELOOP_API_BASE_URL is required/,
    );
    expect(() =>
      loadTokenlessAgentsRuntimeConfig({
        RATELOOP_API_BASE_URL: "https://www.rateloop.ai",
      }),
    ).toThrow(/not rateloop\.ai/);
  });

  it("allows loopback HTTP but rejects insecure remote HTTP", () => {
    expect(
      loadTokenlessAgentsRuntimeConfig({
        RATELOOP_API_BASE_URL: "http://127.0.0.1:3000",
      }).apiBaseUrl,
    ).toBe("http://127.0.0.1:3000");
    expect(() =>
      loadTokenlessAgentsRuntimeConfig({
        RATELOOP_API_BASE_URL: "http://tokenless.example",
      }),
    ).toThrow(/must use HTTPS/);
  });
});
