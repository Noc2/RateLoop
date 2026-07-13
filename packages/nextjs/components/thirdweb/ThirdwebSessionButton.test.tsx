import React from "react";
import { ThirdwebSessionButton, sessionLabel } from "./ThirdwebSessionButton";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("enterprise session labels prefer a name and mask work email addresses", () => {
  const base = {
    authenticated: true as const,
    address: "0x1111111111111111111111111111111111111111",
    authProvider: "google",
    expiresAt: "2026-07-14T00:00:00.000Z",
  };
  assert.equal(sessionLabel({ ...base, email: "buyer@example.com", displayName: "Buyer Example" }), "Buyer Example");
  assert.equal(sessionLabel({ ...base, email: "buyer@example.com", displayName: null }), "b•••@example.com");
  assert.equal(sessionLabel({ ...base, email: null, displayName: null }), "0x1111…1111");
});

test("an unconfigured deployment fails closed with an operator-readable sign-in state", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(<ThirdwebSessionButton compact />).replace(/\s+/g, " ");
  assert.match(html, />Sign in</);
  assert.doesNotMatch(html, /Google|Apple|email OTP/);
});
