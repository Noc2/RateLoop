import React from "react";
import { LocalizedPublicContent } from "./LocalizedPublicContent";
import { PublicLink } from "./PublicLink";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { getMessagesForLocale } from "~~/i18n/messages";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

test("German public rendering translates nested legal text and accessibility attributes", () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const html = renderToStaticMarkup(
    <LocalizedPublicContent locale="de" section="legal">
      <article aria-label="On this page">
        <h1>Cookies and browser storage</h1>
        <p>
          <strong>Review drafts:</strong> private-review drafts use session storage and expire with the assignment or
          browser session; public-review drafts may use local storage so the user can resume them. Draft storage is
          principal-scoped, bounded, and cleared when ownership changes or the stored expiry passes.
        </p>
        <img alt="Operator and contact information." src="/test.png" />
        <PublicLink href="/legal/privacy">Privacy notice</PublicLink>
      </article>
    </LocalizedPublicContent>,
  );

  assert.match(html, /Cookies und Browserspeicher/u);
  assert.match(html, /Prüfentwürfe:/u);
  assert.match(html, /Entwürfe privater Prüfungen nutzen den Sitzungsspeicher/u);
  assert.match(html, /alt="Betreiber- und Kontaktinformationen\."/u);
  assert.match(html, /href="\/de\/legal\/privacy"/u);
  assert.doesNotMatch(html, /Review drafts|Operator and contact information/u);
});

test("German landing section headings are complete phrases", () => {
  const sections = getMessagesForLocale("de").home.sections;

  assert.deepEqual(
    [
      `${sections.useCases.lead} ${sections.useCases.accent}`,
      `${sections.howItWorks.lead} ${sections.howItWorks.accent}`,
      `${sections.whyItWorks.lead} ${sections.whyItWorks.accent}`,
      `${sections.pricing.lead} ${sections.pricing.accent}`,
      `${sections.questions.lead} ${sections.questions.accent}`,
    ],
    [
      "Wo Menschen entscheiden",
      "So funktioniert es",
      "Warum es funktioniert",
      "Preise, bewusst einfach",
      "Häufige Fragen",
    ],
  );
});
