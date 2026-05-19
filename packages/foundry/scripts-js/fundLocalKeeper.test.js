import assert from "node:assert/strict";
import test from "node:test";
import { parseEther } from "viem";

import {
  DEFAULT_KEEPER_TARGET_BALANCE_ETH,
  DEFAULT_LOCAL_DEPLOYER_PRIVATE_KEY,
  DEFAULT_LOCAL_RPC_URL,
  parseEnvFile,
  resolveKeeperFundingConfig,
} from "./fundLocalKeeper.js";

const ANVIL_ACCOUNT_TWO_PRIVATE_KEY =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

test("parseEnvFile reads simple local env assignments", () => {
  assert.deepEqual(
    parseEnvFile(`
# comment
RPC_URL=http://127.0.0.1:8545
KEEPER_PRIVATE_KEY='0xabc'
KEEPER_TARGET_BALANCE_ETH="7"
`),
    {
      RPC_URL: "http://127.0.0.1:8545",
      KEEPER_PRIVATE_KEY: "0xabc",
      KEEPER_TARGET_BALANCE_ETH: "7",
    }
  );
});

test("resolveKeeperFundingConfig derives the keeper address from private key", () => {
  const config = resolveKeeperFundingConfig({
    KEEPER_PRIVATE_KEY: ANVIL_ACCOUNT_TWO_PRIVATE_KEY,
  });

  assert.equal(config.enabled, true);
  assert.equal(
    config.keeperAddress,
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
  );
  assert.equal(config.rpcUrl, DEFAULT_LOCAL_RPC_URL);
  assert.equal(config.deployerPrivateKey, DEFAULT_LOCAL_DEPLOYER_PRIVATE_KEY);
  assert.equal(
    config.targetBalance,
    parseEther(DEFAULT_KEEPER_TARGET_BALANCE_ETH)
  );
});

test("resolveKeeperFundingConfig skips when no keeper wallet is configured", () => {
  assert.deepEqual(resolveKeeperFundingConfig({}), { enabled: false });
});
