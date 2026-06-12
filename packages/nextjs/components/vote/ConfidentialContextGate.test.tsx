import React from "react";
import { ConfidentialContextTermsLink } from "./ConfidentialContextGate";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { CONFIDENTIALITY_TERMS_URI } from "~~/lib/confidentiality/terms";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("confidential context gate links directly to focused terms", () => {
  const html = renderToStaticMarkup(<ConfidentialContextTermsLink />).replace(/\s+/g, " ");

  assert.match(html, new RegExp(`href="${CONFIDENTIALITY_TERMS_URI}"`));
  assert.match(html, /target="_blank"/);
  assert.match(html, /question confidentiality terms/);
});
