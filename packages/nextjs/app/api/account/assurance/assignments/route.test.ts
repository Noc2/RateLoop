import { NextRequest } from "next/server";
import { POST as acceptAssignment, GET as getAssignmentAccess } from "./[assignmentId]/accept/route";
import { GET as getArtifact } from "./[assignmentId]/artifacts/[artifactId]/route";
import { POST as recoverAssignment } from "./[assignmentId]/recover/route";
import { POST as submitResponse } from "./[assignmentId]/responses/route";
import { GET as getTask } from "./[assignmentId]/task/route";
import { GET as listAssignments } from "./route";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resolveBetterAuthPrincipal } from "~~/lib/auth/principal";
import { AUTH_SESSION_COOKIE, createAuthSession } from "~~/lib/auth/session";
import { __setDatabaseResourcesForTests } from "~~/lib/db";
import { createMemoryDatabaseResources } from "~~/lib/db/testing/testMemory";

const ORIGIN = "https://tokenless.example.test";
const assignmentContext = { params: Promise.resolve({ assignmentId: "hpua_route_test" }) };
const artifactContext = {
  params: Promise.resolve({ assignmentId: "hpua_route_test", artifactId: "artifact_route_test" }),
};
const previousAppUrl = process.env.APP_URL;

beforeEach(() => {
  process.env.APP_URL = ORIGIN;
  __setDatabaseResourcesForTests(createMemoryDatabaseResources());
});

afterEach(() => {
  __setDatabaseResourcesForTests(null);
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
});

function request(path: string, method = "GET", token?: string, origin?: string) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    ...(method === "GET" ? {} : { body: "{}" }),
    headers: {
      ...(method === "GET" ? {} : { "content-type": "application/json" }),
      ...(token ? { cookie: `${AUTH_SESSION_COOKIE}=${token}` } : {}),
      ...(origin ? { origin } : {}),
    },
  });
}

test("every account assignment handler imports and rejects an unauthenticated request at the route boundary", async () => {
  const responses = await Promise.all([
    listAssignments(request("/api/account/assurance/assignments")),
    getAssignmentAccess(request("/api/account/assurance/assignments/hpua_route_test/accept"), assignmentContext),
    acceptAssignment(request("/api/account/assurance/assignments/hpua_route_test/accept", "POST"), assignmentContext),
    getArtifact(
      request("/api/account/assurance/assignments/hpua_route_test/artifacts/artifact_route_test"),
      artifactContext,
    ),
    recoverAssignment(request("/api/account/assurance/assignments/hpua_route_test/recover", "POST"), assignmentContext),
    submitResponse(request("/api/account/assurance/assignments/hpua_route_test/responses", "POST"), assignmentContext),
    getTask(request("/api/account/assurance/assignments/hpua_route_test/task"), assignmentContext),
  ]);
  assert.deepEqual(
    responses.map(response => response.status),
    [401, 401, 403, 401, 403, 403, 401],
  );
});

test("authenticated assignment handlers return private empty state, enforce origin, and hide unknown assignments", async () => {
  const identity = await resolveBetterAuthPrincipal({
    betterAuthUserId: "better_assignment_route_test",
    method: "passkey",
  });
  const session = await createAuthSession(identity);

  const listed = await listAssignments(request("/api/account/assurance/assignments", "GET", session.token));
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.deepEqual(((await listed.json()) as { assignments: unknown[] }).assignments, []);

  const crossOriginAccept = await acceptAssignment(
    request(
      "/api/account/assurance/assignments/hpua_route_test/accept",
      "POST",
      session.token,
      "https://attacker.example",
    ),
    assignmentContext,
  );
  assert.equal(crossOriginAccept.status, 403);

  const unknownResponses = await Promise.all([
    getAssignmentAccess(
      request("/api/account/assurance/assignments/hpua_route_test/accept", "GET", session.token),
      assignmentContext,
    ),
    getArtifact(
      request("/api/account/assurance/assignments/hpua_route_test/artifacts/artifact_route_test", "GET", session.token),
      artifactContext,
    ),
    getTask(
      request("/api/account/assurance/assignments/hpua_route_test/task", "GET", session.token),
      assignmentContext,
    ),
  ]);
  assert.deepEqual(
    unknownResponses.map(response => response.status),
    [404, 404, 404],
  );
  assert.ok(
    unknownResponses.every(response => response.headers.get("cache-control") === "private, no-store, max-age=0"),
  );
});
