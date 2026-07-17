import React from "react";
import { AsyncSection } from "./AsyncSection";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { Chip } from "./Chip";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};
(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("shared cards, buttons, badges, and chips retain semantic elements and named variants", () => {
  const html = renderToStaticMarkup(
    <Card as="section" variant="nested" aria-label="Settings">
      <Button variant="danger" size="sm">
        Remove
      </Button>
      <Badge variant="success">Active</Badge>
      <Chip checked onChange={() => undefined}>
        Selected
      </Chip>
    </Card>,
  );
  assert.match(html, /^<section/);
  assert.match(html, /surface-card-nested/);
  assert.match(html, /type="button"/);
  assert.match(html, /text-red-100/);
  assert.match(html, /bg-emerald-300\/10/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /checked=""/);
});

test("AsyncSection owns loading, error, and empty presentation", () => {
  const loading = renderToStaticMarkup(
    <AsyncSection loading loadingLabel="Loading agents">
      <p>Ready</p>
    </AsyncSection>,
  );
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading agents/);
  assert.doesNotMatch(loading, />Ready</);

  const error = renderToStaticMarkup(
    <AsyncSection loading={false} error="Unable to load">
      <p>Ready</p>
    </AsyncSection>,
  );
  assert.match(error, /role="alert"/);

  const empty = renderToStaticMarkup(
    <AsyncSection loading={false} empty emptyTitle="Nothing yet" emptyDescription="New items appear here.">
      <p>Ready</p>
    </AsyncSection>,
  );
  assert.match(empty, /Nothing yet/);
  assert.match(empty, /New items appear here/);
});
