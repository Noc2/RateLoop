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

test("the connected owner overview exposes one GitHub-style danger zone with both destructive actions", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(
    <WorkspaceDangerZone canDelete workspaceId="workspace-one" workspaceName="Example workspace" />,
  ).replace(/\s+/g, " ");

  assert.match(html, />Danger Zone</);
  assert.match(html, /<button[^>]*>Stop all agent activity<\/button>/);
  assert.match(html, /<button[^>]*>Delete workspace<\/button>/);
  assert.match(dangerSource, /rounded-2xl border border-red-400\/45/);
  assert.ok(dangerSource.indexOf("<WorkspaceStopPanel") < dangerSource.indexOf("<WorkspaceDeletionPanel"));
});

test("a normal overview summary precedes the immediately visible danger zone", () => {
  const evidence = panelsSource.indexOf("<WorkspaceEvidenceSummaryStrip");
  const danger = panelsSource.indexOf("<WorkspaceDangerZone");
  const settings = panelsSource.indexOf("<WorkspaceSettingsClient");
  assert.ok(evidence >= 0 && evidence < danger);
  assert.ok(danger < settings);
});
