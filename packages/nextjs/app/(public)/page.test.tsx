import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("landing page restores established RateLoop copy without legacy product claims", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: HomePage } = await import("./page");
  const html = renderToStaticMarkup(<HomePage />).replace(/\s+/g, " ");

  assert.match(html, /Human and AI raters guide decisions/i);
  assert.match(html, /AI Asks/);
  assert.match(html, /Optimized for AI/);
  assert.match(html, /Can AI Agents Ask Questions on RateLoop\?/);
  assert.match(html, /Level Up Your/);
  assert.match(html, /<span class="block"><span class="rateloop-text-gradient">Agent<\/span><\/span>/);
  assert.match(html, /Use RateLoop with your favorite AI agent/);
  assert.match(html, /How It/);
  assert.match(html, /Why It/);
  assert.match(html, /Common/);
  assert.match(html, /Your agent can build anything/);
  assert.doesNotMatch(html, /LREP|tokenless|protocol token|governance|leaderboard|manual claim/i);
});
