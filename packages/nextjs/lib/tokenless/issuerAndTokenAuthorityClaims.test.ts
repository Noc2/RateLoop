import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const issuerDisclosures = [
  readFileSync(new URL("../../../../docs/tokenless-immutable-implementation-plan-2026-07.md", import.meta.url), "utf8"),
  readFileSync(new URL("../../../../docs/tokenless-legal-revenue-reference-2026-07.md", import.meta.url), "utf8"),
  readFileSync(new URL("../../public/docs/smart-contracts.md", import.meta.url), "utf8"),
].map(disclosure => disclosure.replace(/\s+/gu, " "));

test("trust disclosures name the compromised issuer's open-round blast radius", () => {
  for (const disclosure of issuerDisclosures) {
    assert.match(disclosure, /compromised (?:admission )?signer/iu);
    assert.match(disclosure, /fill remaining seats in open rounds/iu);
    assert.match(disclosure, /influence their verdicts/iu);
    assert.match(disclosure, /direct the bounties/iu);
    assert.match(disclosure, /until (?:the signer is )?rotat/iu);
  }
});

test("trust disclosures preserve Circle's USDC token-layer authority over escrow transfers", () => {
  for (const disclosure of issuerDisclosures) {
    assert.match(disclosure, /Circle/iu);
    assert.match(disclosure, /token-layer/iu);
    assert.match(disclosure, /pause (?:and|or) blacklist/iu);
    assert.match(disclosure, /escrow contract/iu);
  }
});
