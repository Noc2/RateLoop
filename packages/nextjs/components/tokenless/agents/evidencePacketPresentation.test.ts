import { EvidenceWorkspacePanel } from "./EvidenceWorkspacePanel";
import {
  EVIDENCE_GATE_MESSAGE_KEYS,
  EVIDENCE_REVIEWER_SOURCE_MESSAGE_KEYS,
  EVIDENCE_TRIGGER_MESSAGE_KEYS,
  evidenceGateLabel,
  evidenceReviewerSourceLabel,
  evidenceTriggerLabel,
} from "./evidencePacketPresentation";
import assert from "node:assert/strict";
import test from "node:test";
import deAgents from "~~/messages/de/agents.json";
import enAgents from "~~/messages/en/agents.json";

function translation(catalog: typeof enAgents, namespace: "workspace" | "evaluation") {
  return (key: string) => {
    let value: unknown = catalog.evidencePanels[namespace];
    for (const part of key.split(".")) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return key;
      value = (value as Record<string, unknown>)[part];
    }
    return typeof value === "string" ? value : key;
  };
}

test("evidence metadata uses complete English and German presentation maps", () => {
  assert.equal(typeof EvidenceWorkspacePanel, "function");
  assert.deepEqual(Object.keys(EVIDENCE_TRIGGER_MESSAGE_KEYS), [
    "adaptive_sample",
    "critical_risk",
    "guardrail_escalation",
    "maximum_gap",
    "owner_required",
    "policy_rule",
  ]);
  assert.deepEqual(Object.keys(EVIDENCE_GATE_MESSAGE_KEYS), ["blocking", "advisory", "not_applicable"]);
  assert.deepEqual(Object.keys(EVIDENCE_REVIEWER_SOURCE_MESSAGE_KEYS), [
    "customer_invited",
    "private_invited",
    "rateloop_network",
    "public_network",
    "hybrid",
  ]);

  for (const catalog of [enAgents, deAgents]) {
    const workspace = translation(catalog, "workspace");
    const evaluation = translation(catalog, "evaluation");
    for (const value of Object.keys(EVIDENCE_TRIGGER_MESSAGE_KEYS)) {
      assert.notEqual(evidenceTriggerLabel(value, workspace), value);
    }
    for (const value of Object.keys(EVIDENCE_GATE_MESSAGE_KEYS))
      assert.notEqual(evidenceGateLabel(value, workspace), value);
    for (const value of Object.keys(EVIDENCE_REVIEWER_SOURCE_MESSAGE_KEYS)) {
      assert.notEqual(evidenceReviewerSourceLabel(value, evaluation), value);
    }
  }
});

test("unknown evidence enums never expose their server value", () => {
  const workspace = translation(deAgents, "workspace");
  const evaluation = translation(deAgents, "evaluation");
  assert.equal(evidenceTriggerLabel("future_trigger", workspace), "Nicht verfügbar");
  assert.equal(evidenceGateLabel("future_gate", workspace), "Nicht verfügbar");
  assert.equal(evidenceReviewerSourceLabel("future_source", evaluation), "Nicht verfügbar");
});
