import { localizeOverviewPeriod, localizeOverviewReason, localizeQualityBucket } from "./agentOverviewLocalization";
import assert from "node:assert/strict";
import test from "node:test";
import { getMessagesForLocale } from "~~/i18n/messages";

function germanUi(key: string, values: Record<string, number | string> = {}) {
  const messages = getMessagesForLocale("de").agents.ui as Record<string, string>;
  return (messages[key] ?? key).replace(/\{(\w+)\}/gu, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );
}

test("localizes server-defined overview periods, reasons, and quality buckets", () => {
  assert.equal(localizeOverviewPeriod("Last 30 days", germanUi), "Letzte 30 Tage");
  assert.equal(localizeOverviewPeriod("Lifetime by scope", germanUi), "Gesamter Zeitraum je Bereich");
  assert.equal(localizeOverviewPeriod("Current evidence state", germanUi), "Aktueller Nachweisstand");
  assert.equal(
    localizeOverviewReason(
      "At least two privacy-eligible, multi-reviewer cases are required for reviewer consistency.",
      germanUi,
    ),
    "Mindestens zwei geeignete Fälle erforderlich.",
  );
  assert.equal(localizeQualityBucket("unanimous", "Unanimous", "cases", germanUi), "Einstimmig");
  assert.equal(localizeQualityBucket("1h_to_4h", "1–4 hours", "decisions", germanUi), "1–4 Std.");
  assert.equal(
    localizeOverviewReason("Cost is recorded for 3 of 5 decisions.", germanUi),
    "Kosten wurden für 3 von 5 Entscheidungen erfasst.",
  );
  assert.equal(
    localizeOverviewReason(
      "More than 10,000 decisions fall in the last 30 days; use the evidence export for exact metrics.",
      germanUi,
    ),
    "Mehr als 10.000 Entscheidungen entsprechen dieser Ansicht. Nutzen Sie den Nachweisexport für genaue Kennzahlen.",
  );
});

test("preserves unknown server copy until it has a stable semantic key", () => {
  assert.equal(localizeOverviewPeriod("Custom period", germanUi), "Custom period");
  assert.equal(localizeOverviewReason("Custom reason", germanUi), "Custom reason");
  assert.equal(localizeQualityBucket("custom", "Custom bucket", "cases", germanUi), "Custom bucket");
});
