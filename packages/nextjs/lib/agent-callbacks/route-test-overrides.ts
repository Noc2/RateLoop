import type { processDueAgentCallbackDeliveries } from "./index";
import type { sweepAgentLifecycleCallbacks } from "./lifecycle";
import type { randomUUID } from "node:crypto";

type AgentCallbackDeliverRouteTestOverrides = {
  processDueAgentCallbackDeliveries?: typeof processDueAgentCallbackDeliveries;
  randomUUID?: typeof randomUUID;
};

type AgentCallbackSweepRouteTestOverrides = {
  sweepAgentLifecycleCallbacks?: typeof sweepAgentLifecycleCallbacks;
};

let deliverOverrides: AgentCallbackDeliverRouteTestOverrides | null = null;
let sweepOverrides: AgentCallbackSweepRouteTestOverrides | null = null;

export function setAgentCallbackDeliverRouteTestOverrides(overrides: AgentCallbackDeliverRouteTestOverrides | null) {
  deliverOverrides = overrides;
}

export function getAgentCallbackDeliverRouteTestOverrides(): AgentCallbackDeliverRouteTestOverrides | null {
  return deliverOverrides;
}

export function setAgentCallbackSweepRouteTestOverrides(overrides: AgentCallbackSweepRouteTestOverrides | null) {
  sweepOverrides = overrides;
}

export function getAgentCallbackSweepRouteTestOverrides(): AgentCallbackSweepRouteTestOverrides | null {
  return sweepOverrides;
}
