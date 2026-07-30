import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("the root page presents only the coming-soon message and follow action", () => {
  assert.match(pageSource, /Coming Soon/);
  assert.match(pageSource, /The Next Loop/);
  assert.match(pageSource, /Begins Soon\./);
  assert.match(
    pageSource,
    /Thank you to everyone who contributed, tested early ideas, and shared thoughtful feedback\./,
  );
  assert.match(pageSource, /https:\/\/x\.com\/RateLoop/);
  assert.match(pageSource, /Follow on X/);
  assert.match(pageSource, /<OrbAnimation \/>/);
  assert.match(pageSource, /rateloop-text-gradient block w-fit/);

  assert.doesNotMatch(pageSource, /PublicShell|LandingNav|Wallet|promo-video|BetaNoticeBanner/);
});

test("the former public-shell homepage cannot shadow the coming-soon route", () => {
  assert.equal(existsSync(new URL("../(public)/page.tsx", import.meta.url)), false);
});
