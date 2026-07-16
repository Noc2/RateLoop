import { NextRequest } from "next/server";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { GET } from "~~/app/api/account/workspaces/[workspaceId]/assurance/metrics/grafana/route";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";
import { createWorkspace } from "~~/lib/tokenless/productCore";

const ORIGIN = "https://tokenless.example.test";

beforeEach(() => __setDatabaseResourcesForTests(createMemoryDatabaseResources()));
afterEach(() => __setDatabaseResourcesForTests(null));

test("Grafana dashboard is a versioned authenticated download with local Prometheus queries", async () => {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: "better_assurance_metrics_dashboard_owner",
    method: "passkey",
  });
  const session = await createAuthSession(identity);
  const { workspaceId } = await createWorkspace({ name: "Metrics dashboard", ownerAddress: identity.principalId });
  const path = `/api/account/workspaces/${workspaceId}/assurance/metrics/grafana`;
  const context = { params: Promise.resolve({ workspaceId }) };
  const response = await GET(
    new NextRequest(`${ORIGIN}${path}`, {
      headers: { cookie: `${AUTH_SESSION_COOKIE}=${session.token}` },
    }),
    context,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="rateloop-assurance-grafana-v1.json"',
  );
  const dashboard = (await response.json()) as {
    uid: string;
    version: number;
    panels: Array<{ targets: Array<{ expr: string }> }>;
  };
  assert.equal(dashboard.uid, "rateloop-assurance-v1");
  assert.equal(dashboard.version, 1);
  const expressions = dashboard.panels.flatMap(panel => panel.targets.map(target => target.expr));
  assert.deepEqual(expressions, [
    "rateloop_assurance_reviews_requested",
    "rateloop_assurance_reviews_completed",
    "rateloop_assurance_blocked",
    "rateloop_assurance_approval_required",
    "rateloop_assurance_sampling_rate_ratio",
    "rateloop_assurance_verdict_latency_seconds",
    "rateloop_assurance_disagreement_ratio",
    "rateloop_assurance_evidence_anchor_lag_seconds",
  ]);
  assert.doesNotMatch(JSON.stringify(dashboard), /https?:\/\//u);

  const unauthenticated = await GET(new NextRequest(`${ORIGIN}${path}`), context);
  assert.equal(unauthenticated.status, 401);
});
