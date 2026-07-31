import React from "react";
import EvidenceSharePage, { dynamic, generateMetadata } from "./share/[grantId]/page";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { EnglishAgentTestProviders } from "~~/components/tokenless/testing/AgentTestProviders";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("the public share page is dynamic, non-indexable, and delegates fragment redemption to the client", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  assert.equal(dynamic, "force-dynamic");
  const metadata = await generateMetadata({
    params: Promise.resolve({ locale: "en", grantId: "esh_1234567890123456789012" }),
  });
  assert.equal(metadata.referrer, "no-referrer");
  assert.deepEqual(metadata.robots, { follow: false, index: false });
  const html = renderToStaticMarkup(
    <EnglishAgentTestProviders>
      {await EvidenceSharePage({
        params: Promise.resolve({ locale: "en", grantId: "esh_1234567890123456789012" }),
      })}
    </EnglishAgentTestProviders>,
  );
  assert.match(html, /This link unlocks one packet/u);
  assert.match(html, /Opening evidence packet/u);
  assert.doesNotMatch(html, /bearerSecret|token_hash|workspaceId|projectId/u);
});
