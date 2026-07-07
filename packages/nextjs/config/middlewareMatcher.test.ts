import { config } from "../middleware";
import assert from "node:assert/strict";
import test from "node:test";

function matchesMiddleware(pathname: string): boolean {
  const [matcher] = config.matcher;
  assert.ok(matcher);

  return new RegExp(`^${matcher}$`).test(pathname);
}

test("middleware skips social card image endpoints", () => {
  assert.equal(matchesMiddleware("/api/og/vote"), false);
  assert.equal(matchesMiddleware("/og/vote"), false);
  assert.equal(matchesMiddleware("/og-image.jpg"), false);
  assert.equal(matchesMiddleware("/twitter-image.jpg"), false);
  assert.equal(matchesMiddleware("/rate"), true);
  assert.equal(matchesMiddleware("/api/feedback"), true);
});
