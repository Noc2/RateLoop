import { reconnectWagmiConnectorProvider } from "./ThirdwebConnectorWalletBridge.helpers";
import assert from "node:assert/strict";
import test from "node:test";

test("reconnectWagmiConnectorProvider ignores connectors without provider access", () => {
  assert.equal(reconnectWagmiConnectorProvider(undefined, 8453), null);
  assert.equal(reconnectWagmiConnectorProvider({}, 8453), null);
});

test("reconnectWagmiConnectorProvider calls getProvider with the active chain id", async () => {
  const provider = {};
  let receivedChainId: number | undefined;
  const result = reconnectWagmiConnectorProvider(
    {
      getProvider: async ({ chainId }) => {
        receivedChainId = chainId;
        return provider;
      },
    },
    8453,
  );

  assert.equal(await result, provider);
  assert.equal(receivedChainId, 8453);
});
