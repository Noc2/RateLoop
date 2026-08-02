import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("documentation introduction presents the hosted task paths", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: DocsPage } = await import("./page");
  const html = renderToStaticMarkup(<DocsPage />).replace(/\s+/g, " ");

  assert.match(html, /Human.*rateloop-text-gradient.*Assurance/i);
  assert.doesNotMatch(html, /Start with the task you need|Connect the agent first/i);
  assert.match(html, /Connect an agent.*Set review policy.*Complete a review.*Verify evidence/i);
  assert.match(html, /Set policy:.*Request:.*Review:.*Decide:/i);
  assert.match(html, /href="\/agents\/connections"/i);
  assert.match(html, /href="\/agents\/review-setup"/i);
  assert.match(html, /href="\/human\/review"/i);
  assert.match(html, /href="\/agents\/results#evidence-packets-heading"/i);
  assert.match(html, /href="\/docs\/use-cases"/i);
  assert.match(html, /href="\/docs\/evidence"/i);
  assert.match(html, /href="\/docs\/how-it-works"/i);
  assert.match(html, /href="\/docs\/human-oversight"/i);
  assert.match(html, /Connections.*Review setup.*View evidence in Results/i);
  assert.doesNotMatch(html, /guaranteed pay|bonus|USDC|settlement|budget/i);
  const visibleWords = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .trim()
    .split(/\s+/).length;
  assert.ok(visibleWords <= 150, `documentation index should stay under 150 visible words; found ${visibleWords}`);
});
