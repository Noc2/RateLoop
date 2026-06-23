import {
  WALLET_SESSION_RESTORING_MESSAGE,
  buildGasEstimationRequest,
  getWalletWriteUnavailableMessage,
  pickTransactorOptions,
} from "./useScaffoldWriteContract";
import type { Abi } from "abitype";
import assert from "node:assert/strict";
import test from "node:test";

const ACCOUNT_ADDRESS = "0x3333333333333333333333333333333333333333" as const;

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
      accountAddress: ACCOUNT_ADDRESS,
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
      accountAddress: ACCOUNT_ADDRESS,
      accountChainId: 31337,
      accountStatus: "connected",
      connector: {},
      selectedNetworkId: 31337,
      selectedNetworkName: "Foundry",
    }),
    WALLET_SESSION_RESTORING_MESSAGE,
  );
});

test("getWalletWriteUnavailableMessage blocks active wallet restore even before wagmi exposes an address", () => {
  assert.equal(
    getWalletWriteUnavailableMessage({
      accountStatus: "connecting",
      isRestoringWallet: true,
      selectedNetworkId: 31337,
      selectedNetworkName: "Foundry",
    }),
    WALLET_SESSION_RESTORING_MESSAGE,
  );
});

test("getWalletWriteUnavailableMessage allows reconnecting live connectors on the selected network", () => {
  assert.equal(
    getWalletWriteUnavailableMessage({
      accountAddress: ACCOUNT_ADDRESS,
      accountChainId: 31337,
      accountStatus: "reconnecting",
      connector: { getChainId: async () => 31337 },
      selectedNetworkId: 31337,
      selectedNetworkName: "Foundry",
    }),
    null,
  );
});

const DEPLOYED_ADDRESS = "0x1111111111111111111111111111111111111111" as const;
const OVERRIDE_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const deployedAbi = [
  { type: "function", name: "claimAll", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const satisfies Abi;
const overrideAbi = [
  { type: "function", name: "claimReward", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const satisfies Abi;

type CallVariables = {
  address?: string;
  abi?: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

const mergeWriteCall = (variables: CallVariables) => ({
  // Mirrors the hook: deployed defaults first, per-call variables spread on top.
  abi: deployedAbi as Abi,
  address: DEPLOYED_ADDRESS as string,
  ...variables,
});

test("buildGasEstimationRequest honors per-call address and abi overrides", () => {
  const writeContractObject = mergeWriteCall({
    address: OVERRIDE_ADDRESS,
    abi: overrideAbi as Abi,
    functionName: "claimReward",
    args: [1n],
    value: 0n,
  });

  assert.deepEqual(buildGasEstimationRequest(writeContractObject, ACCOUNT_ADDRESS), {
    address: OVERRIDE_ADDRESS,
    abi: overrideAbi,
    functionName: "claimReward",
    args: [1n],
    account: ACCOUNT_ADDRESS,
    value: 0n,
  });
});

test("buildGasEstimationRequest falls back to the deployed contract without overrides", () => {
  const writeContractObject = mergeWriteCall({ functionName: "claimAll", args: [] });

  assert.deepEqual(buildGasEstimationRequest(writeContractObject, ACCOUNT_ADDRESS), {
    address: DEPLOYED_ADDRESS,
    abi: deployedAbi,
    functionName: "claimAll",
    args: [],
    account: ACCOUNT_ADDRESS,
    value: undefined,
  });
});

test("getWalletWriteUnavailableMessage allows live connectors on the selected network", () => {
  assert.equal(
    getWalletWriteUnavailableMessage({
      accountAddress: ACCOUNT_ADDRESS,
      accountChainId: 31337,
      accountStatus: "connected",
      connector: { getChainId: async () => 31337 },
      selectedNetworkId: 31337,
      selectedNetworkName: "Foundry",
    }),
    null,
  );
});
