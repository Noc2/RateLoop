import {
  formatAtomicTokenAmount6,
  getConfidentialContextVoteBlocker,
  getConfidentialityBondRequirement,
  isPrivateContextMetadata,
} from "./confidentialContext";
import assert from "node:assert/strict";
import test from "node:test";

test("isPrivateContextMetadata recognizes gated context markers", () => {
  assert.equal(isPrivateContextMetadata({ contextVisibility: "gated", confidentiality: null }), true);
  assert.equal(
    isPrivateContextMetadata({
      confidentiality: { visibility: "gated" },
      contextAccess: "public",
      contextVisibility: "public",
    }),
    true,
  );
  assert.equal(isPrivateContextMetadata({ contextAccess: "public", contextVisibility: "public" }), false);
});

test("getConfidentialityBondRequirement formats atomic LREP and USDC metadata", () => {
  assert.deepEqual(getConfidentialityBondRequirement(null), {
    amount: 0n,
    asset: "LREP",
    isRequired: false,
    label: "No LREP bond",
  });
  assert.deepEqual(
    getConfidentialityBondRequirement({
      bondAmount: "2500000",
      bondAsset: "USDC",
      visibility: "gated",
    }),
    {
      amount: 2_500_000n,
      asset: "USDC",
      isRequired: true,
      label: "2.5 USDC",
    },
  );
  assert.equal(formatAtomicTokenAmount6(1_234_567_890n), "1,234.56789");
});

test("getConfidentialContextVoteBlocker guides terms, credential, escrow, and bond readiness", () => {
  const bondRequirement = getConfidentialityBondRequirement({
    bondAmount: "1000000",
    bondAsset: "LREP",
    visibility: "gated",
  });

  assert.match(
    getConfidentialContextVoteBlocker({
      bondRequirement,
      hasAcceptedTerms: false,
      isGated: true,
    }) ?? "",
    /Accept the confidentiality terms/,
  );
  assert.match(
    getConfidentialContextVoteBlocker({
      bondRequirement,
      hasAcceptedTerms: true,
      hasReadSession: false,
      identityResolved: true,
      isGated: true,
    }) ?? "",
    /Confirm this wallet/,
  );
  assert.match(
    getConfidentialContextVoteBlocker({
      bondRequirement,
      hasAcceptedTerms: true,
      identityResolved: true,
      isGated: true,
    }) ?? "",
    /active human credential/,
  );
  assert.match(
    getConfidentialContextVoteBlocker({
      bondRequirement,
      escrowConfigured: false,
      hasAcceptedTerms: true,
      hasReadSession: true,
      hasActiveHumanCredential: true,
      identityResolved: true,
      isGated: true,
    }) ?? "",
    /not configured/,
  );
  assert.match(
    getConfidentialContextVoteBlocker({
      bondRequirement,
      escrowConfigured: true,
      hasAcceptedTerms: true,
      hasReadSession: true,
      hasActiveBond: false,
      hasActiveHumanCredential: true,
      identityResolved: true,
      isGated: true,
    }) ?? "",
    /Post the required 1 LREP/,
  );
  assert.equal(
    getConfidentialContextVoteBlocker({
      bondRequirement,
      escrowConfigured: true,
      hasAcceptedTerms: true,
      hasReadSession: true,
      hasActiveBond: true,
      hasActiveHumanCredential: true,
      identityResolved: true,
      isGated: true,
    }),
    null,
  );
});
