import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");
const landingPage = readFileSync(new URL("../../app/(public)/page.tsx", import.meta.url), "utf8");
const setupFlow = readFileSync(new URL("./agents/setup/AgentSetupFlow.tsx", import.meta.url), "utf8");
const publishingPolicy = readFileSync(new URL("./agents/AgentPublishingPolicyPanel.tsx", import.meta.url), "utf8");

test("secondary app actions reuse the legacy solid treatment", () => {
  assert.match(styles, /--rateloop-secondary-button-bg: rgb\(245 245 245 \/ 0\.18\)/);
  assert.match(styles, /--rateloop-secondary-button-bg-hover: rgb\(245 245 245 \/ 0\.24\)/);
  assert.match(styles, /\.btn\.rateloop-secondary-action,/);
  assert.match(styles, /\.btn\.btn-outline,/);
  assert.match(styles, /\.btn\.btn-secondary:not\(\.btn-circle\):not\(\.btn-square\)/);
});

test("back actions use the solid secondary button with a decorative left chevron", () => {
  assert.match(styles, /\.rateloop-back-action::before/);
  assert.match(setupFlow, /rateloop-secondary-action rateloop-back-action/);
  assert.match(publishingPolicy, /rateloop-secondary-action rateloop-back-action/);
});

test("landing page calls to action keep their dedicated styling", () => {
  assert.doesNotMatch(landingPage, /rateloop-secondary-action/);
});
