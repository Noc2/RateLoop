import {
  billingStatusLabel,
  ledgerSourceLabel,
  reservationStatusLabel,
  topupStatusLabel,
} from "./workspaceBillingPresentation";
import assert from "node:assert/strict";
import test from "node:test";

test("billing and funding states have explicit German presentation", () => {
  assert.equal(billingStatusLabel("past_due", "de"), "Zahlung überfällig");
  assert.equal(billingStatusLabel("incomplete_expired", "de"), "Einrichtung abgelaufen");
  assert.equal(topupStatusLabel("credited", "de"), "Guthaben verbucht");
  assert.equal(reservationStatusLabel("reserved", "de"), "Reserviertes Guthaben");
  assert.equal(ledgerSourceLabel("fiat_topup_reversal", "de"), "Storno der Aufladung");
});

test("unknown money states fail closed without exposing raw server keys", () => {
  assert.equal(billingStatusLabel("future_status", "de"), "Status nicht verfügbar");
  assert.equal(topupStatusLabel("future_status", "de"), "Status nicht verfügbar");
  assert.equal(reservationStatusLabel("future_status", "de"), "Reservierungsstatus nicht verfügbar");
  assert.equal(ledgerSourceLabel("future_source", "de"), "Guthabenanpassung");
});
