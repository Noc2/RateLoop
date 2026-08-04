import {
  notifyWorkspaceStopChanged,
  resetWorkspaceStopSyncForTests,
  subscribeWorkspaceStop,
  workspaceStopRevision,
} from "./workspaceStopSync";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

afterEach(resetWorkspaceStopSyncForTests);

test("workspace stop refreshes notify every same-workspace consumer without crossing tenants", () => {
  const notifications: string[] = [];
  const unsubscribeBanner = subscribeWorkspaceStop("ws_one", () => notifications.push("banner"));
  subscribeWorkspaceStop("ws_one", () => notifications.push("panel"));
  subscribeWorkspaceStop("ws_two", () => notifications.push("other"));

  notifyWorkspaceStopChanged("ws_one");
  assert.equal(workspaceStopRevision("ws_one"), 1);
  assert.equal(workspaceStopRevision("ws_two"), 0);
  assert.deepEqual(notifications, ["banner", "panel"]);

  unsubscribeBanner();
  notifyWorkspaceStopChanged("ws_one");
  assert.equal(workspaceStopRevision("ws_one"), 2);
  assert.deepEqual(notifications, ["banner", "panel", "panel"]);
});
