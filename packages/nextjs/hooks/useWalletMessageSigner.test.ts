import { signMessageWithPreferredWallet } from "./useWalletMessageSigner";
import assert from "node:assert/strict";
import test from "node:test";

test("signMessageWithPreferredWallet prefers a matching local wallet client", async () => {
  const calls: string[] = [];
  const signature = await signMessageWithPreferredWallet({
    expectedAddress: "0x0000000000000000000000000000000000000001",
    localWalletClient: {
      account: { address: "0x0000000000000000000000000000000000000001" },
      signMessage: async () => {
        calls.push("local");
        return "0xlocal" as `0x${string}`;
      },
    },
    message: "hello",
    thirdwebAccount: {
      address: "0x0000000000000000000000000000000000000001",
      signMessage: async () => {
        calls.push("thirdweb");
        return "0xthirdweb" as `0x${string}`;
      },
    },
    wagmiSignMessage: async () => {
      calls.push("wagmi");
      return "0xwagmi" as `0x${string}`;
    },
  });

  assert.equal(signature, "0xlocal");
  assert.deepEqual(calls, ["local"]);
});

test("signMessageWithPreferredWallet uses a matching thirdweb account before wagmi", async () => {
  const calls: string[] = [];
  const signature = await signMessageWithPreferredWallet({
    expectedAddress: "0x0000000000000000000000000000000000000001",
    message: "hello",
    thirdwebAccount: {
      address: "0x0000000000000000000000000000000000000001",
      signMessage: async () => {
        calls.push("thirdweb");
        return "0xthirdweb" as `0x${string}`;
      },
    },
    wagmiSignMessage: async () => {
      calls.push("wagmi");
      return "0xwagmi" as `0x${string}`;
    },
  });

  assert.equal(signature, "0xthirdweb");
  assert.deepEqual(calls, ["thirdweb"]);
});

test("signMessageWithPreferredWallet falls back to wagmi when preferred signers do not match", async () => {
  const calls: string[] = [];
  const signature = await signMessageWithPreferredWallet({
    expectedAddress: "0x0000000000000000000000000000000000000001",
    localWalletClient: {
      account: { address: "0x0000000000000000000000000000000000000002" },
      signMessage: async () => {
        calls.push("local");
        return "0xlocal" as `0x${string}`;
      },
    },
    message: "hello",
    thirdwebAccount: {
      address: "0x0000000000000000000000000000000000000003",
      signMessage: async () => {
        calls.push("thirdweb");
        return "0xthirdweb" as `0x${string}`;
      },
    },
    wagmiSignMessage: async () => {
      calls.push("wagmi");
      return "0xwagmi" as `0x${string}`;
    },
  });

  assert.equal(signature, "0xwagmi");
  assert.deepEqual(calls, ["wagmi"]);
});
