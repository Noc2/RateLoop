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
  assert.match(html, /hosted service uses invited workspace reviewers for unpaid, private review/i);
  assert.match(html, /Connect an agent.*Set review policy.*Complete a review.*Verify evidence/i);
  assert.match(html, /Set policy:.*Request:.*Review:.*Decide:/i);
  assert.match(html, /href="\/agents\?tab=connect"/i);
  assert.match(html, /href="\/agents\?tab=registry"/i);
  assert.match(html, /href="\/human\?tab=discover"/i);
  assert.match(html, /href="\/agents\?tab=evidence"/i);
  assert.match(html, /href="\/docs\/use-cases"/i);
  assert.match(html, /href="\/docs\/evidence"/i);
  assert.match(html, /href="\/docs\/how-it-works"/i);
  assert.match(html, /href="\/docs\/human-oversight"/i);
  assert.doesNotMatch(html, /guaranteed pay|bonus|USDC|settlement|budget/i);
});
