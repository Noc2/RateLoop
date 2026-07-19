import React from "react";
import { WorkspaceDangerZone } from "./WorkspaceDangerZone";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};
const dangerSource = readFileSync(new URL("./WorkspaceDangerZone.tsx", import.meta.url), "utf8");
const panelsSource = readFileSync(new URL("./agents/AgentWorkspacePanels.tsx", import.meta.url), "utf8");
const settingsSource = readFileSync(new URL("./WorkspaceSettingsClient.tsx", import.meta.url), "utf8");

test("the workspace card exposes one restrained danger zone with both destructive actions", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(
    <WorkspaceDangerZone canDelete workspaceId="workspace-one" workspaceName="Example workspace" />,
  ).replace(/\s+/g, " ");

  assert.match(html, />Danger zone</);
  assert.match(html, /<button[^>]*>Stop all agent activity<\/button>/);
  assert.match(html, /<button[^>]*>Delete workspace<\/button>/);
  assert.match(dangerSource, /mt-8 border-t border-white\/10 pt-6/);
  assert.match(dangerSource, /font-mono text-xs uppercase tracking-widest text-red-300\/80/);
  assert.match(dangerSource, /rounded-xl border border-red-400\/30/);
  assert.ok(dangerSource.indexOf("<WorkspaceStopPanel") < dangerSource.indexOf("<WorkspaceDeletionPanel"));
});

test("the danger zone sits at the bottom of the selected workspace card", () => {
  const settings = settingsSource.indexOf("<WorkspaceDangerZone");
  const identity = settingsSource.indexOf("Configure SSO and SCIM");
  assert.ok(identity >= 0 && identity < settings);
  assert.doesNotMatch(panelsSource, /<WorkspaceDangerZone/);
  assert.match(panelsSource, /<WorkspaceSettingsClient initialWorkspaceId=\{workspaceId\} \/>/);
  assert.match(settingsSource, /selected && canManageWorkspace/);
  assert.match(settingsSource, /canDelete=\{selected\.role === "owner"\}/);
});
