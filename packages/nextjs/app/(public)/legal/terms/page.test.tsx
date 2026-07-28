import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("terms state service limits and accepted-work protection", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: TermsPage } = await import("./page");
  const html = renderToStaticMarkup(<TermsPage />).replace(/\s+/g, " ");

  assert.match(html, /At a glance/i);
  assert.match(html, /aria-label="On this page"/i);
  assert.match(html, /complete terms below provide the details/i);
  for (const href of [
    "#service-scope",
    "#who-may-use",
    "#customer-material",
    "#workspace-subscriptions",
    "#trust-privacy",
    "#use-of-results",
  ]) {
    assert.match(html, new RegExp(`href="${href}"`));
  }
  assert.match(html, /blinded human assurance/i);
  assert.match(html, /cannot cancel the round/i);
  assert.match(html, /renew automatically until cancelled/i);
  assert.match(html, /at least 60 days/);
  assert.match(html, /participant bounty, attempt reserve/i);
  assert.match(html, /Stripe processes subscription payment details/i);
  assert.match(html, /Data Processing Addendum.*forms part of the business service agreement/i);
  assert.match(html, /roles follow the actual processing activity/i);
  assert.match(html, /not financial, legal, medical, or investment advice/i);
  assert.match(
    html,
    /paid commit publishes a timelock-encrypted vote, prediction, response hash, payout address, and salt/i,
  );
  assert.match(html, /configured drand beacon after the commit deadline/i);
  assert.match(html, /whether or not the reviewer or keeper later reveals or claims/i);
  assert.match(html, /there is no post-commit abort/i);
  assert.match(
    html,
    /compromised.*fill remaining seats in open rounds.*influence their verdicts.*direct the bounties/i,
  );
  assert.match(html, /Circle retains token-layer authority over USDC.*pause or blacklist transfers.*escrow contract/i);
  assert.doesNotMatch(html, /LREP|no token|token governance|test-only|test deployment/i);
});
