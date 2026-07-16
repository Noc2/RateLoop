import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("site search routes every page to global results", () => {
  const source = readFileSync(new URL("./SiteSearch.tsx", import.meta.url), "utf8");

  assert.match(source, /const SEARCH_ROUTE = "\/search"/);
  assert.match(source, /router\.push\(target\)/);
  assert.match(source, /router\.replace\(target, \{ scroll: false \}\)/);
  assert.doesNotMatch(source, /\/human\?tab=discover/);
});
