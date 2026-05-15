import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

type DeliverRouteModule = typeof import("./deliver/route");
type SweepRouteModule = typeof import("./sweep/route");

let deliverRoute: DeliverRouteModule;
let sweepRoute: SweepRouteModule;

const env = process.env as Record<string, string | undefined>;
const originalSecret = env.CURYO_AGENT_CALLBACK_DELIVERY_SECRET;

function makeRequest(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://curyo.xyz${path}`, {
    method: "POST",
    headers,
  });
}

before(async () => {
  deliverRoute = await import("./deliver/route");
  sweepRoute = await import("./sweep/route");
});

beforeEach(() => {
  env.CURYO_AGENT_CALLBACK_DELIVERY_SECRET = "callback-secret";
  deliverRoute.__setAgentCallbackDeliverRouteTestOverridesForTests({
    randomUUID: () => "test-worker",
    processDueAgentCallbackDeliveries: async () => ({ delivered: 1, failed: 0 }),
  });
  sweepRoute.__setAgentCallbackSweepRouteTestOverridesForTests({
    sweepAgentLifecycleCallbacks: async () => ({ swept: 1 }),
  });
});

after(() => {
  deliverRoute.__setAgentCallbackDeliverRouteTestOverridesForTests(null);
  sweepRoute.__setAgentCallbackSweepRouteTestOverridesForTests(null);
  if (originalSecret === undefined) {
    delete env.CURYO_AGENT_CALLBACK_DELIVERY_SECRET;
  } else {
    env.CURYO_AGENT_CALLBACK_DELIVERY_SECRET = originalSecret;
  }
});

test("agent callback deliver route rejects unconfigured and unauthorized requests", async () => {
  delete env.CURYO_AGENT_CALLBACK_DELIVERY_SECRET;
  const missing = await deliverRoute.POST(makeRequest("/api/agent-callbacks/deliver"));
  assert.equal(missing.status, 503);

  env.CURYO_AGENT_CALLBACK_DELIVERY_SECRET = "callback-secret";
  const unauthorized = await deliverRoute.POST(
    makeRequest("/api/agent-callbacks/deliver", {
      "x-curyo-agent-callback-secret": "wrong-secret",
    }),
  );

  assert.equal(unauthorized.status, 401);
});

test("agent callback deliver route accepts bearer auth, clamps limit, and passes a route worker id", async () => {
  const calls: unknown[] = [];
  deliverRoute.__setAgentCallbackDeliverRouteTestOverridesForTests({
    randomUUID: () => "test-worker",
    processDueAgentCallbackDeliveries: async input => {
      calls.push(input);
      return { delivered: 1, failed: 0 };
    },
  });

  const response = await deliverRoute.POST(
    makeRequest("/api/agent-callbacks/deliver?limit=250", {
      authorization: "Bearer callback-secret",
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { delivered: 1, failed: 0 });
  assert.deepEqual(calls, [{ limit: 100, workerId: "route:test-worker" }]);
});

test("agent callback sweep route rejects unconfigured and unauthorized requests", async () => {
  delete env.CURYO_AGENT_CALLBACK_DELIVERY_SECRET;
  const missing = await sweepRoute.POST(makeRequest("/api/agent-callbacks/sweep"));
  assert.equal(missing.status, 503);

  env.CURYO_AGENT_CALLBACK_DELIVERY_SECRET = "callback-secret";
  const unauthorized = await sweepRoute.POST(
    makeRequest("/api/agent-callbacks/sweep", {
      authorization: "Bearer wrong-secret",
    }),
  );

  assert.equal(unauthorized.status, 401);
});

test("agent callback sweep route accepts header auth and defaults invalid limits", async () => {
  const calls: unknown[] = [];
  sweepRoute.__setAgentCallbackSweepRouteTestOverridesForTests({
    sweepAgentLifecycleCallbacks: async input => {
      calls.push(input);
      return { swept: 1 };
    },
  });

  const response = await sweepRoute.POST(
    makeRequest("/api/agent-callbacks/sweep?limit=bogus", {
      "x-curyo-agent-callback-secret": "callback-secret",
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { swept: 1 });
  assert.deepEqual(calls, [{ limit: 25 }]);
});
