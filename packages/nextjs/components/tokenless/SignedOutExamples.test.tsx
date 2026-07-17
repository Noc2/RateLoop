import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("signed-out samples are clearly illustrative and contain no real workspace data", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { AgentWorkspaceExample, HumanReviewExample } = await import("./SignedOutExamples");
  const html = renderToStaticMarkup(
    <>
      <HumanReviewExample />
      <AgentWorkspaceExample />
    </>,
  );

  assert.match(html, /Example review/);
  assert.match(html, /Example pay/);
  assert.match(html, /Example workspace/);
  assert.match(html, /100% at first/);
  assert.doesNotMatch(html, /workspaceId|assignmentId|roundId/);
});
