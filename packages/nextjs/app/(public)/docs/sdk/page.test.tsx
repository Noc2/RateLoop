import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("SDK docs expose only the versioned tokenless agent flow", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: SdkPage } = await import("./page");
  const html = renderToStaticMarkup(<SdkPage />).replace(/\s+/g, " ");

  assert.match(html, /quote.*ask.*payment.*wait.*result/i);
  assert.match(html, /rateloop\.tokenless\.v2/i);
  assert.match(html, /EIP-3009 authorization/i);
  assert.match(html, /scoped, revocable workspace API keys/i);
  assert.match(html, /authorized client\/project assignment/i);
  assert.match(html, /wallets remain optional/i);
  assert.doesNotMatch(html, /sandbox|simulation|\/trust|LREP|stake|governance|frontend reward/i);
});
