import { NextRequest } from "next/server";
import { POST as decideSanctionsScreening } from "./sanctions/screenings/[screeningId]/route";
import { GET as listSanctionsScreenings } from "./sanctions/screenings/route";
import { POST as decideWorkspaceFunds } from "./workspace-funds/[resolutionId]/route";
import { GET as listWorkspaceFunds } from "./workspace-funds/route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const APP_ORIGIN = "https://tokenless.example.test";
const NO_STORE = "private, no-store, max-age=0";
const SECRET = "route-test-compliance-secret";
const previousSecret = process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET;

beforeEach(() => {
  process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET = SECRET;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (previousSecret === undefined) delete process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET;
  else process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET = previousSecret;
});

function request(path: string, options: { authorization?: string; body?: unknown; method?: "GET" | "POST" } = {}) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    body,
    headers: {
      ...(options.authorization ? { authorization: options.authorization } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    method: options.method ?? "GET",
  });
}

test("all four compliance handlers require the operator secret and emit no-store responses", async () => {
  const denied = await Promise.all([
    listSanctionsScreenings(request("/api/internal/compliance/sanctions/screenings")),
    decideSanctionsScreening(
      request("/api/internal/compliance/sanctions/screenings/san_denied", { body: {}, method: "POST" }),
      { params: Promise.resolve({ screeningId: "san_denied" }) },
    ),
    listWorkspaceFunds(request("/api/internal/compliance/workspace-funds")),
    decideWorkspaceFunds(request("/api/internal/compliance/workspace-funds/wfr_denied", { body: {}, method: "POST" }), {
      params: Promise.resolve({ resolutionId: "wfr_denied" }),
    }),
  ]);
  assert.deepEqual(
    denied.map(response => response.status),
    [401, 401, 401, 401],
  );
  assert.ok(denied.every(response => response.headers.get("cache-control") === NO_STORE));
});

test("authorized compliance list handlers validate limits and return empty queues", async () => {
  const authorization = `Bearer ${SECRET}`;
  const invalidSanctions = await listSanctionsScreenings(
    request("/api/internal/compliance/sanctions/screenings?limit=0", { authorization }),
  );
  const invalidFunds = await listWorkspaceFunds(
    request("/api/internal/compliance/workspace-funds?limit=101", { authorization }),
  );
  assert.equal(invalidSanctions.status, 400);
  assert.equal(invalidFunds.status, 400);

  const sanctions = await listSanctionsScreenings(
    request("/api/internal/compliance/sanctions/screenings", { authorization }),
  );
  const funds = await listWorkspaceFunds(request("/api/internal/compliance/workspace-funds", { authorization }));
  assert.equal(sanctions.status, 200);
  assert.equal(funds.status, 200);
  assert.deepEqual((await sanctions.json()).screenings, []);
  assert.deepEqual((await funds.json()).resolutions, []);
  assert.equal(sanctions.headers.get("cache-control"), NO_STORE);
  assert.equal(funds.headers.get("cache-control"), NO_STORE);
});

test("authorized compliance decision handlers reject malformed input before mutation", async () => {
  const authorization = `Bearer ${SECRET}`;
  const sanctions = await decideSanctionsScreening(
    request(`/api/internal/compliance/sanctions/screenings/san_${"1".repeat(32)}`, {
      authorization,
      body: { status: "approved" },
      method: "POST",
    }),
    { params: Promise.resolve({ screeningId: `san_${"1".repeat(32)}` }) },
  );
  const funds = await decideWorkspaceFunds(
    request(`/api/internal/compliance/workspace-funds/wfr_${"2".repeat(32)}`, {
      authorization,
      body: { status: "approved" },
      method: "POST",
    }),
    { params: Promise.resolve({ resolutionId: `wfr_${"2".repeat(32)}` }) },
  );
  assert.equal(sanctions.status, 400);
  assert.equal(funds.status, 400);
  assert.equal(sanctions.headers.get("cache-control"), NO_STORE);
  assert.equal(funds.headers.get("cache-control"), NO_STORE);
});
