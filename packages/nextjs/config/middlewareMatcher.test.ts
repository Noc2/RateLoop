import { NextRequest } from "next/server";
import { config, middleware } from "../middleware";
import assert from "node:assert/strict";
import test from "node:test";

function matches(pathname: string) {
  const [matcher] = config.matcher;
  assert.ok(matcher);
  return new RegExp(`^${matcher}$`).test(pathname);
}

test("middleware protects pages and v1 APIs while skipping static assets", () => {
  assert.equal(matches("/rate"), true);
  assert.equal(matches("/api/agent/v1/quote"), true);
  assert.equal(matches("/favicon.ico"), false);
  assert.equal(matches("/og-image.jpg"), false);
});

test("middleware permits the exact OAuth loopback callback port for consent form redirects", () => {
  const request = new NextRequest(
    "https://rateloop-tokenless.vercel.app/agent/oauth/authorize?redirect_uri=http%3A%2F%2F127.0.0.1%3A58520%2Fcallback%2Fcodex",
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
});
