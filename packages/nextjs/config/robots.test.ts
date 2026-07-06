import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const robots = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");

test("robots.txt lets social crawlers fetch OG images without opening every API route", () => {
  assert.match(robots, /^Allow: \/api\/og\/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.ok(robots.indexOf("Allow: /api/og/") < robots.indexOf("Disallow: /api/"));
});
