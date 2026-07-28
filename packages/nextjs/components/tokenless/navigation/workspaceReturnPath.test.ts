import {
  normalizeWorkspaceReturnPath,
  workspacePublicContentHref,
  workspaceReturnPathForLocation,
} from "./workspaceReturnPath";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ORIGIN = "https://rateloop-tokenless.vercel.app";

test("workspace return paths preserve exact agent context and reject open redirects", () => {
  assert.equal(
    normalizeWorkspaceReturnPath(
      "/agents/evidence?workspace=workspace-2&q=release&outcome=fail&date=30#decision-packets",
      ORIGIN,
    ),
    "/agents/evidence?workspace=workspace-2&q=release&outcome=fail&date=30#decision-packets",
  );
  assert.equal(normalizeWorkspaceReturnPath("https://evil.example/agents/evidence", ORIGIN), null);
  assert.equal(normalizeWorkspaceReturnPath("//evil.example/agents/evidence", ORIGIN), null);
  assert.equal(normalizeWorkspaceReturnPath("/\\evil.example/agents", ORIGIN), null);
  assert.equal(normalizeWorkspaceReturnPath("/human/review?assignment=secret", ORIGIN), null);
});

test("public content links carry a validated workspace return without dropping destination state", () => {
  assert.equal(
    workspacePublicContentHref(
      "/docs/evidence?mode=verify#verify",
      "/agents/evidence?workspace=workspace-2&q=release&outcome=fail",
    ),
    "/docs/evidence?mode=verify&from=workspace&returnTo=%2Fagents%2Fevidence%3Fworkspace%3Dworkspace-2%26q%3Drelease%26outcome%3Dfail#verify",
  );
  assert.throws(
    () => workspacePublicContentHref("/docs/evidence", "https://evil.example/agents"),
    /return path is not allowed/i,
  );
  assert.throws(
    () => workspacePublicContentHref("https://evil.example/docs", "/agents/overview?workspace=workspace-2"),
    /safe same-origin path/i,
  );
});

test("workspace return context survives navigation between public content pages", () => {
  const returnPath = "/agents/results?workspace=workspace-1&resultStatus=failed&resultDate=30";
  const publicHref = workspacePublicContentHref("/docs/evidence", returnPath);
  const publicUrl = new URL(publicHref, ORIGIN);
  assert.equal(workspaceReturnPathForLocation(publicUrl.pathname, publicUrl.search), returnPath);
  assert.equal(
    workspaceReturnPathForLocation("/agents/results", "?workspace=workspace-1&resultStatus=failed&resultDate=30"),
    returnPath,
  );
  assert.equal(
    workspaceReturnPathForLocation("/docs/evidence", "?from=workspace&returnTo=https%3A%2F%2Fevil.example%2Fagents"),
    null,
  );
  assert.equal(workspaceReturnPathForLocation("/docs/evidence", null), null);
});

test("workspace public links tolerate navigation shims without search parameters", () => {
  const source = readFileSync(new URL("./WorkspacePublicContentLink.tsx", import.meta.url), "utf8");
  assert.match(source, /useSearchParams\(\) \?\? new URLSearchParams\(\)/);
});
