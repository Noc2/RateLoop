import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("the API error reference begins with a link to its parent guide", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: AIErrorsPage } = await import("./page");
  const html = renderToStaticMarkup(<AIErrorsPage />).replace(/\s+/g, " ");
  const backLink = html.indexOf('href="/docs/ai"');

  assert.ok(backLink >= 0 && backLink < html.indexOf("<h1"));
  assert.match(html, /← Back to Agents &amp; MCP/);
  assert.match(html, /Recover From.*rateloop-text-gradient.*API Errors/);
});
