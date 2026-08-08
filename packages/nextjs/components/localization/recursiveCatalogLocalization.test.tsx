import React from "react";
import { localizeCatalogNode } from "./recursiveCatalogLocalization";
import { NextIntlClientProvider } from "next-intl";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import {
  LocalizedPublicContent,
  UntranslatedContent as PublicUntranslatedContent,
} from "~~/components/docs/LocalizedPublicContent";
import {
  LocalizedSharedContent,
  UntranslatedContent as SharedUntranslatedContent,
} from "~~/components/tokenless/LocalizedSharedContent";
import { getMessagesForLocale } from "~~/i18n/messages";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};
(globalThis as typeof globalThis & { React: typeof React }).React = React;

function renderShared(children: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={getMessagesForLocale("de")}>
      <LocalizedSharedContent>{children}</LocalizedSharedContent>
    </NextIntlClientProvider>,
  );
}

test("shared and public recursive localization use the same untranslated-value boundary", () => {
  assert.equal(SharedUntranslatedContent, PublicUntranslatedContent);

  const shared = renderShared(
    <section>
      <p id="shared-copy">Danger zone</p>
      <p id="shared-user">
        <SharedUntranslatedContent>Danger zone</SharedUntranslatedContent>
      </p>
      <p id="shared-hash" aria-label="sha256:No">
        sha256:No
      </p>
      <p id="shared-id">review_Production-agent</p>
      <time dateTime="2026-11-01T12:30:00Z">1. Nov. 2026</time>
    </section>,
  );
  assert.match(shared, /id="shared-copy">Gefahrenbereich</u);
  assert.match(shared, /id="shared-user">Danger zone</u);
  assert.match(shared, /id="shared-hash" aria-label="sha256:No">sha256:No</u);
  assert.match(shared, /id="shared-id">review_Production-agent</u);
  assert.match(shared, /dateTime="2026-11-01T12:30:00Z">1\. Nov\. 2026</u);

  const publicHtml = renderToStaticMarkup(
    <LocalizedPublicContent locale="de" section="docs">
      <section>
        <p id="public-copy">Review</p>
        <p id="public-user">
          <PublicUntranslatedContent>Review</PublicUntranslatedContent>
        </p>
        <p id="public-url">https://example.test/Review</p>
        <p id="public-path">/docs/Review</p>
        <p id="public-id">review_Review</p>
        <p id="public-hash">sha256:Review</p>
        <p id="public-date">2026-08-04T12:30:00Z</p>
        <p id="public-json">{JSON.stringify({ label: "Review" })}</p>
        <p id="public-signature">-----BEGIN SIGNATURE----- Review -----END SIGNATURE-----</p>
      </section>
    </LocalizedPublicContent>,
  );
  assert.match(publicHtml, /id="public-copy">Prüfen</u);
  assert.match(publicHtml, /id="public-user">Review</u);
  assert.match(publicHtml, /id="public-url">https:\/\/example\.test\/Review</u);
  assert.match(publicHtml, /id="public-path">\/docs\/Review</u);
  assert.match(publicHtml, /id="public-id">review_Review</u);
  assert.match(publicHtml, /id="public-hash">sha256:Review</u);
  assert.match(publicHtml, /id="public-date">2026-08-04T12:30:00Z</u);
  assert.match(publicHtml, /id="public-json">\{&quot;label&quot;:&quot;Review&quot;\}</u);
  assert.match(publicHtml, /id="public-signature">-----BEGIN SIGNATURE----- Review -----END SIGNATURE-----</u);
});

test("a component-only attribute is translated while the same prop on an input is not", () => {
  // SummaryItem and friends pass their display text through `value`, so without
  // this those strings could never reach the catalogue however many phrases were
  // added — "Not available" was already catalogued and still rendered English.
  // But `value` also carries an input's contents and an option's key, and
  // translating those would corrupt forms and change submitted data. The
  // distinction is the element kind, not the prop name.
  function Summary({ value }: { value: React.ReactNode }) {
    return <span>{value}</span>;
  }
  const localized = localizeCatalogNode(
    <div>
      <Summary value="Not available" />
      <input readOnly value="Not available" />
      <option value="Not available">Not available</option>
    </div>,
    { attributes: ["title"], componentAttributes: ["value"], phrases: { "Not available": "Nicht verfügbar" } },
  );
  const html = renderToStaticMarkup(localized as React.ReactElement);
  assert.match(html, /<span>Nicht verfügbar<\/span>/u, "the component prop should translate");
  assert.match(html, /<input[^>]*value="Not available"/u, "an input's value must survive untouched");
  assert.match(
    html,
    /<option value="Not available">Nicht verfügbar<\/option>/u,
    "an option key stays, its label translates",
  );
});
