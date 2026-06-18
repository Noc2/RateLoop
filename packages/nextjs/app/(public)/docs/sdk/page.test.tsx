import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("SDK docs keep Base mainnet gated behind intentional promotion", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: SdkPage } = await import("./page");
  const html = renderToStaticMarkup(<SdkPage />).replace(/\s+/g, " ");

  assert.doesNotMatch(html, /Production mainnet is 8453/);
  assert.doesNotMatch(html, /production mainnet is 8453/);
  assert.match(html, /84532.+Base Sepolia \(testnet\)/i);
  assert.match(html, /8453.+Base mainnet after an intentional production promotion/i);
  assert.match(html, /Examples use Base Sepolia unless noted/i);
});
