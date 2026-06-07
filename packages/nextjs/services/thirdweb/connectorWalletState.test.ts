import {
  getConnectedThirdwebConnectorWallet,
  setConnectedThirdwebConnectorWallet,
  subscribeConnectedThirdwebConnectorWallet,
} from "./connectorWalletState";
import assert from "node:assert/strict";
import test from "node:test";

test("setConnectedThirdwebConnectorWallet notifies subscribers asynchronously", async () => {
  const wallet = { id: "inApp" } as any;
  const notifications: unknown[] = [];
  const unsubscribe = subscribeConnectedThirdwebConnectorWallet(nextWallet => {
    notifications.push(nextWallet);
  });

  setConnectedThirdwebConnectorWallet(wallet);

  assert.equal(getConnectedThirdwebConnectorWallet(), wallet);
  assert.deepEqual(notifications, []);

  await Promise.resolve();

  assert.deepEqual(notifications, [wallet]);
  unsubscribe();
});
