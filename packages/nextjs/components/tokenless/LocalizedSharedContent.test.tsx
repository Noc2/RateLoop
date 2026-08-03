import React from "react";
import { LocalizedSharedContent } from "./LocalizedSharedContent";
import { PublicEvidenceVerifier } from "./PublicEvidenceVerifier";
import { RootRecoverySurface } from "./RootRecoverySurface";
import { RuntimeErrorActions } from "./RuntimeErrorActions";
import { NextIntlClientProvider } from "next-intl";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { Locale } from "~~/i18n/config";
import { getMessagesForLocale } from "~~/i18n/messages";
import { WORKSPACE_API_KEY_SCOPE_DETAILS } from "~~/lib/tokenless/workspaceApiKeyScopes";

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};
(globalThis as typeof globalThis & { React: typeof React }).React = React;

function renderWithLocale(locale: Locale, children: React.ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={getMessagesForLocale(locale)}>
      {children}
    </NextIntlClientProvider>,
  );
}

test("shared client surfaces render nested, dynamic, and accessible German copy", () => {
  const html = renderWithLocale(
    "de",
    <LocalizedSharedContent>
      <section aria-label="Permissions for Production agent">
        <h1>Danger zone</h1>
        <p>3 reviewers · expires 2026-08-01</p>
        <button title="Release this workspace stop?">Release stop</button>
      </section>
    </LocalizedSharedContent>,
  );

  assert.match(html, /aria-label="Berechtigungen für Produktionsagent"/u);
  assert.match(html, /Gefahrenbereich/u);
  assert.match(html, /3 Prüfende · läuft ab 2026-08-01/u);
  assert.match(html, /title="Diesen Workspace-Stopp aufheben\?"/u);
  assert.match(html, />Stopp aufheben</u);
  assert.doesNotMatch(html, /Danger zone|Permissions for|Release stop/u);
});

test("workspace API key permissions render complete German labels and descriptions", () => {
  const html = renderWithLocale(
    "de",
    <LocalizedSharedContent>
      <dl>
        {Object.entries(WORKSPACE_API_KEY_SCOPE_DETAILS).map(([scope, details]) => (
          <div key={scope}>
            <dt>{details.label}</dt>
            <dd>{details.description}</dd>
          </div>
        ))}
      </dl>
    </LocalizedSharedContent>,
  );

  for (const expected of [
    "Prüfangebote anfordern",
    "Prüfarbeit starten",
    "Workspace-Guthaben ausgeben",
    "Prüfergebnisse lesen",
    "Evaluierungsstatus lesen",
    "Prüfen, ob eine menschliche Prüfung erforderlich ist",
    "Evaluierungstelemetrie senden",
    "Abgeschlossene Prüfentscheidungen und zugehörige Details abrufen.",
  ]) {
    assert.match(html, new RegExp(expected, "u"));
  }
  assert.doesNotMatch(html, /Request review quotes|Start review work|Read review results|completed review decisions/u);
});

test("the public evidence client renders its German privacy and form copy through the provider", () => {
  const html = renderWithLocale("de", <PublicEvidenceVerifier initialPacketJson="{}" />);

  assert.match(html, />Paket-JSON</u);
  assert.match(html, />JSON-Datei auswählen</u);
  assert.match(html, />Paket verifizieren</u);
  assert.match(html, /Maximal 2 MB\. Die Prüfung läuft in diesem Browser/u);
  assert.match(html, />Geteiltes Paket</u);
  assert.doesNotMatch(html, />Packet JSON|>Choose JSON file|>Verify packet/u);
});

test("English stays canonical while recovery actions and German links use localized defaults", () => {
  const english = renderWithLocale("en", <RuntimeErrorActions reset={() => undefined} />);
  assert.match(english, />Try again</u);
  assert.match(english, />Go back</u);

  const germanActions = renderWithLocale(
    "de",
    <RuntimeErrorActions reset={() => undefined} tryAgainLabel="Erneut versuchen" goBackLabel="Zurück" />,
  );
  assert.match(germanActions, />Erneut versuchen</u);
  assert.match(germanActions, />Zurück</u);

  const recovery = renderToStaticMarkup(
    <RootRecoverySurface
      locale="de"
      eyebrow="Fehler"
      title="Nicht gefunden"
      description="Die Seite ist nicht verfügbar."
    />,
  );
  assert.match(recovery, /aria-label="Nützliche Ziele"/u);
  assert.match(recovery, /href="\/de\/search"/u);
  assert.match(recovery, />Agenten verwalten</u);
});
