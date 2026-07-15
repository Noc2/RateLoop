import { rateLoopThirdwebWallets } from "./client";
import assert from "node:assert/strict";
import test from "node:test";

test("optional wallet setup keeps explicit self-custodial connections available", () => {
  const walletIds: string[] = rateLoopThirdwebWallets.map(wallet => wallet.id);
  assert.deepEqual(walletIds, ["io.metamask", "com.coinbase.wallet", "org.base.account"]);
});
