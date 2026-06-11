import { shouldInspectLegacyAdminClaim, shouldSwitchToLegacyAdminWallet } from "./useLegacyClaim";
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

test("switches in-app smart wallet to eligible legacy admin wallet", () => {
  assert.equal(
    shouldSwitchToLegacyAdminWallet({
      activeWalletId: "inApp",
      adminAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      adminClaimStatus: "eligible",
      connectedAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      isRestoring: false,
    }),
    true,
  );
});

test("does not switch external wallets or ineligible admin wallets", () => {
  assert.equal(
    shouldSwitchToLegacyAdminWallet({
      activeWalletId: "io.metamask",
      adminAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      adminClaimStatus: "eligible",
      connectedAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      isRestoring: false,
    }),
    false,
  );
  assert.equal(
    shouldSwitchToLegacyAdminWallet({
      activeWalletId: "in-app-wallet",
      adminAddress: "0x63cada40E8AcF7A1d47229af5Be35b78b16035fa",
      adminClaimStatus: "not_eligible",
      connectedAddress: "0x6D12cC9Ee8392740306F87Fbd1ccB1cBC16FA593",
      isRestoring: false,
    }),
    false,
  );
});
