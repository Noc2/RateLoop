import {
  getThirdwebWalletExecutionMode,
  supportsThirdwebExecutionCapabilities,
  supportsThirdwebInAppExecutionCapabilities,
  usesThirdwebInAppEip7702Execution,
} from "../services/thirdweb/client";
import assert from "node:assert/strict";
import test from "node:test";

test("thirdweb in-app wallets use sponsored EIP-7702 mode on Base mainnet", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(8453), {
    mode: "EIP7702",
    sponsorGas: true,
  });
  assert.equal(usesThirdwebInAppEip7702Execution(8453), true);
});

test("thirdweb in-app wallets can be forced back to EOA mode", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(8453, { forceEoa: true }), {
    mode: "EOA",
  });
});

test("Base mainnet supports in-app EIP-7702 execution", () => {
  assert.equal(supportsThirdwebExecutionCapabilities(8453), true);
  assert.equal(supportsThirdwebInAppExecutionCapabilities(8453), true);
  assert.equal(usesThirdwebInAppEip7702Execution(8453), true);
});

test("unsupported chains stay in EOA mode", () => {
  for (const chainId of [999999]) {
    assert.deepEqual(getThirdwebWalletExecutionMode(chainId), {
      mode: "EOA",
    });
    assert.equal(supportsThirdwebExecutionCapabilities(chainId), false);
    assert.equal(supportsThirdwebInAppExecutionCapabilities(chainId), false);
    assert.equal(usesThirdwebInAppEip7702Execution(chainId), false);
  }
});

test("thirdweb in-app wallets stay in EOA mode on local Foundry", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(31337), {
    mode: "EOA",
  });
});
