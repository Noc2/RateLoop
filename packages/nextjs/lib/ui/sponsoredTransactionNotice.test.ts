import {
  getSlowSponsoredTransactionStatus,
  getSponsoredTransactionDelayNotice,
  shouldShowSponsoredTransactionDelayNotice,
} from "./sponsoredTransactionNotice";
import assert from "node:assert/strict";
import test from "node:test";

test("builds sponsored transaction delay notice copy", () => {
  assert.deepEqual(getSponsoredTransactionDelayNotice(), {
    title: "Free gas may take a little longer",
    description:
      "RateLoop is sponsoring this transaction. Sponsored transactions can take up to a minute to relay, so keep this tab open and avoid retrying while it submits.",
  });
});

test("builds slow sponsored transaction status copy", () => {
  assert.deepEqual(getSlowSponsoredTransactionStatus(), {
    title: "Still submitting sponsored transaction",
    description:
      "The sponsored relay is still working. This is expected sometimes; we'll update once the transaction is sent.",
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
