import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const disclosures = [
  readFileSync(new URL("../../../../docs/tokenless-immutable-implementation-plan-2026-07.md", import.meta.url), "utf8"),
  readFileSync(new URL("../../../../docs/tokenless-legal-revenue-reference-2026-07.md", import.meta.url), "utf8"),
  readFileSync(new URL("../../public/docs/how-it-works.md", import.meta.url), "utf8"),
].map(disclosure => disclosure.replace(/\s+/gu, " "));

test("paid-commit disclosures state the irrevocable drand-time public reveal boundary", () => {
  for (const disclosure of disclosures) {
    assert.match(disclosure, /vote, prediction, response hash, payout address, and salt/iu);
    assert.match(disclosure, /configured drand (?:round|beacon) after the commit deadline/iu);
    assert.match(disclosure, /whether or not the reviewer or keeper submits a reveal or claim/iu);
    assert.match(disclosure, /no post-commit abort/iu);
  }
});

test("the legal reference no longer locates vote-to-payout disclosure only at claim", () => {
  const legalReference = disclosures[1];
  assert.doesNotMatch(legalReference, /Only salted commitments stay on-chain/iu);
  assert.doesNotMatch(legalReference, /only unlinkable \*\*until claim\*\*/iu);
});
