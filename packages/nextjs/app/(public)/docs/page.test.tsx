import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("documentation introduction presents the focused production path", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: DocsPage } = await import("./page");
  const html = renderToStaticMarkup(<DocsPage />).replace(/\s+/g, " ");

  assert.match(html, /Human.*rateloop-text-gradient.*Assurance/i);
  assert.match(html, /paid human-review step/i);
  assert.match(html, /Define:.*Review:.*Settle:.*Decide:/i);
  assert.match(html, /The final decision stays with you/i);
  assert.match(html, /href="\/docs\/how-it-works"/i);
  assert.match(html, /href="\/docs\/tech-stack"/i);
  assert.match(html, /href="\/docs\/smart-contracts"/i);
  assert.doesNotMatch(html, /sandbox|simulation|href="\/trust"|unavailable capabilities/i);
});
