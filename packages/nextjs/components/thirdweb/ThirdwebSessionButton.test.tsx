import React from "react";
import {
  AuthenticatedSessionControl,
  RATELOOP_SIGN_IN_LABEL,
  RATELOOP_THIRDWEB_AUTO_CONNECT,
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

const SESSION = {
  authenticated: true as const,
  address: "0x1111111111111111111111111111111111111111",
  authProvider: "google",
  expiresAt: "2026-07-14T00:00:00.000Z",
  email: "buyer@example.com",
  displayName: "Buyer Example",
};

test("enterprise session labels prefer a name and mask work email addresses", () => {
  assert.equal(sessionLabel(SESSION), "Buyer Example");
  assert.equal(sessionLabel({ ...SESSION, displayName: null }), "b•••@example.com");
  assert.equal(sessionLabel({ ...SESSION, email: null, displayName: null }), "0x1111…1111");
});

test("a verified RateLoop session never renders as signed out when its wallet is disconnected", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(
    <AuthenticatedSessionControl compact session={SESSION} onSignOut={() => undefined} />,
  ).replace(/\s+/g, " ");

  assert.match(html, />Signed in</);
  assert.match(html, />Buyer Example</);
  assert.match(html, /aria-label="Sign out Buyer Example"/);
  assert.doesNotMatch(html, />Sign In</);
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
    border: "1.25px solid transparent",
    borderRadius: "0.5rem",
    boxShadow: "0 18px 36px rgb(0 0 0 / 0.32)",
    color: "var(--rateloop-warm-white)",
    fontSize: "1rem",
    fontWeight: 700,
    height: "2.5rem",
    lineHeight: 1,
    minHeight: "2.5rem",
    minWidth: "max-content",
    padding: "0.56rem 0.9rem",
    whiteSpace: "nowrap",
  });
});

test("browser authentication never restores a previously connected external wallet", () => {
  assert.equal(RATELOOP_THIRDWEB_AUTO_CONNECT, false);
});
