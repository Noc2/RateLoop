import { AgentConnectionPanel } from "./AgentConnectionPanel";
import { AgentOverviewMonitor } from "./AgentOverviewMonitor";
import { AgentRegistryPanel } from "./AgentRegistryPanel";
import {
  agentEnvironmentLabel,
  agentStatusLabel,
  assuranceStageLabel,
  connectionStatusLabel,
  enforcementModeLabel,
  riskTierLabel,
} from "./agentPresentation";
import assert from "node:assert/strict";
import test from "node:test";
import deAgents from "~~/messages/de/agents.json";

function germanPresentation(key: string) {
  let value: unknown = deAgents.presentation;
  for (const part of key.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return key;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === "string" ? value : key;
}

test("agent consumers share one localized presentation boundary", () => {
  assert.equal(typeof AgentConnectionPanel, "function");
  assert.equal(typeof AgentOverviewMonitor, "function");
  assert.equal(typeof AgentRegistryPanel, "function");

  assert.equal(agentEnvironmentLabel("production", germanPresentation), "Produktion");
  assert.equal(agentStatusLabel("revoked", germanPresentation), "Widerrufen");
  assert.equal(connectionStatusLabel("install_required", germanPresentation), "Installation erforderlich");
  assert.equal(enforcementModeLabel("host_enforced", germanPresentation), "Durch Host erzwungen");
  assert.equal(riskTierLabel("medium", germanPresentation), "Mittel");
  assert.equal(assuranceStageLabel("high_coverage", germanPresentation), "Hohe Abdeckung");
});

test("unknown server enums never leak their raw value", () => {
  for (const label of [
    agentEnvironmentLabel("future_environment", germanPresentation),
    agentStatusLabel("future_status", germanPresentation),
    connectionStatusLabel("future_status", germanPresentation),
    enforcementModeLabel("future_mode", germanPresentation),
    riskTierLabel("future_risk", germanPresentation),
    assuranceStageLabel("future_stage", germanPresentation),
  ]) {
    assert.equal(label, "Unbekannt");
  }
});
