import { resolveDraftHandoffPaymentMode } from "./handoffDraftPaymentMode";
import assert from "node:assert/strict";
import test from "node:test";

test("resolveDraftHandoffPaymentMode switches edited LREP bounty drafts to wallet calls", () => {
  assert.equal(
    resolveDraftHandoffPaymentMode({
      bountyAsset: "lrep",
      feedbackBonusAsset: "lrep",
      persistedPaymentMode: "x402_authorization",
    }),
    "wallet_calls",
  );
});

test("resolveDraftHandoffPaymentMode preserves x402 for USDC-only drafts", () => {
  assert.equal(
    resolveDraftHandoffPaymentMode({
      bountyAsset: "usdc",
      feedbackBonusAsset: "usdc",
      persistedPaymentMode: "x402_authorization",
    }),
    "x402_authorization",
  );
});

test("resolveDraftHandoffPaymentMode preserves explicit wallet-call USDC drafts", () => {
  assert.equal(
    resolveDraftHandoffPaymentMode({
      bountyAsset: "usdc",
      feedbackBonusAsset: null,
      persistedPaymentMode: "wallet_calls",
    }),
    "wallet_calls",
  );
});
