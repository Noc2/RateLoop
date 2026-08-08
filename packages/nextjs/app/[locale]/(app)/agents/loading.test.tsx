import React from "react";
import { AgentsLoadingStatus } from "./loading";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};
const deAgents = require("../../../../messages/de/agents.json") as {
  loadingWorkspace: string;
};
(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("renders the agents loading fallback in German", () => {
  const html = renderToStaticMarkup(<AgentsLoadingStatus loadingLabel={deAgents.loadingWorkspace} />);

  assert.match(html, />Workspace wird geladen</u);
  assert.doesNotMatch(html, />Loading workspace</u);
});
