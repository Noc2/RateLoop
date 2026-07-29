import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { ADAPTIVE_REVIEW_STAGE_RATE_BPS } from "~~/lib/tokenless/adaptiveReview";

const CONSUMER_BINDINGS = {
  "agentOverview.ts": /Math\.max\(ADAPTIVE_REVIEW_STAGE_RATE_BPS\[stage\], productionFloorBps\)/u,
  "agentRegistry.ts": /Math\.max\(ADAPTIVE_REVIEW_STAGE_RATE_BPS\[stage\], productionFloorBps\)/u,
  "evaluationDashboard.ts": /Math\.max\(ADAPTIVE_REVIEW_STAGE_RATE_BPS\[stage\], productionFloorBps\)/u,
  "oversightAlerts.ts": /const stageRate = ADAPTIVE_REVIEW_STAGE_RATE_BPS\[stage\]/u,
  "reviewPolicyManagement.ts": /Math\.max\(ADAPTIVE_REVIEW_STAGE_RATE_BPS\[stage\], floorBps\)/u,
} as const;

const STAGE_RATE_TABLE =
  /\{\s*calibrating:\s*10_000,\s*high_coverage:\s*5_000,\s*medium_coverage:\s*2_500,\s*monitoring:\s*[\d_]+,\s*\}/gu;

test("adaptive stage rates have one definition and every consumer binds to it", () => {
  assert.deepEqual(ADAPTIVE_REVIEW_STAGE_RATE_BPS, {
    calibrating: 10_000,
    high_coverage: 5_000,
    medium_coverage: 2_500,
    monitoring: 2_500,
  });

  const definitionFiles = readdirSync(new URL(".", import.meta.url), { withFileTypes: true }).flatMap(entry => {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    const source = readFileSync(new URL(entry.name, import.meta.url), "utf8");
    return source.match(STAGE_RATE_TABLE)?.map(() => entry.name) ?? [];
  });
  assert.deepEqual(definitionFiles, ["adaptiveReview.ts"]);

  for (const [filename, binding] of Object.entries(CONSUMER_BINDINGS)) {
    const source = readFileSync(new URL(filename, import.meta.url), "utf8");
    assert.match(
      source,
      /import \{[^}]*ADAPTIVE_REVIEW_STAGE_RATE_BPS[^}]*\} from "~~\/lib\/tokenless\/adaptiveReview";/u,
      `${filename} must import the canonical stage rates`,
    );
    assert.match(source, binding, `${filename} must derive its adaptive rate from the canonical stage rates`);
  }
});
