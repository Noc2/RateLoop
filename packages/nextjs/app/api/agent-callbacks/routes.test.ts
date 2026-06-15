import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import {
  setAgentCallbackDeliverRouteTestOverrides,
  setAgentCallbackSweepRouteTestOverrides,
} from "~~/lib/agent-callbacks/route-test-overrides";
import { __setRateLimitStoreForTests } from "~~/utils/rateLimit";

type DeliverRouteModule = typeof import("./deliver/route");
type SweepRouteModule = typeof import("./sweep/route");

let deliverRoute: DeliverRouteModule;
let sweepRoute: SweepRouteModule;

const env = process.env as Record<string, string | undefined>;
const originalSecret = env.RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET;
const routeWorkerId = "00000000-0000-4000-8000-000000000000";
const deliveryResult = { dead: 0, delivered: 1, leased: 0, released: 0, retrying: 0 };
const sweepResult = {
  emitted: {
    bountyLowResponse: 0,
    feedbackUnlocked: 0,
    questionOpen: 0,
    questionSettled: 0,
    questionSettling: 0,
  },
  hasMore: false,
  scanned: 1,
};
const handoffSweepResult = {
  deleted: 0,
};

function makeRequest(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://rateloop.ai${path}`, {
    method: "POST",
    headers,
  });
}

before(async () => {
  __setRateLimitStoreForTests({
    execute: async input => {
      const sql = typeof input === "string" ? input : input.sql;
      if (sql.includes("api_rate_limits")) {
        return { rows: [{ request_count: 1 }] } as never;
      }
      return { rows: [{ name: "cleanup" }] } as never;
    },
  });
  deliverRoute = await import("./deliver/route");
  sweepRoute = await import("./sweep/route");
});

beforeEach(() => {
  env.RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET = "callback-secret";
  setAgentCallbackDeliverRouteTestOverrides({
    randomUUID: () => routeWorkerId,
    processDueAgentCallbackDeliveries: async () => deliveryResult,
  });
  setAgentCallbackSweepRouteTestOverrides({
    sweepAgentLifecycleCallbacks: async () => sweepResult,
    sweepExpiredHandoffIntents: async () => handoffSweepResult,
  });
});

after(() => {
  setAgentCallbackDeliverRouteTestOverrides(null);
  setAgentCallbackSweepRouteTestOverrides(null);
  __setRateLimitStoreForTests(null);
  if (originalSecret === undefined) {
    delete env.RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET;
  } else {
    env.RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET = originalSecret;
  }
});

test("agent callback deliver route rejects unconfigured and unauthorized requests", async () => {
  delete env.RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET;
  const missing = await deliverRoute.POST(makeRequest("/api/agent-callbacks/deliver"));
  assert.equal(missing.status, 503);

  env.RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET = "callback-secret";
  const unauthorized = await deliverRoute.POST(
    makeRequest("/api/agent-callbacks/deliver", {
      "x-rateloop-agent-callback-secret": "wrong-secret",
    }),
  );

  assert.equal(unauthorized.status, 401);
});

test("agent callback deliver route accepts bearer auth, clamps limit, and passes a route worker id", async () => {
  const calls: unknown[] = [];
  setAgentCallbackDeliverRouteTestOverrides({
    randomUUID: () => routeWorkerId,
    processDueAgentCallbackDeliveries: async input => {
      calls.push(input);
      return deliveryResult;
    },
  });

  const response = await deliverRoute.POST(
    makeRequest("/api/agent-callbacks/deliver?limit=250", {
      authorization: "Bearer callback-secret",
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), deliveryResult);
  assert.deepEqual(calls, [{ limit: 100, workerId: `route:${routeWorkerId}` }]);
});

test("agent callback sweep route rejects unconfigured and unauthorized requests", async () => {
  delete env.RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET;
  const missing = await sweepRoute.POST(makeRequest("/api/agent-callbacks/sweep"));
  assert.equal(missing.status, 503);

  env.RATELOOP_AGENT_CALLBACK_DELIVERY_SECRET = "callback-secret";
  const unauthorized = await sweepRoute.POST(
    makeRequest("/api/agent-callbacks/sweep", {
      authorization: "Bearer wrong-secret",
    }),
  );

  assert.equal(unauthorized.status, 401);
});

test("agent callback sweep route accepts header auth and defaults invalid limits", async () => {
  const calls: unknown[] = [];
  setAgentCallbackSweepRouteTestOverrides({
    sweepAgentLifecycleCallbacks: async input => {
      calls.push(input);
      return sweepResult;
    },
    sweepExpiredHandoffIntents: async limit => {
      calls.push({ handoffLimit: limit });
      return handoffSweepResult;
    },
  });

  const response = await sweepRoute.POST(
    makeRequest("/api/agent-callbacks/sweep?limit=bogus", {
      "x-rateloop-agent-callback-secret": "callback-secret",
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...sweepResult, handoffs: handoffSweepResult });
  assert.deepEqual(calls, [{ limit: 25 }, { handoffLimit: 25 }]);
});
