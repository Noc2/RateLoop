import { NextRequest } from "next/server";
import { POST as resolveComplianceAppeal } from "../../internal/compliance/forecast-integrity/appeals/[appealId]/route";
import { POST as resolveWorkspaceAppeal } from "../workspaces/[workspaceId]/forecast-integrity/appeals/[appealId]/route";
import { GET as listIntegrity, POST as openAppeal, DELETE as withdrawAppeal } from "./route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests, dbClient, dbPool } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { __crowdForecastPersistenceTestUtils } from "~~/lib/tokenless/crowdForecastPersistence";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const APP_ORIGIN = "https://tokenless.example.test";
const NO_STORE = "private, no-store, max-age=0";
const COMPLIANCE_SECRET = "forecast-route-compliance-secret";
const previousAppUrl = process.env.APP_URL;
const previousComplianceSecret = process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET;
const previousLookupKey = process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY;
const previousLookupVersion = process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION;
const previousLookupKeyring = process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEYS_JSON;

beforeEach(() => {
  process.env.APP_URL = APP_ORIGIN;
  process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET = COMPLIANCE_SECRET;
  process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY = Buffer.alloc(32, 53).toString("base64url");
  process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION = "forecast-route-test-v1";
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
  if (previousComplianceSecret === undefined) delete process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET;
  else process.env.TOKENLESS_COMPLIANCE_OPERATOR_SECRET = previousComplianceSecret;
  if (previousLookupKey === undefined) delete process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY;
  else process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY = previousLookupKey;
  if (previousLookupVersion === undefined) delete process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION;
  else process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEY_VERSION = previousLookupVersion;
  if (previousLookupKeyring === undefined) delete process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEYS_JSON;
  else process.env.TOKENLESS_INTEGRITY_REVIEWER_LOOKUP_KEYS_JSON = previousLookupKeyring;
});

async function authenticatedPrincipal(label: string) {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: `better_forecast_${label}`,
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  return { principalId: identity.principalId, token: session.token };
}

function request(
  path: string,
  options: {
    authorization?: string;
    body?: unknown;
    method?: "DELETE" | "GET" | "POST";
    origin?: string;
    token?: string;
  } = {},
) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  return new NextRequest(`${APP_ORIGIN}${path}`, {
    body,
    headers: {
      ...(options.authorization ? { authorization: options.authorization } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.token ? { cookie: `${AUTH_SESSION_COOKIE}=${options.token}` } : {}),
    },
    method: options.method ?? "GET",
  });
}

async function seedHardForecastFindings(workspaceId: string, principalId: string) {
  for (let index = 0; index < 16; index += 1) {
    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await __crowdForecastPersistenceTestUtils.aggregateInvitedBatch(client, {
        workspaceId,
        observations: [{ principalId, predictedPositiveBps: 5_000, vote: index % 2 === 0 ? 1 : 0 }],
        outcome: index % 2 === 0 ? 1 : 0,
        now: new Date(1_786_500_000_000 + index * 1_000),
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

test("forecast appeal routes enforce exact-finding scope, ownership, terminal resolution, and immutable events", async () => {
  const owner = await authenticatedPrincipal("owner");
  const reviewer = await authenticatedPrincipal("reviewer");
  const outsider = await authenticatedPrincipal("outsider");
  const workspace = await createWorkspace({ ownerAddress: owner.principalId, name: "Forecast route workspace" });
  const otherWorkspace = await createWorkspace({
    ownerAddress: outsider.principalId,
    name: "Other forecast route workspace",
  });
  await seedHardForecastFindings(workspace.workspaceId, reviewer.principalId);

  const listed = await listIntegrity(request("/api/account/forecast-integrity", { token: reviewer.token }));
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get("cache-control"), NO_STORE);
  const listedBody = await listed.json();
  const invariant = listedBody.items[0]?.findings.find(
    (finding: { reasonCode: string }) => finding.reasonCode === "forecast_invariant",
  );
  const discrimination = listedBody.items[0]?.findings.find(
    (finding: { reasonCode: string }) => finding.reasonCode === "forecast_discrimination_absent",
  );
  assert.ok(invariant?.findingId);
  assert.ok(discrimination?.findingId);

  const firstOpened = await openAppeal(
    request("/api/account/forecast-integrity", {
      body: { findingId: invariant.findingId, reasonCode: "measurement_error" },
      method: "POST",
      origin: APP_ORIGIN,
      token: reviewer.token,
    }),
  );
  assert.equal(firstOpened.status, 201);
  assert.equal(firstOpened.headers.get("cache-control"), NO_STORE);
  const firstAppeal = await firstOpened.json();
  assert.equal(firstAppeal.consequence, "future_assignment_restriction");

  const secondOpened = await openAppeal(
    request("/api/account/forecast-integrity", {
      body: { findingId: discrimination.findingId, reasonCode: "context_missing" },
      method: "POST",
      origin: APP_ORIGIN,
      token: reviewer.token,
    }),
  );
  assert.equal(secondOpened.status, 201);
  const secondAppeal = await secondOpened.json();
  assert.equal(secondAppeal.consequence, "suspended_by_open_appeal");

  const hiddenAcrossWorkspace = await resolveWorkspaceAppeal(
    request(
      `/api/account/workspaces/${otherWorkspace.workspaceId}/forecast-integrity/appeals/${firstAppeal.appealId}`,
      {
        body: { status: "accepted", resolutionReason: "Should not cross tenant boundaries." },
        method: "POST",
        origin: APP_ORIGIN,
        token: outsider.token,
      },
    ),
    { params: Promise.resolve({ workspaceId: otherWorkspace.workspaceId, appealId: firstAppeal.appealId }) },
  );
  assert.equal(hiddenAcrossWorkspace.status, 404);

  const resolved = await resolveWorkspaceAppeal(
    request(`/api/account/workspaces/${workspace.workspaceId}/forecast-integrity/appeals/${firstAppeal.appealId}`, {
      body: { status: "accepted", resolutionReason: "Owner reviewed the submitted context." },
      method: "POST",
      origin: APP_ORIGIN,
      token: owner.token,
    }),
    { params: Promise.resolve({ workspaceId: workspace.workspaceId, appealId: firstAppeal.appealId }) },
  );
  assert.equal(resolved.status, 200);
  assert.equal(resolved.headers.get("cache-control"), NO_STORE);
  assert.equal((await resolved.json()).status, "accepted");

  const cannotWithdrawResolved = await withdrawAppeal(
    request("/api/account/forecast-integrity", {
      body: { appealId: firstAppeal.appealId },
      method: "DELETE",
      origin: APP_ORIGIN,
      token: reviewer.token,
    }),
  );
  assert.equal(cannotWithdrawResolved.status, 409);

  const withdrawn = await withdrawAppeal(
    request("/api/account/forecast-integrity", {
      body: { appealId: secondAppeal.appealId },
      method: "DELETE",
      origin: APP_ORIGIN,
      token: reviewer.token,
    }),
  );
  assert.equal(withdrawn.status, 200);
  assert.equal((await withdrawn.json()).consequence, "none");

  const reopened = await openAppeal(
    request("/api/account/forecast-integrity", {
      body: { findingId: invariant.findingId, reasonCode: "shared_process" },
      method: "POST",
      origin: APP_ORIGIN,
      token: reviewer.token,
    }),
  );
  const reopenedAppeal = await reopened.json();
  const hiddenFromOtherPrincipal = await withdrawAppeal(
    request("/api/account/forecast-integrity", {
      body: { appealId: reopenedAppeal.appealId },
      method: "DELETE",
      origin: APP_ORIGIN,
      token: outsider.token,
    }),
  );
  assert.equal(hiddenFromOtherPrincipal.status, 404);

  const deniedCompliance = await resolveComplianceAppeal(
    request(`/api/internal/compliance/forecast-integrity/appeals/${reopenedAppeal.appealId}`, {
      authorization: "Bearer wrong-secret",
      body: { status: "rejected", resolutionReason: "Denied.", resolvedBy: "compliance:test" },
      method: "POST",
    }),
    { params: Promise.resolve({ appealId: reopenedAppeal.appealId }) },
  );
  assert.equal(deniedCompliance.status, 401);
  assert.equal(deniedCompliance.headers.get("cache-control"), NO_STORE);

  const complianceResolved = await resolveComplianceAppeal(
    request(`/api/internal/compliance/forecast-integrity/appeals/${reopenedAppeal.appealId}`, {
      authorization: `Bearer ${COMPLIANCE_SECRET}`,
      body: {
        status: "rejected",
        resolutionReason: "Compliance review found the measurement sound.",
        resolvedBy: "compliance:test",
      },
      method: "POST",
    }),
    { params: Promise.resolve({ appealId: reopenedAppeal.appealId }) },
  );
  assert.equal(complianceResolved.status, 200);
  assert.equal(complianceResolved.headers.get("cache-control"), NO_STORE);
  assert.equal((await complianceResolved.json()).status, "rejected");

  const events = await dbClient.execute(
    "SELECT event_type,actor_kind FROM tokenless_forecast_integrity_appeal_events ORDER BY event_type,actor_kind",
  );
  assert.deepEqual(
    events.rows.map(row => [row.event_type, row.actor_kind]),
    [
      ["accepted", "workspace_manager"],
      ["opened", "principal"],
      ["opened", "principal"],
      ["opened", "principal"],
      ["rejected", "compliance_operator"],
      ["withdrawn", "principal"],
    ],
  );
});
