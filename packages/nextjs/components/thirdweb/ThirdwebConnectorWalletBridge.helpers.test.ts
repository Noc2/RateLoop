import { reconnectWagmiConnectorProvider } from "./ThirdwebConnectorWalletBridge.helpers";
import assert from "node:assert/strict";
import test from "node:test";

test("reconnectWagmiConnectorProvider ignores connectors without provider access", () => {
  assert.equal(reconnectWagmiConnectorProvider(undefined, 480), null);
  assert.equal(reconnectWagmiConnectorProvider({}, 480), null);
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
    480,
  );

  assert.equal(await result, provider);
  assert.equal(receivedChainId, 480);
});
