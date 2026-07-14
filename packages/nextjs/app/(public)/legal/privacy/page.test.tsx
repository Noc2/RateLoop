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
});
