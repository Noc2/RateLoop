import {
  shouldAwaitSelfFundedGasModeReconnect,
  shouldAwaitSponsoredGasModeReconnect,
  shouldExpectThirdwebGasMode,
  shouldShowFreeTransactionAllowance,
} from "./useGasBalanceStatus";
import assert from "node:assert/strict";
import test from "node:test";

test("expects thirdweb gas mode from active in-app wallet before wagmi connector settles", () => {
  assert.equal(
    shouldExpectThirdwebGasMode({
      chainId: 480,
      connectorId: undefined,
      includeExternalSendCalls: true,
      isThirdwebInApp: true,
    }),
    true,
  );
});

test("does not expect thirdweb gas mode without external send-call support", () => {
  assert.equal(
    shouldExpectThirdwebGasMode({
      chainId: 480,
      connectorId: undefined,
      includeExternalSendCalls: false,
      isThirdwebInApp: true,
    }),
    false,
  );
});

test("does not expect thirdweb gas mode from stale in-app wallet after external connector settles", () => {
  assert.equal(
    shouldExpectThirdwebGasMode({
      chainId: 480,
      connectorId: "injected",
      includeExternalSendCalls: true,
      isThirdwebInApp: true,
    }),
    false,
  );
});

test("shows free transaction allowance for the in-app wallet connector", () => {
  assert.equal(
    shouldShowFreeTransactionAllowance({
      chainId: 480,
      connectorId: "in-app-wallet",
      isThirdwebInApp: false,
    }),
    true,
  );
});

test("shows free transaction allowance before the in-app connector settles", () => {
  assert.equal(
    shouldShowFreeTransactionAllowance({
      chainId: 480,
      connectorId: undefined,
      isThirdwebInApp: true,
    }),
    true,
  );
});

test("hides free transaction allowance after an external connector settles", () => {
  assert.equal(
    shouldShowFreeTransactionAllowance({
      chainId: 480,
      connectorId: "io.metamask",
      isThirdwebInApp: true,
    }),
    false,
  );
});

test("hides free transaction allowance on unsupported chains", () => {
  assert.equal(
    shouldShowFreeTransactionAllowance({
      chainId: 31337,
      connectorId: "in-app-wallet",
      isThirdwebInApp: true,
    }),
    false,
  );
});

test("shows free transaction allowance for in-app wallets on World Chain Sepolia", () => {
  assert.equal(
    shouldShowFreeTransactionAllowance({
      chainId: 4801,
      connectorId: "in-app-wallet",
      isThirdwebInApp: true,
    }),
    true,
  );
});

test("awaits self-funded reconnect for exhausted free transactions before wagmi connector settles", () => {
  assert.equal(
    shouldAwaitSelfFundedGasModeReconnect({
      canUseFreeTransactions: false,
      chainId: 480,
      connectorId: undefined,
      executionMode: "sponsored_7702",
      freeTransactionAllowanceResolved: true,
      includeExternalSendCalls: true,
      isThirdwebInApp: true,
    }),
    true,
  );
});

test("does not await self-funded reconnect after external connector settles", () => {
  assert.equal(
    shouldAwaitSelfFundedGasModeReconnect({
      canUseFreeTransactions: false,
      chainId: 480,
      connectorId: "injected",
      executionMode: "sponsored_7702",
      freeTransactionAllowanceResolved: true,
      includeExternalSendCalls: true,
      isThirdwebInApp: true,
    }),
    false,
  );
});

test("stops awaiting self-funded reconnect after wallet switches to paid gas", () => {
  assert.equal(
    shouldAwaitSelfFundedGasModeReconnect({
      canUseFreeTransactions: false,
      chainId: 480,
      connectorId: undefined,
      executionMode: "self_funded_7702",
      freeTransactionAllowanceResolved: true,
      includeExternalSendCalls: true,
      isThirdwebInApp: true,
    }),
    false,
  );
});

test("does not await self-funded reconnect forever after sponsorship sync fails", () => {
  for (const sponsorshipSyncStatus of ["failed", "timed_out"] as const) {
    assert.equal(
      shouldAwaitSelfFundedGasModeReconnect({
        canUseFreeTransactions: false,
        chainId: 480,
        connectorId: "in-app-wallet",
        executionMode: "sponsored_7702",
        freeTransactionAllowanceResolved: true,
        includeExternalSendCalls: true,
        isThirdwebInApp: true,
        sponsorshipSyncStatus,
      }),
      false,
    );
  }
});

test("does not await self-funded reconnect after wallet falls back to direct transactions", () => {
  assert.equal(
    shouldAwaitSelfFundedGasModeReconnect({
      canUseFreeTransactions: false,
      chainId: 31337,
      connectorId: "in-app-wallet",
      executionMode: "direct_evm",
      freeTransactionAllowanceResolved: true,
      includeExternalSendCalls: true,
      isThirdwebInApp: true,
    }),
    false,
  );
});

test("awaits sponsored reconnect only while sponsorship sync is active", () => {
  for (const sponsorshipSyncStatus of ["pending", "syncing"] as const) {
    assert.equal(
      shouldAwaitSponsoredGasModeReconnect({
        canUseFreeTransactions: true,
        chainId: 480,
        connectorId: "in-app-wallet",
        executionMode: "self_funded_7702",
        includeExternalSendCalls: true,
        isThirdwebInApp: true,
        sponsorshipSyncStatus,
      }),
      true,
    );
  }
});

test("does not await sponsored reconnect forever after sponsorship sync fails", () => {
  for (const sponsorshipSyncStatus of ["failed", "timed_out"] as const) {
    assert.equal(
      shouldAwaitSponsoredGasModeReconnect({
        canUseFreeTransactions: true,
        chainId: 480,
        connectorId: "in-app-wallet",
        executionMode: "self_funded_7702",
        includeExternalSendCalls: true,
        isThirdwebInApp: true,
        sponsorshipSyncStatus,
      }),
      false,
    );
  }
});
