import React from "react";
import EvidenceSharePage, { dynamic, metadata } from "./share/[grantId]/page";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("the public share page is dynamic, non-indexable, and delegates fragment redemption to the client", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  assert.equal(dynamic, "force-dynamic");
  assert.equal(metadata.referrer, "no-referrer");
  assert.deepEqual(metadata.robots, { follow: false, index: false });
  const html = renderToStaticMarkup(
    await EvidenceSharePage({ params: Promise.resolve({ grantId: "esh_1234567890123456789012" }) }),
  );
  assert.match(html, /This link unlocks one packet/u);
  assert.match(html, /Opening evidence packet/u);
  assert.doesNotMatch(html, /bearerSecret|token_hash|workspaceId|projectId/u);
});
