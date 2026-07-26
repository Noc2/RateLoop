import { NextRequest } from "next/server";
import { POST as acceptAssignment, GET as getAssignmentAccess } from "./[assignmentId]/accept/route";
import { GET as getArtifact } from "./[assignmentId]/artifacts/[artifactId]/route";
import { POST as recoverAssignment } from "./[assignmentId]/recover/route";
import { POST as submitResponse } from "./[assignmentId]/responses/route";
import { GET as getTask } from "./[assignmentId]/task/route";
import { GET as listAssignments } from "./route";
import assert from "node:assert/strict";
import test from "node:test";

const ORIGIN = "https://tokenless.example.test";
const assignmentContext = { params: Promise.resolve({ assignmentId: "hpua_route_test" }) };
const artifactContext = {
  params: Promise.resolve({ assignmentId: "hpua_route_test", artifactId: "artifact_route_test" }),
};

function request(path: string, method = "GET") {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    ...(method === "GET" ? {} : { body: "{}", headers: { "content-type": "application/json" } }),
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
