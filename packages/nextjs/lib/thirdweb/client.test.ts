import { rateLoopThirdwebWallets } from "./client";
import assert from "node:assert/strict";
import test from "node:test";

test("RateLoop browser authentication offers only the in-app account", () => {
  const walletIds: string[] = rateLoopThirdwebWallets.map(wallet => wallet.id);
  assert.deepEqual(walletIds, ["inApp"]);
  assert.equal(walletIds.includes("org.base.account"), false);
});
