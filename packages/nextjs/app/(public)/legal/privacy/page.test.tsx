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
  assert.match(html, /public-record disclosure before a reviewer can create a recovery backup/i);
  assert.match(html, /Guidelines 02\/2025.*version 2\.0/i);
  assert.match(html, /7 July 2026/i);
  assert.match(html, /blockchain-specific DPIA/i);
  assert.match(html, /current provider, subprocessor, and international-transfer inventory/i);
  assert.match(html, /does not claim launch-level GDPR compliance/i);
  assert.match(html, /current isolated deployment.*server-only application keyrings/i);
  assert.match(html, /application-managed encryption/i);
  assert.match(html, /not a customer-held-key or non-exportable hardware-security-module boundary/i);
  assert.match(html, /DPIA remain release gates before real customer material/i);
  assert.match(html, /subject-access exports expire after seven days/i);
  assert.match(html, /terminal notification-delivery records are purged after 90 days/i);
  assert.match(html, /does not load audience analytics/i);
  assert.match(html, /inviting workspace must expressly warrant that the invitee is at least 18/i);
  assert.match(html, /Sanctions screening is a separate first-party manual decision/i);
  assert.match(html, /does not create a new per-round forecast history/i);
  assert.match(html, /separate identity spaces/i);
  assert.match(html, /never reduces or withholds pay already earned/i);
  assert.match(html, /assignment consequence is suspended while that appeal is open/i);
  assert.match(html, /forecast accumulators, pair records, findings, and appeals.*erased/i);
  assert.match(html, /external scheduling service for booking a demo/i);
  assert.match(html, /loads nothing from the scheduling provider and sets no browser storage/i);
  assert.match(html, /collected by that provider under its own privacy terms rather than by RateLoop/i);
  assert.match(html, /may process it outside the European Economic Area/i);
  assert.match(html, /booking page is reachable by anyone holding the link/i);
});
