import { formatUsdcAtomic, parseUsdcToAtomic } from "./AgentPublishingPolicyPanel";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("publishing policy UI converts USDC without floating-point loss", () => {
  assert.equal(parseUsdcToAtomic("12.345678"), "12345678");
  assert.equal(parseUsdcToAtomic("1000"), "1000000000");
  assert.equal(formatUsdcAtomic("12345678"), "12.345678 USDC");
  assert.throws(() => parseUsdcToAtomic("1.0000001"), /six decimal places/);
});

test("publishing policy UI is explicit about enforced and separately frozen controls", () => {
  const source = readFileSync(new URL("./AgentPublishingPolicyPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /server-enforced and bound to hash-only API credentials/);
  assert.match(source, /Public-network reviews require a non-zero bounty and paid eligibility/);
  assert.match(source, /Private unpaid employee reviews use\s+the private-group assurance workflow/);
  assert.match(source, /Response windows, assignment leases, and minimum usable answers are frozen separately/);
  assert.match(source, /allowedAdmissionPolicyHashes/);
  assert.match(source, /policyId: policy\.policyId/);
  assert.match(source, /It is shown once/);
  assert.doesNotMatch(source, /mock|simulat(?:e|ed) policy/i);
});
