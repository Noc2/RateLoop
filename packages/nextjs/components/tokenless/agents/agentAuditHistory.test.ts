import { type AgentConnectionHistoryEntry, mergeAgentAuditHistory } from "./agentAuditHistory";
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentVersionSnapshot } from "~~/lib/tokenless/agentRegistry";

function version(overrides: Partial<AgentVersionSnapshot> = {}): AgentVersionSnapshot {
  return {
    versionId: "version-1",
    versionNumber: 1,
    displayName: "Codex",
    description: null,
    declaredProvider: "unknown",
    declaredModel: "unknown",
    declaredModelVersion: null,
    environment: "production",
    configurationCommitment: "abc123",
    createdBy: null,
    createdAt: "2026-07-20T08:53:27.000Z",
    ...overrides,
  };
}

test("connection and workflow events form one newest-first audit timeline", () => {
  const connections: AgentConnectionHistoryEntry[] = [
    {
      eventId: "connection-intent:connected",
      clientName: "codex-mcp-client",
      status: "connected",
      occurredAt: "2026-07-20T08:54:27.000Z",
      legacy: false,
    },
    {
      eventId: "connection-intent:unknown-time",
      clientName: "Agent connection",
      status: "expired",
      occurredAt: null,
      legacy: false,
    },
  ];

  const history = mergeAgentAuditHistory([{ versions: [version()] }], connections);

  assert.deepEqual(
    history.map(entry => entry.eventId),
    ["connection-intent:connected", "workflow-version:version-1", "connection-intent:unknown-time"],
  );
  assert.equal(history[0]?.kind, "connection");
  assert.equal(history[1]?.kind, "workflow_version");
});
