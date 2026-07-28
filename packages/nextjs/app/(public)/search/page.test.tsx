import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("search shows compact destinations instead of embedding the review workspace", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: SearchPage } = await import("./page");
  const page = await SearchPage({ searchParams: Promise.resolve({ q: "connect agent" }) });
  const html = renderToStaticMarkup(page).replace(/\s+/g, " ");

  assert.match(html, /Results for.*connect agent/i);
  assert.match(html, /Tasks/i);
  assert.match(html, /Pages and docs/i);
  assert.match(html, /Review work/i);
  assert.match(html, /href="\/agents\/connections"/);
  assert.match(html, /href="\/human\/review\?q=connect%20agent"/);
  assert.match(html, /Open the full review queue with this search applied/i);
  assert.doesNotMatch(html, /Reviewer navigation|Have an invitation|No review work is available/i);
});
