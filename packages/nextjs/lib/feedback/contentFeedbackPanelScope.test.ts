import { resolveContentFeedbackPanelScope } from "./contentFeedbackPanelScope";
import assert from "node:assert/strict";
import test from "node:test";
import { listProtocolDeploymentScopes, resolveContentDeploymentScope } from "~~/lib/protocolDeployment";

function getConfiguredScopes() {
  const protocolScope = listProtocolDeploymentScopes()[0];
  assert.ok(protocolScope, "expected at least one protocol deployment in test fixtures");
  const contentScope = resolveContentDeploymentScope(protocolScope.chainId);
  assert.ok(contentScope, "expected matching content deployment in test fixtures");
  return { contentScope, protocolScope };
}

test("feedback panel maps current content deployment keys to protocol feedback deployment keys", () => {
  const { contentScope, protocolScope } = getConfiguredScopes();

  const scope = resolveContentFeedbackPanelScope({
    chainId: protocolScope.chainId,
    deploymentKey: contentScope.deploymentKey,
  });

  assert.equal(scope.unsupported, false);
  assert.equal(scope.chainId, protocolScope.chainId);
  assert.equal(scope.deploymentKey, protocolScope.deploymentKey);
});

test("feedback panel accepts already-protocol-scoped content", () => {
  const { protocolScope } = getConfiguredScopes();

  const scope = resolveContentFeedbackPanelScope({
    chainId: protocolScope.chainId,
    deploymentKey: protocolScope.deploymentKey.toUpperCase(),
  });

  assert.equal(scope.unsupported, false);
  assert.equal(scope.deploymentKey, protocolScope.deploymentKey);
});

test("feedback panel disables unsupported historical deployments without changing the current API scope", () => {
  const { protocolScope } = getConfiguredScopes();
  const staleDeploymentKey = `${protocolScope.chainId}:0x1111111111111111111111111111111111111111`;

  const scope = resolveContentFeedbackPanelScope({
    chainId: protocolScope.chainId,
    deploymentKey: staleDeploymentKey,
  });

  assert.equal(scope.unsupported, true);
  assert.equal(scope.deploymentKey, protocolScope.deploymentKey);
});
