import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("test terms state deployment limits and accepted-work protection", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: TermsPage } = await import("./page");
  const html = renderToStaticMarkup(<TermsPage />).replace(/\s+/g, " ");

  assert.match(html, /fresh contract deployment/i);
  assert.match(html, /cannot cancel the round/i);
  assert.match(html, /not financial, legal, medical, or investment advice/i);
  assert.doesNotMatch(html, /LREP|no token|token governance/i);
});
