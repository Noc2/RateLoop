import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { setThirdwebVerifierRouteTestOverrides } from "~~/lib/thirdweb/routeTestOverrides";

type RouteModule = typeof import("./route");

let route: RouteModule;
const originalConsoleError = console.error;
const originalConsoleInfo = console.info;
const originalConsoleWarn = console.warn;
const allowanceSummary = {} as never;

function makeRequest(body: string | Record<string, unknown>, secret = "server-secret") {
  return new NextRequest("https://rateloop.xyz/api/thirdweb/verify-transaction", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-thirdweb-verifier-secret": secret,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

before(async () => {
  route = await import("./route");
});

beforeEach(() => {
  console.error = () => {};
  console.info = () => {};
  console.warn = () => {};
  setThirdwebVerifierRouteTestOverrides({
    getThirdwebClientId: () => "client-1",
    getThirdwebServerVerifierSecret: () => "server-secret",
    evaluateFreeTransactionAllowance: async () => ({ isAllowed: true, summary: allowanceSummary }),
  });
});

after(() => {
  setThirdwebVerifierRouteTestOverrides(null);
  console.error = originalConsoleError;
  console.info = originalConsoleInfo;
  console.warn = originalConsoleWarn;
});

test("thirdweb verifier route denies when the server verifier secret is not configured", async () => {
  setThirdwebVerifierRouteTestOverrides({
    getThirdwebClientId: () => "client-1",
    getThirdwebServerVerifierSecret: () => "",
  });

  const response = await route.POST(makeRequest({ clientId: "client-1" }));

  assert.deepEqual(await response.json(), {
    isAllowed: false,
    reason: "Transactions are not sponsored right now.",
  });
});

test("thirdweb verifier route denies requests with a bad verifier secret", async () => {
  let evaluated = false;
  setThirdwebVerifierRouteTestOverrides({
    getThirdwebClientId: () => "client-1",
    getThirdwebServerVerifierSecret: () => "server-secret",
    evaluateFreeTransactionAllowance: async () => {
      evaluated = true;
      return { isAllowed: true, summary: allowanceSummary };
    },
  });

  const response = await route.POST(makeRequest({ clientId: "client-1" }, "bad-secret"));

  assert.deepEqual(await response.json(), { isAllowed: false, reason: "Unauthorized" });
  assert.equal(evaluated, false);
});

test("thirdweb verifier route denies client id mismatches before evaluating allowance", async () => {
  let evaluated = false;
  setThirdwebVerifierRouteTestOverrides({
    getThirdwebClientId: () => "client-1",
    getThirdwebServerVerifierSecret: () => "server-secret",
    evaluateFreeTransactionAllowance: async () => {
      evaluated = true;
      return { isAllowed: true, summary: allowanceSummary };
    },
  });

  const response = await route.POST(makeRequest({ clientId: "client-2", chainId: 480 }));

  assert.deepEqual(await response.json(), {
    isAllowed: false,
    reason: "Transactions are not sponsored right now.",
  });
  assert.equal(evaluated, false);
});

test("thirdweb verifier route delegates valid requests and maps allowance decisions", async () => {
  const body = { clientId: "client-1", chainId: 480, userOp: { sender: "0xsender" } };
  const evaluatedBodies: unknown[] = [];
  let allowed = false;
  setThirdwebVerifierRouteTestOverrides({
    getThirdwebClientId: () => "client-1",
    getThirdwebServerVerifierSecret: () => "server-secret",
    evaluateFreeTransactionAllowance: async requestBody => {
      evaluatedBodies.push(requestBody);
      return allowed
        ? { isAllowed: true, summary: allowanceSummary }
        : {
            isAllowed: false,
            reason: "Quota exceeded.",
            debugCode: "free_tx_exhausted",
            summary: allowanceSummary,
          };
    },
  });

  const denied = await route.POST(makeRequest(body));

  assert.deepEqual(await denied.json(), { isAllowed: false, reason: "Quota exceeded." });
  assert.deepEqual(evaluatedBodies, [body]);

  allowed = true;
  const approved = await route.POST(makeRequest(body));

  assert.deepEqual(await approved.json(), { isAllowed: true });
});
