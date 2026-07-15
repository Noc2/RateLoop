import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const routeRoot = join(process.cwd(), "app", "api", "account", "workspaces", "[workspaceId]", "agent-setup");

function routeSource(name: string) {
  return readFileSync(join(routeRoot, name, "route.ts"), "utf8");
}

test("setup read is session-bound, workspace-scoped, and private", () => {
  const source = readFileSync(join(routeRoot, "route.ts"), "utf8");
  assert.match(source, /requireBrowserSession\(request\)/);
  assert.match(source, /workspaceId/);
  assert.match(source, /requestedStep: request\.nextUrl\.searchParams\.get\("step"\)/);
  assert.match(source, /private, no-store, max-age=0/);
});

test("every setup mutation requires same-origin browser authorization and strict field allowlists", () => {
  for (const route of ["connect", "confirm-agent", "configure-reviews", "people", "complete"]) {
    const source = routeSource(route);
    assert.match(source, /requireBrowserSession\(request, \{ mutation: true \}\)/, route);
    assert.match(source, /Object\.keys\(body\)\.some/, route);
    assert.match(source, /workspaceId/, route);
    assert.match(source, /private, no-store, max-age=0/, route);
  }
});

test("setup routes delegate mutations to the coordinator instead of management-panel APIs", () => {
  assert.match(routeSource("connect"), /createWorkspaceAgentSetupConnection/);
  assert.match(routeSource("confirm-agent"), /confirmWorkspaceSetupAgent/);
  assert.match(routeSource("configure-reviews"), /configureWorkspaceSetupReviews/);
  assert.match(routeSource("people"), /configureWorkspaceSetupPeople/);
  assert.match(routeSource("complete"), /completeWorkspaceAgentSetup/);
  for (const route of ["connect", "confirm-agent", "configure-reviews", "people", "complete"]) {
    assert.doesNotMatch(
      routeSource(route),
      /createManagedReviewPolicy|createAgentPublishingPolicy|createPrivateGroup\(/,
    );
  }
});
