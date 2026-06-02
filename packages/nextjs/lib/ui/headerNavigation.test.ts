import { ASK_ROUTE, RATE_ROUTE } from "../../constants/routes";
import { isHeaderMenuLinkActive } from "./headerNavigation";
import assert from "node:assert/strict";
import test from "node:test";

test("landing page does not activate Discover in the shell nav", () => {
  assert.equal(isHeaderMenuLinkActive("/", RATE_ROUTE), false);
});

test("shell nav activates exact and nested route matches", () => {
  assert.equal(isHeaderMenuLinkActive(RATE_ROUTE, RATE_ROUTE), true);
  assert.equal(isHeaderMenuLinkActive(`${RATE_ROUTE}/123`, RATE_ROUTE), true);
  assert.equal(isHeaderMenuLinkActive(ASK_ROUTE, RATE_ROUTE), false);
});

test("shell nav does not activate sibling path prefixes", () => {
  assert.equal(isHeaderMenuLinkActive("/rate-limit", RATE_ROUTE), false);
});
