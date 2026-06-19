import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAINNET_QUICKNET,
  QUICKNET_T,
  createTlockClientForDrandConfig,
  resolveTlockChainSpec,
} from "./tlockClient.js";

const TLOCK_JS_TESTNET_CHAIN_HASH =
  "7672797f548f3f4748ac4bf3352fc6c6b6468c9ad40ad456a397545c6e2df5bf";

test("resolveTlockChainSpec accepts drand quicknet", () => {
  const spec = resolveTlockChainSpec({
    drandChainHash: `0x${MAINNET_QUICKNET.chainHash}`,
    drandGenesisTime: MAINNET_QUICKNET.genesisTime,
    drandPeriod: MAINNET_QUICKNET.period,
  });

  assert.equal(spec.name, "quicknet");
});

test("createTlockClientForDrandConfig builds a quicknet-t client", () => {
  const { client, spec } = createTlockClientForDrandConfig({
    drandChainHash: `0x${QUICKNET_T.chainHash}`,
    drandGenesisTime: QUICKNET_T.genesisTime,
    drandPeriod: QUICKNET_T.period,
  });

  assert.equal(spec.name, "quicknet-t");
  assert.equal(client.chain().baseUrl, QUICKNET_T.url);
  assert.deepEqual(client.options.chainVerificationParams, {
    chainHash: QUICKNET_T.chainHash,
    publicKey: QUICKNET_T.publicKey,
  });
});

test("resolveTlockChainSpec rejects the legacy tlock-js testnet hash", () => {
  assert.throws(
    () =>
      resolveTlockChainSpec({
        drandChainHash: `0x${TLOCK_JS_TESTNET_CHAIN_HASH}`,
        drandGenesisTime: 1_651_677_099n,
        drandPeriod: 3n,
      }),
    /Unsupported drand chain/
  );
});

test("resolveTlockChainSpec rejects a timing tuple that does not match the chain hash", () => {
  assert.throws(
    () =>
      resolveTlockChainSpec({
        drandChainHash: `0x${QUICKNET_T.chainHash}`,
        drandGenesisTime: MAINNET_QUICKNET.genesisTime,
        drandPeriod: QUICKNET_T.period,
      }),
    /does not match supported quicknet-t config/
  );
});
