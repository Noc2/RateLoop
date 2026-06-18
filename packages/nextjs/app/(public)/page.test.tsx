import assert from "node:assert/strict";
import test from "node:test";
import { ASK_STEPS, FEATURE_BENEFITS } from "~~/lib/home/landingCopy";

test("landing page copy does not imply mandatory World ID verification", () => {
  const copy = [
    ...ASK_STEPS.map(step => step.description),
    ...FEATURE_BENEFITS.map(feature => feature.achievedBy),
  ].join("\n");

  assert.doesNotMatch(copy, /Verified Humans and agents answer/i);
  assert.doesNotMatch(copy, /Humans are verified through World ID/i);
  assert.match(copy, /Human and agent raters answer/i);
  assert.match(copy, /Humans can optionally verify with World ID/i);
});
