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

  assert.match(html, /blinded human assurance/i);
  assert.match(html, /cannot cancel the round/i);
  assert.match(html, /renew automatically until cancelled/i);
  assert.match(html, /at least 60 days/);
  assert.match(html, /participant bounty, attempt reserve/i);
  assert.match(html, /Stripe processes subscription payment details/i);
  assert.match(html, /not financial, legal, medical, or investment advice/i);
  assert.doesNotMatch(html, /LREP|no token|token governance|test-only|test deployment/i);
});
