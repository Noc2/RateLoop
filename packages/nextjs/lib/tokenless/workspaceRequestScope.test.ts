import { WorkspaceRequestScope } from "./workspaceRequestScope";
import assert from "node:assert/strict";
import test from "node:test";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

test("a deferred top-up response cannot replace the newly selected workspace balance", async () => {
  const scope = new WorkspaceRequestScope();
  const workspaceA = deferred<string>();
  const workspaceB = deferred<string>();
  const committed: string[] = [];

  scope.selectWorkspace("workspace-a");
  const requestA = scope.begin("workspace-a", "topups:load");
  const loadA = workspaceA.promise.then(value => {
    if (requestA.isCurrent()) committed.push(value);
    requestA.finish();
  });

  scope.selectWorkspace("workspace-b");
  assert.equal(requestA.signal.aborted, true);
  const requestB = scope.begin("workspace-b", "topups:load");
  const loadB = workspaceB.promise.then(value => {
    if (requestB.isCurrent()) committed.push(value);
    requestB.finish();
  });

  workspaceB.resolve("workspace-b-balance");
  await loadB;
  workspaceA.resolve("workspace-a-balance");
  await loadA;

  assert.deepEqual(committed, ["workspace-b-balance"]);
});

test("a deferred identity action cannot expose an old token, error, or busy-state update", async () => {
  const scope = new WorkspaceRequestScope();
  const workspaceA = deferred<{ token: string }>();
  const workspaceB = deferred<{ token: string }>();
  const state = { busy: false, error: null as string | null, token: null as string | null };

  async function runAction(workspaceId: string, requestBody: ReturnType<typeof deferred<{ token: string }>>) {
    const request = scope.begin(workspaceId, "identity:action");
    state.busy = true;
    try {
      const result = await requestBody.promise;
      if (request.isCurrent()) state.token = result.token;
    } catch (cause) {
      if (request.isCurrent()) state.error = cause instanceof Error ? cause.message : "Identity request failed.";
    } finally {
      if (request.isCurrent()) state.busy = false;
      request.finish();
    }
  }

  scope.selectWorkspace("workspace-a");
  const actionA = runAction("workspace-a", workspaceA);

  scope.selectWorkspace("workspace-b");
  state.busy = false;
  state.error = null;
  state.token = null;
  const actionB = runAction("workspace-b", workspaceB);

  workspaceA.reject(new Error("workspace-a failed"));
  await actionA;
  assert.deepEqual(state, { busy: true, error: null, token: null });

  workspaceB.resolve({ token: "workspace-b-secret" });
  await actionB;
  assert.deepEqual(state, { busy: false, error: null, token: "workspace-b-secret" });
});

test("a deferred billing response cannot overwrite the newly selected workspace", async () => {
  const scope = new WorkspaceRequestScope();
  const workspaceA = deferred<{ plan: string }>();
  const workspaceB = deferred<{ plan: string }>();
  const committed: string[] = [];

  async function loadBilling(workspaceId: string, response: ReturnType<typeof deferred<{ plan: string }>>) {
    const request = scope.begin(workspaceId, "billing:load");
    try {
      const body = await response.promise;
      if (!request.isCurrent()) return;
      committed.push(body.plan);
    } finally {
      request.finish();
    }
  }

  scope.selectWorkspace("workspace-a");
  const loadA = loadBilling("workspace-a", workspaceA);

  scope.selectWorkspace("workspace-b");
  assert.equal(scope.isWorkspaceCurrent("workspace-a"), false);
  const loadB = loadBilling("workspace-b", workspaceB);

  workspaceB.resolve({ plan: "workspace-b-plan" });
  await loadB;
  // The stale workspace-a response resolves last but must not overwrite the active workspace-b billing.
  workspaceA.resolve({ plan: "workspace-a-plan" });
  await loadA;

  assert.deepEqual(committed, ["workspace-b-plan"]);
});

test("a newer request on the same channel supersedes an older response", async () => {
  const scope = new WorkspaceRequestScope();
  scope.selectWorkspace("workspace-a");
  const first = scope.begin("workspace-a", "identity:load");
  const second = scope.begin("workspace-a", "identity:load");

  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
});
