import { shouldPreferDirectWagmiConnect } from "./useRateLoopConnectModal";
import assert from "node:assert/strict";
import test from "node:test";

test("Foundry sign-in prefers direct injected wallet connection", () => {
  assert.equal(
    shouldPreferDirectWagmiConnect({
      chainId: 31337,
      hasDirectWagmiConnector: true,
    }),
    true,
  );
});

test("Foundry sign-in does not prefer direct connection without an injected wallet", () => {
  assert.equal(
    shouldPreferDirectWagmiConnect({
      chainId: 31337,
      hasDirectWagmiConnector: false,
    }),
    false,
  );
});

test("live-chain sign-in keeps the existing thirdweb-first behavior", () => {
  assert.equal(
    shouldPreferDirectWagmiConnect({
      chainId: 8453,
      hasDirectWagmiConnector: true,
    }),
    false,
  );
});
