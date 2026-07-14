import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("private evaluation freezes a suite before reviewer or funding approval", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { PrivateEvaluationClient } = await import("./PrivateEvaluationClient");
  const html = renderToStaticMarkup(<PrivateEvaluationClient />).replace(/\s+/g, " ");

  assert.match(html, /Compare an AI-enabled workflow/);
  assert.match(html, /Current baseline/);
  assert.match(html, /Candidate workflow/);
  assert.match(html, /Create private evaluation suite/);
  assert.match(html, /Bring your own people/);
  assert.match(html, /RateLoop network/);
  assert.match(html, /Hybrid/);
  assert.match(html, /Sandbox/);
  assert.match(html, /reviewer configuration and funding remain a separate approval step/i);
  assert.doesNotMatch(html, /Passport uniqueness|Orb global uniqueness|World ID|Self\.xyz|identity tier/i);
});
