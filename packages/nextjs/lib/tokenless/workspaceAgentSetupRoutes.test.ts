import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const routeRoot = join(process.cwd(), "app", "api", "account", "workspaces", "[workspaceId]", "agent-setup");
const coordinatorSource = readFileSync(join(process.cwd(), "lib", "tokenless", "workspaceAgentSetup.ts"), "utf8");
const privateGroupsSource = readFileSync(join(process.cwd(), "lib", "tokenless", "privateGroups.ts"), "utf8");

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
  for (const route of ["connect", "confirm-agent", "configure-reviews", "people", "complete", "finalize"]) {
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
  assert.match(routeSource("finalize"), /finalizeWorkspaceAgentSetup/);
  for (const route of ["connect", "confirm-agent", "configure-reviews", "people", "complete", "finalize"]) {
    assert.doesNotMatch(
      routeSource(route),
      /createManagedReviewPolicy|createAgentPublishingPolicy|createPrivateGroup\(/,
    );
  }
});

test("atomic setup finalization accepts one retry key and the People decision in one request", () => {
  const source = routeSource("finalize");
  assert.match(source, /"idempotencyKey"/u);
  assert.match(source, /"decision"/u);
  assert.match(source, /"createInvitation"/u);
  assert.match(source, /"maximumRedemptions"/u);
  assert.match(source, /"intendedEmailDomain"/u);
  assert.match(source, /finalizeWorkspaceAgentSetup/u);
});

test("invitation insertion and setup completion share the finalizer transaction boundary", () => {
  const finalizer = coordinatorSource.slice(
    coordinatorSource.indexOf("export async function finalizeWorkspaceAgentSetup"),
  );
  assert.match(
    finalizer,
    /client\.query\("BEGIN"\)[\s\S]*createPrivateGroupInvitationInTransaction\(client[\s\S]*UPDATE tokenless_workspace_agent_setups[\s\S]*client\.query\("COMMIT"\)[\s\S]*client\.query\("ROLLBACK"\)/u,
  );
  const invitationSeam = privateGroupsSource.slice(
    privateGroupsSource.indexOf("export async function createPrivateGroupInvitationInTransaction"),
    privateGroupsSource.indexOf("export async function createPrivateGroupInvitation(input"),
  );
  assert.doesNotMatch(invitationSeam, /client\.query\("(?:BEGIN|COMMIT|ROLLBACK)"\)/u);
});

test("review progress confirms an exact owner-saved binding instead of accepting a second policy draft", () => {
  const source = routeSource("configure-reviews");
  assert.match(source, /\["revision", "bindingRevision"\]/);
  assert.match(source, /bindingRevision: body\.bindingRevision/);
  assert.doesNotMatch(source, /reviewerAudience|contentBoundary|autonomousAccess/);
});
