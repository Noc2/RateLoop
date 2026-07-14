import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("Ask tabs separate public, private, and history workflows", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { AskPageTabs } = await import("./AskPageTabs");
  const html = renderToStaticMarkup(<AskPageTabs active="public" onChange={() => undefined} />);
  assert.match(html, /public/);
  assert.match(html, /Private evaluation/);
  assert.match(html, /history/);
});
