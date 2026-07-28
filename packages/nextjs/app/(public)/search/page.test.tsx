import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("search shows compact destinations instead of embedding the review workspace", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { SearchPageContent } = await import("./page");
  const page = SearchPageContent({ authorizedResults: [], query: "connect agent" });
  const html = renderToStaticMarkup(page).replace(/\s+/g, " ");

  assert.match(html, /Results for.*connect agent/i);
  assert.match(html, /Tasks/i);
  assert.match(html, /Pages and docs/i);
  assert.match(html, /Review work/i);
  assert.match(html, /href="\/agents\/connections"/);
  assert.match(html, /href="\/human\/review\?q=connect%20agent"/);
  assert.match(html, /Open the full review queue with this search applied/i);
  assert.doesNotMatch(html, /Reviewer navigation|Have an invitation|No review work is available/i);
});

test("signed-in search renders authorized data beside the unchanged public index", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { SearchPageContent } = await import("./page");
  const page = SearchPageContent({
    authorizedResults: [
      {
        area: "Evidence",
        title: "Release review evidence",
        description: "Acme workspace · packet packet_exact · run run_exact",
        href: "/agents/evidence?workspace=workspace-1&run=run_exact&packet=packet_exact",
      },
    ],
    query: "packet_exact",
  });
  const html = renderToStaticMarkup(page).replace(/\s+/g, " ");

  assert.match(html, /Your workspace data/i);
  assert.match(html, /Release review evidence/i);
  assert.match(html, /href="\/agents\/evidence\?workspace=workspace-1&amp;run=run_exact&amp;packet=packet_exact"/i);
  assert.match(html, /RateLoop/i);
  assert.match(html, /Review work/i);
});

test("the search route only loads private results after resolving a server session", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(source, /findAuthSession\(\(await cookies\(\)\)\.get\(AUTH_SESSION_COOKIE\)\?\.value\)/u);
  assert.match(source, /session\s*\?\s*await searchAuthorizedSiteData/u);
});
