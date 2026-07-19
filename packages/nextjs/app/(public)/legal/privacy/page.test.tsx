import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("privacy notice explains subscription processor data and retention", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: PrivacyPage } = await import("./page");
  const html = renderToStaticMarkup(<PrivacyPage />).replace(/\s+/g, " ");

  assert.match(html, /Stripe processes payment-card details/i);
  assert.match(html, /does not store full card details/i);
  assert.match(html, /remain separate from prepaid USDC/i);
  assert.match(html, /Subscription cancellation does not override/i);
  assert.match(html, /workspace owner can delete a workspace/i);
  assert.match(html, /signed-in user can delete their account/i);
  assert.match(html, /retains a revoked sign-in binding for 35 days/i);
  assert.match(html, /later sign-up starts a new account/i);
  assert.match(html, /paid commit.*timelock ciphertext/i);
  assert.match(html, /vote, prediction, response hash, payout address, and salt/i);
  assert.match(html, /configured drand beacon after the commit deadline/i);
  assert.match(html, /whether or not the reviewer or keeper submits a reveal or claim/i);
  assert.match(html, /there is no post-commit abort/i);
  assert.match(html, /operator-controlled server or KMS authority shared by tenant artifacts within a key domain/i);
  assert.match(html, /Authorized RateLoop systems can therefore decrypt customer artifacts/i);
  assert.match(html, /Per-tenant or per-project wrapping keys are not yet implemented/i);
});
