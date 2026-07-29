import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("the public page states the local verification and chain boundaries", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: VerifyEvidencePage } = await import("./page");
  const html = renderToStaticMarkup(<VerifyEvidencePage />).replace(/\s+/g, " ");

  assert.match(html, /Verify an evidence packet/);
  assert.match(html, /digest, both Merkle roots, privacy-safe aggregation, and signature/);
  assert.match(html, /Chain evidence is carried in the packet but is not independently checked here/);
  assert.match(html, /Your packet stays in this browser/);
  assert.match(html, /does not upload, store, or send telemetry/);
  assert.match(html, /type="file"/);
  assert.match(html, /href="\/docs\/evidence#verify"/);
  assert.doesNotMatch(html, /href="[^"]*sign-in|workspaceId|server action/i);
});
