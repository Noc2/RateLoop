"use client";

import { useEffect, useState } from "react";
import { Card } from "~~/components/tokenless/ui/Card";

type Health = {
  state: "degraded" | "healthy" | "stale" | "unavailable";
  currentRun: "idle" | "running";
  lastCompletedAt: string | null;
  signals: Array<{ key: string; label: string }>;
};

type PanelState = { status: "loading" } | { status: "ready"; health: Health } | { status: "error" };

const CONTENT: Record<Health["state"], { label: string; description: string; tone: string }> = {
  healthy: {
    label: "Maintenance healthy",
    description: "Scheduled review, delivery, privacy, and settlement work is running normally.",
    tone: "text-emerald-200",
  },
  degraded: {
    label: "Maintenance needs attention",
    description: "Some scheduled work is retrying, parked, or awaiting operator action.",
    tone: "text-amber-200",
  },
  stale: {
    label: "Maintenance delayed",
    description: "Scheduled maintenance has not completed within the expected window.",
    tone: "text-red-200",
  },
  unavailable: {
    label: "Maintenance not observed",
    description: "No scheduled maintenance run has been recorded yet.",
    tone: "text-amber-200",
  },
};

function completedLabel(value: string | null) {
  if (!value) return "No completed run";
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) ? `Last completed ${timestamp.toLocaleString()}` : "No completed run";
}

export function ScheduledWorkerHealthPanel({ workspaceId }: { workspaceId: string }) {
  const [panelState, setPanelState] = useState<PanelState>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setPanelState({ status: "loading" });
    void fetch(`/api/account/workspaces/${encodeURIComponent(workspaceId)}/operations/health`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) throw new Error("Scheduled maintenance health request failed.");
        return (await response.json()) as Health;
      })
      .then(health => {
        if (!controller.signal.aborted) setPanelState({ status: "ready", health });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPanelState({ status: "error" });
      });
    return () => controller.abort();
  }, [workspaceId]);

  if (panelState.status === "loading") return null;
  if (panelState.status === "error") {
    return (
      <Card as="section" aria-live="polite" className="p-5">
        <h2 className="text-base font-semibold text-amber-200">Maintenance status unavailable</h2>
        <p className="mt-1 text-sm text-base-content/65">Health telemetry could not be loaded. Try again later.</p>
      </Card>
    );
  }
  const { health } = panelState;
  const content = CONTENT[health.state];
  return (
    <Card as="section" aria-live="polite" className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={`text-base font-semibold ${content.tone}`}>{content.label}</h2>
          <p className="mt-1 text-sm text-base-content/65">{content.description}</p>
        </div>
        <p className="text-xs text-base-content/60">
          {health.currentRun === "running" ? "Run in progress · " : ""}
          {completedLabel(health.lastCompletedAt)}
        </p>
      </div>
      {health.signals.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label="Maintenance issues">
          {health.signals.map(signal => (
            <li key={signal.key} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs">
              {signal.label}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
