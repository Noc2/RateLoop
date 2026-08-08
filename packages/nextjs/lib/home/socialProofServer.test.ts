import { __landingSocialProofServerTestUtils } from "./socialProofServer";
import assert from "node:assert/strict";
import test from "node:test";

function applicationStats() {
  return Promise.resolve({ totalVerifiedHumans: "10", totalRatings: "21", totalBonusPaidAtomic: 2_000_000n });
}

test("landing social proof keeps healthy application totals when Ponder is unavailable", async () => {
  const warnings: string[] = [];
  const items = await __landingSocialProofServerTestUtils.loadLandingPageSocialProofItems({
    application: applicationStats,
    claimedUsdc: async () => {
      throw new Error("Ponder unavailable");
    },
    warn: (message, detail) => warnings.push(`${message} ${detail.message}`),
  });

  assert.deepEqual(items, [
    { value: 10, labelKey: "verifiedHumans" },
    { value: 21, labelKey: "reviewResponses" },
  ]);
  assert.deepEqual(warnings, ["[landing-social-proof] Claimed USDC total is unavailable. Ponder unavailable"]);
});

test("landing social proof keeps healthy claimed USDC when the application database is unavailable", async () => {
  const items = await __landingSocialProofServerTestUtils.loadLandingPageSocialProofItems({
    application: async () => {
      throw new Error("database unavailable");
    },
    claimedUsdc: async () => 3_000_000n,
    warn: () => undefined,
  });

  // No paid lane has shipped, so a USDC total must not reach the landing page.
  assert.deepEqual(items, []);
});

test("landing social proof combines healthy sources and hides only when both fail", async () => {
  const healthy = await __landingSocialProofServerTestUtils.loadLandingPageSocialProofItems({
    application: applicationStats,
    claimedUsdc: async () => 3_000_000n,
    warn: () => undefined,
  });
  assert.ok(!healthy.some(item => item.labelKey === "usdcPaid"), "no USDC claim while every paid lane is frozen");

  const unavailable = await __landingSocialProofServerTestUtils.loadLandingPageSocialProofItems({
    application: async () => Promise.reject(new Error("database unavailable")),
    claimedUsdc: async () => Promise.reject(new Error("Ponder unavailable")),
    warn: () => undefined,
  });
  assert.deepEqual(unavailable, []);
});
