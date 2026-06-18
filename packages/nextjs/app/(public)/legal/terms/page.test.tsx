import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("legal terms use network-neutral bounty funding copy", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: TermsPage } = await import("./page");
  const html = renderToStaticMarkup(<TermsPage />).replace(/\s+/g, " ");

  assert.doesNotMatch(html, /funded in LREP or USDC on World Chain/i);
  assert.match(html, /funded in LREP or USDC on a configured supported network/i);
});
