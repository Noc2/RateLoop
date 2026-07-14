import React from "react";
import { PublicQuestionClient } from "./PublicQuestionClient";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};
(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("public question authoring offers text, image, and YouTube context without enabling an incomplete submit", () => {
  const html = renderToStaticMarkup(<PublicQuestionClient sandboxMode />);

  assert.match(html, /Visual context/);
  assert.match(html, /Text only/);
  assert.match(html, /Images/);
  assert.match(html, /YouTube/);
  assert.match(html, /Create public question/);
  assert.match(html, /disabled=""/);
});
