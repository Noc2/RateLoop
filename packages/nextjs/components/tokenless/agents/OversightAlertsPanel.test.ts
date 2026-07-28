import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./OversightAlertsPanel.tsx", import.meta.url), "utf8");

test("the oversight alerts panel lists notifications with an unread count and read control", () => {
  assert.match(source, /\/api\/notifications\/inbox\?limit=50/);
  assert.match(source, /notification\.kind !== "oversightAlerts"/);
  assert.match(source, /if \(!notification\.href\) return false/);
  assert.match(source, /targetWorkspace === workspaceId/);
  assert.doesNotMatch(source, /return !targetWorkspace/);
  assert.match(source, /notifications\.filter\(notification => !notification\.readAt\)\.length/);
  assert.match(source, /unreadCount/);
  assert.match(source, /unread\b/);
  assert.match(source, /Mark all read/);
  assert.match(source, /filter\(notification => !notification\.readAt\)/);
  assert.match(source, /JSON\.stringify\(\{ notificationIds \}\)/);
  assert.doesNotMatch(source, /body: JSON\.stringify\(\{\}\)/);
  assert.match(source, /No alerts need attention/);
  assert.match(source, /Alerts needing attention/);
  assert.match(source, /notification\.title/);
  assert.match(source, /notification\.createdAt/);
  assert.match(source, /Change alert settings/);
  assert.match(source, /aria-controls="oversight-alert-settings"/);
  assert.match(source, /aria-expanded=\{settingsOpen\}/);
  assert.match(source, /settingsOpen \? \(/);
  assert.match(source, /settingsOpen \? "Done" : "Change alert settings"/);
  assert.doesNotMatch(source, /<summary[^>]*>Alert settings<\/summary>/);
  // The alert body carries the workspace name; each entry links onward.
  assert.match(source, /notification\.href/);
});

test("workspace alert settings expose event toggles, the spike threshold, and no email plumbing of their own", () => {
  assert.match(source, /oversight\/alert-preferences/);
  assert.match(source, /gateBlocked/);
  assert.match(source, /reviewFailed/);
  assert.match(source, /workspaceStop/);
  assert.match(source, /coverageFloorHit/);
  assert.match(source, /disagreementSpikeBps/);
  // Email delivery is configured beside its switch in account settings, not repeated here.
  assert.doesNotMatch(source, /add and verify a notification email|Email delivery is separate/i);
  assert.doesNotMatch(source, /resend|sendEmail|smtp/i);
});

test("browser notifications request permission only from the explicit enable button", () => {
  const requests = source.match(/Notification\.requestPermission\(\)/g);
  assert.equal(requests?.length, 1);
  // The single call sits inside the explicit user action handler.
  const handler = source.slice(source.indexOf("async function enableBrowserNotifications"));
  assert.ok(handler.includes("Notification.requestPermission()"));
  assert.match(source, /Enable browser notifications/);
  assert.match(source, /Blocked in the browser settings/);
  assert.match(source, /Off until you enable them explicitly/);
  // Notifications fire only for fresh alerts while the dashboard polls, and
  // only after both the workspace opt-in and a granted permission.
  assert.match(source, /window\.Notification\.permission !== "granted"\) return;/);
  assert.match(source, /fireBrowserNotifications\(fresh, browserEnabled\)/);
  assert.match(source, /POLL_INTERVAL_MS/);
  // Never requested on mount: effects only read the current permission state.
  assert.doesNotMatch(source, /useEffect\([^)]*requestPermission/s);
});
