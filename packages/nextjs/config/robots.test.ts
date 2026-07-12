import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("robots allow the test UI but not API crawling", () => {
  const robots = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.doesNotMatch(robots, /rateloop\.ai|sitemap|og\/vote/i);
});
