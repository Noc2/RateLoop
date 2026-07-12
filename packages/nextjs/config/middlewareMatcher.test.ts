import { config } from "../middleware";
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
