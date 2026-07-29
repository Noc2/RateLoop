import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("how-it-works follows the hosted invited-review path", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: HowItWorksPage } = await import("./page");
  const html = renderToStaticMarkup(<HowItWorksPage />).replace(/\s+/g, " ");

  assert.match(html, /Review.*rateloop-text-gradient.*Agent Outputs/i);
  assert.match(
    html,
    /<h3 id="human-assurance-loop-title"[^>]*>\s*<span>Human<\/span>\s*<span>Assurance<\/span>\s*<span class="inline-block text-white">Loop<\/span>\s*<\/h3>/i,
  );
  assert.match(html, /hosted service connects an agent to invited workspace reviewers/i);
  assert.match(html, /Reviews are private and unpaid/i);
  assert.doesNotMatch(html, /At a glance/i);
  assert.match(html, /href="\/agents\/review-setup">Review setup<\/a>/i);
  assert.match(html, /completed work and supporting records together in Results/i);
  assert.match(html, /agent version, policy version, workflow, risk tier, and reviewer audience/i);
  assert.match(html, /owner controls the question, response window, reviewer audience, and data boundary/i);
  assert.match(html, /requests one review and waits for the same operation instead of creating a duplicate/i);
  assert.match(html, /Generic MCP integrations are advisory/i);
  assert.match(html, /only a verified host integration that controls delivery/i);
  assert.match(html, /can establish that the output stayed blocked/i);
  assert.doesNotMatch(html, /can prove the output stayed blocked/i);
  assert.match(html, /only to reviewers invited to the workspace/i);
  assert.match(html, /Reviewers do not see other responses while answering/i);
  assert.match(html, /assigned reviewers and authorized RateLoop workloads may read it/i);
  assert.match(html, /does not issue an automatic production, safety, legal, medical, or compliance approval/i);
  assert.match(html, /id="agent-flow"/i);
  assert.match(html, /id="reviewer-flow"/i);
  assert.match(html, /id="decision-evidence"/i);
  assert.match(html, /id="owner-decision"/i);
  assert.match(html, /href="\/docs\/evidence".*Evidence reference/i);
  assert.match(html, /id="adaptive-review"/i);
  assert.doesNotMatch(html, /paid commit|bounty|USDC|RBTS|drand|settlement|hybrid/i);
});
