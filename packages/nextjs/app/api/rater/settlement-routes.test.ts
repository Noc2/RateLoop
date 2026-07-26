import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("self-reveal and claim status routes are authenticated and never accept recovery preimages", () => {
  for (const path of ["./reveal/route.ts", "./claim/route.ts"]) {
    const route = source(path);
    assert.match(route, /requireBrowserSession/u);
    assert.match(route, /getRaterSettlementSnapshot/u);
    assert.match(route, /private, no-store/u);
    assert.doesNotMatch(route, /export async function POST/u);
    assert.doesNotMatch(route, /request\.json/u);
  }
});
