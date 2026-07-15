import {
  INITIAL_DRAFT,
  buildPublishingPolicyPayload,
  classificationsForContentBoundary,
  formatUsdcAtomic,
  parseUsdcToAtomic,
} from "./AgentPublishingPolicyPanel";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("publishing policy UI converts USDC without floating-point loss", () => {
  assert.equal(parseUsdcToAtomic("12.345678"), "12345678");
  assert.equal(parseUsdcToAtomic("1000"), "1000000000");
  assert.equal(formatUsdcAtomic("12345678"), "12.345678 USDC");
  assert.throws(() => parseUsdcToAtomic("1.0000001"), /six decimal places/);
});

test("content boundary choices map fail-closed to the legacy server contract", () => {
  assert.deepEqual(classificationsForContentBoundary("public_or_test"), ["public", "synthetic", "redacted"]);
  assert.deepEqual(classificationsForContentBoundary("private_workspace"), ["internal", "confidential"]);
  assert.throws(() => classificationsForContentBoundary("restricted" as never), /supported content boundary/);
  assert.doesNotMatch(
    JSON.stringify([
      classificationsForContentBoundary("public_or_test"),
      classificationsForContentBoundary("private_workspace"),
    ]),
    /restricted|regulated/,
  );
});

test("review payload preserves every server-enforced field behind safe defaults", () => {
  const payload = buildPublishingPolicyPayload({
    ...INITIAL_DRAFT,
    admissionPolicyHash: `0x${"AB".repeat(32)}`,
    maxPanelUsdc: "12",
  });

  assert.equal(payload.name, "Autonomous review requests");
  assert.deepEqual(payload.allowedReviewerSources, ["customer_invited"]);
  assert.deepEqual(payload.allowedDataClassifications, ["internal", "confidential"]);
  assert.deepEqual(payload.allowedPaymentModes, ["prepaid"]);
  assert.deepEqual(payload.allowedAdmissionPolicyHashes, [`0x${"ab".repeat(32)}`]);
  assert.equal(payload.payerAddress, null);
  assert.equal(payload.maxPanelAtomic, "12000000");
  assert.equal(payload.maxDailyAtomic, "100000000");
  assert.equal(payload.maxMonthlyAtomic, "1000000000");
  assert.equal(payload.maxPanelSize, 15);
  assert.equal(payload.maxBountyAtomic, "12000000");
  assert.equal(payload.maxAttemptReserveAtomic, "5000000");
  assert.equal(payload.maxFeeBps, 750);
  assert.equal(payload.onPolicyMiss, "handoff");
});

test("publishing policy UI uses explicit step-up and exact confirmation", () => {
  const source = readFileSync(new URL("./AgentPublishingPolicyPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /!editorOpen && policies\.length === 0/);
  assert.match(source, /Allow autonomous review requests/);
  assert.match(source, /Review access/);
  assert.match(source, /Confirm autonomous access/);
  assert.match(source, /Approve autonomous access/);
  assert.match(source, /The agent may request and pay for reviews within every limit below without asking again/);
  assert.match(source, /Advanced/);
  assert.match(source, /Restricted and regulated material remain blocked/);
  assert.doesNotMatch(source, /type="checkbox"/);
  assert.doesNotMatch(source, /Permitted data classifications/);
  assert.doesNotMatch(source, /No publishing policy has been created/);
  assert.doesNotMatch(source, /New publishing policy/);
  assert.doesNotMatch(source, /Open manual handoff/);
  assert.match(source, /allowedAdmissionPolicyHashes/);
  assert.match(source, /allowedDataClassifications/);
  assert.match(source, /allowedPaymentModes/);
  assert.match(source, /maxAttemptReserveAtomic/);
  assert.match(source, /maxBountyAtomic/);
  assert.match(source, /publishingRevision = 0/);
  assert.match(source, /onPoliciesChanged\?\.\(\)/);
  assert.doesNotMatch(source, /mock|simulat(?:e|ed) policy/i);
});
