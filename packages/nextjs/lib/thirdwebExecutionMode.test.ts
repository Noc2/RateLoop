import {
  getThirdwebWalletExecutionMode,
  supportsThirdwebExecutionCapabilities,
  supportsThirdwebInAppExecutionCapabilities,
} from "../services/thirdweb/client";
import assert from "node:assert/strict";
import test from "node:test";

test("thirdweb in-app wallets use sponsored EIP-7702 mode on World Chain Sepolia", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(4801), {
    mode: "EIP7702",
    sponsorGas: true,
  });
});

test("thirdweb in-app wallets can be forced back to EOA mode", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(4801, { forceEoa: true }), {
    mode: "EOA",
  });
});

test("World Chain Sepolia supports external and in-app execution", () => {
  assert.equal(supportsThirdwebExecutionCapabilities(4801), true);
  assert.equal(supportsThirdwebInAppExecutionCapabilities(4801), true);
});

test("thirdweb in-app wallets use sponsored EIP-7702 mode on World Chain mainnet", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(480), {
    mode: "EIP7702",
    sponsorGas: true,
  });
});

test("thirdweb in-app wallets stay in EOA mode on unsupported chains", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(31337), {
    mode: "EOA",
  });
});
