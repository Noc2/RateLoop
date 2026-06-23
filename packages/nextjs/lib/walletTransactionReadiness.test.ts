import {
  WALLET_TRANSACTION_GAS_MODE_MESSAGE,
  WALLET_TRANSACTION_PREPARING_MESSAGE,
  WALLET_TRANSACTION_RESTORING_MESSAGE,
  WALLET_TRANSACTION_SELF_FUNDED_MESSAGE,
  getWalletTransactionReadiness,
  isPendingWalletTransactionReadiness,
  isWalletTransactionReadinessMessage,
} from "./walletTransactionReadiness";
import assert from "node:assert/strict";
import test from "node:test";

const BASE_PARAMS = {
  accountChainId: 8453,
  accountStatus: "connected" as const,
  address: "0x1111111111111111111111111111111111111111",
  canSponsorTransactions: false,
  hasExecutableWalletClient: true,
  nativeTokenSymbol: "ETH",
  targetChainId: 8453,
  targetChainName: "Base",
};

test("getWalletTransactionReadiness returns ready for an executable wallet", () => {
  const readiness = getWalletTransactionReadiness(BASE_PARAMS);

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.isReady, true);
  assert.equal(readiness.isBlocked, false);
  assert.equal(readiness.isPending, false);
});

test("getWalletTransactionReadiness treats reconnecting wallets without executable clients as pending", () => {
  const readiness = getWalletTransactionReadiness({
    ...BASE_PARAMS,
    accountStatus: "reconnecting",
    hasExecutableWalletClient: false,
  });

  assert.equal(readiness.status, "restoring_wallet");
  assert.equal(readiness.message, WALLET_TRANSACTION_RESTORING_MESSAGE);
  assert.equal(readiness.isPending, true);
});

test("getWalletTransactionReadiness allows reconnecting wallets that are already executable", () => {
  const readiness = getWalletTransactionReadiness({
    ...BASE_PARAMS,
    accountStatus: "reconnecting",
    hasExecutableWalletClient: true,
  });

  assert.equal(readiness.status, "ready");
  assert.equal(readiness.isReady, true);
});

test("getWalletTransactionReadiness waits for an executable wallet client after account restore", () => {
  const readiness = getWalletTransactionReadiness({
    ...BASE_PARAMS,
    hasExecutableWalletClient: false,
  });

  assert.equal(readiness.status, "restoring_wallet");
  assert.equal(readiness.isPending, true);
});

test("getWalletTransactionReadiness prioritizes gas mode checks before gas errors", () => {
  const readiness = getWalletTransactionReadiness({
    ...BASE_PARAMS,
    isAwaitingFreeTransactionAllowance: true,
    isMissingGasBalance: true,
  });

  assert.equal(readiness.status, "checking_gas_mode");
  assert.equal(readiness.message, WALLET_TRANSACTION_GAS_MODE_MESSAGE);
  assert.equal(readiness.isPending, true);
});

test("getWalletTransactionReadiness distinguishes sponsored wallet preparation", () => {
  const readiness = getWalletTransactionReadiness({
    ...BASE_PARAMS,
    isAwaitingSponsoredWallet: true,
  });

  assert.equal(readiness.status, "preparing_sponsored_wallet");
  assert.equal(readiness.message, WALLET_TRANSACTION_PREPARING_MESSAGE);
  assert.equal(readiness.isPending, true);
});

test("getWalletTransactionReadiness distinguishes self-funded reconnect", () => {
  const readiness = getWalletTransactionReadiness({
    ...BASE_PARAMS,
    isAwaitingSelfFundedWallet: true,
  });

  assert.equal(readiness.status, "switching_gas_mode");
  assert.equal(readiness.message, WALLET_TRANSACTION_SELF_FUNDED_MESSAGE);
  assert.equal(readiness.isPending, true);
});

test("getWalletTransactionReadiness reports wrong network after pending states settle", () => {
  const readiness = getWalletTransactionReadiness({
    ...BASE_PARAMS,
    accountChainId: 84532,
  });

  assert.equal(readiness.status, "wrong_network");
  assert.equal(readiness.message, "Wallet is connected to the wrong network. Please switch to Base.");
  assert.equal(readiness.isPending, false);
});

test("getWalletTransactionReadiness reports missing gas", () => {
  const readiness = getWalletTransactionReadiness({
    ...BASE_PARAMS,
    isMissingGasBalance: true,
  });

  assert.equal(readiness.status, "missing_gas");
  assert.equal(readiness.message, "Add some ETH for gas, then retry.");
  assert.equal(readiness.isPending, false);
});

test("isPendingWalletTransactionReadiness identifies transient statuses", () => {
  assert.equal(isPendingWalletTransactionReadiness("restoring_wallet"), true);
  assert.equal(isPendingWalletTransactionReadiness("checking_gas_mode"), true);
  assert.equal(isPendingWalletTransactionReadiness("preparing_sponsored_wallet"), true);
  assert.equal(isPendingWalletTransactionReadiness("switching_gas_mode"), true);
  assert.equal(isPendingWalletTransactionReadiness("missing_gas"), false);
  assert.equal(isPendingWalletTransactionReadiness("ready"), false);
});

test("isWalletTransactionReadinessMessage identifies transient wallet readiness copy", () => {
  assert.equal(isWalletTransactionReadinessMessage(WALLET_TRANSACTION_RESTORING_MESSAGE), true);
  assert.equal(isWalletTransactionReadinessMessage(WALLET_TRANSACTION_PREPARING_MESSAGE), true);
  assert.equal(isWalletTransactionReadinessMessage(WALLET_TRANSACTION_GAS_MODE_MESSAGE), true);
  assert.equal(isWalletTransactionReadinessMessage(WALLET_TRANSACTION_SELF_FUNDED_MESSAGE), true);
  assert.equal(isWalletTransactionReadinessMessage("Please connect your wallet"), false);
  assert.equal(isWalletTransactionReadinessMessage(null), false);
});
