import { PaidEligibilityClient } from "../PaidEligibilityClient";
import { RaterSettlementRecoveryClient } from "./RaterSettlementRecoveryClient";
import {
  ASSURANCE_CAPABILITY_MESSAGE_KEYS,
  ELIGIBILITY_STATUS_MESSAGE_KEYS,
  SETTLEMENT_ROUND_STATUS_MESSAGE_KEYS,
  assuranceCapabilityLabel,
  eligibilityStatusLabel,
  settlementRoundStatusLabel,
} from "./humanStatePresentation";
import { HUMAN_ASSURANCE_CAPABILITIES } from "@rateloop/sdk";
import assert from "node:assert/strict";
import test from "node:test";
import deHuman from "~~/messages/de/human.json";
import enHuman from "~~/messages/en/human.json";

function translation(catalog: typeof deHuman, namespace: "eligibility" | "settlement") {
  return (key: string) => {
    let value: unknown = catalog[namespace];
    for (const part of key.split(".")) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return key;
      value = (value as Record<string, unknown>)[part];
    }
    return typeof value === "string" ? value : key;
  };
}

test("reviewer eligibility and settlement consumers share localized state presentation", () => {
  assert.equal(typeof PaidEligibilityClient, "function");
  assert.equal(typeof RaterSettlementRecoveryClient, "function");

  const eligibility = translation(deHuman, "eligibility");
  const settlement = translation(deHuman, "settlement");
  assert.equal(eligibilityStatusLabel("not_started", eligibility), "Nicht begonnen");
  assert.equal(eligibilityStatusLabel("blocked", eligibility), "Bezahlte Aufgaben nicht verfügbar");
  assert.equal(settlementRoundStatusLabel("under_quorum_compensated", settlement), "Ohne Quorum vergütet");

  assert.deepEqual(Object.keys(ASSURANCE_CAPABILITY_MESSAGE_KEYS), [...HUMAN_ASSURANCE_CAPABILITIES]);
  assert.deepEqual(Object.keys(ELIGIBILITY_STATUS_MESSAGE_KEYS), [
    "not_started",
    "declined",
    "eligible",
    "review",
    "blocked",
    "expired",
  ]);
  assert.deepEqual(Object.keys(SETTLEMENT_ROUND_STATUS_MESSAGE_KEYS), [
    "open",
    "revealable",
    "aggregating",
    "awaiting_seed",
    "scoring",
    "finalized",
    "zero_commit_refunded",
    "under_quorum_compensated",
    "beacon_failure_compensated",
  ]);

  for (const capability of HUMAN_ASSURANCE_CAPABILITIES) {
    assert.notEqual(assuranceCapabilityLabel(capability, eligibility), capability);
  }

  for (const catalog of [enHuman, deHuman]) {
    const eligibilityCatalog = translation(catalog, "eligibility");
    const settlementCatalog = translation(catalog, "settlement");
    for (const key of Object.values(ELIGIBILITY_STATUS_MESSAGE_KEYS)) assert.notEqual(eligibilityCatalog(key), key);
    for (const key of Object.values(ASSURANCE_CAPABILITY_MESSAGE_KEYS)) assert.notEqual(eligibilityCatalog(key), key);
    for (const key of Object.values(SETTLEMENT_ROUND_STATUS_MESSAGE_KEYS)) assert.notEqual(settlementCatalog(key), key);
  }
});

test("unknown reviewer states never expose raw server values", () => {
  const eligibility = translation(deHuman, "eligibility");
  const settlement = translation(deHuman, "settlement");
  assert.equal(eligibilityStatusLabel("future_status", eligibility), "Status nicht verfügbar");
  assert.equal(assuranceCapabilityLabel("future_capability", eligibility), "Nachweis nicht verfügbar");
  assert.equal(settlementRoundStatusLabel("future_round", settlement), "Rundenstatus nicht verfügbar");
});
