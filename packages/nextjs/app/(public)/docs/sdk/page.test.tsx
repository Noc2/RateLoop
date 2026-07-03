import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("SDK docs identify Base mainnet as production", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: SdkPage } = await import("./page");
  const html = renderToStaticMarkup(<SdkPage />).replace(/\s+/g, " ");

  assert.match(html, /chainId:\s*8453/i);
  assert.match(html, /8453.+Base mainnet production/i);
  assert.doesNotMatch(html, /testnet validation/i);
  assert.doesNotMatch(html, /intentional production promotion/i);
});
