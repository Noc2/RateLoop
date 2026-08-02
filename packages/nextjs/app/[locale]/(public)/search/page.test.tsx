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
  assert.match(html, /aria-label="Search review work for &quot;connect agent&quot;"/i);
  assert.doesNotMatch(html, />1 destination<|Open the full review queue|>Search review work for/iu);
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
        href: "/agents/results?workspace=workspace-1&run=run_exact&packet=packet_exact",
      },
    ],
    query: "packet_exact",
  });
  const html = renderToStaticMarkup(page).replace(/\s+/g, " ");

  assert.match(html, /Your workspace data/i);
  assert.match(html, /Release review evidence/i);
  assert.match(html, /href="\/agents\/results\?workspace=workspace-1&amp;run=run_exact&amp;packet=packet_exact"/i);
  assert.match(html, /RateLoop/i);
  assert.match(html, /Review work/i);
});

test("search shows one query-aware review-work destination", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { SearchPageContent } = await import("./page");
  const page = SearchPageContent({ authorizedResults: [], query: "review" });
  const html = renderToStaticMarkup(page).replace(/\s+/g, " ");

  assert.equal(html.match(/>Review work</g)?.length, 1);
  assert.doesNotMatch(html, /href="\/human\/review"/);
  assert.match(html, /href="\/human\/review\?q=review"/);
  assert.match(html, /aria-label="Search review work for &quot;review&quot;"/i);
});

test("the search route only loads private results after resolving a server session", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
  assert.match(source, /findAuthSession\(\(await cookies\(\)\)\.get\(AUTH_SESSION_COOKIE\)\?\.value\)/u);
  assert.match(source, /session\s*\?\s*await searchAuthorizedSiteData/u);
  assert.match(source, /<PageHeading/);
  assert.doesNotMatch(source, /tracking-\[0\.18em\][^>]*>\s*Search\s*</);
});
