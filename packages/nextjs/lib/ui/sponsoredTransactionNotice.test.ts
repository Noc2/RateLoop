import {
  getSlowSponsoredTransactionStatus,
  getSponsoredSubmittingTransactionStatus,
  getSponsoredTransactionDelayNotice,
  shouldShowSponsoredTransactionDelayNotice,
} from "./sponsoredTransactionNotice";
import assert from "node:assert/strict";
import test from "node:test";

test("builds sponsored transaction delay notice copy", () => {
  assert.deepEqual(getSponsoredTransactionDelayNotice(), {
    title: "Submitting transaction",
    description: "Sponsored transactions can take up to a minute.",
  });
});

test("builds combined sponsored submitting status copy", () => {
  assert.deepEqual(getSponsoredSubmittingTransactionStatus("vote"), {
    title: "Submitting vote",
    description: "Sponsored transactions can take up to a minute.",
  });
});

test("builds slow sponsored transaction status copy", () => {
  assert.deepEqual(getSlowSponsoredTransactionStatus("vote"), {
    title: "Still submitting vote",
    description: "Sponsored transactions can take up to a minute.",
  });
});

test("shows sponsored transaction delay notice only for sponsored thirdweb transactions", () => {
  assert.equal(
    shouldShowSponsoredTransactionDelayNotice({
      route: "thirdweb",
      sponsorshipMode: "sponsored",
    }),
    true,
  );
  assert.equal(
    shouldShowSponsoredTransactionDelayNotice({
      route: "thirdweb",
      sponsorshipMode: "self-funded",
    }),
    false,
  );
  assert.equal(
    shouldShowSponsoredTransactionDelayNotice({
      route: "external-wallet",
      sponsorshipMode: "sponsored",
    }),
    false,
  );
});
