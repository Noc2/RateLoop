import { resolveContentFeedDeploymentScope } from "./useContentFeed";
import assert from "node:assert/strict";
import test from "node:test";
import { resolveContentDeploymentScope, resolveProtocolDeploymentScope } from "~~/lib/protocolDeployment";

const SUPPORTED_TEST_CHAIN_ID = 31337;

test("content feed scope maps content deployment URLs to protocol deployment keys", () => {
  const protocolScope = resolveProtocolDeploymentScope(SUPPORTED_TEST_CHAIN_ID);
  const contentScope = resolveContentDeploymentScope(SUPPORTED_TEST_CHAIN_ID);

  assert.ok(protocolScope);
  assert.ok(contentScope);

  const scope = resolveContentFeedDeploymentScope({
    targetChainId: 8453,
    chainId: SUPPORTED_TEST_CHAIN_ID,
    deploymentKey: contentScope.deploymentKey,
  });

  assert.equal(scope.chainId, SUPPORTED_TEST_CHAIN_ID);
  assert.equal(scope.protocolDeploymentKey, protocolScope.deploymentKey);
  assert.equal(scope.isSupported, true);
  assert.equal(scope.allowsRpcFallback, false);
});

test("content feed scope keeps RPC fallback only for the active deployment", () => {
  const protocolScope = resolveProtocolDeploymentScope(SUPPORTED_TEST_CHAIN_ID);
  const contentScope = resolveContentDeploymentScope(SUPPORTED_TEST_CHAIN_ID);

  assert.ok(protocolScope);
  assert.ok(contentScope);

  assert.deepEqual(resolveContentFeedDeploymentScope({ targetChainId: SUPPORTED_TEST_CHAIN_ID }), {
    chainId: SUPPORTED_TEST_CHAIN_ID,
    protocolDeploymentKey: protocolScope.deploymentKey,
    isSupported: true,
    allowsRpcFallback: true,
  });
  assert.equal(
    resolveContentFeedDeploymentScope({
      targetChainId: SUPPORTED_TEST_CHAIN_ID,
      chainId: SUPPORTED_TEST_CHAIN_ID,
      deploymentKey: contentScope.deploymentKey,
    }).allowsRpcFallback,
    true,
  );
  assert.equal(
    resolveContentFeedDeploymentScope({
      targetChainId: SUPPORTED_TEST_CHAIN_ID,
      chainId: SUPPORTED_TEST_CHAIN_ID,
      deploymentKey: `${SUPPORTED_TEST_CHAIN_ID}:0x0000000000000000000000000000000000000000`,
    }).allowsRpcFallback,
    false,
  );
});
