import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCES = [
  ["Resend", new URL("./notifications/resend.ts", import.meta.url), /signal:\s*resendRequestSignal\(\)/gu, 4],
  ["WORM S3", new URL("./tokenless/assuranceWormS3.ts", import.meta.url), /signal:\s*AbortSignal\.timeout\(/gu, 1],
  ["landing Ponder", new URL("./home/socialProofServer.ts", import.meta.url), /signal:\s*AbortSignal\.timeout\(/gu, 1],
] as const;

test("request paths that can block user or scheduled work carry explicit deadlines", () => {
  for (const [label, sourceUrl, pattern, expected] of SOURCES) {
    const source = readFileSync(sourceUrl, "utf8");
    assert.equal(source.match(pattern)?.length ?? 0, expected, `${label} deadline coverage drifted`);
  }
});
