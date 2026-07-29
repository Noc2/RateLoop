type Summary = Record<string, unknown>;

export type ScheduledMaintenanceSignal = {
  key: string;
  label: string;
  count: number;
};

type SignalDescriptor = {
  key: string;
  label: string;
  predicateSource: string;
  read: (summary: Summary) => number;
};

function object(value: unknown): Summary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Summary;
}

function nestedValue(source: Summary, path: string) {
  let value: unknown = source;
  for (const segment of path.split(".")) value = object(value)[segment];
  return value;
}

function numberAt(path: string) {
  return (summary: Summary) => {
    const value = Number(nestedValue(summary, path) ?? 0);
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  };
}

function arrayLengthAt(path: string) {
  return (summary: Summary) => {
    const value = nestedValue(summary, path);
    return Array.isArray(value) ? value.length : 0;
  };
}

function evidenceBacklogAlert(summary: Summary) {
  if (nestedValue(summary, "evidencePending.alert") !== true) return 0;
  return numberAt("evidencePending.pendingCount")(summary) || 1;
}

function prepaidAuditFailures(summary: Summary) {
  const attempted = Number(nestedValue(summary, "prepaidTopups.audit.attempted") ?? 0);
  const delivered = Number(nestedValue(summary, "prepaidTopups.audit.delivered") ?? 0);
  if (!Number.isSafeInteger(attempted) || !Number.isSafeInteger(delivered)) return 0;
  return Math.max(0, attempted - delivered);
}

export const SCHEDULED_MAINTENANCE_SIGNAL_DESCRIPTORS: readonly SignalDescriptor[] = [
  {
    key: "processorFailures",
    label: "Processor failures",
    predicateSource: "processorFailures.length > 0",
    read: arrayLengthAt("processorFailures"),
  },
  {
    key: "deadWorkItems",
    label: "Dead work items",
    predicateSource: "deadWorkItems > 0",
    read: numberAt("deadWorkItems"),
  },
  {
    key: "nonceDrift.sweep.unavailable",
    label: "Nonce checks unavailable",
    predicateSource: "nonceDriftSweep.unavailable > 0",
    read: numberAt("nonceDrift.sweep.unavailable"),
  },
  {
    key: "nonceDrift.findings.unresolved",
    label: "Unresolved nonce drift",
    predicateSource: "nonceDriftFindings.unresolved > 0",
    read: numberAt("nonceDrift.findings.unresolved"),
  },
  { key: "work.dead", label: "Dead work", predicateSource: "work.dead > 0", read: numberAt("work.dead") },
  { key: "work.retry", label: "Work retries", predicateSource: "work.retry > 0", read: numberAt("work.retry") },
  {
    key: "webhooks.dead",
    label: "Dead webhooks",
    predicateSource: "webhooks.dead > 0",
    read: numberAt("webhooks.dead"),
  },
  {
    key: "webhooks.retry",
    label: "Webhook retries",
    predicateSource: "webhooks.retry > 0",
    read: numberAt("webhooks.retry"),
  },
  {
    key: "notifications.dead",
    label: "Dead notifications",
    predicateSource: "notifications.dead > 0",
    read: numberAt("notifications.dead"),
  },
  {
    key: "notifications.parked",
    label: "Parked notifications",
    predicateSource: "notifications.parked > 0",
    read: numberAt("notifications.parked"),
  },
  {
    key: "notifications.retry",
    label: "Notification retries",
    predicateSource: "notifications.retry > 0",
    read: numberAt("notifications.retry"),
  },
  {
    key: "surpriseBounties.retry",
    label: "Surprise bounty retries",
    predicateSource: "surpriseBounties.retry > 0",
    read: numberAt("surpriseBounties.retry"),
  },
  {
    key: "surpriseBounties.reconciliationRequired",
    label: "Bounties awaiting reconciliation",
    predicateSource: "surpriseBounties.reconciliationRequired > 0",
    read: numberAt("surpriseBounties.reconciliationRequired"),
  },
  {
    key: "grcReconciliations.retry",
    label: "GRC reconciliation retries",
    predicateSource: "grcReconciliations.retry > 0",
    read: numberAt("grcReconciliations.retry"),
  },
  {
    key: "grcReconciliations.failed",
    label: "Failed GRC reconciliations",
    predicateSource: "grcReconciliations.failed > 0",
    read: numberAt("grcReconciliations.failed"),
  },
  {
    key: "wormExports.retry",
    label: "Evidence export retries",
    predicateSource: "wormExports.retry > 0",
    read: numberAt("wormExports.retry"),
  },
  {
    key: "wormExports.dead",
    label: "Dead evidence exports",
    predicateSource: "wormExports.dead > 0",
    read: numberAt("wormExports.dead"),
  },
  {
    key: "attestations.retry",
    label: "Evidence anchor retries",
    predicateSource: "attestations.retry > 0",
    read: numberAt("attestations.retry"),
  },
  {
    key: "attestations.dead",
    label: "Dead evidence anchors",
    predicateSource: "attestations.dead > 0",
    read: numberAt("attestations.dead"),
  },
  {
    key: "attestations.unavailable",
    label: "Pending evidence anchors",
    predicateSource: "attestations.unavailable > 0",
    read: numberAt("attestations.unavailable"),
  },
  {
    key: "evidenceRetention.retry",
    label: "Evidence retention retries",
    predicateSource: "evidenceRetention.retry > 0",
    read: numberAt("evidenceRetention.retry"),
  },
  {
    key: "evidenceRetention.dead",
    label: "Dead evidence retention work",
    predicateSource: "evidenceRetention.dead > 0",
    read: numberAt("evidenceRetention.dead"),
  },
  {
    key: "evidenceRetention.backlog",
    label: "Evidence retention backlog",
    predicateSource: "evidenceRetention.backlog > 0",
    read: numberAt("evidenceRetention.backlog"),
  },
  {
    key: "evidencePending.alert",
    label: "Delayed evidence publication",
    predicateSource: "evidencePending.alert",
    read: evidenceBacklogAlert,
  },
  {
    key: "assuranceEvents.projection.retry",
    label: "Assurance projection retries",
    predicateSource: "assuranceEvents.projection.retry > 0",
    read: numberAt("assuranceEvents.projection.retry"),
  },
  {
    key: "assuranceEvents.delivery.retry",
    label: "Assurance delivery retries",
    predicateSource: "assuranceEvents.delivery.retry > 0",
    read: numberAt("assuranceEvents.delivery.retry"),
  },
  {
    key: "assuranceEvents.delivery.dead",
    label: "Dead assurance deliveries",
    predicateSource: "assuranceEvents.delivery.dead > 0",
    read: numberAt("assuranceEvents.delivery.dead"),
  },
  {
    key: "prepaidTopups.reconciliation.failed",
    label: "Failed prepaid reconciliations",
    predicateSource: "prepaidTopups.failed > 0",
    read: numberAt("prepaidTopups.reconciliation.failed"),
  },
  {
    key: "prepaidTopups.audit",
    label: "Prepaid audit delivery failures",
    predicateSource: "prepaidTopupAudit.attempted > prepaidTopupAudit.delivered",
    read: prepaidAuditFailures,
  },
  {
    key: "enterpriseIdentityAudit.delivery.retry",
    label: "Enterprise identity audit retries",
    predicateSource: "enterpriseIdentityAudit.retry > 0",
    read: numberAt("enterpriseIdentityAudit.delivery.retry"),
  },
  {
    key: "directPrivateReviewDeadlines.retry",
    label: "Review deadline retries",
    predicateSource: "directPrivateReviewDeadlines.retry > 0",
    read: numberAt("directPrivateReviewDeadlines.retry"),
  },
  {
    key: "paidAssignmentSettlements.retry",
    label: "Paid assignment settlement retries",
    predicateSource: "paidAssignmentSettlements.retry > 0",
    read: numberAt("paidAssignmentSettlements.retry"),
  },
  {
    key: "networkAssignmentSettlements.retry",
    label: "Network settlement retries",
    predicateSource: "networkAssignmentSettlements.retry > 0",
    read: numberAt("networkAssignmentSettlements.retry"),
  },
  {
    key: "directPrivateReviewEvidence.dead",
    label: "Dead evidence projections",
    predicateSource: "directPrivateReviewEvidence.dead > 0",
    read: numberAt("directPrivateReviewEvidence.dead"),
  },
  {
    key: "directPrivateReviewEvidence.retry",
    label: "Evidence retries",
    predicateSource: "directPrivateReviewEvidence.retry > 0",
    read: numberAt("directPrivateReviewEvidence.retry"),
  },
  {
    key: "expiredPublicMedia.failed",
    label: "Public media deletion failures",
    predicateSource: "expiredPublicMedia.failed.length > 0",
    read: arrayLengthAt("expiredPublicMedia.failed"),
  },
] as const;

export function scheduledMaintenanceSignals(summary: Summary): ScheduledMaintenanceSignal[] {
  return SCHEDULED_MAINTENANCE_SIGNAL_DESCRIPTORS.flatMap(({ key, label, read }) => {
    const count = read(summary);
    return count > 0 ? [{ key, label, count }] : [];
  });
}
