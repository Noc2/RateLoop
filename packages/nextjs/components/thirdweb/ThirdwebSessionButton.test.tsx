import React from "react";
import {
  AuthenticatedSessionControl,
  RATELOOP_SIGN_IN_ACTION_CLASS,
  RATELOOP_SIGN_IN_LABEL,
  RATELOOP_THIRDWEB_AUTO_CONNECT,
  RateLoopSignInAction,
  ThirdwebSessionButton,
  localizedSignInReturnTo,
  sessionLabel,
} from "./ThirdwebSessionButton";
import { NextIntlClientProvider } from "next-intl";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { normalizeSignInReturnPath } from "~~/components/auth/signInReturnPath";
import { installTestDom } from "~~/components/tokenless/testing/dom";
import enAuth from "~~/messages/en/auth.json";

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

function withIntl(element: React.ReactElement, locale = "en") {
  return (
    <NextIntlClientProvider locale={locale} messages={{ auth: enAuth }} timeZone="UTC">
      {element}
    </NextIntlClientProvider>
  );
}

test("enterprise session labels prefer a name without exposing the opaque principal", () => {
  assert.equal(sessionLabel(SESSION), "Buyer Example");
  assert.equal(sessionLabel({ ...SESSION, displayName: null }), "Your account");
});

test("a verified RateLoop session renders independently of optional wallet state", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(
    withIntl(<AuthenticatedSessionControl compact session={SESSION} onSignOut={() => undefined} />),
  ).replace(/\s+/g, " ");

  assert.match(html, />Signed in</);
  assert.match(html, />Buyer Example</);
  assert.match(html, /href="\/human\/profile"/);
  assert.match(html, /aria-label="Open profile for Buyer Example"/);
  assert.match(html, /aria-label="Sign out Buyer Example"/);
  assert.doesNotMatch(html, />Sign In</);
});

test("the signed-in fallback is understandable and does not leak the internal principal id", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(
    withIntl(
      <AuthenticatedSessionControl compact session={{ ...SESSION, displayName: null }} onSignOut={() => undefined} />,
    ),
  ).replace(/\s+/g, " ");

  assert.match(html, />Your account</);
  assert.doesNotMatch(html, /rlp_|901234/);
});

test("the signed-out control links to provider-neutral sign-in", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(withIntl(<ThirdwebSessionButton compact />)).replace(/\s+/g, " ");
  assert.match(html, />Sign In</);
  assert.doesNotMatch(html, /Google|Apple|email OTP/);
});

test("signed-out review controls preserve a normalized local destination", () => {
  const html = renderToStaticMarkup(withIntl(<RateLoopSignInAction returnTo="/human?q=safety&scope=public" />));
  assert.match(html, /href="\/sign-in\?returnTo=%2Fhuman%3Fq%3Dsafety%26scope%3Dpublic"/);
});

test("secret reviewer invitations keep their bearer fragment in the original tab during sign-in", () => {
  const html = renderToStaticMarkup(
    withIntl(<RateLoopSignInAction preserveCurrentTab returnTo="/human/review?invite=1" />),
  );
  assert.match(html, /href="\/sign-in"/u);
  assert.match(html, /target="_blank"/u);
  assert.match(html, /rel="noopener noreferrer"/u);
  assert.match(html, />Sign in in a new tab</u);
  assert.doesNotMatch(html, /returnTo|rlri_/u);
});

test("every signed-out session control detects a reviewer bearer fragment without copying it into sign-in", async () => {
  const restoreDom = installTestDom();
  const previousFetch = globalThis.fetch;
  const token = `rlri_0123456789abcdef_${"a".repeat(43)}`;
  window.history.replaceState(null, "", `/human/review?invite=1#invite=${token}`);
  globalThis.fetch = async input => {
    assert.equal(String(input), "/api/auth/session");
    return Response.json({ authenticated: false });
  };
  const { cleanup, render, waitFor } = await import("@testing-library/react");

  try {
    const view = render(withIntl(<ThirdwebSessionButton compact returnTo="/human/review?invite=1" />));
    const link = await waitFor(() => view.getByRole("link", { name: "Sign in in a new tab" }));
    assert.equal(link.getAttribute("href"), "/sign-in");
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
    assert.equal(link.outerHTML.includes(token), false);
    assert.equal(window.location.hash, `#invite=${token}`);
  } finally {
    cleanup();
    await new Promise(resolve => setTimeout(resolve, 50));
    globalThis.fetch = previousFetch;
    restoreDom();
  }
});

test("German sign-in keeps the locale in both the sign-in page and its return destination", () => {
  assert.equal(localizedSignInReturnTo("/human/review?assignment=1", "de"), "/de/human/review?assignment=1");
  assert.equal(localizedSignInReturnTo("/de/human/review", "de"), "/de/human/review");
  assert.equal(localizedSignInReturnTo("//outside.example/review", "de"), "//outside.example/review");

  const html = renderToStaticMarkup(withIntl(<RateLoopSignInAction returnTo="/human/review?assignment=1" />, "de"));
  assert.match(html, /href="\/de\/sign-in\?returnTo=%2Fde%2Fhuman%2Freview%3Fassignment%3D1"/);
});

test("sign-in is never its own return destination or repeated shell action", () => {
  for (const path of ["/sign-in", "/sign-in?returnTo=%2Fhuman%2Freview", "/de/sign-in"] as const) {
    assert.equal(normalizeSignInReturnPath(path, "https://rateloop-tokenless.vercel.app"), "/welcome");
    assert.equal(localizedSignInReturnTo(path, "de"), undefined);
    assert.equal(renderToStaticMarkup(withIntl(<ThirdwebSessionButton compact returnTo={path} />, "de")), "");
  }
});

test("the sign-in action is an ordinary primary button with no bespoke geometry", () => {
  assert.equal(RATELOOP_SIGN_IN_LABEL, "Sign In");
  // It used to carry `.rateloop-sign-in-action`, forcing 2.5rem where every other
  // primary is 3rem, and neighbouring call sites hand-copied its overrides to match.
  assert.doesNotMatch(RATELOOP_SIGN_IN_ACTION_CLASS, /rateloop-sign-in-action|min-h-|h-1[02]|px-\[/u);

  const rendered = renderToStaticMarkup(withIntl(<RateLoopSignInAction />)).replace(/\s+/g, " ");
  assert.match(rendered, /rateloop-gradient-action/);
  assert.match(rendered, /min-h-12/);
  assert.match(rendered, /text-base font-bold/);

  const compact = renderToStaticMarkup(withIntl(<RateLoopSignInAction />)).replace(/\s+/g, " ");
  const filled = renderToStaticMarkup(withIntl(<RateLoopSignInAction fill />)).replace(/\s+/g, " ");
  assert.match(compact, /w-auto min-w-max/);
  assert.match(filled, /w-full/);
});

test("browser authentication never restores a previously connected external wallet", () => {
  assert.equal(RATELOOP_THIRDWEB_AUTO_CONNECT, false);
});
