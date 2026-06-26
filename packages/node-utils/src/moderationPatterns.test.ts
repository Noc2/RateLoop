import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAsciiWordBoundaryPattern,
  buildSubdomainLikePattern,
  hostMatchesBlockedDomain,
} from "./moderationPatterns";

test("buildAsciiWordBoundaryPattern matches blocked words without substring false positives", () => {
  const pattern = new RegExp(buildAsciiWordBoundaryPattern(["nsfw", "onlyfans"]), "i");

  assert.equal(pattern.test("This is NSFW artwork"), true);
  assert.equal(pattern.test("creator links to OnlyFans"), true);
  assert.equal(pattern.test("snowyfans convention"), false);
  assert.equal(pattern.test("Essex"), false);
});

test("hostMatchesBlockedDomain matches exact hosts and subdomains", () => {
  assert.equal(hostMatchesBlockedDomain("xhamster.com", "xhamster.com"), true);
  assert.equal(hostMatchesBlockedDomain("www.xhamster.com", "xhamster.com"), true);
  assert.equal(hostMatchesBlockedDomain("subdomain.stripchat.com", "stripchat.com"), true);
  assert.equal(hostMatchesBlockedDomain("notxhamster.com", "xhamster.com"), false);
});

test("buildSubdomainLikePattern produces the SQL LIKE suffix pattern", () => {
  assert.equal(buildSubdomainLikePattern("xhamster.com"), "%.xhamster.com");
});
