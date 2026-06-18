import { buildAppRelativeUrl, resolveApiRequestAppBaseUrl, resolveRequestAppBaseUrl } from "./appRelative";
import assert from "node:assert/strict";
import test from "node:test";

test("buildAppRelativeUrl preserves a path-prefixed app base", () => {
  assert.equal(
    buildAppRelativeUrl("https://example.com/rateloop", "/settings?tab=notifications").toString(),
    "https://example.com/rateloop/settings?tab=notifications",
  );
});

test("buildAppRelativeUrl avoids double slashes for root app bases", () => {
  assert.equal(buildAppRelativeUrl("https://example.com/", "/rate").toString(), "https://example.com/rate");
});

test("buildAppRelativeUrl rejects absolute URL input paths", () => {
  assert.throws(() => buildAppRelativeUrl("https://example.com/rateloop", "https://evil.example/settings"));
});

test("resolveRequestAppBaseUrl strips a known API route suffix", () => {
  assert.equal(
    resolveRequestAppBaseUrl("https://example.com/rateloop/api/agent/handoffs", "/api/agent/handoffs"),
    "https://example.com/rateloop",
  );
});

test("resolveApiRequestAppBaseUrl strips the API path from prefixed requests", () => {
  assert.equal(
    resolveApiRequestAppBaseUrl("https://example.com/rateloop/api/mcp/public"),
    "https://example.com/rateloop",
  );
});
