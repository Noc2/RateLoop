import {
  isThirdwebSelfFundedFallbackEligibleError,
  isThirdwebSponsorshipDeniedError,
  shouldAttemptSelfFundedThirdwebFallback,
  shouldAwaitSelfFundedSubmitCalls,
  shouldExpectSponsoredSubmitCalls,
  shouldExpectThirdwebBatchCalls,
  shouldIgnorePostTransactionFallbackWalletSyncError,
  shouldPreferSponsoredBatchCalls,
  shouldPreferSponsoredSubmitCalls,
  shouldUseSelfFundedBatchCalls,
} from "./useThirdwebSponsoredSubmitCalls";
import assert from "node:assert/strict";
import test from "node:test";
import {
  getEip7702DelegationTarget,
  hasMissingEip7702DelegationImplementation,
} from "~~/lib/thirdweb/eip7702Delegation";

test("detects EIP-7702 delegations with missing implementations", () => {
  const implementation = "0x3e515544f8d8293b0a353e10ff3b7ca03b52f35b";
  const walletCode = `0xef0100${implementation.slice(2)}` as const;

  assert.equal(getEip7702DelegationTarget(walletCode), implementation);
  assert.equal(
    hasMissingEip7702DelegationImplementation({
      implementationCode: "0x",
      walletCode,
    }),
    true,
  );
  assert.equal(
    hasMissingEip7702DelegationImplementation({
      implementationCode: "0x6000",
      walletCode,
    }),
    false,
  );
  assert.equal(getEip7702DelegationTarget("0x"), null);
});

test("prefers sponsored submit calls for thirdweb connector wallets with free transactions on supported chains", () => {
  assert.equal(
    shouldPreferSponsoredSubmitCalls({
      canUseFreeTransactions: true,
      chainId: 480,
      connectorId: "in-app-wallet",
    }),
    true,
  );
});

test("prefers sponsored batch calls for thirdweb connector wallets with free transactions on supported chains", () => {
  assert.equal(
    shouldPreferSponsoredBatchCalls({
      canUseFreeTransactions: true,
      chainId: 480,
      connectorId: "in-app-wallet",
    }),
    true,
  );
});

test("expects sponsored submit calls for supported thirdweb connector wallets before allowance resolves", () => {
  assert.equal(
    shouldExpectSponsoredSubmitCalls({
      chainId: 480,
      connectorId: "in-app-wallet",
    }),
    true,
  );
});

test("expects thirdweb batch calls for supported in-app wallets", () => {
  assert.equal(
    shouldExpectThirdwebBatchCalls({
      chainId: 480,
      connectorId: "in-app-wallet",
    }),
    true,
  );
});

test("expects thirdweb batch calls for in-app wallets on World Chain Sepolia", () => {
  assert.equal(
    shouldExpectThirdwebBatchCalls({
      chainId: 4801,
      connectorId: "in-app-wallet",
    }),
    true,
  );
});

test("expects thirdweb batch calls for active external wallets with matching connectors", () => {
  assert.equal(
    shouldExpectThirdwebBatchCalls({
      activeWalletId: "io.metamask",
      chainId: 4801,
      connectorId: "io.metamask",
    }),
    true,
  );
});

test("does not expect thirdweb batch calls from stale external wallets", () => {
  assert.equal(
    shouldExpectThirdwebBatchCalls({
      activeWalletId: "io.metamask",
      chainId: 4801,
      connectorId: "com.coinbase.wallet",
    }),
    false,
  );
});

test("uses self-funded batch calls only after in-app wallets switch to paid gas mode", () => {
  assert.equal(
    shouldUseSelfFundedBatchCalls({
      chainId: 480,
      connectorId: "in-app-wallet",
      executionMode: "self_funded_7702",
    }),
    true,
  );
  assert.equal(
    shouldUseSelfFundedBatchCalls({
      chainId: 480,
      connectorId: "in-app-wallet",
      executionMode: "sponsored_7702",
    }),
    false,
  );
  assert.equal(
    shouldUseSelfFundedBatchCalls({
      chainId: 480,
      connectorId: "io.metamask",
      executionMode: "self_funded_7702",
      isThirdwebInApp: true,
    }),
    false,
  );
});

test("uses self-funded batch calls for active external wallets with atomic sendCalls support", () => {
  assert.equal(
    shouldUseSelfFundedBatchCalls({
      activeWalletId: "io.metamask",
      chainId: 4801,
      connectorId: "io.metamask",
      executionMode: "fee_currency",
      hasSendCalls: true,
      supportsAtomicBatchCalls: true,
    }),
    true,
  );

  assert.equal(
    shouldUseSelfFundedBatchCalls({
      activeWalletId: "io.metamask",
      chainId: 4801,
      connectorId: "io.metamask",
      executionMode: "fee_currency",
      hasSendCalls: false,
      supportsAtomicBatchCalls: true,
    }),
    false,
  );

  assert.equal(
    shouldUseSelfFundedBatchCalls({
      activeWalletId: "io.metamask",
      chainId: 4801,
      connectorId: "io.metamask",
      executionMode: "fee_currency",
      hasSendCalls: true,
      supportsAtomicBatchCalls: false,
    }),
    false,
  );
});

test("expects sponsored submit calls from active in-app wallet before wagmi connector settles", () => {
  assert.equal(
    shouldExpectSponsoredSubmitCalls({
      chainId: 480,
      connectorId: undefined,
      isThirdwebInApp: true,
    }),
    true,
  );
});

test("does not expect sponsored submit calls for active external wallets", () => {
  assert.equal(
    shouldExpectSponsoredSubmitCalls({
      chainId: 4801,
      connectorId: "io.metamask",
    }),
    false,
  );
});

test("does not expect sponsored submit calls from stale in-app wallet after external connector settles", () => {
  assert.equal(
    shouldExpectSponsoredSubmitCalls({
      chainId: 480,
      connectorId: "injected",
      isThirdwebInApp: true,
    }),
    false,
  );
});

test("does not prefer sponsored submit calls from stale in-app wallet after external connector settles", () => {
  assert.equal(
    shouldPreferSponsoredSubmitCalls({
      canUseFreeTransactions: true,
      chainId: 480,
      connectorId: "io.metamask",
      isThirdwebInApp: true,
    }),
    false,
  );
});

test("does not prefer sponsored submit calls without free transaction allowance", () => {
  assert.equal(
    shouldPreferSponsoredSubmitCalls({
      canUseFreeTransactions: false,
      chainId: 480,
      connectorId: "in-app-wallet",
    }),
    false,
  );
});

test("does not prefer sponsored submit calls for unsupported connectors", () => {
  assert.equal(
    shouldPreferSponsoredSubmitCalls({
      canUseFreeTransactions: true,
      chainId: 480,
      connectorId: "walletConnect",
    }),
    false,
  );
});

test("detects thirdweb sponsorship denials", () => {
  assert.equal(
    isThirdwebSponsorshipDeniedError(
      new Error('Error executing 7702 transaction: {"reason":"Transaction not sponsored."}'),
    ),
    true,
  );
});

test("detects exhausted free transaction denials as sponsorship denials", () => {
  assert.equal(
    isThirdwebSponsorshipDeniedError(
      new Error('Error executing 7702 transaction: {"reason":"Free transactions used up. Add ETH to continue."}'),
    ),
    true,
  );
});

test("treats exhausted free transactions as eligible for self-funded fallback", () => {
  assert.equal(
    isThirdwebSelfFundedFallbackEligibleError(
      new Error('Error executing 7702 transaction: {"reason":"Free transactions used up. Add ETH to continue."}'),
    ),
    true,
  );
});

test("ignores unrelated thirdweb submit failures", () => {
  assert.equal(isThirdwebSponsorshipDeniedError(new Error("User rejected the request.")), false);
});

test("skips self-funded fallback when a reserved free transaction was denied sponsorship", () => {
  assert.equal(
    shouldAttemptSelfFundedThirdwebFallback({
      activeWalletId: "inApp",
      chainId: 480,
      error: new Error('Error executing 7702 transaction: {"reason":"Transaction not sponsored."}'),
      executionMode: "sponsored_7702",
      hasReservedFreeTransaction: true,
    }),
    false,
  );
});

test("allows self-funded fallback when sponsorship denial is unrelated to a reserved free transaction", () => {
  assert.equal(
    shouldAttemptSelfFundedThirdwebFallback({
      activeWalletId: "inApp",
      chainId: 480,
      error: new Error('Error executing 7702 transaction: {"reason":"Transaction not sponsored."}'),
      executionMode: "sponsored_7702",
      hasReservedFreeTransaction: false,
    }),
    true,
  );
});

test("allows self-funded fallback when sponsored free transactions are exhausted", () => {
  assert.equal(
    shouldAttemptSelfFundedThirdwebFallback({
      activeWalletId: "inApp",
      chainId: 480,
      error: new Error(
        'Error executing 7702 transaction: {"reason":"Free transactions used up. Add ETH to continue."}',
      ),
      executionMode: "sponsored_7702",
      hasReservedFreeTransaction: false,
    }),
    true,
  );
});

test("allows self-funded fallback for wagmi in-app wallet ids when sponsored free transactions are exhausted", () => {
  assert.equal(
    shouldAttemptSelfFundedThirdwebFallback({
      activeWalletId: "in-app-wallet",
      chainId: 480,
      error: new Error(
        'Error executing 7702 transaction: {"reason":"Free transactions used up. Add ETH to continue."}',
      ),
      executionMode: "sponsored_7702",
      hasReservedFreeTransaction: false,
    }),
    true,
  );
});

test("awaits self-funded reconnect after free transactions are exhausted for thirdweb in-app wallets", () => {
  assert.equal(
    shouldAwaitSelfFundedSubmitCalls({
      canUseFreeTransactions: false,
      chainId: 480,
      connectorId: "in-app-wallet",
      executionMode: "sponsored_7702",
      freeTransactionAllowanceResolved: true,
    }),
    true,
  );
});

test("awaits self-funded reconnect after exhausted free transactions before wagmi connector settles", () => {
  assert.equal(
    shouldAwaitSelfFundedSubmitCalls({
      canUseFreeTransactions: false,
      chainId: 480,
      connectorId: undefined,
      executionMode: "sponsored_7702",
      freeTransactionAllowanceResolved: true,
      isThirdwebInApp: true,
    }),
    true,
  );
});

test("does not await self-funded reconnect after exhausted free transactions once external connector settles", () => {
  assert.equal(
    shouldAwaitSelfFundedSubmitCalls({
      canUseFreeTransactions: false,
      chainId: 480,
      connectorId: "injected",
      executionMode: "sponsored_7702",
      freeTransactionAllowanceResolved: true,
      isThirdwebInApp: true,
    }),
    false,
  );
});

test("stops awaiting self-funded reconnect once the in-app wallet is self-funded", () => {
  assert.equal(
    shouldAwaitSelfFundedSubmitCalls({
      canUseFreeTransactions: false,
      chainId: 480,
      connectorId: "in-app-wallet",
      executionMode: "self_funded_7702",
      freeTransactionAllowanceResolved: true,
    }),
    false,
  );
});

test("does not await self-funded reconnect after in-app wallets fall back to direct transactions", () => {
  assert.equal(
    shouldAwaitSelfFundedSubmitCalls({
      canUseFreeTransactions: false,
      chainId: 4801,
      connectorId: "in-app-wallet",
      executionMode: "direct_worldchain",
      freeTransactionAllowanceResolved: true,
    }),
    false,
  );
});

test("does not await self-funded reconnect before free transaction allowance resolves", () => {
  assert.equal(
    shouldAwaitSelfFundedSubmitCalls({
      canUseFreeTransactions: false,
      chainId: 480,
      connectorId: "in-app-wallet",
      executionMode: "sponsored_7702",
      freeTransactionAllowanceResolved: false,
    }),
    false,
  );
});

test("ignores wallet sync failures after a successful self-funded fallback transaction", () => {
  assert.equal(shouldIgnorePostTransactionFallbackWalletSyncError("success"), true);
  assert.equal(shouldIgnorePostTransactionFallbackWalletSyncError("failed"), false);
});
