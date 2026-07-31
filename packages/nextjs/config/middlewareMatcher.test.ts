import { NextRequest } from "next/server";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  isLocale,
  stripLocalePrefix,
} from "../i18n/config";
import { routing } from "../i18n/routing";
import { config, isMachinePath, middleware } from "../middleware";
import assert from "node:assert/strict";
import test from "node:test";

function matches(pathname: string) {
  const [matcher] = config.matcher;
  assert.ok(matcher);
  return new RegExp(`^${matcher}$`).test(pathname);
}

test("middleware protects pages and v1 APIs while skipping static assets", () => {
  assert.equal(matches("/rate"), true);
  assert.equal(matches("/de/rate"), true);
  assert.equal(matches("/api/agent/v1/quote"), true);
  assert.equal(matches("/.well-known/oauth-authorization-server"), true);
  assert.equal(matches("/favicon.ico"), false);
  assert.equal(matches("/og-image.jpg"), false);
  assert.equal(matches("/brand/logo.svg"), false);
});

test("locale rules share one supported-locale invariant", () => {
  assert.deepEqual(routing.locales, SUPPORTED_LOCALES);
  assert.equal(routing.defaultLocale, DEFAULT_LOCALE);
  const localeCookie = routing.localeCookie;
  assert.ok(localeCookie && typeof localeCookie === "object");
  assert.equal(localeCookie.name, LOCALE_COOKIE_NAME);
  assert.equal(localeCookie.maxAge, LOCALE_COOKIE_MAX_AGE_SECONDS);
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("de"), true);
  assert.equal(isLocale("fr"), false);
  assert.equal(stripLocalePrefix("/en/agent/oauth/authorize"), "/agent/oauth/authorize");
  assert.equal(stripLocalePrefix("/de/agent/oauth/authorize"), "/agent/oauth/authorize");
  assert.equal(stripLocalePrefix("/docs"), "/docs");
});

test("middleware permits the exact OAuth loopback callback port for localized and default consent pages", () => {
  for (const pathname of ["/agent/oauth/authorize", "/de/agent/oauth/authorize"]) {
    const request = new NextRequest(
      `https://rateloop-tokenless.vercel.app${pathname}?redirect_uri=http%3A%2F%2F127.0.0.1%3A58520%2Fcallback%2Fcodex`,
    );
    const response = middleware(request);

    assert.match(
      response.headers.get("Content-Security-Policy") ?? "",
      /(?:^|; )form-action 'self' http:\/\/localhost:58520 http:\/\/127\.0\.0\.1:58520 http:\/\/\[::1\]:58520(?:;|$)/,
    );
    assert.match(
      response.headers.get("Content-Security-Policy") ?? "",
      /frame-src [^;]*http:\/\/localhost:58520 http:\/\/127\.0\.0\.1:58520 http:\/\/\[::1\]:58520(?:;|$)/,
    );
  }
});

test("browser pages route by locale while machine endpoints remain unprefixed", () => {
  const english = middleware(new NextRequest("https://rateloop-tokenless.vercel.app/rate"));
  const german = middleware(new NextRequest("https://rateloop-tokenless.vercel.app/de/rate"));
  const api = middleware(new NextRequest("https://rateloop-tokenless.vercel.app/api/agent/v1/quote"));
  const metadata = middleware(
    new NextRequest("https://rateloop-tokenless.vercel.app/.well-known/oauth-authorization-server"),
  );

  assert.equal(english.headers.get("x-middleware-rewrite"), "https://rateloop-tokenless.vercel.app/en/rate");
  assert.equal(german.headers.get("x-middleware-rewrite"), null);
  assert.equal(german.headers.get("x-middleware-request-x-next-intl-locale"), "de");
  assert.equal(api.headers.get("x-middleware-rewrite"), null);
  assert.equal(metadata.headers.get("x-middleware-rewrite"), null);
  assert.equal(isMachinePath("/api/agent/v1/quote"), true);
  assert.equal(isMachinePath("/.well-known/oauth-authorization-server"), true);
  assert.equal(isMachinePath("/de/api/agent/v1/quote"), false);
});

test("explicit English prefixes canonicalize to unprefixed URLs", () => {
  const response = middleware(new NextRequest("https://rateloop-tokenless.vercel.app/en/docs?source=test"));

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://rateloop-tokenless.vercel.app/docs?source=test");
  assert.ok(response.headers.get("Content-Security-Policy"));
});

test("German browser preferences redirect an unprefixed first visit to the German route", () => {
  const response = middleware(
    new NextRequest("https://rateloop-tokenless.vercel.app/docs?source=test", {
      headers: { "accept-language": "de-DE,de;q=0.9,en;q=0.8" },
    }),
  );

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "https://rateloop-tokenless.vercel.app/de/docs?source=test");
  assert.ok(response.headers.get("Content-Security-Policy"));
});
