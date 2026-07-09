import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const robots = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");

function readRobotsBlock(userAgent: string): string {
  return (
    robots.split(/\n{2,}/).find(block => block.split(/\n/).some(line => line.trim() === `User-agent: ${userAgent}`)) ??
    ""
  );
}

test("robots.txt lets social crawlers fetch OG images without opening every API route", () => {
  assert.match(robots, /^Allow: \/api\/og\/$/m);
  assert.match(robots, /^Allow: \/og\/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.ok(robots.indexOf("Allow: /api/og/") < robots.indexOf("Disallow: /api/"));
});

test("robots.txt explicitly lets Twitterbot fetch social card images", () => {
  const twitterbot = readRobotsBlock("Twitterbot");

  assert.match(twitterbot, /^Allow: \/api\/og\/$/m);
  assert.match(twitterbot, /^Allow: \/og\/$/m);
  assert.match(twitterbot, /^Allow: \/og\/vote\.png$/m);
  assert.match(twitterbot, /^Allow: \/og-image\.jpg$/m);
  assert.match(twitterbot, /^Allow: \/twitter-image\.jpg$/m);
  assert.doesNotMatch(twitterbot, /^Disallow: \/api\/$/m);
});
