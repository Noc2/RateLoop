import {
  getGasBalanceErrorMessage,
  isFreeTransactionExhaustedError,
  isInsufficientFundsError,
  isThirdwebBundlerInfrastructureError,
  isUnsupportedRpcMethodError,
  isUserRejectedTransactionError,
  isWalletRpcOverloadedError,
} from "./transactionErrors";
import assert from "node:assert/strict";
import test from "node:test";

test("detects insufficient funds from nested viem errors", () => {
  const error = new Error("outer");
  (error as Error & { cause?: unknown }).cause = {
    details: "error_forwarding_sequencer: insufficient funds for gas * price + value: balance 0",
  };

  assert.equal(isInsufficientFundsError(error), true);
});

test("detects account-abstraction prefund errors as insufficient gas", () => {
  const error = new Error(
    "eth_sendUserOperation error: UserOperation reverted during simulation with reason: AA21 didn't pay prefund",
  );

  assert.equal(isInsufficientFundsError(error), true);
});

test("ignores unrelated transaction failures", () => {
  const error = {
    shortMessage: "User rejected the request.",
  };

  assert.equal(isInsufficientFundsError(error), false);
});

test("formats a short gas guidance message", () => {
  assert.equal(getGasBalanceErrorMessage("ETH"), "Add some ETH for gas, then retry.");
});

test("formats sponsored-wallet gas guidance", () => {
  assert.equal(
    getGasBalanceErrorMessage("ETH", { canSponsorTransactions: true }),
    "Gas is sponsored for now. If it still fails, add some ETH and retry.",
  );
});

test("detects exhausted free transaction verifier errors", () => {
  const error = {
    details: "Free transactions used up. Add ETH to continue.",
  };

  assert.equal(isFreeTransactionExhaustedError(error), true);
});

test("detects wallet RPC overload errors", () => {
  const error = {
    message: "RPC endpoint returned too many errors, retrying in 0.5 minutes. Consider using a different RPC endpoint.",
  };

  assert.equal(isWalletRpcOverloadedError(error), true);
});

test("detects transient thirdweb bundler infrastructure errors", () => {
  const error = new Error(
    'thirdweb_getUserOperationGasPrice error: Unexpected token "e", "error code: 522" is not valid JSON\nStatus: 500',
  );

  assert.equal(isThirdwebBundlerInfrastructureError(error), true);
});

test("ignores unrelated user operation errors", () => {
  const error = new Error("thirdweb_getUserOperationGasPrice error: user rejected the request");

  assert.equal(isThirdwebBundlerInfrastructureError(error), false);
});

test("detects unsupported RPC method errors from nested wallet responses", () => {
  const error = {
    shortMessage: "An unknown RPC error occurred.",
    cause: {
      details: "this request method is not supported",
    },
  };

  assert.equal(isUnsupportedRpcMethodError(error), true);
});

test("detects user-rejected wallet transaction errors from verbose viem messages", () => {
  const error = {
    shortMessage: "User rejected the request.",
    details: "MetaMask Tx Signature: User denied transaction signature.",
  };

  assert.equal(isUserRejectedTransactionError(error), true);
});

test("does not classify unrelated transaction failures as user rejection", () => {
  const error = {
    shortMessage: "The contract function reverted.",
    details: "Error: InvalidCredential()",
  };

  assert.equal(isUserRejectedTransactionError(error), false);
});
