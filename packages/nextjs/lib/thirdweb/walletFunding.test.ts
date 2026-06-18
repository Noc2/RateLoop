import assert from "node:assert/strict";
import test from "node:test";
import {
  getThirdwebWalletFundingUnavailableMessage,
  supportsThirdwebWalletFunding,
} from "~~/lib/thirdweb/walletFunding";

test("thirdweb wallet funding is enabled only for Base mainnet", () => {
  assert.equal(supportsThirdwebWalletFunding(8453), true);
  assert.equal(supportsThirdwebWalletFunding(84532), false);
  assert.equal(supportsThirdwebWalletFunding(480), false);
  assert.equal(supportsThirdwebWalletFunding(4801), false);
  assert.equal(supportsThirdwebWalletFunding(31337), false);
});

test("Base Sepolia funding message points users to testnet funding", () => {
  assert.equal(
    getThirdwebWalletFundingUnavailableMessage({
      asset: "USDC",
      chainId: 84532,
      chainName: "Base Sepolia",
    }),
    "thirdweb Pay direct USDC top-ups are not available on Base Sepolia. Use a Base Sepolia faucet or send testnet USDC to this wallet, then retry in RateLoop.",
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
