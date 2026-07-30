import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import {
  ADAPTIVE_MONITORING_FLOOR_BPS,
  ADAPTIVE_REVIEW_STAGE_RATE_BPS,
  adaptiveReviewRateBps,
} from "~~/lib/tokenless/adaptiveReviewPolicy";

const CONSUMER_BINDINGS = {
  "adaptiveReview.ts": /adaptiveReviewRateBps\(input\.state\.stage, input\.policy\.productionFloorBps\)/u,
  "adaptiveReviewService.ts": /adaptiveReviewRateBps\(input\.scope\.stage, input\.policy\.productionFloorBps\)/u,
  "agentOverview.ts": /adaptiveReviewRateBps\(stage, productionFloorBps\)/u,
  "agentRegistry.ts": /adaptiveReviewRateBps\(stage, productionFloorBps\)/u,
  "evaluationDashboard.ts": /adaptiveReviewRateBps\(stage, productionFloorBps\)/u,
  "oversightAlerts.ts": /adaptiveReviewRateBps\(stage, floorBps\)/u,
  "reviewPolicyManagement.ts": /adaptiveReviewRateBps\(stage, floorBps\)/u,
} as const;

test("adaptive stage rates have one definition and every runtime consumer binds to it", () => {
  assert.equal(ADAPTIVE_MONITORING_FLOOR_BPS, 1_000);
  assert.deepEqual(ADAPTIVE_REVIEW_STAGE_RATE_BPS, {
    calibrating: 10_000,
    high_coverage: 5_000,
    medium_coverage: 2_500,
    monitoring: 1_000,
  });

  const definitionFiles = readdirSync(new URL(".", import.meta.url), { withFileTypes: true }).flatMap(entry => {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    const source = readFileSync(new URL(entry.name, import.meta.url), "utf8");
    return source.includes("export const ADAPTIVE_REVIEW_STAGE_RATE_BPS") ? [entry.name] : [];
  });
  assert.deepEqual(definitionFiles, ["adaptiveReviewPolicy.ts"]);

  for (const [filename, binding] of Object.entries(CONSUMER_BINDINGS)) {
    const source = readFileSync(new URL(filename, import.meta.url), "utf8");
    assert.match(source, /adaptiveReviewRateBps/u, `${filename} must import the canonical adaptive-rate helper`);
    assert.match(source, binding, `${filename} must derive its adaptive rate from the canonical helper`);
  }
});

test("the shared adaptive-rate rule preserves stage and configured-floor boundaries", () => {
  for (const [floorBps, expectedMonitoringBps] of [
    [0, 1_000],
    [999, 1_000],
    [1_000, 1_000],
    [1_001, 1_001],
    [2_500, 2_500],
    [10_000, 10_000],
  ] as const) {
    assert.equal(adaptiveReviewRateBps("monitoring", floorBps), expectedMonitoringBps);
  }
  assert.equal(adaptiveReviewRateBps("medium_coverage", 1_000), 2_500);
  assert.equal(adaptiveReviewRateBps("medium_coverage", 2_501), 2_501);
  assert.throws(() => adaptiveReviewRateBps("monitoring", -1), /between 0 and 10000/u);
  assert.throws(() => adaptiveReviewRateBps("monitoring", 10_001), /between 0 and 10000/u);
});
