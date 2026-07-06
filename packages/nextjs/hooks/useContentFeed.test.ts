import { resolveContentFeedDeploymentScope } from "./useContentFeed";
import assert from "node:assert/strict";
import test from "node:test";
import { resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";

const SUPPORTED_TEST_CHAIN_ID = 31337;

test("content feed scope resolves from chain scope only", () => {
  const protocolScope = resolveProtocolDeploymentScope(SUPPORTED_TEST_CHAIN_ID);

  assert.ok(protocolScope);

  const scope = resolveContentFeedDeploymentScope({
    targetChainId: 8453,
    chainId: SUPPORTED_TEST_CHAIN_ID,
  });

  assert.equal(scope.chainId, SUPPORTED_TEST_CHAIN_ID);
  assert.equal(scope.protocolDeploymentKey, protocolScope.deploymentKey);
  assert.equal(scope.isSupported, true);
  assert.equal(scope.allowsRpcFallback, false);
});

test("content feed scope keeps RPC fallback only for the active deployment", () => {
  const protocolScope = resolveProtocolDeploymentScope(SUPPORTED_TEST_CHAIN_ID);

  assert.ok(protocolScope);

  assert.deepEqual(resolveContentFeedDeploymentScope({ targetChainId: SUPPORTED_TEST_CHAIN_ID }), {
    chainId: SUPPORTED_TEST_CHAIN_ID,
    protocolDeploymentKey: protocolScope.deploymentKey,
    isSupported: true,
    allowsRpcFallback: true,
  });
  assert.equal(
    resolveContentFeedDeploymentScope({
      targetChainId: SUPPORTED_TEST_CHAIN_ID,
      chainId: 8453,
    }).allowsRpcFallback,
    false,
  );
});
