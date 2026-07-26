import { NextRequest } from "next/server";
import {
  POST as createEventStream,
  GET as listEventStreams,
} from "./workspaces/[workspaceId]/assurance/event-streams/route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const APP_ORIGIN = "https://tokenless.example.test";
const NO_STORE = "private, no-store, max-age=0";
const previousAppUrl = process.env.APP_URL;

beforeEach(() => {
  process.env.APP_URL = APP_ORIGIN;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
});

async function browser(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_event_stream_route_${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  return { principalId: identity.principalId, token: session.token };
}

function request(
  path: string,
  options: { body?: unknown; method?: "GET" | "POST"; origin?: string; token?: string } = {},
) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    body,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.token ? { cookie: `${AUTH_SESSION_COOKIE}=${options.token}` } : {}),
    },
    method: options.method ?? "GET",
  });
}

test("assurance event-stream handlers enforce browser authorization, CSRF, field errors, and no-store", async () => {
  const owner = await browser("owner");
  const outsider = await browser("outsider");
  const { workspaceId } = await createWorkspace({ name: "Event stream route", ownerAddress: owner.principalId });
  const path = `/api/account/workspaces/${workspaceId}/assurance/event-streams`;
  const context = { params: Promise.resolve({ workspaceId }) };

  const unauthenticated = await listEventStreams(request(path), context);
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.headers.get("cache-control"), NO_STORE);

  const hidden = await listEventStreams(request(path, { token: outsider.token }), context);
  assert.equal(hidden.status, 404);

  const empty = await listEventStreams(request(path, { token: owner.token }), context);
  assert.equal(empty.status, 200);
  assert.equal(empty.headers.get("cache-control"), NO_STORE);
  assert.deepEqual((await empty.json()).streams, []);

  const crossOrigin = await createEventStream(
    request(path, {
      body: { eventTypes: ["ai.rateloop.review.completed"], url: "https://events.example.test/hook" },
      method: "POST",
      origin: "https://attacker.example",
      token: owner.token,
    }),
    context,
  );
  assert.equal(crossOrigin.status, 403);

  const invalid = await createEventStream(
    request(path, {
      body: { eventTypes: "ai.rateloop.review.completed", url: "https://events.example.test/hook" },
      method: "POST",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    context,
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get("cache-control"), NO_STORE);
  assert.equal((await invalid.json()).field, "eventTypes");
});
