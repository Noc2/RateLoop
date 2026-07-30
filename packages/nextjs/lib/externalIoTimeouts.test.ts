import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCES = [
  [
    "WORM S3",
    new URL("./tokenless/assuranceWormS3.ts", import.meta.url),
    /signal:\s*maintenanceRequestSignal\([^)]*\)/gu,
    1,
  ],
  ["landing Ponder", new URL("./home/socialProofServer.ts", import.meta.url), /signal:\s*AbortSignal\.timeout\(/gu, 1],
] as const;

test("every Resend provider call uses the shared deadline compositor", () => {
  const source = readFileSync(new URL("./notifications/resend.ts", import.meta.url), "utf8");
  const providerCalls = source.match(/(?:fetch|fetchImpl)\("https:\/\/api\.resend\.com\/emails"/gu)?.length ?? 0;
  const deadlines = source.match(/signal:\s*resendRequestSignal\([^)]*\)/gu)?.length ?? 0;
  assert.equal(providerCalls, 4, "Resend provider call inventory drifted");
  assert.equal(deadlines, providerCalls, "Resend deadline coverage drifted");
});

test("request paths that can block user or scheduled work carry explicit deadlines", () => {
  for (const [label, sourceUrl, pattern, expected] of SOURCES) {
    const source = readFileSync(sourceUrl, "utf8");
    assert.equal(source.match(pattern)?.length ?? 0, expected, `${label} deadline coverage drifted`);
  }
});
