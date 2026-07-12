import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("landing page presents the tokenless trust split without legacy UX", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: HomePage } = await import("./page");
  const html = renderToStaticMarkup(<HomePage />).replace(/\s+/g, " ");

  assert.match(html, /paid human panels/i);
  assert.match(html, /no operator withdrawal path/i);
  assert.match(html, /Level Up Your/);
  assert.match(html, /Use RateLoop with your favorite AI agent/);
  assert.match(html, /How It/);
  assert.match(html, /Why It/);
  assert.match(html, /Common/);
  assert.match(html, /Your agent can build anything/);
  assert.doesNotMatch(html, /LREP|governance|leaderboard|manual claim/i);
});
