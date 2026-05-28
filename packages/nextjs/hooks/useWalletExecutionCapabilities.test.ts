import {
  resolveWalletCapabilitiesForChain,
  resolveWalletExecutionChainId,
  resolveWalletExecutionMode,
  shouldQueryWalletCapabilities,
  walletCapabilitiesSupportAtomicBatch,
  walletCapabilitiesSupportPaymasterService,
} from "./useWalletExecutionCapabilities";
import assert from "node:assert/strict";
import test from "node:test";

test("resolveWalletExecutionChainId prefers the wagmi chain when it is available", () => {
  assert.equal(resolveWalletExecutionChainId(480, 4801), 480);
});

test("resolveWalletExecutionChainId falls back to the thirdweb chain during reconnect", () => {
  assert.equal(resolveWalletExecutionChainId(undefined, 4801), 4801);
});

test("resolveWalletExecutionChainId returns undefined when no wallet chain is available", () => {
  assert.equal(resolveWalletExecutionChainId(undefined, undefined), undefined);
});

test("resolveWalletExecutionMode uses sponsored 7702 for in-app wallets on supported chains", () => {
  assert.equal(
    resolveWalletExecutionMode({
      hasSendCalls: true,
      isThirdwebInApp: true,
      supportedChain: true,
      thirdwebSponsorshipMode: "sponsored",
    }),
    "sponsored_7702",
  );
});

test("resolveWalletExecutionMode keeps external wallets on fee-currency flow for supported chains", () => {
  assert.equal(
    resolveWalletExecutionMode({
      hasSendCalls: true,
      isThirdwebInApp: false,
      supportedChain: true,
      thirdwebSponsorshipMode: null,
    }),
    "fee_currency",
  );
});

test("resolveWalletExecutionMode keeps unsupported external wallets on direct worldchain transactions", () => {
  assert.equal(
    resolveWalletExecutionMode({
      hasSendCalls: true,
      isThirdwebInApp: false,
      supportedChain: false,
      thirdwebSponsorshipMode: null,
    }),
    "direct_worldchain",
  );
});

test("shouldQueryWalletCapabilities enables capability probing for batch-capable wallet shapes on supported chains", () => {
  assert.equal(
    shouldQueryWalletCapabilities({
      chainId: 480,
      supportedChain: true,
      walletId: "inApp",
    }),
    true,
  );

  assert.equal(
    shouldQueryWalletCapabilities({
      chainId: 480,
      supportedChain: true,
      walletId: "in-app-wallet",
    }),
    true,
  );

  assert.equal(
    shouldQueryWalletCapabilities({
      chainId: 480,
      hasSendCalls: true,
      supportedChain: true,
      walletId: "io.metamask",
    }),
    true,
  );

  assert.equal(
    shouldQueryWalletCapabilities({
      chainId: 480,
      hasSendCalls: false,
      supportedChain: true,
      walletId: "io.metamask",
    }),
    false,
  );

  assert.equal(
    shouldQueryWalletCapabilities({
      chainId: undefined,
      supportedChain: true,
      walletId: "inApp",
    }),
    false,
  );
});

test("resolveWalletCapabilitiesForChain reads chain-keyed capabilities", () => {
  assert.deepEqual(
    resolveWalletCapabilitiesForChain(
      {
        480: {
          paymasterService: {
            supported: true,
          },
        },
      },
      480,
    ),
    {
      paymasterService: {
        supported: true,
      },
    },
  );
});

test("resolveWalletCapabilitiesForChain accepts direct chain-filtered capabilities", () => {
  assert.deepEqual(
    resolveWalletCapabilitiesForChain(
      {
        paymasterService: {
          supported: true,
        },
      } as any,
      480,
    ),
    {
      paymasterService: {
        supported: true,
      },
    },
  );
});

test("walletCapabilitiesSupportAtomicBatch accepts supported and ready atomic capabilities", () => {
  assert.equal(
    walletCapabilitiesSupportAtomicBatch({
      atomic: {
        status: "supported",
      },
    }),
    true,
  );

  assert.equal(
    walletCapabilitiesSupportAtomicBatch({
      atomic: {
        status: "ready",
      },
    }),
    true,
  );

  assert.equal(
    walletCapabilitiesSupportAtomicBatch({
      atomic: {
        status: "unsupported",
      },
    }),
    false,
  );
});

test("walletCapabilitiesSupportPaymasterService only returns true when explicitly supported", () => {
  assert.equal(
    walletCapabilitiesSupportPaymasterService({
      paymasterService: {
        supported: true,
      },
    }),
    true,
  );

  assert.equal(
    walletCapabilitiesSupportPaymasterService({
      paymasterService: {
        supported: false,
      },
    }),
    false,
  );
});
