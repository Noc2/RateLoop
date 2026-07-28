import React from "react";
import { Field, SelectField, TextareaField } from "./Field";
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

test("shared fields keep hints mounted when errors are present", () => {
  const html = renderToStaticMarkup(
    <>
      <Field id="name" label="Name" hint="As shown to reviewers." error="Enter a name." />
      <TextareaField id="reason" label="Reason" hint="Keep it concise." error="Enter a reason." />
      <SelectField id="role" label="Role" hint="Controls access." error="Choose a role.">
        <option value="">Choose</option>
      </SelectField>
    </>,
  );

  for (const id of ["name", "reason", "role"]) {
    assert.match(html, new RegExp(`aria-describedby="${id}-error ${id}-hint"`));
    assert.match(html, new RegExp(`id="${id}-hint"`));
    assert.match(html, new RegExp(`id="${id}-error"`));
  }
});

test("HTTP form errors retain the server field for accessible placement", () => {
  const error = new HttpJsonError("Check this value.", {
    code: "invalid_billing_profile",
    field: "vatId",
    status: 400,
  });
  assert.equal(error.field, "vatId");
});

test("shared fields support compact and visually hidden labels without losing associations", () => {
  const html = renderToStaticMarkup(
    <>
      <Field id="secret" label="One-time secret" labelClassName="sr-only" containerClassName="grow" readOnly />
      <TextareaField id="message" label="Connection message" labelClassName="sr-only" readOnly />
      <SelectField id="workspace" label="Workspace" labelClassName="sr-only">
        <option value="workspace-1">Workspace one</option>
      </SelectField>
    </>,
  );
  assert.match(html, /class="block grow" for="secret"/);
  assert.match(html, /class="[^"]*sr-only[^"]*"[^>]*>One-time secret/);
  assert.match(html, /<textarea[^>]*id="message"/);
  assert.match(html, /<select[^>]*id="workspace"/);
});
