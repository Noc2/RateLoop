import React from "react";
import {
  AuthenticatedSessionControl,
  RATELOOP_SIGN_IN_ACTION_CLASS,
  RATELOOP_SIGN_IN_LABEL,
  RATELOOP_THIRDWEB_AUTO_CONNECT,
  RateLoopSignInAction,
  ThirdwebSessionButton,
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
  principalId: "rlp_123456789012345678901234",
  authProvider: "better_auth:google",
  expiresAt: "2026-07-14T00:00:00.000Z",
  displayName: "Buyer Example",
  wallets: { funding: null, payout: null, recovery: null },
};

test("enterprise session labels prefer a name without exposing the opaque principal", () => {
  assert.equal(sessionLabel(SESSION), "Buyer Example");
  assert.equal(sessionLabel({ ...SESSION, displayName: null }), "Your account");
});

test("a verified RateLoop session renders independently of optional wallet state", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(
    <AuthenticatedSessionControl compact session={SESSION} onSignOut={() => undefined} />,
  ).replace(/\s+/g, " ");

  assert.match(html, />Signed in</);
  assert.match(html, />Buyer Example</);
  assert.match(html, /href="\/human\?tab=profile"/);
  assert.match(html, /aria-label="Open profile for Buyer Example"/);
  assert.match(html, /aria-label="Sign out Buyer Example"/);
  assert.doesNotMatch(html, />Sign In</);
});

test("the signed-in fallback is understandable and does not leak the internal principal id", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(
    <AuthenticatedSessionControl compact session={{ ...SESSION, displayName: null }} onSignOut={() => undefined} />,
  ).replace(/\s+/g, " ");

  assert.match(html, />Your account</);
  assert.doesNotMatch(html, /rlp_|901234/);
});

test("the signed-out control links to provider-neutral sign-in", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(<ThirdwebSessionButton compact />).replace(/\s+/g, " ");
  assert.match(html, />Sign In</);
  assert.doesNotMatch(html, /Google|Apple|email OTP/);
});

test("the compatibility entry point keeps the original compact RateLoop sign-in treatment", () => {
  assert.equal(RATELOOP_SIGN_IN_LABEL, "Sign In");
  assert.match(RATELOOP_SIGN_IN_ACTION_CLASS, /rateloop-sign-in-action/);
  assert.match(RATELOOP_SIGN_IN_ACTION_CLASS, /text-base font-bold/);
  assert.doesNotMatch(RATELOOP_SIGN_IN_ACTION_CLASS, /text-sm|min-h-11|h-12|min-h-12/);

  const compact = renderToStaticMarkup(<RateLoopSignInAction />).replace(/\s+/g, " ");
  const filled = renderToStaticMarkup(<RateLoopSignInAction fill />).replace(/\s+/g, " ");
  assert.match(compact, /w-auto min-w-max/);
  assert.match(filled, /w-full/);
});

test("browser authentication never restores a previously connected external wallet", () => {
  assert.equal(RATELOOP_THIRDWEB_AUTO_CONNECT, false);
});
