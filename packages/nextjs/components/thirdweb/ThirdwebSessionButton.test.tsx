import React from "react";
import {
  RATELOOP_SIGN_IN_LABEL,
  ThirdwebSessionButton,
  rateLoopConnectButtonStyle,
  sessionLabel,
} from "./ThirdwebSessionButton";
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
  assert.match(html, />Sign In</);
  assert.doesNotMatch(html, /Google|Apple|email OTP/);
});

test("the thirdweb entry point keeps the original compact RateLoop sign-in treatment", () => {
  assert.equal(RATELOOP_SIGN_IN_LABEL, "Sign In");
  assert.deepEqual(rateLoopConnectButtonStyle(true), {
    background: "linear-gradient(#121212, #121212) padding-box, var(--rateloop-spectrum-gradient) border-box",
    border: "1px solid transparent",
    borderRadius: "0.5rem",
    boxShadow: "0 18px 36px rgb(0 0 0 / 0.32)",
    color: "var(--rateloop-warm-white)",
    minWidth: "100%",
    whiteSpace: "nowrap",
  });
});
