"use client";

import { useEffect, useState } from "react";
import { Card } from "~~/components/tokenless/ui/Card";
import type { AgentAssuranceScopeSummary, AgentRegistry } from "~~/lib/tokenless/agentRegistry";
import type { EvaluationDashboard } from "~~/lib/tokenless/evaluationDashboard";
import { readJson } from "~~/lib/tokenless/http";

type Summary = {
  packet: { createdAt: string; suiteName: string } | null;
  stage: AgentAssuranceScopeSummary["stage"] | null;
  anchor: "completed" | "pending" | "failed" | "absent" | "restricted";
};
type PacketAttestation = { artifactKind: string; artifactDigest: string; state: string };

export function anchorForPacketDigest(packetDigest: string | null, attestations: PacketAttestation[]) {
  if (!packetDigest) return "absent" as const;
  const attestation = attestations.find(
    item => item.artifactKind === "decision_packet" && item.artifactDigest === packetDigest,
  );
  if (attestation?.state === "completed") return "completed" as const;
  if (attestation?.state === "dead") return "failed" as const;
  return attestation ? ("pending" as const) : ("absent" as const);
}

function stageLabel(stage: Summary["stage"]) {
  if (stage === "high_coverage") return "High coverage";
  if (stage === "medium_coverage") return "Medium coverage";
  if (stage === "monitoring") return "Monitoring";
  return stage === "calibrating" ? "Calibrating" : "No evidence scope";
}

function anchorLabel(anchor: Summary["anchor"]) {
  if (anchor === "completed") return "Receipt recorded";
  if (anchor === "pending") return "Pending";
  if (anchor === "failed") return "Failed";
  if (anchor === "restricted") return "Owner/admin view";
  return "No packet anchor";
}

export function WorkspaceEvidenceSummaryStrip({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const base = `/api/account/workspaces/${encodeURIComponent(workspaceId)}`;
        const [registry, dashboard, attestationBody] = await Promise.all([
          readJson<AgentRegistry>(
            await fetch(`${base}/agents`, { cache: "no-store", credentials: "same-origin", signal: controller.signal }),
          ),
          readJson<EvaluationDashboard>(
            await fetch(`${base}/evaluations`, {
              cache: "no-store",
              credentials: "same-origin",
              signal: controller.signal,
            }),
          ),
          canManage
            ? readJson<{ attestations: PacketAttestation[] }>(
                await fetch(`${base}/assurance/attestations?limit=100`, {
                  cache: "no-store",
                  credentials: "same-origin",
                  signal: controller.signal,
                }),
              )
            : Promise.resolve(null),
        ]);
        const stages = registry.agents.flatMap(agent => agent.assuranceScopes.map(scope => scope.stage));
        const stageOrder: AgentAssuranceScopeSummary["stage"][] = [
          "calibrating",
          "high_coverage",
          "medium_coverage",
          "monitoring",
        ];
        const packet = dashboard.runs.find(run => run.evidencePacketAvailable) ?? null;
        if (!controller.signal.aborted) {
          setSummary({
            packet: packet ? { createdAt: packet.createdAt, suiteName: packet.suiteName } : null,
            stage: stageOrder.find(candidate => stages.includes(candidate)) ?? null,
            anchor: canManage
              ? anchorForPacketDigest(packet?.evidencePacketDigest ?? null, attestationBody?.attestations ?? [])
              : "restricted",
          });
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    })();
    return () => controller.abort();
  }, [canManage, workspaceId]);

  if (error) return null;
  return (
    <Card as="section" className="rounded-2xl p-4" aria-label="Workspace evidence summary">
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-base-content/45">Last decision packet</dt>
          <dd className="mt-1 text-sm font-medium">
            {summary?.packet
              ? `${summary.packet.suiteName} · ${new Date(summary.packet.createdAt).toLocaleDateString()}`
              : "None yet"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Most conservative coverage stage</dt>
          <dd className="mt-1 text-sm font-medium">{stageLabel(summary?.stage ?? null)}</dd>
        </div>
        <div>
          <dt className="text-xs text-base-content/45">Latest packet anchor</dt>
          <dd className="mt-1 text-sm font-medium">{anchorLabel(summary?.anchor ?? "absent")}</dd>
        </div>
      </dl>
    </Card>
  );
}
