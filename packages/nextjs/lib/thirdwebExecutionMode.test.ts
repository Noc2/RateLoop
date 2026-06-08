import {
  getThirdwebWalletExecutionMode,
  supportsThirdwebExecutionCapabilities,
  supportsThirdwebInAppExecutionCapabilities,
  usesThirdwebInAppEip7702Execution,
} from "../services/thirdweb/client";
import assert from "node:assert/strict";
import test from "node:test";
import { defineChain } from "thirdweb";

test("thirdweb in-app wallets use sponsored EIP-4337 mode on World Chain Sepolia", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(4801), {
    mode: "EIP4337",
    smartAccount: {
      chain: defineChain(4801),
      sponsorGas: true,
    },
  });
});

test("thirdweb in-app wallets can be forced back to EOA mode", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(4801, { forceEoa: true }), {
    mode: "EOA",
  });
});

test("World Chain Sepolia supports in-app execution without using EIP-7702", () => {
  assert.equal(supportsThirdwebExecutionCapabilities(4801), true);
  assert.equal(supportsThirdwebInAppExecutionCapabilities(4801), true);
  assert.equal(usesThirdwebInAppEip7702Execution(4801), false);
});

test("thirdweb in-app wallets use sponsored EIP-7702 mode on World Chain mainnet", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(480), {
    mode: "EIP7702",
    sponsorGas: true,
  });
  assert.equal(usesThirdwebInAppEip7702Execution(480), true);
});

test("thirdweb in-app wallets can switch sponsored EIP-4337 mode to self-funded", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(4801, { sponsorshipMode: "self-funded" }), {
    mode: "EIP4337",
    smartAccount: {
      chain: defineChain(4801),
      sponsorGas: false,
    },
  });
});

test("thirdweb in-app wallets stay in EOA mode on unsupported chains", () => {
  assert.deepEqual(getThirdwebWalletExecutionMode(31337), {
    mode: "EOA",
  });
});
