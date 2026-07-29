import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  SCHEDULED_MAINTENANCE_SIGNAL_DESCRIPTORS,
  scheduledMaintenanceSignals,
} from "~~/lib/tokenless/scheduledMaintenanceSignals";

const ALL_DEGRADED_SUMMARY = {
  processorFailures: [{}],
  deadWorkItems: 1,
  nonceDrift: { sweep: { unavailable: 1 }, findings: { unresolved: 1 } },
  work: { dead: 1, retry: 1 },
  webhooks: { dead: 1, retry: 1 },
  notifications: { dead: 1, parked: 1, retry: 1 },
  surpriseBounties: { reconciliationRequired: 1, retry: 1 },
  grcReconciliations: { failed: 1, retry: 1 },
  wormExports: { dead: 1, retry: 1 },
  attestations: { dead: 1, retry: 1, unavailable: 1 },
  evidenceRetention: { backlog: 1, dead: 1, retry: 1 },
  evidencePending: { alert: true, pendingCount: 1 },
  assuranceEvents: { projection: { retry: 1 }, delivery: { dead: 1, retry: 1 } },
  prepaidTopups: {
    reconciliation: { failed: 1 },
    audit: { attempted: 2, delivered: 1 },
  },
  enterpriseIdentityAudit: { delivery: { retry: 1 } },
  directPrivateReviewDeadlines: { retry: 1 },
  paidAssignmentSettlements: { retry: 1 },
  networkAssignmentSettlements: { retry: 1 },
  directPrivateReviewEvidence: { dead: 1, retry: 1 },
  expiredPublicMedia: { failed: ["redacted"] },
};

function normalized(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

test("every degraded maintenance predicate has exactly one health signal descriptor", () => {
  const source = readFileSync(new URL("./scheduledMaintenance.ts", import.meta.url), "utf8");
  const predicateBlock = source.match(/const status =\s*([\s\S]*?)\s*\?\s*"degraded"\s*:\s*"healthy";/u)?.[1];
  assert.ok(predicateBlock, "scheduled maintenance degraded predicate must remain discoverable");
  const predicateExpressions = predicateBlock
    .split(/\s*\|\|\s*/u)
    .map(normalized)
    .sort();
  const descriptorExpressions = SCHEDULED_MAINTENANCE_SIGNAL_DESCRIPTORS.map(descriptor =>
    normalized(descriptor.predicateSource),
  ).sort();

  assert.deepEqual(
    descriptorExpressions,
    predicateExpressions,
    "a degraded predicate and its operator-facing health signal must be added together",
  );
  assert.equal(new Set(SCHEDULED_MAINTENANCE_SIGNAL_DESCRIPTORS.map(({ key }) => key)).size, 36);
});

test("the health signal collector names all degraded subsystems without exposing details", () => {
  const signals = scheduledMaintenanceSignals(ALL_DEGRADED_SUMMARY);
  assert.equal(signals.length, 36);
  assert.ok(signals.every(signal => signal.count === 1));
  assert.deepEqual(
    signals.map(signal => signal.key),
    SCHEDULED_MAINTENANCE_SIGNAL_DESCRIPTORS.map(signal => signal.key),
  );
  assert.doesNotMatch(JSON.stringify(signals), /redacted/u);
});
