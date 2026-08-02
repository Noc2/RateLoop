import React from "react";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("the API error reference begins with a link to its parent guide", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { default: AIErrorsPage } = await import("./page");
  const html = renderToStaticMarkup(<AIErrorsPage />).replace(/\s+/g, " ");
  const backLink = html.indexOf('href="/docs/ai"');

  assert.ok(backLink >= 0 && backLink < html.indexOf("<h1"));
  assert.match(html, /← Back to Agents &amp; MCP/);
  assert.match(html, /Recover From.*rateloop-text-gradient.*API Errors/);
});

test("German API errors localize navigation, recovery guidance, and polling rules", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { AIErrorsContent } = await import("./page");
  const html = renderToStaticMarkup(<AIErrorsContent locale="de" />).replace(/\s+/g, " ");

  assert.match(html, /← Zurück zu Agenten und MCP/u);
  assert.match(html, /Beheben Sie.*rateloop-text-gradient.*API-Fehler/u);
  assert.match(html, /<th>Bedeutung<\/th><th>Behebung<\/th>/u);
  assert.match(html, /Erstellen Sie ein neues Angebot und senden Sie es einmal ab/u);
  assert.match(html, /Abfrageregel/u);
  assert.doesNotMatch(
    html,
    /Back to Agents|API Errors|<th>Meaning<\/th>|<th>Recovery<\/th>|Create a fresh quote|Polling rule/u,
  );
});
