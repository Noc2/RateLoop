import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profileSource = readFileSync(new URL("./WorldIdProfilePanel.tsx", import.meta.url), "utf8");
const assuranceSource = [
  readFileSync(new URL("../WorldIdAssuranceClient.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("../../../messages/en/human.json", import.meta.url), "utf8"),
].join("\n");

test("World ID keeps the essential boundary beside verification without repeating the profile explanation", () => {
  assert.doesNotMatch(profileSource, /Browser sign-in, Proof of Human, and paid-work eligibility are separate checks/);
  assert.match(assuranceSource, /one-time, provider-scoped uniqueness assertion bound to this RateLoop account/);
  assert.match(assuranceSource, /does not\s+replace age, legal, tax, sanctions, or payout checks/);
  assert.match(assuranceSource, /not ongoing liveness or credential monitoring/);
  assert.ok(assuranceSource.indexOf("one-time, provider-scoped") < assuranceSource.indexOf("Verify with World ID"));
});
