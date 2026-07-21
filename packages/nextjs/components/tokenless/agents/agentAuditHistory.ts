import type { WorkspaceAgent } from "~~/lib/tokenless/agentRegistry";

export type AgentConnectionHistoryEntry = {
  eventId: string;
  clientName: string;
  status: string;
  occurredAt: string | null;
  legacy: boolean;
};

export type AgentAuditEntry =
  | ({ kind: "connection" } & AgentConnectionHistoryEntry)
  | {
      kind: "workflow_version";
      eventId: string;
      displayName: string;
      versionNumber: number;
      environment: string;
      configurationCommitment: string;
      occurredAt: string;
    };

function eventTime(value: string | null) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function mergeAgentAuditHistory(
  agents: ReadonlyArray<Pick<WorkspaceAgent, "versions">>,
  connectionHistory: readonly AgentConnectionHistoryEntry[],
): AgentAuditEntry[] {
  const workflowHistory: AgentAuditEntry[] = agents.flatMap(agent =>
    agent.versions.map(version => ({
      kind: "workflow_version" as const,
      eventId: `workflow-version:${version.versionId}`,
      displayName: version.displayName,
      versionNumber: version.versionNumber,
      environment: version.environment,
      configurationCommitment: version.configurationCommitment,
      occurredAt: version.createdAt,
    })),
  );

  return [...connectionHistory.map(entry => ({ kind: "connection" as const, ...entry })), ...workflowHistory].sort(
    (left, right) =>
      eventTime(right.occurredAt) - eventTime(left.occurredAt) || left.eventId.localeCompare(right.eventId),
  );
}
