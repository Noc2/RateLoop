import { checkHostedOperations } from "./operations.mjs";
import assert from "node:assert/strict";
import test from "node:test";

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
        status: "ok",
      });
    }
    if (url.endsWith("/health")) {
      return response({
        minimumWalletBalanceWei: "100",
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
        return response({ chainId: 8453, indexReady: true, protocol: "tokenless-v4", status: "ok" });
      },
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
            minimumWalletBalanceWei: "100",
            protocol: "tokenless-v4",
            status: "ok",
            walletBalanceWei: "99",
          });
        }
        return healthyFetch([])(url, init);
      },
      keeperAuthToken: "keeper-auth-secret",
      keeperUrl: "https://keeper.example.test",
      ponderUrl: "https://ponder.example.test",
    }),
    /gas balance/u,
  );
});
