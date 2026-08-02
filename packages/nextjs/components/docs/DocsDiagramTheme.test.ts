import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const primitives = readFileSync(new URL("./DocsDiagramPrimitives.tsx", import.meta.url), "utf8");
const bonusChart = readFileSync(new URL("./SurprisinglyPopularBonusChart.tsx", import.meta.url), "utf8");

test("docs diagrams use theme-aware neutral accents and readable axis labels", () => {
  assert.match(primitives, /neutral: "var\(--rateloop-text-secondary\)"/);
  assert.doesNotMatch(primitives, /neutral: "rgb\(/);
  assert.doesNotMatch(bonusChart, /opacity-45/);
  assert.match(
    bonusChart,
    /leave-one-out surprise margin[\s\S]*opacity-60|opacity-60[\s\S]*leave-one-out surprise margin/,
  );
  assert.match(
    bonusChart,
    /top-up \(% of guaranteed base\)[\s\S]*opacity-60|opacity-60[\s\S]*top-up \(% of guaranteed base\)/,
  );
});
