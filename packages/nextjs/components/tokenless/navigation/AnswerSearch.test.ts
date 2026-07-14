import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("answer search remains visible across tokenless routes", () => {
  const source = readFileSync(new URL("./AnswerSearch.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /if \(!humanSearch\) return null/);
  assert.match(source, /router\.push\(`\/human\?tab=discover/);
});
