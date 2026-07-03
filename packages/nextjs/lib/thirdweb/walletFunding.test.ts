import assert from "node:assert/strict";
import test from "node:test";
import {
  getThirdwebWalletFundingUnavailableMessage,
  supportsThirdwebWalletFunding,
} from "~~/lib/thirdweb/walletFunding";

test("thirdweb wallet funding is enabled only for Base mainnet", () => {
  assert.equal(supportsThirdwebWalletFunding(8453), true);
  assert.equal(supportsThirdwebWalletFunding(999999), false);
  assert.equal(supportsThirdwebWalletFunding(31337), false);
});

test("unsupported live-chain funding message points users outside RateLoop", () => {
  assert.equal(
    getThirdwebWalletFundingUnavailableMessage({
      asset: "USDC",
      chainId: 999999,
      chainName: "unsupported network",
    }),
    "thirdweb Pay direct USDC top-ups are not available on unsupported network. Send USDC to this wallet outside RateLoop, then retry.",
  );
});

test("local funding message preserves caller fallback", () => {
  assert.equal(
    getThirdwebWalletFundingUnavailableMessage({
      asset: "USDC",
      chainId: 31337,
      fallbackMessage: "Use the local mock USDC faucet.",
    }),
    "Use the local mock USDC faucet.",
  );
});
