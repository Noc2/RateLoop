import React from "react";
import { DOCS_NAV } from "../../../constants/docsNav";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

function docsPageHrefs(directory: string, routeSegments: string[] = []): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) {
      // Dynamic segments (e.g. /docs/connect/[host]) are reached from their static index page, not the nav.
      if (entry.name.startsWith("[")) return [];
      return docsPageHrefs(join(directory, entry.name), [...routeSegments, entry.name]);
    }
    if (!entry.isFile() || entry.name !== "page.tsx") return [];
    const suffix = routeSegments.join(sep).split(sep).join("/");
    return [suffix ? `/docs/${suffix}` : "/docs"];
  });
}

test("documentation uses the shared application sidebar instead of a second rail", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: DocsLayout } = await import("./layout");
  const html = renderToStaticMarkup(
    <DocsLayout>
      <article>Documentation content</article>
    </DocsLayout>,
  );

  assert.doesNotMatch(html, /<aside|aria-label="Documentation"/);
  assert.match(html, /max-w-5xl/);
  assert.deepEqual(
    DOCS_NAV.map(group => [group.section, group.links.map(link => link.label)]),
    [
      ["Start Here", ["Introduction", "How It Works", "Use Cases"]],
      [
        "Platform",
        ["Human Oversight", "Compliance", "Connect a Host", "Agents & MCP", "Tech Stack", "Smart Contracts"],
      ],
      ["Build", ["SDK", "API Errors"]],
    ],
  );
});

test("documentation navigation includes every docs page exactly once", () => {
  const navHrefs = DOCS_NAV.flatMap(group => group.links.map(link => link.href));
  const docsRoot = fileURLToPath(new URL(".", import.meta.url));

  assert.equal(new Set(navHrefs).size, navHrefs.length, "documentation navigation contains duplicate routes");
  assert.deepEqual(navHrefs.toSorted(), docsPageHrefs(docsRoot).toSorted());
});
