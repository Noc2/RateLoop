import {
  WALLET_SESSION_RESTORING_MESSAGE,
  getWalletWriteUnavailableMessage,
  pickTransactorOptions,
} from "./useScaffoldWriteContract";
import assert from "node:assert/strict";
import test from "node:test";

test("pickTransactorOptions forwards transaction toast controls to the transactor", () => {
  const onBlockConfirmation = () => undefined;
  const getErrorMessage = () => "custom failure";

  assert.deepEqual(
    pickTransactorOptions({
      action: "content submission",
      blockConfirmations: 2,
      getErrorMessage,
      mutationKey: ["write"],
      onBlockConfirmation,
      retry: 1,
      suppressErrorToast: true,
      suppressStatusToast: true,
      suppressSuccessToast: true,
    } as any),
    {
      action: "content submission",
      blockConfirmations: 2,
      getErrorMessage,
      onBlockConfirmation,
      suppressErrorToast: true,
      suppressStatusToast: true,
      suppressSuccessToast: true,
    },
  );
});

test("getWalletWriteUnavailableMessage blocks writes while Wagmi is reconnecting", () => {
  assert.equal(
    getWalletWriteUnavailableMessage({
      accountChainId: 31337,
      accountStatus: "reconnecting",
      connector: { getChainId: undefined },
      selectedNetworkId: 31337,
      selectedNetworkName: "Foundry",
    }),
    WALLET_SESSION_RESTORING_MESSAGE,
  );
});

test("getWalletWriteUnavailableMessage blocks serialized connector placeholders", () => {
  assert.equal(
    getWalletWriteUnavailableMessage({
      accountChainId: 31337,
      accountStatus: "connected",
      connector: {},
      selectedNetworkId: 31337,
      selectedNetworkName: "Foundry",
    }),
    WALLET_SESSION_RESTORING_MESSAGE,
  );
});

test("getWalletWriteUnavailableMessage allows live connectors on the selected network", () => {
  assert.equal(
    getWalletWriteUnavailableMessage({
      accountChainId: 31337,
      accountStatus: "connected",
      connector: { getChainId: async () => 31337 },
      selectedNetworkId: 31337,
      selectedNetworkName: "Foundry",
    }),
    null,
  );
});
