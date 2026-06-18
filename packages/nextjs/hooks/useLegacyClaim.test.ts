import {
  LEGACY_CLAIM_ALLOW_IN_APP_SPONSORSHIP_SYNC,
  getLegacyClaimTransactionErrorMessage,
  shouldInspectLegacyAdminClaim,
  shouldRetryLegacySponsoredClaimAsEoa,
  shouldUseLegacyAdminClaim,
  shouldUseSponsoredLegacyClaim,
} from "./useLegacyClaim";
import assert from "node:assert/strict";
import test from "node:test";

test("inspects admin legacy claim when connected smart account is not eligible", () => {
  assert.equal(
    shouldInspectLegacyAdminClaim({
      adminAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      connectedAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      connectedClaimStatus: "not_eligible",
      isWrongChain: false,
    }),
    true,
  );
});

test("does not inspect admin legacy claim when connected wallet is already eligible", () => {
  assert.equal(
    shouldInspectLegacyAdminClaim({
      adminAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      connectedAddress: "0x63cada40e8acf7a1d47229af5be35b78b16035fa",
      connectedClaimStatus: "eligible",
      isWrongChain: false,
    }),
    false,
  );
});

test("does not inspect admin legacy claim on the wrong chain", () => {
  assert.equal(
    shouldInspectLegacyAdminClaim({
      adminAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      connectedAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      connectedClaimStatus: "not_eligible",
      isWrongChain: true,
    }),
    false,
  );
});

test("uses eligible legacy admin claim data for in-app smart wallets", () => {
  assert.equal(
    shouldUseLegacyAdminClaim({
      activeWalletId: "inApp",
      adminAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      adminClaimStatus: "eligible",
      connectedAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
    }),
    true,
  );
});

test("does not use admin claim data for external wallets or ineligible admin wallets", () => {
  assert.equal(
    shouldUseLegacyAdminClaim({
      activeWalletId: "io.metamask",
      adminAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      adminClaimStatus: "eligible",
      connectedAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
    }),
    false,
  );
  assert.equal(
    shouldUseLegacyAdminClaim({
      activeWalletId: "in-app-wallet",
      adminAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      adminClaimStatus: "not_eligible",
      connectedAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
    }),
    false,
  );
});

test("does not use admin claim data when connected wallet is already the eligible legacy admin", () => {
  assert.equal(
    shouldUseLegacyAdminClaim({
      activeWalletId: "in-app-wallet",
      adminAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      adminClaimStatus: "eligible",
      connectedAddress: "0x63CADA40E8ACF7A1D47229AF5BE35B78B16035FA",
    }),
    false,
  );
});

test("uses sponsored legacy claims only when execution sender matches claim address", () => {
  assert.equal(
    shouldUseSponsoredLegacyClaim({
      canUseSponsoredSubmitCalls: true,
      claimAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      executionAddress: "0x63CADA40E8ACF7A1D47229AF5BE35B78B16035FA",
    }),
    true,
  );

  assert.equal(
    shouldUseSponsoredLegacyClaim({
      canUseSponsoredSubmitCalls: true,
      claimAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      executionAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
    }),
    false,
  );

  assert.equal(
    shouldUseSponsoredLegacyClaim({
      canUseSponsoredSubmitCalls: false,
      claimAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      executionAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
    }),
    false,
  );
});

test("allows legacy claims to sync thirdweb in-app sponsorship mode", () => {
  assert.equal(LEGACY_CLAIM_ALLOW_IN_APP_SPONSORSHIP_SYNC, true);
});

test("formats raw thirdweb invalid proof decode failures for legacy claims", () => {
  assert.equal(
    getLegacyClaimTransactionErrorMessage(
      new Error('AbiErrorSignatureNotFoundError: Encoded error signature "0x09bde339" not found on ABI.'),
    ),
    "Legacy claim proof does not match the eligible legacy wallet or the active claim root.",
  );
});

test("formats decoded legacy claim reverts", () => {
  assert.equal(
    getLegacyClaimTransactionErrorMessage(new Error("Contract function reverted with reason: InvalidProof()")),
    "Legacy claim proof does not match the eligible legacy wallet or the active claim root.",
  );

  assert.equal(
    getLegacyClaimTransactionErrorMessage(new Error("Contract function reverted with reason: AlreadyClaimed()")),
    "There is no legacy LREP left to claim for this wallet right now.",
  );
});

test("formats sponsored legacy claim gas fallback failures", () => {
  assert.equal(
    getLegacyClaimTransactionErrorMessage(
      new Error("Sponsored legacy claim failed and the eligible legacy wallet has no ETH for self-funded gas."),
    ),
    "Sponsored gas could not complete this legacy claim. Add ETH to the eligible legacy wallet, then retry.",
  );
});

test("formats thirdweb sponsored legacy claim rejections", () => {
  assert.equal(
    getLegacyClaimTransactionErrorMessage(new Error('tw_execute error: {"message":"Bad Request"}\nStatus: 400')),
    "thirdweb could not sponsor this legacy claim. Add ETH to the eligible legacy wallet and retry, or try again in a moment.",
  );
});

test("retries opaque thirdweb legacy claim bundler failures as self-funded EOA sends", () => {
  assert.equal(shouldRetryLegacySponsoredClaimAsEoa(new SyntaxError("Unexpected end of JSON input")), true);
  assert.equal(shouldRetryLegacySponsoredClaimAsEoa(new Error('tw_execute error: {"message":"Bad Request"}')), true);
});

test("retries temporary sponsored legacy claim wallet mismatches as EOA sends", () => {
  assert.equal(
    shouldRetryLegacySponsoredClaimAsEoa(
      new Error("Temporary sponsored legacy claim wallet does not match the eligible legacy account."),
    ),
    true,
  );
});

test("does not retry legacy sponsored claims after the user rejects a wallet prompt", () => {
  assert.equal(shouldRetryLegacySponsoredClaimAsEoa(new Error("User rejected the request.")), false);
});
