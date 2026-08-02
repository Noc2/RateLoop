import React from "react";
import { CrowdForecastField } from "./CrowdForecastField";
import { NextIntlClientProvider } from "next-intl";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { PrivateAssignmentCard } from "~~/components/tokenless/answer/PrivateAssignmentCard";
import { getMessagesForLocale } from "~~/i18n/messages";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};
(globalThis as typeof globalThis & { React: typeof React }).React = React;

function renderLocalized(locale: "en" | "de", child: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={getMessagesForLocale(locale)} timeZone="UTC">
      {child}
    </NextIntlClientProvider>,
  );
}

test("reviewer controls render from the active German message provider", () => {
  const html = renderLocalized(
    "de",
    <CrowdForecastField
      positiveLabel="Akzeptieren"
      privacyContext="private_unpaid"
      value={null}
      onChange={() => undefined}
    />,
  );

  assert.match(html, /Crowd-Prognose/u);
  assert.match(html, /Gib eine ganze Zahl von 1 bis 99 ein/u);
  assert.doesNotMatch(html, /keine Prognose vorausgewählt/u);
  assert.match(html, /bleibt off-chain/u);
});

test("private review history switches labels with the message provider", () => {
  const assignment = {
    assignmentId: "assignment_1",
    projectName: "Project Atlas",
    dataClassification: "confidential",
    source: "customer_invited",
    status: "completed",
    paidAssignment: false,
    confidentialityTermsHash: null,
    assignmentExpiresAt: null,
    caseCount: 2,
  };

  const germanHtml = renderLocalized("de", <PrivateAssignmentCard assignment={assignment} />);
  const englishHtml = renderLocalized("en", <PrivateAssignmentCard assignment={assignment} />);

  assert.match(germanHtml, /2 Fälle/u);
  assert.match(germanHtml, /Abgeschlossen/u);
  assert.match(englishHtml, /2 cases/u);
  assert.match(englishHtml, /Completed/u);
});
