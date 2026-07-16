import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./WorkspaceEvidenceSummaryStrip.tsx", import.meta.url), "utf8");

test("the agent workspace summary labels packet, scoped coverage, and anchor state without conflating them", () => {
  assert.match(source, /Last decision packet/);
  assert.match(source, /Most conservative coverage stage/);
  assert.match(source, /Latest packet anchor/);
  assert.match(source, /No evidence scope/);
  assert.match(source, /No packet anchor/);
  assert.match(source, /Owner\/admin view/);
});
