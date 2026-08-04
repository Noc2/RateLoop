import { checkHostedOperations } from "./operations.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const EXPECTED_DEPLOYMENT = {
  chainId: 84_532,
  deploymentBlockNumber: 44_915_850,
  deploymentKey: "tokenless-v4:84532:test",
};

function response(body, init) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    headers: { "content-type": typeof body === "string" ? "text/plain" : "application/json" },
    status: 200,
    ...init,
  });
}

function healthyFetch(requests) {
  return async (url, init = {}) => {
    requests.push({ authorization: init.headers?.authorization ?? null, url });
    if (url.endsWith("/ready")) return response({ protocol: "tokenless-v4", status: "ok" });
    if (url.endsWith("/health/tokenless")) {
      return response({
        chainId: 84532,
        deploymentKey: "tokenless-v4:84532:test",
        indexBlock: 123,
        indexReady: true,
        protocol: "tokenless-v4",
        startBlock: 44_915_850,
        status: "ok",
      });
    }
    if (url.endsWith("/health")) {
      return response({
        minimumWalletBalanceWei: "100",
        chainId: 84_532,
        deploymentBlock: "44915850",
        deploymentKey: "tokenless-v4:84532:test",
        protocol: "tokenless-v4",
        status: "ok",
        walletBalanceWei: "101",
      });
    }
    if (url.endsWith("/metrics")) {
      return response(
        [
          "keeper_last_successful_run_timestamp 1",
          "keeper_wallet_balance_wei 101",
          "keeper_minimum_wallet_balance_wei 100",
          "",
        ].join("\n"),
      );
    }
    return response({}, { status: 404 });
  };
}

test("public keeper and Ponder probes need no credential", async () => {
  const requests = [];
  const result = await checkHostedOperations({
    fetchImpl: healthyFetch(requests),
    expectedDeployment: EXPECTED_DEPLOYMENT,
    keeperAuthToken: "",
    keeperUrl: "https://keeper.example.test",
    ponderUrl: "https://ponder.example.test",
  });
  assert.equal(result.authenticatedKeeper, "skipped");
  assert.deepEqual(
    requests.map(request => request.url),
    ["https://keeper.example.test/ready", "https://ponder.example.test/health/tokenless"],
  );
  assert.ok(requests.every(request => request.authorization === null));
});

test("keeper credential enables authenticated health and metrics without entering output", async () => {
  const requests = [];
  const token = "keeper-auth-secret";
  const result = await checkHostedOperations({
    fetchImpl: healthyFetch(requests),
    expectedDeployment: EXPECTED_DEPLOYMENT,
    keeperAuthToken: token,
    keeperUrl: "https://keeper.example.test",
    ponderUrl: "https://ponder.example.test",
  });
  assert.equal(result.authenticatedKeeper, "checked");
  assert.equal(requests.filter(request => request.authorization === `Bearer ${token}`).length, 2);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token, "u"));
});

test("operational checks fail on the wrong chain or low keeper gas", async () => {
  await assert.rejects(
    checkHostedOperations({
      fetchImpl: async url => {
        if (url.endsWith("/ready")) return response({ protocol: "tokenless-v4", status: "ok" });
        return response({
          chainId: 8453,
          indexReady: true,
          protocol: "tokenless-v4",
          startBlock: 44_915_850,
          status: "ok",
        });
      },
      expectedDeployment: EXPECTED_DEPLOYMENT,
      keeperUrl: "https://keeper.example.test",
      ponderUrl: "https://ponder.example.test",
    }),
    /Base Sepolia/u,
  );

  await assert.rejects(
    checkHostedOperations({
      fetchImpl: async (url, init) => {
        if (url.endsWith("/health")) {
          return response({
            chainId: 84_532,
            deploymentBlock: "44915850",
            deploymentKey: "tokenless-v4:84532:test",
            minimumWalletBalanceWei: "100",
            protocol: "tokenless-v4",
            status: "ok",
            walletBalanceWei: "99",
          });
        }
        return healthyFetch([])(url, init);
      },
      expectedDeployment: EXPECTED_DEPLOYMENT,
      keeperAuthToken: "keeper-auth-secret",
      keeperUrl: "https://keeper.example.test",
      ponderUrl: "https://ponder.example.test",
    }),
    /gas balance/u,
  );
});

test("operational checks fail with actionable stale-service recovery", async () => {
  await assert.rejects(
    checkHostedOperations({
      expectedDeployment: EXPECTED_DEPLOYMENT,
      fetchImpl: async (url, init) => {
        if (url.endsWith("/health/tokenless")) {
          return response({
            chainId: 84_532,
            deploymentKey: "tokenless-v4:84532:stale",
            indexBlock: 44_915_900,
            indexReady: true,
            protocol: "tokenless-v4",
            startBlock: 44_000_000,
            status: "ok",
          });
        }
        return healthyFetch([])(url, init);
      },
      keeperUrl: "https://keeper.example.test",
      ponderUrl: "https://ponder.example.test",
    }),
    /Ponder deployment identity is stale.*Redeploy Ponder/u,
  );

  await assert.rejects(
    checkHostedOperations({
      expectedDeployment: EXPECTED_DEPLOYMENT,
      fetchImpl: async (url, init) => {
        if (url.endsWith("/health")) {
          return response({
            chainId: 84_532,
            deploymentBlock: "44000000",
            deploymentKey: "tokenless-v4:84532:stale",
            minimumWalletBalanceWei: "100",
            protocol: "tokenless-v4",
            status: "ok",
            walletBalanceWei: "101",
          });
        }
        return healthyFetch([])(url, init);
      },
      keeperAuthToken: "keeper-auth-secret",
      keeperUrl: "https://keeper.example.test",
      ponderUrl: "https://ponder.example.test",
    }),
    /Keeper deployment identity is stale.*Redeploy the keeper/u,
  );

  await assert.rejects(
    checkHostedOperations({
      expectedDeployment: EXPECTED_DEPLOYMENT,
      fetchImpl: healthyFetch([]),
      keeperUrl: "https://keeper.example.test",
      ponderUrl: "https://ponder.example.test",
      requireAuthenticatedKeeper: true,
    }),
    /E2E_KEEPER_AUTH_TOKEN is required/u,
  );
});
