import React from "react";
import { ConfidentialContextTermsDialogPanel } from "./ConfidentialContextGate";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  CONFIDENTIALITY_TERMS_TEXT,
  CONFIDENTIALITY_TERMS_TITLE,
  CONFIDENTIALITY_TERMS_VERSION,
} from "~~/lib/confidentiality/terms";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("confidential context gate renders focused terms in an acceptance dialog", () => {
  const html = renderToStaticMarkup(
    <ConfidentialContextTermsDialogPanel isBusy={false} onAccept={() => undefined} onClose={() => undefined} />,
  ).replace(/\s+/g, " ");

  assert.match(html, /role="dialog"/);
  assert.match(html, new RegExp(CONFIDENTIALITY_TERMS_TITLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(CONFIDENTIALITY_TERMS_TEXT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, new RegExp(`Version: ${CONFIDENTIALITY_TERMS_VERSION}`));
  assert.match(html, /Accept with wallet/);
});
