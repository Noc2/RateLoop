import React from "react";
import { Field } from "./Field";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { HttpJsonError } from "~~/lib/tokenless/http";

const nodeRequire = createRequire(import.meta.url);
const { renderToStaticMarkup } = nodeRequire("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("Field applies one shared format and associates field errors", () => {
  const html = renderToStaticMarkup(
    <Field id="vat-id" label="VAT identifier" format="vatIdentifier" error="Check this value." />,
  );
  assert.match(html, /maxlength="64"/i);
  assert.match(html, /pattern="\[A-Za-z0-9\]/);
  assert.match(html, /title="Use at most 64/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="vat-id-error"/);
  assert.match(html, /role="alert">Check this value/);
});

test("HTTP form errors retain the server field for accessible placement", () => {
  const error = new HttpJsonError("Check this value.", {
    code: "invalid_billing_profile",
    field: "vatId",
    status: 400,
  });
  assert.equal(error.field, "vatId");
});
